// Extracts plain text from a .docx so the setup wizard can import a setup
// document the user picks from disk (the Hy-Tek guide is a .docx, and the
// machine-readable setup details are embedded in it). A .docx is a ZIP whose
// word/document.xml holds the text; we read that entry and strip the markup.
// Uses the runtime's DecompressionStream (present in Obsidian's Electron) so no
// zip library is needed. All failures resolve to "" so callers can fall back to
// pasting.

// Converts the raw word/document.xml into readable text. Pure + tested:
// paragraph and break tags become newlines, tabs are preserved, every other tag
// is stripped, and the handful of XML entities Word emits are decoded.
export function docXmlToText(xml: string): string {
    const withBreaks = xml
        .replace(/<\/w:p>/gi, "\n")
        .replace(/<w:br\s*\/?>/gi, "\n")
        .replace(/<w:tab\s*\/?>/gi, "\t");
    const stripped = withBreaks.replace(/<[^>]+>/g, "");
    return stripped
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
    try {
        const xml = await readZipEntryText(buffer, "word/document.xml");
        return xml ? docXmlToText(xml) : "";
    } catch {
        return "";
    }
}

// ── Minimal ZIP reader (central directory) ─────────────────────────────────
// Reads one entry's bytes by name. Uses the central directory (which always
// carries sizes) rather than local headers (which may omit them).
async function readZipEntryText(buffer: ArrayBuffer, name: string): Promise<string | null> {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // Find the End Of Central Directory record by scanning backwards for its
    // signature (0x06054b50), allowing for a trailing comment.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65536; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;

    const cdOffset = view.getUint32(eocd + 16, true);
    const cdCount = view.getUint16(eocd + 10, true);

    let p = cdOffset;
    for (let n = 0; n < cdCount; n++) {
        if (view.getUint32(p, true) !== 0x02014b50) break; // central dir header
        const method = view.getUint16(p + 10, true);
        const compSize = view.getUint32(p + 20, true);
        const fnLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const localOff = view.getUint32(p + 42, true);
        const fileName = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + fnLen));

        if (fileName === name) {
            // Jump to the local header to find where the data actually starts.
            const lhFnLen = view.getUint16(localOff + 26, true);
            const lhExtraLen = view.getUint16(localOff + 28, true);
            const dataStart = localOff + 30 + lhFnLen + lhExtraLen;
            const comp = bytes.subarray(dataStart, dataStart + compSize);
            const raw = method === 0 ? comp : await inflateRaw(comp);
            return new TextDecoder().decode(raw);
        }
        p += 46 + fnLen + extraLen + commentLen;
    }
    return null;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const DS = (globalThis as unknown as { DecompressionStream?: new (f: string) => unknown }).DecompressionStream;
    if (!DS) throw new Error("DecompressionStream unavailable");
    const stream = new Blob([data]).stream().pipeThrough(new DS("deflate-raw") as ReadableWritablePair);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
}
