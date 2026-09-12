// xterm globals
const Terminal = window.Terminal;
const FitAddon = window.FitAddon.FitAddon;
const WebLinksAddon = window.WebLinksAddon.WebLinksAddon;
const SearchAddon = window.SearchAddon.SearchAddon;

// --- Defaults ------------------------------------------------------------
const DEFAULT_SETTINGS = {
  fontFamily: 'JetBrains Mono', fontSize: 14, lineHeight: 1.3, fontWeight: 'normal',
  copyOnSelect: true, pasteOnRightClick: true,
  filePanelVisible: true,
  // v0.19.1: minutes of inactivity before App Login re-locks. 0 = never lock.
  // Only takes effect when App Login is enabled. Default 15 minutes.
  autoLockMinutes: 15,
  theme: {
    background: '#0A0E17', foreground: '#E8ECF1',
    cursor: '#00FFFF', selectionBackground: '#4B0068',
    black: '#0A0E17', red: '#FF3366', green: '#00FF9F', yellow: '#FFD700',
    blue: '#00B4FF', magenta: '#FF00FF', cyan: '#00FFFF', white: '#E8ECF1',
    brightBlack: '#3A4356', brightRed: '#FF6688', brightGreen: '#66FFC2',
    brightYellow: '#FFE44D', brightBlue: '#66CFFF', brightMagenta: '#FF66FF',
    brightCyan: '#4DFFFF', brightWhite: '#FFFFFF',
  }
};

const PRESETS = {
  'cybercore': DEFAULT_SETTINGS.theme,
  'synthwave': {
    background:'#241B2F', foreground:'#F92AAD', cursor:'#F97E72', selectionBackground:'#5D1876',
    black:'#241B2F', red:'#FE4450', green:'#72F1B8', yellow:'#FEDE5D',
    blue:'#03EDF9', magenta:'#FF7EDB', cyan:'#03EDF9', white:'#F92AAD',
  },
  'matrix': {
    background:'#000000', foreground:'#00FF41', cursor:'#00FF41', selectionBackground:'#003B00',
    black:'#000000', red:'#008F11', green:'#00FF41', yellow:'#00CC33',
    blue:'#005A0F', magenta:'#00B336', cyan:'#00E63A', white:'#00FF41',
  },
  'dracula': {
    background:'#282a36', foreground:'#f8f8f2', cursor:'#f8f8f0', selectionBackground:'#44475a',
    black:'#000000', red:'#ff5555', green:'#50fa7b', yellow:'#f1fa8c',
    blue:'#bd93f9', magenta:'#ff79c6', cyan:'#8be9fd', white:'#bfbfbf',
  },
  'solarized-dark': {
    background:'#002b36', foreground:'#839496', cursor:'#93a1a1', selectionBackground:'#073642',
    black:'#073642', red:'#dc322f', green:'#859900', yellow:'#b58900',
    blue:'#268bd2', magenta:'#d33682', cyan:'#2aa198', white:'#eee8d5',
  },
  'dark': {
    background:'#1e1e1e', foreground:'#d4d4d4', cursor:'#ffffff', selectionBackground:'#264f78',
    black:'#000000', red:'#cd3131', green:'#0dbc79', yellow:'#e5e510',
    blue:'#2472c8', magenta:'#bc3fbc', cyan:'#11a8cd', white:'#e5e5e5',
  },
  // Windows-native light mode. Cool white background matching Windows 11's
  // system light theme, near-black foreground for readability. ANSI colors
  // shifted from the standard palette toward darker, higher-contrast values
  // because default terminal colors (bright cyan, yellow) are unreadable on
  // white — this uses the palette Microsoft ships in Windows Terminal's
  // built-in "Windows 11 Light" theme (formerly "Vintage Light").
  'windows-light': {
    background:'#FFFFFF', foreground:'#000000', cursor:'#000000', selectionBackground:'#ADD6FF',
    black:'#000000', red:'#C50F1F', green:'#13A10E', yellow:'#C19C00',
    blue:'#0037DA', magenta:'#881798', cyan:'#3A96DD', white:'#CCCCCC',
  },
};

// --- Logo SVG (inline, loaded from logo.svg content) --------------------
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <path d="M32 3 L56 17 L56 47 L32 61 L8 47 L8 17 Z" stroke="#00FFFF" stroke-width="1.5" stroke-linejoin="round" fill="rgba(0, 255, 255, 0.04)"/>
  <path d="M46 20 A18 18 0 0 1 50 32" stroke="#FF00FF" stroke-width="1.75" stroke-linecap="round" fill="none"/>
  <path d="M50 32 L47 30 M50 32 L52 29" stroke="#FF00FF" stroke-width="1.75" stroke-linecap="round" fill="none"/>
  <path d="M18 44 A18 18 0 0 1 14 32" stroke="#FF00FF" stroke-width="1.75" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M14 32 L17 34 M14 32 L12 35" stroke="#FF00FF" stroke-width="1.75" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M22 24 L32 32 L22 40" stroke="#00FFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M34 42 L44 42" stroke="#00FFFF" stroke-width="2.5" stroke-linecap="round" fill="none"/>
</svg>`;

// --- State ---------------------------------------------------------------
let settings = DEFAULT_SETTINGS;
let savedSessions = [];
const tabs = new Map();
let activeTabId = null;
let tabCounter = 0;
let sessionFilter = '';
let sortMode = 'name';
let collapsedFolders = new Set();
// One shared file browser instance, bound to the active tab
let sharedFileBrowser = null;

// --- Custom dropdown (replaces native <select> popup, which Windows renders
// in light mode regardless of color-scheme:dark on some systems) -----------
// Keeps the original <select> in the DOM (visually hidden) as the source of
// truth — any existing code that reads/writes `.value` on it keeps working
// unchanged. We just render our own themed button + list on top of it.
function initCustomSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select || select.dataset.customized) return;
  select.dataset.customized = '1';

  const wrap = document.createElement('div');
  wrap.className = 'cselect-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cselect-btn';

  const label = document.createElement('span');
  label.className = 'cselect-label';
  btn.appendChild(label);
  const chevron = document.createElement('span');
  chevron.className = 'cselect-chevron';
  chevron.innerHTML = window.icon('chevron-down', 13);
  btn.appendChild(chevron);

  const list = document.createElement('div');
  list.className = 'cselect-list hidden';

  function buildOptions() {
    list.innerHTML = '';
    [...select.options].forEach(opt => {
      const row = document.createElement('div');
      row.className = 'cselect-option';
      row.textContent = opt.textContent;
      row.dataset.value = opt.value;
      if (opt.value === select.value) row.classList.add('selected');
      row.onclick = () => {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncLabel();
        closeList();
      };
      list.appendChild(row);
    });
  }
  function syncLabel() {
    const current = [...select.options].find(o => o.value === select.value);
    label.textContent = current ? current.textContent : select.value;
    list.querySelectorAll('.cselect-option').forEach(row => {
      row.classList.toggle('selected', row.dataset.value === select.value);
    });
  }
  function openList() {
    buildOptions();
    list.classList.remove('hidden');
    wrap.classList.add('open');
    // Close on outside click (once)
    setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
  }
  function closeList() {
    list.classList.add('hidden');
    wrap.classList.remove('open');
    document.removeEventListener('click', onOutsideClick);
  }
  function onOutsideClick(e) {
    if (!wrap.contains(e.target)) closeList();
  }
  btn.onclick = (e) => {
    e.stopPropagation();
    if (list.classList.contains('hidden')) openList(); else closeList();
  };

  select.style.display = 'none';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(btn);
  wrap.appendChild(list);
  wrap.appendChild(select); // keep select inside wrap for layout/positioning context

  // Expose a refresh hook so code that sets select.value programmatically
  // (e.g. loadSettingsIntoUI) can force the visible label to update.
  select._cselectRefresh = syncLabel;
  // Expose the wrap element itself so callers with custom swap-to-input
  // behavior (e.g. the folder dropdown's "New folder..." flow) can hide/show
  // the themed button+list instead of the (permanently display:none) select.
  select._cselectWrap = wrap;
  syncLabel();
}

// Call this after any code sets a customized select's .value directly
function refreshCustomSelect(selectId) {
  const select = document.getElementById(selectId);
  if (select && select._cselectRefresh) select._cselectRefresh();
}

// Show/hide a customized select's themed button+list (used by the folder
// dropdown's swap-to-text-input flow instead of toggling the native select,
// which is always display:none once customized).
function setCustomSelectVisible(selectId, visible) {
  const select = document.getElementById(selectId);
  if (select && select._cselectWrap) {
    select._cselectWrap.classList.toggle('hidden', !visible);
  } else if (select) {
    // Not yet customized (shouldn't normally happen) — fall back to the select itself
    select.classList.toggle('hidden', !visible);
  }
}
(async function init() {
try {
  console.log('[ShellSync] Init starting...');
  document.getElementById('brand-logo').innerHTML = LOGO_SVG;
  document.getElementById('tb-logo').innerHTML = LOGO_SVG;
  hydrateIcons(document);
  bindTitleBar();
  bindLoginScreen();

  // App Login gate: if enabled, block everything else until the correct
  // password is entered. This check is completely independent of session
  // password decryption — DPAPI works the same whether this is on or off.
  let loginStatus;
  try {
    loginStatus = await window.api.loginStatus();
    console.log('[ShellSync] App Login status:', loginStatus);
  } catch (err) {
    console.error('[ShellSync] loginStatus failed:', err);
    loginStatus = { enabled: false };
  }
  if (loginStatus && loginStatus.enabled) {
    showLoginScreen();
    await new Promise((resolve) => {
      const check = () => {
        if (document.getElementById('login-screen').classList.contains('hidden')) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
    console.log('[ShellSync] App Login passed, continuing init');
    // v0.19.0: arm the idle-inactivity auto-lock. It only activates if App
    // Login is enabled — otherwise there's nothing to lock back to.
    enableAutoLockIfNeeded();
  }

  console.log('[ShellSync] Binding UI...');
  bindDiskWidget();
  // v0.19.0: populate the title-bar version from the actual runtime,
  // not a hardcoded string. Falls back gracefully if the IPC fails.
  try {
    const v = await window.api.getAppVersion();
    if (v) document.getElementById('tb-version').textContent = 'v' + v;
  } catch (err) {
    console.warn('[ShellSync] getAppVersion failed:', err);
  }
  const stored = await window.api.getSettings();
  if (stored) {
    // appLogin is main-owned state, not a renderer preference. Keeping it in
    // the renderer's settings cache led to a stale-write bug: enabling App
    // Login updated disk but not the cached object, and a subsequent
    // Settings→Save round-tripped the stale {enabled:false} back to main.
    // v0.17.3 hardened settings:set on the main side to ignore inbound
    // appLogin; this drops it from the renderer's memory as well so no other
    // code path can accidentally read a stale value. loginStatus() is the
    // only correct way to check App Login state.
    const cleaned = { ...stored };
    delete cleaned.appLogin;
    settings = mergeSettings(DEFAULT_SETTINGS, cleaned);
  }
  console.log('[ShellSync] Loading sessions...');
  savedSessions = ((await window.api.getSessions()) || []).map(migrateSession);
  console.log('[ShellSync] Loaded', savedSessions.length, 'sessions');

  // Start every folder collapsed on launch — the user expands the ones they
  // want to see. Only seeded once here, at startup; clicking a folder header
  // afterward manages collapsedFolders normally for the rest of the session.
  savedSessions.forEach(s => { if (s.folder) collapsedFolders.add(s.folder); });

  // One-time notice: if any sessions had a leftover password from the removed
  // master-password feature that couldn't be recovered, tell the user once.
  try {
    const heal = await window.api.getSessionsHealStatus();
    if (heal && heal.healed > 0) {
      setTimeout(() => showToast(
        `${heal.healed} session${heal.healed === 1 ? '' : 's'} had a saved password that couldn't be recovered ` +
        `after a feature change. Please re-enter ${heal.healed === 1 ? 'its' : 'their'} password when convenient.`,
        null, 9000
      ), 600);
    }
  } catch (err) { console.error('[ShellSync] heal-status check failed:', err); }
  applyFilePanelVisibility();
  renderSessionTree();
  bindDialogs();
  bindSearchBar();
  bindGlobalShortcuts();
  bindSidebar();
  bindContextMenu();
  bindFilePanel();
  bindMigrationDialog();
  bindHostVerify();
  bindKnownHostsUi();
  bindAppLoginUi();
  loadSettingsIntoUI();
  updateConnectionStatus();
  console.log('[ShellSync] Init complete');

  // v0.9 password migration prompt
  const mig = await window.api.migrationStatus();
  if (mig && mig.pending) showMigrationDialog(mig);

  // v0.10 OpenSSH known_hosts auto-import toast
  const imp = await window.api.knownHostsImportStatus();
  if (imp && imp.imported && imp.count > 0) {
    setTimeout(() => showToast(`Imported ${imp.count} host key${imp.count === 1 ? '' : 's'} from ~/.ssh/known_hosts`), 400);
  }
} catch (err) {
  console.error('[ShellSync] INIT FAILED:', err);
  // Show a visible error so the user isn't stuck at a blank screen
  document.body.insertAdjacentHTML('afterbegin',
    `<div style="position:fixed;top:50px;left:50%;transform:translateX(-50%);z-index:99999;
      background:#2a0010;color:#ff6688;padding:20px 28px;border:1px solid #ff3366;
      border-radius:8px;font-family:monospace;font-size:13px;max-width:600px;
      box-shadow:0 4px 30px rgba(255,51,102,0.5);">
      <strong>ShellSync init failed:</strong><br>
      ${(err && err.message) || String(err)}<br><br>
      <span style="font-size:11px;opacity:0.8;">Check DevTools console (Ctrl+Shift+I) for details.</span>
    </div>`);
}
})();

