# TDNS-AdvAppConfig

A companion addon for [Technitium DNS Server](https://technitium.com/dns/) that gives every app in its official App Store a proper form-based web UI, instead of hand-editing each app's raw JSON config (or per-domain APP record data) in the official console's textarea editors.

Technitium's own web console exposes most apps' configuration as a raw JSON textarea (Apps > *App Name* > Config), with no form, no field-level guidance, and no validation beyond what the app itself does on reload - a malformed submission there can leave the app broken until someone hand-fixes the JSON. This addon adds a small web page, styled to match the Technitium console (same CSS, header, and theme switcher), with a dedicated tab and form editor for **all 27 apps currently in Technitium's App Store**, a Dashboard for the ones with a single on/off master switch, and an App Store tab to install/uninstall apps without leaving the page.

See [CHANGELOG.md](CHANGELOG.md) for what's changed in each release.

**If you deployed any version before v1.0.0, please remove it and deploy v1.0.0 fresh.** Everything prior was early, same-day iteration while real bugs were still being found and fixed - including in the self-update mechanism itself. An old build can't be trusted to reliably self-update out of that state. Apologies to anyone who ran into that; v1.0.0 is the first release meant for general use.

## Supported apps

Every app below has its own tab with a form editor - some are configured by one JSON document (a **Config** sub-tab), some by per-domain APP records (a **Records** sub-tab), and some by both:

Advanced Blocking, Advanced Forwarding, Auto PTR, Block Page, Default Records, DNS Block List (DNSBL), DNS Rebinding Protection, DNS64, Drop Requests, Failover, Filter AAAA, Geo Continent, Geo Country, Geo Distance, Log Exporter, NO DATA, NX Domain, NX Domain Override, Query Logs (MySQL), Query Logs (PostgreSQL), Query Logs (SQL Server), Query Logs (Sqlite), Split Horizon, Weighted Round Robin, What Is My Dns, Wild IP, Zone Alias.

Only tabs for apps actually installed on your DNS server are shown. If Technitium ships a new app this project doesn't have an editor for yet, it still gets a tab - a generic raw-JSON textarea, the same fallback the official console itself uses for apps without a custom form.

## How it works

The addon runs alongside Technitium DNS Server (on the primary node if clustered, or on the standalone server) and talks to the DNS Server's own HTTP API using an `Authorization: Bearer <token>` header - reading and writing each app's config via `GET`/`POST api/apps/config/get` and `api/apps/config/set`, and each app's APP records via the zone record endpoints, the same way the official console does.

Technitium reinitializes an app immediately on `config/set` — no restart needed, and if the server is a cluster primary, it automatically propagates the change to secondary nodes.

**Cluster note:** point this addon at whichever node is currently primary. The DNS Server only fans out config changes to secondaries when the change is made on the primary.

## Requirements

- A Technitium DNS Server, with any of the apps listed above installed that you want to manage through this addon
- An API token (Settings > Users > create/select a user > Create API Token) with **Apps: View + Modify** permission, or **Apps: View + Modify + Delete** if you also want to Install/Uninstall apps from the App Store tab — Technitium's API requires the Delete flag for that, not Modify, despite the name
- No .NET installation needed on the host — releases are self-contained per platform

## Configuration

Copy `config.example.json` to `config.json` next to the executable and edit it:

```json
{
  "serverUrl": "http://127.0.0.1:5380",
  "token": "your-api-token",
  "adminSecret": "choose-a-long-random-shared-secret",
  "listenPort": 8099,
  "gitHubRepo": "Hemsby/TDNS-AdvAppConfig",
  "ignoreSslErrors": false
}
```

| Field | Description |
| --- | --- |
| `serverUrl` | Base URL of the Technitium DNS Server web API (the primary node) |
| `token` | API token with Apps permission |
| `adminSecret` | Shared secret required to use this addon's own web UI/API (see Security below) — required, the addon won't start without it |
| `listenPort` | Port this addon's own web page listens on |
| `gitHubRepo` | Repo used for the "check for updates" feature |
| `ignoreSslErrors` | Set true only if the DNS Server uses a self-signed cert you can't otherwise trust |

## Security

- **Shared-secret login.** This addon's own API requires `Authorization: Bearer <adminSecret>` on every `/api/*` call — without it, anyone who could reach the port would have unauthenticated control over every app's config, since `token` above grants Apps:Modify (or more) on the real DNS server. The page shows a login overlay on first load (or if the stored secret is wrong/missing) asking for `adminSecret`; once entered, it's kept in the browser's `localStorage` and attached to every request automatically. The comparison is constant-time to avoid leaking the secret's content through response-timing differences.
- **Config validation before forwarding.** Each app's Save forwards through this addon's own validator for that app's config or record-data shape first — required fields present, correct types, no null/duplicate names where the app itself would crash on reload, network/CIDR and record-type fields checked. A malformed submission is rejected with a specific error instead of reaching Technitium and potentially breaking that app until it's hand-fixed via the official console.
- **Run it as a dedicated unprivileged user**, not root — see the systemd unit in Deployment below. `config.json` holds a Technitium API token in plaintext; keep it `chmod 600` and owned by that user on every deployment.
- **No TLS on the addon's own page** — it's meant for a trusted LAN, same as most self-hosted admin tools. Put it behind a reverse proxy with TLS if you need to reach it over an untrusted network.

## Getting a build

Every tagged release publishes `TDNS-AdvAppConfig-{win-x64,linux-x64,linux-arm64}.zip` to the [Releases page](https://github.com/Hemsby/TDNS-AdvAppConfig/releases/latest) — that's the whole app for that platform, self-contained, nothing else to install. Each zip also bundles the platform-specific deployment helpers (the systemd unit in the Linux zips, the service install/uninstall scripts in the Windows zip), so a git checkout is never required for anything below.

The **Deployment** section for your platform shows exactly where to download and extract it, since the destination matters (e.g. `/opt/tdns-advappconfig` on Linux) — there's no separate generic download step.

## Deployment

### Linux / systemd

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin tdns-advappconfig
mkdir -p /opt/tdns-advappconfig

# swap linux-arm64 for ARM boards
curl -LO https://github.com/Hemsby/TDNS-AdvAppConfig/releases/latest/download/TDNS-AdvAppConfig-linux-x64.zip
unzip TDNS-AdvAppConfig-linux-x64.zip -d /opt/tdns-advappconfig
chmod +x /opt/tdns-advappconfig/TdnsAdvAppConfig

cd /opt/tdns-advappconfig
cp config.example.json config.json   # then edit it (see Configuration below)

chown -R tdns-advappconfig:tdns-advappconfig /opt/tdns-advappconfig
chmod 600 config.json

cp tdns-advappconfig.service /etc/systemd/system/   # bundled in the release zip
systemctl daemon-reload
systemctl enable --now tdns-advappconfig
```

**`Restart=always` is required** (not `on-failure`) — both the self-update feature and a timed pause that outlives the process rely on the service restarting cleanly.

**Runs as a dedicated unprivileged user, not root** — the unit file sets `User=tdns-advappconfig` plus `ProtectSystem=strict`/`ProtectHome=true`/`ReadWritePaths=/opt/tdns-advappconfig`, since the addon only ever needs network access to Technitium's API and read/write access to its own install directory. `config.json` holds a Technitium API token in plaintext, so it's owned by that user and `chmod 600` — restrict it the same way on any deployment, including if you install this by hand instead of following the steps above.

### Windows

```powershell
Invoke-WebRequest -Uri https://github.com/Hemsby/TDNS-AdvAppConfig/releases/latest/download/TDNS-AdvAppConfig-win-x64.zip -OutFile TDNS-AdvAppConfig-win-x64.zip
Expand-Archive TDNS-AdvAppConfig-win-x64.zip -DestinationPath TDNS-AdvAppConfig
cd TDNS-AdvAppConfig
Copy-Item config.example.json config.json   # then edit it (see Configuration below)
```

Extract it anywhere you like — there's no fixed install path on Windows the way there is `/opt` on Linux. `TdnsAdvAppConfig.Updater.exe` must stay in the same folder as `TdnsAdvAppConfig.exe` — it's the helper that swaps files during a self-update (Windows locks a running executable's file, so the main process can't overwrite itself; this tiny helper waits for it to exit, copies the new files in, and relaunches it).

**Installing as a Windows Service (recommended)** — from an **elevated** (Administrator) PowerShell prompt, in that same folder:

```powershell
.\install-service.ps1
```

This registers a service named `TdnsAdvAppConfig` (automatic startup, restarts itself on crash — the closest Windows equivalent to the Linux deployment's `Restart=always`). Manage it with the standard service cmdlets:

```powershell
Start-Service TdnsAdvAppConfig
Stop-Service TdnsAdvAppConfig
Restart-Service TdnsAdvAppConfig
Get-Service TdnsAdvAppConfig
```

(or via `services.msc` / Task Manager's Services tab, same as any other Windows Service). To remove it: `.\uninstall-service.ps1` (also elevated).

When running as a service, self-update stays service-aware: after swapping files, the Updater helper restarts it via `sc start` (through the Service Control Manager) instead of launching the exe directly — so it doesn't end up as an orphaned process while Windows still shows the service as Stopped.

**Running without installing as a service** is also fine for quick testing — just run `TdnsAdvAppConfig.exe` directly from a terminal (closing the terminal stops it).

### Docker

Not yet packaged as an image. If you run it in a container yourself, be aware the in-app "Update" button is informational only for Docker (see below) — binaries inside a container aren't meant to self-modify.

## Dashboard tab

The landing tab lists every installed app that has a single root-level on/off master switch, with its current state and a toggle to flip it immediately — no need to open that app's own Config tab just to turn it on or off. An app moves between the "Enabled" and "Disabled" sections as soon as it's toggled, and its name links straight to its own tab.

Advanced Blocking's own status, pause/resume controls, and per-group management live on its own tab instead, since they're richer than a plain on/off switch:

- A root status badge ("Advanced Blocking Enabled" / "Advanced Blocking Disabled for All Groups") with a **Pause All Groups** / **Resume All Groups** button. This toggles the app's root `enableBlocking` flag, which overrides every group regardless of their individual setting.
- Each group gets its own **Pause** / **Resume** button, toggling that group's `enableBlocking` flag independently. While the root switch is off, the group list still shows each group's own state with a note that they're currently overridden.
- **Timed pause:** the Pause button (root or per-group) has a duration dropdown — Indefinitely, 5/15/30 min, 1 hour, or **Custom…** (a number input plus a minutes/hours picker, for things like "1 minute" or "3 hours"). A timed pause shows a live "resumes in MM:SS" countdown with a "Resume Now" option.
  - The timer lives server-side (not just in the browser tab), so it still fires and auto-resumes blocking even if no browser is open.
  - It's persisted to `pause-timers.json` (next to `config.json`), so a restart — a crash, or the addon's own self-update — doesn't silently lose a pending auto-resume; it's reloaded and honored on startup.
  - While you're actively picking a custom duration, the periodic status refresh pauses itself so it doesn't wipe out what you're typing.

## Per-app tabs

Every app in the Supported apps list gets its own top-level tab, built from the same two building blocks depending on what that app actually needs:

- **Config**: a full form-based editor for that app's JSON config document, in place of the raw-JSON textarea the official console shows — general settings, key-to-group/key-to-set maps rendered as pickers instead of free text, add/rename/delete for named things like groups or sets (with cross-references kept in sync automatically where renaming or deleting one would otherwise leave a dangling reference), and per-field validation before saving.
- **Records**: for apps configured per-domain via APP records rather than one shared document, a list of that app's records in every writable zone, with add/edit/delete and a form for whatever data shape that record type needs (address lists, weighted entries, allowed-network ranges, and so on, depending on the app).

Every editor validates locally before forwarding to Technitium, so a malformed submission is rejected with a specific error instead of reaching the DNS server and potentially breaking that app until it's hand-fixed via the official console.

## App Store tab

Lists installed apps (with an Uninstall button) and available apps from Technitium's own App Store catalog (with an Install button), without leaving this page. A newly installed app's tab appears immediately, using its dedicated editor if one exists above, or the generic raw-JSON fallback otherwise.

## Look and feel

The page vendors Technitium's own web console assets (`bootstrap.min.css`, `main.css`, `dark-mode.css`, `amber-mode.css`, `font-awesome`, favicon, logo) for visual parity — same header bar, same tab styling, same theme mechanism.

The header's options menu (top right, next to the version number) has:
- **Check for updates** / **Update now** (see below)
- **Theme**: Auto / Light / Dark / Amber — mirrors the official console exactly (a class on `<body>`, persisted in `localStorage`, following your system preference when set to Auto)

## Self-update

The options menu shows the current version with a "Check for updates" link. If a newer GitHub release exists:

- **Linux/systemd:** downloads the new build, replaces the files in place, and exits — systemd's `Restart=always` brings it back up on the new version.
- **Windows:** downloads the new build, hands off to `TdnsAdvAppConfig.Updater.exe` (which waits for the main process to exit, swaps the files, and relaunches it).
- **Docker:** the "Update" button reports that Docker deployments should be updated via `docker compose pull && docker compose up -d` on the host instead.

## Known limitations

- No multi-node config / auto primary-detection — you point it at one server URL, which must be the primary if clustered.
- Docker has no one-click update path yet.
- A Technitium app released after this project's last update falls back to a generic raw-JSON tab until a dedicated editor is added for it.
