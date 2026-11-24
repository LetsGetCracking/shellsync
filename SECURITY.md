# Security Policy

## Reporting a security issue

If you find a security bug in ShellSync, **please do not open a public GitHub issue.** Public reports on security issues let attackers know about a vulnerability before there's a fix.

Instead, email me directly:

**Email:** `cookeedwin@gmail.com`
**Subject line:** `[ShellSync Security] <short description>`

I'll acknowledge receipt within 7 days. Depending on severity and complexity, expect a fix within 2–6 weeks. After a fix ships, I'll credit you (with your permission) in the release notes.

If a vulnerability is being actively exploited, put "URGENT" in the subject line and I'll prioritize.

## Supported versions

Only the **latest released version** receives security updates. ShellSync now auto-updates on startup (opt-out in Settings → Updates), so most users are on the latest release automatically. If you've disabled auto-updates or you're building from source, upgrade before reporting an issue that might already be fixed.

## Threat model — what ShellSync protects against

**Local disk access by someone who isn't you (different Windows account, or an attacker with your `sessions.json` but not your OS credentials).**
- Saved SSH passwords are encrypted with Windows DPAPI (via Electron's `safeStorage`). DPAPI ties encryption to your Windows user account — a file dumped to another machine or opened by a different user account cannot be decrypted
- App Login password (if enabled) is stored as a PBKDF2-SHA256 hash with 200,000 iterations and a per-installation salt. The password itself is never on disk
- SSH private keys managed by the built-in SSH Key Manager live in `%APPDATA%\ShellSync\keys\` as PKCS8 PEM files. They inherit the user-account-scoped NTFS permissions of your `%APPDATA%` directory — other Windows users on the same machine cannot read them

**Man-in-the-middle attacks on SSH connections.**
- Strict host-key verification with trust-on-first-use (TOFU). First connection saves the server's host key fingerprint. Any subsequent mismatch aborts the connection with a warning
- **Jump host connections verify BOTH hops' host keys independently** — a compromised bastion can't impersonate the target, because the target's own host key is still checked over the tunneled socket
- **Key deployment (ssh-copy-id equivalent) uses the same TOFU verifier** — a MITM can't trick the deploy flow into sending your password or pubkey to the wrong host
- Uses `ssh2` library's default cipher and MAC negotiation (modern algorithms only)

**Accidental password exposure.**
- Session files never contain plaintext passwords
- The `_encryptionFailed` flag is stripped before write so it doesn't accumulate
- RDP passwords are handed directly to Windows Credential Manager via `cmdkey.exe` — ShellSync's own code never persists them
- **Broadcast "Send password"** uses a masked field and clears the password from the DOM *before* the SSH writes fire, so a slow send can't leave the password lingering in memory for devtools inspection
- **Sudo deploy commands** escape the public-key line before shell inclusion so an attacker-controlled key comment can't break out of the quoted string

**Casual physical access to an unlocked machine.**
- Optional App Login gate at startup requires a password before the UI appears
- **Configurable auto-lock** after N minutes of inactivity (default 15) — re-locks without closing your sessions
- **Lock-on-demand** from the user icon dropdown when you're stepping away
- **Rate limiting** on App Login attempts to make brute-forcing impractical

**Stale / forgotten versions with known bugs.**
- Auto-update on startup (electron-updater against GitHub Releases) makes sure security fixes actually reach users. Disabled by default only in dev builds (`npm start`); packaged installs opt in automatically unless the user turns it off in Settings

## Threat model — what ShellSync does NOT protect against

Being clear about this is more valuable than pretending it's bulletproof.

**A malicious Windows administrator or malware running as your user.**
- DPAPI encryption is user-account-scoped. Any code running as your Windows user can call the same DPAPI APIs and decrypt your passwords. App Login is a UI gate — it does not re-encrypt session data
- SSH private keys in `%APPDATA%\ShellSync\keys\` are plain PKCS8 PEM files, readable by any process running as your user
- If you need protection against local privileged attackers, this isn't the tool for you

**Memory dumps of the running process.**
- Passwords typed into ShellSync exist in JavaScript strings in Electron's memory while the app is running. JavaScript has no way to securely wipe strings. A memory dump might recover recent passwords
- This is true for essentially every Electron app

**Attacks against the Electron/Chromium runtime.**
- ShellSync bundles Electron, which includes Chromium. Chromium receives security patches roughly monthly
- Auto-update helps — but only for users who leave it enabled. Users who opt out are responsible for manual upgrades
- If a malicious server sends terminal output that exploits a bug in `xterm.js` or Chromium, an attacker could potentially execute code in ShellSync's renderer process

**Man-in-the-middle attacks during binary distribution.**
- The released `.exe` is not currently code-signed. This means:
  - Windows will show a SmartScreen warning ("Windows protected your PC") on first install
  - There's no cryptographic proof that the binary you downloaded is the one I built — someone could tamper with it in transit
- The auto-updater verifies release metadata (`latest.yml`) integrity, but without signing, a GitHub account compromise could ship a malicious update
- Verify the SHA256 hash against the value in `SHA256SUMS.txt` on first install if you care about this

**Supply-chain attacks on dependencies.**
- ShellSync ships whatever versions of `ssh2`, `xterm.js`, `electron`, `electron-updater`, etc. it was built against
- If one of those had a compromise, ShellSync would inherit it
- I don't have a formal dependency-audit process — I run `npm audit --omit=dev` on releases and manually review, but that's not a substitute for a real supply-chain review

**Broadcast mode mistakes.**
- Broadcasting a destructive command (`rm`, `shutdown`, etc.) sends it to every member of the group. The three persistent visual indicators (tab borders, status pill, warning banner) are the safety mechanism, but ShellSync will not stop you from broadcasting a command that destroys multiple servers
- The "Send password" button sends the same password to every broadcasting session simultaneously. If some targets have different sudo passwords, the wrong password hits those targets — standard sudo behavior will reject it, but you'll have made a login attempt

**Enterprise scenarios.**
- No compliance certifications (SOC 2, HIPAA, FedRAMP, etc.)
- No enterprise auth (SSO, SAML)
- No centralized credential vault or team sharing
- No audit log meeting regulatory requirements (though the local SSH audit log in `%APPDATA%\ShellSync\ssh-log.jsonl` records every connection)
- If your workplace requires any of these, use Royal TS, Devolutions RDM, or an equivalent

## What "reasonably secure" means for ShellSync

I've tried to be careful about the credential storage path, host-key verification (including on jump hops and key deployment), and IPC boundaries. Where there's a security decision to make, I've generally chosen the more conservative option — even at the cost of features. The exception is code signing, which is a paperwork/cost issue rather than a code issue.

**Appropriate use:**
- Personal SSH/RDP client for managing your own machines
- Small team use where you already trust each other and your local network
- Learning tool, home lab, informal work environments

**Not appropriate for:**
- Sensitive production credentials in regulated industries
- Shared credentials that multiple people need access to
- Environments where you can't trust the machine ShellSync is running on

## Cryptography summary

| What | Mechanism |
|---|---|
| SSH session passwords | Windows DPAPI (via Electron `safeStorage`) |
| App Login password | PBKDF2-SHA256, 200,000 iterations, per-installation salt |
| RDP credentials | Windows Credential Manager (via `cmdkey.exe`) |
| SSH private keys (key manager) | PKCS8 PEM on disk, user-scoped NTFS permissions |
| SSH public keys (key manager) | OpenSSH `ssh-ed25519 <base64> <comment>` format |
| SSH host key verification | Trust-on-first-use, SHA256 fingerprint, per-hop on jump-host connections |
| SSH transport | Whatever `ssh2` negotiates (modern ciphers/MACs) |
| Auto-update integrity | `latest.yml` signature verified by `electron-updater` |
| File writes | Atomic (temp file + rename) so crashes can't corrupt |

## What would meaningfully improve ShellSync's security

For transparency, here's the roadmap I have in my head. No commitments on timing.

1. **Code signing** — the single biggest trust improvement remaining. Requires a certificate ($150-400/year OV) or applying to [SignPath Foundation](https://signpath.org/apply) for free open-source signing
2. **Optional master-password re-encryption** — an additional encryption layer on top of DPAPI, opt-in, for people who want protection from local admins
3. **Passphrase-protected key import** — the SSH Key Manager currently rejects passphrase-protected keys (decrypt first with `ssh-keygen -p -f`). Adding in-app passphrase prompts would improve ergonomics
4. **Reproducible builds** — build identical binary bytes from identical source so anyone can verify a release independently
5. **Regular Electron/dependency update commitments** — monthly review

**Already done since this list was first written:**

- ✅ Auto-updates (v0.19.19) — security fixes now reach users automatically
- ✅ Auto-lock after inactivity (v0.19.0) — configurable in Settings
- ✅ Rate-limit failed App Login attempts (v0.19.0)
- ✅ Per-hop host-key verification on jump hosts (v0.19.25)
- ✅ Host-key verification on SSH key deployment (v0.19.26)

Contributions and suggestions on any of these are welcome — but security-critical changes require careful review, so please email before submitting a PR.

## Public advisories

None yet.

When ShellSync ships a security fix, it'll be listed here with:
- CVE ID (if one gets assigned)
- Affected versions
- Severity
- Credit (with permission)
- Link to the fixed release