function bindTitleBar() {
  document.getElementById('tb-min').onclick = () => window.api.winMinimize();
  document.getElementById('tb-max').onclick = () => window.api.winMaximizeToggle();
  document.getElementById('tb-close').onclick = () => window.api.winClose();
}

// --- Server stats panel (Disk / CPU / RAM) -----------------------------
let statsPollTimer = null;
let statsInFlight = false;    // re-entrance guard: skip tick if previous exec hasn't returned
const STATS_INTERVAL_MS = 5000;

function bindDiskWidget() {
  // legacy shim — not used, but keep to avoid touching init() list
}

function startStatsPolling() {
  stopStatsPolling();
  refreshServerStats(); // immediate
  statsPollTimer = setInterval(refreshServerStats, STATS_INTERVAL_MS);
}
function stopStatsPolling() {
  if (statsPollTimer) { clearInterval(statsPollTimer); statsPollTimer = null; }
  // Don't touch statsInFlight — the exec is still out there and will clear
  // its own flag when it eventually returns. Overwriting to false here would
  // let a NEW poll cycle start before the outstanding exec resolves, which
  // is exactly what this guard exists to prevent.
}

async function refreshServerStats() {
  // Re-entrance guard: on a slow or high-latency SSH server the exec can
  // take longer than the 5s polling interval. Without this, setInterval
  // would keep firing and stack parallel exec channels — a compounding
  // problem the longer the server stays laggy. Silently skip the tick
  // instead; the next interval fires 5s later and probably finds the flag
  // clear again.
  if (statsInFlight) return;

  const t = tabs.get(activeTabId);
  const panel = document.getElementById('stats-panel');
  if (!t || !t.connected) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  // Single SSH exec: all stats in one round-trip
  // Delimited output for easy parsing. sleep 0.5 between CPU samples.
  const cmd =
    'echo "===DISK===" && df -Pk / 2>/dev/null | tail -1; ' +
    'echo "===CPU1===" && head -1 /proc/stat 2>/dev/null; ' +
    'sleep 0.5; ' +
    'echo "===CPU2===" && head -1 /proc/stat 2>/dev/null; ' +
    'echo "===CORES===" && (nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null); ' +
    'echo "===MEM===" && cat /proc/meminfo 2>/dev/null; ' +
    'echo "===END==="';

  statsInFlight = true;
  try {
    const r = await window.api.sshExec(t.sessionId, cmd);
    if (!r.ok || !r.stdout) return;

    const sections = parseSections(r.stdout);
    updateDiskRow(sections.DISK);
    updateCpuRow(sections.CPU1, sections.CPU2, sections.CORES);
    updateRamRow(sections.MEM);
  } finally {
    // Always clear the guard, even if sshExec threw or returned early —
    // otherwise a single failed poll would deadlock the stats panel until
    // the tab reconnected.
    statsInFlight = false;
  }
}

function parseSections(text) {
  const out = {};
  let current = null; let buf = [];
  text.split(/\r?\n/).forEach(line => {
    const m = line.match(/^===(\w+)===$/);
    if (m) {
      if (current) out[current] = buf.join('\n').trim();
      current = m[1]; buf = [];
    } else if (current) {
      buf.push(line);
    }
  });
  if (current && current !== 'END') out[current] = buf.join('\n').trim();
  return out;
}

// --- Disk ---
function updateDiskRow(diskLine) {
  const row = document.querySelector('.stat-row[data-stat="disk"]');
  if (!diskLine) { markStatNA(row); return; }
  const parts = diskLine.split(/\s+/);
  if (parts.length < 5) { markStatNA(row); return; }
  const totalKb = parseInt(parts[1], 10);
  const usedKb = parseInt(parts[2], 10);
  const availKb = parseInt(parts[3], 10);
  let percent = parseInt(parts[4].replace('%', ''), 10);
  if (isNaN(percent) || isNaN(totalKb)) { markStatNA(row); return; }
  percent = Math.max(0, Math.min(100, percent));
  applyStatRow(row, percent, `${fmtKb(usedKb)} / ${fmtKb(totalKb)} · ${fmtKb(availKb)} free`);
}

// --- CPU ---
// Two /proc/stat samples: first line "cpu  u n s idle iowait irq softirq steal guest gnice"
function updateCpuRow(cpu1, cpu2, coresText) {
  const row = document.querySelector('.stat-row[data-stat="cpu"]');
  if (!cpu1 || !cpu2) { markStatNA(row); return; }
  const a = parseCpuLine(cpu1);
  const b = parseCpuLine(cpu2);
  if (!a || !b) { markStatNA(row); return; }
  const totalDelta = b.total - a.total;
  const idleDelta = b.idle - a.idle;
  if (totalDelta <= 0) { markStatNA(row); return; }
  const percent = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
  const cores = parseInt((coresText || '').trim(), 10);
  const detail = (!isNaN(cores) && cores > 0) ? `${cores} core${cores === 1 ? '' : 's'}` : 'usage';
  applyStatRow(row, percent, detail);
}

function parseCpuLine(text) {
  const line = text.split('\n').find(l => l.startsWith('cpu ')) || text.split('\n')[0];
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5 || parts[0] !== 'cpu') return null;
  const nums = parts.slice(1).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
  if (nums.length < 4) return null;
  const idle = (nums[3] || 0) + (nums[4] || 0); // idle + iowait
  const total = nums.reduce((s, n) => s + n, 0);
  return { idle, total };
}

// --- RAM ---
// Prefer MemAvailable (kernel ≥3.14). Fallback: MemFree + Buffers + Cached
function updateRamRow(memText) {
  const row = document.querySelector('.stat-row[data-stat="ram"]');
  if (!memText) { markStatNA(row); return; }
  const m = {};
  memText.split(/\r?\n/).forEach(line => {
    const p = line.match(/^(\w+):\s+(\d+)\s*kB/i);
    if (p) m[p[1]] = parseInt(p[2], 10);
  });
  const total = m.MemTotal;
  if (!total) { markStatNA(row); return; }
  const avail = m.MemAvailable != null
    ? m.MemAvailable
    : (m.MemFree || 0) + (m.Buffers || 0) + (m.Cached || 0);
  const used = total - avail;
  const percent = Math.max(0, Math.min(100, Math.round((used / total) * 100)));
  applyStatRow(row, percent, `${fmtKb(used)} / ${fmtKb(total)}`);
}

function applyStatRow(row, percent, detail) {
  const ring = row.querySelector('.stat-ring-fg');
  const bar = row.querySelector('.stat-bar-fill');       // may be null on compact rows
  const pctEl = row.querySelector('.stat-percent');
  const detailEl = row.querySelector('.stat-detail');    // may be null on compact rows
  // Ring: circle r=16, circumference ≈ 100.53
  const circumference = 2 * Math.PI * 16;
  const dash = (percent / 100) * circumference;
  ring.setAttribute('stroke-dasharray', `${dash} ${circumference - dash}`);
  if (bar) bar.style.width = percent + '%';
  pctEl.textContent = percent + '%';
  if (detailEl) {
    detailEl.textContent = detail;
    detailEl.classList.remove('na');
  }
  row.classList.toggle('warn', percent >= 85);
}

function markStatNA(row) {
  const ring = row.querySelector('.stat-ring-fg');
  const bar = row.querySelector('.stat-bar-fill');
  const pctEl = row.querySelector('.stat-percent');
  const detailEl = row.querySelector('.stat-detail');
  ring.setAttribute('stroke-dasharray', '0 100');
  if (bar) bar.style.width = '0%';
  pctEl.textContent = 'N/A';
  if (detailEl) {
    detailEl.textContent = 'not available';
    detailEl.classList.add('na');
  }
  row.classList.remove('warn');
}

function fmtKb(kb) {
  if (kb < 1024) return kb + ' KB';
  if (kb < 1024 * 1024) return (kb / 1024).toFixed(1) + ' MB';
  if (kb < 1024 * 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB';
  return (kb / 1024 / 1024 / 1024).toFixed(2) + ' TB';
}

// Legacy alias so fileBrowser.js's callback keeps working (refresh disk after transfers)
window.notifyDiskUsageChanged = () => { refreshServerStats(); };

function hydrateIcons(root) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (el.dataset.hydrated) return;
    const name = el.dataset.icon;
    const size = parseInt(el.dataset.iconSize || '18', 10);
    el.innerHTML = window.icon(name, size) + (el.textContent || '');
    el.dataset.hydrated = '1';
  });
}

function migrateSession(s) {
  // Session-type discriminator was added in v0.16.0. Anything without an
  // explicit type is legacy SSH and stays SSH — existing sessions are
  // unaffected by the RDP feature.
  const type = s.type === 'rdp' ? 'rdp' : 'ssh';
  const base = {
    id: s.id || crypto.randomUUID(),
    type,
    name: s.name || 'Untitled',
    folder: s.folder || '',
    host: s.host,
    port: s.port || (type === 'rdp' ? 3389 : 22),
    username: s.username,
    tags: Array.isArray(s.tags) ? s.tags : [],
    lastConnected: s.lastConnected || 0,
  };
  if (type === 'ssh') {
    return {
      ...base,
      hasPassword: !!s.hasPassword || (typeof s.password === 'string' && s.password.length > 0),
      useAgent: !!s.useAgent,
      keyPath: s.keyPath || '',
    };
  }
  // RDP — passwords live in Windows Credential Manager, never in the store.
  // `hasSavedCredentials` is just a UI hint so the dialog can show a
  // "Clear saved" button; the actual secret isn't accessible from here.
  return {
    ...base,
    domain: s.domain || '',
    gatewayHost: s.gatewayHost || '',
    displayMode: s.displayMode || 'fullscreen',
    width: s.width || 1920,
    height: s.height || 1080,
    colorDepth: s.colorDepth || 32,
    multiMonitor: !!s.multiMonitor,
    adminSession: !!s.adminSession,
    restrictedAdmin: !!s.restrictedAdmin,
    redirectClipboard: s.redirectClipboard !== false, // default true
    redirectDrives: !!s.redirectDrives,
    redirectPrinters: !!s.redirectPrinters,
    redirectAudio: s.redirectAudio || 'local',
    hasSavedCredentials: !!s.hasSavedCredentials,
  };
}

function mergeSettings(base, o) {
  return { ...base, ...o, theme: { ...base.theme, ...(o.theme || {}) } };
}

// Track which sessions are actively connected (for status dots)
function isSessionConnected(sessionId) {
  for (const t of tabs.values()) {
    if (t.session.id === sessionId && t.connected) return true;
  }
  return false;
}

// --- Session tree --------------------------------------------------------
function renderSessionTree() {
  const container = document.getElementById('session-tree');
  container.innerHTML = '';

  const q = sessionFilter.toLowerCase().trim();
  const filtered = savedSessions.filter(s => {
    if (!q) return true;
    return s.name.toLowerCase().includes(q)
      || s.host.toLowerCase().includes(q)
      || (s.username || '').toLowerCase().includes(q)
      || (s.folder || '').toLowerCase().includes(q)
      || s.tags.some(t => t.toLowerCase().includes(q));
  });

  const groups = new Map();
  filtered.forEach(s => {
    const f = s.folder || '';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(s);
  });

  const folderNames = [...groups.keys()].sort((a, b) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });

  for (const f of folderNames) {
    const items = groups.get(f);
    if (sortMode === 'recent') items.sort((a, b) => (b.lastConnected || 0) - (a.lastConnected || 0));
    else items.sort((a, b) => a.name.localeCompare(b.name));
  }

  folderNames.forEach(folderName => {
    const items = groups.get(folderName);
    if (folderName === '') {
      items.forEach(s => container.appendChild(renderSessionItem(s)));
    } else {
      const isCollapsed = collapsedFolders.has(folderName);
      const folder = document.createElement('div');
      folder.className = 'folder' + (isCollapsed ? ' collapsed' : '');
      const header = document.createElement('div');
      header.className = 'folder-header';
      header.innerHTML = `<span class="caret">${window.icon('chevron-down', 12)}</span><span>${escapeHtml(folderName)}</span><span class="count">${items.length}</span>`;
      header.onclick = () => {
        if (collapsedFolders.has(folderName)) collapsedFolders.delete(folderName);
        else collapsedFolders.add(folderName);
        renderSessionTree();
      };
      const children = document.createElement('div'); children.className = 'folder-children';
      items.forEach(s => children.appendChild(renderSessionItem(s)));
      folder.appendChild(header); folder.appendChild(children);
      container.appendChild(folder);
    }
  });

  refreshFolderDropdown();
}

