// Decides whether a file is a "document" worth syncing into a notes vault.
// A documentation repo also holds code, binaries, and build artifacts (DLLs,
// zips, images of compiled output) that bloat the vault and waste bandwidth.
// When "documents only" is on, OnyxAz syncs just the extensions below — anything
// else is never counted, downloaded, or pushed.

// Sensible default set: notes/markup, office docs, PDFs, and the image/diagram
// types that markdown notes commonly embed. Deliberately excludes source code,
// archives, executables, and other binaries.
export const DEFAULT_DOCUMENT_EXTENSIONS = [
    "md", "markdown", "mdx", "txt", "rtf",
    "pdf", "doc", "docx", "odt",
    "ppt", "pptx", "xls", "xlsx", "csv",
    "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp",
    "canvas", "excalidraw",
];

// Parses a user-entered extension list ("md, pdf, .docx") into a clean, lower-
// case set without leading dots. Commas and/or whitespace separate entries.
export function parseExtensions(raw: string): string[] {
    return raw
        .split(/[\s,]+/)
        .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
        .filter(Boolean);
}

// True if the path's extension is in the allowed set. Files with no extension
// are treated as non-documents (they're typically binaries or build output).
export function isDocumentPath(path: string, extensions: string[]): boolean {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return false; // no extension, or dotfile like ".gitignore"
    const ext = name.slice(dot + 1).toLowerCase();
    return extensions.includes(ext);
}
