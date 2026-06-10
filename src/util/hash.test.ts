import { describe, it, expect } from "vitest";
import { gitBlobSha1 } from "./hash";

describe("gitBlobSha1", () => {
    it("matches Git's well-known empty-blob hash", async () => {
        // `git hash-object` of an empty file is always this SHA-1.
        expect(await gitBlobSha1(new ArrayBuffer(0))).toBe(
            "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
        );
    });

    it("matches Git's hash for known content", async () => {
        // echo -n "hello" | git hash-object --stdin
        const buf = new TextEncoder().encode("hello").buffer;
        expect(await gitBlobSha1(buf)).toBe("b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
    });

    it("is deterministic and returns a 40-char hex string", async () => {
        const buf = new TextEncoder().encode("some content").buffer;
        const a = await gitBlobSha1(buf);
        const b = await gitBlobSha1(new TextEncoder().encode("some content").buffer);
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{40}$/);
    });
});
