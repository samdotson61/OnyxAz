import { describe, it, expect } from "vitest";
import { AdaptiveLimit, parseRetryAfter, backoffDelayMs } from "./backoff";

describe("AdaptiveLimit", () => {
    it("starts at max and halves on throttle down to the floor", () => {
        const l = new AdaptiveLimit(16, 2);
        expect(l.current).toBe(16);
        l.onThrottle(); expect(l.current).toBe(8);
        l.onThrottle(); expect(l.current).toBe(4);
        l.onThrottle(); expect(l.current).toBe(2);
        l.onThrottle(); expect(l.current).toBe(2); // never below floor
    });

    it("recovers by +1 only after the success streak, capped at max", () => {
        const l = new AdaptiveLimit(16, 2, 3); // recover after 3 clean responses
        l.onThrottle(); l.onThrottle(); // 16 -> 8 -> 4
        expect(l.current).toBe(4);
        l.onSuccess(); l.onSuccess(); expect(l.current).toBe(4); // streak not reached
        l.onSuccess(); expect(l.current).toBe(5); // +1 after 3
        for (let i = 0; i < 3; i++) l.onSuccess(); expect(l.current).toBe(6);
    });

    it("does not exceed max", () => {
        const l = new AdaptiveLimit(3, 2, 1);
        for (let i = 0; i < 20; i++) l.onSuccess();
        expect(l.current).toBe(3);
    });

    it("a throttle resets the success streak", () => {
        const l = new AdaptiveLimit(16, 2, 3);
        l.onThrottle(); // 8
        l.onSuccess(); l.onSuccess(); // streak 2
        l.onThrottle(); // 4, streak reset
        l.onSuccess(); l.onSuccess(); expect(l.current).toBe(4); // would have bumped if streak carried
        l.onSuccess(); expect(l.current).toBe(5);
    });
});

describe("parseRetryAfter", () => {
    const now = 1_000_000;
    it("parses delta-seconds", () => {
        expect(parseRetryAfter("5", now)).toBe(5000);
        expect(parseRetryAfter("  30 ", now)).toBe(30000);
    });
    it("parses HTTP-date relative to now", () => {
        const future = new Date(now + 10_000).toUTCString();
        expect(parseRetryAfter(future, now)).toBe(Math.max(0, Date.parse(future) - now));
    });
    it("never returns negative for past dates", () => {
        const past = new Date(now - 10_000).toUTCString();
        expect(parseRetryAfter(past, now)).toBe(0);
    });
    it("returns null for missing or garbage values", () => {
        expect(parseRetryAfter(null, now)).toBeNull();
        expect(parseRetryAfter(undefined, now)).toBeNull();
        expect(parseRetryAfter("soon", now)).toBeNull();
    });
});

describe("backoffDelayMs", () => {
    it("grows exponentially and is capped", () => {
        expect(backoffDelayMs(0, 1000, 30000, 0)).toBe(1000);
        expect(backoffDelayMs(1, 1000, 30000, 0)).toBe(2000);
        expect(backoffDelayMs(4, 1000, 30000, 0)).toBe(16000);
        expect(backoffDelayMs(10, 1000, 30000, 0)).toBe(30000); // capped
    });
    it("adds jitter within bounds", () => {
        const d = backoffDelayMs(0, 1000, 30000, 250);
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThan(1250);
    });
});
