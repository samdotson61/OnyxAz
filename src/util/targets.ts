import type { RepoTarget } from "../types";

// Stable, collision-free identity for a repo target. JSON encoding means two
// different (project, repo, branch) triples can never produce the same key, even
// when names contain spaces or punctuation.
export function targetKey(t: RepoTarget): string {
    return JSON.stringify([t.project, t.repo, t.branch]);
}

// Merges `added` into `existing`, de-duplicating by project/repo/branch and
// preserving order (existing first, then new). Keeps the tracked-repo set from
// piling up duplicates when the same repo is selected again.
export function mergeTargets(existing: RepoTarget[], added: RepoTarget[]): RepoTarget[] {
    const seen = new Set(existing.map(targetKey));
    const out = [...existing];
    for (const t of added) {
        const k = targetKey(t);
        if (!seen.has(k)) {
            seen.add(k);
            out.push(t);
        }
    }
    return out;
}
