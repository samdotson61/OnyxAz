import { debounce } from "obsidian";
import type OnyxAz from "./main";

const MAX_TIMEOUT = 2147483647;

export class AutomaticsManager {
    private syncTimeout: ReturnType<typeof setTimeout> | null = null;
    private pullTimeout: ReturnType<typeof setTimeout> | null = null;
    private saveDebounce: ReturnType<typeof debounce> | null = null;
    private paused = false;

    constructor(private readonly plugin: OnyxAz) {}

    init(): void {
        this.reload();
    }

    reload(): void {
        this.unload();
        if (this.paused) return;
        const s = this.plugin.settings;

        if (s.autoSyncInterval > 0) {
            this.scheduledPull(s.autoSyncInterval * 60 * 1000, "sync");
        }

        if (s.autoPullInterval > 0) {
            this.scheduledPull(s.autoPullInterval * 60 * 1000, "pull");
        }

        if (s.autoSyncOnSave) {
            this.saveDebounce = debounce(
                () => {
                    this.plugin.promiseQueue.addTask(() => this.plugin.pull());
                },
                s.autoSyncOnSaveDebounceMs,
                true
            );
            this.plugin.registerEvent(
                this.plugin.app.vault.on("modify", () => {
                    this.saveDebounce?.();
                })
            );
        }
    }

    private scheduledPull(ms: number, source: "sync" | "pull"): void {
        const delay = Math.min(ms, MAX_TIMEOUT);
        const handle = setTimeout(() => {
            if (this.plugin.isConfigured()) {
                this.plugin.promiseQueue.addTask(() => this.plugin.pull());
            }
            const nextMs = source === "sync"
                ? this.plugin.settings.autoSyncInterval * 60 * 1000
                : this.plugin.settings.autoPullInterval * 60 * 1000;
            this.scheduledPull(nextMs, source);
        }, delay);
        if (source === "sync") this.syncTimeout = handle;
        else this.pullTimeout = handle;
    }

    pause(): void {
        this.paused = true;
        this.unload();
    }

    resume(): void {
        this.paused = false;
        this.reload();
    }

    get isPaused(): boolean {
        return this.paused;
    }

    unload(): void {
        if (this.syncTimeout !== null) {
            clearTimeout(this.syncTimeout);
            this.syncTimeout = null;
        }
        if (this.pullTimeout !== null) {
            clearTimeout(this.pullTimeout);
            this.pullTimeout = null;
        }
        if (this.saveDebounce) {
            this.saveDebounce.cancel?.();
            this.saveDebounce = null;
        }
    }
}
