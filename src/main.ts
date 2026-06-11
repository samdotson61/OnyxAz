import { Notice, Plugin, addIcon, normalizePath, requestUrl } from "obsidian";
import { DEFAULT_SETTINGS, ONYXAZ_REPO_RAW } from "./constants";
import { compareVersions } from "./util/version";
import type { FileStatus, OnyxAzSettings, SyncStatus } from "./types";
import { CurrentAdoAction } from "./types";
import { AdoApiManager } from "./adoManager/adoApiManager";
import type { AdoManager } from "./adoManager/adoManager";
import { AutomaticsManager } from "./automaticsManager";
import { EntraAuth } from "./auth/entraAuth";
import { PromiseQueue } from "./promiseQueue";
import { StatusBar } from "./statusBar";
import { OnyxAzSettingsTab } from "./setting/settings";
import { OnboardingModal } from "./ui/onboardingModal";
import { ConfirmPushModal } from "./ui/confirmPushModal";
import { ConfirmPullModal } from "./ui/confirmPullModal";
import { HubModal } from "./ui/hubModal";

const ONYXAZ_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="80" height="80" rx="10" fill="none" stroke="currentColor" stroke-width="8"/>
  <path d="M30 70 L50 30 L70 70" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/>
  <line x1="37" y1="55" x2="63" y2="55" stroke="currentColor" stroke-width="8"/>
