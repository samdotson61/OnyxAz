import { setIcon, moment } from "obsidian";
import type OnyxAz from "./main";
import { CurrentAdoAction } from "./types";

interface StatusBarMessage {
    message: string;
    timeout: number;
}

export class StatusBar {
    private messages: StatusBarMessage[] = [];
    private currentMessage: StatusBarMessage | null = null;
    public lastMessageTimestamp: number | null = null;
    private lastSyncTimestamp?: Date;
    private iconEl!: HTMLElement;
    private textEl!: HTMLElement;
    private readonly base = "onyxaz-statusbar-";

    constructor(
        private readonly statusBarEl: HTMLElement,
        private readonly plugin: OnyxAz
    ) {
        statusBarEl.setAttribute("data-tooltip-position", "top");
        statusBarEl.style.cursor = "pointer";
        statusBarEl.addEventListener("click", () => {
            (this.plugin.app as any).setting.open();
            (this.plugin.app as any).setting.openTabById("onyxaz");
        });

        plugin.registerEvent(
            plugin.app.workspace.on("onyxaz:refresh", () => {
                this.refreshSyncTimestamp();
            })
        );
    }

    displayMessage(message: string, timeout: number): void {
        this.messages.push({
            message: `ADO: ${message.slice(0, 100)}`,
            timeout,
        });
        this.display();
    }

    display(): void {
        if (this.messages.length > 0 && !this.currentMessage) {
            this.currentMessage = this.messages.shift()!;
            this.statusBarEl.addClass(this.base + "message");
            this.statusBarEl.ariaLabel = "";
            this.statusBarEl.setText(this.currentMessage.message);
            this.lastMessageTimestamp = Date.now();
        } else if (this.currentMessage) {
            const age = Date.now() - (this.lastMessageTimestamp ?? 0);
            if (age >= this.currentMessage.timeout) {
                this.currentMessage = null;
                this.lastMessageTimestamp = null;
            }
        } else {
            this.displayState();
        }
    }

    private displayState(): void {
        if (this.statusBarEl.getText().length > 3 || !this.statusBarEl.hasChildNodes()) {
            this.statusBarEl.empty();
            this.iconEl = this.statusBarEl.createDiv();
            this.iconEl.style.float = "left";
            this.textEl = this.statusBarEl.createDiv();
            this.textEl.style.float = "right";
            this.textEl.style.marginLeft = "5px";
        }

        switch (this.plugin.state.adoAction) {
            case CurrentAdoAction.idle:
                this.displayIdle();
                break;
            case CurrentAdoAction.status:
                this.statusBarEl.ariaLabel = "Checking status...";
                setIcon(this.iconEl, "refresh-cw");
                this.statusBarEl.addClass(this.base + "sync");
                break;
            case CurrentAdoAction.pull:
                this.statusBarEl.ariaLabel = "Pulling from Azure DevOps...";
                setIcon(this.iconEl, "download");
                this.statusBarEl.addClass(this.base + "sync");
                break;
            case CurrentAdoAction.commit:
            case CurrentAdoAction.push:
                this.statusBarEl.ariaLabel = "Pushing to Azure DevOps...";
                setIcon(this.iconEl, "upload");
                this.statusBarEl.addClass(this.base + "sync");
                break;
            case CurrentAdoAction.sync:
                this.statusBarEl.ariaLabel = "Syncing with Azure DevOps...";
                setIcon(this.iconEl, "refresh-cw");
                this.statusBarEl.addClass(this.base + "sync");
                break;
            default:
                this.statusBarEl.ariaLabel = "OnyxAz: not configured";
                setIcon(this.iconEl, "alert-triangle");
                break;
        }
    }

    private displayIdle(): void {
        if (this.lastSyncTimestamp) {
            const fromNow = moment(this.lastSyncTimestamp).fromNow();
            this.statusBarEl.ariaLabel = `ADO: Last sync ${fromNow}`;
        } else {
            this.statusBarEl.ariaLabel = "ADO: Never synced";
        }
        setIcon(this.iconEl, "check");
        this.statusBarEl.addClass(this.base + "idle");

        if (this.plugin.settings.showChangedFilesCount && this.plugin.cachedStatus) {
            this.textEl.setText(this.plugin.cachedStatus.changed.length.toString());
        } else {
            this.textEl.setText("");
        }
    }

    private refreshSyncTimestamp(): void {
        const state = this.plugin.adoManager?.getCachedState?.();
        if (state) {
            this.lastSyncTimestamp = new Date(state.lastSyncTime);
        }
    }

    remove(): void {
        this.statusBarEl.remove();
    }
}
