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
            this.cachedState = JSON.parse(content) as SyncState;
            return this.cachedState;
        } catch {
            return null;
        }
    }

    async saveSyncState(state: SyncState): Promise<void> {
        this.cachedState = state;
        const path = normalizePath(STATE_FILE_PATH);
        const dir = path.split("/").slice(0, -1).join("/");
        if (dir && !this.plugin.app.vault.getAbstractFileByPath(dir)) {
            await this.plugin.app.vault.createFolder(dir).catch(() => {});
        }
        const content = JSON.stringify(state, null, 2);
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

    // ── Status ───────────────────────────────────────────────────────────────

    async getStatus(): Promise<SyncStatus> {
        const state = await this.getSyncState();
        const localFiles = this.plugin.app.vault.getFiles();
        const changed: FileStatus[] = [];

        if (!state) {
            for (const file of localFiles) {
                if (!this.shouldIgnore(file.path)) {
                    changed.push({ path: file.path, status: "A" });
                }
            }
            return { changed, conflicted: [], ahead: changed.length, behind: 0 };
        }

        const localPaths = new Set(localFiles.map((f) => f.path));
        const syncTime = state.lastSyncTime;

        for (const file of localFiles) {
            if (this.shouldIgnore(file.path)) continue;
            const knownRemotely = file.path in state.remoteObjectIds;
            if (!knownRemotely) {
                changed.push({ path: file.path, status: "A" });
            } else if (file.stat.mtime > syncTime + 1000) {
                changed.push({ path: file.path, status: "M" });
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

    async pull(): Promise<number> {
        const [remoteTree, latestCommitId, state] = await Promise.all([
            this.getRemoteFileTree(),
            this.getLatestCommitId(),
            this.getSyncState(),
        ]);

        let filesChanged = 0;
        const newRemoteObjectIds: Record<string, string> = {};

        for (const remoteFile of remoteTree) {
            const filePath = remoteFile.path.replace(/^\//, "");
            if (this.shouldIgnore(filePath)) continue;

            newRemoteObjectIds[filePath] = remoteFile.objectId;
            const storedObjectId = state?.remoteObjectIds[filePath];

            if (!state || storedObjectId !== remoteFile.objectId) {
                const buffer = await this.getFileContent(remoteFile.path);
                await this.writeLocalFile(filePath, buffer);
                filesChanged++;
            }
        }

        if (state) {
            for (const path of Object.keys(state.remoteObjectIds)) {
                const stillExists = remoteTree.some((f) => f.path.replace(/^\//, "") === path);
                if (!stillExists) {
                    const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
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
        const normalPath = normalizePath(filePath);
        const parts = normalPath.split("/");
        for (let i = 1; i < parts.length; i++) {
            const dir = parts.slice(0, i).join("/");
            if (dir && !this.plugin.app.vault.getAbstractFileByPath(dir)) {
                await this.plugin.app.vault.createFolder(dir).catch(() => {});
            }
        }
        const existing = this.plugin.app.vault.getAbstractFileByPath(normalPath);
        if (existing instanceof TFile) {
            await this.plugin.app.vault.modifyBinary(existing, buffer);
        } else {
            await this.plugin.app.vault.createBinary(normalPath, buffer);
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

            const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(fileStatus.path));
            if (!(file instanceof TFile)) continue;

            const buffer = await this.plugin.app.vault.readBinary(file);

            if (buffer.byteLength > maxBytes) {
                new Notice(
                    `OnyxAz: Skipping ${file.name} — ${(buffer.byteLength / 1048576).toFixed(1)} MB exceeds the ${this.plugin.settings.maxAttachmentSizeMB} MB limit.`,
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
