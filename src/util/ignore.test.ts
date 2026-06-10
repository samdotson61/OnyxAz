import { describe, it, expect } from "vitest";
import { matchesIgnore, parseIgnoreFile } from "./ignore";

describe("matchesIgnore", () => {
    const patterns = [".onyxaz/", "*.pdf", "private/", "scratch.md"];

    it("matches a directory prefix", () => {
        expect(matchesIgnore(".onyxaz/state.json", patterns)).toBe(true);
        expect(matchesIgnore(".onyxaz", patterns)).toBe(true);
        expect(matchesIgnore("private/secret.md", patterns)).toBe(true);
    });

    it("matches an extension glob", () => {
        expect(matchesIgnore("docs/manual.pdf", patterns)).toBe(true);
        expect(matchesIgnore("manual.pdf", patterns)).toBe(true);
    });

    it("matches an exact file", () => {
        expect(matchesIgnore("scratch.md", patterns)).toBe(true);
    });

    it("does not match unrelated paths", () => {
        expect(matchesIgnore("notes/todo.md", patterns)).toBe(false);
        expect(matchesIgnore("publicdir/file.md", patterns)).toBe(false); // not "private/"
        expect(matchesIgnore("scratch.md.bak", patterns)).toBe(false);
    });

    it("ignores comments and blank lines as patterns", () => {
        expect(matchesIgnore("anything.md", ["# comment", "", "   "])).toBe(false);
    });
});

describe("parseIgnoreFile", () => {
    it("strips comments, blanks, and whitespace", () => {
        const out = parseIgnoreFile("# header\n\n  *.pdf  \nprivate/\n# trailing\n");
        expect(out).toEqual(["*.pdf", "private/"]);
    });
});
