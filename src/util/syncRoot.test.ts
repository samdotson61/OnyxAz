import { describe, it, expect } from "vitest";
import { buildSyncRoot, orgSlug } from "./syncRoot";

describe("buildSyncRoot", () => {
    it("falls back to ADO/<project>/<repo>/<branch>/ with no org URL", () => {
        expect(buildSyncRoot({ project: "Proj", repository: "Repo", branch: "main" }))
            .toBe("ADO/Proj/Repo/main/");
    });

    it("prefixes with <org>_ADO when an org URL is given", () => {
        expect(buildSyncRoot({
            organizationUrl: "https://dev.azure.com/myorg",
            project: "Proj", repository: "Repo", branch: "main",
        })).toBe("myorg_ADO/Proj/Repo/main/");
    });

    it("derives the org from a visualstudio.com URL", () => {
        expect(buildSyncRoot({
            organizationUrl: "https://contoso.visualstudio.com",
            project: "P", repository: "R", branch: "dev",
        })).toBe("contoso_ADO/P/R/dev/");
    });

    it("separates two branches of the same repo", () => {
        const a = buildSyncRoot({ project: "P", repository: "R", branch: "main" });
        const b = buildSyncRoot({ project: "P", repository: "R", branch: "dev" });
        expect(a).not.toBe(b);
        expect(a).toBe("ADO/P/R/main/");
        expect(b).toBe("ADO/P/R/dev/");
    });

    it("honors an explicit localSyncPath override (trimming slashes)", () => {
        expect(buildSyncRoot({ localSyncPath: "/Notes/ADO/", project: "P", repository: "R", branch: "main" }))
            .toBe("Notes/ADO/");
    });

    it("returns '' (vault root) when there is no project", () => {
        expect(buildSyncRoot({})).toBe("");
        expect(buildSyncRoot({ branch: "main" })).toBe("");
    });

    it("omits missing repo/branch segments", () => {
        expect(buildSyncRoot({ project: "P" })).toBe("ADO/P/");
        expect(buildSyncRoot({ project: "P", repository: "R" })).toBe("ADO/P/R/");
    });

    it("collapses path separators in a branch name to keep one folder", () => {
        expect(buildSyncRoot({ project: "P", repository: "R", branch: "feature/login" }))
            .toBe("ADO/P/R/feature-login/");
    });

    it("strips characters illegal in file paths", () => {
        expect(buildSyncRoot({ project: "My:Proj", repository: 'R"epo', branch: "main" }))
            .toBe("ADO/My-Proj/R-epo/main/");
    });
});

describe("orgSlug", () => {
    it("reads dev.azure.com/<org>", () => {
        expect(orgSlug("https://dev.azure.com/myorg")).toBe("myorg");
    });
    it("reads <org>.visualstudio.com", () => {
        expect(orgSlug("https://contoso.visualstudio.com/")).toBe("contoso");
    });
    it("returns '' for empty/invalid input", () => {
        expect(orgSlug("")).toBe("");
        expect(orgSlug("not a url")).toBe("");
    });
});
