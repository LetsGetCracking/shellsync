const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Client } = require('ssh2');
const { spawn } = require('child_process');

app.setName('ShellSync');

const sessions = new Map(); // sessionId -> { client, stream, sftp }

// --- Persistent storage --------------------------------------------------
const userDataPath = () => app.getPath('userData');
const settingsFile = () => path.join(userDataPath(), 'settings.json');
const sessionsFile = () => path.join(userDataPath(), 'sessions.json');
const sessionsBackup = () => path.join(userDataPath(), 'sessions.pre-upgrade-backup.json');
const rdpLogFile = () => path.join(userDataPath(), 'rdp-log.jsonl');

// Async events (SSH data, close, SFTP progress) can fire after the window
// has already been destroyed during app shutdown — the network teardown
// itself takes a moment even after the window is gone. Sending IPC to a
// destroyed webContents throws "Object has been destroyed" as an uncaught
// exception, which Electron surfaces as its default crash dialog on quit.
// This wrapper makes every such send a no-op once there's no one left to
// receive it, instead of crashing.
function safeSend(wc, channel, ...args) {
  try {
    if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
  } catch { /* window was destroyed between the check and the send — ignore */ }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, data) {
  // Atomic write: serialize to a sibling temp file first, then rename over
  // the target. NTFS `rename` is atomic — either the old file is intact or
  // the new file is complete, never a half-written mess. A power loss or
  // crash mid-write can no longer corrupt settings.json, sessions.json, or
  // known_hosts.json.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    // Best-effort cleanup — if rename failed, remove the orphan tmp file
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

// --- App Login (simple launch gate) --------------------------------------
// Deliberately independent of session-password encryption. This is NOT a
// key-wrapping layer — it never touches passwordEnc, never holds a key that
// SSH connections depend on, and has exactly one job: block the renderer UI
// until the correct password is typed at launch. DPAPI-encrypted session
// passwords remain fully decryptable regardless of this feature's state,
// which is what makes it safe to enable/disable at any time with no risk of
// orphaned or unrecoverable data — the entire failure class from the earlier
// "master password" design (which DID mix these two concerns) is structurally
// impossible here because there is nothing to unwrap or lose.
const LOGIN_PBKDF2_ITERATIONS = 200_000;

function loginConfig() {
  const s = readJson(settingsFile(), {}) || {};
  return s.appLogin || null;
}
function saveLoginConfig(cfg) {
  const s = readJson(settingsFile(), {}) || {};
  s.appLogin = cfg;
  writeJson(settingsFile(), s);
}
function loginVerifierFor(password, saltB64) {
  const salt = Buffer.from(saltB64, 'base64');
  return crypto.pbkdf2Sync(password, salt, LOGIN_PBKDF2_ITERATIONS, 32, 'sha256');
}
function loginPasswordMatches(password, cfg) {
  if (!password) return false;
  const candidate = loginVerifierFor(password, cfg.salt);
  const stored = Buffer.from(cfg.verifier, 'base64');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

ipcMain.handle('login:status', () => {
  const cfg = loginConfig();
  return { enabled: !!(cfg && cfg.enabled) };
});

ipcMain.handle('login:enable', (_e, { password }) => {
  if (!password || password.length < 4) {
    return { ok: false, error: 'Password must be at least 4 characters.' };
  }
  const existing = loginConfig();
  if (existing && existing.enabled) {
    return { ok: false, error: 'App Login is already enabled. Disable it first to change the password.' };
  }
  const salt = crypto.randomBytes(16);
  const verifier = loginVerifierFor(password, salt.toString('base64'));
  saveLoginConfig({ enabled: true, salt: salt.toString('base64'), verifier: verifier.toString('base64') });
  return { ok: true };
});

ipcMain.handle('login:disable', (_e, { password }) => {
  const cfg = loginConfig();
  if (!cfg || !cfg.enabled) return { ok: false, error: 'App Login is not enabled.' };
  if (!loginPasswordMatches(password, cfg)) return { ok: false, error: 'Incorrect password.' };
  saveLoginConfig({ enabled: false });
  return { ok: true };
});

ipcMain.handle('login:verify', (_e, { password }) => {
  const cfg = loginConfig();
  if (!cfg || !cfg.enabled) return { ok: true }; // nothing to verify — not enabled
  if (!loginPasswordMatches(password, cfg)) return { ok: false, error: 'Incorrect password.' };
  return { ok: true };
});

// --- Session storage (encrypted) ----------------------------------------
// v2 file format:
//   { "version": 2, "sessions": [ { id, name, folder, host, port, username,
//     passwordEnc?: base64, keyPath, tags, lastConnected }, ... ] }
//
// v1 (legacy) format was a top-level array with `password` as plain text.
//
// Passwords are encrypted with Windows DPAPI (Electron safeStorage) only.
// [Removed: an earlier "master password" app-lock layer that additionally
// wrapped passwords with a passphrase-derived key. It caused more problems
// than it solved, so it was removed. DPAPI-only encryption remains.]

let sessionStore = null;         // in-memory canonical store, ALWAYS in v2 shape
let migrationPending = false;    // true when v1 with plaintext passwords is detected

function encryptPassword(plain) {
  if (!plain) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (DPAPI) is unavailable. Cannot store password securely.');
  }
  return safeStorage.encryptString(plain).toString('base64');
}
function decryptPassword(enc) {
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); }
  catch { return null; }
}

