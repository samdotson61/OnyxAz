import { App, Modal, Notice, Setting } from "obsidian";
import type OnyxAz from "../main";
import { ONYX_AZ_DEFAULT_CLIENT_ID } from "../constants";
import type { DeviceCodeResponse } from "../auth/entraAuth";

type Step = "welcome" | "signin" | "project" | "repository" | "branch" | "done";

export class OnboardingModal extends Modal {
    private step: Step = "welcome";
    private deviceCode: DeviceCodeResponse | null = null;
    private authFlowActive = false;
    private projects: string[] = [];
    private repos: string[] = [];
    private branches: string[] = [];

    constructor(app: App, private readonly plugin: OnyxAz) {
        super(app);
        this.modalEl.addClass("onyxaz-onboarding");
    }

    onOpen(): void {
        // If already signed in (e.g. re-opening onboarding), skip to project step
        if (this.plugin.entraAuth.isSignedIn && this.plugin.settings.organizationUrl) {
            this.step = "project";
        }
        this.render();
    }

    onClose(): void {
        this.plugin.entraAuth.cancelPoll();
        this.contentEl.empty();
    }

    // ── Renderer dispatcher ───────────────────────────────────────────────────

    private render(): void {
        this.contentEl.empty();
        this.titleEl.setText(this.titleForStep());
        switch (this.step) {
            case "welcome":    this.renderWelcome(); break;
            case "signin":     this.renderSignIn(); break;
            case "project":    this.renderProject(); break;
            case "repository": this.renderRepository(); break;
            case "branch":     this.renderBranch(); break;
            case "done":       this.renderDone(); break;
        }
    }

    private titleForStep(): string {
        switch (this.step) {
            case "welcome":    return "Connect to Azure DevOps";
            case "signin":     return "Sign in with Microsoft";
            case "project":    return "Select Project";
            case "repository": return "Select Repository";
            case "branch":     return "Select Branch";
            case "done":       return "You're all set!";
        }
    }

    // ── Step 1: Welcome + org URL ─────────────────────────────────────────────

    private renderWelcome(): void {
        const { contentEl } = this;

        contentEl.createEl("p", {
            text: "OnyxAz syncs this vault with an Azure DevOps Git repository. Sign in with your Microsoft work account to get started.",
        });

        let orgUrl = this.plugin.settings.organizationUrl;

        new Setting(contentEl)
            .setName("Organization URL")
            .setDesc("e.g. https://dev.azure.com/myorg")
            .addText((t) =>
                t
                    .setPlaceholder("https://dev.azure.com/myorg")
                    .setValue(orgUrl)
                    .onChange((v) => { orgUrl = v.trim(); })
            );

        // Show client ID field only when no default is baked in
        const needsClientId = !ONYX_AZ_DEFAULT_CLIENT_ID && !this.plugin.settings.entraClientId;
        if (needsClientId) {
            let clientId = this.plugin.settings.entraClientId;
            contentEl.createEl("p", {
                cls: "onyxaz-hint",
                text: "Ask your Azure AD admin for the OnyxAz app Client ID, then paste it below.",
            });
            new Setting(contentEl)
                .setName("Azure App Client ID")
                .setDesc("One-time setup — your team shares this ID.")
                .addText((t) =>
                    t
                        .setPlaceholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
                        .setValue(clientId)
                        .onChange((v) => { clientId = v.trim(); })
                );

            this.navButtons(contentEl, {
                next: {
                    label: "Next →",
                    cta: true,
                    onClick: async () => {
                        if (!orgUrl) { new Notice("Please enter your organization URL."); return; }
                        if (!clientId) { new Notice("Please enter the Azure App Client ID."); return; }
                        this.plugin.settings.organizationUrl = orgUrl;
                        this.plugin.settings.entraClientId = clientId;
                        await this.plugin.saveSettings();
                        this.step = "signin";
                        this.render();
                    },
                },
            });
        } else {
            this.navButtons(contentEl, {
                next: {
                    label: "Next →",
                    cta: true,
                    onClick: async () => {
                        if (!orgUrl) { new Notice("Please enter your organization URL."); return; }
                        this.plugin.settings.organizationUrl = orgUrl;
                        await this.plugin.saveSettings();
                        this.step = "signin";
                        this.render();
                    },
                },
            });
        }
    }

