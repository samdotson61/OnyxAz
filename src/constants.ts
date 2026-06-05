import type { OnyxAzSettings } from "./types";

export const DEFAULT_SETTINGS: OnyxAzSettings = {
    organizationUrl: "",
    pat: "",
    project: "",
    repository: "",
    branch: "main",
    autoSyncInterval: 0,
    autoPullInterval: 0,
    autoSyncOnSave: false,
    autoSyncOnSaveDebounceMs: 10000,
    commitMessage: "vault sync: {{date}}",
    commitDateFormat: "YYYY-MM-DD HH:mm:ss",
    pullOnStartup: false,
    showStatusBar: true,
    showChangedFilesCount: false,
    notifyOnSuccess: true,
};

export const STATE_FILE_PATH = ".onyxaz/state.json";
export const IGNORE_FILE_PATH = ".onyxazignore";
export const DEFAULT_IGNORED = [".onyxaz/", ".obsidian/workspace.json", ".obsidian/workspace-mobile.json"];
export const ADO_API_VERSION = "7.1";
export const EMPTY_REPO_SHA = "0000000000000000000000000000000000000000";
