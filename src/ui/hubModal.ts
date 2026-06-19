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
                this.plugin.pushChanges();
            });
        }

        this.btn(actions, configured ? "Switch / pull repositories…" : "Connect to repository…", "", () => {
            new RepoTreeModal(
                this.app,
                this.plugin,
                async (project, repo, branch) => {
                    // In org-mirror mode the connected repo is vestigial — selecting a
                    // branch should bring that branch down into its own mirror folder
                    // (so non-default branches, which aren't auto-pulled at startup,
                    // become accessible) rather than swapping the single connection.
                    if (this.plugin.settings.orgMirror) {
                        this.close();
                        this.plugin.openMirrorBranch(project, repo, branch);
                        return;
                    }
                    // Clear explicit override so the new repo gets its auto folder
                    this.plugin.settings.localSyncPath = "";
                    this.plugin.settings.project = project;
                    this.plugin.settings.repository = repo;
                    this.plugin.settings.branch = branch;
                    await this.plugin.saveSettings();
                    await this.plugin.resetConnection();
                    new Notice(`OnyxAz: Switched to ${project} / ${repo} · ${branch}`, 5000);
                    this.render();
                },
                // Bulk: pull every ticked repo/branch and track them for startup refresh.
                (targets) => {
                    this.close();
                    return this.plugin.pullTargets(targets);
                }
            ).open();
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

            this.btn(actions, "Recover (reset stuck sync)", "", () => {
                this.close();
                this.plugin.recover();
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

        // ── Tracked repositories (curated multi-repo set) ──────────────────────
        if (configured && s.trackedRepos.length > 0) {
            const sec = contentEl.createDiv({ cls: "onyxaz-hub-tracked" });
            const head = sec.createDiv({ cls: "onyxaz-hub-tracked-head" });
            head.createEl("div", {
                text: `Tracked repositories (${s.trackedRepos.length})`,
                cls: "onyxaz-hub-label",
            });
            const pullAll = head.createEl("button", { text: "Pull all" });
            pullAll.addClass("onyxaz-hub-btn");
            pullAll.addEventListener("click", () => { this.close(); this.plugin.pullAllTracked(); });

            for (const t of s.trackedRepos) {
                const row = sec.createDiv({ cls: "onyxaz-tracked-row" });
                const info = row.createDiv({ cls: "onyxaz-tracked-info" });
                info.createEl("div", { text: `${t.project} / ${t.repo} · ${t.branch}`, cls: "onyxaz-tracked-name" });
                const meta = info.createEl("div", { text: "checking…", cls: "onyxaz-hub-meta onyxaz-tracked-meta" });

                const btns = row.createDiv({ cls: "onyxaz-tracked-btns" });
                const pull = btns.createEl("button", { text: "Pull" });
                pull.addClass("onyxaz-hub-btn");
                pull.addEventListener("click", () => { this.close(); this.plugin.pullTargets([t], false); });
                const push = btns.createEl("button", { text: "Push" });
                push.addClass("onyxaz-hub-btn");
                push.addEventListener("click", () => { this.close(); this.plugin.pushRepo(t); });
                const remove = btns.createEl("button", { text: "Remove" });
                remove.addClass("onyxaz-hub-btn");
                remove.addEventListener("click", async () => { await this.plugin.untrackRepo(t); this.render(); });

                // Last-sync + pending count are computed in the background so the
                // panel renders instantly even with many tracked repos.
                this.fillTrackedMeta(t, meta);
            }
        }
    }

    // Fills a tracked-repo row's meta line: last sync (cheap, from state) then a
    // pending-changes count (a local scan, appended once it resolves).
    private async fillTrackedMeta(t: { project: string; repo: string; branch: string }, el: HTMLElement): Promise<void> {
        try {
            const last = await this.plugin.adoManager.targetLastSync(t);
            const base = last ? `synced ${moment(last).fromNow()}` : "not pulled yet";
            el.setText(base);
            const changed = await this.plugin.adoManager.getTargetStatus(t);
            if (changed.length > 0) el.setText(`${base} · ${changed.length} local change${changed.length !== 1 ? "s" : ""}`);
        } catch {
            /* leave the placeholder */
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