function renderSessionItem(s) {
  const li = document.createElement('div');
  li.className = 'session-item';
  // Multi-shade dot state
  const connected = isSessionConnected(s.id);
  const isActiveTab = tabs.get(activeTabId)?.session?.id === s.id && connected;
  const now = Date.now();
  const recentMs = 24 * 60 * 60 * 1000; // 1 day
  const idleMs = 30 * 24 * 60 * 60 * 1000; // 30 days

  if (isActiveTab) li.classList.add('active', 'dot-active');
  else if (connected) li.classList.add('dot-connected');
  else if (s.lastConnected && (now - s.lastConnected) < recentMs) li.classList.add('dot-recent');
  else if (s.lastConnected && (now - s.lastConnected) < idleMs) li.classList.add('dot-idle');
  // else: default empty dot (never or very long ago)

  const typeBadge = s.type === 'rdp'
    ? `<span class="session-type-badge type-rdp" title="RDP session">RDP</span>`
    : '';
  li.innerHTML = `
    <span class="status-dot"></span>
    <div class="meta">
      <span class="name">${escapeHtml(s.name)}${typeBadge}</span>
      ${s.tags.length ? `<span class="tags">${s.tags.map(escapeHtml).join(' · ')}</span>` : ''}
    </div>
  `;
  li.onclick = () => openSession(s);
  li.oncontextmenu = (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Open', icon: 'play', onClick: () => openSession(s) },
      { label: 'Edit...', icon: 'edit', onClick: () => openSessionDialog(s) },
      { label: 'Move to folder...', icon: 'folder', onClick: () => moveSessionToFolder(s) },
      { sep: true },
      { label: 'Delete', icon: 'trash', onClick: async () => {
        // For RDP sessions with saved Windows credentials, offer to also
        // remove the Credential Manager entry so we don't leave orphaned
        // Windows-level state behind after the session is gone.
        const isRdpWithCreds = s.type === 'rdp' && s.hasSavedCredentials;
        const dialogOpts = {
          title: 'Delete Session', message: `Delete "${s.name}"? This cannot be undone.`,
          confirmLabel: 'Delete', danger: true,
        };
        if (isRdpWithCreds) {
          dialogOpts.checkbox = {
            label: 'Also remove saved Windows credentials for this host',
            defaultChecked: true,
          };
        }
        const result = await window.showConfirmDialog(dialogOpts);
        const confirmed = isRdpWithCreds ? result.confirmed : result;
        if (!confirmed) return;
        if (isRdpWithCreds && result.checked) {
          try { await window.api.rdpDeleteCredentials({ host: s.host }); } catch {}
        }
        savedSessions = savedSessions.filter(x => x.id !== s.id);
        window.api.setSessions(savedSessions);
        renderSessionTree();
      }},
    ]);
  };
  return li;
}

function refreshFolderDropdown() {
  const sel = document.getElementById('s-folder');
  const cur = sel.value;
  const folders = [...new Set(savedSessions.map(s => s.folder).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">(root)</option>' +
    folders.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('') +
    '<option value="__new__">➕ New folder...</option>';
  sel.value = cur;
  refreshCustomSelect('s-folder');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function moveSessionToFolder(s) {
  const dlg = document.getElementById('move-folder-dialog');
  const sel = document.getElementById('mf-select');
  const newInput = document.getElementById('mf-new');

  // Populate dropdown with existing folders + "new folder" option
  const folders = [...new Set(savedSessions.map(x => x.folder).filter(Boolean))].sort();
  sel.innerHTML =
    '<option value="">(root)</option>' +
    folders.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('') +
    '<option value="__new__">➕ New folder...</option>';
  sel.value = s.folder || '';
  refreshCustomSelect('mf-select');
  setCustomSelectVisible('mf-select', true);
  newInput.classList.add('hidden');
  newInput.value = '';

  document.getElementById('mf-desc').textContent = `Move "${s.name}" to which folder?`;

  const commitNewFolder = () => {
    const name = newInput.value.trim();
    newInput.classList.add('hidden');
    setCustomSelectVisible('mf-select', true);
    if (!name) { sel.value = ''; refreshCustomSelect('mf-select'); return; }
    const existing = [...sel.options].find(o => o.value === name);
    if (!existing) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
    }
    sel.value = name;
    refreshCustomSelect('mf-select');
  };

  sel.onchange = () => {
    if (sel.value === '__new__') {
      setCustomSelectVisible('mf-select', false);
      newInput.classList.remove('hidden');
      newInput.value = '';
      setTimeout(() => newInput.focus(), 40);
    }
  };
  newInput.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitNewFolder(); }
    else if (e.key === 'Escape') { e.preventDefault(); newInput.value = ''; commitNewFolder(); }
  };
  newInput.onblur = () => commitNewFolder();

  document.getElementById('mf-cancel').onclick = () => dlg.classList.add('hidden');
  document.getElementById('mf-save').onclick = () => {
    // If they were still in "new folder" input mode, commit first
    if (!newInput.classList.contains('hidden')) commitNewFolder();
    s.folder = sel.value === '__new__' ? '' : sel.value;
    window.api.setSessions(savedSessions);
    renderSessionTree();
    dlg.classList.add('hidden');
  };

  dlg.classList.remove('hidden');
}

// --- Sidebar bindings ----------------------------------------------------
function bindSidebar() {
  const filter = document.getElementById('session-filter');
  filter.oninput = () => { sessionFilter = filter.value; renderSessionTree(); };
  document.querySelectorAll('input[name="sort"]').forEach(r => {
    r.onchange = () => { sortMode = r.value; renderSessionTree(); };
  });
  document.getElementById('import-btn').onclick = () =>
    document.getElementById('import-dialog').classList.remove('hidden');
  document.getElementById('export-btn').onclick = async () => {
    const r = await window.api.exportSessions(savedSessions);
    if (r && r.ok) showToast(`Exported ${savedSessions.length} sessions to ${r.path}`);
  };
  document.getElementById('new-folder-btn').onclick = openCreateFolderDialog;
  bindCreateFolderDialog();
}

function openCreateFolderDialog() {
  const dlg = document.getElementById('create-folder-dialog');
  const nameInput = document.getElementById('cf-name');
  const createBtn = document.getElementById('cf-create');
  const list = document.getElementById('cf-sessions-list');

  nameInput.value = '';
  createBtn.disabled = true;

  // Build session checkboxes
  if (!savedSessions.length) {
    list.innerHTML = '<div class="cf-empty">No sessions yet — create a session first, or you can create an empty folder.</div>';
  } else {
    list.innerHTML = savedSessions.map(s => `
      <label class="cf-session-row">
        <input type="checkbox" data-session-id="${escapeHtml(s.id)}" />
        <span class="cf-session-name">${escapeHtml(s.name)}</span>
        <span class="cf-session-current">${s.folder ? `in "${escapeHtml(s.folder)}"` : ''}</span>
      </label>
    `).join('');
  }

  dlg.classList.remove('hidden');
  setTimeout(() => nameInput.focus(), 40);
}

function bindCreateFolderDialog() {
  const dlg = document.getElementById('create-folder-dialog');
  const nameInput = document.getElementById('cf-name');
  const createBtn = document.getElementById('cf-create');

  nameInput.oninput = () => {
    createBtn.disabled = !nameInput.value.trim();
  };
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!createBtn.disabled) createBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dlg.classList.add('hidden');
    }
  };
  document.getElementById('cf-cancel').onclick = () => dlg.classList.add('hidden');
  createBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    // Move any checked sessions to this folder
    const checked = [...document.querySelectorAll('#cf-sessions-list input:checked')]
      .map(cb => cb.dataset.sessionId);
    let movedCount = 0;
    savedSessions.forEach(s => {
      if (checked.includes(s.id)) { s.folder = name; movedCount++; }
    });
    // If no sessions selected, we still want the folder to "exist" in the UI so the user
    // sees success. Since folders are just properties of sessions in our data model,
    // an empty folder can't persist. We show a helpful message instead.
    if (movedCount === 0) {
      showToast(`Folder "${name}" is ready — add sessions to it when creating/editing them.`);
    } else {
      await window.api.setSessions(savedSessions);
      renderSessionTree();
      showToast(`Created "${name}" with ${movedCount} session${movedCount === 1 ? '' : 's'}`);
    }
    dlg.classList.add('hidden');
  };
}

// --- File panel toggle ---------------------------------------------------
function bindFilePanel() {
  document.getElementById('fp-collapse-btn').onclick = () => setFilePanelVisible(false);
  document.getElementById('fp-expand-btn').onclick = () => setFilePanelVisible(true);
}
function setFilePanelVisible(visible) {
  settings.filePanelVisible = visible;
  window.api.setSettings(settings);
  applyFilePanelVisibility();
  // Refit active terminal after grid change AND tell the remote about the new width
  const t = tabs.get(activeTabId);
  if (t) requestAnimationFrame(() => {
    t.fit.fit();
    window.api.sshResize(t.sessionId, t.term.cols, t.term.rows);
  });
}
function applyFilePanelVisibility() {
  const app = document.getElementById('app');
  const expandBtn = document.getElementById('fp-expand-btn');
  if (settings.filePanelVisible) {
    app.classList.remove('no-file-panel');
    expandBtn.classList.add('hidden');
  } else {
    app.classList.add('no-file-panel');
    expandBtn.classList.remove('hidden');
  }
}

// --- Context menu --------------------------------------------------------
function bindContextMenu() {
  const menu = document.getElementById('context-menu');
  document.addEventListener('click', () => menu.classList.add('hidden'));
}
function showContextMenu(x, y, items) {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = '';
  items.forEach(it => {
    if (it.sep) {
      const s = document.createElement('div'); s.className = 'menu-sep';
      menu.appendChild(s);
    } else {
      const el = document.createElement('div');
      el.className = 'menu-item';
      const iconHtml = it.icon ? `<span class="icon-wrap">${window.icon(it.icon, 15)}</span>` : '';
      el.innerHTML = `${iconHtml}<span>${escapeHtml(it.label)}</span>`;
      el.onclick = (e) => { e.stopPropagation(); menu.classList.add('hidden'); it.onClick(); };
      menu.appendChild(el);
    }
  });
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  menu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 4) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 4) + 'px';
  });
}
window.showContextMenu = showContextMenu;

// --- Session dialog ------------------------------------------------------
let editingSessionId = null;
let editingPasswordDirty = false; // did the user actually change the password field?

async function openSessionDialog(existing) {
  editingSessionId = existing ? existing.id : null;
  editingPasswordDirty = false;
  const type = existing ? (existing.type || 'ssh') : 'ssh';

  document.getElementById('session-dialog-title').textContent =
    existing ? 'Edit Session' : 'New SSH or RDP Session';

  refreshFolderDropdown();
  document.getElementById('s-name').value = existing ? existing.name : '';
  document.getElementById('s-folder').value = existing ? existing.folder : '';
  refreshCustomSelect('s-folder');
  document.getElementById('s-host').value = existing ? existing.host : '';
  document.getElementById('s-port').value = existing ? existing.port : (type === 'rdp' ? 3389 : 22);
  document.getElementById('s-user').value = existing ? (existing.username || '') : '';
  document.getElementById('s-tags').value = existing ? existing.tags.join(', ') : '';

  // Set up the type toggle and show the right field group. Disable switching
  // when editing an existing session — silently converting an SSH session to
  // RDP (or vice versa) would strip fields and probably confuse the user.
  setSessionDialogType(type);
  const sshBtn = document.getElementById('s-type-ssh');
  const rdpBtn = document.getElementById('s-type-rdp');
  if (existing) {
    sshBtn.disabled = true; rdpBtn.disabled = true;
    sshBtn.style.opacity = rdpBtn.style.opacity = '0.5';
    sshBtn.style.cursor = rdpBtn.style.cursor = 'not-allowed';
  } else {
    sshBtn.disabled = false; rdpBtn.disabled = false;
    sshBtn.style.opacity = rdpBtn.style.opacity = '';
    sshBtn.style.cursor = rdpBtn.style.cursor = '';
  }

  if (type === 'ssh') {
    // SSH-specific fields
    const passField = document.getElementById('s-pass');
    const clearBtn = document.getElementById('s-pass-clear');
    passField.value = '';
    if (existing && existing.hasPassword) {
      passField.placeholder = '••••••••  (saved — leave blank to keep)';
      if (clearBtn) clearBtn.classList.remove('hidden');
    } else {
      passField.placeholder = '';
      if (clearBtn) clearBtn.classList.add('hidden');
    }
    document.getElementById('s-key').value = existing ? existing.keyPath : '';
    const useAgent = document.getElementById('s-use-agent');
    useAgent.checked = existing ? !!existing.useAgent : false;
    applyUseAgentDisable();
  } else {
    // RDP-specific fields
    document.getElementById('s-rdp-domain').value = existing ? (existing.domain || '') : '';
    const rdpPass = document.getElementById('s-rdp-pass');
    const rdpClearBtn = document.getElementById('s-rdp-pass-clear');
    rdpPass.value = '';
    if (existing && existing.hasSavedCredentials) {
      rdpPass.placeholder = '••••••••  (saved in Credential Manager)';
      if (rdpClearBtn) rdpClearBtn.classList.remove('hidden');
    } else {
      rdpPass.placeholder = 'Save to Windows Credential Manager';
      if (rdpClearBtn) rdpClearBtn.classList.add('hidden');
    }
    document.getElementById('s-rdp-display-mode').value = existing ? (existing.displayMode || 'fullscreen') : 'fullscreen';
    document.getElementById('s-rdp-width').value = existing ? (existing.width || 1920) : 1920;
    document.getElementById('s-rdp-height').value = existing ? (existing.height || 1080) : 1080;
    document.getElementById('s-rdp-color-depth').value = existing ? String(existing.colorDepth || 32) : '32';
    document.getElementById('s-rdp-multimon').checked = existing ? !!existing.multiMonitor : false;
    document.getElementById('s-rdp-gateway').value = existing ? (existing.gatewayHost || '') : '';
    document.getElementById('s-rdp-admin').checked = existing ? !!existing.adminSession : false;
    document.getElementById('s-rdp-restricted-admin').checked = existing ? !!existing.restrictedAdmin : false;
    document.getElementById('s-rdp-clip').checked = existing ? existing.redirectClipboard !== false : true;
    document.getElementById('s-rdp-drives').checked = existing ? !!existing.redirectDrives : false;
    document.getElementById('s-rdp-printers').checked = existing ? !!existing.redirectPrinters : false;
    document.getElementById('s-rdp-audio').value = existing ? (existing.redirectAudio || 'local') : 'local';
    applyRdpDisplayModeVisibility();
  }
  document.getElementById('session-dialog').classList.remove('hidden');
}

