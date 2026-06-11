// Compares two dotted version strings (e.g. "0.6.3" vs "0.10.0").
// Returns 1 if a > b, -1 if a < b, 0 if equal. Non-numeric/missing parts count
// as 0, so "0.7" == "0.7.0".
export function compareVersions(a: string, b: string): number {
    const pa = (a ?? "").split(".").map((n) => parseInt(n, 10) || 0);
    const pb = (b ?? "").split(".").map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}
