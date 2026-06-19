import { App, Modal, Notice } from "obsidian";
import type OnyxAz from "../main";
import type { RepoTarget } from "../types";
import { targetKey } from "../util/targets";

interface ProjectNode {
    name: string;
    repos: RepoNode[];
    loaded: boolean;
    expanded: boolean;
}

interface RepoNode {
    name: string;
    project: string;
    defaultBranch: string;
    branches: string[];
    loaded: boolean;
    expanded: boolean;
}

export class RepoTreeModal extends Modal {
    private projects: ProjectNode[] = [];
    private loadingProjects = true;
    private selected: { project: string; repo: string; branch: string } | null = null;
    // Multi-select set for "Pull selected" (only used when onPullMany is given).
    private selectedTargets = new Map<string, RepoTarget>();
    private pullArmed = false; // two-click confirm guard for large selections

    // Elements updated in-place after initial render
    private selectionInfoEl!: HTMLElement;
    private connectBtnEl!: HTMLButtonElement;
    private pullBtnEl: HTMLButtonElement | null = null;

    constructor(
        app: App,
        private readonly plugin: OnyxAz,
        private readonly onSelect: (project: string, repo: string, branch: string) => Promise<void>,
        // When provided, the tree gains checkboxes and a "Pull selected" button
        // that pulls every ticked repo/branch in one action.
        private readonly onPullMany?: (targets: RepoTarget[]) => Promise<void> | void
    ) {
        super(app);
        this.modalEl.addClass("onyxaz-repo-tree-modal");
    }

    async onOpen(): Promise<void> {
        this.titleEl.setText(this.onPullMany ? "Select repositories" : "Select Repository");
        this.buildShell();
        try {
            const names = await this.plugin.adoManager.listProjects();
            this.projects = names.map(n => ({
                name: n, repos: [], loaded: false, expanded: false,
            }));
        } catch (e) {
            new Notice(`OnyxAz: Failed to load projects — ${(e as Error).message}`);
        }
        this.loadingProjects = false;
        this.renderTree();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    // ── Shell layout (rendered once) ─────────────────────────────────────────

    private buildShell(): void {
        const { contentEl } = this;

        if (this.onPullMany) {
            contentEl.createEl("p", {
                cls: "onyxaz-hint",
                text: "Tick repositories (or expand one to tick specific branches), then Pull selected. Or click a single branch and Connect.",
            });
        }

        // Scrollable tree area
        const treeWrap = contentEl.createDiv({ cls: "onyxaz-tree-wrap" });
        treeWrap.createEl("p", { text: "Loading projects…", cls: "onyxaz-hint onyxaz-tree-loading" });

        // Footer: selection info + buttons
        const footer = contentEl.createDiv({ cls: "onyxaz-tree-footer" });
        this.selectionInfoEl = footer.createDiv({ cls: "onyxaz-tree-selection-info" });
        this.updateSelectionInfo();

        const row = footer.createDiv({ cls: "onyxaz-nav-row" });

        const cancelBtn = row.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => this.close());

        this.connectBtnEl = row.createEl("button", { text: "Connect" }) as HTMLButtonElement;
        this.connectBtnEl.addClass("mod-cta");
        this.connectBtnEl.disabled = true;
        this.connectBtnEl.addEventListener("click", async () => {
            if (!this.selected) return;
            this.connectBtnEl.disabled = true;
            this.connectBtnEl.textContent = "Connecting…";
            try {
                await this.onSelect(this.selected.project, this.selected.repo, this.selected.branch);
                this.close();
            } catch (e) {
                new Notice(`OnyxAz: ${(e as Error).message}`);
                this.connectBtnEl.disabled = false;
                this.connectBtnEl.textContent = "Connect";
            }
        });

        if (this.onPullMany) {
            this.pullBtnEl = row.createEl("button") as HTMLButtonElement;
            this.pullBtnEl.addClass("mod-cta");
            this.pullBtnEl.addEventListener("click", async () => {
                const targets = [...this.selectedTargets.values()];
                if (targets.length === 0) return;
                // Guard a big accidental selection behind a confirm click.
                if (targets.length > 15 && !this.pullArmed) {
                    this.pullArmed = true;
                    this.pullBtnEl!.textContent = `Confirm: pull ${targets.length} repos →`;
                    return;
                }
                this.close();
                await this.onPullMany!(targets);
            });
            this.updatePullSelected();
        }
    }

