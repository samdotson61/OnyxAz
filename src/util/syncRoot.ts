// Computes the vault-relative folder prefix where a repo's files are synced.
// An explicit localSyncPath override wins; otherwise the default is
//   <org>_ADO/<project>/<repo>/<branch>/
// so files are namespaced by organization, and different repos / branches never
// share a folder (the branch is visible right in the vault tree). The org name
// is derived from the organization URL; if it can't be determined the prefix
// falls back to plain "ADO". Returns "" for vault-root mode, and always ends
// with "/" when non-empty.

export interface SyncRootParts {
    localSyncPath?: string;
    organizationUrl?: string;
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

// Extracts the organization slug from an Azure DevOps URL:
//   https://dev.azure.com/myorg      -> "myorg"
//   https://myorg.visualstudio.com   -> "myorg"
// Falls back to the first path segment, then the hostname.
export function orgSlug(organizationUrl: string | undefined): string {
    const raw = (organizationUrl ?? "").trim();
    if (!raw) return "";
    try {
        const u = new URL(raw);
        const firstSegment = u.pathname.split("/").filter(Boolean)[0];
        if (/(^|\.)dev\.azure\.com$/i.test(u.hostname) && firstSegment) return firstSegment;
        const vs = u.hostname.match(/^([\w-]+)\.visualstudio\.com$/i);
        if (vs) return vs[1];
        return firstSegment || u.hostname;
    } catch {
        return "";
    }
}

export function buildSyncRoot(parts: SyncRootParts): string {
    const explicit = (parts.localSyncPath ?? "").trim().replace(/^\/+|\/+$/g, "");
    if (explicit) return explicit + "/";

    const project = sanitizeSegment(parts.project);
    if (!project) return "";

    const org = sanitizeSegment(orgSlug(parts.organizationUrl));
    const root = org ? `${org}_ADO` : "ADO";

    const segments = [root, project];
    const repo = sanitizeSegment(parts.repository);
    const branch = sanitizeSegment(parts.branch);
    if (repo) segments.push(repo);
    if (branch) segments.push(branch);
    return segments.join("/") + "/";
}
