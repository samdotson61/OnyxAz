import { App, Modal, Notice } from "obsidian";
import type OnyxAz from "../main";
import { parseSetupText } from "../util/importSetup";
import { extractDocxText } from "../util/docxText";

// Lets a user import their IT setup details — by choosing the setup document
// file (.txt/.json/.md or the .docx guide) for automatic import, or by pasting
// the text. Either way OnyxAz pulls out the organization URL, client ID, and
// tenant ID.
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
            text: "Choose the setup document your IT team provided for automatic import, " +
                "or paste its text below. OnyxAz pulls out the organization URL, client ID, and tenant ID.",
        });

        // ── Choose a file (automatic import) ──────────────────────────────────
        const fileRow = contentEl.createDiv({ cls: "onyxaz-nav-row" });
        const chooseBtn = fileRow.createEl("button", { text: "📂 Choose setup file…", cls: "mod-cta" });

        // Hidden native file picker.
        const fileInput = contentEl.createEl("input", { type: "file" });
        fileInput.accept = ".txt,.json,.md,.csv,.docx";
        fileInput.style.display = "none";
        chooseBtn.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            chooseBtn.disabled = true;
            chooseBtn.textContent = "Reading…";
            try {
                const text = file.name.toLowerCase().endsWith(".docx")
                    ? await extractDocxText(await file.arrayBuffer())
                    : await file.text();
                if (!text.trim()) {
                    new Notice("OnyxAz: Couldn't read that file. Open the OnyxAz Setup.txt, or paste the text.", 8000);
                    return;
                }
                textarea.value = text;
                this.applyText(text);
            } catch {
                new Notice("OnyxAz: Couldn't read that file. Try the OnyxAz Setup.txt, or paste the text.", 8000);
            } finally {
                chooseBtn.disabled = false;
                chooseBtn.textContent = "📂 Choose setup file…";
                fileInput.value = ""; // allow re-picking the same file
            }
        });

        contentEl.createEl("p", { cls: "onyxaz-hint", text: "— or paste the setup text —" });

        const textarea = contentEl.createEl("textarea", { cls: "onyxaz-import-textarea" });
        textarea.rows = 10;
        textarea.placeholder =
            'Paste setup text or JSON here, e.g.\n' +
            '{ "organizationUrl": "https://dev.azure.com/myorg", "clientId": "…", "tenantId": "…" }';

        const row = contentEl.createDiv({ cls: "onyxaz-nav-row" });

        const cancel = row.createEl("button", { text: "Cancel" });
        cancel.addEventListener("click", () => this.close());

        const apply = row.createEl("button", { text: "Import", cls: "mod-cta" });
        apply.addEventListener("click", () => this.applyText(textarea.value));
    }

    // Parses setup text, saves whatever it finds, and closes on success. Shared
    // by the file picker (automatic) and the paste + Import button.
    private async applyText(text: string): Promise<void> {
        const parsed = parseSetupText(text);
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
            new Notice("OnyxAz: Couldn't find any setup details in that document.", 6000);
            return;
        }
        await this.plugin.saveSettings();
        new Notice(`OnyxAz: Imported ${found.join(", ")}.`, 6000);
        this.onImported();
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