    // ── Multi-select helpers ────────────────────────────────────────────────

    private isPicked(t: RepoTarget): boolean {
        return this.selectedTargets.has(targetKey(t));
    }

    private togglePick(t: RepoTarget, on: boolean): void {
        if (on) this.selectedTargets.set(targetKey(t), t);
        else this.selectedTargets.delete(targetKey(t));
        this.updatePullSelected();
    }

    private updatePullSelected(): void {
        if (!this.pullBtnEl) return;
        const n = this.selectedTargets.size;
        this.pullArmed = false;
        this.pullBtnEl.disabled = n === 0;
        this.pullBtnEl.textContent = n > 0 ? `Pull selected (${n}) →` : "Pull selected →";
    }

    // ── Tree rendering ────────────────────────────────────────────────────────

    private renderTree(): void {
        const wrap = this.contentEl.querySelector(".onyxaz-tree-wrap") as HTMLElement;
        if (!wrap) return;
        wrap.empty();

        if (this.loadingProjects) {
            wrap.createEl("p", { text: "Loading projects…", cls: "onyxaz-hint" });
            return;
        }
        if (this.projects.length === 0) {
            wrap.createEl("p", { text: "No projects found.", cls: "onyxaz-hint" });
            return;
        }

        for (const project of this.projects) {
            this.renderProject(wrap, project);
        }
    }

    private renderProject(parent: HTMLElement, node: ProjectNode): void {
        const el = parent.createDiv({ cls: "onyxaz-tree-node onyxaz-tree-project" });

        const header = el.createDiv({ cls: "onyxaz-tree-row" });
        const chevron = header.createSpan({ cls: "onyxaz-chevron", text: node.expanded ? "▼" : "▶" });
        header.createSpan({ text: ` 📁 ${node.name}`, cls: "onyxaz-tree-label" });

        const childWrap = el.createDiv({ cls: "onyxaz-tree-children" });
        childWrap.style.display = node.expanded ? "" : "none";

        if (node.expanded) {
            if (!node.loaded) {
                childWrap.createEl("p", { text: "Loading…", cls: "onyxaz-hint onyxaz-tree-indent" });
            } else if (node.repos.length === 0) {
                childWrap.createEl("p", { text: "No repositories.", cls: "onyxaz-hint onyxaz-tree-indent" });
            } else {
                for (const repo of node.repos) this.renderRepo(childWrap, repo);
            }
        }

        header.addEventListener("click", async () => {
            node.expanded = !node.expanded;
            chevron.textContent = node.expanded ? "▼" : "▶";
            childWrap.style.display = node.expanded ? "" : "none";

            if (node.expanded && !node.loaded) {
                const spinner = childWrap.createEl("p", {
                    text: "Loading repositories…", cls: "onyxaz-hint onyxaz-tree-indent",
                });
                try {
                    // Detailed gives each repo's default branch, so a repo checkbox
                    // can select the right target without expanding it first.
                    const repos = await this.plugin.adoManager.listRepositoriesDetailed(node.name);
                    node.repos = repos.map(r => ({
                        name: r.name, project: node.name, defaultBranch: r.branch,
                        branches: [], loaded: false, expanded: false,
                    }));
                } catch (e) {
                    new Notice(`OnyxAz: Failed to load repos — ${(e as Error).message}`);
                }
                node.loaded = true;
                spinner.remove();
                childWrap.empty();
                if (node.repos.length === 0) {
                    childWrap.createEl("p", { text: "No repositories.", cls: "onyxaz-hint onyxaz-tree-indent" });
                } else {
                    for (const repo of node.repos) this.renderRepo(childWrap, repo);
                }
            }
        });
    }

