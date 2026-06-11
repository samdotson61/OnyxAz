// Computes the vault-relative folder prefix where a repo's files are synced.
// An explicit localSyncPath override wins; otherwise the default is
//   ADO/<project>/<repo>/<branch>/
// so different repos and different branches never share a folder (and the
// branch is visible right in the vault tree). Returns "" for vault-root mode,
// and always ends with "/" when non-empty.

export interface SyncRootParts {
    localSyncPath?: string;
    project?: string;
    repository?: string;
    branch?: string;
}

// Make a single path segment safe: drop characters illegal in file paths and
// collapse any embedded separators (e.g. a "feature/login" branch) to a dash so
// it stays one folder.
function sanitizeSegment(value: string | undefined): string {
    return (value ?? "")
        .trim()
        .replace(/[\\/<>:"|?*]+/g, "-")
        .replace(/^\.+|\.+$/g, "")
        .trim();
}

export function buildSyncRoot(parts: SyncRootParts): string {
    const explicit = (parts.localSyncPath ?? "").trim().replace(/^\/+|\/+$/g, "");
    if (explicit) return explicit + "/";

    const project = sanitizeSegment(parts.project);
    if (!project) return "";

    const segments = ["ADO", project];
    const repo = sanitizeSegment(parts.repository);
    const branch = sanitizeSegment(parts.branch);
    if (repo) segments.push(repo);
    if (branch) segments.push(branch);
    return segments.join("/") + "/";
}
