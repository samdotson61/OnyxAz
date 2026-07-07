// Test doubles for integration-testing the sync engine without Obsidian or a
// real Azure DevOps org: an in-memory vault adapter, a fake ADO REST backend
// (tree/content/commits/pushes), and a plugin factory wiring them together.

import { gitBlobSha1 } from "../util/hash";
import { DEFAULT_SETTINGS } from "../constants";
import type { OnyxAzSettings } from "../types";
import type { StubResponse } from "./obsidianStub";

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── In-memory vault adapter ─────────────────────────────────────────────────

export class InMemoryAdapter {
    files = new Map<string, Uint8Array>();
    mtimes = new Map<string, number>();
    dirs = new Set<string>();

    setText(path: string, content: string, mtime = Date.now()): void {
        this.files.set(path, enc.encode(content));
        this.mtimes.set(path, mtime);
    }
    getText(path: string): string | null {
        const b = this.files.get(path);
        return b ? dec.decode(b) : null;
    }
    setMtime(path: string, mtime: number): void {
        this.mtimes.set(path, mtime);
    }

    async exists(path: string): Promise<boolean> {
        if (this.files.has(path) || this.dirs.has(path)) return true;
        for (const p of this.files.keys()) if (p.startsWith(path + "/")) return true;
        return false;
    }
    async read(path: string): Promise<string> {
        const b = this.files.get(path);
        if (!b) throw new Error(`ENOENT ${path}`);
        return dec.decode(b);
    }
    async write(path: string, data: string): Promise<void> {
        this.setText(path, data);
    }
    async readBinary(path: string): Promise<ArrayBuffer> {
        const b = this.files.get(path);
        if (!b) throw new Error(`ENOENT ${path}`);
        return b.slice().buffer;
    }
    async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
        this.files.set(path, new Uint8Array(data));
        this.mtimes.set(path, Date.now());
    }
    async remove(path: string): Promise<void> {
        this.files.delete(path);
        this.mtimes.delete(path);
    }
    async mkdir(path: string): Promise<void> {
        this.dirs.add(path);
    }
    async stat(path: string): Promise<{ mtime: number } | null> {
        return this.files.has(path) ? { mtime: this.mtimes.get(path) ?? 0 } : null;
    }
    async list(dir: string): Promise<{ files: string[]; folders: string[] }> {
        const files: string[] = [];
        const folders = new Set<string>();
        const prefix = dir ? dir + "/" : "";
        for (const p of this.files.keys()) {
            if (!p.startsWith(prefix)) continue;
            const rest = p.slice(prefix.length);
            const slash = rest.indexOf("/");
            if (slash === -1) files.push(p);
            else folders.add(prefix + rest.slice(0, slash));
        }
        for (const d of this.dirs) {
            if (!d.startsWith(prefix) || d === dir) continue;
            const rest = d.slice(prefix.length);
            const slash = rest.indexOf("/");
            folders.add(prefix + (slash === -1 ? rest : rest.slice(0, slash)));
        }
        return { files, folders: [...folders] };
    }
}

// ── Fake ADO backend ────────────────────────────────────────────────────────
// One git repo: path (no leading slash) -> text content. Serves the REST routes
// the engine uses; pushes mutate the model and advance the commit id.

export class FakeAdo {
    files = new Map<string, string>();
    commitId = "commit-1";
    private counter = 1;
    pushCount = 0;

    bump(): void {
        this.commitId = `commit-${++this.counter}`;
    }

    handler() {
        return async (req: { url: string; method?: string; body?: string }): Promise<StubResponse> => {
            const url = new URL(req.url);

            if (req.method === "POST" && url.pathname.endsWith("/pushes")) {
                const body = JSON.parse(req.body ?? "{}") as {
                    refUpdates: Array<{ oldObjectId: string }>;
                    commits: Array<{ changes: Array<{ changeType: string; item: { path: string }; newContent?: { content: string } }> }>;
                };
                if (body.refUpdates[0].oldObjectId !== this.commitId) {
                    return { status: 409, json: { message: "TF401028: push rejected — not a fast-forward" }, text: "conflict" };
                }
                for (const ch of body.commits[0].changes) {
                    const p = ch.item.path.replace(/^\//, "");
                    if (ch.changeType === "delete") this.files.delete(p);
                    else this.files.set(p, Buffer.from(ch.newContent!.content, "base64").toString("utf8"));
                }
                this.pushCount++;
                this.bump();
                return { status: 201, json: {} };
            }

            if (url.searchParams.get("recursionLevel") === "Full") {
                const value = [];
                for (const [p, content] of this.files) {
                    value.push({ path: `/${p}`, objectId: await gitBlobSha1(enc.encode(content).slice().buffer), isFolder: false });
                }
                return { status: 200, json: { value } };
            }

            const itemPath = url.searchParams.get("path");
            if (itemPath) {
                const content = this.files.get(itemPath.replace(/^\//, ""));
                if (content === undefined) return { status: 404, json: { message: "item not found" }, text: "not found" };
                return { status: 200, arrayBuffer: enc.encode(content).slice().buffer };
            }

            if (url.pathname.includes("/commits")) {
                return { status: 200, json: { value: [{ commitId: this.commitId }] } };
            }

            return { status: 404, json: { message: `unhandled route ${url.pathname}` }, text: "unhandled" };
        };
    }
}

// ── Plugin factory ──────────────────────────────────────────────────────────

export interface FakePlugin {
    settings: OnyxAzSettings;
    app: {
        vault: {
            adapter: InMemoryAdapter;
            getFiles: () => unknown[];
            getAbstractFileByPath: (p: string) => null;
            delete: (f: unknown) => Promise<void>;
        };
        workspace: { trigger: (..._args: unknown[]) => void };
    };
    saveSettings: () => Promise<void>;
    entraAuth: { isSignedIn: boolean; getValidAccessToken: () => Promise<string> };
}

export function makeFakePlugin(adapter: InMemoryAdapter): FakePlugin {
    return {
        settings: {
            ...DEFAULT_SETTINGS,
            organizationUrl: "https://dev.azure.com/testorg",
            authMethod: "pat",
            pat: "test-pat",
            hasCompletedOnboarding: true,
        },
        app: {
            vault: {
                adapter,
                getFiles: () => [],
                getAbstractFileByPath: () => null, // fall back to adapter.remove in deletion paths
                delete: async () => {},
            },
            workspace: { trigger: () => {} },
        },
        saveSettings: async () => {},
        entraAuth: { isSignedIn: false, getValidAccessToken: async () => "tok" },
    };
}
