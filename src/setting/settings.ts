import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type OnyxAz from "../main";
import type { DeviceCodeResponse } from "../auth/entraAuth";

export class OnyxAzSettingsTab extends PluginSettingTab {
    // Tracks active device code flow so the UI can show the code inline
    private deviceCode: DeviceCodeResponse | null = null;
    private authFlowActive = false;

    constructor(app: App, private readonly plugin: OnyxAz) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── Azure DevOps Connection ──────────────────────────────────────────
        containerEl.createEl("h2", { text: "Azure DevOps Connection" });

        new Setting(containerEl)
            .setName("Organization URL")
            .setDesc("https://dev.azure.com/myorg")
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
            .setDesc("Azure DevOps project name.")
            .addText((t) =>
                t
                    .setPlaceholder("MyProject")
                    .setValue(this.plugin.settings.project)
                    .onChange(async (v) => {
                        this.plugin.settings.project = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Repository")
            .setDesc("Git repository name within the project.")
            .addText((t) =>
                t
                    .setPlaceholder("my-vault-repo")
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

        // ── Authentication ───────────────────────────────────────────────────
        containerEl.createEl("h2", { text: "Authentication" });

        new Setting(containerEl)
            .setName("Auth method")
            .setDesc("Personal Access Token is simpler; Microsoft Entra lets you sign in with your work account.")
            .addDropdown((dd) =>
                dd
                    .addOption("pat", "Personal Access Token (PAT)")
                    .addOption("entra", "Microsoft Entra (work account)")
                    .setValue(this.plugin.settings.authMethod)
                    .onChange(async (v) => {
                        this.plugin.settings.authMethod = v as "pat" | "entra";
                        await this.plugin.saveSettings();
                        this.display();
                    })
            );

        if (this.plugin.settings.authMethod === "pat") {
            this.renderPatSection(containerEl);
        } else {
            this.renderEntraSection(containerEl);
        }

        new Setting(containerEl)
            .setName("Test connection")
            .setDesc("Verify credentials and repository access.")
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

        // ── Automation ───────────────────────────────────────────────────────
        containerEl.createEl("h2", { text: "Automation" });

        const intervalOpts: Record<string, string> = {
            "0": "Disabled",
            "1": "1 minute",
            "5": "5 minutes",
            "10": "10 minutes",
            "15": "15 minutes",
            "30": "30 minutes",
            "60": "1 hour",
        };

        new Setting(containerEl)
            .setName("Auto commit-and-sync interval")
            .setDesc("Pull then push on a schedule. 0 = disabled.")
            .addDropdown((dd) => {
                for (const [v, l] of Object.entries(intervalOpts)) dd.addOption(v, l);
                dd.setValue(String(this.plugin.settings.autoSyncInterval)).onChange(async (v) => {
                    this.plugin.settings.autoSyncInterval = parseInt(v);
                    await this.plugin.saveSettings();
                    this.plugin.automaticsManager.reload();
                });
            });

        new Setting(containerEl)
            .setName("Auto pull interval")
            .setDesc("Pull-only schedule. 0 = disabled.")
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
            .setDesc("Trigger a commit-and-sync after you stop editing a file.")
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
                .setDesc("Wait this many ms after the last keystroke before syncing.")
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

        // ── Commit message ────────────────────────────────────────────────────
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
            .setDesc("For {{date}}. Tokens: YYYY MM DD HH mm ss")
            .addText((t) =>
                t
                    .setPlaceholder("YYYY-MM-DD HH:mm:ss")
                    .setValue(this.plugin.settings.commitDateFormat)
                    .onChange(async (v) => {
                        this.plugin.settings.commitDateFormat = v || "YYYY-MM-DD HH:mm:ss";
                        await this.plugin.saveSettings();
                    })
            );

        // ── Miscellaneous ─────────────────────────────────────────────────────
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
            .setDesc("Files larger than this are skipped during push. Images and PDFs only.")
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

    // ── PAT section ───────────────────────────────────────────────────────────

    private renderPatSection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName("Personal Access Token")
            .setDesc("Requires Code (Read & Write) scope. Stored locally in your vault data.")
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

    // ── Entra section ─────────────────────────────────────────────────────────

    private renderEntraSection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName("Azure App Client ID")
            .setDesc(
                "Client ID of an Azure app registration with Azure DevOps → Code (Read & Write) delegated permission and the device code public client flow enabled."
            )
            .addText((t) =>
                t
                    .setPlaceholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
                    .setValue(this.plugin.settings.entraClientId)
                    .onChange(async (v) => {
                        this.plugin.settings.entraClientId = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Tenant ID")
            .setDesc('Your Azure tenant ID, or "organizations" for any work account.')
            .addText((t) =>
                t
                    .setPlaceholder("organizations")
                    .setValue(this.plugin.settings.entraTenantId)
                    .onChange(async (v) => {
                        this.plugin.settings.entraTenantId = v.trim() || "organizations";
                        await this.plugin.saveSettings();
                    })
            );

        if (this.authFlowActive && this.deviceCode) {
            // Show the device code inline so the user doesn't have to hunt for it
            const box = containerEl.createDiv({ cls: "setting-item" });
            box.style.flexDirection = "column";
            box.style.alignItems = "flex-start";
            box.style.gap = "8px";

            box.createEl("p", {
                text: `1. Open this URL in your browser:`,
            });
            const link = box.createEl("a", {
                text: this.deviceCode.verification_uri,
                href: this.deviceCode.verification_uri,
            });
            link.setAttr("target", "_blank");

            box.createEl("p", {
                text: `2. Enter this code: `,
            }).createEl("strong", { text: this.deviceCode.user_code });

            new Setting(containerEl)
                .setName("Waiting for Microsoft sign-in…")
                .addButton((btn) =>
                    btn.setButtonText("Cancel").onClick(() => {
                        this.plugin.entraAuth.cancelPoll();
                        this.authFlowActive = false;
                        this.deviceCode = null;
                        this.display();
                    })
                );
        } else if (this.plugin.entraAuth.isSignedIn) {
            new Setting(containerEl)
                .setName("Signed in with Microsoft")
                .setDesc("Entra credentials are active. They refresh automatically.")
                .addButton((btn) =>
                    btn.setButtonText("Sign out").onClick(async () => {
                        await this.plugin.entraAuth.signOut();
                        new Notice("OnyxAz: Signed out.");
                        this.display();
                    })
                );
        } else {
            new Setting(containerEl)
                .setName("Microsoft sign-in")
                .setDesc("Opens a device code flow — no redirect required.")
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
                                this.display(); // re-render to show the code

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
}
