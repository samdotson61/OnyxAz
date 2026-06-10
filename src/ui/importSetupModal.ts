import { App, Modal, Notice } from "obsidian";
import type OnyxAz from "../main";
import { parseSetupText } from "../util/importSetup";

// Lets a user paste their IT setup details — either a JSON config blob or the
// raw text of a setup document — and auto-fills the connection settings.
export class ImportSetupModal extends Modal {
    constructor(
        app: App,
        private readonly plugin: OnyxAz,
        private readonly onImported: () => void
    ) {
        super(app);
        this.modalEl.addClass("onyxaz-import-setup");
    }

    onOpen(): void {
        const { contentEl } = this;
        this.titleEl.setText("Import setup details");

        contentEl.createEl("p", {
            cls: "onyxaz-hint",
            text: "Paste the setup details your IT team provided — a JSON config or the setup " +
                "document text. OnyxAz will pull out the organization URL, client ID, and tenant ID.",
        });

        const textarea = contentEl.createEl("textarea", { cls: "onyxaz-import-textarea" });
        textarea.rows = 10;
        textarea.placeholder =
            'Paste setup text or JSON here, e.g.\n' +
            '{ "organizationUrl": "https://dev.azure.com/myorg", "clientId": "…", "tenantId": "…" }';

        const row = contentEl.createDiv({ cls: "onyxaz-nav-row" });

        const cancel = row.createEl("button", { text: "Cancel" });
        cancel.addEventListener("click", () => this.close());

        const apply = row.createEl("button", { text: "Import", cls: "mod-cta" });
        apply.addEventListener("click", async () => {
            const parsed = parseSetupText(textarea.value);
            const found: string[] = [];
            if (parsed.organizationUrl) {
                this.plugin.settings.organizationUrl = parsed.organizationUrl;
                found.push("organization URL");
            }
            if (parsed.clientId) {
                this.plugin.settings.entraClientId = parsed.clientId;
                found.push("client ID");
            }
            if (parsed.tenantId) {
                this.plugin.settings.entraTenantId = parsed.tenantId;
                found.push("tenant ID");
            }
            if (found.length === 0) {
                new Notice("OnyxAz: Couldn't find any setup details in that text.", 6000);
                return;
            }
            await this.plugin.saveSettings();
            new Notice(`OnyxAz: Imported ${found.join(", ")}.`, 6000);
            this.onImported();
            this.close();
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
