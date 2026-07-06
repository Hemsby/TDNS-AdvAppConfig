# Changelog

All notable changes to this project are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

**At release time:** rename `[Unreleased]` below to `[vX.Y.Z] - YYYY-MM-DD`, update `<Version>` in `src/TdnsAdvAppConfig/TdnsAdvAppConfig.csproj` to match, then start a fresh empty `[Unreleased]` section above it before tagging. The version number here, the csproj `<Version>`, and the `vX.Y.Z` git tag should always agree — the self-update feature compares this project's own version against GitHub release tags to decide whether an update is available.

## [Unreleased]

## [0.1.5] - 2026-07-06

Release update testing - no functional changes.

## [0.1.4] - 2026-07-06

### Fixed
- Self-update on Linux/systemd no longer fails with "Text file busy". `UpdateApplier.CopyDirectory` overwrote files in place, including this process's own running executable, which Linux refuses (ETXTBSY) for a file currently mapped as an executing program. It now copies to a temp file in the same directory and renames over the original, which the kernel allows even while the old inode is still executing. Windows and Docker were checked and are unaffected: Docker's apply path never touches files, and the Windows helper process already waits for the main process to exit before copying.

## [0.1.3] - 2026-07-06

### Fixed
- Self-update ("Update now") no longer fails with an opaque "Unexpected end of JSON input" when something goes wrong applying the update (unreachable GitHub, disk full, a locked file, etc.). `UpdateApplier.ApplyAsync` had no error handling around its download/extract/copy steps, so a failure there was an unhandled exception; with no exception-handling middleware configured, that produced a bare empty 500 response, which the client's JSON parsing choked on instead of showing the real cause. It now returns a proper error message like `UpdateManager.CheckAsync` already did.

## [0.1.2] - 2026-07-06

### Fixed
- UI is now responsive on mobile and narrow windows. `main.css` (vendored from Technitium's own console) floors `#header`/`#footer` at a 970px min-width, which forced horizontal scrolling on any narrower viewport; the container, header, panels, tables, and group/URL-entry rows now reflow at tablet and phone widths instead.

## [0.1.1] - 2026-07-06

### Fixed
- Release workflow now bundles the systemd unit (`deploy/systemd/tdns-advappconfig.service`) into the linux-x64/linux-arm64 release zips, matching how the Windows zip already bundles its service scripts. Previously the Linux deployment instructions referenced a file that only existed in a git checkout, not in the downloadable release.
- README "Getting a build" / "Deployment" sections rewritten so each platform's instructions are self-contained (download, extract straight to the real final location, configure) instead of splitting the flow across two sections with an unstated working directory in between.

## [0.1.0] - 2026-07-05

### Added
- Dashboard tab: pause/resume for the whole Advanced Blocking app (root master switch) and per group, each with an optional duration — presets (5/15/30 min, 1 hour) or a custom minutes/hours picker — and a live "resumes in MM:SS" countdown with a "Resume Now" option. The timer lives server-side and survives a restart (crash or self-update), so a pending auto-resume is never silently lost.
- Config tab: full form-based editor for the Advanced Blocking config document — general settings, local endpoint/network group maps (group selected from a dropdown, so a mapping can't reference a nonexistent group), group add/rename/delete, and a per-group editor covering every field (toggles, blocking addresses, allowed/blocked domains, allow list URLs, block list URLs with an "Advanced" per-URL override, and the regex/adblock-list equivalents).
- Theme switcher (Auto/Light/Dark/Amber) matching the official Technitium console's own mechanism exactly.
- Self-update via GitHub releases, applied in a deployment-aware way: in-place file swap + exit on Linux/systemd (relies on `Restart=always`), a helper-process file swap on Windows (works whether running as a plain process or an installed Windows Service), informational-only on Docker.
- Windows Service support: install/uninstall scripts, full start/stop/restart via the standard service cmdlets, and a service-aware self-update restart path.
- Shared-secret authentication (`adminSecret`) required for the addon's own API, with a login overlay in the UI.
- Local schema validation of the config document before forwarding it to the DNS server, so a malformed submission is rejected locally instead of potentially breaking the Advanced Blocking app on the real server.
- Deployment hardening: runs as a dedicated unprivileged user (not root) on Linux, with restrictive permissions on `config.json`.
- Visual parity with the official Technitium console — vendored CSS, header, and tab styling.
