import { describe, it, expect } from "vitest";
import { base64UrlEncode, randomUrlSafe, pkceChallenge, buildAuthorizeUrl } from "./pkce";

describe("base64UrlEncode", () => {
    it("uses url-safe alphabet with no padding", () => {
        const out = base64UrlEncode(new Uint8Array([251, 255, 190, 0, 1]));
        expect(out).not.toMatch(/[+/=]/);
    });
});

describe("randomUrlSafe", () => {
    it("produces distinct url-safe values of expected length", () => {
        const a = randomUrlSafe(32);
        const b = randomUrlSafe(32);
        expect(a).not.toBe(b);
        expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes -> 43 base64url chars
    });
});

describe("pkceChallenge", () => {
    it("matches the RFC 7636 appendix B test vector", async () => {
        const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        expect(await pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    });
});

describe("buildAuthorizeUrl", () => {
    it("includes all required parameters and the tenant path", () => {
        const url = buildAuthorizeUrl({
            tenant: "1111",
            clientId: "2222",
            redirectUri: "http://localhost:8080/",
            scope: "api/.default offline_access",
            state: "st",
            challenge: "ch",
        });
        const u = new URL(url);
        expect(u.pathname).toBe("/1111/oauth2/v2.0/authorize");
        expect(u.searchParams.get("client_id")).toBe("2222");
        expect(u.searchParams.get("response_type")).toBe("code");
        expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:8080/");
        expect(u.searchParams.get("code_challenge")).toBe("ch");
        expect(u.searchParams.get("code_challenge_method")).toBe("S256");
        expect(u.searchParams.get("state")).toBe("st");
    });
});
