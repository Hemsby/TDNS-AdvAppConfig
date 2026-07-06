# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

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
