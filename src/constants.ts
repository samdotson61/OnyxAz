import type { OnyxAzSettings } from "./types";

// ── Org admin fills these in before distributing the plugin ──────────────────
// Register an Azure app (multi-tenant, public client, device code flow enabled,
// Azure DevOps → user_impersonation delegated permission) and paste the IDs here.
// When set, end-users never see a Client ID field — they just click "Sign in".
export const ONYX_AZ_DEFAULT_CLIENT_ID = "11111111-1111-1111-1111-111111111111";
export const ONYX_AZ_DEFAULT_TENANT_ID = "22222222-2222-2222-2222-222222222222";

export const DEFAULT_SETTINGS: OnyxAzSettings = {
    hasCompletedOnboarding: false,
    organizationUrl: "",
    project: "",
    repository: "",
    branch: "main",
    localSyncPath: "",
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
};

export const STATE_FILE_PATH = ".onyxaz/state.json";
export const IGNORE_FILE_PATH = ".onyxazignore";
export const DEFAULT_IGNORED = [
    ".onyxaz/",
    ".obsidian/workspace.json",
    ".obsidian/workspace-mobile.json",
];
export const ADO_API_VERSION = "7.1";
export const EMPTY_REPO_SHA = "0000000000000000000000000000000000000000";

// Microsoft Entra / Azure AD
export const ENTRA_ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
export const ENTRA_SCOPE = `${ENTRA_ADO_RESOURCE}/.default offline_access`;
export const ENTRA_DEVICE_CODE_URL = (tenant: string) =>
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`;
export const ENTRA_TOKEN_URL = (tenant: string) =>
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
