import type { OnyxAzSettings } from "./types";

// Client ID is entered (or pasted from the admin's setup document) during the
// SSO setup screen; tenant is auto-detected from the user's email. There is no
// build-time baking — users configure the plugin from a normal install.
export const ONYX_AZ_DEFAULT_CLIENT_ID = "";
export const ONYX_AZ_DEFAULT_TENANT_ID = "organizations"; // accepts any work/school account

export const DEFAULT_SETTINGS: OnyxAzSettings = {
    hasCompletedOnboarding: false,
    organizationUrl: "",
    project: "",
    repository: "",
    branch: "main",
    localSyncPath: "",
    orgMirror: false,
    autoUpdate: true,
    authMethod: "entra",           // Microsoft SSO is the default
    pat: "",
    entraClientId: "",
    entraTenantId: ONYX_AZ_DEFAULT_TENANT_ID,
    entraAccessToken: "",
    entraRefreshToken: "",
    entraTokenExpiry: 0,
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
    maxAttachmentSizeMB: 5,
    largeFileTimeoutSec: 300,
};

// Raw GitHub base for self-update (must match where releases are published).
export const ONYXAZ_REPO_RAW = "https://raw.githubusercontent.com/samdotson61/OnyxAz/master";

export const STATE_FILE_PATH = ".onyxaz/state.json";
export const IGNORE_FILE_PATH = ".onyxazignore";
export const DEFAULT_IGNORED = [
    ".onyxaz/",
    ".obsidian/workspace.json",
    ".obsidian/workspace-mobile.json",
];
export const ADO_API_VERSION = "7.1";
export const EMPTY_REPO_SHA = "0000000000000000000000000000000000000000";

// How many files download concurrently during a pull. Higher = faster on big
// repos, but watch for ADO 429 throttling if pushed much further.
export const PULL_CONCURRENCY = 16;

// Concurrency for the retry pass over files that failed the wide first pass —
// kept low so each large/slow file gets nearly the full connection to itself.
export const RETRY_CONCURRENCY = 2;

// Microsoft Entra / Azure AD
export const ENTRA_ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
export const ENTRA_SCOPE = `${ENTRA_ADO_RESOURCE}/.default offline_access`;
export const ENTRA_DEVICE_CODE_URL = (tenant: string) =>
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`;
export const ENTRA_TOKEN_URL = (tenant: string) =>
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