// Swaps the dialog between SSH and RDP field groups. Only called for NEW
// sessions — editing an existing session locks the type (see openSessionDialog).
function setSessionDialogType(type) {
  const sshBtn = document.getElementById('s-type-ssh');
  const rdpBtn = document.getElementById('s-type-rdp');
  const sshFields = document.getElementById('s-ssh-fields');
  const rdpFields = document.getElementById('s-rdp-fields');
  const portField = document.getElementById('s-port');

  if (type === 'rdp') {
    rdpBtn.classList.add('active'); sshBtn.classList.remove('active');
    sshFields.classList.add('hidden'); rdpFields.classList.remove('hidden');
    // Nudge the port to the RDP default only if it's still the SSH default
    if (portField.value === '22' || !portField.value) portField.value = '3389';
  } else {
    sshBtn.classList.add('active'); rdpBtn.classList.remove('active');
    rdpFields.classList.add('hidden'); sshFields.classList.remove('hidden');
    if (portField.value === '3389' || !portField.value) portField.value = '22';
  }
  // Update the title too, but only for NEW sessions (edit keeps "Edit Session")
  if (!editingSessionId) {
    document.getElementById('session-dialog-title').textContent = 'New SSH or RDP Session';
  }
}

function applyRdpDisplayModeVisibility() {
  const mode = document.getElementById('s-rdp-display-mode').value;
  const customBox = document.getElementById('s-rdp-custom-size');
  if (mode === 'custom') customBox.classList.remove('hidden');
  else customBox.classList.add('hidden');
}

function applyUseAgentDisable() {
  const useAgent = document.getElementById('s-use-agent');
  const passField = document.getElementById('s-pass');
  const keyField = document.getElementById('s-key');
  const clearBtn = document.getElementById('s-pass-clear');
  const disabled = useAgent.checked;
  passField.disabled = disabled;
  keyField.disabled = disabled;
  if (clearBtn) clearBtn.disabled = disabled;
  passField.style.opacity = disabled ? '0.5' : '';
  keyField.style.opacity = disabled ? '0.5' : '';
}

function bindDialogs() {
  document.getElementById('new-session-btn').onclick = () => openSessionDialog(null);
  document.getElementById('s-cancel').onclick = () =>
    document.getElementById('session-dialog').classList.add('hidden');

  // Click the dimmed backdrop (not the dialog card itself) to close without
  // saving. Matches the settings-dialog behavior. Nothing is persisted until
  // Save is clicked, so this is always a safe no-op cancel.
  document.getElementById('session-dialog').addEventListener('click', (e) => {
    if (e.target.id === 'session-dialog') {
      document.getElementById('session-dialog').classList.add('hidden');
    }
  });

  // Track when the user actually modifies the password field so we know
  // whether to keep the encrypted saved password or replace it.
  const passField = document.getElementById('s-pass');
  passField.addEventListener('input', () => { editingPasswordDirty = true; });

  // SSH agent toggle: disables password/key fields when checked
  document.getElementById('s-use-agent').addEventListener('change', applyUseAgentDisable);

  // SSH/RDP type toggle — only meaningful for new sessions; openSessionDialog
  // disables these buttons when editing an existing one.
  document.getElementById('s-type-ssh').onclick = () => {
    if (document.getElementById('s-type-ssh').disabled) return;
    setSessionDialogType('ssh');
  };
  document.getElementById('s-type-rdp').onclick = () => {
    if (document.getElementById('s-type-rdp').disabled) return;
    setSessionDialogType('rdp');
  };
  document.getElementById('s-rdp-display-mode').onchange = applyRdpDisplayModeVisibility;

  // RDP: "Clear saved credentials" removes the entry from Windows Credential
  // Manager immediately (not deferred until Save). We ask for confirmation
  // because it's a Windows-level side effect, not just a form field.
  const rdpClearBtn = document.getElementById('s-rdp-pass-clear');
  if (rdpClearBtn) {
    rdpClearBtn.onclick = async (e) => {
      e.preventDefault();
      if (!editingSessionId) return;
      const s = savedSessions.find(x => x.id === editingSessionId);
      if (!s) return;
      if (!confirm(`Remove saved Windows credentials for ${s.host}?`)) return;
      const result = await window.api.rdpDeleteCredentials({ host: s.host });
      if (result && result.ok) {
        s.hasSavedCredentials = false;
        document.getElementById('s-rdp-pass').placeholder = 'saved credentials removed';
        rdpClearBtn.classList.add('hidden');
        await window.api.setSessions(savedSessions);
      } else {
        alert('Could not remove saved credentials: ' + (result && result.error || 'unknown error'));
      }
    };
  }

  // Optional "Clear saved password" button
  const clearBtn = document.getElementById('s-pass-clear');
  let clearRequested = false;
  if (clearBtn) {
    clearBtn.onclick = (e) => {
      e.preventDefault();
      clearRequested = true;
      passField.value = '';
      passField.placeholder = 'saved password will be removed';
      passField.style.borderColor = 'var(--danger)';
      editingPasswordDirty = false;
    };
  }

  // Folder dropdown: when "➕ New folder..." is chosen, swap to an inline
  // text input (no browser prompt(), which is disabled in Electron by default).
  const folderSel = document.getElementById('s-folder');
  const folderNewInput = document.getElementById('s-folder-new');
  folderSel.onchange = (e) => {
    if (e.target.value === '__new__') {
      setCustomSelectVisible('s-folder', false);
      folderNewInput.classList.remove('hidden');
      folderNewInput.value = '';
      setTimeout(() => folderNewInput.focus(), 40);
    }
  };
  const commitNewFolder = () => {
    const name = folderNewInput.value.trim();
    // Always swap back to the dropdown
    folderNewInput.classList.add('hidden');
    setCustomSelectVisible('s-folder', true);
    if (!name) { folderSel.value = ''; refreshCustomSelect('s-folder'); return; }
    // Avoid duplicates
    const existing = [...folderSel.options].find(o => o.value === name);
    if (!existing) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      folderSel.insertBefore(opt, folderSel.querySelector('option[value="__new__"]'));
    }
    folderSel.value = name;
    refreshCustomSelect('s-folder');
  };
  folderNewInput.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitNewFolder(); }
    else if (e.key === 'Escape') { e.preventDefault(); folderNewInput.value = ''; commitNewFolder(); }
  };
  folderNewInput.onblur = () => commitNewFolder();

  document.getElementById('s-save').onclick = async () => {
    // Determine session type. For edits it's fixed (toggle is disabled);
    // for new sessions it's whichever button is currently active.
    const isRdp = document.getElementById('s-type-rdp').classList.contains('active');

    const name = document.getElementById('s-name').value.trim() || 'Untitled';
    const folder = document.getElementById('s-folder').value === '__new__' ? '' : document.getElementById('s-folder').value;
    const host = document.getElementById('s-host').value.trim();
    const port = parseInt(document.getElementById('s-port').value, 10) || (isRdp ? 3389 : 22);
    const username = document.getElementById('s-user').value.trim();
    const tags = document.getElementById('s-tags').value.split(',').map(t => t.trim()).filter(Boolean);

    if (!host) { alert('Host is required'); return; }
    // Username is only strictly required for SSH — RDP allows the user to
    // leave it blank and enter it interactively at the mstsc prompt.
    if (!isRdp && !username) { alert('Username is required for SSH sessions'); return; }

    let data;
    if (isRdp) {
      data = {
        type: 'rdp',
        name, folder, host, port, username, tags,
        domain: document.getElementById('s-rdp-domain').value.trim(),
        gatewayHost: document.getElementById('s-rdp-gateway').value.trim(),
        displayMode: document.getElementById('s-rdp-display-mode').value,
        width: parseInt(document.getElementById('s-rdp-width').value, 10) || 1920,
        height: parseInt(document.getElementById('s-rdp-height').value, 10) || 1080,
        colorDepth: parseInt(document.getElementById('s-rdp-color-depth').value, 10) || 32,
        multiMonitor: document.getElementById('s-rdp-multimon').checked,
        adminSession: document.getElementById('s-rdp-admin').checked,
        restrictedAdmin: document.getElementById('s-rdp-restricted-admin').checked,
        redirectClipboard: document.getElementById('s-rdp-clip').checked,
        redirectDrives: document.getElementById('s-rdp-drives').checked,
        redirectPrinters: document.getElementById('s-rdp-printers').checked,
        redirectAudio: document.getElementById('s-rdp-audio').value,
      };

      // If a password was typed, save it directly to Windows Credential
      // Manager via cmdkey.exe. ShellSync itself never stores the password.
      const rdpPassValue = document.getElementById('s-rdp-pass').value;
      if (rdpPassValue.length > 0) {
        if (!username) {
          alert('Username is required to save credentials to Windows Credential Manager.');
          return;
        }
        const credResult = await window.api.rdpSaveCredentials({
          host: data.host,
          username: data.username,
          domain: data.domain,
          password: rdpPassValue,
        });
        if (!credResult.ok) {
          alert('Could not save credentials to Windows Credential Manager: ' + credResult.error +
            '\n\nThe session will still be saved; you can save credentials again later.');
        } else {
          data.hasSavedCredentials = true;
        }
      }
    } else {
      // SSH — original logic path
      const useAgent = document.getElementById('s-use-agent').checked;
      const passValue = document.getElementById('s-pass').value;
      data = {
        type: 'ssh',
        name, folder, host, port, username, tags,
        keyPath: useAgent ? '' : document.getElementById('s-key').value.trim(),
        useAgent,
      };
      // Password intent: three cases
      //   - user clicked Clear button:   clearPassword: true
      //   - user typed something (dirty): newPassword: <the string>
      //   - user did neither:             no field sent → main keeps existing enc password
      if (clearRequested) {
        data.clearPassword = true;
      } else if (editingPasswordDirty) {
        data.newPassword = passValue;
      } else if (!editingSessionId && passValue.length > 0) {
        // brand-new session — treat any typed password as newPassword
        data.newPassword = passValue;
      }
    }

    let session;
    if (editingSessionId) {
      const idx = savedSessions.findIndex(s => s.id === editingSessionId);
      if (idx >= 0) {
        savedSessions[idx] = { ...savedSessions[idx], ...data };
        if (!isRdp) {
          if (data.clearPassword) savedSessions[idx].hasPassword = false;
          else if (typeof data.newPassword === 'string') savedSessions[idx].hasPassword = data.newPassword.length > 0;
          savedSessions[idx].newPassword = data.newPassword;
          savedSessions[idx].clearPassword = data.clearPassword;
        }
        // Preserve hasSavedCredentials for RDP unless we just wrote new creds
        if (isRdp && data.hasSavedCredentials === undefined) {
          savedSessions[idx].hasSavedCredentials = savedSessions[idx].hasSavedCredentials || false;
        }
        session = savedSessions[idx];
      }
    } else {
      const localCopy = { ...data };
      if (!isRdp) {
        localCopy.hasPassword = typeof data.newPassword === 'string' && data.newPassword.length > 0;
      }
      session = migrateSession(localCopy);
      if (!isRdp) session.newPassword = data.newPassword;
      if (isRdp && data.hasSavedCredentials) session.hasSavedCredentials = true;
      savedSessions.push(session);
    }

    const setResult = await window.api.setSessions(savedSessions);

    // Strip transient SSH intent fields from local copy after save
    savedSessions.forEach(s => { delete s.newPassword; delete s.clearPassword; });

    // Warn if SSH password encryption failed for any session
    if (setResult && setResult.encryptionFailed && setResult.encryptionFailed.length > 0) {
      alert(
        'Could not encrypt password for: ' + setResult.encryptionFailed.join(', ') +
        '\n\nOS encryption (DPAPI) is unavailable. The password was NOT saved.'
      );
    }

    renderSessionTree();
    document.getElementById('session-dialog').classList.add('hidden');
    if (!editingSessionId) openSession(session);
    editingSessionId = null;
    editingPasswordDirty = false;
    clearRequested = false;
    document.getElementById('s-pass').style.borderColor = '';
  };

  document.getElementById('imp-cancel').onclick = () =>
    document.getElementById('import-dialog').classList.add('hidden');
  document.getElementById('imp-ssh-config').onclick = async () => {
    document.getElementById('import-dialog').classList.add('hidden');
    const r = await window.api.importSshConfig();
    if (!r.ok) { alert('Import failed: ' + r.error); return; }
    if (!r.hosts.length) { alert('No usable hosts found (need at least Host + User).'); return; }
    r.hosts.forEach(h => {
      const s = migrateSession({ ...h, folder: 'Imported from ssh_config' });
      savedSessions.push(s);
    });
    await window.api.setSessions(savedSessions);
    renderSessionTree();
    alert(`Imported ${r.hosts.length} sessions.`);
  };
  document.getElementById('imp-json').onclick = async () => {
    document.getElementById('import-dialog').classList.add('hidden');
    const r = await window.api.importSessions();
    if (!r || !r.ok) { if (r && r.error) alert(r.error); return; }
    r.sessions.forEach(x => {
      const s = migrateSession(x); s.id = crypto.randomUUID();
      savedSessions.push(s);
    });
    await window.api.setSessions(savedSessions);
    renderSessionTree();
    alert(`Imported ${r.sessions.length} sessions.`);
  };

  document.getElementById('open-settings-btn').onclick = () =>
    document.getElementById('settings-dialog').classList.remove('hidden');
  document.getElementById('settings-close').onclick = () =>
    document.getElementById('settings-dialog').classList.add('hidden');
  document.getElementById('settings-apply').onclick = () => {
    applyUIToSettings();
    window.api.setSettings(settings);
    applySettingsToAllTerminals();
    document.getElementById('settings-dialog').classList.add('hidden');
  };
  // Click the dimmed backdrop (not the card itself) to close without saving —
  // same as clicking the Close button. Nothing is written to `settings` or
  // persisted until Apply is clicked, so this is always a safe no-op cancel.
  document.getElementById('settings-dialog').addEventListener('click', (e) => {
    if (e.target.id === 'settings-dialog') {
      document.getElementById('settings-dialog').classList.add('hidden');
    }
  });
  // Replace native <select> popups for font family/weight, and the folder
  // pickers, with a themed dropdown — Windows renders native <select> popups
  // in light mode regardless of color-scheme:dark on some systems.
  initCustomSelect('opt-font-family');
  initCustomSelect('opt-font-weight');
  initCustomSelect('s-folder');
  initCustomSelect('mf-select');
  document.querySelectorAll('.presets button').forEach(b => {
    b.onclick = () => {
      const p = PRESETS[b.dataset.preset];
      const cp = (settings.customPresets && settings.customPresets[b.dataset.preset]);
      const chosen = p || cp;
      if (!chosen) return;
      // Read whatever colors are currently in the pickers (which may
      // include unsaved tweaks the user just made) — applyUIToSettings
      // syncs them into settings.theme first, then we overwrite with
      // the preset. This way choosing a preset always feels like a full
      // reset to that preset's palette, not a partial merge with whatever
      // the pickers had.
      settings.theme = { ...settings.theme, ...chosen };
      loadSettingsIntoUI();
    };
  });
  renderCustomPresets();
  document.getElementById('save-preset-btn').onclick = onSavePresetClick;
}

