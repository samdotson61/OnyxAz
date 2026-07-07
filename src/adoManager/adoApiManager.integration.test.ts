// Integration tests: the real sync engine (AdoApiManager) run against a fake
// ADO backend and an in-memory vault. These cover the seams unit tests can't —
// pull/push round-trips, conflict skipping, EOL tolerance, upstream deletions —
// the exact areas where past regressions were found by beta users instead.

import { describe, it, expect, beforeEach } from "vitest";
import { setRequestHandler } from "../testing/obsidianStub";
import { InMemoryAdapter, FakeAdo, makeFakePlugin, type FakePlugin } from "../testing/fakes";
import { AdoApiManager } from "./adoApiManager";
import type { RepoTarget } from "../types";
import type OnyxAz from "../main";

const T: RepoTarget = { project: "Proj", repo: "Repo", branch: "main" };
const FOLDER = "testorg_ADO/Proj/Repo/main/";

let ado: FakeAdo;
let adapter: InMemoryAdapter;
let plugin: FakePlugin;
let mgr: AdoApiManager;

beforeEach(() => {
    ado = new FakeAdo();
    adapter = new InMemoryAdapter();
    plugin = makeFakePlugin(adapter);
    mgr = new AdoApiManager(plugin as unknown as OnyxAz);
    setRequestHandler(ado.handler());
});

// Rewrites the target's stored lastSyncTime into the past, so files written
// "now" register as modified — mirrors real life, where edits happen after the
// pull rather than the test's same-millisecond sequence.
async function backdateSync(ms = 60_000): Promise<void> {
    const p = ".onyxaz/repos/Proj__Repo__main.json";
    const s = JSON.parse(await adapter.read(p)) as { lastSyncTime: number };
    s.lastSyncTime -= ms;
    await adapter.write(p, JSON.stringify(s));
}

describe("pullTarget", () => {
    it("downloads the remote tree and is a no-op on the second pull", async () => {
        ado.files.set("readme.md", "# hello");
        ado.files.set("docs/notes.md", "notes");

        expect(await mgr.pullTarget(T)).toBe(2);
        expect(adapter.getText(FOLDER + "readme.md")).toBe("# hello");
        expect(adapter.getText(FOLDER + "docs/notes.md")).toBe("notes");

        expect(await mgr.pullTarget(T)).toBe(0); // nothing re-downloaded
    });

    it("never overwrites a locally-different file without a resolver, and reports it", async () => {
        ado.files.set("page.md", "remote version");
        await mgr.pullTarget(T);

        adapter.setText(FOLDER + "page.md", "my local edits");
        ado.files.set("page.md", "remote version 2");
        ado.bump();

        let skipped = 0;
        const n = await mgr.pullTarget(T, undefined, undefined, (s) => { skipped += s; });
        expect(n).toBe(0);
        expect(skipped).toBe(1);
        expect(adapter.getText(FOLDER + "page.md")).toBe("my local edits");
    });

    it("treats a CRLF-vs-LF-only difference as identical (no conflict, no download)", async () => {
        ado.files.set("doc.md", "line one\nline two\n");
        await mgr.pullTarget(T);

        // Simulate Windows rewriting line endings locally; remote unchanged.
        adapter.setText(FOLDER + "doc.md", "line one\r\nline two\r\n");
        // Invalidate stored ids so the content comparison actually runs.
        ado.bump();

        let skipped = 0;
        const n = await mgr.pullTarget(T, undefined, undefined, (s) => { skipped += s; });
        expect(n).toBe(0);
        expect(skipped).toBe(0);
        expect(adapter.getText(FOLDER + "doc.md")).toBe("line one\r\nline two\r\n");
    });

    it("removes an unmodified local file whose remote was deleted, keeps a modified one", async () => {
        ado.files.set("stays.md", "keep me");
        ado.files.set("pruned.md", "old page");
        ado.files.set("edited.md", "original");
        await mgr.pullTarget(T);

        adapter.setText(FOLDER + "edited.md", "my local changes");
        ado.files.delete("pruned.md");
        ado.files.delete("edited.md");
        ado.bump();

        await mgr.pullTarget(T);
        expect(adapter.getText(FOLDER + "pruned.md")).toBeNull();       // unmodified → removed
        expect(adapter.getText(FOLDER + "edited.md")).toBe("my local changes"); // modified → kept
        expect(adapter.getText(FOLDER + "stays.md")).toBe("keep me");
    });
});

describe("getTargetStatus", () => {
    it("detects added, modified, and deleted files", async () => {
        ado.files.set("a.md", "alpha");
        ado.files.set("b.md", "beta");
        await mgr.pullTarget(T);
        await backdateSync();

        adapter.setText(FOLDER + "new.md", "brand new");
        adapter.setText(FOLDER + "a.md", "alpha edited");
        await adapter.remove(FOLDER + "b.md");

        const status = await mgr.getTargetStatus(T);
        const byPath = Object.fromEntries(status.map((s) => [s.path, s.status]));
        expect(byPath["new.md"]).toBe("A");
        expect(byPath["a.md"]).toBe("M");
        expect(byPath["b.md"]).toBe("D");
        expect(status).toHaveLength(3);
    });
});

describe("pushTarget", () => {
    it("pushes adds/edits/deletes and leaves a clean status", async () => {
        ado.files.set("a.md", "alpha");
        ado.files.set("b.md", "beta");
        await mgr.pullTarget(T);
        await backdateSync();

        adapter.setText(FOLDER + "a.md", "alpha v2");
        adapter.setText(FOLDER + "new.md", "hello");
        await adapter.remove(FOLDER + "b.md");

        const changes = await mgr.getTargetStatus(T);
        await mgr.pushTarget(T, "test commit", changes);

        expect(ado.files.get("a.md")).toBe("alpha v2");
        expect(ado.files.get("new.md")).toBe("hello");
        expect(ado.files.has("b.md")).toBe(false);
        expect(ado.pushCount).toBe(1);

        expect(await mgr.getTargetStatus(T)).toHaveLength(0); // state refreshed
    });

    it("auto-retries a stale-base push when the remote change doesn't overlap", async () => {
        ado.files.set("mine.md", "v1");
        await mgr.pullTarget(T);
        await backdateSync();

        // Someone else adds an unrelated file → our stored base commit is stale.
        ado.files.set("theirs.md", "their new file");
        ado.bump();

        adapter.setText(FOLDER + "mine.md", "v2");
        const changes = await mgr.getTargetStatus(T);
        await mgr.pushTarget(T, "non-overlapping", changes);

        expect(ado.files.get("mine.md")).toBe("v2");
        expect(ado.files.get("theirs.md")).toBe("their new file");
        expect(ado.pushCount).toBe(1); // succeeded on the retry with the fresh base
    });
});