    // ── Step 2: Sign in ───────────────────────────────────────────────────────

    private renderSignIn(): void {
        const { contentEl } = this;

        if (this.authFlowActive && this.deviceCode) {
            contentEl.createEl("p", { text: "Complete sign-in in your browser:" });

            const box = contentEl.createDiv({ cls: "onyxaz-code-box" });
            box.createEl("p", { text: "1. Open this URL:" });
            box.createEl("a", {
                text: this.deviceCode.verification_uri,
                href: this.deviceCode.verification_uri,
            }).setAttr("target", "_blank");
            box.createEl("p", { text: "2. Enter this code:" });
            box.createEl("code", { text: this.deviceCode.user_code, cls: "onyxaz-user-code" });

            this.navButtons(contentEl, {
                back: { label: "← Cancel", onClick: () => {
                    this.plugin.entraAuth.cancelPoll();
                    this.authFlowActive = false;
                    this.deviceCode = null;
                    this.render();
                }},
            });
            return;
        }

        contentEl.createEl("p", {
            text: "Click below to sign in with your Microsoft work account. A browser window will open.",
        });

        this.navButtons(contentEl, {
            back: { label: "← Back", onClick: () => { this.step = "welcome"; this.render(); } },
            next: {
                label: "Sign in with Microsoft",
                cta: true,
                onClick: async (btn) => {
                    btn.textContent = "Starting…";
                    btn.disabled = true;
                    try {
                        const dcr = await this.plugin.entraAuth.startDeviceCodeFlow();
                        this.deviceCode = dcr;
                        this.authFlowActive = true;
                        this.render();

                        await this.plugin.entraAuth.pollForToken(dcr);

                        this.authFlowActive = false;
                        this.deviceCode = null;
                        this.step = "project";
                        await this.loadProjects();
                        this.render();
                    } catch (e) {
                        this.authFlowActive = false;
                        this.deviceCode = null;
                        this.render();
                        new Notice(`OnyxAz: Sign-in failed — ${(e as Error).message}`);
                    }
                },
            },
        });
    }

    // ── Step 3: Project ───────────────────────────────────────────────────────

    private async loadProjects(): Promise<void> {
        try {
            this.projects = await this.plugin.adoManager.listProjects();
        } catch {
            this.projects = [];
        }
    }

    private renderProject(): void {
        const { contentEl } = this;

        if (this.projects.length === 0) {
            contentEl.createEl("p", { text: "Loading projects…" });
            this.loadProjects().then(() => this.render());
            return;
        }

        let selected = this.plugin.settings.project || this.projects[0];

        new Setting(contentEl)
            .setName("Project")
            .setDesc("The Azure DevOps project containing your repository.")
            .addDropdown((dd) => {
                for (const p of this.projects) dd.addOption(p, p);
                dd.setValue(selected).onChange((v) => { selected = v; });
            });

        this.navButtons(contentEl, {
            back: { label: "← Back", onClick: () => { this.step = "signin"; this.render(); } },
            next: {
                label: "Next →",
                cta: true,
                onClick: async () => {
                    this.plugin.settings.project = selected;
                    await this.plugin.saveSettings();
                    this.repos = await this.plugin.adoManager.listRepositories(selected).catch(() => []);
                    this.step = "repository";
                    this.render();
                },
            },
        });
    }

    // ── Step 4: Repository ────────────────────────────────────────────────────

