// Adaptive throttling for ADO requests. When Azure DevOps rate-limits (HTTP 429,
// or 503), we shrink how many requests run at once and retry after a delay, then
// recover speed once it stops pushing back. The ceiling follows AIMD (additive
// increase / multiplicative decrease), the same scheme TCP uses for congestion.

export class AdaptiveLimit {
    private value: number;
    private successStreak = 0;

    constructor(
        private readonly max: number,
        private readonly min = 2,
        // Clean responses required before the ceiling creeps up by one.
        private readonly recoverAfter = 20
    ) {
        this.value = max;
    }

    get current(): number {
        return this.value;
    }

    // Throttled: halve the ceiling (down to the floor) and reset recovery.
    onThrottle(): void {
        this.value = Math.max(this.min, Math.floor(this.value / 2));
        this.successStreak = 0;
    }

    // Clean response: after a streak, raise the ceiling by one (up to the cap).
    onSuccess(): void {
        if (this.value >= this.max) return;
        if (++this.successStreak >= this.recoverAfter) {
            this.value = Math.min(this.max, this.value + 1);
            this.successStreak = 0;
        }
    }
}

// Parses a Retry-After header (HTTP-date or delta-seconds) into milliseconds to
// wait from `nowMs`. Returns null when absent/unparseable so the caller can fall
// back to its own backoff.
export function parseRetryAfter(headerValue: string | null | undefined, nowMs: number): number | null {
    if (!headerValue) return null;
    const v = headerValue.trim();
    if (/^\d+$/.test(v)) return parseInt(v, 10) * 1000; // delta-seconds
    const when = Date.parse(v); // HTTP-date
    if (!isNaN(when)) return Math.max(0, when - nowMs);
    return null;
}

// Exponential backoff with jitter, capped. attempt is 0-based.
export function backoffDelayMs(attempt: number, base = 1000, cap = 30000, jitter = 250): number {
    const expo = Math.min(cap, base * 2 ** attempt);
    return expo + Math.floor(Math.random() * jitter);
}
