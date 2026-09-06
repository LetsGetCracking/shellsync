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
git checkout v0.18.2
```

(Replace with whatever version tag you want.)

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
├── ShellSync-Setup-0.18.2.exe        ← the installer
├── ShellSync-Portable-0.18.2.exe     ← standalone portable version
├── win-unpacked\                     ← unpacked app directory
└── builder-effective-config.yaml     ← the effective build config
```

## Verifying against a released binary

If you want to prove that the source produces the same binary I distributed:

```powershell
Get-FileHash .\dist\ShellSync-Setup-0.18.2.exe -Algorithm SHA256
```

Compare to the value in `SHA256SUMS.txt` on the releases page. **Note:** Electron binaries include build timestamps, so hashes won't match exactly across independent builds — but the `win-unpacked` folder contents should match at the file level.

## FAQ

### Why am I seeing so many "deprecated package" warnings from `npm install`?

Those are from `electron-builder`'s dependencies, not ShellSync's runtime. They only run during the build and don't ship in the final `.exe`. Ignore.

### Why am I seeing "10 vulnerabilities" from `npm audit`?

Same reason — they're in the build-time dependency tree. Run `npm audit --production` to see only runtime vulnerabilities, which should be zero or near-zero.

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
.\dist\ShellSync-Portable-0.18.2.exe
```

## Development notes

If you want to look at the code:

- `main.js` — the Electron main process. Handles SSH connections, session storage, RDP delegation, App Login. This is where all the privileged operations happen.
- `preload.js` — the IPC bridge between main and renderer. Every function the UI can call is listed here.
- `renderer/` — the UI (HTML, CSS, and browser-side JavaScript). Uses xterm.js for the terminal.

The IPC boundary is enforced — the renderer has no direct filesystem or network access. Everything goes through `preload.js` → `main.js`.

## Reproducible builds

I'd like to make builds fully deterministic (same source → identical binary bytes) but haven't set that up yet. Currently, Electron's build process embeds timestamps that cause independent builds to differ. If you want to verify the released binary against source, the best proxy is:

1. Build from the exact tagged commit
2. Compare individual files in `win-unpacked/resources/app.asar` (which contains your JS/HTML/CSS)
3. Confirm the Electron version and dependency versions match

Full reproducible builds are on the wishlist but not a priority for a personal project.
