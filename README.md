# OnyxAz

Sync your Obsidian vault with an Azure DevOps Git repository — no git installation required.

OnyxAz uses the Azure DevOps REST API directly, so it works on any machine (including mobile) without a local git binary. It mirrors the experience of [obsidian-git](https://github.com/Vinzent03/obsidian-git) but is built specifically for ADO's org → project → repository → branch structure.

---

## Requirements

| Requirement | Notes |
|---|---|
| Obsidian | v1.4.0 or later |
| Azure DevOps | Any ADO organization (cloud or on-prem with API access) |
| Auth | Microsoft Entra (Azure AD) SSO **or** a Personal Access Token |
| Git | **Not required** — OnyxAz uses the REST API directly |

---

## Quick Install

OnyxAz is not yet listed in the Obsidian Community Plugins directory. Install manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](../../releases/latest)
2. Create the folder `<your-vault>/.obsidian/plugins/onyxaz/`
3. Copy the three files into that folder
4. Open Obsidian → **Settings → Community plugins**
5. Toggle **OnyxAz** on

---

## Setup

OnyxAz guides you through a setup wizard on first install.

### Step 1 — Register an Azure app (one-time, per organization)

Microsoft Entra sign-in requires an Azure app registration. An Azure AD admin at your organization does this once; everyone else just signs in.

1. In the [Azure portal](https://portal.azure.com), go to **Azure Active Directory → App registrations → New registration**
2. Name it anything (e.g. `OnyxAz`)
3. Supported account types: **Accounts in this organizational directory only** (or Multitenant if needed)
4. No redirect URI needed — click **Register**
5. On the app overview page, copy the **Application (client) ID** and **Directory (tenant) ID**
6. Go to **Authentication → Add a platform → Mobile and desktop** and add `https://login.microsoftonline.com/common/oauth2/nativeclient` as a redirect URI. Enable **Allow public client flows**.
7. Go to **API permissions → Add a permission → APIs my organization uses** → search for **Azure DevOps** → select **user_impersonation** → Add

Paste the Client ID into **Settings → OnyxAz → Advanced → Azure App Client ID**.  
The Tenant ID can be left as `organizations` for most setups, or set to your specific directory ID.

> **Distributing internally?** Hard-code the Client ID into the plugin before distributing by setting `ONYX_AZ_DEFAULT_CLIENT_ID` in `src/constants.ts`. End-users then see a one-click sign-in with no app configuration required.

### Step 2 — Organization URL

Enter your ADO organization URL, e.g.:

```
https://dev.azure.com/myorg
```

### Step 3 — Sign in with Microsoft

Click **Sign in with Microsoft**. A device code will appear — open the link in your browser, enter the code, and sign in with your work account. The plugin handles token refresh automatically.

### Step 4 — Pick a repository

A tree picker shows all projects and repositories you have access to. Expand a project, expand a repo, and click a branch to select it. Click **Connect**.

Files will sync into `ADO/<ProjectName>/` inside your vault automatically.

### Alternative: Personal Access Token

If device code sign-in is blocked by your network, go to **Settings → OnyxAz → Advanced** and switch to **Personal Access Token**. Create a PAT in Azure DevOps with **Code (Read & Write)** scope and paste it there. No Azure app registration needed for PAT auth.

---

## Vault folder layout

By default, OnyxAz places synced files in a subfolder named after your project:

```
My Vault/
├── ADO/
│   └── My Project/         ← files from the connected repo live here
│       ├── README.md
│       └── notes/
│           └── my-note.md
├── .onyxaz/                ← internal state (never synced)
└── .obsidian/
```

This keeps multiple repos separated if you connect to more than one. To override the folder, go to **Settings → OnyxAz → Azure DevOps → Local sync folder** and enter a custom path (or leave blank to sync at the vault root).

---

## Hub

Click the **OnyxAz icon** in the left ribbon to open the Hub. From there you can:

- See your current connection (project, repo, branch, vault folder, last sync time, pending changes)
- **Pull & sync** — pull remote changes, then show a push confirmation if you have local changes
- **Push changes** — upload local changes with a per-file confirmation
- **Switch repository** — pick a different project/repo/branch without re-running the wizard
- **Force re-pull** — wipe local sync state and re-download everything from the remote
- **Open in Azure DevOps** — jump to the repo in your browser

---

## Push confirmation

Every push requires explicit confirmation. Before anything is sent to the remote, a dialog shows:

- **Destination** — which project, repo, and branch will receive the changes
- **File list** — files grouped as Added / Modified / Deleted, collapsible
- **Warning** — reminder that this writes to the remote and cannot be automatically undone
- **Commit message** — editable before confirming

Nothing is sent until you click **Push N files to remote →**.

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
| `OnyxAz: List changed files` | Show what would be pushed |
| `OnyxAz: Toggle automatic sync` | Pause / resume scheduled pulls |
| `OnyxAz: Open repository in Azure DevOps` | Open the repo in your browser |

---

## Automation

Configure in **Settings → OnyxAz → Automation**:

- **Auto pull interval** — pull on a schedule (1 min – 1 hour). Pull-only; push always requires confirmation.
- **Second auto pull interval** — a second independent pull schedule.
- **Auto sync on save** — pull after you stop editing a file (debounced).
- **Pull on startup** — pull when Obsidian opens.

---

## Ignoring files

OnyxAz always ignores:

- `.onyxaz/` — internal state directory
- `.obsidian/workspace.json`
- `.obsidian/workspace-mobile.json`

To ignore additional files, create a `.onyxazignore` file in your vault root using the same syntax as `.gitignore`.

---

## How it works

OnyxAz uses the [Azure DevOps Git REST API v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/?view=azure-devops-rest-7.1) and Obsidian's `requestUrl` API (which bypasses the Electron Content Security Policy that blocks native `fetch` for cross-origin requests).

**Pull:** Fetches the remote file tree, compares each file's `objectId` (content hash) against the last-known state stored in `.onyxaz/state.json`, and downloads only files that changed or are missing locally. Files are written via the vault adapter directly so all extensions (`.txt`, `.pdf`, etc.) are handled regardless of Obsidian's file index.

**Push:** Scans the vault using the adapter (not just Obsidian's indexed files) to find all files inside the sync folder. Compares modification times against the last sync timestamp to detect changes, then uploads everything as a single ADO commit via the pushes API. Binary files are base64-encoded.

**Auth:** Microsoft Entra uses the OAuth 2.0 device code flow against `login.microsoftonline.com`. The access token is refreshed automatically using the stored refresh token. PAT auth uses HTTP Basic with a blank username.

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
