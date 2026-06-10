import { describe, it, expect } from "vitest";
import { parseTenantFromIssuer } from "./tenant";

describe("parseTenantFromIssuer", () => {
    it("extracts a concrete tenant ID", () => {
        expect(
            parseTenantFromIssuer("https://login.microsoftonline.com/22222222-2222-2222-2222-222222222222/v2.0")
        ).toBe("22222222-2222-2222-2222-222222222222");
    });

    it("returns null for generic endpoints", () => {
        expect(parseTenantFromIssuer("https://login.microsoftonline.com/common/v2.0")).toBeNull();
        expect(parseTenantFromIssuer("https://login.microsoftonline.com/organizations/v2.0")).toBeNull();
    });

    it("returns null when no tenant is present", () => {
        expect(parseTenantFromIssuer("")).toBeNull();
        expect(parseTenantFromIssuer("https://example.com/foo")).toBeNull();
    });
});
