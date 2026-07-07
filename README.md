# OnyxAz

[![Build](https://github.com/samdotson61/OnyxAz/actions/workflows/build.yml/badge.svg)](https://github.com/samdotson61/OnyxAz/actions/workflows/build.yml)

Sync your Obsidian vault with an Azure DevOps Git repository — no git installation required.

OnyxAz uses the Azure DevOps REST API directly (via Obsidian's cross-platform `requestUrl`), so it works without a local git binary. It mirrors the experience of [obsidian-git](https://github.com/Vinzent03/obsidian-git) but is built specifically for ADO's org → project → repository → branch structure.

> **Platform note:** OnyxAz is built and tested on desktop. The REST API layer is cross-platform, so mobile may work, but the Microsoft sign-in browser hand-off is currently untested on mobile — use a Personal Access Token there if SSO doesn't complete.

---

## Requirements

| Requirement | Notes |
|---|---|
| Obsidian | v1.4.0 or later |
| Azure DevOps | Any ADO organization (cloud or on-prem with API access) |
| Auth | Microsoft Entra (Azure AD) SSO **or** a Personal Access Token |
| Git | **Not required** — OnyxAz uses the REST API directly |

---

## Deploying in Your Organization

> **IT admins — this is the whole job.** Register one Azure app, then send your team a short "setup document" with two values. There is nothing to build, bake, or install per-machine — users get OnyxAz the normal way and configure it on the sign-in screen.

### 1. Register the Azure app (one-time)

1. In the [Azure portal](https://portal.azure.com), go to **Azure Active Directory → App registrations → New registration**
2. Name it anything (e.g. `OnyxAz`)
3. Supported account types: **Accounts in this organizational directory only**
4. No redirect URI needed — click **Register**
5. On the app overview page, copy the **Application (client) ID**
6. Go to **Authentication → Add a platform → Mobile and desktop**, tick / add these redirect URIs, and enable **Allow public client flows**:
   - `http://localhost` — **required** for the default browser sign-in (authorization code + PKCE). Because sign-in happens in the user's real browser, device-based Conditional Access ("require compliant/managed device") is satisfied on managed machines.
   - `https://login.microsoftonline.com/common/oauth2/nativeclient` — used by the fallback code sign-in. Note the fallback carries no device identity, so device-compliance policies will block it (AADSTS530033).
7. Go to **API permissions → Add a permission → APIs my organization uses** → search **Azure DevOps** → select **user_impersonation** → Add

> The **tenant ID is detected automatically** from each user's email domain — you don't need to distribute it.

### 2. Give your team a setup document

Send users a note (email, wiki page, or doc) containing just these two values:

```
Organization URL:        https://dev.azure.com/yourorg
Application (client) ID:  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

On the sign-in screen, users click **📋 Paste setup document to autofill** and paste this text — OnyxAz scrapes both values out automatically (plain text or JSON both work). Or they type the client ID by hand. Either way, the only thing they personally provide is their work email.

See **[`SETUP-EXAMPLE.txt`](SETUP-EXAMPLE.txt)** for a ready-to-edit template — fill in your org URL and client ID and send it to your team alongside `Install OnyxAz.cmd`.

That's it. No packaging step, no installer to build, no config files to ship.

---

## Quick Install

No release zip, no build — you only need the installer and (for SSO) a setup document.

1. Get **[`Install OnyxAz.cmd`](scripts/Install%20OnyxAz.cmd)** (Windows) — or `scripts/install.sh` for macOS/Linux. Your IT team can hand it to you directly along with your setup document. It's one self-contained file — no separate scripts, no admin rights.
2. **Windows:** **double-click `Install OnyxAz.cmd`**.  **macOS / Linux:** run `bash install.sh`.
3. Pick your vault from the list it shows, or choose **[N] Create a NEW vault** to point at a fresh folder (it'll be created for you — then open it in Obsidian via *Open folder as vault*). The installer **downloads OnyxAz from GitHub** and copies it into `…/.obsidian/plugins/onyxaz/` — no admin rights needed.
4. Open Obsidian → **Settings → Community plugins** → enable **OnyxAz**, then follow the setup screen.

> **Offline / locked-down network:** if your machine can't reach GitHub, put `main.js`, `manifest.json`, and `styles.css` in the same folder as the installer — it uses those instead of downloading.

**Manual alternative:** copy `main.js`, `manifest.json`, and `styles.css` into `<your-vault>/.obsidian/plugins/onyxaz/` yourself, then enable the plugin.

---

## Setup

OnyxAz guides you through a setup wizard on first install. No Azure portal access is required as an end user.

### Step 1 — Organization URL & sign-in method

Enter your ADO organization URL (e.g. `https://dev.azure.com/myorg`) and choose **SSO for Teams**.

### Step 2 — Sign in with Microsoft

On the sign-in screen:

1. If your IT team gave you a **setup document**, click **📋 Paste setup document to autofill** and paste it — the organization URL and client ID fill in automatically.
2. Enter your **organization email** (e.g. `you@company.com`). Your tenant is detected from it automatically — no tenant ID to look up.
3. Make sure the **Azure client ID** field is filled (autofilled from the setup document, or type it from your admin).
4. Click **Sign in with Microsoft**. Your browser opens — sign in there, then return to Obsidian. Token refresh is automatic afterward. (If the browser hand-off can't complete, use **"Browser sign-in not working? Use a code instead"** for the code-based fallback.)

### Step 3 — Pick a repository

A tree picker shows all projects and repositories you have access to. Expand a project, expand a repo, and click a branch to select it. Click **Connect**.

Files will sync into `ADO/<ProjectName>/` inside your vault automatically.

### Alternative: Personal Access Token

If device code sign-in is blocked by your network, go to **Settings → OnyxAz → Advanced** and switch to **Personal Access Token**. Create a PAT in Azure DevOps with **Code (Read & Write)** scope and paste it there.

---

## Vault folder layout

By default, OnyxAz places synced files under `<org>_ADO/<project>/<repo>/<branch>/`, where `<org>` comes from your organization URL (e.g. `dev.azure.com/myorg` → `myorg_ADO`). This namespaces by organization and keeps different repos **and different branches** in separate folders, with the branch visible right in the file tree:

```
My Vault/
├── myorg_ADO/
│   └── My Project/
│       └── My Repo/
│           ├── main/          ← the "main" branch
│           │   └── README.md
│           └── dev/           ← the "dev" branch, kept separate
│               └── README.md
├── .onyxaz/                   ← internal state (never synced)
└── .obsidian/
```

To override the layout, go to **Settings → OnyxAz → Azure DevOps → Local sync folder** and enter a custom path (or leave blank to use the default).

> **Upgrading from an older layout?** OnyxAz detects the changed folder path automatically, clears its sync state, and prompts you to **Force re-pull** — which downloads everything into the new `<org>_ADO/<project>/<repo>/<branch>/` folders. Your old `ADO/...` folder is left untouched; delete it once you've confirmed the new sync.

---

## Hub

Click the **OnyxAz icon** in the left ribbon to open the Hub. From there you can:

- See your current connection (project, repo, branch, vault folder, last sync time, pending changes)
- **Pull & sync** — pull remote changes, then show a push confirmation if you have local changes
- **Push changes** — upload local changes with a per-file confirmation
- **Switch repository** — pick a different project/repo/branch without re-running the wizard
- **Force re-pull** — wipe local sync state and re-download everything from the remote
- **Mirror entire organization (pull-only)** — see below
- **Open in Azure DevOps** — jump to the repo in your browser

---

## Mirroring the whole organization (two-way)

Browse and sync your entire ADO org without downloading it all up front. Enable it via **Mirror entire organization** (Hub button, the `OnyxAz: Mirror organization` command, or the **Settings → OnyxAz → Mirror organization** toggle).

- It creates an **empty folder per project** under `<org>_ADO/` — fast, almost no bandwidth.
- **Clicking a project folder** in the file explorer pulls that project's repos (each repo's default branch) into `<org>_ADO/<project>/<repo>/<branch>/`. You only download the projects you open.
- Each mirrored repo keeps **its own commit state**, so pulls are **incremental**. A pull only downloads files **not already on your device**; existing files are never silently overwritten. `Pull current repo` prompts you (like push) before overwriting any local file that has changed on ADO. On startup, projects you've already opened are refreshed automatically.
- Pulls are **fault-tolerant**: a few large/slow files that time out don't abort the batch or re-download everything — they're just fetched on the next pull. Pushes run independently of pulls, so a long pull never blocks a push.

**It works like GitHub Desktop, per repo:**

| Action | How |
|---|---|
| Pull the repo you're in | `OnyxAz: Pull current repo` |
| Push the repo you're in | `OnyxAz: Push current repo` — shows the per-file confirmation; commits + pushes **only that repo** |

There is **never a blanket org-wide push** — you push one repo at a time, and every push requires the confirmation checkbox. "Current repo" = the mirrored repo containing the file you have open.

> Click-to-pull works by listening to the file-explorer folder elements (Obsidian has no dedicated folder-click event). If a future Obsidian update changes the explorer and clicking stops triggering a pull, re-run the **Mirror organization** command to refresh.

---

## Push confirmation

Every push requires explicit, deliberate confirmation. Before anything is sent to the remote, a dialog shows:

- **Destination** — which project, repo, and branch will receive the changes
- **File list** — files grouped as Added / Modified / Deleted, collapsible
- **Warning** — reminder that this writes to the remote and cannot be automatically undone
- **Commit message** — editable before confirming
- **Confirmation checkbox** — the **Push** button stays disabled until you tick *"Yes — push N files to …"*, so a push never happens on a stray click

Nothing is sent until you tick the box and click **Push N files to remote →**.

---

## Pull conflict resolution

If a file changed in the remote repository **and** already exists in your local vault, OnyxAz will ask before overwriting:

- **Source** — which project, repo, and branch the changes are coming from
- **Per-file toggle** — choose **Overwrite** (take the remote version) or **Keep local** for each file
- **Bulk actions** — Overwrite all / Keep all local
- **Live summary** — shows how many files will be overwritten vs kept as you decide
- **Confirm button** — its label updates to reflect your choices, e.g. "Overwrite 2 files ↓"

Cancelling keeps all local files unchanged.

New files that don't yet exist locally are always downloaded silently.

---

## Commands

All commands are available from the command palette (`Ctrl/Cmd + P`):

| Command | Description |
|---|---|
| `OnyxAz: Open hub` | Open the Hub panel |
| `OnyxAz: Switch repository` | Pick a different repo (same as Hub → Switch) |
| `OnyxAz: Commit and sync` | Pull then push (with confirmation) |
| `OnyxAz: Pull` | Download remote changes |
| `OnyxAz: Push` | Upload local changes (with confirmation) |
| `OnyxAz: Force re-pull` | Wipe state and re-download all remote files |
| `OnyxAz: Mirror organization` | Scaffold a folder per project (two-way mirror) |
| `OnyxAz: Pull current repo` | Pull the mirrored repo of the open file |
| `OnyxAz: Push current repo` | Commit + push the mirrored repo of the open file |
| `OnyxAz: List changed files` | Show what would be pushed |
| `OnyxAz: Toggle automatic sync` | Pause / resume scheduled pulls |
| `OnyxAz: Recover` | Reset a stuck or hung sync |
| `OnyxAz: Check for updates` | Update the plugin from GitHub now |
| `OnyxAz: Reload plugin` | Disable + re-enable to apply a downloaded update |
| `OnyxAz: Open repository in Azure DevOps` | Open the repo in your browser |

---

## Automation

Configure in **Settings → OnyxAz → Automation**:

- **Auto pull interval** — pull on a schedule (1 min – 1 hour). Pull-only; push always requires confirmation.
- **Second auto pull interval** — a second independent pull schedule.
- **Auto sync on save** — pull after you stop editing a file (debounced).
- **Pull on startup** — pull when Obsidian opens.

---

## Updating the plugin

Enable **Settings → OnyxAz → Auto-update from GitHub** to have OnyxAz check for a newer build on startup and download it automatically (you'll be prompted to reload). Or click **Check now** there, or run **`OnyxAz: Check for updates`** any time. After an update downloads, run **`OnyxAz: Reload plugin`** (or restart Obsidian) to apply it.

---

## If a sync gets stuck

OnyxAz tries hard to keep syncs healthy on its own:

- Files download **in parallel** (up to 8 at once), so large pulls finish much faster, with a live count/bar.
- Each request **times out after 60 s**, so a stalled connection can't block the queue.
- Pulls **auto-retry** up to 2 times on a transient error before giving up.

If something still wedges, run **`OnyxAz: Recover`** (or the **Recover** button in the Hub) to clear any queued/stuck operations and reset — then try again.

---

## Documents only

By default OnyxAz syncs **only document files** — Markdown, text, PDFs, Office
documents, and the image/diagram types notes commonly embed. Source code,
binaries, and build artifacts in a repo are skipped entirely: they're never
counted, downloaded, or pushed, so a documentation repo doesn't drag its whole
build output into your vault.

Toggle this and edit the allowed extension list under **Settings → OnyxAz →
Documents only**. Turn it off to mirror every file in the repo.

## Ignoring files

OnyxAz always ignores:

- `.onyxaz/` — internal state directory
- `.obsidian/workspace.json`
- `.obsidian/workspace-mobile.json`

To ignore additional files, create a `.onyxazignore` file in your vault root. It supports a practical subset of `.gitignore` syntax:

```
*.pdf          # any file ending in .pdf
private/       # a folder and everything under it
scratch.md     # a specific file
# lines starting with # are comments
```

---

## How it works

OnyxAz uses the [Azure DevOps Git REST API v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/?view=azure-devops-rest-7.1) and Obsidian's `requestUrl` API (which bypasses the Electron Content Security Policy that blocks native `fetch` for cross-origin requests).

**Pull:** Fetches the remote file tree, compares each file's `objectId` (content hash) against the last-known state stored in `.onyxaz/state.json`, and downloads only files that changed or are missing locally. Files are written via the vault adapter directly so all extensions (`.txt`, `.pdf`, etc.) are handled regardless of Obsidian's file index.

**Push:** Scans the vault using the adapter (not just Obsidian's indexed files) to find all files inside the sync folder. Compares modification times against the last sync timestamp to detect changes, then uploads everything as a single ADO commit via the pushes API. Binary files are base64-encoded.

**Auth:** Microsoft Entra sign-in uses the OAuth 2.0 authorization code flow with PKCE — OnyxAz opens your system browser and catches the redirect on a local loopback listener, so device-based Conditional Access policies are honored. A device-code flow remains as a fallback for environments where the browser hand-off can't complete (note: it carries no device identity). The access token is refreshed automatically using the stored refresh token. PAT auth uses HTTP Basic with a blank username.

**Secrets at rest:** tokens and PATs are encrypted with the OS keychain (Electron `safeStorage` — DPAPI on Windows, Keychain on macOS, libsecret on Linux) before being written to `data.json`, so vault sync/backup never carries usable credentials. Values encrypted on one machine can't be decrypted on another — you simply sign in again there. If the keychain is unavailable the plugin degrades to plaintext rather than locking you out.

**Sync state** is stored in `.onyxaz/state.json` and records the last commit ID, last sync timestamp, remote object IDs for every file, and the current sync folder path. If the sync folder path changes, the state is automatically invalidated and a Force re-pull is needed.

---

## Building from source

```bash
git clone <this-repo>
cd OnyxAz
npm install
npm run dev       # watch mode (no minification)
npm run build     # production build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder after building.

---

## Versioning

| Bump | When |
|---|---|
| **patch** `0.x.Y` | Bug fixes, small polish |
| **minor** `0.X.0` | New features or significant UX changes |
| **major** `X.0.0` | Breaking changes (settings format, API) |

---

## License

MIT
