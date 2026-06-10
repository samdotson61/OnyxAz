import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

// ── Organization-specific config (never committed) ───────────────────────────
// Maintainers deploying internally can drop an `onyxaz.local.json` next to this
// file with their Azure app details so end-users get one-click SSO:
//   { "clientId": "xxxxxxxx-...", "tenantId": "organizations" }
// The file is gitignored, so the baked-in ID ships only in the local main.js
// build — the tracked source stays generic and reveals nothing about the org.
let local = {};
try {
    local = JSON.parse(fs.readFileSync("onyxaz.local.json", "utf8"));
    if (local.clientId) console.log(`[onyxaz] Baking in client ID from onyxaz.local.json`);
} catch {
    /* no local config — build a generic plugin (users enter their own / use PAT) */
}

const context = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    define: {
        "process.env.ONYXAZ_DEFAULT_CLIENT_ID": JSON.stringify(local.clientId ?? ""),
        "process.env.ONYXAZ_DEFAULT_TENANT_ID": JSON.stringify(local.tenantId ?? "organizations"),
    },
    external: [
        "obsidian",
        "electron",
        "@codemirror/autocomplete",
        "@codemirror/collab",
        "@codemirror/commands",
        "@codemirror/language",
        "@codemirror/lint",
        "@codemirror/search",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/common",
        "@lezer/highlight",
        "@lezer/lr",
        ...builtins,
    ],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
    minify: prod,
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}
