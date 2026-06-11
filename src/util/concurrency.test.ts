import { describe, it, expect } from "vitest";
import { mapLimit } from "./concurrency";

describe("mapLimit", () => {
    it("processes every item", async () => {
        const seen: number[] = [];
        await mapLimit([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
        expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });

    it("never exceeds the concurrency limit", async () => {
        let active = 0;
        let peak = 0;
        await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 1));
            active--;
        });
        expect(peak).toBeLessThanOrEqual(4);
    });

    it("is a no-op for an empty list", async () => {
        let calls = 0;
        await mapLimit([], 4, async () => { calls++; });
        expect(calls).toBe(0);
    });

    it("rejects if a worker throws", async () => {
        await expect(
            mapLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("boom"); })
        ).rejects.toThrow("boom");
    });
});
