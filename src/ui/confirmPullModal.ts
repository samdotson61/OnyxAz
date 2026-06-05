import { App, Modal, Setting } from "obsidian";

export class ConfirmPullModal extends Modal {
    private kept = new Set<string>();
    private resolved = false;

    constructor(
        app: App,
        private readonly conflicts: string[],
        private readonly onResolve: (skip: Set<string>) => void
    ) {
        super(app);
        // Default: overwrite all (keep none locally)
        this.kept = new Set<string>();
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass("onyxaz-confirm-pull");
        contentEl.createEl("h2", { text: "Remote files changed" });
        contentEl.createEl("p", {
            text: `${this.conflicts.length} file${this.conflicts.length !== 1 ? "s have" : " has"} changed remotely and already exist locally. Choose what to do with each:`,
            cls: "onyxaz-pull-desc",
        });

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
            };
            setToggle(false); // default: overwrite
            toggle.addEventListener("click", () => setToggle(!this.kept.has(path)));
        }

        // Bulk actions
        const bulk = contentEl.createDiv({ cls: "onyxaz-pull-bulk" });
        const allOverwrite = bulk.createEl("button", { text: "Overwrite all", cls: "mod-cta" });
        const allKeep = bulk.createEl("button", { text: "Keep all local", cls: "mod-warning" });
        allOverwrite.addEventListener("click", () => {
            this.kept.clear();
            contentEl.querySelectorAll(".onyxaz-pull-toggle").forEach((btn, i) => {
                const path = this.conflicts[i];
                const toggle = btn as HTMLButtonElement;
                toggle.textContent = "Overwrite";
                toggle.classList.add("mod-cta");
                toggle.classList.remove("mod-warning");
                (toggle.closest(".onyxaz-pull-row") as HTMLElement)?.classList.remove("onyxaz-pull-keep");
            });
        });
        allKeep.addEventListener("click", () => {
            this.conflicts.forEach((p) => this.kept.add(p));
            contentEl.querySelectorAll(".onyxaz-pull-toggle").forEach((btn, i) => {
                const path = this.conflicts[i];
                const toggle = btn as HTMLButtonElement;
                toggle.textContent = "Keep local";
                toggle.classList.add("mod-warning");
                toggle.classList.remove("mod-cta");
                (toggle.closest(".onyxaz-pull-row") as HTMLElement)?.classList.add("onyxaz-pull-keep");
            });
        });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Apply")
                    .setCta()
                    .onClick(() => {
                        this.resolved = true;
                        this.close();
                    })
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => {
                    // Cancel means keep everything local (safest)
                    this.conflicts.forEach((p) => this.kept.add(p));
                    this.resolved = true;
                    this.close();
                })
            );
    }

    onClose(): void {
        if (!this.resolved) {
            this.conflicts.forEach((p) => this.kept.add(p));
        }
        this.onResolve(this.kept);
        this.contentEl.empty();
    }
}
