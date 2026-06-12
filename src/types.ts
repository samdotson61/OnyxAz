export type AuthMethod = "pat" | "entra";

// A single repository/branch the org mirror syncs two-way (its own commit state).
export interface RepoTarget {
    project: string;
    repo: string;
    branch: string;
}

export interface OnyxAzSettings {
    // Onboarding
    hasCompletedOnboarding: boolean;
    // Connection
    organizationUrl: string;
    project: string;
    repository: string;
    branch: string;
    localSyncPath: string;  // subfolder in vault where this repo's files live (blank = vault root)
    orgMirror: boolean;     // scaffold all org projects as folders; pull each on click (pull-only)
    autoUpdate: boolean;    // check GitHub for a newer plugin build on startup and update
    // Auth
    authMethod: AuthMethod;
    pat: string;
    entraClientId: string;
    entraTenantId: string;
    entraAccessToken: string;
    entraRefreshToken: string;
    entraTokenExpiry: number;
    // Automation
    autoSyncInterval: number;
    autoPullInterval: number;
    autoSyncOnSave: boolean;
    autoSyncOnSaveDebounceMs: number;
    // Commit
    commitMessage: string;
    commitDateFormat: string;
    // Misc
    pullOnStartup: boolean;
    showStatusBar: boolean;
    showChangedFilesCount: boolean;
    notifyOnSuccess: boolean;
    maxAttachmentSizeMB: number;
    // Per-file timeout (seconds) for downloading a single file. Large/slow files
    // need more than the 60s used for control requests; raise this if big files
    // keep failing to download.
    largeFileTimeoutSec: number;
    // When on, only document files (see documentExtensions) are synced — code,
    // binaries, and build artifacts in a repo are skipped entirely.
    documentsOnly: boolean;
    documentExtensions: string; // comma/space-separated extension allowlist
}

export interface FileStatus {
    path: string;
    status: "M" | "A" | "D";
}

export interface SyncStatus {
    changed: FileStatus[];
    conflicted: string[];
    ahead: number;
    behind: number;
}

export interface AdoFile {
    path: string;
    objectId: string;
    isFolder: boolean;
    url?: string;
}

export interface SyncState {
    lastSyncedCommitId: string;
    lastSyncTime: number;
    remoteObjectIds: Record<string, string>;
    syncRoot?: string;  // recorded so a path change triggers automatic state invalidation
}

export interface LogEntry {
    hash: string;
    message: string;
    author: string;
    authorEmail: string;
    date: string;
}

export enum CurrentAdoAction {
    idle,
    status,
    pull,
    commit,
    push,
    sync,
}

declare module "obsidian" {
    interface Workspace {
        on(name: "onyxaz:refresh", callback: () => void): EventRef;
        on(name: "onyxaz:status-changed", callback: () => void): EventRef;
        trigger(name: "onyxaz:refresh"): void;
        trigger(name: "onyxaz:status-changed"): void;
    }
}
