// Line-ending helpers so a CRLF-vs-LF-only difference between a local file and
// the remote blob isn't treated as a real change (a common false "conflict" when
// editing the same doc on Windows and in ADO). Operates on raw bytes — safe for
// UTF-8/ASCII because CR (0x0D) and LF (0x0A) never appear as continuation bytes
// in a multibyte UTF-8 sequence (those are all >= 0x80).

const CR = 0x0d;
const LF = 0x0a;

// Heuristic: a NUL byte in the first chunk means binary — never normalize those
// (images, archives). Avoids corrupting a binary that happens to contain 0x0D0A.
export function looksBinary(bytes: Uint8Array, scan = 8000): boolean {
    const n = Math.min(bytes.length, scan);
    for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
    return false;
}

// CRLF -> LF (drops the CR of each CRLF pair).
export function toLf(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes.length);
    let j = 0;
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === CR && bytes[i + 1] === LF) continue;
        out[j++] = bytes[i];
    }
    return out.slice(0, j);
}

// LF -> CRLF. Normalizes to LF first so existing CRLFs aren't doubled.
export function toCrlf(bytes: Uint8Array): Uint8Array {
    const lf = toLf(bytes);
    let lfCount = 0;
    for (let i = 0; i < lf.length; i++) if (lf[i] === LF) lfCount++;
    const out = new Uint8Array(lf.length + lfCount);
    let j = 0;
    for (let i = 0; i < lf.length; i++) {
        if (lf[i] === LF) out[j++] = CR;
        out[j++] = lf[i];
    }
    return out;
}
