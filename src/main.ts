import { Notice, Plugin, addIcon } from "obsidian";
import { DEFAULT_SETTINGS } from "./constants";
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

        this.addRibbonIcon("onyxaz", "OnyxAz: Commit and sync", () => {
            this.promiseQueue.addTask(() => this.commitAndSync());
        });

        this.registerCommands();

        this.app.workspace.onLayoutReady(async () => {
            if (!this.settings.hasCompletedOnboarding) {
                // First install — guide the user through setup
                new OnboardingModal(this.app, this).open();
            } else if (this.settings.pullOnStartup && this.isConfigured()) {
                this.promiseQueue.addTask(() => this.pull());
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

    private makeConflictResolver(): (conflicts: string[]) => Promise<Set<string>> {
        return (conflicts: string[]) =>
            new Promise<Set<string>>((resolve) => {
                new ConfirmPullModal(this.app, conflicts, resolve).open();
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
        try {
            const n = await this.adoManager.pull(this.makeConflictResolver());
            this.cachedStatus = null;
            new Notice(n > 0 ? `OnyxAz: Pulled ${n} file(s).` : "OnyxAz: Already up to date.");
            this.app.workspace.trigger("onyxaz:refresh");
        } catch (e) {
            this.displayError(e);
            this.setState(CurrentAdoAction.idle);
            return;
        }
        this.setState(CurrentAdoAction.idle);

        // 3. If nothing was locally changed, we're done
        if (prePullChanges.length === 0) {
            if (this.settings.notifyOnSuccess) new Notice("OnyxAz: Already up to date.");
            return;
        }

        // 4. Ask user to confirm before pushing
        const message = this.adoManager.buildCommitMessage(prePullChanges.length);
        new ConfirmPushModal(this.app, this, prePullChanges, message, async (msg) => {
            this.setState(CurrentAdoAction.push);
            try {
                await this.adoManager.push(msg, prePullChanges);
                this.cachedStatus = null;
                if (this.settings.notifyOnSuccess) new Notice("OnyxAz: Push complete.");
                this.app.workspace.trigger("onyxaz:refresh");
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
        try {
            const n = await this.adoManager.forcePull();
            this.cachedStatus = null;
            new Notice(`OnyxAz: Force-pulled ${n} file(s) from remote.`);
            this.app.workspace.trigger("onyxaz:refresh");
        } catch (e) {
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
        try {
            const n = await this.adoManager.pull(this.makeConflictResolver());
            this.cachedStatus = null;
            new Notice(n > 0 ? `OnyxAz: Pulled ${n} file(s).` : "OnyxAz: Already up to date.");
            this.app.workspace.trigger("onyxaz:refresh");
        } catch (e) {
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
        let changes: FileStatus[];
        try {
            changes = (await this.adoManager.getStatus()).changed;
        } catch (e) {
            this.displayError(e);
            this.setState(CurrentAdoAction.idle);
            return;
        }
        this.setState(CurrentAdoAction.idle);

        if (changes.length === 0) {
            new Notice("OnyxAz: Nothing to push.");
            return;
        }

        const message = this.adoManager.buildCommitMessage(changes.length);
        new ConfirmPushModal(this.app, this, changes, message, async (msg) => {
            this.setState(CurrentAdoAction.push);
            try {
                await this.adoManager.push(msg, changes);
                this.cachedStatus = null;
                if (this.settings.notifyOnSuccess) new Notice(`OnyxAz: Pushed ${changes.length} file(s).`);
                this.app.workspace.trigger("onyxaz:refresh");
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

    private async updateCachedStatus(): Promise<void> {
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
