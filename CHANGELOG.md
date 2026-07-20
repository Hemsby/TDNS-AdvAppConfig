# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [2.1.0] - 2026-07-20

### Added

- Discard/Save bar now stays visible at the top of the screen while scrolling on every app's Config tab, instead of scrolling out of view.
- Network/IP group maps (Advanced Blocking, Advanced Forwarding, DNS64, Split Horizon) now list entries in IP order, with catch-all entries (`0.0.0.0/0`, `::/0`) always sorted last.
- Dashboard now shows an Installed / Available / Total app count, linking straight to the App Store tab.

### Fixed

- Adding a group (Advanced Blocking, Advanced Forwarding, DNS64, Split Horizon) now takes you straight into that group's editor instead of leaving you on the list.
- Adding a network, endpoint, or domain mapping now asks which group to map it to, instead of silently defaulting to the first one.
- Opening a group's editor no longer leaves the page scrolled to wherever the list happened to be - it now starts at the top every time.

## [2.0.2] - 2026-07-19

### Fixed

- App tabs no longer flash all 27 entries on page load before settling on just the installed ones - a loading indicator shows until the real list is known.
- Applying a self-update now shows a persistent "Updating…" overlay through the restart and reload, instead of the screen appearing frozen for several seconds with no feedback.

## [2.0.1] - 2026-07-17

### Fixed

- Dashboard no longer shows Split Horizon as "Disabled" when its actual split-horizon answering is working fine - the toggle it was reading only controls a separate, optional Address Translation feature, not whether Split Horizon itself is active. Removed Split Horizon from the Dashboard's toggle list; its own tab still has the Address Translation setting under its real name.

## [2.0.0] - 2026-07-17

### Added

- Form editors for every app in Technitium's App Store (27 total), not just Advanced Blocking: Advanced Forwarding, Auto PTR, Block Page, Default Records, DNS Block List (DNSBL), DNS Rebinding Protection, DNS64, Drop Requests, Failover, Filter AAAA, Geo Continent, Geo Country, Geo Distance, Log Exporter, NO DATA, NX Domain, NX Domain Override, Query Logs (MySQL/PostgreSQL/SQL Server/Sqlite), Split Horizon, Weighted Round Robin, What Is My Dns, Wild IP, and Zone Alias. Each installed app gets its own tab with a Config editor, a Records editor for per-domain APP records, or both, with local validation before every save.
- App Store tab: install/uninstall any app from Technitium's catalog without leaving the page.
- Dashboard tab reworked into an App Toggles list: every installed app with a single on/off master switch, grouped into Enabled/Disabled sections with a real switch control, toggled immediately.
- Any app not yet covered by a dedicated editor still gets a tab, falling back to a generic raw-JSON editor - the same fallback the official console itself uses.

### Changed

- Advanced Blocking's own status, pause/resume, and per-group controls moved from the main Dashboard to their own tab, making room for the new App Toggles list.

## [1.0.0] - 2026-07-06

### Changed

- First stable release. No functional changes since 0.1.7 - this marks the mobile-responsiveness and self-update fixes as stable and ready for general use.

## [0.1.6] - 2026-07-06

### Fixed

- Self-update on Linux/systemd is now reliable end to end: a failed update no longer shows a confusing "Unexpected end of JSON input" error, overwriting the running executable no longer fails with "Text file busy", and the updated binary no longer loses its executable permission (which previously left the service unable to restart).

## [0.1.2] - 2026-07-06

### Fixed

- UI is now responsive on mobile and narrow windows - header, tables, and forms reflow at tablet and phone widths instead of forcing horizontal scrolling.

## [0.1.1] - 2026-07-06

### Fixed

- Linux release zips now include the systemd unit file, matching the Windows zip's bundled service scripts.
- Reworked README deployment instructions so each platform's steps are self-contained.

## [0.1.0] - 2026-07-05

### Added

- Dashboard tab: pause/resume for the whole Advanced Blocking app and per group, with optional durations and a live countdown. Survives a restart, so a pending auto-resume is never lost.
- Config tab: full form-based editor for the Advanced Blocking config - general settings, endpoint/network group maps, and per-group editing of blocking addresses, domains, list URLs, and regex rules.
- Theme switcher (Auto/Light/Dark/Amber) matching the official Technitium console.
- Self-update via GitHub releases, with deployment-aware handling for Linux/systemd, Windows (including as a Windows Service), and Docker.
- Windows Service support: install/uninstall scripts and full start/stop/restart via standard service cmdlets.
- Shared-secret authentication for the addon's own API, with a login overlay in the UI.
- Local validation of the config document before forwarding it to the DNS server, so a malformed submission is rejected locally instead of breaking the Advanced Blocking app.
- Deployment hardening: runs as a dedicated unprivileged user on Linux, with restrictive permissions on `config.json`.
- Visual parity with the official Technitium console.
