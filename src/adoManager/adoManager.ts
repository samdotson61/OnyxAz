import { Notice, requestUrl } from "obsidian";
import type { RequestUrlResponse } from "obsidian";
import type OnyxAz from "../main";
import type { FileStatus, LogEntry, RepoTarget, SyncState, SyncStatus } from "../types";
import { buildSyncRoot, orgRootFolder } from "../util/syncRoot";
import { PULL_CONCURRENCY } from "../constants";
import { AdaptiveLimit, parseRetryAfter, backoffDelayMs } from "../util/backoff";

export abstract class AdoManager {
    protected cachedState: SyncState | null = null;

    // ── Request gate ──────────────────────────────────────────────────────────
    // Caps how many ADO HTTP requests are in flight at once. Without this, a
    // heavy multi-file pull (mapLimit at PULL_CONCURRENCY) saturates the
    // connection pool and a concurrent push gets buried behind it until it times
    // out. Two levers protect a push:
    //   1. Pushes acquire with priority + reserved headroom, so they launch
    //      immediately instead of waiting in our own queue.
    //   2. While any push is pending, the normal (pull) cap collapses so we stop
    //      feeding new downloads — in-flight pulls drain and free the connection
    //      pool for the push, which then completes quickly.
    // (In-flight requests can't be cancelled, so the push still waits for the few
    // downloads already running, but no longer behind a continuously refilled
    // 16-wide pull.)
    private static readonly MAX_INFLIGHT = PULL_CONCURRENCY;
    private static readonly PUSH_RESERVE = 4;
    private static readonly NORMAL_CAP_WHILE_PUSHING = 2;
    private inFlight = 0;
    private priorityPending = 0; // priority requests waiting or in flight
    private gateQueue: Array<{ priority: boolean; resolve: () => void }> = [];
    // Dynamic ceiling: shrinks when ADO rate-limits (429/503), recovers on
    // sustained success. The gate admits at most `limit.current` normal requests.
    private limit = new AdaptiveLimit(AdoManager.MAX_INFLIGHT);
    private throttleNoticeAt = 0;

    constructor(protected readonly plugin: OnyxAz) {}

    private capFor(priority: boolean): number {
        if (priority) return this.limit.current + AdoManager.PUSH_RESERVE;
        return this.priorityPending > 0
            ? AdoManager.NORMAL_CAP_WHILE_PUSHING
            : this.limit.current;
    }

