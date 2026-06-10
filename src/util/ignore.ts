// Decides whether a vault-relative path should be excluded from sync. Supports
// the always-ignored defaults plus user patterns from a .onyxazignore file.
//
// Supported pattern syntax (a practical subset of .gitignore):
//   - "# comment" and blank lines  → ignored
//   - "folder/"                     → the folder and everything under it
//   - "*.ext" / "*suffix"           → any path ending with that suffix
//   - "exact/path.md"               → that exact file, or anything under it if a dir

export function matchesIgnore(path: string, patterns: string[]): boolean {
    return patterns.some((raw) => {
        const p = raw.trim();
        if (!p || p.startsWith("#")) return false;
        if (p.endsWith("/")) return path === p.slice(0, -1) || path.startsWith(p);
        if (p.startsWith("*")) return path.endsWith(p.slice(1));
        return path === p || path.startsWith(p + "/");
    });
}

// Parses raw .onyxazignore file contents into a clean pattern list.
export function parseIgnoreFile(contents: string): string[] {
    return contents
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
}
