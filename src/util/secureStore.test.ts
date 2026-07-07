import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted, type SecretCipher } from "./secureStore";

// Reversible fake cipher (base64 of reversed input) — behavior contract only.
const fake: SecretCipher = {
    encryptString: (s) => Buffer.from([...s].reverse().join(""), "utf8"),
    decryptString: (b) => [...b.toString("utf8")].reverse().join(""),
    isEncryptionAvailable: () => true,
};

describe("encryptSecret / decryptSecret", () => {
    it("round-trips a secret through the cipher", () => {
        const enc = encryptSecret("my-refresh-token", fake);
        expect(isEncrypted(enc)).toBe(true);
        expect(enc).not.toContain("my-refresh-token");
        expect(decryptSecret(enc, fake)).toBe("my-refresh-token");
    });

    it("passes plaintext through decrypt unchanged (migration from older versions)", () => {
        expect(decryptSecret("legacy-plaintext-token", fake)).toBe("legacy-plaintext-token");
    });

    it("does not double-encrypt an already-encrypted value", () => {
        const once = encryptSecret("tok", fake);
        expect(encryptSecret(once, fake)).toBe(once);
    });

    it("leaves empty values alone", () => {
        expect(encryptSecret("", fake)).toBe("");
        expect(decryptSecret("", fake)).toBe("");
    });

    it("falls back to plaintext when no cipher is available", () => {
        expect(encryptSecret("tok", null)).toBe("tok");
    });

    it("treats undecryptable ciphertext as signed-out (empty), not garbage", () => {
        const enc = encryptSecret("tok", fake);
        // No cipher on this machine → can't decrypt → empty
        expect(decryptSecret(enc, null)).toBe("");
        // Cipher that throws (foreign keychain) → empty
        const throwing: SecretCipher = {
            encryptString: () => { throw new Error("nope"); },
            decryptString: () => { throw new Error("nope"); },
            isEncryptionAvailable: () => true,
        };
        expect(decryptSecret(enc, throwing)).toBe("");
    });
});