// Load from disk, detect old format, hold in memory
function loadSessionStore() {
  const raw = readJson(sessionsFile(), null);
  if (raw == null) { sessionStore = { version: 2, sessions: [] }; return; }
  if (Array.isArray(raw)) {
    // Legacy v1 — some entries may have plain-text password
    const hasPlain = raw.some(s => typeof s.password === 'string' && s.password.length > 0);
    sessionStore = { version: 1, sessions: raw };
    migrationPending = hasPlain;
    return;
  }
  if (raw && raw.version === 2 && Array.isArray(raw.sessions)) {
    sessionStore = raw;
    return;
  }
  // Unknown shape — bail to empty (don't overwrite the file until user acts)
  sessionStore = { version: 2, sessions: [] };
}
loadSessionStore();

// --- One-time cleanup: strip leftover master-password wrap flags --------
// Earlier versions could leave passwordEncMasterWrapped:true on sessions.
// That flag is no longer meaningful (the feature is removed) and any password
// encrypted under the old scheme can't be decrypted with plain DPAPI, so we
// clear those specific saved passwords once. The user re-enters them.
function cleanupLegacyMasterWrapFlags() {
  let healed = 0;
  sessionStore.sessions.forEach(s => {
    if (s.passwordEncMasterWrapped) {
      delete s.passwordEnc;
      delete s.passwordEncMasterWrapped;
      healed++;
    }
  });
  if (healed > 0) {
    persistSessions();
    console.log(`[ShellSync] Cleared ${healed} leftover master-password-wrapped session password(s) after feature removal.`);
  }
  return healed;
}
const orphanHealResult = cleanupLegacyMasterWrapFlags();

// Persist current store
function persistSessions() {
  // Never persist the legacy v1 shape past this point; always write v2
  const toWrite = { version: 2, sessions: sessionStore.sessions.map(stripPlaintext) };
  writeJson(sessionsFile(), toWrite);
}
function stripPlaintext(s) {
  const clone = { ...s };
  delete clone.password;          // never persist plaintext
  delete clone.newPassword;       // renderer intent field, not for disk
  delete clone.clearPassword;     // renderer intent field, not for disk
  delete clone._encryptionFailed; // transient flag from the sessions:set path;
                                  // if we kept it, the user would see the
                                  // "encryption failed" toast on every save
                                  // forever, even after fixing the underlying
                                  // DPAPI issue.
  return clone;
}

// Return a renderer-safe view: NO passwords, just a hasPassword boolean
function rendererView() {
  return sessionStore.sessions.map(s => {
    const view = { ...s };
    delete view.password;
    delete view.passwordEnc;
    view.hasPassword = !!s.passwordEnc || !!(sessionStore.version === 1 && s.password);
    view.useAgent = !!s.useAgent;
    return view;
  });
}

