// Publishes a GitHub Release for an existing tag and attaches the Obsidian
// plugin assets (main.js, manifest.json, styles.css) — the layout BRAT and the
// community-plugin install flow expect.
//
// Auto-update in OnyxAz pulls from raw `master`, so Releases are NOT required for
// the internal beta; this is for BRAT / community distribution and versioned
// rollback.
//
// Usage:
//   GH_TOKEN=<pat-with-repo-scope> node scripts/publish-release.mjs <version> [--draft]
//   e.g.  GH_TOKEN=ghp_xxx node scripts/publish-release.mjs 0.10.0
//
// The <version> must already be a pushed tag (we tag on every release). Notes are
// taken from the tag's annotation message. Re-running for an existing release
// updates its assets (delete + re-upload).

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename } from "node:path";

const REPO = "samdotson61/OnyxAz";
const ASSETS = ["main.js", "manifest.json", "styles.css"];
const API = "https://api.github.com";

const version = process.argv[2];
const draft = process.argv.includes("--draft");
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

function die(msg) { console.error(`error: ${msg}`); process.exit(1); }

if (!version) die("missing <version> (e.g. 0.10.0)");
if (!token) die("set GH_TOKEN (or GITHUB_TOKEN) to a PAT with 'repo' scope");

const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
};

async function gh(path, init = {}) {
    const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) die(`${init.method || "GET"} ${path} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
}

// Tag annotation message → release body.
let notes = "";
try {
    notes = execSync(`git tag -l --format='%(contents)' ${version}`, { encoding: "utf8" }).trim();
} catch { /* fall back to empty */ }

// Find or create the release for this tag.
let release = await fetch(`${API}/repos/${REPO}/releases/tags/${version}`, { headers })
    .then((r) => (r.ok ? r.json() : null));

if (!release) {
    console.log(`Creating release ${version}…`);
    release = await gh(`/repos/${REPO}/releases`, {
        method: "POST",
        body: JSON.stringify({
            tag_name: version,
            name: version,
            body: notes || `OnyxAz ${version}`,
            draft,
            prerelease: false,
        }),
    });
} else {
    console.log(`Release ${version} exists — refreshing assets…`);
}

// Replace any existing assets of the same name, then upload fresh.
for (const existing of release.assets || []) {
    if (ASSETS.includes(existing.name)) {
        await gh(`/repos/${REPO}/releases/assets/${existing.id}`, { method: "DELETE" });
    }
}

const uploadBase = release.upload_url.replace(/\{.*\}$/, "");
for (const file of ASSETS) {
    const data = readFileSync(file);
    const type = file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "application/javascript";
    console.log(`Uploading ${file} (${data.length} bytes)…`);
    const res = await fetch(`${uploadBase}?name=${encodeURIComponent(basename(file))}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": type },
        body: data,
    });
    if (!res.ok) die(`upload ${file} → ${res.status} ${await res.text()}`);
}

console.log(`\nDone: ${release.html_url}`);