// --- Custom theme presets (v0.18.0) ------------------------------------
// Users can save the current color settings under a name they choose.
// These live in settings.customPresets = { [id]: { name, theme } } and
// render as buttons alongside the built-in presets. Right-click a custom
// preset to delete it. Names are shown; IDs are stable slug-like strings.
function renderCustomPresets() {
  const container = document.getElementById('custom-presets');
  container.innerHTML = '';
  const cps = settings.customPresets || {};
  Object.keys(cps).forEach(id => {
    const entry = cps[id];
    const btn = document.createElement('button');
    btn.dataset.preset = id;
    btn.textContent = entry.name || id;
    btn.title = 'Click to apply · Right-click to delete';
    btn.onclick = () => {
      settings.theme = { ...settings.theme, ...entry.theme };
      loadSettingsIntoUI();
    };
    btn.oncontextmenu = async (e) => {
      e.preventDefault();
      const ok = await window.showConfirmDialog({
        title: 'Delete Preset',
        message: `Delete "${entry.name}"? This can't be undone.`,
        confirmLabel: 'Delete', danger: true,
      });
      if (!ok) return;
      delete settings.customPresets[id];
      window.api.setSettings(settings);
      renderCustomPresets();
    };
    container.appendChild(btn);
  });
}

async function onSavePresetClick() {
  // Grab whatever colors the pickers currently show (which may differ from
  // settings.theme if the user has been tweaking without hitting Apply yet)
  applyUIToSettings();

  const name = await window.showPromptDialog({
    title: 'Save color preset',
    message: 'Give this preset a name.',
    placeholder: 'My theme',
  });
  if (name === null) return; // cancelled
  const trimmed = name.trim();
  if (!trimmed) return;

  // Build a stable ID from the name — kebab-case, ASCII only. Falls back
  // to a random suffix if the slug collides with a built-in or existing.
  let id = 'custom-' + trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id || id === 'custom-') id = 'custom-' + Math.random().toString(36).slice(2, 8);
  if (!settings.customPresets) settings.customPresets = {};
  // If a custom preset with the same slug exists, offer to overwrite
  if (settings.customPresets[id]) {
    const ok = await window.showConfirmDialog({
      title: 'Overwrite preset',
      message: `A preset named "${settings.customPresets[id].name}" already exists. Overwrite it?`,
      confirmLabel: 'Overwrite',
    });
    if (!ok) return;
  }

  // Snapshot the theme (shallow clone is enough — theme values are strings)
  settings.customPresets[id] = { name: trimmed, theme: { ...settings.theme } };
  window.api.setSettings(settings);
  renderCustomPresets();
  showToast(`Saved preset "${trimmed}"`);
}

function loadSettingsIntoUI() {
  document.getElementById('opt-font-family').value = settings.fontFamily;
  document.getElementById('opt-font-size').value = settings.fontSize;
  document.getElementById('opt-line-height').value = settings.lineHeight;
  document.getElementById('opt-font-weight').value = settings.fontWeight;
  refreshCustomSelect('opt-font-family');
  refreshCustomSelect('opt-font-weight');
  document.getElementById('opt-copy-on-select').checked = !!settings.copyOnSelect;
  document.getElementById('opt-paste-on-right-click').checked = !!settings.pasteOnRightClick;
  // v0.19.1: auto-lock timeout
  const autoLockField = document.getElementById('opt-autolock');
  if (autoLockField) autoLockField.value = Number(settings.autoLockMinutes) || 0;
  const t = settings.theme;
  document.getElementById('c-background').value = t.background;
  document.getElementById('c-foreground').value = t.foreground;
  document.getElementById('c-cursor').value = t.cursor;
  document.getElementById('c-selection').value = t.selectionBackground;
  ['black','red','green','yellow','blue','magenta','cyan','white'].forEach(k =>
    document.getElementById('c-' + k).value = t[k]);
}
function applyUIToSettings() {
  settings.fontFamily = document.getElementById('opt-font-family').value;
  settings.fontSize = parseInt(document.getElementById('opt-font-size').value, 10);
  settings.lineHeight = parseFloat(document.getElementById('opt-line-height').value);
  settings.fontWeight = document.getElementById('opt-font-weight').value;
  settings.copyOnSelect = document.getElementById('opt-copy-on-select').checked;
  settings.pasteOnRightClick = document.getElementById('opt-paste-on-right-click').checked;
  // v0.19.1: auto-lock timeout. Clamp to a sane range (0 to 999 minutes ≈ 16 hours).
  // Value 0 = never lock. Anything negative or non-numeric silently becomes 0.
  const autoLockField = document.getElementById('opt-autolock');
  if (autoLockField) {
    let mins = parseInt(autoLockField.value, 10);
    if (!isFinite(mins) || mins < 0) mins = 0;
    if (mins > 999) mins = 999;
    settings.autoLockMinutes = mins;
    // Re-arm the timer immediately so the new value takes effect without a restart
    refreshAutoLockAfterSettingChange();
  }
  const t = settings.theme;
  t.background = document.getElementById('c-background').value;
  t.foreground = document.getElementById('c-foreground').value;
  t.cursor = document.getElementById('c-cursor').value;
  t.selectionBackground = document.getElementById('c-selection').value;
  ['black','red','green','yellow','blue','magenta','cyan','white'].forEach(k =>
    t[k] = document.getElementById('c-' + k).value);
}

// --- Search bar ----------------------------------------------------------
function bindSearchBar() {
  const input = document.getElementById('search-input');
  const doSearch = (dir) => {
    const t = tabs.get(activeTabId);
    if (!t || !t.searchAddon) return;
    const opts = {
      caseSensitive: document.getElementById('search-case').checked,
      regex: document.getElementById('search-regex').checked,
    };
    if (dir === 'next') t.searchAddon.findNext(input.value, opts);
    else t.searchAddon.findPrevious(input.value, opts);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(e.shiftKey ? 'prev' : 'next'); }
    else if (e.key === 'Escape') { hideSearchBar(); }
  };
  document.getElementById('search-next').onclick = () => doSearch('next');
  document.getElementById('search-prev').onclick = () => doSearch('prev');
  document.getElementById('search-close').onclick = () => hideSearchBar();
}
function showSearchBar() {
  document.getElementById('search-bar').classList.remove('hidden');
  document.getElementById('search-input').focus();
  document.getElementById('search-input').select();
}
function hideSearchBar() {
  document.getElementById('search-bar').classList.add('hidden');
  const t = tabs.get(activeTabId);
  if (t) t.term.focus();
}

// --- Global keyboard shortcuts ------------------------------------------
function bindGlobalShortcuts() {
  window.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const inDialog = el && el.closest && el.closest('.dialog:not(.hidden)');
    if (inDialog) return;
    const inSidebarFilter = el && el.id === 'session-filter';
    const inFilePanel = el && el.closest && el.closest('#file-panel');
    const inSearchBar = el && el.closest && el.closest('#search-bar');

    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); showSearchBar(); return; }
      if (e.key === 'Tab') { e.preventDefault(); cycleTab(1); return; }
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault(); if (activeTabId) closeTab(activeTabId); return;
      }
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault(); setFilePanelVisible(!settings.filePanelVisible); return;
      }
      if (inSidebarFilter || inFilePanel || inSearchBar) return;
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); openSessionDialog(null); return; }
      if (e.key === 'd' || e.key === 'D') { e.preventDefault(); duplicateTab(activeTabId); return; }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); bumpGlobalFontSize(1); return; }
      if (e.key === '-') { e.preventDefault(); bumpGlobalFontSize(-1); return; }
      if (e.key === '0') {
        e.preventDefault(); settings.fontSize = 14; window.api.setSettings(settings);
        loadSettingsIntoUI(); applySettingsToAllTerminals(); return;
      }
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
      e.preventDefault(); cycleTab(-1); return;
    }
  });
}

function cycleTab(dir) {
  const ids = [...tabs.keys()];
  if (ids.length === 0) return;
  const idx = ids.indexOf(activeTabId);
  const next = ids[(idx + dir + ids.length) % ids.length];
  setActiveTab(next);
}
function bumpGlobalFontSize(delta) {
  settings.fontSize = Math.max(8, Math.min(48, settings.fontSize + delta));
  window.api.setSettings(settings);
  loadSettingsIntoUI();
  applySettingsToAllTerminals();
}
function duplicateTab(tabId) {
  const t = tabs.get(tabId); if (!t) return;
  openSession(t.session, { forceDuplicate: true });
}

