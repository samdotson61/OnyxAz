// Runs `worker` over `items` with at most `limit` in flight at once. Resolves
// when all complete; rejects if any worker throws. Used to download files in
// parallel (instead of one-at-a-time), which dramatically speeds up large pulls.
export async function mapLimit<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>
): Promise<void> {
    if (items.length === 0) return;
    let next = 0;
    const count = Math.max(1, Math.min(limit, items.length));
    const runners = Array.from({ length: count }, async () => {
        while (next < items.length) {
            const idx = next++;
            await worker(items[idx], idx);
        }
    });
    await Promise.all(runners);
}
