// Computes the Git blob SHA-1 of a file's contents. Azure DevOps reports each
// file's objectId as exactly this value, so comparing the local content hash to
// the last-synced remote objectId detects real modifications independently of
// mtime — used as a fallback when a file's mtime is unavailable.
//
// Uses Web Crypto (crypto.subtle), which is available in both the Electron
// renderer and Obsidian mobile.

export async function gitBlobSha1(buffer: ArrayBuffer): Promise<string> {
    const header = new TextEncoder().encode(`blob ${buffer.byteLength}\0`);
    const combined = new Uint8Array(header.length + buffer.byteLength);
    combined.set(header, 0);
    combined.set(new Uint8Array(buffer), header.length);
    const digest = await crypto.subtle.digest("SHA-1", combined);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