// --- Sessions / tabs ----------------------------------------------------
function openSession(session, opts = {}) {
  // RDP sessions delegate to mstsc.exe — no ShellSync tab is created,
  // because the RDP UI is Microsoft's native window. See openRdpSession.
  if (session.type === 'rdp') {
    openRdpSession(session);
    return;
  }

  // If this session already has an open tab, switch to it instead of creating
  // a duplicate. Bypassed when the caller explicitly wants a duplicate (e.g.
  // "Duplicate tab" menu item or Ctrl+D shortcut), so those actually create
  // a second live tab instead of just switching to the one you're already on.
  if (!opts.forceDuplicate) {
    for (const [existingTabId, entry] of tabs) {
      if (entry.session && entry.session.id === session.id) {
        setActiveTab(existingTabId);
        showToast(`Switched to existing tab: ${session.name}`);
        return;
      }
    }
  }

  session.lastConnected = Date.now();
  window.api.setSessions(savedSessions);

  const tabId = 'tab-' + (++tabCounter);
  const sessionId = 'ssh-' + tabId;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = `
    <span class="tab-icon">${window.icon('server', 14)}</span>
    <span class="tname">${escapeHtml(session.name)}</span>
    <span class="close">${window.icon('x', 14)}</span>
  `;
  tabEl.querySelector('.tname').onclick = () => setActiveTab(tabId);
  tabEl.querySelector('.close').onclick = (e) => { e.stopPropagation(); closeTab(tabId); };
  tabEl.oncontextmenu = (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Duplicate tab', icon: 'copy', onClick: () => duplicateTab(tabId) },
      { label: 'Reconnect', icon: 'rotate-cw', onClick: () => reconnectTab(tabId) },
      { sep: true },
      { label: 'Close tab', icon: 'x', onClick: () => closeTab(tabId) },
    ]);
  };
  document.getElementById('tab-bar').appendChild(tabEl);

  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  const paneTerm = document.createElement('div'); paneTerm.className = 'pane-term';
  workspace.appendChild(paneTerm);
  document.getElementById('workspaces').appendChild(workspace);

  // CRITICAL: make workspace visible BEFORE opening the terminal so xterm.js can measure
  // its container correctly. If we open into a display:none container, xterm gets 0x0
  // dimensions and never recovers — the "black screen on 2nd session" bug.
  for (const [_id, t] of tabs) {
    t.workspace.classList.remove('active');
    t.tabEl.classList.remove('active');
  }
  workspace.classList.add('active');
  tabEl.classList.add('active');

  const term = new Terminal({
    fontFamily: settings.fontFamily, fontSize: settings.fontSize,
    lineHeight: settings.lineHeight, fontWeight: settings.fontWeight,
    theme: settings.theme, cursorBlink: true, scrollback: 5000,
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  const searchAddon = new SearchAddon();
  term.loadAddon(fit); term.loadAddon(new WebLinksAddon()); term.loadAddon(searchAddon);
  term.open(paneTerm);
  // Now that the container is visible AND opened, fit it and force a repaint
  requestAnimationFrame(() => {
    try {
      fit.fit();
      if (term.rows > 0) term.refresh(0, term.rows - 1);
      console.log('[ShellSync] New tab created:', tabId, '| cols:', term.cols, '| rows:', term.rows);
    } catch (err) { console.error('[ShellSync] Initial fit/refresh failed:', err); }
  });

  const cleanup = [];
  const entry = {
    term, fit, searchAddon, workspace, tabEl, sessionId, cleanup,
    paneTerm, sftpReady: false, session,
    localFontSize: settings.fontSize, connected: false,
  };
  tabs.set(tabId, entry);

  attachTerminalUX(entry, paneTerm);
  setActiveTab(tabId);
  connectTab(entry, session);
}

function attachTerminalUX(entry, container) {
  // Clicking anywhere on the terminal container should focus the terminal.
  // xterm normally handles this, but if focus was stolen by a hidden overlay,
  // an explicit .focus() ensures it comes back.
  container.addEventListener('mousedown', () => {
    try { entry.term.focus(); } catch {}
  });
  entry.term.onSelectionChange(() => {
    if (!settings.copyOnSelect) return;
    const sel = entry.term.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(()=>{});
  });

  // Intercept Ctrl+V / Cmd+V paste at the DOM level, BEFORE xterm's own
  // paste handler runs, so we can route multi-line pastes through the
  // confirm dialog. Using capture phase + preventDefault + stopPropagation
  // stops xterm from also sending the paste on its own.
  //
  // xterm's <textarea>-based helper is where paste events actually land, so
  // we attach at the container and use capture to beat xterm to it.
  container.addEventListener('paste', async (e) => {
    if (!e.clipboardData) return;
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    await sendPasteToShell(entry, text);
  }, true); // capture = true

  container.addEventListener('contextmenu', async (e) => {
    if (!settings.pasteOnRightClick) return;
    e.preventDefault();
    const sel = entry.term.getSelection();
    if (sel) {
      await navigator.clipboard.writeText(sel).catch(()=>{});
      entry.term.clearSelection();
    } else {
      try {
        const text = await navigator.clipboard.readText();
        if (text) await sendPasteToShell(entry, text);
      } catch {}
    }
  });
  container.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    entry.localFontSize = Math.max(8, Math.min(48,
      entry.localFontSize + (e.deltaY < 0 ? 1 : -1)));
    entry.term.options.fontSize = entry.localFontSize;
    refitTerminal(entry);
  }, { passive: false });
}

// v0.19.4: fit the terminal reliably after a size or font change.
// Prior versions did a single requestAnimationFrame → fit(). That worked
// most of the time, but xterm sometimes needs TWO paint cycles to fully
// stabilize character-cell metrics after a font-size change, especially
// at larger fonts where fractional-pixel drift is bigger. Result: the
// last visible row would clip because FitAddon computed rows with stale
// metrics.
//
// Solution: fit once immediately for the fast path, then fit AGAIN after
// a short delay to catch the case where character metrics were still
// settling. The second fit is a no-op if nothing has changed.
function refitTerminal(entry) {
  if (!entry || !entry.fit || !entry.term) return;
  const doFit = () => {
    try {
      entry.fit.fit();
      window.api.sshResize(entry.sessionId, entry.term.cols, entry.term.rows);
    } catch (err) {
      console.warn('[ShellSync] fit failed:', err);
    }
  };
  requestAnimationFrame(doFit);
  // Second pass ~50ms later — enough time for xterm to have fully remeasured
  // the new character cell size at the new font, even on slower machines.
  setTimeout(doFit, 50);
}

// --- Smart paste engine (v0.17.1) --------------------------------------
// Pasting multiple lines into an SSH shell has two failure modes if you
// just dump the bytes:
//   1. If any line takes a while to run, the next line gets typed into
//      the running command as stdin instead of running as its own shell
//      command. (v0.16.2's simple passthrough had this problem.)
//   2. If any line is `sudo something` and sudo prompts for a password,
//      the next pasted line is consumed as the password attempt.
//
// This engine fixes both by driving the paste from what the shell is
// actually doing, not from a fixed timer:
//
//   * We learn the user's shell prompt from what appears on screen.
//     Everything before the first user keystroke that ends in "$ " or
//     "# " (once the connection is idle) is captured as the prompt
//     signature. Subsequent pastes wait for that exact signature to
//     reappear before sending the next line — that's how we know the
//     shell is ready, however long the previous command took.
//
//   * When a password/passphrase prompt appears mid-paste, we pause
//     entirely, show a banner, and wait for the shell prompt to return
//     (which only happens after the user's own password + Enter).
//     Then we resume sending queued lines.
//
// Single-line pastes always go straight through — no dialog, no engine.
// Multi-line pastes always show the confirm dialog first (matching
// SolarPuTTY's "confirm multi-line paste" behavior); the engine only
// kicks in AFTER the user clicks Paste in that dialog.

const PROMPT_TAIL_RE = /(?:^|\n)[^\n]*[$#]\s*$/;         // fallback: any line ending "$ " or "# "
const PASSWORD_PROMPT_RE = /(?:^|\n)[^\n]*\b(password|passphrase)\b[^:\n]{0,60}:\s*$/i;
const PASTE_STEP_TIMEOUT_MS = 30000;   // give up on a step after 30s of no prompt return
const RESUME_DELAY_MS = 100;           // small buffer after prompt/password before next send

// ANSI-strip: paste engine matches against plain-text content, not the
// raw escape sequences bash sends for cursor/color/etc.
function stripAnsi(str) {
  return String(str)
    .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, '')
    .replace(/\x1B[=>]/g, '');
}

// Called from onSshData for every chunk of remote output. Two jobs:
//   1. If we haven't learned this session's prompt yet, opportunistically
//      capture it once the output settles on a line ending in "$ " or "# ".
//   2. If a paste is in flight, append to its output buffer and check
//      whether the shell is ready (or a password prompt appeared) so the
//      engine can advance.
function observeSshOutput(entry, chunk) {
  entry.recentOutput = (entry.recentOutput || '') + chunk;
  // Keep only the last ~4KB so the buffer doesn't grow forever on long-lived tabs
  if (entry.recentOutput.length > 4096) {
    entry.recentOutput = entry.recentOutput.slice(-4096);
  }

  // Prompt learning — only until we have one
  if (!entry.promptSignature) {
    const clean = stripAnsi(entry.recentOutput).replace(/\r/g, '');
    // Look for the last non-empty line ending in "$ " or "# "
    const lines = clean.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (/[$#]\s*$/.test(l) && l.trim().length > 1) {
        entry.promptSignature = l;
        console.log('[ShellSync] Learned prompt for tab:', JSON.stringify(l));
        break;
      }
    }
  }

  // Drive the paste engine forward if one is in flight
  if (entry.pasteState) advancePaste(entry);
}

// Check the recent output to decide what the paste engine should do next.
function advancePaste(entry) {
  const ps = entry.pasteState;
  if (!ps) return;
  const clean = stripAnsi(entry.recentOutput).replace(/\r/g, '');
  const tail = clean.slice(-500); // only need the recent tail

  // Password prompt? Pause and let the user type.
  if (PASSWORD_PROMPT_RE.test(tail)) {
    if (!ps.pausedForPassword) {
      ps.pausedForPassword = true;
      const remaining = ps.lines.length - ps.index;
      updatePasteBanner(entry,
        `Paused — enter password, then press Enter. ${remaining} line${remaining === 1 ? '' : 's'} left.`,
        true);
    }
    return;
  }

  // Was paused, but the shell prompt is back? Great — resume.
  const promptBack = ps.pausedForPassword
    ? isShellReady(entry, tail)
    : isShellReady(entry, tail);

  if (promptBack) {
    ps.pausedForPassword = false;
    // Reset the output buffer so the next line's readiness check starts fresh
    entry.recentOutput = '';
    clearTimeout(ps.timeoutHandle);
    setTimeout(() => sendNextPasteLine(entry), RESUME_DELAY_MS);
  }
}

// Is the shell ready for a new command? Prefer the learned prompt signature
// (very reliable). Fall back to the generic "$ " / "# " regex.
function isShellReady(entry, tailText) {
  if (entry.promptSignature) {
    // Prompt signatures often contain the CWD, which changes as commands run.
    // Match on a suffix — the "user@host:...$ " part is stable enough.
    const sig = entry.promptSignature;
    // Try exact match first
    if (tailText.endsWith(sig)) return true;
    // Then try matching by the user@host prefix + terminal "$ " or "# "
    const userHostMatch = sig.match(/^([^\s:]+@[^\s:]+)/);
    if (userHostMatch) {
      const uh = userHostMatch[1];
      const re = new RegExp(`${uh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*[$#]\\s*$`);
      if (re.test(tailText)) return true;
    }
  }
  // Fallback: generic prompt regex
  return PROMPT_TAIL_RE.test(tailText);
}

function sendNextPasteLine(entry) {
  const ps = entry.pasteState;
  if (!ps) return;

  if (ps.index >= ps.lines.length) {
    // Done! Clean up.
    entry.pasteState = null;
    hidePasteBanner(entry);
    return;
  }

  const line = ps.lines[ps.index];
  const isLastLine = ps.index === ps.lines.length - 1;
  ps.index++;

  if (isLastLine) {
    // Last line — send WITHOUT the trailing \r so the user reviews and
    // presses Enter themselves. Matches SolarPuTTY behavior exactly.
    window.api.sshWrite(entry.sessionId, line);
    entry.pasteState = null;
    hidePasteBanner(entry);
    return;
  }

  // Non-last line — send with \r so it executes, then wait for the shell
  // to be ready before sending the next one.
  entry.recentOutput = '';
  window.api.sshWrite(entry.sessionId, line + '\r');
  updatePasteBanner(entry,
    `Sending line ${ps.index}/${ps.lines.length}: ${line.slice(0, 60)}${line.length > 60 ? '…' : ''}`,
    false);

  // Timeout guard — if the prompt never comes back (long-running command
  // that also produces no visible completion, weird shell, etc.), let the
  // user manually resume or cancel.
  clearTimeout(ps.timeoutHandle);
  ps.timeoutHandle = setTimeout(() => {
    if (!entry.pasteState) return;
    updatePasteBanner(entry,
      `Still waiting for the shell prompt (line ${ps.index}/${ps.lines.length}). Click Cancel to stop, or press Enter in the terminal to try resuming.`,
      true);
  }, PASTE_STEP_TIMEOUT_MS);
}

function cancelSmartPaste(entry) {
  if (!entry.pasteState) return;
  clearTimeout(entry.pasteState.timeoutHandle);
  entry.pasteState = null;
  hidePasteBanner(entry);
}

