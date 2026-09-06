# Security Policy

## Reporting a security issue

If you find a security bug in ShellSync, **please do not open a public GitHub issue.** Public reports on security issues let attackers know about a vulnerability before there's a fix.

Instead, email me directly:

**Email:** `cookeedwin@gmail.com`
**Subject line:** `[ShellSync Security] <short description>`

I'll acknowledge receipt within 7 days. Depending on severity and complexity, expect a fix within 2–6 weeks. After a fix ships, I'll credit you (with your permission) in the release notes.

If a vulnerability is being actively exploited, put "URGENT" in the subject line and I'll prioritize.

## Supported versions

Only the **latest released version** receives security updates. If you're on an older version, upgrade before reporting an issue that might already be fixed.

## Threat model — what ShellSync protects against

**Local disk access by someone who isn't you (different Windows account, or an attacker with your `sessions.json` but not your OS credentials).**
- Saved SSH passwords are encrypted with Windows DPAPI (via Electron's `safeStorage`). DPAPI ties encryption to your Windows user account — a file dumped to another machine or opened by a different user account cannot be decrypted
- App Login password (if enabled) is stored as a PBKDF2-SHA256 hash with 100,000+ iterations and a per-installation salt. The password itself is never on disk

**Man-in-the-middle attacks on SSH connections.**
- Strict host-key verification with trust-on-first-use (TOFU). First connection saves the server's host key fingerprint. Any subsequent mismatch aborts the connection with a warning
- Uses `ssh2` library's default cipher and MAC negotiation (modern algorithms only)

**Accidental password exposure.**
- Session files never contain plaintext passwords
- The `_encryptionFailed` flag is stripped before write so it doesn't accumulate
- RDP passwords are handed directly to Windows Credential Manager via `cmdkey.exe` — ShellSync's own code never persists them

**Casual physical access to an unlocked machine.**
- Optional App Login gate at startup requires a password before the UI appears

## Threat model — what ShellSync does NOT protect against

Being clear about this is more valuable than pretending it's bulletproof.

**A malicious Windows administrator or malware running as your user.**
- DPAPI encryption is user-account-scoped. Any code running as your Windows user can call the same DPAPI APIs and decrypt your passwords. App Login is a UI gate — it does not re-encrypt session data
- If you need protection against local privileged attackers, this isn't the tool for you

**Memory dumps of the running process.**
- Passwords typed into ShellSync exist in JavaScript strings in Electron's memory while the app is running. JavaScript has no way to securely wipe strings. A memory dump might recover recent passwords
- This is true for essentially every Electron app

**Attacks against the Electron/Chromium runtime.**
- ShellSync bundles Electron, which includes Chromium. Chromium receives security patches roughly monthly
- ShellSync currently doesn't auto-update. You need to install new versions manually to get Chromium security fixes
- If a malicious server sends terminal output that exploits a bug in `xterm.js` or Chromium, an attacker could potentially execute code in ShellSync's renderer process

**Man-in-the-middle attacks during binary distribution.**
- The released `.exe` is not currently code-signed. This means:
  - Windows will show a SmartScreen warning ("Windows protected your PC") on first install
  - There's no cryptographic proof that the binary you downloaded is the one I built — someone could tamper with it in transit
- Verify the SHA256 hash against the value in `SHA256SUMS.txt` if you care about this

**Supply-chain attacks on dependencies.**
- ShellSync ships whatever versions of `ssh2`, `xterm.js`, `electron`, etc. it was built against
- If one of those had a compromise, ShellSync would inherit it
- I don't have a formal dependency-audit process — I run `npm audit --production` on releases and manually review, but that's not a substitute for a real supply-chain review

**Enterprise scenarios.**
- No compliance certifications (SOC 2, HIPAA, FedRAMP, etc.)
- No enterprise auth (SSO, SAML)
- No centralized credential vault or team sharing
- No audit log meeting regulatory requirements
- If your workplace requires any of these, use Royal TS, Devolutions RDM, or an equivalent

## What "reasonably secure" means for ShellSync

I've tried to be careful about the credential storage path, host-key verification, and IPC boundaries. Where there's a security decision to make, I've generally chosen the more conservative option — even at the cost of features. The exception is code signing, which is a paperwork/cost issue rather than a code issue.

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
| App Login password | PBKDF2-SHA256, 100,000 iterations, 16-byte salt |
| RDP credentials | Windows Credential Manager (via `cmdkey.exe`) |
| SSH host key verification | Trust-on-first-use, SHA256 fingerprint |
| SSH transport | Whatever `ssh2` negotiates (modern ciphers/MACs) |
| File writes | Atomic (temp file + rename) so crashes can't corrupt |

## What would meaningfully improve ShellSync's security

For transparency, here's the roadmap I have in my head. No commitments on timing.

1. **Code signing** — the single biggest trust improvement. Requires purchasing a certificate ($200-400/year)
2. **Auto-updates** — so security fixes actually reach users. Would use `electron-updater` and GitHub Releases
3. **Optional master password re-encryption** — an additional encryption layer on top of DPAPI, opt-in, for people who want protection from local admins
4. **Auto-lock after inactivity** — re-lock App Login after N minutes idle
5. **Rate-limit failed App Login attempts** — prevent brute-force guessing
6. **Regular Electron/dependency updates** — commit to monthly review

Contributions and suggestions on any of these are welcome — but security-critical changes require careful review, so please email before submitting a PR.

## Public advisories

None yet.

When ShellSync ships a security fix, it'll be listed here with:
- CVE ID (if one gets assigned)
- Affected versions
- Severity
- Credit (with permission)
- Link to the fixed release
