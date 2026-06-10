import { describe, it, expect } from "vitest";
import { parseSetupText } from "./importSetup";

describe("parseSetupText", () => {
    it("returns empty for blank input", () => {
        expect(parseSetupText("")).toEqual({});
        expect(parseSetupText("   ")).toEqual({});
    });

    it("parses a JSON config blob with various key spellings", () => {
        const json = JSON.stringify({
            "Organization URL": "https://dev.azure.com/myorg",
            "Application (client) ID": "11111111-1111-1111-1111-111111111111",
            "Directory (tenant) ID": "22222222-2222-2222-2222-222222222222",
        });
        expect(parseSetupText(json)).toEqual({
            organizationUrl: "https://dev.azure.com/myorg",
            clientId: "11111111-1111-1111-1111-111111111111",
            tenantId: "22222222-2222-2222-2222-222222222222",
        });
    });

    it("parses the canonical onyxaz.config.json shape", () => {
        const json = JSON.stringify({
            organizationUrl: "https://dev.azure.com/myorg",
            clientId: "11111111-1111-1111-1111-111111111111",
            tenantId: "organizations",
        });
        expect(parseSetupText(json)).toEqual({
            organizationUrl: "https://dev.azure.com/myorg",
            clientId: "11111111-1111-1111-1111-111111111111",
            tenantId: "organizations",
        });
    });

    it("scrapes a free-form setup document", () => {
        const doc =
            "OnyxAz for myorg — Setup\n\n" +
            "Step 1: Organization URL is https://dev.azure.com/myorg\n" +
            "Step 2: Azure Application (client) ID:  11111111-1111-1111-1111-111111111111\n" +
            "Step 3: Directory (tenant) ID: 22222222-2222-2222-2222-222222222222\n";
        expect(parseSetupText(doc)).toEqual({
            organizationUrl: "https://dev.azure.com/myorg",
            clientId: "11111111-1111-1111-1111-111111111111",
            tenantId: "22222222-2222-2222-2222-222222222222",
        });
    });

    it("treats a single unlabelled GUID as the client ID", () => {
        const r = parseSetupText("Use https://dev.azure.com/acme and 11111111-1111-1111-1111-111111111111");
        expect(r.organizationUrl).toBe("https://dev.azure.com/acme");
        expect(r.clientId).toBe("11111111-1111-1111-1111-111111111111");
        expect(r.tenantId).toBeUndefined();
    });

    it("strips trailing punctuation from the URL", () => {
        const r = parseSetupText("Org: https://dev.azure.com/acme.");
        expect(r.organizationUrl).toBe("https://dev.azure.com/acme");
    });
});
