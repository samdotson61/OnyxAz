import { App, Modal, Notice, Setting } from "obsidian";
import type OnyxAz from "../main";
import type { DeviceCodeResponse } from "../auth/entraAuth";
import { RepoTreeModal } from "./repoTreeModal";
import { ImportSetupModal } from "./importSetupModal";
import { validateOrgUrl } from "../util/validation";

type Step = "welcome" | "signin" | "browse" | "done";

export class OnboardingModal extends Modal {
    private step: Step = "welcome";
    private authChoice: "entra" | "pat" = "entra";
    private deviceCode: DeviceCodeResponse | null = null;
    private authFlowActive = false;
    private signinEmail = "";

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
        this.plugin.entraAuth.cancelInteractive();
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
            case "signin":  return this.authChoice === "pat" ? "Personal Access Token" : "Sign in with Microsoft";
            case "browse":  return "Select Repository";
            case "done":    return "You're all set!";
        }
    }

    // ── Step 1: Welcome + org URL + auth choice ───────────────────────────────

    private renderWelcome(): void {
        const { contentEl } = this;

        contentEl.createEl("p", {
            text: "OnyxAz syncs this vault with an Azure DevOps Git repository.",
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

        // Quick-fill from a pasted config / setup document
        const importBtn = contentEl.createEl("button", {
            text: "📋 Import setup details…",
            cls: "onyxaz-import-link",
        });
        importBtn.addEventListener("click", () => {
            new ImportSetupModal(this.app, this.plugin, () => this.render()).open();
        });

        contentEl.createEl("p", {
            text: "How would you like to sign in?",
            cls: "onyxaz-hint",
        });

        const choiceRow = contentEl.createDiv({ cls: "onyxaz-auth-choice-row" });

        const makeChoice = (label: string, desc: string, choice: "entra" | "pat") => {
            const btn = choiceRow.createEl("button", { cls: "onyxaz-auth-choice-btn" });
            btn.createEl("span", { text: label, cls: "onyxaz-auth-choice-label" });
            btn.createEl("span", { text: desc, cls: "onyxaz-auth-choice-desc" });
            btn.addEventListener("click", async () => {
                if (!orgUrl) { new Notice("Please enter your organization URL first."); return; }
                const check = validateOrgUrl(orgUrl);
                if (check.error) { new Notice(`OnyxAz: ${check.error}`, 8000); return; }
                if (check.warning) new Notice(`OnyxAz: ${check.warning}`, 10000);
                this.plugin.settings.organizationUrl = orgUrl;
                await this.plugin.saveSettings();
                this.authChoice = choice;
                this.step = "signin";
                this.render();
            });
        };

        makeChoice(
            "SSO for Teams →",
            "Microsoft sign-in via device code. Requires an Azure app registered by your IT admin.",
            "entra"
        );
        makeChoice(
            "PAT for Individuals →",
            "Personal Access Token — quick setup, no admin needed.",
            "pat"
        );
    }

    // ── Step 2: Sign in ───────────────────────────────────────────────────────

    private renderSignIn(): void {
        if (this.authChoice === "pat") {
            this.renderSignInPat();
        } else {
            this.renderSignInSso();
        }
    }

    private renderSignInPat(): void {
        const { contentEl } = this;

        contentEl.createEl("p", {
            text: "Create a Personal Access Token in Azure DevOps and paste it below.",
        });

        const box = contentEl.createDiv({ cls: "onyxaz-code-box" });
        const orgBase = this.plugin.settings.organizationUrl.replace(/\/$/, "");
        box.createEl("p", { text: "1. Open your Personal Access Tokens page:" });
        box.createEl("a", {
            text: `${orgBase}/_usersSettings/tokens ↗`,
            href: `${orgBase}/_usersSettings/tokens`,
        }).setAttr("target", "_blank");
        box.createEl("p", { text: "2. New Token → scope: Code (Read & Write) → Create" });
        box.createEl("p", { text: "3. Copy the token and paste it below" });

        let pat = this.plugin.settings.pat;
        new Setting(contentEl)
            .setName("Personal Access Token")
            .addText((t) =>
                t
                    .setPlaceholder("Paste your token here")
                    .setValue(pat)
                    .onChange((v) => { pat = v.trim(); })
            );

        this.navButtons(contentEl, {
            back: { label: "← Back", onClick: () => { this.step = "welcome"; this.render(); } },
            next: {
                label: "Connect →",
                cta: true,
                onClick: async (btn) => {
                    if (!pat) { new Notice("Please paste your Personal Access Token."); return; }
                    btn.textContent = "Connecting…";
                    btn.disabled = true;
                    this.plugin.settings.pat = pat;
                    this.plugin.settings.authMethod = "pat";
                    await this.plugin.saveSettings();
                    this.step = "browse";
                    this.render();
                },
            },
        });
    }

    private renderSignInSso(): void {
        const { contentEl } = this;

        // ── Device code waiting screen ────────────────────────────────────────
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

        // ── Sign-in screen ────────────────────────────────────────────────────
        contentEl.createEl("p", {
            text: "Sign in with your organization account. OnyxAz detects your tenant automatically from your email.",
        });

        // Import the setup document your IT admin provided (choose the file or
        // paste it) to auto-fill the organization URL and client ID.
        const importBtn = contentEl.createEl("button", {
            text: "📂 Import setup document (choose file or paste)…",
            cls: "onyxaz-import-link",
        });
        importBtn.addEventListener("click", () => {
            new ImportSetupModal(this.app, this.plugin, () => this.render()).open();
        });

        new Setting(contentEl)
            .setName("Organization email")
            .setDesc("Your work account, e.g. you@company.com")
            .addText((t) =>
                t
                    .setPlaceholder("you@company.com")
                    .setValue(this.signinEmail)
                    .onChange((v) => { this.signinEmail = v.trim(); })
            );

        let clientId = this.plugin.settings.entraClientId;
        new Setting(contentEl)
            .setName("Azure client ID")
            .setDesc("From your admin's setup document — or paste the document above to fill it automatically.")
            .addText((t) =>
                t
                    .setPlaceholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
                    .setValue(clientId)
                    .onChange((v) => { clientId = v.trim(); })
            );

        // Validates the form, saves the client ID, and detects the tenant from
        // the email domain. Shared by both sign-in paths below.
        const prepare = async (): Promise<boolean> => {
            if (!this.signinEmail || !this.signinEmail.includes("@")) {
                new Notice("Enter your organization email address.");
                return false;
            }
            if (!clientId) {
                new Notice("Enter your Azure client ID — ask your admin, or paste your setup document.", 8000);
                return false;
            }
            this.plugin.settings.entraClientId = clientId;
            const tenant = await this.plugin.entraAuth.discoverTenantFromEmail(this.signinEmail);
            this.plugin.settings.entraTenantId = tenant;
            await this.plugin.saveSettings();
            return true;
        };

        this.navButtons(contentEl, {
            back: { label: "← Back", onClick: () => { this.step = "welcome"; this.render(); } },
            next: {
                label: "Sign in with Microsoft",
                cta: true,
                onClick: async (btn) => {
                    btn.textContent = "Detecting your organization…";
                    btn.disabled = true;
                    try {
                        if (!(await prepare())) { this.render(); return; }
                        // Interactive browser sign-in: carries the device identity
                        // (PRT), so "require compliant device" Conditional Access
                        // policies pass on managed machines.
                        btn.textContent = "Waiting for browser sign-in…";
                        await this.plugin.entraAuth.signInInteractive();
                        this.step = "browse";
                        this.render();
                    } catch (e) {
                        this.render();
                        new Notice(`OnyxAz: Sign-in failed — ${(e as Error).message}`, 10000);
                    }
                },
            },
        });

        // Fallback for environments where the browser hand-off can't complete.
        // Note: device-code sign-ins carry no device identity, so tenants that
        // require a compliant device will block them.
        const fallback = contentEl.createEl("button", {
            text: "Browser sign-in not working? Use a code instead",
            cls: "onyxaz-import-link",
        });
        fallback.addEventListener("click", async () => {
            try {
                if (!(await prepare())) return;
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
                new Notice(`OnyxAz: Sign-in failed — ${(e as Error).message}`, 10000);
            }
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
        const syncFolder = this.plugin.adoManager.getSyncRoot().replace(/\/+$/, "") || "(vault root)";

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
        this.plugin.settings.authMethod = this.authChoice;
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
