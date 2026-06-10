import type { OnyxAzSettings } from "./types";

// ── Baked-in defaults (injected at build time, never hardcoded here) ─────────
// To deploy internally with one-click SSO, create an `onyxaz.local.json` (see
// onyxaz.local.example.json) with your Azure app's clientId/tenantId. esbuild
// injects them at build time so the IDs live only in your local main.js — the
// tracked source stays generic and reveals nothing about your organization.
// With no local config these are "" / "organizations" (users enter their own
// Client ID during setup, or use a Personal Access Token instead).
export const ONYX_AZ_DEFAULT_CLIENT_ID = process.env.ONYXAZ_DEFAULT_CLIENT_ID || "";
export const ONYX_AZ_DEFAULT_TENANT_ID = process.env.ONYXAZ_DEFAULT_TENANT_ID || "organizations";

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
