import { App, Modal } from "obsidian";
import type OnyxAz from "../main";

export class ConfirmPullModal extends Modal {
    private kept = new Set<string>();
    private resolved = false;
    private summaryEl!: HTMLElement;

    constructor(
        app: App,
        private readonly plugin: OnyxAz,
        private readonly conflicts: string[],
        private readonly onResolve: (skip: Set<string>) => void
    ) {
        super(app);
        this.kept = new Set<string>();
    }

    onOpen(): void {
        const { contentEl } = this;
        const s = this.plugin.settings;
        contentEl.addClass("onyxaz-confirm-pull");
        this.titleEl.setText("Confirm Pull");

        // ── Source banner ─────────────────────────────────────────────────────
        const src = contentEl.createDiv({ cls: "onyxaz-banner onyxaz-banner-pull" });
        src.createEl("span", { cls: "onyxaz-banner-icon", text: "↓" });
        const srcInfo = src.createDiv({ cls: "onyxaz-banner-info" });
        srcInfo.createEl("div", { cls: "onyxaz-banner-label", text: "Pulling from" });
        srcInfo.createEl("div", {
            cls: "onyxaz-banner-value",
            text: `${s.project}  /  ${s.repository}  ·  ${s.branch}`,
        });

        // ── Explanation ───────────────────────────────────────────────────────
        contentEl.createEl("p", {
            cls: "onyxaz-pull-desc",
            text:
                `${this.conflicts.length} file${this.conflicts.length !== 1 ? "s" : ""} ` +
                `changed in the remote repository and already exist in your local vault. ` +
                `Choose whether to overwrite your local copy with the remote version, or keep it as-is.`,
        });

        // ── Per-file list ─────────────────────────────────────────────────────
        const listEl = contentEl.createDiv({ cls: "onyxaz-pull-list" });
        for (const path of this.conflicts) {
            const row = listEl.createDiv({ cls: "onyxaz-pull-row" });
            const label = row.createEl("span", { text: path, cls: "onyxaz-pull-path" });
            label.title = path;

            const toggle = row.createEl("button", { cls: "onyxaz-pull-toggle" });
            const setToggle = (keepLocal: boolean) => {
                if (keepLocal) {
                    this.kept.add(path);
                    toggle.textContent = "Keep local";
                    toggle.classList.add("mod-warning");
                    toggle.classList.remove("mod-cta");
                    row.classList.add("onyxaz-pull-keep");
                } else {
                    this.kept.delete(path);
                    toggle.textContent = "Overwrite";
                    toggle.classList.add("mod-cta");
                    toggle.classList.remove("mod-warning");
                    row.classList.remove("onyxaz-pull-keep");
                }
                this.updateSummary();
            };
            setToggle(false);
            toggle.addEventListener("click", () => setToggle(!this.kept.has(path)));
        }

        // ── Bulk buttons ──────────────────────────────────────────────────────
        const bulk = contentEl.createDiv({ cls: "onyxaz-pull-bulk" });
        const allOverwrite = bulk.createEl("button", { text: "Overwrite all", cls: "mod-cta" });
        const allKeep      = bulk.createEl("button", { text: "Keep all local", cls: "mod-warning" });

        allOverwrite.addEventListener("click", () => {
            this.kept.clear();
            listEl.querySelectorAll(".onyxaz-pull-toggle").forEach((btn, i) => {
                const toggle = btn as HTMLButtonElement;
                toggle.textContent = "Overwrite";
                toggle.classList.add("mod-cta");
                toggle.classList.remove("mod-warning");
                (toggle.closest(".onyxaz-pull-row") as HTMLElement)?.classList.remove("onyxaz-pull-keep");
            });
            this.updateSummary();
        });

        allKeep.addEventListener("click", () => {
            this.conflicts.forEach((p) => this.kept.add(p));
            listEl.querySelectorAll(".onyxaz-pull-toggle").forEach((btn, i) => {
                const toggle = btn as HTMLButtonElement;
                toggle.textContent = "Keep local";
                toggle.classList.add("mod-warning");
                toggle.classList.remove("mod-cta");
                (toggle.closest(".onyxaz-pull-row") as HTMLElement)?.classList.add("onyxaz-pull-keep");
            });
            this.updateSummary();
        });

        // ── Live summary ──────────────────────────────────────────────────────
        this.summaryEl = contentEl.createDiv({ cls: "onyxaz-pull-summary" });
        this.updateSummary();

        // ── Buttons ───────────────────────────────────────────────────────────
        const row = contentEl.createDiv({ cls: "onyxaz-nav-row" });

        const cancelBtn = row.createEl("button", { text: "Cancel (keep all local)" });
        cancelBtn.addEventListener("click", () => {
            this.conflicts.forEach((p) => this.kept.add(p));
            this.resolved = true;
            this.close();
        });

        const confirmBtn = row.createEl("button");
        confirmBtn.addClass("mod-cta");
        this.updateConfirmBtn(confirmBtn);
        confirmBtn.addEventListener("click", () => {
            this.resolved = true;
            this.close();
        });

        // Keep confirm button label in sync with choices
        const origUpdate = this.updateSummary.bind(this);
        this.updateSummary = () => {
            origUpdate();
            this.updateConfirmBtn(confirmBtn);
        };
        this.updateSummary();
    }

    private updateSummary(): void {
        if (!this.summaryEl) return;
        const overwriting = this.conflicts.length - this.kept.size;
        const keeping     = this.kept.size;
        const parts: string[] = [];
        if (overwriting > 0) parts.push(`${overwriting} file${overwriting !== 1 ? "s" : ""} will be overwritten`);
        if (keeping > 0)     parts.push(`${keeping} file${keeping !== 1 ? "s" : ""} will be kept local`);
        this.summaryEl.textContent = parts.join("  ·  ");
    }

    private updateConfirmBtn(btn: HTMLButtonElement): void {
        const overwriting = this.conflicts.length - this.kept.size;
        if (overwriting === 0) {
            btn.textContent = "Proceed (keep all local)";
        } else {
            btn.textContent = `Overwrite ${overwriting} file${overwriting !== 1 ? "s" : ""} ↓`;
        }
    }

    onClose(): void {
        if (!this.resolved) {
            this.conflicts.forEach((p) => this.kept.add(p));
        }
        this.onResolve(this.kept);
        this.contentEl.empty();
    }
}
