import { App, Modal, Notice, moment } from "obsidian";
import type OnyxAz from "../main";
import { RepoTreeModal } from "./repoTreeModal";

export class HubModal extends Modal {
    constructor(app: App, private readonly plugin: OnyxAz) {
        super(app);
        this.modalEl.addClass("onyxaz-hub");
    }

    onOpen(): void {
        this.render();
        // Refresh status in the background and re-render with accurate count
        this.plugin.updateCachedStatus().then(() => this.render()).catch(() => {});
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const s = this.plugin.settings;
        const configured = this.plugin.isConfigured();

        // ── Connection card ───────────────────────────────────────────────────

        if (configured) {
            const card = contentEl.createDiv({ cls: "onyxaz-hub-card" });

            card.createEl("div", { text: "Connected to", cls: "onyxaz-hub-label" });
            card.createEl("div", {
                text: `${s.project} / ${s.repository}`,
                cls: "onyxaz-hub-repo",
            });
            card.createEl("div", { text: `Branch: ${s.branch}`, cls: "onyxaz-hub-meta" });

            const folder = this.plugin.adoManager.getSyncRoot().replace(/\/+$/, "") || "(vault root)";
            card.createEl("div", {
                text: `Vault folder: ${folder}`,
                cls: "onyxaz-hub-path",
            });

            const state = this.plugin.adoManager.getCachedState();
            if (state?.lastSyncTime) {
                card.createEl("div", {
                    text: `Last sync: ${moment(state.lastSyncTime).fromNow()}`,
                    cls: "onyxaz-hub-meta",
                });
            }

            const n = this.plugin.cachedStatus?.changed.length ?? 0;
            if (n > 0) {
                card.createEl("div", {
                    text: `${n} local change${n !== 1 ? "s" : ""} pending`,
                    cls: "onyxaz-hub-pending",
                });
            }
        } else {
            contentEl.createEl("p", {
                text: "Not connected. Pick a repository below to get started.",
                cls: "onyxaz-hint",
            });
        }

        // ── Actions ───────────────────────────────────────────────────────────

        const actions = contentEl.createDiv({ cls: "onyxaz-hub-actions" });

        if (configured) {
            this.btn(actions, "Pull & sync", "mod-cta", () => {
                this.close();
                this.plugin.promiseQueue.addTask(() => this.plugin.commitAndSync());
            });

            this.btn(actions, "Push changes…", "", () => {
                this.close();
                this.plugin.promiseQueue.addTask(() => this.plugin.push());
            });
        }

        this.btn(actions, configured ? "Switch repository…" : "Connect to repository…", "", () => {
            new RepoTreeModal(this.app, this.plugin, async (project, repo, branch) => {
                // Clear explicit override so the new repo gets its auto folder
                this.plugin.settings.localSyncPath = "";
                this.plugin.settings.project = project;
                this.plugin.settings.repository = repo;
                this.plugin.settings.branch = branch;
                await this.plugin.saveSettings();
                await this.plugin.resetConnection();
                new Notice(`OnyxAz: Switched to ${project} / ${repo} · ${branch}`, 5000);
                this.render();
            }).open();
        });

        if (configured) {
            this.btn(actions, "Force re-pull", "", () => {
                this.close();
                this.plugin.promiseQueue.addTask(() => this.plugin.forcePull());
            });

            this.btn(actions, "Mirror entire organization (pull-only)…", "", () => {
                this.close();
                this.plugin.mirrorOrganization();
            });

            // Open in ADO (link styled as button)
            const adoUrl =
                `${s.organizationUrl.replace(/\/$/, "")}` +
                `/${encodeURIComponent(s.project)}` +
                `/_git/${encodeURIComponent(s.repository)}`;
            const link = actions.createEl("a", {
                text: "Open in Azure DevOps ↗",
                href: adoUrl,
                cls: "onyxaz-hub-link",
            });
            link.setAttr("target", "_blank");
        }
    }

    private btn(
        parent: HTMLElement,
        label: string,
        extraCls: string,
        onClick: () => void
    ): HTMLButtonElement {
        const b = parent.createEl("button", { text: label });
        if (extraCls) b.addClass(extraCls);
        b.addClass("onyxaz-hub-btn");
        b.addEventListener("click", onClick);
        return b;
    }
}
