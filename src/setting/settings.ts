import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type OnyxAz from "../main";

export class OnyxAzSettingsTab extends PluginSettingTab {
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
            .setDesc("Your Azure DevOps organization URL, e.g. https://dev.azure.com/myorg")
            .addText((text) =>
                text
                    .setPlaceholder("https://dev.azure.com/myorg")
                    .setValue(this.plugin.settings.organizationUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.organizationUrl = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Personal Access Token")
            .setDesc("PAT with Code (Read & Write) scope. Never shared outside your vault.")
            .addText((text) => {
                text.inputEl.type = "password";
                text
                    .setPlaceholder("Paste your PAT here")
                    .setValue(this.plugin.settings.pat)
                    .onChange(async (value) => {
                        this.plugin.settings.pat = value.trim();
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Project")
            .setDesc("Azure DevOps project name")
            .addText((text) =>
                text
                    .setPlaceholder("MyProject")
                    .setValue(this.plugin.settings.project)
                    .onChange(async (value) => {
                        this.plugin.settings.project = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Repository")
            .setDesc("Git repository name within the project")
            .addText((text) =>
                text
                    .setPlaceholder("my-vault-repo")
                    .setValue(this.plugin.settings.repository)
                    .onChange(async (value) => {
                        this.plugin.settings.repository = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Branch")
            .setDesc("Branch to sync with")
            .addText((text) =>
                text
                    .setPlaceholder("main")
                    .setValue(this.plugin.settings.branch)
                    .onChange(async (value) => {
                        this.plugin.settings.branch = value.trim() || "main";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Test connection")
            .setDesc("Verify your credentials and repository settings")
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

        new Setting(containerEl)
            .setName("Auto commit-and-sync interval")
            .setDesc("Automatically pull and push on a schedule. 0 = disabled.")
            .addDropdown((dd) => {
                const opts: Record<string, string> = {
                    "0": "Disabled",
                    "1": "1 minute",
                    "5": "5 minutes",
                    "10": "10 minutes",
                    "15": "15 minutes",
                    "30": "30 minutes",
                    "60": "1 hour",
                };
                for (const [val, label] of Object.entries(opts)) dd.addOption(val, label);
                dd.setValue(String(this.plugin.settings.autoSyncInterval)).onChange(async (value) => {
                    this.plugin.settings.autoSyncInterval = parseInt(value);
                    await this.plugin.saveSettings();
                    this.plugin.automaticsManager.reload();
                });
            });

        new Setting(containerEl)
            .setName("Auto pull interval")
            .setDesc("Pull remote changes on a separate schedule. 0 = disabled.")
            .addDropdown((dd) => {
                const opts: Record<string, string> = {
                    "0": "Disabled",
                    "1": "1 minute",
                    "5": "5 minutes",
                    "10": "10 minutes",
                    "15": "15 minutes",
                    "30": "30 minutes",
                    "60": "1 hour",
                };
                for (const [val, label] of Object.entries(opts)) dd.addOption(val, label);
                dd.setValue(String(this.plugin.settings.autoPullInterval)).onChange(async (value) => {
                    this.plugin.settings.autoPullInterval = parseInt(value);
                    await this.plugin.saveSettings();
                    this.plugin.automaticsManager.reload();
                });
            });

        new Setting(containerEl)
            .setName("Auto sync on save")
            .setDesc("Trigger a commit-and-sync after you stop editing a file.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoSyncOnSave).onChange(async (value) => {
                    this.plugin.settings.autoSyncOnSave = value;
                    await this.plugin.saveSettings();
                    this.plugin.automaticsManager.reload();
                    this.display();
                })
            );

        if (this.plugin.settings.autoSyncOnSave) {
            new Setting(containerEl)
                .setName("Auto sync debounce (ms)")
                .setDesc("Wait this many milliseconds after the last edit before syncing.")
                .addText((text) =>
                    text
                        .setPlaceholder("10000")
                        .setValue(String(this.plugin.settings.autoSyncOnSaveDebounceMs))
                        .onChange(async (value) => {
                            const n = parseInt(value);
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
            .setName("Commit message template")
            .setDesc("Supports {{date}}, {{numFiles}}, {{vaultName}}")
            .addText((text) =>
                text
                    .setPlaceholder("vault sync: {{date}}")
                    .setValue(this.plugin.settings.commitMessage)
                    .onChange(async (value) => {
                        this.plugin.settings.commitMessage = value || "vault sync: {{date}}";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Date format")
            .setDesc("Format for {{date}}. Tokens: YYYY MM DD HH mm ss")
            .addText((text) =>
                text
                    .setPlaceholder("YYYY-MM-DD HH:mm:ss")
                    .setValue(this.plugin.settings.commitDateFormat)
                    .onChange(async (value) => {
                        this.plugin.settings.commitDateFormat = value || "YYYY-MM-DD HH:mm:ss";
                        await this.plugin.saveSettings();
                    })
            );

        // ── Miscellaneous ─────────────────────────────────────────────────────
        containerEl.createEl("h2", { text: "Miscellaneous" });

        new Setting(containerEl)
            .setName("Pull on startup")
            .setDesc("Automatically pull from Azure DevOps when Obsidian opens.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.pullOnStartup).onChange(async (value) => {
                    this.plugin.settings.pullOnStartup = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Show status bar")
            .setDesc("Display sync status in the Obsidian status bar.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
                    this.plugin.settings.showStatusBar = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshStatusBar();
                })
            );

        new Setting(containerEl)
            .setName("Show changed file count")
            .setDesc("Display number of locally changed files in the status bar.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showChangedFilesCount)
                    .onChange(async (value) => {
                        this.plugin.settings.showChangedFilesCount = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Notify on success")
            .setDesc("Show a notice after a successful sync.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.notifyOnSuccess).onChange(async (value) => {
                    this.plugin.settings.notifyOnSuccess = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}