// --- Paste status banner (shown while multi-line paste is in flight) ---
function updatePasteBanner(entry, msg, showCancelBtn) {
  let banner = entry.workspace.querySelector('.paste-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'paste-banner';
    const iconHtml = window.icon ? `<span class="icon-wrap">${window.icon('clipboard', 16)}</span>` : '';
    banner.innerHTML = `${iconHtml}<span class="msg"></span>`;
    const btn = document.createElement('button');
    btn.textContent = 'Cancel';
    btn.onclick = () => cancelSmartPaste(entry);
    banner.appendChild(btn);
    entry.workspace.appendChild(banner);
  }
  banner.querySelector('.msg').textContent = msg;
  const btn = banner.querySelector('button');
  if (btn) btn.style.display = showCancelBtn ? '' : '';  // always visible; showCancelBtn kept for future use
}
function hidePasteBanner(entry) {
  const banner = entry.workspace.querySelector('.paste-banner');
  if (banner) banner.remove();
}

// Central paste router. Called from both Ctrl+V (DOM paste event) and
// right-click paste. Single-line pastes go straight through. Multi-line
// pastes show the preview dialog, then feed the smart engine.
async function sendPasteToShell(entry, text) {
  if (!text) return;
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trimmed = normalized.replace(/\n+$/, '');
  const lineCount = trimmed.split('\n').filter(l => l.length > 0 || true).length;

  if (lineCount <= 1) {
    // Single line — send as-is; no engine needed.
    window.api.sshWrite(entry.sessionId, normalized);
    return;
  }

  // Multi-line — preview first.
  const sessionName = entry.session && entry.session.name;
  const finalText = await window.showPasteConfirmDialog({
    text: trimmed,
    lineCount,
    sessionName,
  });
  if (finalText === null) return; // user cancelled

  // Kick off the smart engine.
  const lines = finalText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // Drop trailing empty lines from the paste, but keep interior blank lines
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return;

  if (lines.length === 1) {
    // Preview only had one line after all — send directly.
    window.api.sshWrite(entry.sessionId, lines[0]);
    return;
  }

  // Cancel any paste already in flight on this tab (rare, but be safe)
  cancelSmartPaste(entry);

  entry.pasteState = {
    lines,
    index: 0,
    pausedForPassword: false,
    timeoutHandle: null,
  };
  entry.recentOutput = ''; // fresh slate for prompt detection

  updatePasteBanner(entry, `Preparing paste... (${lines.length} lines)`, true);
  sendNextPasteLine(entry);
}

function connectTab(entry, session) {
  const { term, fit, sessionId, cleanup } = entry;
  entry.connected = false;
  entry.tabEl.classList.add('disconnected');
  const oldBanner = entry.workspace.querySelector('.reconnect-banner');
  if (oldBanner) oldBanner.remove();

  term.writeln(`\r\n\x1b[36mConnecting to ${session.username}@${session.host}:${session.port}...\x1b[0m\r\n`);
  fit.fit();

  window.api.sshConnect({
    sessionId, savedSessionId: session.id,
    host: session.host, port: session.port,
    username: session.username,
    keyPath: session.keyPath || null,
    cols: term.cols, rows: term.rows,
  }).then(res => {
    if (!res.ok) {
      term.writeln(`\r\n\x1b[31mConnection failed: ${res.error}\x1b[0m`);
      showReconnectBanner(entry, `Connection failed: ${res.error}`);
      updateConnectionStatus();
      renderSessionTree();
      return;
    }
    entry.connected = true;
    entry.tabEl.classList.remove('disconnected');
    updateConnectionStatus();
    renderSessionTree();

    cleanup.push(window.api.onSshData(sessionId, (d) => {
      term.write(d);
      // Feed incoming data to the paste engine and prompt learner. Both
      // are no-ops when nothing's in flight — cheap to always call.
      observeSshOutput(entry, d);
    }));
    cleanup.push(window.api.onSshClose(sessionId, () => {
      term.writeln('\r\n\x1b[33m*** Connection closed ***\x1b[0m');
      entry.connected = false;
      entry.tabEl.classList.add('disconnected');
      cancelSmartPaste(entry);
      updateConnectionStatus();
      renderSessionTree();
      showReconnectBanner(entry, 'Connection closed');
      if (activeTabId === getTabIdFor(entry)) stopStatsPolling();
    }));
    cleanup.push(window.api.onSftpReady(sessionId, () => {
      entry.sftpReady = true;
      if (activeTabId === getTabIdFor(entry)) {
        attachFileBrowserToActive();
        startStatsPolling();
      }
    }));
    cleanup.push(window.api.onSftpError(sessionId, (msg) => setTransferStatus('SFTP error: ' + msg)));
    cleanup.push(window.api.onSftpProgress(sessionId, (p) => {
      const pct = p.total ? Math.floor(p.sent / p.total * 100) : 0;
      const dir = p.direction === 'up' ? '↑' : '↓';
      setTransferStatus(`${dir} ${p.name}`, pct);
    }));
    // xterm's onData/onResize are additive — each call to onData attaches
    // ANOTHER listener alongside any previous ones, and returns a disposable
    // to remove it. reconnectTab flushes `cleanup` and calls connectTab
    // again on the same terminal instance, so if we don't push these
    // disposables into cleanup, reconnecting stacks a second onData handler
    // and every subsequent keystroke gets sent to the SSH stream twice.
    // After two reconnects: three times. And so on. That was the "typing
    // duplicates every character" bug — bash saw each keystroke N times.
    const dataSub = term.onData(d => {
      window.api.sshWrite(sessionId, d);
    });
    cleanup.push(() => dataSub.dispose());
    const resizeSub = term.onResize(({ cols, rows }) => window.api.sshResize(sessionId, cols, rows));
    cleanup.push(() => resizeSub.dispose());
  });
}

function setTransferStatus(text, percent) {
  const el = document.getElementById('transfer-status');
  if (!text) { el.innerHTML = ''; return; }
  const bar = percent != null
    ? `<div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div><span>${percent}%</span>`
    : '';
  el.innerHTML = `<span>${escapeHtml(text)}</span>${bar}`;
}

