import { describe, it, expect } from "vitest";
import { validateOrgUrl } from "./validation";

describe("validateOrgUrl", () => {
    it("rejects an empty URL", () => {
        expect(validateOrgUrl("").ok).toBe(false);
        expect(validateOrgUrl("   ").ok).toBe(false);
    });

    it("rejects non-https URLs (token would be sent in the clear / to a bad host)", () => {
        const r = validateOrgUrl("http://dev.azure.com/myorg");
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/https/i);
    });

    it("rejects strings that aren't URLs", () => {
        expect(validateOrgUrl("dev.azure.com/myorg").ok).toBe(false);
    });

    it("accepts dev.azure.com with no warning", () => {
        const r = validateOrgUrl("https://dev.azure.com/myorg");
        expect(r.ok).toBe(true);
        expect(r.warning).toBeUndefined();
    });

    it("accepts *.visualstudio.com with no warning", () => {
        const r = validateOrgUrl("https://myorg.visualstudio.com");
        expect(r.ok).toBe(true);
        expect(r.warning).toBeUndefined();
    });

    it("allows unknown https hosts but warns (on-prem support)", () => {
        const r = validateOrgUrl("https://tfs.contoso.local/tfs");
        expect(r.ok).toBe(true);
        expect(r.warning).toMatch(/token/i);
    });
});
