# OnyxAz Windows installer

`onyxaz.iss` is an [Inno Setup](https://jrsoftware.org/isinfo.php) script that produces
`OnyxAz-Setup.exe` — a double-click installer that copies the plugin into a user's
Obsidian vault and writes `onyxaz.config.json`. **It copies prebuilt files; it never
builds the project.**

## Building the installer

1. Build the plugin from the repo root:
   ```bash
   npm run build
   ```
2. Open `installer/onyxaz.iss` and edit the three `#define` lines near the top to
   pre-fill your organization's details (so employees don't type GUIDs):
   ```
   #define DefaultOrgUrl "https://dev.azure.com/yourorg"
   #define DefaultClientId "your-application-client-id"
   #define DefaultTenantId "organizations"   ; or your directory (tenant) ID
   ```
3. Install [Inno Setup 6+](https://jrsoftware.org/isdl.php) and compile:
   ```
   ISCC installer\onyxaz.iss
   ```
   This produces `installer\Output\OnyxAz-Setup.exe`.

## What the installer does

- Asks the user to select their Obsidian **vault folder** (warns if it has no `.obsidian`).
- Shows the org URL / client ID / tenant ID, pre-filled from your `#define` defaults
  and editable by the user.
- Copies `main.js`, `manifest.json`, `styles.css` into
  `<vault>\.obsidian\plugins\onyxaz\`.
- Writes `onyxaz.config.json` there with the entered values.

The user then enables **OnyxAz** in Obsidian → Community plugins and signs in with
their work email — the connection is already configured.

## Prefer no installer?

Use `node scripts/package-org.mjs` (see the repo README) to produce a ready-to-extract
folder + zip instead. It's cross-platform and needs no Inno Setup.

> **True `.msi` for GPO/SCCM?** This script targets Inno Setup (a `setup.exe`), which
> covers the double-click case. If you need a Windows Installer `.msi` for managed
> deployment, the same file-copy + config-write logic can be expressed with the
> [WiX Toolset](https://wixtoolset.org/) — open an issue if you need that.
