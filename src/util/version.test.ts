import { describe, it, expect } from "vitest";
import { compareVersions } from "./version";

describe("compareVersions", () => {
    it("orders by each numeric component", () => {
        expect(compareVersions("0.7.0", "0.6.3")).toBe(1);
        expect(compareVersions("0.6.3", "0.7.0")).toBe(-1);
        expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    });

    it("treats numeric parts, not string length (0.10 > 0.9)", () => {
        expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    });

    it("treats missing trailing parts as 0", () => {
        expect(compareVersions("0.7", "0.7.0")).toBe(0);
        expect(compareVersions("0.7.1", "0.7")).toBe(1);
    });

    it("returns 0 for equal versions", () => {
        expect(compareVersions("0.6.3", "0.6.3")).toBe(0);
    });
});
