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
        this.titleEl.setText("Push to Azure DevOps");

        contentEl.createEl("p", {
            cls: "onyxaz-push-destination",
            text: `${s.project}  /  ${s.repository}  ·  branch: ${s.branch}`,
        });

        const added = this.changes.filter(f => f.status === "A");
        const modified = this.changes.filter(f => f.status === "M");
        const deleted = this.changes.filter(f => f.status === "D");

        this.renderGroup(contentEl, "+ Added", added, "onyxaz-added");
        this.renderGroup(contentEl, "~ Modified", modified, "onyxaz-modified");
        this.renderGroup(contentEl, "− Deleted", deleted, "onyxaz-deleted");

        contentEl.createEl("label", { text: "Commit message", cls: "onyxaz-label" });
        const input = contentEl.createEl("input", { cls: "onyxaz-commit-input" }) as HTMLInputElement;
        input.type = "text";
        input.value = this.commitMessage;
        input.addEventListener("input", () => {
            if (input.value.trim()) this.commitMessage = input.value;
        });

        const row = contentEl.createDiv({ cls: "onyxaz-nav-row" });
        const cancelBtn = row.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => this.close());

        const n = this.changes.length;
        const pushBtn = row.createEl("button", { text: `Push ${n} file${n !== 1 ? "s" : ""}` });
        pushBtn.addClass("mod-warning");
        pushBtn.addEventListener("click", async () => {
            pushBtn.disabled = true;
            pushBtn.textContent = "Pushing…";
            cancelBtn.disabled = true;
            try {
                await this.onConfirm(this.commitMessage);
                this.close();
            } catch {
                pushBtn.disabled = false;
                pushBtn.textContent = `Push ${n} file${n !== 1 ? "s" : ""}`;
                cancelBtn.disabled = false;
            }
        });
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
