import { App, Modal } from "obsidian";
import type OnyxAz from "../main";
import type { FileStatus } from "../types";

export class ConfirmPushModal extends Modal {
    private commitMessage: string;

    constructor(
        app: App,
        private readonly plugin: OnyxAz,
        private readonly changes: FileStatus[],
        defaultMessage: string,
        private readonly onConfirm: (message: string) => Promise<void>
    ) {
        super(app);
        this.commitMessage = defaultMessage;
        this.modalEl.addClass("onyxaz-confirm-push");
    }

    onOpen(): void {
        const { contentEl } = this;
        const s = this.plugin.settings;
        this.titleEl.setText("Confirm Push");

        // ── Destination banner ────────────────────────────────────────────────
        const dest = contentEl.createDiv({ cls: "onyxaz-banner onyxaz-banner-push" });
        dest.createEl("span", { cls: "onyxaz-banner-icon", text: "↑" });
        const destInfo = dest.createDiv({ cls: "onyxaz-banner-info" });
        destInfo.createEl("div", { cls: "onyxaz-banner-label", text: "Pushing to" });
        destInfo.createEl("div", {
            cls: "onyxaz-banner-value",
            text: `${s.project}  /  ${s.repository}  ·  ${s.branch}`,
        });

        // ── Change summary chips ──────────────────────────────────────────────
        const added    = this.changes.filter(f => f.status === "A");
        const modified = this.changes.filter(f => f.status === "M");
        const deleted  = this.changes.filter(f => f.status === "D");

        const summary = contentEl.createDiv({ cls: "onyxaz-summary-row" });
        if (added.length)    this.chip(summary, `+ ${added.length} added`,    "onyxaz-chip-added");
        if (modified.length) this.chip(summary, `~ ${modified.length} modified`, "onyxaz-chip-modified");
        if (deleted.length)  this.chip(summary, `− ${deleted.length} deleted`,  "onyxaz-chip-deleted");

        // ── File groups ───────────────────────────────────────────────────────
        this.renderGroup(contentEl, "+ Added",    added,    "onyxaz-added");
        this.renderGroup(contentEl, "~ Modified", modified, "onyxaz-modified");
        this.renderGroup(contentEl, "− Deleted",  deleted,  "onyxaz-deleted");

        // ── Warning ───────────────────────────────────────────────────────────
        contentEl.createDiv({
            cls: "onyxaz-warning-box",
            text: "⚠  These changes will be written to the remote repository. This cannot be automatically undone.",
        });

        // ── Commit message ────────────────────────────────────────────────────
        contentEl.createEl("label", { text: "Commit message", cls: "onyxaz-label" });
        const input = contentEl.createEl("input", { cls: "onyxaz-commit-input" }) as HTMLInputElement;
        input.type = "text";
        input.value = this.commitMessage;
        input.addEventListener("input", () => {
            if (input.value.trim()) this.commitMessage = input.value;
        });

        // ── Buttons ───────────────────────────────────────────────────────────
        const row = contentEl.createDiv({ cls: "onyxaz-nav-row" });

        const cancelBtn = row.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => this.close());

        const n = this.changes.length;
        const pushBtn = row.createEl("button", {
            text: `Push ${n} file${n !== 1 ? "s" : ""} to remote →`,
        });
        pushBtn.addClass("mod-cta");
        pushBtn.addEventListener("click", async () => {
            pushBtn.disabled = true;
            pushBtn.textContent = "Pushing…";
            cancelBtn.disabled = true;
            try {
                await this.onConfirm(this.commitMessage);
                this.close();
            } catch {
                pushBtn.disabled = false;
                pushBtn.textContent = `Push ${n} file${n !== 1 ? "s" : ""} to remote →`;
                cancelBtn.disabled = false;
            }
        });
    }

    private chip(parent: HTMLElement, text: string, cls: string): void {
        parent.createEl("span", { text, cls: `onyxaz-chip ${cls}` });
    }

    private renderGroup(containerEl: HTMLElement, label: string, files: FileStatus[], cls: string): void {
        if (files.length === 0) return;

        const section = containerEl.createDiv({ cls: `onyxaz-file-group ${cls}` });
        let collapsed = files.length > 8;

        const header = section.createDiv({ cls: "onyxaz-file-group-header" });
        const chevron = header.createSpan({ cls: "onyxaz-chevron", text: collapsed ? "▶" : "▼" });
        header.createSpan({ text: ` ${label} (${files.length})` });

        const list = section.createEl("ul", { cls: "onyxaz-file-list" });
        list.style.display = collapsed ? "none" : "";

        const MAX = 200;
        for (const f of files.slice(0, MAX)) {
            list.createEl("li", { text: f.path, cls: "onyxaz-file-item" });
        }
        if (files.length > MAX) {
            list.createEl("li", { text: `… and ${files.length - MAX} more`, cls: "onyxaz-hint" });
        }

        header.style.cursor = "pointer";
        header.addEventListener("click", () => {
            collapsed = !collapsed;
            list.style.display = collapsed ? "none" : "";
            chevron.textContent = collapsed ? "▶" : "▼";
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
