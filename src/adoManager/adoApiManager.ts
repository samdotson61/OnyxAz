import { normalizePath, Notice, TFile } from "obsidian";
import { AdoManager } from "./adoManager";
import { ADO_API_VERSION, DEFAULT_IGNORED, EMPTY_REPO_SHA, STATE_FILE_PATH } from "../constants";
import type { AdoFile, FileStatus, LogEntry, SyncState, SyncStatus } from "../types";
import type OnyxAz from "../main";

export class AdoApiManager extends AdoManager {
    constructor(plugin: OnyxAz) {
        super(plugin);
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

    private async getLatestCommitId(): Promise<string> {
        const branch = this.plugin.settings.branch;
        const url =
            `${this.baseUrl}/commits` +
            `?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}` +
            `&searchCriteria.itemVersion.versionType=branch` +
            `&searchCriteria.$top=1` +
            `&api-version=${ADO_API_VERSION}`;
        try {
            const resp = await this.apiFetch(url);
            const data = resp.json;
            if (!data.value?.length) return EMPTY_REPO_SHA;
            return data.value[0].commitId as string;
        } catch {
            return EMPTY_REPO_SHA;
        }
    }

    private async getRemoteFileTree(): Promise<AdoFile[]> {
        const branch = this.plugin.settings.branch;
        const url =
            `${this.baseUrl}/items` +
            `?recursionLevel=Full` +
            `&versionDescriptor.version=${encodeURIComponent(branch)}` +
            `&versionDescriptor.versionType=branch` +
            `&api-version=${ADO_API_VERSION}`;
        try {
            const resp = await this.apiFetch(url);
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
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(STATE_FILE_PATH));
            if (!(file instanceof TFile)) return null;
            const content = await this.plugin.app.vault.read(file);
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
                await this.plugin.app.vault.delete(file);
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
        const path = normalizePath(STATE_FILE_PATH);
        const dir = path.split("/").slice(0, -1).join("/");
        if (dir && !this.plugin.app.vault.getAbstractFileByPath(dir)) {
            await this.plugin.app.vault.createFolder(dir).catch(() => {});
        }
        const content = JSON.stringify(stateWithRoot, null, 2);
        const existing = this.plugin.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            await this.plugin.app.vault.modify(existing, content);
        } else {
            await this.plugin.app.vault.create(path, content);
        }
    }

    // ── Ignore logic ─────────────────────────────────────────────────────────

    private shouldIgnore(path: string): boolean {
        return DEFAULT_IGNORED.some((p) => {
            if (p.endsWith("/")) return path.startsWith(p) || path === p.slice(0, -1);
            return path === p || path.startsWith(p + "/");
        });
    }

    // ── Sync root ─────────────────────────────────────────────────────────────
    // Returns the vault-relative folder prefix for this repo (always ends with
    // "/" when non-empty, or "" for vault-root mode). All local file I/O
    // prepends this; state keys stay remote-relative so the format is unchanged.

    private get syncRoot(): string {
        // Explicit override wins; otherwise default to ADO/<project>/ so files
        // never land at the vault root without any configuration.
        const explicit = (this.plugin.settings.localSyncPath ?? "").trim().replace(/^\/+|\/+$/g, "");
        if (explicit) return explicit + "/";
        const project = (this.plugin.settings.project ?? "").trim();
        return project ? `ADO/${project}/` : "";
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

    // ── Status ───────────────────────────────────────────────────────────────

    async getStatus(): Promise<SyncStatus> {
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
            } else if (mtime === 0 || mtime > syncTime + 1000) {
                // mtime=0 means Obsidian didn't index it — treat as potentially modified
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
        resolveConflicts?: (conflicts: string[]) => Promise<Set<string>>
    ): Promise<number> {
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

        let filesChanged = 0;
        const newRemoteObjectIds: Record<string, string> = {};

        for (const remoteFile of remoteTree) {
            const filePath = remoteFile.path.replace(/^\//, "");
            if (this.shouldIgnore(filePath)) continue;

            newRemoteObjectIds[filePath] = remoteFile.objectId;
            const storedObjectId = state?.remoteObjectIds[filePath];
            const localExists = await this.plugin.app.vault.adapter.exists(normalizePath(this.syncRoot + filePath));

            if (!state || storedObjectId !== remoteFile.objectId || !localExists) {
                if (skipPaths.has(filePath)) continue;
                const buffer = await this.getFileContent(filePath.startsWith("/") ? filePath : `/${filePath}`);
                await this.writeLocalFile(filePath, buffer);
                filesChanged++;
            }
        }

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

        const [latestCommitId, remoteTree] = await Promise.all([
            this.getLatestCommitId(),
            this.getRemoteFileTree(),
        ]);

        const remotePathSet = new Set(remoteTree.map((f) => f.path.replace(/^\//, "")));
        const maxBytes = this.plugin.settings.maxAttachmentSizeMB * 1024 * 1024;
        const pushChanges: object[] = [];

        for (const fileStatus of changedFiles) {
            if (fileStatus.status === "D") {
                pushChanges.push({
                    changeType: "delete",
                    item: { path: `/${fileStatus.path}` },
                });
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
        }

        if (pushChanges.length === 0) return;

        const payload = {
            refUpdates: [
                { name: `refs/heads/${this.plugin.settings.branch}`, oldObjectId: latestCommitId },
            ],
            commits: [{ comment: message, changes: pushChanges }],
        };

        await this.apiFetch(`${this.baseUrl}/pushes?api-version=${ADO_API_VERSION}`, {
            method: "POST",
            body: JSON.stringify(payload),
        });

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

    // ── Commit and sync ───────────────────────────────────────────────────────

    async commitAndSync(message: string): Promise<void> {
        await this.pull();
        await this.push(message);
    }

    // Force-pull: wipes local state so every remote file is re-downloaded
    async forcePull(): Promise<number> {
        this.cachedState = null;
        const path = normalizePath(".onyxaz/state.json");
        const existing = this.plugin.app.vault.getAbstractFileByPath(path);
        if (existing) await this.plugin.app.vault.delete(existing);
        return this.pull();
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
