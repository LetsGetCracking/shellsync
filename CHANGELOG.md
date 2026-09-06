# Changelog

All notable changes to ShellSync are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Security-relevant changes are marked with **[SECURITY]**.

## [0.18.2] — 2026-09

### Fixed

- **Terminal bottom-row clipping.** The last line of terminal output was being clipped in half due to fractional-pixel drift in xterm's FitAddon row calculation. Bumped bottom padding to give the calculation slack. Costs one row of visible height for a fully legible cursor line.

## [0.18.1] — 2026-08

### Changed

- **Terminal Colors settings section now has a clarifying note** explaining these settings only change the SSH terminal, not the whole app UI. Purely UX; no behavior change.

## [0.18.0] — 2026-08

### Added

- **Windows Light preset.** A seventh built-in terminal theme matching Microsoft's Windows Terminal "Windows 11 Light" palette.
- **Save-your-own custom presets.** Save the current terminal colors under a name; appears in a custom preset row with a magenta-tinted outline. Right-click to delete. Includes overwrite protection.

## [0.17.6] — 2026-08

### Fixed

- **Stats polling no longer stacks parallel exec channels on slow servers.** Added an in-flight flag with try/finally guard.
- **`ssh:connect` no longer leaks an ssh2 Client instance on a bad key path.** Reordered so the key file is read before the Client is constructed.

## [0.17.5] — 2026-08

### Fixed

- **Duplicate keystrokes bug.** `term.onData` and `term.onResize` weren't being disposed on reconnect. xterm.js's `onData` is additive — each reconnect stacked another listener. After one reconnect, every keystroke was being sent to the SSH stream twice (`sudo` appeared as `ssuuddoo`). Fixed by pushing both disposables into the cleanup array.

## [0.17.4] — 2026-08

Reliability and correctness patch. No new features.

### Fixed

- **[SECURITY] Atomic file writes.** `writeJson` now writes to a sibling temp file and renames it over the target — NTFS rename is atomic, so a crash or power loss mid-write can no longer corrupt `settings.json`, `sessions.json`, or `known_hosts.json`.
- **"Duplicate tab" actually duplicates now** instead of switching to the existing tab.
- **App Login state can't go stale in the renderer.** Renderer strips `appLogin` from cached settings on load. The only correct way to check state is `loginStatus()`.
- **`_encryptionFailed` flag no longer persists to disk.** Was causing repeated "encryption failed" warnings for users on systems without DPAPI.
- **Closing a tab mid-paste no longer leaks memory** for 30 seconds.

## [0.17.3] — 2026-08

### Fixed

- **[SECURITY] App Login enable + Settings save no longer wipes the credential.** The renderer's stale in-memory `appLogin` was overwriting freshly-saved credentials on disk. `settings:set` now unconditionally ignores `appLogin` from renderer payloads.

## [0.17.2] — 2026-08

### Fixed

- **Session dialog showed both SSH and RDP fields at once.** The `.hidden` class was applied but no CSS rule was hiding the elements. Added scoped selectors.
- **Terminal text ran flush against the right edge; scrollbar overlapped the last few columns.** Added `scrollbar-gutter: stable` and bumped right padding.

### Changed

- **Session dialog title for new sessions** now reads "New SSH or RDP Session" instead of switching between the two.
- **Clicking outside the session dialog closes it.** Matches the settings dialog behavior.

## [0.17.1] — 2026-08

### Added

- **Smart paste with prompt awareness.** Prompt-learning engine sends multi-line pastes one line at a time, waiting for the shell prompt to actually return between lines. Detects `sudo` / SSH password prompts mid-paste and pauses with a banner until you type the password and the shell prompt returns. Matches SolarPuTTY's behavior.

## [0.17.0] — 2026-08

### Added

- **Multi-line paste preview dialog.** Multi-line pastes now show a preview before executing, with an option to strip leading `sudo` from each line.

## [0.16.2] — 2026-08

### Changed

- Removed the old smart-paste engine in favor of raw passthrough (superseded by v0.17.1's proper implementation).

## [0.16.1] — 2026-08

### Fixed

- **[SECURITY] App Login persistence.** First attempt at the settings-merge fix — the merge logic in `settings:set` was preserving disk-side `appLogin` when the renderer omitted the key.

## [0.16.0] — 2026-08

### Added

- **RDP session support.** RDP sessions live in the same session tree as SSH. Launches via native `mstsc.exe`, credentials go to Windows Credential Manager via `cmdkey.exe`. Session dialog gets an SSH/RDP toggle. Delete an RDP session with saved credentials → pre-checked "Also remove saved Windows credentials?" checkbox.

## Earlier versions

Development from v0.1 through v0.15 was iterative and pre-public. Highlights of features that shipped during that period:

- v0.15.3 — Prompt-learning smart paste (superseded by v0.17.1)
- v0.15.0 — App Login (application password gate on startup)
- v0.14.0 — SFTP dual-pane file browser with FileZilla-style transfer confirm
- v0.13.0 — Real-time server stats via batched SSH exec
- v0.12.0 — DPAPI-encrypted session passwords via Electron `safeStorage`
- v0.11.0 — Host-key TOFU verification and Known Hosts manager
- v0.10.0 — SSH agent support (Windows OpenSSH, Pageant)
- v0.9.0 — Theme presets and customizable dark theme
- v0.8.0 — Custom themed dropdown components
- v0.7.0 — Frameless title bar with glassmorphism UI
- v0.6.0 — Multi-session tabbed terminals
- v0.5.0 — Three-column floating-card layout
- v0.1–v0.4 — Initial Electron + xterm.js + ssh2 foundation

Detailed changelogs for these versions weren't kept.

---

[0.18.2]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.18.2
[0.18.1]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.18.1
[0.18.0]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.18.0
[0.17.6]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.17.6
[0.17.5]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.17.5
[0.17.4]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.17.4
[0.17.3]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.17.3
[0.17.2]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.17.2
[0.17.1]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.17.1
[0.17.0]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.17.0
[0.16.2]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.16.2
[0.16.1]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.16.1
[0.16.0]: https://github.com/LetsGetCracking/shellsync/releases/tag/v0.16.0
