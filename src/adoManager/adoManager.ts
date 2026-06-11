import { requestUrl } from "obsidian";
import type { RequestUrlResponse } from "obsidian";
import type OnyxAz from "../main";
import type { LogEntry, SyncState, SyncStatus } from "../types";
import { buildSyncRoot, orgRootFolder } from "../util/syncRoot";

export abstract class AdoManager {
    protected cachedState: SyncState | null = null;

    constructor(protected readonly plugin: OnyxAz) {}

    abstract testConnection(): Promise<void>;
    abstract getStatus(): Promise<SyncStatus>;
    abstract pull(resolveConflicts?: (conflicts: string[]) => Promise<Set<string>>): Promise<number>;
    abstract forcePull(): Promise<number>;
    abstract push(message: string, changes?: import("../types").FileStatus[]): Promise<void>;
    abstract commitAndSync(message: string): Promise<void>;
    abstract getLog(count: number): Promise<LogEntry[]>;
    abstract listBranches(): Promise<string[]>;
    abstract listBranchesFor(project: string, repo: string): Promise<string[]>;
    abstract switchBranch(branch: string): Promise<void>;
    abstract listProjects(): Promise<string[]>;
    abstract listRepositories(project: string): Promise<string[]>;
    abstract getSyncState(): Promise<SyncState | null>;
    abstract saveSyncState(state: SyncState): Promise<void>;

    // ── Organization mirror (pull-only) ───────────────────────────────────────
    // Create an empty folder per project under the org root; returns a map of
    // folder path -> project name for click-to-hydrate.
    abstract scaffoldOrg(): Promise<Map<string, string>>;
    // Pull every repo (default branch) of a project into its folder. Pull-only.
    abstract hydrateProject(project: string): Promise<{ repos: number; files: number }>;

    getCachedState(): SyncState | null {
        return this.cachedState;
    }

    resetState(): void {
        this.cachedState = null;
    }

    // Vault-relative folder prefix for the connected repo/branch (ends with "/",
    // or "" for vault-root mode). Default: ADO/<project>/<repo>/<branch>/.
    getSyncRoot(): string {
        const s = this.plugin.settings;
        return buildSyncRoot({
            localSyncPath: s.localSyncPath,
            organizationUrl: s.organizationUrl,
            project: s.project,
            repository: s.repository,
            branch: s.branch,
        });
    }

    // Top-level org folder, e.g. "myorg_ADO" (no trailing slash).
    getOrgRoot(): string {
        return orgRootFolder(this.plugin.settings.organizationUrl);
    }

    protected get baseUrl(): string {
        const s = this.plugin.settings;
        const org = s.organizationUrl.replace(/\/$/, "");
        return `${org}/${encodeURIComponent(s.project)}/_apis/git/repositories/${encodeURIComponent(s.repository)}`;
    }

    // Resolves the correct Authorization header for PAT or Entra auth
    private async resolveAuthHeader(): Promise<string> {
        if (this.plugin.settings.authMethod === "entra") {
            const token = await this.plugin.entraAuth.getValidAccessToken();
            return `Bearer ${token}`;
        }
        return `Basic ${btoa(`:${this.plugin.settings.pat}`)}`;
    }

    protected async apiFetch(
        url: string,
        options: { method?: string; headers?: Record<string, string>; body?: string } = {}
    ): Promise<RequestUrlResponse> {
        const authHeader = await this.resolveAuthHeader();
        const headers: Record<string, string> = {
            Authorization: authHeader,
            "Content-Type": "application/json",
            ...(options.headers ?? {}),
        };
        const resp = await requestUrl({
            url,
            method: options.method ?? "GET",
            headers,
            body: options.body,
            throw: false,
        });
        if (resp.status >= 400) {
            // Extract the human-readable message from ADO's JSON envelope
            // (shape: { message: "TF401179: ...", typeKey: "...", ... })
            let detail: string;
            try {
                detail = resp.json?.message ?? resp.json?.value?.message ?? "";
            } catch {
                detail = "";
            }
            if (!detail) detail = resp.text || `HTTP ${resp.status}`;

            // Trim noisy TF error-code prefixes (e.g. "TF401179: ")
            detail = detail.replace(/^TF\d+:\s*/i, "");

            const fail = (message: string): never => {
                const err = new Error(message) as Error & { status?: number };
                err.status = resp.status;
                throw err;
            };

            switch (resp.status) {
                case 401:
                    fail(
                        `Authentication failed — your session may have expired. ` +
                        `Sign in again via Settings → OnyxAz. (${detail})`
                    );
                    break;
                case 403:
                    fail(
                        `Access denied — you may not have write access to this repository, ` +
                        `or a branch policy is blocking the operation. (${detail})`
                    );
                    break;
                case 404:
                    fail(
                        `Not found — check your org URL, project name, and repository name ` +
                        `in Settings → OnyxAz. (${detail})`
                    );
                    break;
                case 409:
                    fail(
                        `Push conflict — pull the latest changes from the remote before pushing. (${detail})`
                    );
                    break;
                default: {
                    // Catch non-fast-forward rejections that ADO sends as 400
                    const lower = detail.toLowerCase();
                    if (lower.includes("not a fast-forward") || lower.includes("push was rejected") || lower.includes("push rejected")) {
                        fail(
                            `Push rejected — the remote has new commits. Pull first, then push again. (${detail})`
                        );
                    }
                    if (lower.includes("already exists")) {
                        fail(
                            `A file or folder already exists at that path in the remote. ` +
                            `Try a Force re-pull to resync state, then push again. (${detail})`
                        );
                    }
                    fail(`Azure DevOps error (${resp.status}): ${detail}`);
                }
            }
        }
        return resp;
    }

    buildCommitMessage(numFiles: number): string {
        const s = this.plugin.settings;
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const dateStr = s.commitDateFormat
            .replace("YYYY", String(now.getFullYear()))
            .replace("MM", pad(now.getMonth() + 1))
            .replace("DD", pad(now.getDate()))
            .replace("HH", pad(now.getHours()))
            .replace("mm", pad(now.getMinutes()))
            .replace("ss", pad(now.getSeconds()));
        return s.commitMessage
            .replace("{{date}}", dateStr)
            .replace("{{numFiles}}", String(numFiles))
            .replace("{{vaultName}}", this.plugin.app.vault.getName());
    }
}