function showReconnectBanner(entry, msg) {
  if (entry.workspace.querySelector('.reconnect-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'reconnect-banner';
  banner.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  const btn = document.createElement('button');
  btn.innerHTML = `${window.icon('rotate-cw', 14)} Reconnect`;
  btn.onclick = () => { banner.remove(); reconnectTab(getTabIdFor(entry)); };
  banner.appendChild(btn);
  entry.workspace.appendChild(banner);
}


function getTabIdFor(entry) {
  for (const [id, t] of tabs) if (t === entry) return id;
  return null;
}

// Launches an RDP session via the main process, which spawns mstsc.exe.
// There's no tab, no xterm — mstsc opens its own native Windows window,
// which is what admins expect and what security teams approve of.
async function openRdpSession(session) {
  session.lastConnected = Date.now();
  await window.api.setSessions(savedSessions);
  renderSessionTree();
  showToast(`Launching RDP to ${session.name}...`);
  const result = await window.api.rdpLaunch(session);
  if (!result || !result.ok) {
    alert(`Failed to launch RDP session: ${result && result.error || 'unknown error'}`);
  }
}

function reconnectTab(tabId) {
  const t = tabs.get(tabId); if (!t) return;
  t.cleanup.forEach(fn => fn && fn());
  t.cleanup = [];
  window.api.sshDisconnect(t.sessionId);
  cancelSmartPaste(t);
  t.sftpReady = false;
  t.promptSignature = null; // re-learn prompt on reconnect
  t.recentOutput = '';
  connectTab(t, t.session);
}

// Attach the shared file browser to the currently-active tab
let fileBrowserGeneration = 0; // guards against overlapping async attach calls racing each other

async function attachFileBrowserToActive() {
  const body = document.getElementById('file-panel-body');
  const t = tabs.get(activeTabId);
  const myGeneration = ++fileBrowserGeneration;

  if (!t) {
    body.innerHTML = '<div class="fp-empty">Connect to a session to browse files.</div>';
    if (sharedFileBrowser) { sharedFileBrowser.dispose(); sharedFileBrowser = null; }
    return;
  }
  if (!t.sftpReady) {
    body.innerHTML = '<div class="fp-empty">Establishing SFTP channel...</div>';
    if (sharedFileBrowser) { sharedFileBrowser.dispose(); sharedFileBrowser = null; }
    return;
  }
  // Rebuild for the new tab
  if (sharedFileBrowser) { sharedFileBrowser.dispose(); sharedFileBrowser = null; }
  body.innerHTML = '';
  // createFileBrowser is async — MUST await it before storing/using the result,
  // otherwise sharedFileBrowser ends up holding a Promise instead of the
  // { refresh, dispose } object, and any later call to .dispose() throws
  // "sharedFileBrowser.dispose is not a function". That thrown error was
  // aborting the rest of setActiveTab() mid-execution, which is why stats,
  // files, and terminal focus all stopped updating for the 2nd/3rd tab.
  try {
    const browser = await window.createFileBrowser(t.sessionId, body,
      (msg, pct) => setTransferStatus(msg, pct));
    // If the user switched tabs again while this was loading, discard the
    // stale result instead of overwriting whatever the newer call set up.
    if (myGeneration !== fileBrowserGeneration) {
      if (browser && browser.dispose) browser.dispose();
      return;
    }
    sharedFileBrowser = browser;
  } catch (err) {
    console.error('[ShellSync] createFileBrowser failed:', err);
    body.innerHTML = '<div class="fp-empty">Failed to load file browser.</div>';
  }
}

function setActiveTab(tabId) {
  activeTabId = tabId;
  hideSearchBar();
  for (const [id, t] of tabs) {
    const active = id === tabId;
    t.tabEl.classList.toggle('active', active);
    t.workspace.classList.toggle('active', active);
    if (active) {
      // Defer to next frame so xterm remeasures after the container becomes visible
      requestAnimationFrame(() => {
        try {
          t.fit.fit();
          if (t.connected) window.api.sshResize(t.sessionId, t.term.cols, t.term.rows);
          // Force a full repaint. fit() alone can recompute correct cols/rows
          // without actually redrawing the buffer on screen after a terminal
          // was hidden (display:none) while data streamed in — this is a
          // known xterm.js gotcha. refresh() forces every row to redraw.
          if (t.term.rows > 0) t.term.refresh(0, t.term.rows - 1);
          t.term.focus();
          console.log('[ShellSync] Tab activated:', tabId, '| cols:', t.term.cols, '| rows:', t.term.rows);
        } catch (err) { console.error('[ShellSync] setActiveTab refit/refresh failed:', err); }
      });
    }
  }
  attachFileBrowserToActive();
  const t = tabs.get(tabId);
  if (t && t.connected) startStatsPolling();
  else stopStatsPolling();
  updateConnectionStatus();
  renderSessionTree();
}

function closeTab(tabId) {
  const t = tabs.get(tabId); if (!t) return;
  // Cancel any in-flight multi-line paste first — otherwise its 30s timeout
  // holds a reference to the (about-to-be-detached) workspace and entry,
  // leaking that memory for half a minute per orphaned paste.
  cancelSmartPaste(t);
  t.cleanup.forEach(fn => fn && fn());
  window.api.sshDisconnect(t.sessionId);
  t.term.dispose();
  t.workspace.remove();
  t.tabEl.remove();
  tabs.delete(tabId);
  renderSessionTree();
  if (activeTabId === tabId) {
    const next = tabs.keys().next().value;
    if (next) setActiveTab(next);
    else {
      activeTabId = null;
      attachFileBrowserToActive();
      stopStatsPolling();
      document.getElementById('stats-panel').classList.add('hidden');
      updateConnectionStatus();
    }
  }
}

function applySettingsToAllTerminals() {
  for (const t of tabs.values()) {
    t.term.options.fontFamily = settings.fontFamily;
    t.term.options.fontSize = settings.fontSize;
    t.term.options.lineHeight = settings.lineHeight;
    t.term.options.fontWeight = settings.fontWeight;
    t.term.options.theme = settings.theme;
    t.localFontSize = settings.fontSize;
    // v0.19.4: use the shared refit helper so the last row doesn't clip
    // after a font-size change. See refitTerminal() for why we fit twice.
    refitTerminal(t);
  }
}

function updateConnectionStatus() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const t = tabs.get(activeTabId);
  if (!t) {
    dot.className = 'status-dot';
    text.textContent = 'No session';
  } else if (t.connected) {
    dot.className = 'status-dot connected';
    text.textContent = `${t.session.username}@${t.session.host}`;
  } else {
    dot.className = 'status-dot disconnected';
    text.textContent = `${t.session.name} — disconnected`;
  }
}

// --- Migration dialog (v0.9 upgrade) ------------------------------------
function bindMigrationDialog() {
  document.getElementById('mig-later').onclick = () =>
    document.getElementById('migration-dialog').classList.add('hidden');
  document.getElementById('mig-upgrade').onclick = async () => {
    const btn = document.getElementById('mig-upgrade');
    btn.disabled = true;
    btn.textContent = 'Encrypting...';
    const r = await window.api.migrationRun();
    if (!r || !r.ok) {
      alert('Migration failed: ' + (r && r.error ? r.error : 'unknown error'));
      btn.disabled = false;
      btn.innerHTML = window.icon('key', 14) + ' Encrypt Now';
      return;
    }
    // Reload sessions from the (now-encrypted) store
    savedSessions = ((await window.api.getSessions()) || []).map(migrateSession);
    renderSessionTree();
    document.getElementById('migration-dialog').classList.add('hidden');
    setTimeout(() => alert(
      `✓ ${savedSessions.length} sessions encrypted.\n\n` +
      `A backup of the old file was saved to:\n${r.backupPath}\n\n` +
      `You can delete that backup once you're sure everything works.`
    ), 200);
  };
}

function showMigrationDialog(status) {
  const dlg = document.getElementById('migration-dialog');
  document.getElementById('mig-plain-count').textContent = status.plainCount;
  const upgradeBtn = document.getElementById('mig-upgrade');
  if (!status.encryptionAvailable) {
    document.getElementById('mig-warn').classList.remove('hidden');
    upgradeBtn.disabled = true;
    upgradeBtn.title = 'OS encryption (DPAPI) is not available on this system.';
  }
  dlg.classList.remove('hidden');
}

// --- Host key verification prompts (TOFU / mismatch) --------------------
function bindHostVerify() {
  window.api.onHostVerifyPrompt((data) => {
    if (data.isMismatch) showMismatchDialog(data);
    else showTofuDialog(data);
  });

  // TOFU buttons
  document.getElementById('tofu-cancel').onclick = () => resolveHostVerify(false, false);
  document.getElementById('tofu-trust-once').onclick = () => resolveHostVerify(true, false);
  document.getElementById('tofu-trust').onclick = () => resolveHostVerify(true, true);

  // Mismatch buttons (require typing "yes" to enable Override)
  const mmConfirm = document.getElementById('mm-confirm');
  const mmOverride = document.getElementById('mm-override');
  mmConfirm.oninput = () => {
    mmOverride.disabled = mmConfirm.value.trim().toLowerCase() !== 'yes';
  };
  document.getElementById('mm-cancel').onclick = () => resolveHostVerify(false, false);
  mmOverride.onclick = () => {
    if (mmOverride.disabled) return;
    resolveHostVerify(true, true); // replace the trusted key
  };
}

let pendingPromptId = null;

function showTofuDialog(data) {
  pendingPromptId = data.promptId;
  document.getElementById('tofu-host').textContent = `${data.host}:${data.port}`;
  document.getElementById('tofu-keytype').textContent = data.keyType;
  document.getElementById('tofu-fp').textContent = data.fingerprint;
  document.getElementById('tofu-dialog').classList.remove('hidden');
}

function showMismatchDialog(data) {
  pendingPromptId = data.promptId;
  document.getElementById('mm-host').textContent = `${data.host}:${data.port}`;
  document.getElementById('mm-old-fp').textContent = data.existingFingerprint;
  document.getElementById('mm-old-date').textContent = data.existingFirstSeen
    ? new Date(data.existingFirstSeen).toLocaleString() : '(unknown)';
  document.getElementById('mm-new-fp').textContent = data.fingerprint;
  document.getElementById('mm-new-type').textContent = data.keyType;
  document.getElementById('mm-confirm').value = '';
  document.getElementById('mm-override').disabled = true;
  document.getElementById('mismatch-dialog').classList.remove('hidden');
}

function resolveHostVerify(accept, remember) {
  if (!pendingPromptId) return;
  window.api.hostVerifyRespond(pendingPromptId, accept, remember);
  pendingPromptId = null;
  document.getElementById('tofu-dialog').classList.add('hidden');
  document.getElementById('mismatch-dialog').classList.add('hidden');
}

// --- Known Hosts manager (in Settings) ----------------------------------
function bindKnownHostsUi() {
  // Refresh list every time the Settings dialog opens
  const settingsBtn = document.getElementById('open-settings-btn');
  const originalOnClick = settingsBtn.onclick;
  settingsBtn.onclick = (e) => {
    if (originalOnClick) originalOnClick(e);
    refreshKnownHostsList();
  };

  document.getElementById('kh-import-btn').onclick = async () => {
    const r = await window.api.knownHostsImportOpenSsh();
    if (!r.ok) { alert('Import failed: ' + (r.error || 'unknown')); return; }
    showToast(r.imported > 0
      ? `Imported ${r.imported} host key${r.imported === 1 ? '' : 's'}`
      : 'No new hosts to import (all already trusted or file is empty)');
    refreshKnownHostsList();
  };
  document.getElementById('kh-remove-all').onclick = async () => {
    const ok = await window.showConfirmDialog({
      title: 'Remove All Trusted Hosts',
      message: 'You will be re-prompted to verify the host key the next time you connect to each server.',
      confirmLabel: 'Remove All', danger: true,
    });
    if (!ok) return;
    const r = await window.api.knownHostsRemoveAll();
    showToast(`Removed ${r.removed} host key${r.removed === 1 ? '' : 's'}`);
    refreshKnownHostsList();
  };
}

async function refreshKnownHostsList() {
  const list = document.getElementById('kh-list');
  const hosts = await window.api.knownHostsList();
  if (!hosts || hosts.length === 0) {
    list.innerHTML = '<div class="kh-empty">No trusted hosts yet.</div>';
    return;
  }
  list.innerHTML = '';
  hosts.sort((a, b) => a.hostname.localeCompare(b.hostname) || a.port - b.port);
  hosts.forEach(h => {
    const row = document.createElement('div');
    row.className = 'kh-row';
    const fpShort = h.keyFingerprint.length > 24
      ? h.keyFingerprint.substring(0, 24) + '…' : h.keyFingerprint;
    row.innerHTML = `
      <div class="kh-info">
        <div class="kh-host">${escapeHtml(h.hostname)}<span class="kh-port">:${h.port}</span></div>
        <div class="kh-meta">
          <span class="kh-type">${escapeHtml(h.keyType)}</span>
          <span class="kh-fp" title="${escapeHtml(h.keyFingerprint)}">${escapeHtml(fpShort)}</span>
          <span class="kh-source">${escapeHtml(h.source)}</span>
          <span class="kh-date">${new Date(h.firstSeen).toLocaleDateString()}</span>
        </div>
      </div>
      <button class="kh-remove" title="Remove trust">${window.icon('trash', 14)}</button>
    `;
    row.querySelector('.kh-remove').onclick = async () => {
      const ok = await window.showConfirmDialog({
        title: 'Stop Trusting Host',
        message: `Stop trusting ${h.hostname}:${h.port}? You'll be re-prompted to verify its key next time you connect.`,
        confirmLabel: 'Remove',
      });
      if (!ok) return;
      await window.api.knownHostsRemove(h.hostname, h.port);
      refreshKnownHostsList();
    };
    list.appendChild(row);
  });
}

// --- Toast (unobtrusive top-right notification) ------------------------
function showToast(message, kind, durationMs) {
  let toast = document.getElementById('shellsync-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'shellsync-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast' + (kind === 'error' ? ' toast-error' : '');
  toast.classList.add('visible');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), durationMs || 4200);
}

// --- App Login (simple launch gate) --------------------------------------
// Deliberately minimal: one password, checked once at launch. No idle timer,
// no auto-relock, no interaction whatsoever with session password encryption
// (DPAPI keeps working the same regardless of this feature's state).
function bindLoginScreen() {
  const submit = async () => {
    const pw = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    let r;
    try {
      r = await window.api.loginVerify(pw);
    } catch (err) {
      console.error('[ShellSync] loginVerify threw:', err);
      errEl.textContent = 'Something went wrong. Please try again.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!r || !r.ok) {
      errEl.textContent = (r && r.error) || 'Incorrect password.';
      errEl.classList.remove('hidden');
      document.getElementById('login-password').value = '';
      document.getElementById('login-password').focus();
      return;
    }
    hideLoginScreen();
  };
  document.getElementById('login-btn').onclick = submit;
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
}

function showLoginScreen() {
  document.getElementById('login-logo').innerHTML = LOGO_SVG;
  const pwField = document.getElementById('login-password');
  pwField.value = '';
  pwField.setAttribute('tabindex', '0');
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  setTimeout(() => pwField.focus(), 100);
}
function hideLoginScreen() {
  const pwField = document.getElementById('login-password');
  pwField.setAttribute('tabindex', '-1');
  pwField.blur();
  document.getElementById('login-screen').classList.add('hidden');
}

function bindAppLoginUi() {
  // Refresh the Settings section every time Settings opens
  const settingsBtn = document.getElementById('open-settings-btn');
  const original = settingsBtn.onclick;
  settingsBtn.onclick = (e) => {
    if (original) original(e);
    refreshAppLoginUi();
  };

  const newPw = document.getElementById('al-new');
  const newPwConfirm = document.getElementById('al-new-confirm');
  const enableBtn = document.getElementById('al-enable-btn');
  const validate = () => {
    enableBtn.disabled = !(newPw.value.length >= 4 && newPw.value === newPwConfirm.value);
  };
  newPw.oninput = validate;
  newPwConfirm.oninput = validate;
  enableBtn.onclick = async () => {
    const r = await window.api.loginEnable(newPw.value);
    if (!r.ok) { alert('Enable failed: ' + r.error); return; }
    showToast('App Login enabled — you\'ll be asked for this password next time ShellSync starts.');
    newPw.value = ''; newPwConfirm.value = ''; validate();
    refreshAppLoginUi();
  };

  document.getElementById('al-disable-btn').onclick = async () => {
    const pw = await window.showPromptDialog({
      title: 'Disable App Login',
      message: 'Enter your current App Login password to confirm.',
      placeholder: 'Current password',
    });
    if (pw === null) return; // cancelled
    const r = await window.api.loginDisable(pw);
    if (!r.ok) { alert('Disable failed: ' + r.error); return; }
    showToast('App Login disabled.');
    refreshAppLoginUi();
  };
}

async function refreshAppLoginUi() {
  const s = await window.api.loginStatus();
  const statusRow = document.getElementById('al-status-row');
  const enablePanel = document.getElementById('al-enable-panel');
  const managePanel = document.getElementById('al-manage-panel');

  if (s.enabled) {
    statusRow.querySelector('.mp-status-text').innerHTML =
      `<strong style="color:var(--success)">ENABLED</strong> — asked at every launch`;
    enablePanel.classList.add('hidden');
    managePanel.classList.remove('hidden');
  } else {
    statusRow.querySelector('.mp-status-text').innerHTML =
      `<strong style="color:var(--text-3)">Not enabled</strong>`;
    enablePanel.classList.remove('hidden');
    managePanel.classList.add('hidden');
  }
  hydrateIcons(statusRow);
}

window.addEventListener('resize', () => {
  const t = tabs.get(activeTabId);
  if (t) {
    t.fit.fit();
    window.api.sshResize(t.sessionId, t.term.cols, t.term.rows);
  }
});

// --- Auto-lock after inactivity (v0.19.0) ------------------------------
// When App Login is enabled, re-shows the lock screen after N minutes of no
// user activity. SSH sessions themselves keep running in the background —
// only the UI is gated. Unlocking picks up right where you left off.
//
// "Activity" = mouse move, mouse click, key press, or terminal I/O. Terminal
// output from a remote server does NOT count (we don't want a chatty log
// stream from a server to prevent auto-lock forever).

// v0.19.1: timeout comes from settings.autoLockMinutes. 0 disables auto-lock
// entirely (App Login still gates initial launch, but the app never re-locks
// during a session).
let autoLockTimer = null;
let autoLockEnabled = false;    // set true after successful login IF App Login is enabled

function armAutoLock() {
  if (!autoLockEnabled) return;
  if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }

  const minutes = Number(settings.autoLockMinutes);
  if (!minutes || minutes <= 0) return; // 0 = never lock

  autoLockTimer = setTimeout(() => {
    console.log('[ShellSync] Auto-lock triggered after', minutes, 'minutes idle');
    showLoginScreen();
  }, minutes * 60 * 1000);
}

function bindAutoLockActivity() {
  // Any of these events counts as "user is still here"
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(ev => {
    window.addEventListener(ev, armAutoLock, { passive: true, capture: true });
  });
}

// Called from the login screen once the App Login password is verified —
// if App Login is enabled, arm the auto-lock timer from that moment on.
async function enableAutoLockIfNeeded() {
  const s = await window.api.loginStatus();
  if (s && s.enabled) {
    autoLockEnabled = true;
    bindAutoLockActivity();
    armAutoLock();
    const m = Number(settings.autoLockMinutes);
    console.log('[ShellSync] Auto-lock armed:', m > 0 ? `${m} minutes` : 'disabled (0 = never)');
  }
}

// v0.19.1: called from the Settings dialog when the user changes the
// auto-lock timeout. Re-arms with the new value (or cancels if set to 0).
function refreshAutoLockAfterSettingChange() {
  if (!autoLockEnabled) return; // App Login not on — nothing to re-arm
  if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }
  armAutoLock();
}
