import { describe, it, expect } from "vitest";
import { looksBinary, toLf, toCrlf } from "./eol";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("toLf", () => {
    it("converts CRLF to LF", () => {
        expect(dec(toLf(enc("a\r\nb\r\nc")))).toBe("a\nb\nc");
    });
    it("leaves LF-only content unchanged", () => {
        expect(dec(toLf(enc("a\nb\nc")))).toBe("a\nb\nc");
    });
    it("leaves a lone CR (old-Mac) alone", () => {
        expect(dec(toLf(enc("a\rb")))).toBe("a\rb");
    });
});

describe("toCrlf", () => {
    it("converts LF to CRLF", () => {
        expect(dec(toCrlf(enc("a\nb\nc")))).toBe("a\r\nb\r\nc");
    });
    it("does not double existing CRLF", () => {
        expect(dec(toCrlf(enc("a\r\nb")))).toBe("a\r\nb");
    });
});

describe("round-trip equivalence", () => {
    it("CRLF and LF forms normalize to the same LF bytes", () => {
        const crlf = enc("# Title\r\n\r\nbody\r\n");
        const lf = enc("# Title\n\nbody\n");
        expect(dec(toLf(crlf))).toBe(dec(toLf(lf)));
    });
});

describe("looksBinary", () => {
    it("flags content with a NUL byte", () => {
        expect(looksBinary(new Uint8Array([0x89, 0x50, 0x00, 0x4e]))).toBe(true);
    });
    it("treats plain text as non-binary", () => {
        expect(looksBinary(enc("# hello\r\nworld\n"))).toBe(false);
    });
});
