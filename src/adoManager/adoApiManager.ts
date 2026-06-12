import { normalizePath, Notice, TFile } from "obsidian";
import { AdoManager } from "./adoManager";
import { ADO_API_VERSION, DEFAULT_IGNORED, EMPTY_REPO_SHA, IGNORE_FILE_PATH, PULL_CONCURRENCY, STATE_FILE_PATH } from "../constants";
import type { AdoFile, FileStatus, LogEntry, RepoTarget, SyncState, SyncStatus } from "../types";
import type OnyxAz from "../main";
import { gitBlobSha1 } from "../util/hash";
import { matchesIgnore, parseIgnoreFile } from "../util/ignore";
import { buildSyncRoot } from "../util/syncRoot";
import { mapLimit } from "../util/concurrency";

export class AdoApiManager extends AdoManager {
    // Active ignore patterns (DEFAULT_IGNORED + any from .onyxazignore), refreshed
    // at the start of each top-level operation via loadIgnorePatterns().
    private ignorePatterns: string[] = [...DEFAULT_IGNORED];

    constructor(plugin: OnyxAz) {
        super(plugin);
    }

    // Reads the optional .onyxazignore file in the vault root and merges its
    // patterns with the built-in defaults. Called before each sync operation.
    private async loadIgnorePatterns(): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        const path = normalizePath(IGNORE_FILE_PATH);
        try {
            if (await adapter.exists(path)) {
                const contents = await adapter.read(path);
                this.ignorePatterns = [...DEFAULT_IGNORED, ...parseIgnoreFile(contents)];
                return;
            }
        } catch { /* unreadable — fall back to defaults */ }
        this.ignorePatterns = [...DEFAULT_IGNORED];
    }

    // ── Connection ──────────────────────────────────────────────────────────

    async testConnection(): Promise<void> {
        const org = this.plugin.settings.organizationUrl.replace(/\/$/, "");
        await this.apiFetch(`${org}/_apis/projects?api-version=${ADO_API_VERSION}`);
    }

    async listProjects(): Promise<string[]> {
        const org = this.plugin.settings.organizationUrl.replace(/\/$/, "");
        const resp = await this.apiFetch(`${org}/_apis/projects?api-version=${ADO_API_VERSION}`);
        const data = resp.json;
        return (data.value ?? []).map((p: { name: string }) => p.name);
    }

    async listRepositories(project: string): Promise<string[]> {
        const org = this.plugin.settings.organizationUrl.replace(/\/$/, "");
        const resp = await this.apiFetch(
            `${org}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${ADO_API_VERSION}`
        );
        const data = resp.json;
        return (data.value ?? []).map((r: { name: string }) => r.name);
    }

    async listBranches(): Promise<string[]> {
        return this.listBranchesFor(this.plugin.settings.project, this.plugin.settings.repository);
    }

    async listBranchesFor(project: string, repo: string): Promise<string[]> {
        const org = this.plugin.settings.organizationUrl.replace(/\/$/, "");
        const url =
            `${org}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}` +
            `/refs?filter=heads/&api-version=${ADO_API_VERSION}`;
        const resp = await this.apiFetch(url);
        const data = resp.json;
        return (data.value ?? []).map((r: { name: string }) => r.name.replace("refs/heads/", ""));
    }

    async switchBranch(branch: string): Promise<void> {
        this.plugin.settings.branch = branch;
        await this.plugin.saveSettings();
        this.cachedState = null;
    }

    // ── Remote tree & content ────────────────────────────────────────────────

    private async getLatestCommitId(priority = false): Promise<string> {
        const branch = this.plugin.settings.branch;
        const url =
            `${this.baseUrl}/commits` +
            `?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}` +
            `&searchCriteria.itemVersion.versionType=branch` +
            `&searchCriteria.$top=1` +
            `&api-version=${ADO_API_VERSION}`;
        try {
            const resp = await this.apiFetch(url, { priority });
            const data = resp.json;
            if (!data.value?.length) return EMPTY_REPO_SHA;
            return data.value[0].commitId as string;
        } catch {
            return EMPTY_REPO_SHA;
        }
    }

    private async getRemoteFileTree(priority = false): Promise<AdoFile[]> {
        const branch = this.plugin.settings.branch;
        const url =
            `${this.baseUrl}/items` +
            `?recursionLevel=Full` +
            `&versionDescriptor.version=${encodeURIComponent(branch)}` +
            `&versionDescriptor.versionType=branch` +
            `&api-version=${ADO_API_VERSION}`;
        try {
            const resp = await this.apiFetch(url, { priority });
            const data = resp.json;
            return ((data.value ?? []) as AdoFile[]).filter((f) => !f.isFolder);
        } catch {
            return [];
        }
    }

    private async getFileContent(remotePath: string): Promise<ArrayBuffer> {
        const branch = this.plugin.settings.branch;
        const url =
            `${this.baseUrl}/items` +
            `?path=${encodeURIComponent(remotePath)}` +
            `&versionDescriptor.version=${encodeURIComponent(branch)}` +
            `&versionDescriptor.versionType=branch` +
            `&$format=octetStream` +
            `&api-version=${ADO_API_VERSION}`;
        const resp = await this.apiFetch(url, {
            headers: { Accept: "application/octet-stream" },
        });
        return resp.arrayBuffer;
    }

    // ── State persistence ────────────────────────────────────────────────────

    async getSyncState(): Promise<SyncState | null> {
        if (this.cachedState) return this.cachedState;
        const adapter = this.plugin.app.vault.adapter;
        const path = normalizePath(STATE_FILE_PATH);
        try {
            // Use adapter directly — vault.getAbstractFileByPath() can return null
            // when the index is stale (file on disk but not yet indexed), so we
            // skip the index entirely for reliable state file access.
            if (!(await adapter.exists(path))) return null;
            const content = await adapter.read(path);
            const state = JSON.parse(content) as SyncState;
            // If the user changed localSyncPath since the last run, the stored
            // file paths are no longer valid for the new location — clear state
            // so a full re-sync downloads everything to the correct folder.
            if (state.syncRoot !== undefined && state.syncRoot !== this.syncRoot) {
                new Notice(
                    `OnyxAz: Sync folder changed to "${this.syncRoot || "(vault root)"}". ` +
                    `Old state cleared — use Force re-pull to download files to the new location.`,
                    8000
                );
                await adapter.remove(path).catch(() => {});
                return null;
            }
            this.cachedState = state;
            return this.cachedState;
        } catch {
            return null;
        }
    }

    async saveSyncState(state: SyncState): Promise<void> {
        // Always record the current syncRoot so we can detect path changes later
        const stateWithRoot: SyncState = { ...state, syncRoot: this.syncRoot };
        this.cachedState = stateWithRoot;
        const adapter = this.plugin.app.vault.adapter;
        const path = normalizePath(STATE_FILE_PATH);
        const dir = path.split("/").slice(0, -1).join("/");
        // Ensure directory exists via adapter — avoids vault.createFolder() throwing
        // "Folder already exists" when the index hasn't caught up with the filesystem.
        if (dir && !(await adapter.exists(dir))) {
            await adapter.mkdir(dir).catch(() => {});
        }
        // Write via adapter — avoids vault.create() throwing "File already exists"
        // when the vault index is stale (file is on disk but not yet indexed).
        await adapter.write(path, JSON.stringify(stateWithRoot, null, 2));
    }

    // ── Ignore logic ─────────────────────────────────────────────────────────

    private shouldIgnore(path: string): boolean {
        return matchesIgnore(path, this.ignorePatterns);
    }

    // ── Sync root ─────────────────────────────────────────────────────────────
    // Vault-relative folder prefix for this repo/branch (ends with "/" when
    // non-empty, or "" for vault-root mode). All local file I/O prepends this;
    // state keys stay remote-relative so the on-disk state format is unchanged.
    // Computed in the base class so the UI can show the same path.

    private get syncRoot(): string {
        return this.getSyncRoot();
    }

    // ── Adapter helpers ───────────────────────────────────────────────────────
    // vault.getFiles() only returns files Obsidian has indexed (filtered by
    // extension). The adapter gives the true filesystem view, including .txt etc.

    private async getAllLocalPaths(): Promise<Map<string, number>> {
        const root = this.syncRoot; // e.g. "ADO/Notes/" or ""
        const result = new Map<string, number>();

        // Primary: vault-indexed files (have mtime)
        for (const f of this.plugin.app.vault.getFiles()) {
            // When syncRoot is set, only include files inside that folder;
            // strip the prefix so keys are remote-relative (matching state keys)
            const relativePath = root
                ? (f.path.startsWith(root) ? f.path.slice(root.length) : null)
                : f.path;
            if (relativePath !== null && !this.shouldIgnore(relativePath)) {
                result.set(relativePath, f.stat.mtime);
            }
        }

        // Supplement: adapter scan for non-indexed files (e.g. .txt)
        // Starts from syncRoot so .obsidian/ and .onyxaz/ are naturally excluded
        const visit = async (dir: string) => {
            try {
                const { files, folders } = await this.plugin.app.vault.adapter.list(dir);
                for (const p of files) {
                    const relativePath = root ? p.slice(root.length) : p;
                    if (!this.shouldIgnore(relativePath) && !result.has(relativePath)) {
                        // Get actual mtime so status logic can correctly compare against lastSyncTime.
                        // Without this, non-indexed files (e.g. .txt) always appear as Modified.
                        const stat = await this.plugin.app.vault.adapter.stat(p);
                        result.set(relativePath, stat?.mtime ?? 0);
                    }
                }
                for (const folder of folders) {
                    const relativeFolder = root ? folder.slice(root.length) : folder;
                    if (!this.shouldIgnore(relativeFolder + "/")) await visit(folder);
                }
            } catch { /* skip inaccessible dirs */ }
        };
        await visit(root ? root.replace(/\/$/, "") : "");
        return result;
    }

    private async readLocalFile(filePath: string): Promise<ArrayBuffer | null> {
        // filePath is remote-relative; prepend syncRoot to get the vault-local path
        const p = normalizePath(this.syncRoot + filePath);
        const vaultFile = this.plugin.app.vault.getAbstractFileByPath(p);
        if (vaultFile instanceof TFile) return this.plugin.app.vault.readBinary(vaultFile);
        try { return await this.plugin.app.vault.adapter.readBinary(p); } catch { return null; }
    }

    // True if the local file's content differs from the given last-synced objectId.
    // Used only as a fallback when mtime is unavailable, so the hashing cost is
    // bounded to files we can't otherwise judge. Unreadable → treat as changed.
    private async isContentChanged(filePath: string, knownObjectId: string | undefined): Promise<boolean> {
        if (!knownObjectId) return true;
        const buffer = await this.readLocalFile(filePath);
        if (!buffer) return true;
        try {
            return (await gitBlobSha1(buffer)) !== knownObjectId;
        } catch {
            return true;
        }
    }

    // ── Status ───────────────────────────────────────────────────────────────

    async getStatus(): Promise<SyncStatus> {
        await this.loadIgnorePatterns();
        const state = await this.getSyncState();
        const localPaths = await this.getAllLocalPaths(); // path → mtime (0 = unknown)
        const changed: FileStatus[] = [];

        if (!state) {
            for (const path of localPaths.keys()) {
                changed.push({ path, status: "A" });
            }
            return { changed, conflicted: [], ahead: changed.length, behind: 0 };
        }

        const syncTime = state.lastSyncTime;

        for (const [path, mtime] of localPaths) {
            const knownRemotely = path in state.remoteObjectIds;
            if (!knownRemotely) {
                changed.push({ path, status: "A" });
            } else if (mtime === 0) {
                // mtime unavailable (stat failed / not indexed). Don't blindly mark
                // as modified — compare the content hash to the last-synced objectId
                // so unchanged files don't show as pending forever.
                if (await this.isContentChanged(path, state.remoteObjectIds[path])) {
                    changed.push({ path, status: "M" });
                }
            } else if (mtime > syncTime + 1000) {
                changed.push({ path, status: "M" });
            }
        }

        for (const path of Object.keys(state.remoteObjectIds)) {
            if (!localPaths.has(path) && !this.shouldIgnore(path)) {
                changed.push({ path, status: "D" });
            }
        }

        return { changed, conflicted: [], ahead: changed.length, behind: 0 };
    }

    // ── Pull ─────────────────────────────────────────────────────────────────

    // resolveConflicts: called when remote changed AND local file already exists.
    // Returns the set of paths the user wants to KEEP locally (skip remote version).
    async pull(
        resolveConflicts?: (conflicts: string[]) => Promise<Set<string>>,
        onProgress?: (done: number, total: number) => void
    ): Promise<number> {
        await this.loadIgnorePatterns();
        const [remoteTree, latestCommitId, state] = await Promise.all([
            this.getRemoteFileTree(),
            this.getLatestCommitId(),
            this.getSyncState(),
        ]);

        // Detect which files would overwrite existing local content
        const conflicts: string[] = [];
        for (const remoteFile of remoteTree) {
            const filePath = remoteFile.path.replace(/^\//, "");
            if (this.shouldIgnore(filePath)) continue;
            const storedObjectId = state?.remoteObjectIds[filePath];
            const remoteChanged = !state || storedObjectId !== remoteFile.objectId;
            if (remoteChanged && state) {
                const localExists = await this.plugin.app.vault.adapter.exists(normalizePath(this.syncRoot + filePath));
                if (localExists) conflicts.push(filePath);
            }
        }

        const skipPaths = conflicts.length > 0 && resolveConflicts
            ? await resolveConflicts(conflicts)
            : new Set<string>();

        // First pass: record remote object IDs and decide which files to download.
        const newRemoteObjectIds: Record<string, string> = {};
        const toDownload: string[] = [];
        for (const remoteFile of remoteTree) {
            const filePath = remoteFile.path.replace(/^\//, "");
            if (this.shouldIgnore(filePath)) continue;

            newRemoteObjectIds[filePath] = remoteFile.objectId;
            const storedObjectId = state?.remoteObjectIds[filePath];
            const localExists = await this.plugin.app.vault.adapter.exists(normalizePath(this.syncRoot + filePath));

            if ((!state || storedObjectId !== remoteFile.objectId || !localExists) && !skipPaths.has(filePath)) {
                toDownload.push(filePath);
            }
        }

        // Second pass: download in parallel (bounded), reporting after each file.
        let filesChanged = 0;
        const total = toDownload.length;
        if (onProgress) onProgress(0, total);
        await mapLimit(toDownload, PULL_CONCURRENCY, async (filePath) => {
            const buffer = await this.getFileContent(filePath.startsWith("/") ? filePath : `/${filePath}`);
            await this.writeLocalFile(filePath, buffer);
            filesChanged++;
            if (onProgress) onProgress(filesChanged, total);
        });

        if (state) {
            for (const path of Object.keys(state.remoteObjectIds)) {
                const stillExists = remoteTree.some((f) => f.path.replace(/^\//, "") === path);
                if (!stillExists) {
                    const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(this.syncRoot + path));
                    if (file) {
                        await this.plugin.app.vault.delete(file);
                        filesChanged++;
                    }
                }
            }
        }

        await this.saveSyncState({
            lastSyncedCommitId: latestCommitId,
            lastSyncTime: Date.now(),
            remoteObjectIds: newRemoteObjectIds,
        });

        return filesChanged;
    }

    private async writeLocalFile(filePath: string, buffer: ArrayBuffer): Promise<void> {
        // filePath is remote-relative; prepend syncRoot to get the vault-local path
        const normalPath = normalizePath(this.syncRoot + filePath);
        // Ensure parent directories exist
        const parts = normalPath.split("/");
        for (let i = 1; i < parts.length; i++) {
            const dir = parts.slice(0, i).join("/");
            if (dir && !(await this.plugin.app.vault.adapter.exists(dir))) {
                await this.plugin.app.vault.adapter.mkdir(dir).catch(() => {});
            }
        }
        // Write via adapter — bypasses Obsidian's extension filter so .txt etc. always land on disk
        try {
            await this.plugin.app.vault.adapter.writeBinary(normalPath, buffer);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            if (reason.includes("EEXIST") || reason.toLowerCase().includes("already exists")) {
                throw new Error(
                    `Cannot write "${filePath}" — a folder exists at that path in your vault. ` +
                    `Rename or remove the conflicting folder, then Force re-pull.`
                );
            }
            throw new Error(`Cannot write "${filePath}" to vault: ${reason}`);
        }
    }

    // ── Push ─────────────────────────────────────────────────────────────────

    async push(message: string, changes?: FileStatus[]): Promise<void> {
        const changedFiles = changes ?? (await this.getStatus()).changed;
        if (changedFiles.length === 0) return;

        // Prefer the cached sync state for the base commit + remote path set so we
        // don't re-download the full remote tree on every push. Fall back to a
        // live fetch only when there's no state yet (never synced).
        const state = await this.getSyncState();
        let baseCommitId: string;
        let remotePathSet: Set<string>;
        if (state) {
            baseCommitId = state.lastSyncedCommitId;
            remotePathSet = new Set(Object.keys(state.remoteObjectIds));
        } else {
            const [cid, tree] = await Promise.all([
                this.getLatestCommitId(true),
                this.getRemoteFileTree(true),
            ]);
            baseCommitId = cid;
            remotePathSet = new Set(tree.map((f) => f.path.replace(/^\//, "")));
        }

        const maxBytes = this.plugin.settings.maxAttachmentSizeMB * 1024 * 1024;
        const pushChanges: object[] = [];
        const pushedPaths: string[] = [];

        for (const fileStatus of changedFiles) {
            if (fileStatus.status === "D") {
                pushChanges.push({
                    changeType: "delete",
                    item: { path: `/${fileStatus.path}` },
                });
                pushedPaths.push(fileStatus.path);
                continue;
            }

            const buffer = await this.readLocalFile(fileStatus.path);
            if (!buffer) {
                new Notice(`OnyxAz: Skipping ${fileStatus.path} — file not readable.`);
                continue;
            }

            if (buffer.byteLength > maxBytes) {
                new Notice(
                    `OnyxAz: Skipping ${fileStatus.path} — ${(buffer.byteLength / 1048576).toFixed(1)} MB exceeds the ${this.plugin.settings.maxAttachmentSizeMB} MB limit.`,
                    6000
                );
                continue;
            }

            pushChanges.push({
                changeType: remotePathSet.has(fileStatus.path) ? "edit" : "add",
                item: { path: `/${fileStatus.path}` },
                newContent: {
                    content: arrayBufferToBase64(buffer),
                    contentType: "base64Encoded",
                },
            });
            pushedPaths.push(fileStatus.path);
        }

        if (pushChanges.length === 0) return;

        await this.executePush(message, pushChanges, pushedPaths, baseCommitId, state);

        // Refresh state after push
        const [newCommitId, newRemoteTree] = await Promise.all([
            this.getLatestCommitId(),
            this.getRemoteFileTree(),
        ]);
        const remoteObjectIds: Record<string, string> = {};
        for (const f of newRemoteTree) {
            remoteObjectIds[f.path.replace(/^\//, "")] = f.objectId;
        }
        await this.saveSyncState({
            lastSyncedCommitId: newCommitId,
            lastSyncTime: Date.now(),
            remoteObjectIds,
        });
    }

    // Posts the commit, retrying once if the remote advanced since our base commit
    // (ADO returns 409 / "not a fast-forward"). We only auto-retry when none of the
    // files we're pushing were changed remotely — otherwise retrying would silently
    // overwrite a concurrent edit, so we re-throw the original "pull first" error.
    private async executePush(
        message: string,
        pushChanges: object[],
        pushedPaths: string[],
        baseCommitId: string,
        state: SyncState | null
    ): Promise<void> {
        const attempt = (oldObjectId: string) =>
            this.apiFetch(`${this.baseUrl}/pushes?api-version=${ADO_API_VERSION}`, {
                method: "POST",
                priority: true,
                body: JSON.stringify({
                    refUpdates: [{ name: `refs/heads/${this.plugin.settings.branch}`, oldObjectId }],
                    commits: [{ comment: message, changes: pushChanges }],
                }),
            });

        try {
            await attempt(baseCommitId);
        } catch (e) {
            const err = e as Error & { status?: number };
            const isConcurrency =
                err.status === 409 ||
                (err.status === 400 && /fast-forward|push (was )?rejected/i.test(err.message));
            if (!isConcurrency) throw e;

            // Remote moved. Bail if it touched any file we're about to write.
            const freshTree = await this.getRemoteFileTree(true);
            const freshIds = new Map(freshTree.map((f) => [f.path.replace(/^\//, ""), f.objectId]));
            const base = state?.remoteObjectIds ?? {};
            const overlap = pushedPaths.some((p) => freshIds.get(p) !== base[p]);
            if (overlap) throw e;

            const freshCommitId = await this.getLatestCommitId(true);
            if (freshCommitId === baseCommitId) throw e;
            await attempt(freshCommitId);
        }
    }

    // ── Organization mirror (pull-only) ───────────────────────────────────────

    // Lists repos in a project together with each repo's default branch.
    async listRepositoriesDetailed(project: string): Promise<{ name: string; branch: string }[]> {
        const org = this.plugin.settings.organizationUrl.replace(/\/$/, "");
        const resp = await this.apiFetch(
            `${org}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${ADO_API_VERSION}`
        );
        const data = resp.json;
        return ((data.value ?? []) as { name: string; defaultBranch?: string }[]).map((r) => ({
            name: r.name,
            branch: (r.defaultBranch ?? "").replace(/^refs\/heads\//, "") || "main",
        }));
    }

    // Creates an empty folder per project under the org root (no file content is
    // downloaded). Returns a map of created folder path -> project name so the
    // plugin can pull the right project when its folder is clicked.
    async scaffoldOrg(): Promise<Map<string, string>> {
        const projects = await this.listProjects();
        const adapter = this.plugin.app.vault.adapter;
        const map = new Map<string, string>();
        for (const project of projects) {
            const folder = normalizePath(
                buildSyncRoot({ organizationUrl: this.plugin.settings.organizationUrl, project }).replace(/\/$/, "")
            );
            if (!folder) continue;
            if (!(await adapter.exists(folder))) await adapter.mkdir(folder).catch(() => {});
            map.set(folder, project);
        }
        return map;
    }

    // Pulls (incrementally) every repo (default branch) of a project into
    // <org>_ADO/<project>/<repo>/<branch>/, each with its own commit state so it
    // can later be pushed back. Returns repo/file counts.
    async hydrateProject(
        project: string,
        onProgress?: (files: number, repo: string) => void
    ): Promise<{ repos: number; files: number }> {
        await this.loadIgnorePatterns();
        const repos = await this.listRepositoriesDetailed(project);
        let files = 0;
        for (const r of repos) {
            const target: RepoTarget = { project, repo: r.name, branch: r.branch };
            await this.pullTarget(target, () => {
                files++;
                if (onProgress) onProgress(files, r.name);
            });
        }
        return { repos: repos.length, files };
    }

    private targetRepoUrl(project: string, repo: string): string {
        const org = this.plugin.settings.organizationUrl.replace(/\/$/, "");
        return `${org}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`;
    }

    // Vault-relative folder for a target, always ending with "/".
    getTargetFolder(t: RepoTarget): string {
        return buildSyncRoot({
            organizationUrl: this.plugin.settings.organizationUrl,
            project: t.project,
            repository: t.repo,
            branch: t.branch,
        });
    }

    private targetStatePath(t: RepoTarget): string {
        const key = [t.project, t.repo, t.branch]
            .map((s) => s.replace(/[^a-zA-Z0-9._-]+/g, "_"))
            .join("__");
        return normalizePath(`.onyxaz/repos/${key}.json`);
    }

    private async readTargetState(t: RepoTarget): Promise<SyncState | null> {
        const adapter = this.plugin.app.vault.adapter;
        const path = this.targetStatePath(t);
        try {
            if (!(await adapter.exists(path))) return null;
            return JSON.parse(await adapter.read(path)) as SyncState;
        } catch {
            return null;
        }
    }

    private async writeTargetState(t: RepoTarget, state: SyncState): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        const dir = normalizePath(".onyxaz/repos");
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir).catch(() => {});
        await adapter.write(this.targetStatePath(t), JSON.stringify(state, null, 2));
    }

    private async targetCommitId(t: RepoTarget, priority = false): Promise<string> {
        try {
            const resp = await this.apiFetch(
                `${this.targetRepoUrl(t.project, t.repo)}/commits` +
                `?searchCriteria.itemVersion.version=${encodeURIComponent(t.branch)}` +
                `&searchCriteria.itemVersion.versionType=branch&searchCriteria.$top=1&api-version=${ADO_API_VERSION}`,
                { priority }
            );
            return (resp.json.value?.[0]?.commitId as string) ?? EMPTY_REPO_SHA;
        } catch {
            return EMPTY_REPO_SHA;
        }
    }

    private async readBinaryAt(fullPath: string): Promise<ArrayBuffer | null> {
        try { return await this.plugin.app.vault.adapter.readBinary(normalizePath(fullPath)); } catch { return null; }
    }

    // Incremental pull of one repo/branch into its mirror folder. Records commit
    // state so subsequent pulls fetch only changes and pushes can be detected.
    async pullTarget(
        t: RepoTarget,
        onFile?: () => void,
        resolveConflicts?: (conflicts: string[]) => Promise<Set<string>>
    ): Promise<number> {
        await this.loadIgnorePatterns();
        const folder = this.getTargetFolder(t);
        const base = this.targetRepoUrl(t.project, t.repo);
        const adapter = this.plugin.app.vault.adapter;

        let tree: AdoFile[];
        let latestCommitId: string;
        try {
            const [treeResp, commitId] = await Promise.all([
                this.apiFetch(
                    `${base}/items?recursionLevel=Full` +
                    `&versionDescriptor.version=${encodeURIComponent(t.branch)}` +
                    `&versionDescriptor.versionType=branch&api-version=${ADO_API_VERSION}`
                ),
                this.targetCommitId(t),
            ]);
            tree = ((treeResp.json.value ?? []) as AdoFile[]).filter((f) => !f.isFolder);
            latestCommitId = commitId;
        } catch {
            return 0; // empty / inaccessible — leave folder as-is
        }

        const state = await this.readTargetState(t);
        const newIds: Record<string, string> = {};
        const toDownload: string[] = []; // files not on device → always safe to add
        const conflicts: string[] = [];  // exist locally but changed upstream
        for (const f of tree) {
            const rel = f.path.replace(/^\//, "");
            if (this.shouldIgnore(rel)) continue;
            newIds[rel] = f.objectId;
            const exists = await adapter.exists(normalizePath(folder + rel));
            if (!exists) {
                toDownload.push(rel);
            } else if (!state || state.remoteObjectIds[rel] !== f.objectId) {
                conflicts.push(rel); // existing file differs from remote
            }
            // else: exists and unchanged → skip (never re-download what's already here)
        }

        // Existing files are only overwritten with explicit consent (a resolver).
        // Background/project pulls pass none, so they never clobber local files.
        if (conflicts.length > 0 && resolveConflicts) {
            const keep = await resolveConflicts(conflicts);
            for (const rel of conflicts) if (!keep.has(rel)) toDownload.push(rel);
        }

        // Download in parallel, but tolerate per-file failures: one stalled/large
        // file must not abort the whole pull (it would otherwise re-download
        // everything on the next attempt). Failures are simply retried next pull,
        // since they still don't exist on device.
        let n = 0;
        let failed = 0;
        await mapLimit(toDownload, PULL_CONCURRENCY, async (rel) => {
            try {
                const resp = await this.apiFetch(
                    `${base}/items?path=${encodeURIComponent("/" + rel)}` +
                    `&versionDescriptor.version=${encodeURIComponent(t.branch)}` +
                    `&versionDescriptor.versionType=branch&$format=octetStream&api-version=${ADO_API_VERSION}`,
                    { headers: { Accept: "application/octet-stream" } }
                );
                await this.writeBinaryInto(normalizePath(folder + rel), resp.arrayBuffer);
                n++;
                if (onFile) onFile();
            } catch {
                failed++;
            }
        });

        await this.writeTargetState(t, {
            lastSyncedCommitId: latestCommitId,
            lastSyncTime: Date.now(),
            remoteObjectIds: newIds,
        });

        if (failed > 0) {
            new Notice(
                `OnyxAz: ${failed} file(s) in ${t.repo} couldn't be downloaded (large or slow). ` +
                `Run Pull again to fetch just those.`,
                8000
            );
        }
        return n;
    }

    private async targetLocalPaths(t: RepoTarget): Promise<Map<string, number>> {
        const root = this.getTargetFolder(t); // ends with "/"
        const adapter = this.plugin.app.vault.adapter;
        const result = new Map<string, number>();
        const visit = async (dir: string) => {
            try {
                const { files, folders } = await adapter.list(dir);
                for (const p of files) {
                    const rel = p.slice(root.length);
                    if (!this.shouldIgnore(rel)) {
                        const st = await adapter.stat(p);
                        result.set(rel, st?.mtime ?? 0);
                    }
                }
                for (const f of folders) {
                    const relf = f.slice(root.length);
                    if (!this.shouldIgnore(relf + "/")) await visit(f);
                }
            } catch { /* skip */ }
        };
        const base = root.replace(/\/$/, "");
        if (base && (await adapter.exists(base))) await visit(base);
        return result;
    }

    // Local changes in a mirrored repo (vs its last-synced state).
    async getTargetStatus(t: RepoTarget): Promise<FileStatus[]> {
        await this.loadIgnorePatterns();
        const folder = this.getTargetFolder(t);
        const state = await this.readTargetState(t);
        const local = await this.targetLocalPaths(t);
        const changed: FileStatus[] = [];
        if (!state) {
            for (const p of local.keys()) changed.push({ path: p, status: "A" });
            return changed;
        }
        const syncTime = state.lastSyncTime;
        for (const [p, mtime] of local) {
            if (!(p in state.remoteObjectIds)) {
                changed.push({ path: p, status: "A" });
            } else if (mtime === 0) {
                const buf = await this.readBinaryAt(folder + p);
                if (!buf || (await gitBlobSha1(buf)) !== state.remoteObjectIds[p]) changed.push({ path: p, status: "M" });
            } else if (mtime > syncTime + 1000) {
                changed.push({ path: p, status: "M" });
            }
        }
        for (const p of Object.keys(state.remoteObjectIds)) {
            if (!local.has(p) && !this.shouldIgnore(p)) changed.push({ path: p, status: "D" });
        }
        return changed;
    }

    // Commits + pushes local changes to a single mirrored repo. Pull-first safety:
    // on a concurrency rejection it only retries if none of the pushed files were
    // touched upstream, otherwise it asks the user to pull that repo first.
    async pushTarget(t: RepoTarget, message: string, changes: FileStatus[]): Promise<void> {
        if (changes.length === 0) return;
        const folder = this.getTargetFolder(t);
        const base = this.targetRepoUrl(t.project, t.repo);
        const state = await this.readTargetState(t);
        const baseCommit = state?.lastSyncedCommitId ?? (await this.targetCommitId(t, true));
        const remotePaths = new Set(Object.keys(state?.remoteObjectIds ?? {}));
        const maxBytes = this.plugin.settings.maxAttachmentSizeMB * 1024 * 1024;

        const pushChanges: object[] = [];
        const pushedPaths: string[] = [];
        for (const fs of changes) {
            if (fs.status === "D") {
                pushChanges.push({ changeType: "delete", item: { path: `/${fs.path}` } });
                pushedPaths.push(fs.path);
                continue;
            }
            const buffer = await this.readBinaryAt(folder + fs.path);
            if (!buffer) { new Notice(`OnyxAz: Skipping ${fs.path} — not readable.`); continue; }
            if (buffer.byteLength > maxBytes) {
                new Notice(`OnyxAz: Skipping ${fs.path} — exceeds the ${this.plugin.settings.maxAttachmentSizeMB} MB limit.`, 6000);
                continue;
            }
            pushChanges.push({
                changeType: remotePaths.has(fs.path) ? "edit" : "add",
                item: { path: `/${fs.path}` },
                newContent: { content: arrayBufferToBase64(buffer), contentType: "base64Encoded" },
            });
            pushedPaths.push(fs.path);
        }
        if (pushChanges.length === 0) return;

        const attempt = (oldObjectId: string) =>
            this.apiFetch(`${base}/pushes?api-version=${ADO_API_VERSION}`, {
                method: "POST",
                priority: true,
                body: JSON.stringify({
                    refUpdates: [{ name: `refs/heads/${t.branch}`, oldObjectId }],
                    commits: [{ comment: message, changes: pushChanges }],
                }),
            });

        try {
            await attempt(baseCommit);
        } catch (e) {
            const err = e as Error & { status?: number };
            const concurrency = err.status === 409 ||
                (err.status === 400 && /fast-forward|push (was )?rejected/i.test(err.message));
            if (!concurrency) throw e;
            const fresh = await this.targetCommitId(t, true);
            if (fresh === baseCommit) throw e;
            // Only auto-retry if the remote didn't change a file we're pushing.
            const treeResp = await this.apiFetch(
                `${base}/items?recursionLevel=Full&versionDescriptor.version=${encodeURIComponent(t.branch)}` +
                `&versionDescriptor.versionType=branch&api-version=${ADO_API_VERSION}`,
                { priority: true }
            );
            const freshIds = new Map(((treeResp.json.value ?? []) as AdoFile[]).map((f) => [f.path.replace(/^\//, ""), f.objectId]));
            const base0 = state?.remoteObjectIds ?? {};
            if (pushedPaths.some((p) => freshIds.get(p) !== base0[p])) throw e;
            await attempt(fresh);
        }

        // Refresh this repo's state after pushing.
        await this.pullTarget(t);
    }

    private async writeBinaryInto(fullPath: string, buffer: ArrayBuffer): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        const parts = fullPath.split("/");
        for (let i = 1; i < parts.length; i++) {
            const dir = parts.slice(0, i).join("/");
            if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir).catch(() => {});
        }
        await adapter.writeBinary(fullPath, buffer);
    }

    // ── Commit and sync ───────────────────────────────────────────────────────

    async commitAndSync(message: string): Promise<void> {
        await this.pull();
        await this.push(message);
    }

    // Force-pull: wipes local state so every remote file is re-downloaded
    async forcePull(onProgress?: (done: number, total: number) => void): Promise<number> {
        this.cachedState = null;
        const adapter = this.plugin.app.vault.adapter;
        const path = normalizePath(STATE_FILE_PATH);
        if (await adapter.exists(path)) {
            await adapter.remove(path).catch(() => {});
        }
        return this.pull(undefined, onProgress);
    }

    // ── History ───────────────────────────────────────────────────────────────

    async getLog(count: number): Promise<LogEntry[]> {
        const branch = this.plugin.settings.branch;
        const url =
            `${this.baseUrl}/commits` +
            `?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}` +
            `&searchCriteria.itemVersion.versionType=branch` +
            `&searchCriteria.$top=${count}` +
            `&api-version=${ADO_API_VERSION}`;
        const resp = await this.apiFetch(url);
        const data = resp.json;
        return (data.value ?? []).map((c: {
            commitId: string;
            comment: string;
            author: { name: string; email: string; date: string };
        }) => ({
            hash: c.commitId.slice(0, 7),
            message: c.comment,
            author: c.author.name,
            authorEmail: c.author.email,
            date: c.author.date,
        }));
    }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.slice(i, Math.min(i + chunkSize, bytes.length)));
    }
    return btoa(binary);
}
