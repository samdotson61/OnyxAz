import { App, Modal, Notice, Setting } from "obsidian";
import type OnyxAz from "../main";
import { ONYX_AZ_DEFAULT_CLIENT_ID } from "../constants";
import type { DeviceCodeResponse } from "../auth/entraAuth";
import { RepoTreeModal } from "./repoTreeModal";

type Step = "welcome" | "signin" | "browse" | "done";

export class OnboardingModal extends Modal {
    private step: Step = "welcome";
    private deviceCode: DeviceCodeResponse | null = null;
    private authFlowActive = false;

    constructor(app: App, private readonly plugin: OnyxAz) {
        super(app);
        this.modalEl.addClass("onyxaz-onboarding");
    }

    onOpen(): void {
        // If already signed in, skip straight to browse
        if (this.plugin.entraAuth.isSignedIn && this.plugin.settings.organizationUrl) {
            this.step = "browse";
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
            case "welcome": this.renderWelcome(); break;
            case "signin":  this.renderSignIn(); break;
            case "browse":  this.renderBrowse(); break;
            case "done":    this.renderDone(); break;
        }
    }

    private titleForStep(): string {
        switch (this.step) {
            case "welcome": return "Connect to Azure DevOps";
            case "signin":  return "Sign in with Microsoft";
            case "browse":  return "Select Repository";
            case "done":    return "You're all set!";
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
                        this.step = "browse";
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

    // ── Step 3: Browse project / repo / branch ────────────────────────────────

    private renderBrowse(): void {
        const { contentEl } = this;
        const s = this.plugin.settings;

        if (s.project && s.repository && s.branch) {
            contentEl.createEl("p", {
                text: `Connected to: ${s.project} / ${s.repository}  ·  ${s.branch}`,
                cls: "onyxaz-push-destination",
            });
        } else {
            contentEl.createEl("p", {
                text: "Browse your Azure DevOps projects and pick a repository branch to sync with.",
            });
        }

        this.navButtons(contentEl, {
            back: { label: "← Back", onClick: () => { this.step = "signin"; this.render(); } },
            next: {
                label: s.project ? "Change repository…" : "Browse repositories →",
                cta: true,
                onClick: (btn) => {
                    btn.disabled = true;
                    new RepoTreeModal(this.app, this.plugin, async (project, repo, branch) => {
                        this.plugin.settings.project = project;
                        this.plugin.settings.repository = repo;
                        this.plugin.settings.branch = branch;
                        await this.plugin.saveSettings();
                        await this.finishOnboarding();
                    }).open();
                },
            },
        });
    }

    // ── Step 4: Done ─────────────────────────────────────────────────────────

    private renderDone(): void {
        const { contentEl } = this;
        const s = this.plugin.settings;
        const syncFolder = s.localSyncPath || `ADO/${s.project}`;

        contentEl.createEl("p", {
            text: `Your vault is connected to ${s.project} / ${s.repository} on branch ${s.branch}.`,
        });
        contentEl.createEl("p", {
            text: `Files will sync into the "${syncFolder}" folder inside this vault.`,
            cls: "onyxaz-hint",
        });
        contentEl.createEl("p", {
            text: "Pull from the ribbon icon (or Settings → OnyxAz → Pull on startup). Push requires confirmation — nothing is sent automatically.",
        });

        this.navButtons(contentEl, {
            next: { label: "Close", onClick: () => this.close() },
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
