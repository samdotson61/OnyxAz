import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type OnyxAz from "../main";
import type { DeviceCodeResponse } from "../auth/entraAuth";
import { ONYX_AZ_DEFAULT_CLIENT_ID } from "../constants";
import { OnboardingModal } from "../ui/onboardingModal";

export class OnyxAzSettingsTab extends PluginSettingTab {
    private deviceCode: DeviceCodeResponse | null = null;
    private authFlowActive = false;
    private showAdvanced = false;

    constructor(app: App, private readonly plugin: OnyxAz) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        this.renderAccountSection(containerEl);
        this.renderConnectionSection(containerEl);
        this.renderAutomationSection(containerEl);
        this.renderCommitSection(containerEl);
        this.renderMiscSection(containerEl);
        this.renderAdvancedSection(containerEl);
    }

    // ── Account (Microsoft sign-in — primary) ─────────────────────────────────

    private renderAccountSection(containerEl: HTMLElement): void {
        containerEl.createEl("h2", { text: "Account" });

        if (this.authFlowActive && this.deviceCode) {
            const box = containerEl.createDiv({ cls: "onyxaz-code-box" });
            box.createEl("p", { text: "Complete sign-in in your browser:" });
            box.createEl("span", { text: "1. Open: " });
            box.createEl("a", {
                text: this.deviceCode.verification_uri,
                href: this.deviceCode.verification_uri,
            }).setAttr("target", "_blank");
            box.createEl("br");
            box.createEl("span", { text: "2. Enter code: " });
            box.createEl("code", { text: this.deviceCode.user_code, cls: "onyxaz-user-code" });

            new Setting(containerEl)
                .setName("Waiting for sign-in…")
                .addButton((btn) =>
                    btn.setButtonText("Cancel").onClick(() => {
                        this.plugin.entraAuth.cancelPoll();
                        this.authFlowActive = false;
                        this.deviceCode = null;
                        this.display();
                    })
                );
            return;
        }

        if (this.plugin.entraAuth.isSignedIn) {
            new Setting(containerEl)
                .setName("Signed in with Microsoft")
                .setDesc("Your session refreshes automatically in the background.")
                .addButton((btn) =>
                    btn.setButtonText("Sign out").onClick(async () => {
                        await this.plugin.entraAuth.signOut();
                        new Notice("OnyxAz: Signed out.");
                        this.display();
                    })
                );
        } else {
            new Setting(containerEl)
                .setName("Microsoft account")
                .setDesc("Sign in with your work account to sync with Azure DevOps.")
                .addButton((btn) =>
                    btn
                        .setButtonText("Sign in with Microsoft")
                        .setCta()
                        .onClick(async () => {
                            btn.setButtonText("Starting…");
                            btn.setDisabled(true);
                            try {
                                const dcr = await this.plugin.entraAuth.startDeviceCodeFlow();
                                this.deviceCode = dcr;
                                this.authFlowActive = true;
                                this.display();

                                await this.plugin.entraAuth.pollForToken(dcr);

                                this.authFlowActive = false;
                                this.deviceCode = null;
                                this.display();
                                new Notice("OnyxAz: Signed in with Microsoft successfully.");
                            } catch (e) {
                                this.authFlowActive = false;
                                this.deviceCode = null;
                                this.display();
                                new Notice(`OnyxAz: Sign-in failed — ${(e as Error).message}`);
                            }
                        })
                );
        }
    }

    // ── Connection ────────────────────────────────────────────────────────────

    private renderConnectionSection(containerEl: HTMLElement): void {
        containerEl.createEl("h2", { text: "Azure DevOps" });

        // Quick re-run setup wizard
        new Setting(containerEl)
            .setName("Run setup wizard")
            .setDesc("Re-run the step-by-step connection wizard.")
            .addButton((btn) =>
                btn.setButtonText("Open wizard").onClick(() => {
                    new OnboardingModal(this.app, this.plugin).open();
                })
            );

        new Setting(containerEl)
            .setName("Organization URL")
            .setDesc("e.g. https://dev.azure.com/myorg")
            .addText((t) =>
                t
                    .setPlaceholder("https://dev.azure.com/myorg")
                    .setValue(this.plugin.settings.organizationUrl)
                    .onChange(async (v) => {
                        this.plugin.settings.organizationUrl = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Project")
            .addText((t) =>
                t
                    .setValue(this.plugin.settings.project)
                    .onChange(async (v) => {
                        this.plugin.settings.project = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Repository")
            .addText((t) =>
                t
                    .setValue(this.plugin.settings.repository)
                    .onChange(async (v) => {
                        this.plugin.settings.repository = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Branch")
            .addText((t) =>
                t
                    .setPlaceholder("main")
                    .setValue(this.plugin.settings.branch)
                    .onChange(async (v) => {
                        this.plugin.settings.branch = v.trim() || "main";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Local sync folder")
            .setDesc(
                "By default, files go into ADO/<ProjectName>/ so repos never mix at the vault root. " +
                "Override here only if you need a different location. Leave blank to use the default."
            )
            .addText((t) =>
                t
                    .setPlaceholder(`ADO/${this.plugin.settings.project || "ProjectName"} (default)`)
                    .setValue(this.plugin.settings.localSyncPath)
                    .onChange(async (v) => {
                        this.plugin.settings.localSyncPath = v.trim().replace(/^\/+|\/+$/g, "");
                        await this.plugin.saveSettings();
                        new Notice(
                            "OnyxAz: Sync folder updated. " +
                            "Use Force re-pull to download files to the new location.",
                            6000
                        );
                    })
            );

        new Setting(containerEl)
            .setName("Test connection")
            .addButton((btn) =>
                btn
                    .setButtonText("Test")
                    .setCta()
                    .onClick(async () => {
                        btn.setButtonText("Testing…");
                        btn.setDisabled(true);
                        try {
                            await this.plugin.adoManager.testConnection();
                            new Notice("OnyxAz: Connection successful.");
                        } catch (e) {
                            new Notice(`OnyxAz: Connection failed — ${(e as Error).message}`);
                        } finally {
                            btn.setButtonText("Test");
                            btn.setDisabled(false);
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Force re-pull")
            .setDesc("Re-download every file from the remote branch, regardless of local state. Use this if your vault is missing files.")
            .addButton((btn) =>
                btn
                    .setButtonText("Force re-pull")
                    .onClick(async () => {
                        btn.setButtonText("Pulling…");
                        btn.setDisabled(true);
                        try {
                            this.plugin.promiseQueue.addTask(() => this.plugin.forcePull());
                            new Notice("OnyxAz: Force re-pull queued.");
                        } finally {
                            btn.setButtonText("Force re-pull");
                            btn.setDisabled(false);
                        }
                    })
            );
    }

    // ── Automation ────────────────────────────────────────────────────────────

    private renderAutomationSection(containerEl: HTMLElement): void {
        containerEl.createEl("h2", { text: "Automation" });

        const intervalOpts: Record<string, string> = {
            "0": "Disabled", "1": "1 minute", "5": "5 minutes",
            "10": "10 minutes", "15": "15 minutes", "30": "30 minutes", "60": "1 hour",
        };

        new Setting(containerEl)
            .setName("Auto pull interval")
            .setDesc("Pull remote changes on a schedule. Push always requires manual confirmation.")
            .addDropdown((dd) => {
                for (const [v, l] of Object.entries(intervalOpts)) dd.addOption(v, l);
                dd.setValue(String(this.plugin.settings.autoSyncInterval)).onChange(async (v) => {
                    this.plugin.settings.autoSyncInterval = parseInt(v);
                    await this.plugin.saveSettings();
                    this.plugin.automaticsManager.reload();
                });
            });

        new Setting(containerEl)
            .setName("Second auto pull interval")
            .setDesc("Additional independent pull schedule.")
            .addDropdown((dd) => {
                for (const [v, l] of Object.entries(intervalOpts)) dd.addOption(v, l);
                dd.setValue(String(this.plugin.settings.autoPullInterval)).onChange(async (v) => {
                    this.plugin.settings.autoPullInterval = parseInt(v);
                    await this.plugin.saveSettings();
                    this.plugin.automaticsManager.reload();
                });
            });

        new Setting(containerEl)
            .setName("Auto sync on save")
            .setDesc("Sync after you stop editing a file.")
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoSyncOnSave).onChange(async (v) => {
                    this.plugin.settings.autoSyncOnSave = v;
                    await this.plugin.saveSettings();
                    this.plugin.automaticsManager.reload();
                    this.display();
                })
            );

        if (this.plugin.settings.autoSyncOnSave) {
            new Setting(containerEl)
                .setName("On-save debounce (ms)")
                .setDesc("Wait this long after last keystroke before syncing.")
                .addText((t) =>
                    t
                        .setPlaceholder("10000")
                        .setValue(String(this.plugin.settings.autoSyncOnSaveDebounceMs))
                        .onChange(async (v) => {
                            const n = parseInt(v);
                            if (!isNaN(n) && n >= 500) {
                                this.plugin.settings.autoSyncOnSaveDebounceMs = n;
                                await this.plugin.saveSettings();
                            }
                        })
                );
        }
    }

    // ── Commit message ────────────────────────────────────────────────────────

    private renderCommitSection(containerEl: HTMLElement): void {
        containerEl.createEl("h2", { text: "Commit Message" });

        new Setting(containerEl)
            .setName("Template")
            .setDesc("Tokens: {{date}}, {{numFiles}}, {{vaultName}}")
            .addText((t) =>
                t
                    .setPlaceholder("vault sync: {{date}}")
                    .setValue(this.plugin.settings.commitMessage)
                    .onChange(async (v) => {
                        this.plugin.settings.commitMessage = v || "vault sync: {{date}}";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Date format")
            .setDesc("Tokens: YYYY MM DD HH mm ss")
            .addText((t) =>
                t
                    .setPlaceholder("YYYY-MM-DD HH:mm:ss")
                    .setValue(this.plugin.settings.commitDateFormat)
                    .onChange(async (v) => {
                        this.plugin.settings.commitDateFormat = v || "YYYY-MM-DD HH:mm:ss";
                        await this.plugin.saveSettings();
                    })
            );
    }

    // ── Misc ──────────────────────────────────────────────────────────────────

    private renderMiscSection(containerEl: HTMLElement): void {
        containerEl.createEl("h2", { text: "Miscellaneous" });

        new Setting(containerEl)
            .setName("Pull on startup")
            .addToggle((t) =>
                t.setValue(this.plugin.settings.pullOnStartup).onChange(async (v) => {
                    this.plugin.settings.pullOnStartup = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Show status bar")
            .addToggle((t) =>
                t.setValue(this.plugin.settings.showStatusBar).onChange(async (v) => {
                    this.plugin.settings.showStatusBar = v;
                    await this.plugin.saveSettings();
                    this.plugin.refreshStatusBar();
                })
            );

        new Setting(containerEl)
            .setName("Show changed file count in status bar")
            .addToggle((t) =>
                t.setValue(this.plugin.settings.showChangedFilesCount).onChange(async (v) => {
                    this.plugin.settings.showChangedFilesCount = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Notify on success")
            .addToggle((t) =>
                t.setValue(this.plugin.settings.notifyOnSuccess).onChange(async (v) => {
                    this.plugin.settings.notifyOnSuccess = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Max attachment size (MB)")
            .setDesc("Files larger than this are skipped during push.")
            .addText((t) =>
                t
                    .setPlaceholder("5")
                    .setValue(String(this.plugin.settings.maxAttachmentSizeMB))
                    .onChange(async (v) => {
                        const n = parseFloat(v);
                        if (!isNaN(n) && n > 0) {
                            this.plugin.settings.maxAttachmentSizeMB = n;
                            await this.plugin.saveSettings();
                        }
                    })
            );
    }

    // ── Advanced (collapsed by default) ──────────────────────────────────────

    private renderAdvancedSection(containerEl: HTMLElement): void {
        const header = containerEl.createEl("h2", {
            text: `Advanced ${this.showAdvanced ? "▲" : "▼"}`,
        });
        header.style.cursor = "pointer";
        header.style.userSelect = "none";
        header.addEventListener("click", () => {
            this.showAdvanced = !this.showAdvanced;
            this.display();
        });

        if (!this.showAdvanced) return;

        containerEl.createEl("p", {
            cls: "onyxaz-hint",
            text: "Use a Personal Access Token instead of Microsoft sign-in, or override the Azure App Client ID.",
        });

        new Setting(containerEl)
            .setName("Auth method")
            .setDesc("Switch to PAT if your org blocks the device code flow.")
            .addDropdown((dd) =>
                dd
                    .addOption("entra", "Microsoft Entra (recommended)")
                    .addOption("pat", "Personal Access Token")
                    .setValue(this.plugin.settings.authMethod)
                    .onChange(async (v) => {
                        this.plugin.settings.authMethod = v as "pat" | "entra";
                        await this.plugin.saveSettings();
                        this.display();
                    })
            );

        if (this.plugin.settings.authMethod === "pat") {
            new Setting(containerEl)
                .setName("Personal Access Token")
                .setDesc("Requires Code (Read & Write) scope.")
                .addText((t) => {
                    t.inputEl.type = "password";
                    t
                        .setPlaceholder("Paste your PAT here")
                        .setValue(this.plugin.settings.pat)
                        .onChange(async (v) => {
                            this.plugin.settings.pat = v.trim();
                            await this.plugin.saveSettings();
                        });
                });
        }

        // Show Client ID field only when there's no compiled-in default
        if (!ONYX_AZ_DEFAULT_CLIENT_ID) {
            new Setting(containerEl)
                .setName("Azure App Client ID")
                .setDesc("Override the default Azure app registration used for sign-in.")
                .addText((t) =>
                    t
                        .setPlaceholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
                        .setValue(this.plugin.settings.entraClientId)
                        .onChange(async (v) => {
                            this.plugin.settings.entraClientId = v.trim();
                            await this.plugin.saveSettings();
                        })
                );
        }

        new Setting(containerEl)
            .setName("Tenant ID")
            .setDesc('"organizations" works for most accounts.')
            .addText((t) =>
                t
                    .setPlaceholder("organizations")
                    .setValue(this.plugin.settings.entraTenantId)
                    .onChange(async (v) => {
                        this.plugin.settings.entraTenantId = v.trim() || "organizations";
                        await this.plugin.saveSettings();
                    })
            );
    }
}