    private acquireSlot(priority: boolean): Promise<void> {
        if (priority) this.priorityPending++;
        if (this.inFlight < this.capFor(priority)) {
            this.inFlight++;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            const waiter = { priority, resolve };
            // Priority waiters jump ahead of any normal (pull) waiters.
            const idx = priority ? this.gateQueue.findIndex((w) => !w.priority) : -1;
            if (idx === -1) this.gateQueue.push(waiter);
            else this.gateQueue.splice(idx, 0, waiter);
        });
    }

    private releaseSlot(priority: boolean): void {
        this.inFlight--;
        if (priority) this.priorityPending--;
        // Admit as many queued waiters as now fit. Caps can have just changed
        // (e.g. the last push drained, restoring the normal cap), so loop rather
        // than admit a single waiter. A normal waiter never uses the push reserve.
        while (this.gateQueue.length && this.inFlight < this.capFor(this.gateQueue[0].priority)) {
            const next = this.gateQueue.shift()!;
            this.inFlight++;
            next.resolve();
        }
    }

    abstract testConnection(): Promise<void>;
    abstract getStatus(): Promise<SyncStatus>;
    abstract pull(
        resolveConflicts?: (conflicts: string[]) => Promise<Set<string>>,
        onProgress?: (done: number, total: number) => void
    ): Promise<number>;
    abstract forcePull(onProgress?: (done: number, total: number) => void): Promise<number>;
    abstract push(message: string, changes?: import("../types").FileStatus[]): Promise<void>;
    abstract commitAndSync(message: string): Promise<void>;
    abstract getLog(count: number): Promise<LogEntry[]>;
    abstract listBranches(): Promise<string[]>;
    abstract listBranchesFor(project: string, repo: string): Promise<string[]>;
    abstract switchBranch(branch: string): Promise<void>;
    abstract listProjects(): Promise<string[]>;
    abstract listRepositories(project: string): Promise<string[]>;
    abstract listRepositoriesDetailed(project: string): Promise<{ name: string; branch: string }[]>;
    abstract getSyncState(): Promise<SyncState | null>;
    abstract saveSyncState(state: SyncState): Promise<void>;

    // ── Organization mirror (pull-only) ───────────────────────────────────────
    // Create an empty folder per project under the org root; returns a map of
    // folder path -> project name for click-to-hydrate.
    abstract scaffoldOrg(): Promise<Map<string, string>>;
    // Pull every repo (default branch) of a project into its folder (incremental).
    abstract hydrateProject(
        project: string,
        onProgress?: (files: number, repo: string) => void
    ): Promise<{ repos: number; files: number }>;

    // Per-repo two-way sync for the org mirror.
    abstract getTargetFolder(t: RepoTarget): string;
    abstract pullTarget(
        t: RepoTarget,
        onFile?: () => void,
        resolveConflicts?: (conflicts: string[]) => Promise<Set<string>>,
        onSkipped?: (count: number) => void
    ): Promise<number>;
    abstract getTargetStatus(t: RepoTarget): Promise<FileStatus[]>;
    abstract pushTarget(t: RepoTarget, message: string, changes: FileStatus[]): Promise<void>;

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
        options: { method?: string; headers?: Record<string, string>; body?: string; priority?: boolean; timeoutMs?: number } = {}
    ): Promise<RequestUrlResponse> {
        const authHeader = await this.resolveAuthHeader();
        const headers: Record<string, string> = {
            Authorization: authHeader,
            "Content-Type": "application/json",
            ...(options.headers ?? {}),
        };
        // Wait for a slot in the global request gate so a heavy pull can't starve
        // a push. Pushes pass priority:true and get reserved headroom.
        const priority = options.priority ?? false;
        // The 60s default suits small control/JSON requests; large binary
        // downloads pass a longer timeoutMs for the multi-MB transfer.
        const TIMEOUT_MS = options.timeoutMs ?? 60000;
        const MAX_THROTTLE_RETRIES = 5;
        await this.acquireSlot(priority);
        try {
            for (let attempt = 0; ; attempt++) {
                // Race each attempt against a timeout so a stalled connection fails
                // fast rather than hanging the whole sync queue. requestUrl can't be
                // cancelled, but the timeout lets us move on. The gate slot is held
                // across retries, so backing off naturally reduces in-flight load.
                const resp = await Promise.race([
                    requestUrl({ url, method: options.method ?? "GET", headers, body: options.body, throw: false }),
                    new Promise<RequestUrlResponse>((_, reject) =>
                        setTimeout(() => reject(new Error(`Request timed out after ${TIMEOUT_MS / 1000}s. The network may have stalled — try again, or use "OnyxAz: Recover".`)), TIMEOUT_MS)
                    ),
                ]);

                // Rate-limited (429) or temporarily unavailable (503): shrink the
                // concurrency ceiling, wait (honoring Retry-After), and retry.
                if ((resp.status === 429 || resp.status === 503) && attempt < MAX_THROTTLE_RETRIES) {
                    this.limit.onThrottle();
                    this.notifyThrottleOnce();
                    const header = resp.headers?.["retry-after"] ?? resp.headers?.["Retry-After"];
                    const waitMs = parseRetryAfter(header, Date.now()) ?? backoffDelayMs(attempt);
                    await new Promise((r) => setTimeout(r, waitMs));
                    continue;
                }

                if (resp.status < 400) this.limit.onSuccess();
                return this.handleResponse(resp);
            }
        } finally {
            this.releaseSlot(priority);
        }
    }

    // Surfaces a single, coalesced notice when ADO starts rate-limiting, so the
    // automatic slow-down isn't a mystery. Suppressed for 30s after each, to
    // avoid spamming during a throttling burst.
    private notifyThrottleOnce(): void {
        const now = Date.now();
        if (now - this.throttleNoticeAt > 30000) {
            this.throttleNoticeAt = now;
            new Notice("OnyxAz: Azure DevOps is rate-limiting — slowing down and retrying automatically.", 6000);
        }
    }

    // Maps ADO error envelopes / HTTP status codes to friendly errors, or returns
    // the response unchanged on success. Split out of apiFetch so the gate's
    // try/finally stays readable.
    private handleResponse(resp: RequestUrlResponse): RequestUrlResponse {
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
