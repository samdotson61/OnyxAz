import { describe, it, expect } from "vitest";
import { parseSetupText } from "./importSetup";

// Generic placeholder values only — never put a real org URL / client ID /
// tenant ID in the repo.
const ORG = "https://dev.azure.com/myorg";
const CLIENT = "11111111-1111-1111-1111-111111111111";
const TENANT = "22222222-2222-2222-2222-222222222222";

describe("parseSetupText", () => {
    it("returns empty for blank input", () => {
        expect(parseSetupText("")).toEqual({});
        expect(parseSetupText("   ")).toEqual({});
    });

    it("parses a JSON config blob with various key spellings", () => {
        const json = JSON.stringify({
            "Organization URL": ORG,
            "Application (client) ID": CLIENT,
            "Directory (tenant) ID": TENANT,
        });
        expect(parseSetupText(json)).toEqual({
            organizationUrl: ORG,
            clientId: CLIENT,
            tenantId: TENANT,
        });
    });

    it("parses the canonical onyxaz.config.json shape", () => {
        const json = JSON.stringify({
            organizationUrl: ORG,
            clientId: CLIENT,
            tenantId: "organizations",
        });
        expect(parseSetupText(json)).toEqual({
            organizationUrl: ORG,
            clientId: CLIENT,
            tenantId: "organizations",
        });
    });

    it("scrapes a free-form setup document", () => {
        const doc =
            "OnyxAz — Setup\n\n" +
            `Step 1: Organization URL is ${ORG}\n` +
            `Step 2: Azure Application (client) ID:  ${CLIENT}\n` +
            `Step 3: Directory (tenant) ID: ${TENANT}\n`;
        expect(parseSetupText(doc)).toEqual({
            organizationUrl: ORG,
            clientId: CLIENT,
            tenantId: TENANT,
        });
    });

    it("treats a single unlabelled GUID as the client ID", () => {
        const r = parseSetupText(`Use ${ORG} and ${CLIENT}`);
        expect(r.organizationUrl).toBe(ORG);
        expect(r.clientId).toBe(CLIENT);
        expect(r.tenantId).toBeUndefined();
    });

    it("strips trailing punctuation from the URL", () => {
        const r = parseSetupText("Org: https://dev.azure.com/acme.");
        expect(r.organizationUrl).toBe("https://dev.azure.com/acme");
    });
});
