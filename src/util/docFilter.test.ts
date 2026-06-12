import { describe, it, expect } from "vitest";
import { DEFAULT_DOCUMENT_EXTENSIONS, parseExtensions, isDocumentPath } from "./docFilter";

describe("parseExtensions", () => {
    it("splits on commas and whitespace, strips dots, lowercases", () => {
        expect(parseExtensions("md, .PDF  docx")).toEqual(["md", "pdf", "docx"]);
    });

    it("ignores empty entries", () => {
        expect(parseExtensions(" , , md ,")).toEqual(["md"]);
        expect(parseExtensions("")).toEqual([]);
    });
});

describe("isDocumentPath", () => {
    const exts = DEFAULT_DOCUMENT_EXTENSIONS;

    it("accepts known document extensions (case-insensitive)", () => {
        expect(isDocumentPath("notes/readme.md", exts)).toBe(true);
        expect(isDocumentPath("Spec.PDF", exts)).toBe(true);
        expect(isDocumentPath("docs/diagram.canvas", exts)).toBe(true);
        expect(isDocumentPath("assets/photo.JPG", exts)).toBe(true);
    });

    it("rejects code, binaries, and build artifacts", () => {
        expect(isDocumentPath("Builds/app.dll", exts)).toBe(false);
        expect(isDocumentPath("Builds/release.zip", exts)).toBe(false);
        expect(isDocumentPath("src/main.cs", exts)).toBe(false);
        expect(isDocumentPath("bin/tool.exe", exts)).toBe(false);
    });

    it("treats extensionless files and dotfiles as non-documents", () => {
        expect(isDocumentPath("Makefile", exts)).toBe(false);
        expect(isDocumentPath("path/.gitignore", exts)).toBe(false);
        expect(isDocumentPath("LICENSE", exts)).toBe(false);
    });

    it("uses only the filename, not folder names, for the extension", () => {
        expect(isDocumentPath("my.pdf.folder/app.dll", exts)).toBe(false);
        expect(isDocumentPath("v1.2/report.docx", exts)).toBe(true);
    });
});
