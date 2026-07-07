// Encrypts secrets at rest using the OS keychain via Electron's safeStorage
// (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Without this,
// tokens sit in plaintext inside .obsidian/plugins/onyxaz/data.json — which
// syncs wherever the vault syncs (OneDrive, backups, other devices).
//
// Encrypted values carry an "enc:v1:" prefix so plaintext values from older
// versions decrypt transparently (returned as-is) and get encrypted on the
// next save. If safeStorage isn't reachable (unexpected Electron changes) we
// degrade to plaintext rather than locking users out of their session.

const PREFIX = "enc:v1:";

export interface SecretCipher {
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
    isEncryptionAvailable(): boolean;
}

// Resolves Electron's safeStorage in Obsidian's renderer. Main-process modules
// are exposed through @electron/remote (which Obsidian ships); older builds had
// them on electron.remote. Returns null when neither works.
export function resolveSafeStorage(): SecretCipher | null {
    const candidates: Array<() => SecretCipher | undefined> = [
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        () => (require("@electron/remote") as { safeStorage?: SecretCipher }).safeStorage,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        () => (require("electron") as { remote?: { safeStorage?: SecretCipher } }).remote?.safeStorage,
    ];
    for (const get of candidates) {
        try {
            const ss = get();
            if (ss && ss.isEncryptionAvailable()) return ss;
        } catch { /* try next */ }
    }
    return null;
}

export function encryptSecret(value: string, cipher: SecretCipher | null): string {
    if (!value || value.startsWith(PREFIX)) return value; // empty or already encrypted
    if (!cipher) return value; // graceful plaintext fallback
    try {
        return PREFIX + cipher.encryptString(value).toString("base64");
    } catch {
        return value;
    }
}

export function decryptSecret(value: string, cipher: SecretCipher | null): string {
    if (!value || !value.startsWith(PREFIX)) return value; // plaintext (pre-encryption) or empty
    if (!cipher) return ""; // encrypted but no cipher (e.g. different machine) — treat as signed out
    try {
        return cipher.decryptString(Buffer.from(value.slice(PREFIX.length), "base64"));
    } catch {
        return ""; // ciphertext from another machine's keychain — force re-sign-in
    }
}

export function isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
}