// --- Window --------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1500, height: 860,
    minWidth: 1100, minHeight: 640,
    backgroundColor: '#06090F',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('maximize', () => win.webContents.send('window:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('window:state', { maximized: false }));

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  for (const s of sessions.values()) { try { s.client.end(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC: settings & saved sessions -------------------------------------
ipcMain.handle('settings:get', () => readJson(settingsFile(), null));
ipcMain.handle('settings:set', (_e, data) => {
  // appLogin is owned entirely by the main-process login handlers — the
  // renderer holds a cached copy that goes stale the moment login:enable or
  // login:disable is called (main writes new state to disk, but doesn't push
  // it back to the renderer's in-memory settings object). If we let the
  // renderer's `data` overwrite appLogin here, a Settings→Save right after
  // enabling would send the STALE {enabled:false} value and clobber the
  // freshly-saved credentials on disk.
  //
  // Fix: always drop appLogin from incoming renderer data, then merge the
  // rest onto whatever's on disk. Disk is authoritative for appLogin, full
  // stop. (v0.16.1 tried a softer "only preserve if data omits the key"
  // check but the renderer always sends the key, so that guard never fired.)
  const existing = readJson(settingsFile(), {}) || {};
  const incoming = { ...(data || {}) };
  delete incoming.appLogin;
  const merged = { ...existing, ...incoming };
  if (existing.appLogin) merged.appLogin = existing.appLogin;
  writeJson(settingsFile(), merged);
  return true;
});

// Renderer never sees passwords — just a hasPassword flag per session.
ipcMain.handle('sessions:get', () => rendererView());
ipcMain.handle('sessions:heal-status', () => ({ healed: orphanHealResult || 0 }));

// When renderer sends the full array back, each session may carry:
//   newPassword: string   — replace saved password (encrypt & store)
//   clearPassword: true   — wipe saved password
//   (neither)             — keep existing encrypted password unchanged
// Any session missing from the incoming list is deleted.
ipcMain.handle('sessions:set', (_e, incoming) => {
  if (!Array.isArray(incoming)) return false;
  const priorById = new Map(sessionStore.sessions.map(s => [s.id, s]));
  const encAvailable = safeStorage.isEncryptionAvailable();

  const next = incoming.map(inc => {
    const prior = priorById.get(inc.id);
    const merged = { ...(prior || {}), ...inc };
    // Determine password behavior
    if (inc.clearPassword) {
      delete merged.passwordEnc;
    } else if (typeof inc.newPassword === 'string') {
      if (inc.newPassword.length === 0) {
        delete merged.passwordEnc;
      } else if (encAvailable) {
        merged.passwordEnc = encryptPassword(inc.newPassword);
      } else {
        merged._encryptionFailed = true;
      }
    } else {
      // Neither new nor clear — preserve prior encrypted password
      if (prior && prior.passwordEnc) merged.passwordEnc = prior.passwordEnc;
    }
    return stripPlaintext(merged);
  });

  sessionStore = { version: 2, sessions: next };
  persistSessions();
  const failed = next.filter(s => s._encryptionFailed).map(s => s.name);
  return { ok: true, encryptionFailed: failed };
});

// Return the decrypted password for a specific session id (for edit dialog prefill only)
ipcMain.handle('sessions:get-password', (_e, id) => {
  const s = sessionStore.sessions.find(x => x.id === id);
  if (!s) return { ok: false, error: 'Not found' };
  // Legacy v1: password may still be plaintext
  if (sessionStore.version === 1 && typeof s.password === 'string') {
    return { ok: true, password: s.password };
  }
  if (!s.passwordEnc) return { ok: true, password: '' };
  const dec = decryptPassword(s.passwordEnc);
  if (dec == null) return { ok: false, error: 'Decryption failed' };
  return { ok: true, password: dec };
});

// Migration: report status and perform upgrade
ipcMain.handle('migration:status', () => {
  return {
    pending: migrationPending,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    plainCount: sessionStore.sessions.filter(s => typeof s.password === 'string' && s.password.length > 0).length,
    total: sessionStore.sessions.length,
  };
});

ipcMain.handle('migration:run', () => {
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'OS encryption (safeStorage) is not available on this system.' };
  }
  try {
    // Back up the current file first
    if (fs.existsSync(sessionsFile())) {
      fs.copyFileSync(sessionsFile(), sessionsBackup());
    }
    // Encrypt any plaintext passwords, migrate to v2 shape
    sessionStore.sessions = sessionStore.sessions.map(s => {
      const clone = { ...s };
      if (typeof clone.password === 'string' && clone.password.length > 0) {
        clone.passwordEnc = encryptPassword(clone.password);
      }
      delete clone.password;
      return clone;
    });
    sessionStore.version = 2;
    persistSessions();
    migrationPending = false;
    return { ok: true, backupPath: sessionsBackup() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// --- Known Hosts store (host-key verification) ---------------------------
// File format:
//   { "version": 1, "hosts": [
//     { hostname, port, keyType, keyFingerprint, keyRawBase64,
//       firstSeen: <ms>, source: "manual"|"imported" } ] }
const knownHostsFile = () => path.join(userDataPath(), 'known_hosts.json');
let knownHostsStore = null;
let khImportedFromOpenSSH = false;

function loadKnownHosts() {
  const raw = readJson(knownHostsFile(), null);
  if (raw && raw.version === 1 && Array.isArray(raw.hosts)) {
    knownHostsStore = raw;
  } else {
    knownHostsStore = { version: 1, hosts: [] };
  }
}
function persistKnownHosts() { writeJson(knownHostsFile(), knownHostsStore); }
loadKnownHosts();

// Parse an SSH2 host key buffer to (type, fingerprint)
function inspectHostKey(keyBuffer) {
  let keyType = 'unknown';
  try {
    if (keyBuffer.length >= 4) {
      const len = keyBuffer.readUInt32BE(0);
      if (keyBuffer.length >= 4 + len) {
        keyType = keyBuffer.subarray(4, 4 + len).toString('utf8');
      }
    }
  } catch {}
  const fingerprint = 'SHA256:' +
    crypto.createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
  const keyRawBase64 = keyBuffer.toString('base64');
  return { keyType, fingerprint, keyRawBase64 };
}

function findKnownHost(hostname, port) {
  return knownHostsStore.hosts.find(h =>
    h.hostname.toLowerCase() === (hostname || '').toLowerCase() && h.port === (port || 22));
}

function rememberHost(hostname, port, keyInfo, source) {
  // If entry exists, replace it (user is explicitly re-trusting)
  const idx = knownHostsStore.hosts.findIndex(h =>
    h.hostname.toLowerCase() === hostname.toLowerCase() && h.port === port);
  const entry = {
    hostname, port,
    keyType: keyInfo.keyType,
    keyFingerprint: keyInfo.fingerprint,
    keyRawBase64: keyInfo.keyRawBase64,
    firstSeen: idx >= 0 ? knownHostsStore.hosts[idx].firstSeen : Date.now(),
    source: source || 'manual',
  };
  if (idx >= 0) knownHostsStore.hosts[idx] = entry;
  else knownHostsStore.hosts.push(entry);
  persistKnownHosts();
}

// Import from OpenSSH-format known_hosts (~/.ssh/known_hosts)
// Skips hashed hosts (|1|…|…|), wildcards, and @cert-authority lines.
function importOpenSshKnownHosts() {
  const opensshFile = path.join(os.homedir(), '.ssh', 'known_hosts');
  if (!fs.existsSync(opensshFile)) return { imported: 0, skipped: 0, ok: true };
  let imported = 0, skipped = 0;
  try {
    const text = fs.readFileSync(opensshFile, 'utf8');
    text.split(/\r?\n/).forEach(rawLine => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;
      // Skip cert-authority markers and options
      if (line.startsWith('@')) { skipped++; return; }
      const parts = line.split(/\s+/);
      if (parts.length < 3) { skipped++; return; }
      const hostSpec = parts[0];
      const keyType = parts[1];
      const keyB64 = parts[2];
      // Skip hashed & wildcards & negations
      if (hostSpec.startsWith('|') || hostSpec.includes('*') || hostSpec.includes('?')
          || hostSpec.includes('!')) { skipped++; return; }
      // Decode key and compute our SHA256 fingerprint
      let keyBuf;
      try { keyBuf = Buffer.from(keyB64, 'base64'); } catch { skipped++; return; }
      const info = { ...inspectHostKey(keyBuf), keyType }; // keep original OpenSSH type name
      // hostSpec may be "host,ip" or "[host]:port,[ip]:port" — split on commas
      hostSpec.split(',').forEach(spec => {
        const m = spec.match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
        if (!m) { skipped++; return; }
        const hostname = m[1];
        const port = m[2] ? parseInt(m[2], 10) : 22;
        // Only add if we don't already have it (don't override manual entries)
        if (!findKnownHost(hostname, port)) {
          rememberHost(hostname, port, info, 'imported');
          imported++;
        }
      });
    });
    return { imported, skipped, ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Auto-import once on first launch (tracked via a setting)
function autoImportOpenSshIfNeeded() {
  const s = readJson(settingsFile(), {}) || {};
  if (s.opensshImportDone) return null;
  const r = importOpenSshKnownHosts();
  s.opensshImportDone = true;
  writeJson(settingsFile(), s);
  if (r.imported > 0) khImportedFromOpenSSH = true;
  return r;
}
const opensshImportResult = autoImportOpenSshIfNeeded();

// --- IPC: known hosts ---------------------------------------------------
ipcMain.handle('knownhosts:list', () => knownHostsStore.hosts.map(h => ({
  hostname: h.hostname, port: h.port,
  keyType: h.keyType, keyFingerprint: h.keyFingerprint,
  firstSeen: h.firstSeen, source: h.source,
})));

ipcMain.handle('knownhosts:remove', (_e, { hostname, port }) => {
  const before = knownHostsStore.hosts.length;
  knownHostsStore.hosts = knownHostsStore.hosts.filter(h =>
    !(h.hostname.toLowerCase() === (hostname || '').toLowerCase() && h.port === (port || 22)));
  persistKnownHosts();
  return { ok: true, removed: before - knownHostsStore.hosts.length };
});

ipcMain.handle('knownhosts:remove-all', () => {
  const count = knownHostsStore.hosts.length;
  knownHostsStore.hosts = [];
  persistKnownHosts();
  return { ok: true, removed: count };
});

ipcMain.handle('knownhosts:import-openssh', () => importOpenSshKnownHosts());

ipcMain.handle('knownhosts:import-status', () => ({
  imported: !!(opensshImportResult && opensshImportResult.imported),
  count: opensshImportResult && opensshImportResult.imported || 0,
}));

// --- Host verify IPC (main ↔ renderer prompt bridge) --------------------
const pendingHostVerifies = new Map(); // promptId → resolve fn
let hostVerifyCounter = 0;

ipcMain.on('host-verify:respond', (_e, { promptId, accept, remember }) => {
  const resolve = pendingHostVerifies.get(promptId);
  if (resolve) {
    pendingHostVerifies.delete(promptId);
    resolve({ accept: !!accept, remember: !!remember });
  }
});

function askUserAboutHostKey(wc, promptData) {
  return new Promise((resolve) => {
    const promptId = 'hv-' + (++hostVerifyCounter);
    pendingHostVerifies.set(promptId, resolve);
    safeSend(wc, 'host-verify:prompt', { promptId, ...promptData });
  });
}

// --- IPC: SSH ------------------------------------------------------------
// If `savedSessionId` is provided, password is resolved from encrypted store.
// Otherwise `password` (from renderer) is used directly (ad-hoc connections).
// If `useAgent` is true, we skip password/key and use the platform's SSH agent.
ipcMain.handle('ssh:connect', (event, { sessionId, savedSessionId, host, port, username, password, keyPath, useAgent, cols, rows }) => {
  return new Promise((resolve) => {
    let stored = null;
    if (savedSessionId) {
      stored = sessionStore.sessions.find(s => s.id === savedSessionId);
      // Pull useAgent from stored session if not explicitly passed
      if (stored && useAgent === undefined) useAgent = !!stored.useAgent;
    }
    if (savedSessionId && !password && !useAgent) {
      if (stored) {
        if (stored.passwordEnc) {
          const dec = decryptPassword(stored.passwordEnc);
          if (dec != null) password = dec;
        } else if (sessionStore.version === 1 && typeof stored.password === 'string') {
          password = stored.password; // legacy fallback until migration runs
        }
      }
    }

    // Read the private key BEFORE constructing the ssh2 Client. Previously
    // we created `client` first and then tried the file read — if that
    // threw (bad path, permission denied), we resolved with an error but
    // the newly-constructed client was already registered with ssh2's
    // internal maps and never had client.end() called on it, leaking the
    // instance. Doing the read first means a failed read simply returns
    // and no Client ever exists.
    let privateKey;
    if (keyPath) {
      try { privateKey = fs.readFileSync(keyPath); }
      catch (e) { resolve({ ok: false, error: `Key read failed: ${e.message}` }); return; }
    }
    const client = new Client();
    const wc = event.sender;

    // --- Host key verification (TOFU) -----------------------------------
    // hostVerifier receives the raw SSH2 host key buffer. Return true/false via callback.
    const hostVerifier = async (keyBuffer, cb) => {
      const info = inspectHostKey(keyBuffer);
      const existing = findKnownHost(host, port || 22);
      if (existing && existing.keyFingerprint === info.fingerprint) {
        // Perfect match — silent accept
        cb(true);
        return;
      }
      // Either unknown host (TOFU) or mismatch — prompt the user
      const promptData = {
        host, port: port || 22,
        keyType: info.keyType,
        fingerprint: info.fingerprint,
        isMismatch: !!existing,
        existingFingerprint: existing ? existing.keyFingerprint : null,
        existingFirstSeen: existing ? existing.firstSeen : null,
      };
      const decision = await askUserAboutHostKey(wc, promptData);
      if (decision.accept) {
        if (decision.remember) rememberHost(host, port || 22, info, 'manual');
        cb(true);
      } else {
        cb(false);
      }
    };

    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols: cols || 80, rows: rows || 24 }, (err, stream) => {
        if (err) { resolve({ ok: false, error: err.message }); return; }
        const entry = { client, stream, sftp: null };
        sessions.set(sessionId, entry);

        stream.on('data', (d) => safeSend(wc, `ssh:data:${sessionId}`, d.toString('utf8')));
        stream.stderr.on('data', (d) => safeSend(wc, `ssh:data:${sessionId}`, d.toString('utf8')));
        stream.on('close', () => {
          safeSend(wc, `ssh:close:${sessionId}`);
          try { client.end(); } catch {}
          sessions.delete(sessionId);
        });

        client.sftp((sftpErr, sftp) => {
          if (!sftpErr) { entry.sftp = sftp; safeSend(wc, `ssh:sftp-ready:${sessionId}`); }
          else safeSend(wc, `ssh:sftp-error:${sessionId}`, sftpErr.message);
        });

        resolve({ ok: true });
      });
    });

    client.on('error', (err) => resolve({ ok: false, error: err.message }));

    const cfg = { host, port: port || 22, username, readyTimeout: 15000, hostVerifier };
    if (useAgent) {
      // Try Windows OpenSSH agent (Win10+ built-in) first — most common on modern Windows.
      // If the named pipe exists, use it. Otherwise fall back to Pageant.
      const opensshPipe = '\\\\.\\pipe\\openssh-ssh-agent';
      try {
        if (fs.existsSync(opensshPipe)) {
          cfg.agent = opensshPipe;
        } else {
          // ssh2 treats the literal string 'pageant' as a hint to use Pageant on Windows
          cfg.agent = 'pageant';
        }
      } catch { cfg.agent = 'pageant'; }
      cfg.agentForward = false; // agent forwarding requires shell option too; keep off by default
    } else if (privateKey) {
      cfg.privateKey = privateKey;
    } else {
      cfg.password = password;
    }
    try { client.connect(cfg); }
    catch (err) { resolve({ ok: false, error: err.message }); }
  });
});

ipcMain.on('ssh:write', (_e, { sessionId, data }) => {
  const s = sessions.get(sessionId); if (s) s.stream.write(data);
});
ipcMain.on('ssh:resize', (_e, { sessionId, cols, rows }) => {
  const s = sessions.get(sessionId); if (s) s.stream.setWindow(rows, cols);
});
ipcMain.on('ssh:disconnect', (_e, { sessionId }) => {
  const s = sessions.get(sessionId);
  if (s) { try { s.client.end(); } catch {} sessions.delete(sessionId); }
});

// --- IPC: Window controls (custom title bar) -----------------------------
ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('window:maximize-toggle', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
});
ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.handle('window:is-maximized', (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() || false);

// --- IPC: SSH exec (one-off command, e.g. for disk usage) ---------------
ipcMain.handle('ssh:exec', (_e, { sessionId, command }) => {
  return new Promise((resolve) => {
    const s = sessions.get(sessionId);
    if (!s) { resolve({ ok: false, error: 'Session not found' }); return; }
    s.client.exec(command, (err, stream) => {
      if (err) { resolve({ ok: false, error: err.message }); return; }
      let stdout = '', stderr = '';
      stream.on('data', (d) => stdout += d.toString('utf8'));
      stream.stderr.on('data', (d) => stderr += d.toString('utf8'));
      stream.on('close', (code) => resolve({ ok: true, stdout, stderr, code }));
    });
  });
});

// --- IPC: SFTP -----------------------------------------------------------
function getSftp(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || !s.sftp) throw new Error('SFTP not ready yet');
  return s.sftp;
}

ipcMain.handle('sftp:list', async (_e, { sessionId, remotePath }) => {
  try {
    const sftp = getSftp(sessionId);
    const abs = await new Promise((res, rej) =>
      sftp.realpath(remotePath || '.', (err, p) => err ? rej(err) : res(p)));
    const entries = await new Promise((res, rej) =>
      sftp.readdir(abs, (err, list) => err ? rej(err) : res(list)));
    const items = entries.map(e => ({
      name: e.filename,
      isDirectory: e.attrs.isDirectory(),
      size: e.attrs.size,
      mtime: e.attrs.mtime * 1000,
      mode: e.attrs.mode,
    })).sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
    return { ok: true, path: abs, items };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Batch existence check — returns which of these remote paths exist
ipcMain.handle('sftp:exists-batch', async (_e, { sessionId, remotePaths }) => {
  try {
    const sftp = getSftp(sessionId);
    const results = await Promise.all(remotePaths.map(p =>
      new Promise((resolve) => {
        sftp.stat(p, (err, s) => {
          if (err) resolve({ path: p, exists: false });
          else resolve({ path: p, exists: true, isDirectory: s.isDirectory(), size: s.size });
        });
      })
    ));
    return { ok: true, results };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('sftp:mkdir', async (_e, { sessionId, remotePath }) => {
  try {
    const sftp = getSftp(sessionId);
    await new Promise((r, j) => sftp.mkdir(remotePath, (err) => err ? j(err) : r()));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('sftp:delete', async (_e, { sessionId, remotePath, isDirectory }) => {
  try {
    const sftp = getSftp(sessionId);
    if (isDirectory) await new Promise((r, j) => sftp.rmdir(remotePath, (err) => err ? j(err) : r()));
    else await new Promise((r, j) => sftp.unlink(remotePath, (err) => err ? j(err) : r()));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('sftp:rename', async (_e, { sessionId, from, to }) => {
  try {
    const sftp = getSftp(sessionId);
    await new Promise((r, j) => sftp.rename(from, to, (err) => err ? j(err) : r()));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('sftp:upload', async (event, { sessionId, localPath, remotePath }) => {
  try {
    const sftp = getSftp(sessionId);
    const wc = event.sender;
    const stat = fs.statSync(localPath);
    await new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, {
        step: (transferred) => {
          safeSend(wc, `sftp:progress:${sessionId}`, {
            direction: 'up', name: path.basename(localPath),
            sent: transferred, total: stat.size,
          });
        }
      }, (err) => err ? reject(err) : resolve());
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('sftp:download', async (event, { sessionId, remotePath, localPath }) => {
  try {
    const sftp = getSftp(sessionId);
    const wc = event.sender;
    const stat = await new Promise((r, j) => sftp.stat(remotePath, (err, s) => err ? j(err) : r(s)));
    await new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, {
        step: (transferred) => {
          safeSend(wc, `sftp:progress:${sessionId}`, {
            direction: 'down', name: path.basename(remotePath),
            sent: transferred, total: stat.size,
          });
        }
      }, (err) => err ? reject(err) : resolve());
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// --- IPC: Local FS -------------------------------------------------------
ipcMain.handle('local:home', () => os.homedir());
ipcMain.handle('local:list', async (_e, { localPath }) => {
  try {
    const abs = path.resolve(localPath);
    const names = fs.readdirSync(abs);
    const items = names.map(name => {
      try {
        const full = path.join(abs, name);
        const st = fs.statSync(full);
        return { name, isDirectory: st.isDirectory(), size: st.size, mtime: st.mtimeMs };
      } catch { return null; }
    }).filter(Boolean)
      .sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
    return { ok: true, path: abs, items };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Batch local existence check
ipcMain.handle('local:exists-batch', (_e, { localPaths }) => {
  const results = localPaths.map(p => {
    try {
      const st = fs.statSync(p);
      return { path: p, exists: true, isDirectory: st.isDirectory(), size: st.size };
    } catch { return { path: p, exists: false }; }
  });
  return { ok: true, results };
});
ipcMain.handle('local:mkdir', (_e, { localPath }) => {
  try { fs.mkdirSync(localPath); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('local:delete', (_e, { localPath, isDirectory }) => {
  try {
    if (isDirectory) fs.rmdirSync(localPath);
    else fs.unlinkSync(localPath);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('local:rename', (_e, { from, to }) => {
  try { fs.renameSync(from, to); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('local:join', (_e, { base, name }) => path.join(base, name));
ipcMain.handle('local:dirname', (_e, { p }) => path.dirname(p));
ipcMain.handle('local:pick-dir', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.filePaths[0];
});
ipcMain.handle('local:show-in-folder', (_e, { p }) => { shell.showItemInFolder(p); return true; });

// --- Import / export -----------------------------------------------------
ipcMain.handle('sshconfig:import', () => {
  try {
    const cfgPath = path.join(os.homedir(), '.ssh', 'config');
    if (!fs.existsSync(cfgPath)) return { ok: false, error: '~/.ssh/config not found' };
    const text = fs.readFileSync(cfgPath, 'utf8');
    const hosts = parseSshConfig(text);
    return { ok: true, hosts };
  } catch (e) { return { ok: false, error: e.message }; }
});

function parseSshConfig(text) {
  const lines = text.split(/\r?\n/);
  const results = [];
  let current = null;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'host') {
      if (value.includes('*') || value.includes('?')) { current = null; continue; }
      current = { host: value, name: value, port: 22 };
      results.push(current);
    } else if (current) {
      if (key === 'hostname') current.host = value;
      else if (key === 'user') current.username = value;
      else if (key === 'port') current.port = parseInt(value, 10) || 22;
      else if (key === 'identityfile') current.keyPath = value.replace(/^~/, os.homedir());
    }
  }
  return results.filter(h => h.username);
}

ipcMain.handle('sessions:export', async (_e, _incomingIgnored) => {
  const r = await dialog.showSaveDialog({
    defaultPath: 'shellsync-sessions.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  try {
    // Export renderer-safe view (no passwords, no encrypted blobs).
    // The user re-enters passwords on the target machine — encrypted blobs
    // are DPAPI-bound to this Windows user and won't decrypt elsewhere anyway.
    const exportable = sessionStore.sessions.map(s => {
      const view = { ...s };
      delete view.password;
      delete view.passwordEnc;
      return view;
    });
    fs.writeFileSync(r.filePath, JSON.stringify(exportable, null, 2));
    return { ok: true, path: r.filePath, count: exportable.length };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('sessions:import', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!Array.isArray(data)) return { ok: false, error: 'File is not a session array' };
    return { ok: true, sessions: data };
  } catch (e) { return { ok: false, error: e.message }; }
});

// --- RDP session support -----------------------------------------------
// RDP is delegated to Microsoft's native mstsc.exe — ShellSync writes a
// temporary .rdp file with the session's settings, spawns mstsc against it,
// and gets out of the way. Credentials go to Windows Credential Manager via
// cmdkey; nothing sensitive is ever persisted by ShellSync itself.
//
// This gives admins the full native Windows RDP experience: NLA, CredSSP,
// smart cards, RD Gateway, Kerberos SSO, and any group policy the machine
// already enforces — all handled by mstsc, none reimplemented here.

// Builds a .rdp file body from a session object. The .rdp format is plain
// text — a list of "key:type:value" lines; :i: = integer, :s: = string.
function buildRdpFile(session) {
  const lines = [];
  const displayMode = session.displayMode || 'fullscreen';
  const width = session.width || 1920;
  const height = session.height || 1080;
  const colorDepth = session.colorDepth || 32;
  const port = session.port || 3389;

  // Display
  lines.push(`screen mode id:i:${displayMode === 'fullscreen' ? 2 : 1}`);
  lines.push(`use multimon:i:${session.multiMonitor ? 1 : 0}`);
  if (displayMode === 'custom') {
    lines.push(`desktopwidth:i:${width}`);
    lines.push(`desktopheight:i:${height}`);
  }
  lines.push(`session bpp:i:${colorDepth}`);

  // Target
  lines.push(`full address:s:${session.host}:${port}`);
  if (session.username) {
    const userField = session.domain
      ? `${session.domain}\\${session.username}`
      : session.username;
    lines.push(`username:s:${userField}`);
  }

  // Audio: 0 = play on this computer, 1 = play on remote, 2 = don't play
  const audioMode = session.redirectAudio === 'remote' ? 1
    : session.redirectAudio === 'none' ? 2
    : 0;
  lines.push(`audiomode:i:${audioMode}`);

  // Redirection
  lines.push(`redirectclipboard:i:${session.redirectClipboard !== false ? 1 : 0}`);
  lines.push(`redirectdrives:i:${session.redirectDrives ? 1 : 0}`);
  lines.push(`redirectprinters:i:${session.redirectPrinters ? 1 : 0}`);

  // Security — NLA required, CredSSP on
  lines.push('authentication level:i:2');
  lines.push('enablecredsspsupport:i:1');
  lines.push('prompt for credentials:i:0');
  lines.push('negotiate security layer:i:1');

  // RD Gateway
  if (session.gatewayHost) {
    lines.push(`gatewayhostname:s:${session.gatewayHost}`);
    lines.push('gatewayusagemethod:i:1');
    lines.push('gatewaycredentialssource:i:0');
    lines.push('gatewayprofileusagemethod:i:1');
  } else {
    lines.push('gatewayusagemethod:i:4');
  }

  return lines.join('\r\n') + '\r\n';
}

function logRdpConnection(session) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      sessionId: session.id,
      sessionName: session.name,
      host: session.host,
      port: session.port || 3389,
      username: session.username || '',
      domain: session.domain || '',
      gateway: session.gatewayHost || '',
    };
    fs.appendFileSync(rdpLogFile(), JSON.stringify(entry) + '\n');
  } catch { /* logging is best-effort — never fail a connect over a log write */ }
}

async function launchRdpSession(session) {
  const tmpDir = path.join(os.tmpdir(), 'shellsync');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

  const rdpPath = path.join(tmpDir, `session-${session.id}-${Date.now()}.rdp`);
  try {
    fs.writeFileSync(rdpPath, buildRdpFile(session), 'utf8');
  } catch (e) {
    return { ok: false, error: 'Failed to write .rdp file: ' + (e.message || e) };
  }

  const args = [rdpPath];
  if (session.adminSession) args.push('/admin');
  if (session.restrictedAdmin) args.push('/restrictedAdmin');

  try {
    // detached + unref means closing ShellSync doesn't kill the RDP session —
    // matches how every real RDP manager (Royal TS, Devolutions RDM) behaves.
    const proc = spawn('mstsc.exe', args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    proc.unref();

    // Delete the temp .rdp file after mstsc has had time to read it. 5s is
    // ample — mstsc reads the file into memory before it even paints the
    // initial window, so the file on disk isn't needed after that.
    setTimeout(() => { try { fs.unlinkSync(rdpPath); } catch {} }, 5000);

    logRdpConnection(session);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Failed to launch mstsc.exe: ' + (e.message || e) };
  }
}

// Saves credentials to Windows Credential Manager under the TERMSRV/<host>
// key, which is the convention mstsc.exe automatically looks up on connect.
// The password lives as a process argument for the brief lifetime of the
// cmdkey.exe spawn, then is gone — same trade-off Microsoft's own tooling
// makes. ShellSync itself never persists or re-reads the password.
async function saveRdpCredentials({ host, username, domain, password }) {
  if (!host || !username || !password) {
    return { ok: false, error: 'host, username, and password are required' };
  }
  return new Promise((resolve) => {
    const target = `TERMSRV/${host}`;
    const userArg = domain ? `${domain}\\${username}` : username;
    try {
      const proc = spawn('cmdkey.exe', [
        `/generic:${target}`,
        `/user:${userArg}`,
        `/pass:${password}`,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: stderr.trim() || `cmdkey exited with code ${code}` });
      });
      proc.on('error', err => resolve({ ok: false, error: err.message || String(err) }));
    } catch (e) {
      resolve({ ok: false, error: e.message || String(e) });
    }
  });
}

async function deleteRdpCredentials({ host }) {
  if (!host) return { ok: false, error: 'host required' };
  return new Promise((resolve) => {
    try {
      const proc = spawn('cmdkey.exe', [`/delete:TERMSRV/${host}`], {
        windowsHide: true, stdio: ['ignore', 'ignore', 'ignore']
      });
      // cmdkey returns non-zero if the entry didn't exist — that's fine for
      // our purposes (idempotent delete), so resolve ok in both cases.
      proc.on('close', () => resolve({ ok: true }));
      proc.on('error', err => resolve({ ok: false, error: err.message || String(err) }));
    } catch (e) {
      resolve({ ok: false, error: e.message || String(e) });
    }
  });
}

ipcMain.handle('rdp:launch', (_e, session) => launchRdpSession(session));
ipcMain.handle('rdp:saveCredentials', (_e, data) => saveRdpCredentials(data));
ipcMain.handle('rdp:deleteCredentials', (_e, data) => deleteRdpCredentials(data));
