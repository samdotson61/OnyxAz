import type OnyxAz from "../main";
import type { FileStatus, LogEntry, SyncState, SyncStatus } from "../types";
import { ADO_API_VERSION } from "../constants";

export abstract class AdoManager {
    protected cachedState: SyncState | null = null;

    constructor(protected readonly plugin: OnyxAz) {}

    abstract testConnection(): Promise<void>;
    abstract getStatus(): Promise<SyncStatus>;
    abstract pull(): Promise<number>;
    abstract push(message: string): Promise<void>;
    abstract commitAndSync(message: string): Promise<void>;
    abstract getLog(count: number): Promise<LogEntry[]>;
    abstract listBranches(): Promise<string[]>;
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

    protected get authHeader(): string {
        return `Basic ${btoa(`:${this.plugin.settings.pat}`)}`;
    }

    protected async apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
        const headers: Record<string, string> = {
            Authorization: this.authHeader,
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string> ?? {}),
        };
        const response = await fetch(url, { ...options, headers });
        if (!response.ok) {
            const text = await response.text().catch(() => response.statusText);
            throw new Error(`ADO API ${response.status}: ${text}`);
        }
        return response;
    }

    protected buildCommitMessage(numFiles: number): string {
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
