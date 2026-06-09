import { requestUrl } from "obsidian";
import type { RequestUrlResponse } from "obsidian";
import type OnyxAz from "../main";
import type { LogEntry, SyncState, SyncStatus } from "../types";
import { ADO_API_VERSION } from "../constants";

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

    getCachedState(): SyncState | null {
        return this.cachedState;
    }

    resetState(): void {
        this.cachedState = null;
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

            switch (resp.status) {
                case 401:
                    throw new Error(
                        `Authentication failed — your session may have expired. ` +
                        `Sign in again via Settings → OnyxAz. (${detail})`
                    );
                case 403:
                    throw new Error(
                        `Access denied — you may not have write access to this repository, ` +
                        `or a branch policy is blocking the operation. (${detail})`
                    );
                case 404:
                    throw new Error(
                        `Not found — check your org URL, project name, and repository name ` +
                        `in Settings → OnyxAz. (${detail})`
                    );
                case 409:
                    throw new Error(
                        `Push conflict — pull the latest changes from the remote before pushing. (${detail})`
                    );
                default: {
                    // Catch non-fast-forward rejections that ADO sends as 400
                    const lower = detail.toLowerCase();
                    if (lower.includes("not a fast-forward") || lower.includes("push was rejected") || lower.includes("push rejected")) {
                        throw new Error(
                            `Push rejected — the remote has new commits. Pull first, then push again. (${detail})`
                        );
                    }
                    if (lower.includes("already exists")) {
                        throw new Error(
                            `A file or folder already exists at that path in the remote. ` +
                            `Try a Force re-pull to resync state, then push again. (${detail})`
                        );
                    }
                    throw new Error(`Azure DevOps error (${resp.status}): ${detail}`);
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