</svg>`;

export default class OnyxAz extends Plugin {
    settings!: OnyxAzSettings;
    adoManager!: AdoManager;
    automaticsManager!: AutomaticsManager;
    entraAuth!: EntraAuth;
    promiseQueue!: PromiseQueue;
    cachedStatus: SyncStatus | null = null;

    state = { adoAction: CurrentAdoAction.idle };

    // Org-mirror: maps a scaffolded project folder path -> ADO project name, and
    // tracks which projects are already pulled / in flight (avoids re-pulling on
    // every folder click).
    orgProjectFolders: Map<string, string> = new Map();
    private hydratedProjects = new Set<string>();

    private statusBarItem: StatusBar | null = null;
    private statusBarEl: HTMLElement | null = null;
    private statusBarInterval: ReturnType<typeof setInterval> | null = null;

    async onload(): Promise<void> {
        await this.loadSettings();
        addIcon("onyxaz", ONYXAZ_ICON);

        this.entraAuth = new EntraAuth(this);
        this.adoManager = new AdoApiManager(this);
        this.promiseQueue = new PromiseQueue(this);
        this.automaticsManager = new AutomaticsManager(this);

        this.addSettingTab(new OnyxAzSettingsTab(this.app, this));
        this.refreshStatusBar();

        this.addRibbonIcon("onyxaz", "OnyxAz: Open hub", () => {
            new HubModal(this.app, this).open();
        });

        this.registerCommands();

        // Org-mirror: clicking a scaffolded project folder pulls that project.
        // Obsidian has no folder-click event, so we delegate off the file
        // explorer's folder-title elements (which carry a data-path).
        this.registerDomEvent(document, "click", (evt) => {
            const title = (evt.target as HTMLElement)?.closest?.(".nav-folder-title") as HTMLElement | null;
            const path = title?.getAttribute("data-path");
            if (path) this.handleFolderClick(path);
        });

        this.app.workspace.onLayoutReady(async () => {
            if (!this.settings.hasCompletedOnboarding) {
                // First install — guide the user through setup
                new OnboardingModal(this.app, this).open();
            } else if (this.settings.pullOnStartup && this.isConfigured()) {
                this.promiseQueue.addTask(() => this.pull());
            }
            // Rebuild the project-folder map so click-to-pull works after restart.
            if (this.settings.orgMirror && this.isConfigured()) {
                this.adoManager.scaffoldOrg().then((m) => { this.orgProjectFolders = m; }).catch(() => {});
            }
            // Quietly check GitHub for a newer plugin build, if enabled.
            if (this.settings.autoUpdate) {
                this.checkForUpdate(false).catch(() => {});
            }
            this.automaticsManager.init();
            await this.updateCachedStatus();
        });
    }

    onunload(): void {
        this.automaticsManager.unload();
        this.statusBarItem?.remove();
        if (this.statusBarInterval !== null) clearInterval(this.statusBarInterval);
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    // ── Commands ──────────────────────────────────────────────────────────────

    private registerCommands(): void {
        this.addCommand({
            id: "open-hub",
            name: "Open hub",
            callback: () => new HubModal(this.app, this).open(),
        });

        this.addCommand({
            id: "switch-repository",
            name: "Switch repository",
            callback: () => new HubModal(this.app, this).open(),
        });

        this.addCommand({
            id: "commit-and-sync",
            name: "Commit and sync",
            callback: () => this.promiseQueue.addTask(() => this.commitAndSync()),
        });

        this.addCommand({
            id: "pull",
            name: "Pull",
            callback: () => this.promiseQueue.addTask(() => this.pull()),
        });

        this.addCommand({
            id: "push",
            name: "Push",
            callback: () => this.promiseQueue.addTask(() => this.push()),
        });

        this.addCommand({
            id: "list-changed-files",
            name: "List changed files",
            callback: async () => {
                if (!this.isConfigured()) {
                    new Notice("OnyxAz: Finish setup first — open Settings → OnyxAz.");
                    return;
                }
                try {
                    const status = await this.adoManager.getStatus();
                    if (status.changed.length === 0) {
                        new Notice("OnyxAz: No local changes.");
                    } else {
                        const lines = status.changed.map((f) => `${f.status} ${f.path}`).join("\n");
                        new Notice(`OnyxAz: ${status.changed.length} changed file(s):\n${lines}`, 8000);
                    }
                } catch (e) {
                    this.displayError(e);
                }
            },
        });

        this.addCommand({
            id: "force-pull",
            name: "Force re-pull (re-download all remote files)",
            callback: () => this.promiseQueue.addTask(() => this.forcePull()),
        });

        this.addCommand({
            id: "mirror-organization",
            name: "Mirror organization (scaffold project folders, pull-only)",
            callback: () => this.mirrorOrganization(),
        });

        this.addCommand({
            id: "recover",
            name: "Recover (reset a stuck or hung sync)",
            callback: () => this.recover(),
        });

        this.addCommand({
            id: "check-for-updates",
            name: "Check for updates",
            callback: () => this.checkForUpdate(true),
        });

        this.addCommand({
            id: "reload",
            name: "Reload plugin (apply a downloaded update)",
            callback: () => this.reloadSelf(),
        });

        this.addCommand({
            id: "toggle-automatics",
            name: "Toggle automatic sync",
            callback: () => {
                if (this.automaticsManager.isPaused) {
                    this.automaticsManager.resume();
                    new Notice("OnyxAz: Automatic sync resumed.");
                } else {
                    this.automaticsManager.pause();
                    new Notice("OnyxAz: Automatic sync paused.");
                }
            },
        });

        this.addCommand({
            id: "open-in-ado",
            name: "Open repository in Azure DevOps",
            callback: () => {
                const s = this.settings;
                if (!s.organizationUrl || !s.project || !s.repository) {
                    new Notice("OnyxAz: Finish setup first — open Settings → OnyxAz.");
                    return;
                }
                const url = `${s.organizationUrl.replace(/\/$/, "")}/${encodeURIComponent(s.project)}/_git/${encodeURIComponent(s.repository)}`;
                window.open(url, "_blank");
            },
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    // Called after switching repos so state, status, and automatics all reset cleanly.
    async resetConnection(): Promise<void> {
        this.adoManager.resetState();
        this.cachedStatus = null;
        this.automaticsManager.reload();
        await this.updateCachedStatus();
    }

    // ── Organization mirror (pull-only) ───────────────────────────────────────

    // Scaffolds an empty folder per project under <org>_ADO/. Clicking a folder
    // then pulls that project. Never pushes.
    async mirrorOrganization(): Promise<void> {
        if (!this.isConfigured()) {
            new Notice("OnyxAz: Finish setup first — open Settings → OnyxAz.");
            return;
        }
        this.settings.orgMirror = true;
        await this.saveSettings();
        this.setState(CurrentAdoAction.pull);
        try {
            this.orgProjectFolders = await this.adoManager.scaffoldOrg();
            new Notice(
                `OnyxAz: Created ${this.orgProjectFolders.size} project folder(s) under "${this.adoManager.getOrgRoot()}/". ` +
                `Click a project to pull its repos.`,
                8000
            );
        } catch (e) {
            this.displayError(e);
        } finally {
            this.setState(CurrentAdoAction.idle);
        }
    }

    // Called for every file-explorer folder click; pulls the project if the
    // clicked folder is an un-hydrated scaffolded project folder.
    private handleFolderClick(folderPath: string): void {
        const project = this.orgProjectFolders.get(folderPath);
        if (!project || this.hydratedProjects.has(project)) return;
        this.hydratedProjects.add(project);

        // Brief feedback so clicking several projects doesn't feel hung — each is
        // queued and pulled in turn (the persistent progress notice appears when
        // its turn comes). A stalled request now times out (see apiFetch) instead
        // of blocking the queue forever.
        new Notice(`OnyxAz: Queued "${project}".`, 2500);

        this.promiseQueue.addTask(async () => {
            const progress = new Notice(`OnyxAz: Pulling "${project}"…`, 0);
            this.setState(CurrentAdoAction.pull);
            try {
                const { repos, files } = await this.adoManager.hydrateProject(project, (count, repo) => {
                    progress.setMessage(`OnyxAz: Pulling "${project}"\n${repo} — ${count} file(s)…`);
                });
                progress.hide();
                new Notice(`OnyxAz: Pulled ${files} file(s) from ${repos} repo(s) in "${project}".`, 6000);
                this.app.workspace.trigger("onyxaz:refresh");
            } catch (e) {
                progress.hide();
                this.hydratedProjects.delete(project); // allow retry on failure
                this.displayError(e);
            } finally {
                this.setState(CurrentAdoAction.idle);
            }
        });
    }

    // ── Recovery & self-update ─────────────────────────────────────────────────

    // Clears any stuck/queued operations and resets state — the escape hatch if a
    // sync hangs or a project pull gets wedged.
    recover(): void {
        this.promiseQueue.clear();
        this.hydratedProjects.clear();
        this.setState(CurrentAdoAction.idle);
        this.cachedStatus = null;
        this.updateCachedStatus().catch(() => {});
        new Notice("OnyxAz: Reset. Cleared any stuck/queued sync — you can try again.", 5000);
    }

    // Checks GitHub for a newer plugin build and, if found, downloads it into the
    // plugin folder. `manual` controls whether "up to date" / errors are surfaced.
    async checkForUpdate(manual = false): Promise<void> {
        const dir = this.manifest.dir;
        if (!dir) { if (manual) new Notice("OnyxAz: Can't locate the plugin folder to update."); return; }
        try {
            const resp = await requestUrl({ url: `${ONYXAZ_REPO_RAW}/manifest.json`, throw: false });
            const remote = resp.status === 200 ? (resp.json?.version as string) : "";
            if (!remote) { if (manual) new Notice("OnyxAz: Couldn't reach GitHub to check for updates."); return; }

            if (compareVersions(remote, this.manifest.version) <= 0) {
                if (manual) new Notice(`OnyxAz: You're up to date (v${this.manifest.version}).`);
                return;
            }

            new Notice(`OnyxAz: Downloading update v${this.manifest.version} → v${remote}…`, 5000);
            for (const f of ["main.js", "manifest.json", "styles.css"]) {
                const r = await requestUrl({ url: `${ONYXAZ_REPO_RAW}/${f}`, throw: false });
                if (r.status === 200) {
                    await this.app.vault.adapter.write(normalizePath(`${dir}/${f}`), r.text);
                }
            }
            new Notice(
                `OnyxAz: Updated to v${remote}. Run "OnyxAz: Reload plugin" (or restart Obsidian) to apply.`,
                12000
            );
        } catch (e) {
            if (manual) this.displayError(e);
        }
    }

    // Disable + re-enable this plugin so a downloaded update takes effect without
    // an Obsidian restart. Uses Obsidian's plugin manager (not in the public types).
    reloadSelf(): void {
        const id = this.manifest.id;
        const plugins = (this.app as unknown as { plugins: { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<void> } }).plugins;
        new Notice("OnyxAz: Reloading…", 3000);
        setTimeout(async () => {
            try {
                await plugins.disablePlugin(id);
                await plugins.enablePlugin(id);
            } catch (e) {
                this.displayError(e);
            }
        }, 150);
    }

    // Renders a text progress bar for a live-updating Notice, e.g.
    //   OnyxAz: Pulling files
    //   ████████░░░░░░░░  12/30 (40%)
    private progressBarText(label: string, done: number, total: number): string {
        const width = 18;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const filled = total > 0 ? Math.min(width, Math.round((done / total) * width)) : 0;
        const bar = "█".repeat(filled) + "░".repeat(width - filled);
        return `OnyxAz: ${label}\n${bar}  ${done}/${total} (${pct}%)`;
    }

    private makeConflictResolver(): (conflicts: string[]) => Promise<Set<string>> {
        return (conflicts: string[]) =>
            new Promise<Set<string>>((resolve) => {
                new ConfirmPullModal(this.app, this, conflicts, resolve).open();
            });
    }

    // ── Core operations ───────────────────────────────────────────────────────

    // Pull remote changes then show confirmation before pushing local changes.
    // Status is captured BEFORE pull so pulled files never appear as deletions.
    async commitAndSync(): Promise<void> {
        if (!this.isConfigured()) {
            new Notice("OnyxAz: Finish setup — open Settings → OnyxAz.");
            return;
        }

        // 1. Capture local changes before pulling
        this.setState(CurrentAdoAction.status);
        let prePullChanges: FileStatus[];
        try {
            prePullChanges = (await this.adoManager.getStatus()).changed;
        } catch (e) {
            this.displayError(e);
            this.setState(CurrentAdoAction.idle);
            return;
        }

        // 2. Pull first
        this.setState(CurrentAdoAction.pull);
        const progress = new Notice("OnyxAz: Pulling…", 0);
        try {
            const n = await this.adoManager.pull(this.makeConflictResolver(), (done, total) => {
                progress.setMessage(total > 0 ? this.progressBarText("Pulling files", done, total) : "OnyxAz: Pulling…");
            });
            progress.hide();
            this.cachedStatus = null;
            new Notice(n > 0 ? `OnyxAz: Pulled ${n} file(s).` : "OnyxAz: Already up to date.");
            this.app.workspace.trigger("onyxaz:refresh");
            this.updateCachedStatus().catch(() => {});
        } catch (e) {
            progress.hide();
            this.displayError(e);
            this.setState(CurrentAdoAction.idle);
            return;
        }
        this.setState(CurrentAdoAction.idle);

        // 3. If nothing was locally changed, we're done (pull notice above already reported status)
        if (prePullChanges.length === 0) return;

        // 4. Ask user to confirm before pushing
        const message = this.adoManager.buildCommitMessage(prePullChanges.length);
        new ConfirmPushModal(this.app, this, prePullChanges, message, async (msg) => {
            this.setState(CurrentAdoAction.push);
            try {
                await this.adoManager.push(msg, prePullChanges);
                this.cachedStatus = null;
                if (this.settings.notifyOnSuccess) new Notice("OnyxAz: Push complete.");
                this.app.workspace.trigger("onyxaz:refresh");
                this.updateCachedStatus().catch(() => {});
            } catch (e) {
                this.displayError(e);
            } finally {
                this.setState(CurrentAdoAction.idle);
            }
        }).open();
    }

    async forcePull(): Promise<void> {
        if (!this.isConfigured()) {
            new Notice("OnyxAz: Finish setup — open Settings → OnyxAz.");
            return;
        }
        this.setState(CurrentAdoAction.pull);
        const progress = new Notice("OnyxAz: Re-downloading…", 0);
        try {
            const n = await this.adoManager.forcePull((done, total) => {
                progress.setMessage(total > 0 ? this.progressBarText("Re-downloading files", done, total) : "OnyxAz: Re-downloading…");
            });
            progress.hide();
            this.cachedStatus = null;
            new Notice(`OnyxAz: Force-pulled ${n} file(s) from remote.`);
            this.app.workspace.trigger("onyxaz:refresh");
            this.updateCachedStatus().catch(() => {});
        } catch (e) {
            progress.hide();
            this.displayError(e);
        } finally {
            this.setState(CurrentAdoAction.idle);
        }
    }

    async pull(): Promise<void> {
        if (!this.isConfigured()) {
            new Notice("OnyxAz: Finish setup — open Settings → OnyxAz.");
            return;
        }
        this.setState(CurrentAdoAction.pull);
        const progress = new Notice("OnyxAz: Pulling…", 0);
        try {
            const n = await this.adoManager.pull(this.makeConflictResolver(), (done, total) => {
                progress.setMessage(total > 0 ? this.progressBarText("Pulling files", done, total) : "OnyxAz: Pulling…");
            });
            progress.hide();
            this.cachedStatus = null;
            new Notice(n > 0 ? `OnyxAz: Pulled ${n} file(s).` : "OnyxAz: Already up to date.");
            this.app.workspace.trigger("onyxaz:refresh");
            this.updateCachedStatus().catch(() => {});
        } catch (e) {
            progress.hide();
            this.displayError(e);
        } finally {
            this.setState(CurrentAdoAction.idle);
        }
    }

    async push(): Promise<void> {
        if (!this.isConfigured()) {
            new Notice("OnyxAz: Finish setup — open Settings → OnyxAz.");
            return;
        }
        this.setState(CurrentAdoAction.status);
        let status: SyncStatus;
        try {
            status = await this.adoManager.getStatus();
        } catch (e) {
            this.displayError(e);
            this.setState(CurrentAdoAction.idle);
            return;
        }
        // Always update the cache with the freshly computed status so the hub
        // reflects reality even when we bail out early below.
        this.cachedStatus = status;
        this.app.workspace.trigger("onyxaz:status-changed");
        this.setState(CurrentAdoAction.idle);

        if (status.changed.length === 0) {
            new Notice("OnyxAz: Already up to date — no local changes to push.");
            return;
        }

        const message = this.adoManager.buildCommitMessage(status.changed.length);
        new ConfirmPushModal(this.app, this, status.changed, message, async (msg) => {
            this.setState(CurrentAdoAction.push);
            try {
                await this.adoManager.push(msg, status.changed);
                this.cachedStatus = null;
                if (this.settings.notifyOnSuccess) new Notice(`OnyxAz: Pushed ${status.changed.length} file(s).`);
                this.app.workspace.trigger("onyxaz:refresh");
                this.updateCachedStatus().catch(() => {});
            } catch (e) {
                this.displayError(e);
            } finally {
                this.setState(CurrentAdoAction.idle);
            }
        }).open();
    }

    // ── Status bar ────────────────────────────────────────────────────────────

    refreshStatusBar(): void {
        this.statusBarItem?.remove();
        this.statusBarEl = null;
        this.statusBarItem = null;
        if (this.statusBarInterval !== null) {
            clearInterval(this.statusBarInterval);
            this.statusBarInterval = null;
        }
        if (!this.settings.showStatusBar) return;
        this.statusBarEl = this.addStatusBarItem();
        this.statusBarItem = new StatusBar(this.statusBarEl, this);
        this.statusBarInterval = setInterval(() => this.statusBarItem?.display(), 1000);
    }

    async updateCachedStatus(): Promise<void> {
        if (!this.isConfigured()) return;
        try {
            this.cachedStatus = await this.adoManager.getStatus();
            this.app.workspace.trigger("onyxaz:status-changed");
        } catch {
            // ignore on startup
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    isConfigured(): boolean {
        const s = this.settings;
        const hasCredentials =
            s.authMethod === "pat" ? !!s.pat : this.entraAuth.isSignedIn;
        return !!(
            s.hasCompletedOnboarding &&
            s.organizationUrl &&
            s.project &&
            s.repository &&
            s.branch &&
            hasCredentials
        );
    }

    private setState(action: CurrentAdoAction): void {
        this.state.adoAction = action;
    }

    displayError(e: unknown): void {
        const msg = e instanceof Error ? e.message : String(e);
        new Notice(`OnyxAz error: ${msg}`, 10000);
        console.error("[OnyxAz]", e);
    }
}
