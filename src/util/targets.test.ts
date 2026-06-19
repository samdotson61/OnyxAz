import { describe, it, expect } from "vitest";
import { targetKey, mergeTargets } from "./targets";

const t = (project: string, repo: string, branch: string) => ({ project, repo, branch });

describe("targetKey", () => {
    it("is unique per project/repo/branch", () => {
        expect(targetKey(t("p", "r", "main"))).toBe(targetKey(t("p", "r", "main")));
        expect(targetKey(t("p", "r", "main"))).not.toBe(targetKey(t("p", "r", "dev")));
    });

    it("does not collide when names contain spaces", () => {
        // "a b"/"c" vs "a"/"b c" would collide with a naive space join.
        expect(targetKey(t("a b", "c", "main"))).not.toBe(targetKey(t("a", "b c", "main")));
    });
});

describe("mergeTargets", () => {
    it("appends new targets and skips duplicates", () => {
        const existing = [t("p", "r1", "main")];
        const added = [t("p", "r1", "main"), t("p", "r2", "main")];
        const merged = mergeTargets(existing, added);
        expect(merged).toHaveLength(2);
        expect(merged.map((x) => x.repo)).toEqual(["r1", "r2"]);
    });

    it("preserves existing order and dedupes within the added list", () => {
        const merged = mergeTargets(
            [t("p", "a", "main")],
            [t("p", "b", "main"), t("p", "b", "main"), t("p", "a", "main")]
        );
        expect(merged.map((x) => x.repo)).toEqual(["a", "b"]);
    });

    it("treats different branches of the same repo as distinct", () => {
        const merged = mergeTargets([], [t("p", "r", "main"), t("p", "r", "dev")]);
        expect(merged).toHaveLength(2);
    });
});
