# Building ShellSync from source

If you don't want to trust the released binary, you can build ShellSync yourself and verify it matches what I published. This document walks you through it.

## What you need

**A Windows 10 or 11 machine (64-bit).** Cross-compiling from Linux/macOS is possible but not documented here — build on the target OS.

**Node.js 18 or newer.** Download from [nodejs.org](https://nodejs.org/) and install with default options. Verify:

```powershell
node --version
npm --version
```

**Git.** Download from [git-scm.com](https://git-scm.com/) if you don't already have it.

**Developer Mode enabled in Windows.** Required for building — Windows blocks non-admin symlink creation by default, and `electron-builder` needs symlinks during unpacking of its own tooling. To enable:

- Windows 11: Settings → System → For developers → Developer Mode → On
- Windows 10: Settings → Update & Security → For developers → Developer Mode → On

Close and reopen PowerShell after enabling.

**PowerShell execution policy set to allow scripts.** `npm.ps1` is a PowerShell script and won't run under a locked-down execution policy. Fix once per user account:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Type `Y` and press Enter when prompted.

## Getting the source

```powershell
git clone https://github.com/LetsGetCracking/shellsync.git
cd shellsync
```

To build a specific released version rather than latest:

```powershell
git checkout v0.19.31
```

(Replace with whatever version tag you want — see the [releases page](https://github.com/LetsGetCracking/shellsync/releases) for available tags.)

## Installing dependencies

```powershell
npm install
```

This downloads ~300 npm packages including Electron itself. Takes 1-3 minutes. You'll see warnings — these are almost all from transitive dependencies of `electron-builder` (the tool that packages the app) and don't affect the runtime. See the FAQ below.

## Building the installer

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run build
```

The first environment variable tells `electron-builder` not to look for a code-signing certificate. Without it, the build will fail if you don't have one configured.

The build takes 2-3 minutes. When it finishes, look in the `dist\` folder:

```
dist\
├── ShellSync-Setup-X.Y.Z.exe         ← the installer
├── ShellSync-Portable-X.Y.Z.exe      ← standalone portable version
├── latest.yml                        ← auto-updater metadata (required at release time)
├── win-unpacked\                     ← unpacked app directory
└── builder-effective-config.yaml     ← the effective build config
```

**`latest.yml` is important** — ShellSync's auto-updater (introduced in v0.19.19) reads this file from the GitHub Release to decide whether a newer version is available. When you publish a release, upload both the `.exe` and `latest.yml` as release assets, or the auto-updater in users' installed copies will fail with "Cannot find latest.yml in the latest release artifacts."

## Verifying against a released binary

If you want to prove that the source produces the same binary I distributed:

```powershell
Get-FileHash .\dist\ShellSync-Setup-X.Y.Z.exe -Algorithm SHA256
```

Compare to the value in `SHA256SUMS.txt` on the releases page. **Note:** Electron binaries include build timestamps, so hashes won't match exactly across independent builds — but the `win-unpacked` folder contents should match at the file level.

## FAQ

### Why am I seeing so many "deprecated package" warnings from `npm install`?

Those are from `electron-builder`'s dependencies, not ShellSync's runtime. They only run during the build and don't ship in the final `.exe`. Ignore.

### Why am I seeing "10 vulnerabilities" from `npm audit`?

Same reason — they're in the build-time dependency tree. Run `npm audit --omit=dev` to see only runtime vulnerabilities, which should be zero or near-zero. (`--omit=dev` is the modern replacement for the deprecated `--production` flag.)

**Do not run `npm audit fix --force`.** It will try to upgrade `electron-builder`'s dependencies and probably break the build.

### The build fails with "Cannot create symbolic link"

Developer Mode isn't enabled. See the prerequisites section above.

If Developer Mode is enabled and it still fails, try clearing `electron-builder`'s cache:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
```

Then rerun the build.

### The build fails with "npm : File cannot be loaded because running scripts is disabled"

PowerShell execution policy issue. See the prerequisites section.

### Can I skip building the installer and just run the app directly?

Yes:

```powershell
npm start
```

This runs the app in dev mode (Electron pointing at your source files). Useful for testing changes but not what your peers should install.

### How do I run the built app without installing?

Use the portable build:

```powershell
.\dist\ShellSync-Portable-X.Y.Z.exe
```

Note that the portable build doesn't participate in auto-updates — it checks for updates but can't install them in place. For auto-update to work, install the `Setup` version.

## Development notes

If you want to look at the code:

- `main.js` — the Electron main process. Handles SSH connections, session storage, RDP delegation, App Login, the SSH Key Manager, the auto-updater, and jump-host chaining. This is where all the privileged operations happen.
- `preload.js` — the IPC bridge between main and renderer. Every function the UI can call is listed here.
- `renderer/` — the UI (HTML, CSS, and browser-side JavaScript). Uses xterm.js for the terminal.
  - `renderer.js` is the main module (session tree, tabs, settings, broadcast, command palette, SSH key manager UI, updater UI, …)
  - `fileBrowser.js` handles the SFTP file panel including the sudo-elevated view
  - `dialogs.js`, `transferDialog.js`, `icons.js` are small helpers
- `CHANGELOG.md` documents everything per version — read it to understand why the code is shaped the way it is.

The IPC boundary is enforced — the renderer has no direct filesystem or network access. Everything goes through `preload.js` → `main.js`.

### Auto-updater notes

ShellSync uses [`electron-updater`](https://www.electron.build/auto-update) against GitHub Releases. The `publish` block in `package.json`'s `build` field points at `LetsGetCracking/shellsync`. On each new release, upload **both** the `.exe` installer and the `latest.yml` metadata file (both are in `dist\` after `npm run build`) as release assets. Without `latest.yml`, installed copies' auto-updater will fail silently.

Auto-update is disabled in dev mode (`npm start`) via an `app.isPackaged` check, so running from source never triggers an update attempt.

## Reproducible builds

I'd like to make builds fully deterministic (same source → identical binary bytes) but haven't set that up yet. Currently, Electron's build process embeds timestamps that cause independent builds to differ. If you want to verify the released binary against source, the best proxy is:

1. Build from the exact tagged commit
2. Compare individual files in `win-unpacked/resources/app.asar` (which contains your JS/HTML/CSS)
3. Confirm the Electron version and dependency versions match

Full reproducible builds are on the wishlist but not a priority for a personal project.
