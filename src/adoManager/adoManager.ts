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
    abstract pull(): Promise<number>;
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
            throw new Error(`ADO API ${resp.status}: ${resp.text}`);
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