    private renderRepo(parent: HTMLElement, node: RepoNode): void {
        const el = parent.createDiv({ cls: "onyxaz-tree-node onyxaz-tree-repo" });

        const header = el.createDiv({ cls: "onyxaz-tree-row" });

        // Multi-select checkbox = this repo's default branch.
        if (this.onPullMany) {
            const target: RepoTarget = { project: node.project, repo: node.name, branch: node.defaultBranch };
            const cb = header.createEl("input", { type: "checkbox" });
            cb.checked = this.isPicked(target);
            cb.title = `Select ${node.name} · ${node.defaultBranch}`;
            cb.addEventListener("click", (e) => e.stopPropagation()); // don't toggle expand
            cb.addEventListener("change", () => this.togglePick(target, cb.checked));
        }

        const chevron = header.createSpan({ cls: "onyxaz-chevron", text: node.expanded ? "▼" : "▶" });
        header.createSpan({ text: ` 🗂 ${node.name}`, cls: "onyxaz-tree-label" });

        const childWrap = el.createDiv({ cls: "onyxaz-tree-children" });
        childWrap.style.display = node.expanded ? "" : "none";

        if (node.expanded && node.loaded) {
            this.renderBranches(childWrap, node);
        }

        header.addEventListener("click", async () => {
            node.expanded = !node.expanded;
            chevron.textContent = node.expanded ? "▼" : "▶";
            childWrap.style.display = node.expanded ? "" : "none";

            if (node.expanded && !node.loaded) {
                const spinner = childWrap.createEl("p", {
                    text: "Loading branches…", cls: "onyxaz-hint onyxaz-tree-indent",
                });
                try {
                    node.branches = await this.plugin.adoManager.listBranchesFor(node.project, node.name);
                } catch (e) {
                    new Notice(`OnyxAz: Failed to load branches — ${(e as Error).message}`);
                    node.branches = [];
                }
                node.loaded = true;
                spinner.remove();
                childWrap.empty();
                this.renderBranches(childWrap, node);
            }
        });
    }

    private renderBranches(parent: HTMLElement, node: RepoNode): void {
        if (node.branches.length === 0) {
            parent.createEl("p", { text: "No branches.", cls: "onyxaz-hint onyxaz-tree-indent" });
            return;
        }
        for (const branch of node.branches) {
            const isSelected =
                this.selected?.project === node.project &&
                this.selected?.repo === node.name &&
                this.selected?.branch === branch;

            const row = parent.createDiv({
                cls: `onyxaz-tree-row onyxaz-tree-branch${isSelected ? " onyxaz-tree-selected" : ""}`,
            });

            // Multi-select checkbox = this specific branch.
            if (this.onPullMany) {
                const target: RepoTarget = { project: node.project, repo: node.name, branch };
                const cb = row.createEl("input", { type: "checkbox" });
                cb.checked = this.isPicked(target);
                cb.addEventListener("click", (e) => e.stopPropagation()); // don't trigger single-select
                cb.addEventListener("change", () => this.togglePick(target, cb.checked));
            }

            row.createSpan({ text: "  ⎇ ", cls: "onyxaz-branch-icon" });
            row.createSpan({ text: branch, cls: "onyxaz-tree-label" });

            row.addEventListener("click", () => {
                // Deselect any previous branch row
                this.contentEl.querySelectorAll(".onyxaz-tree-selected").forEach(el => {
                    el.removeClass("onyxaz-tree-selected");
                });
                row.addClass("onyxaz-tree-selected");
                this.selected = { project: node.project, repo: node.name, branch };
                this.updateSelectionInfo();
                this.connectBtnEl.disabled = false;
            });
        }
    }

    private updateSelectionInfo(): void {
        if (!this.selectionInfoEl) return;
        this.selectionInfoEl.empty();
        if (this.selected) {
            this.selectionInfoEl.createEl("span", {
                text: `${this.selected.project} / ${this.selected.repo}  ·  ${this.selected.branch}`,
                cls: "onyxaz-selected-label",
            });
        } else {
            this.selectionInfoEl.createEl("span", {
                text: this.onPullMany ? "Tick repos to pull, or click a branch to connect" : "Select a branch to connect",
                cls: "onyxaz-hint",
            });
        }
    }
}
