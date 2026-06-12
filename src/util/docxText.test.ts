import { describe, it, expect } from "vitest";
import { docXmlToText } from "./docxText";

describe("docXmlToText", () => {
    it("turns paragraphs into newlines and strips runs", () => {
        const xml =
            "<w:p><w:r><w:t>Organization URL:  https://dev.azure.com/hy-tek</w:t></w:r></w:p>" +
            "<w:p><w:r><w:t>Application (client) ID:  50262295-c522-4708-a6ea-d5863249ee10</w:t></w:r></w:p>";
        const text = docXmlToText(xml);
        expect(text).toContain("https://dev.azure.com/hy-tek");
        expect(text).toContain("50262295-c522-4708-a6ea-d5863249ee10");
        expect(text.split("\n").length).toBeGreaterThanOrEqual(2);
        expect(text).not.toContain("<w:");
    });

    it("preserves tabs and decodes entities", () => {
        const xml = "<w:p><w:r><w:t>a</w:t></w:r><w:tab/><w:r><w:t>b &amp; c &lt;x&gt;</w:t></w:r></w:p>";
        const text = docXmlToText(xml);
        expect(text).toContain("a\tb & c <x>");
    });

    it("handles self-closing breaks", () => {
        expect(docXmlToText("<w:p><w:t>one</w:t><w:br/><w:t>two</w:t></w:p>")).toContain("one\ntwo");
    });
});