    private renderRepository(): void {
        const { contentEl } = this;

        if (this.repos.length === 0) {
            contentEl.createEl("p", { text: "No repositories found in this project." });
            this.navButtons(contentEl, {
                back: { label: "← Back", onClick: () => { this.step = "project"; this.render(); } },
            });
            return;
        }

        let selected = this.plugin.settings.repository || this.repos[0];

        new Setting(contentEl)
            .setName("Repository")
            .setDesc("The Git repository to sync this vault with.")
            .addDropdown((dd) => {
                for (const r of this.repos) dd.addOption(r, r);
                dd.setValue(selected).onChange((v) => { selected = v; });
            });

        this.navButtons(contentEl, {
            back: { label: "← Back", onClick: () => { this.step = "project"; this.render(); } },
            next: {
                label: "Next →",
                cta: true,
                onClick: async () => {
                    this.plugin.settings.repository = selected;
                    await this.plugin.saveSettings();
                    this.branches = await this.plugin.adoManager.listBranches().catch(() => []);
                    this.step = "branch";
                    this.render();
                },
            },
        });
    }

    // ── Step 5: Branch ────────────────────────────────────────────────────────

    private renderBranch(): void {
        const { contentEl } = this;

        // Offer dropdown if we have branches, else a text input
        if (this.branches.length > 0) {
            let selected = this.branches.includes(this.plugin.settings.branch)
                ? this.plugin.settings.branch
                : this.branches[0];

            new Setting(contentEl)
                .setName("Branch")
                .setDesc("Branch to sync with.")
                .addDropdown((dd) => {
                    for (const b of this.branches) dd.addOption(b, b);
                    dd.setValue(selected).onChange((v) => { selected = v; });
                });

            this.navButtons(contentEl, {
                back: { label: "← Back", onClick: () => { this.step = "repository"; this.render(); } },
                next: {
                    label: "Finish",
                    cta: true,
                    onClick: async () => {
                        this.plugin.settings.branch = selected;
                        await this.finishOnboarding();
                    },
                },
            });
        } else {
            let branch = this.plugin.settings.branch || "main";

            new Setting(contentEl)
                .setName("Branch")
                .addText((t) =>
                    t
                        .setPlaceholder("main")
                        .setValue(branch)
                        .onChange((v) => { branch = v.trim() || "main"; })
                );

            this.navButtons(contentEl, {
                back: { label: "← Back", onClick: () => { this.step = "repository"; this.render(); } },
                next: {
                    label: "Finish",
                    cta: true,
                    onClick: async () => {
                        this.plugin.settings.branch = branch;
                        await this.finishOnboarding();
                    },
                },
            });
        }
    }

    // ── Step 6: Done ──────────────────────────────────────────────────────────

    private renderDone(): void {
        const { contentEl } = this;
        const s = this.plugin.settings;

        contentEl.createEl("p", {
            text: `Your vault is now connected to ${s.project} / ${s.repository} on branch ${s.branch}.`,
        });
        contentEl.createEl("p", {
            text: "OnyxAz will sync automatically. You can adjust the schedule in Settings → OnyxAz.",
        });

        this.navButtons(contentEl, {
            next: {
                label: "Close",
                onClick: () => this.close(),
            },
        });
    }

    // ── Finish ────────────────────────────────────────────────────────────────

    private async finishOnboarding(): Promise<void> {
        this.plugin.settings.authMethod = "entra";
        this.plugin.settings.hasCompletedOnboarding = true;
        await this.plugin.saveSettings();
        this.plugin.automaticsManager.reload();
        this.step = "done";
        this.render();
    }

    // ── Navigation button helper ──────────────────────────────────────────────

    private navButtons(
        containerEl: HTMLElement,
        buttons: {
            back?: { label: string; onClick: () => void };
            next?: { label: string; cta?: boolean; onClick: (btn: HTMLButtonElement) => void | Promise<void> };
        }
    ): void {
        const row = containerEl.createDiv({ cls: "onyxaz-nav-row" });

        if (buttons.back) {
            const btn = row.createEl("button", { text: buttons.back.label });
            btn.addEventListener("click", buttons.back.onClick);
        }

        if (buttons.next) {
            const { label, cta, onClick } = buttons.next;
            const btn = row.createEl("button", { text: label });
            if (cta) btn.addClass("mod-cta");
            btn.addEventListener("click", () => onClick(btn as HTMLButtonElement));
        }
    }
}
