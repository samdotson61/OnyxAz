export interface OnyxAzSettings {
    organizationUrl: string;
    pat: string;
    project: string;
    repository: string;
    branch: string;
    autoSyncInterval: number;
    autoPullInterval: number;
    autoSyncOnSave: boolean;
    autoSyncOnSaveDebounceMs: number;
    commitMessage: string;
    commitDateFormat: string;
    pullOnStartup: boolean;
    showStatusBar: boolean;
    showChangedFilesCount: boolean;
    notifyOnSuccess: boolean;
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
