import { App, Modal, Notice } from "obsidian";
import type OnyxAz from "../main";

interface ProjectNode {
    name: string;
    repos: RepoNode[];
    loaded: boolean;
    expanded: boolean;
}

interface RepoNode {
    name: string;
    project: string;
    branches: string[];
    loaded: boolean;
    expanded: boolean;
}

export class RepoTreeModal extends Modal {
    private projects: ProjectNode[] = [];
    private loadingProjects = true;
    private selected: { project: string; repo: string; branch: string } | null = null;

    // Elements updated in-place after initial render
    private selectionInfoEl!: HTMLElement;
    private connectBtnEl!: HTMLButtonElement;

    constructor(
        app: App,
        private readonly plugin: OnyxAz,
        private readonly onSelect: (project: string, repo: string, branch: string) => Promise<void>
    ) {
        super(app);
        this.modalEl.addClass("onyxaz-repo-tree-modal");
    }

    async onOpen(): Promise<void> {
        this.titleEl.setText("Select Repository");
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
                    const names = await this.plugin.adoManager.listRepositories(node.name);
                    node.repos = names.map(n => ({
                        name: n, project: node.name, branches: [], loaded: false, expanded: false,
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
                text: "Select a branch to connect",
                cls: "onyxaz-hint",
            });
        }
    }
}
