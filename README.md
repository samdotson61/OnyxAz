# OnyxAz

Sync your Obsidian vault with an Azure DevOps Git repository — automatically.

OnyxAz mirrors the experience of [obsidian-git](https://github.com/Vinzent03/obsidian-git) but uses the Azure DevOps REST API directly, so it works without a local git installation and handles the ADO org/project/repo structure natively.

## Features

- **Commit and sync** — pull remote changes, then push local changes in one command
- **Auto-sync on a schedule** — configurable interval (1 min – 1 hour)
- **Auto-sync on save** — debounced push after you stop editing
- **Auto-pull** — separate pull-only schedule
- **Pull on startup** — stay in sync when Obsidian opens
- **Status bar** — shows last sync time and current action
- **Commit message templates** — `{{date}}`, `{{numFiles}}`, `{{vaultName}}`
- **Open in ADO** — jump to your repo in the browser
- **Mobile compatible** — uses only Web APIs (no git binary required)

## Installation

### From community plugins (once listed)

1. Open Obsidian → Settings → Community plugins
2. Search for **OnyxAz**
3. Install and enable

### Manual install

1. Download `main.js`, `manifest.json`, `styles.css` from the latest [release](../../releases)
2. Copy them into `<vault>/.obsidian/plugins/onyxaz/`
3. Enable the plugin in Settings → Community plugins

## Setup

1. In Azure DevOps, create a Personal Access Token (PAT) with **Code (Read & Write)** scope
2. Open Settings → OnyxAz
3. Enter your **Organization URL** (e.g. `https://dev.azure.com/myorg`)
4. Paste your **PAT**
5. Enter the **Project** and **Repository** names
6. Set the **Branch** (default: `main`)
7. Click **Test** to verify the connection

## Usage

| Command | Description |
|---|---|
| `OnyxAz: Commit and sync` | Pull then push all local changes |
| `OnyxAz: Pull` | Download remote changes |
| `OnyxAz: Push` | Upload local changes |
| `OnyxAz: List changed files` | See what would be pushed |
| `OnyxAz: Toggle automatic sync` | Pause / resume scheduled sync |
| `OnyxAz: Open repository in Azure DevOps` | Open the repo in your browser |

## Ignoring files

Create a `.onyxazignore` file in your vault root. Uses the same syntax as `.gitignore`.

The following paths are always ignored:
- `.onyxaz/` (internal state directory)
- `.obsidian/workspace.json`
- `.obsidian/workspace-mobile.json`

## How it works

OnyxAz uses the [Azure DevOps Git REST API v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/?view=azure-devops-rest-7.1) to read and write files directly — no git binary needed.

**Pull:** Fetches the remote file tree, compares object IDs against the last-known state, and downloads only changed files.

**Push:** Detects locally modified files by comparing modification times against the last sync timestamp, then uploads all changes as a single commit via the ADO pushes API.

State is stored in `.onyxaz/state.json` inside your vault.

## Building from source

```bash
npm install
npm run dev       # watch mode
npm run build     # production build
```

## License

MIT
