#!/usr/bin/env node
// Packages a ready-to-distribute OnyxAz plugin folder for an organization.
//
// It copies the prebuilt plugin files and writes an onyxaz.config.json holding
// the org's connection details, so end-users never build anything — they just
// drop the folder into <vault>/.obsidian/plugins/. Optionally zips the result.
//
// Usage:
//   node scripts/package-org.mjs --org https://dev.azure.com/myorg \
//        --client <client-id> [--tenant <tenant-id|organizations>] \
//        [--name myorg] [--out dist] [--build] [--no-zip]
//
// Missing --org / --client are prompted for interactively.

import fs from "fs";
import path from "path";
import readline from "readline";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
    const out = { tenant: "organizations", out: "dist", zip: true, build: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--build") out.build = true;
        else if (a === "--no-zip") out.zip = false;
        else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
    }
    return out;
}

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

function tryZip(folderPath, zipPath) {
    try {
        if (process.platform === "win32") {
            execSync(
                `powershell -NoProfile -Command "Compress-Archive -Path '${folderPath}' -DestinationPath '${zipPath}' -Force"`,
                { stdio: "ignore" }
            );
        } else {
            execSync(`cd "${path.dirname(folderPath)}" && zip -rq "${path.resolve(zipPath)}" "${path.basename(folderPath)}"`, {
                stdio: "ignore",
                shell: "/bin/bash",
            });
        }
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    let org = args.org || (await ask("Organization URL (https://dev.azure.com/yourorg): "));
    let client = args.client || (await ask("Azure Application (client) ID: "));
    const tenant = args.tenant || "organizations";

    org = (org || "").trim();
    client = (client || "").trim();

    if (!/^https:\/\//i.test(org)) {
        console.error("✖ Organization URL must start with https://");
        process.exit(1);
    }
    if (!GUID_RE.test(client)) {
        console.warn(`⚠ "${client}" doesn't look like a GUID — double-check the client ID.`);
    }

    const name = (args.name || org.replace(/\/+$/, "").split("/").pop() || "org")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-");

    // Ensure the plugin is built.
    const needBuild = args.build || PLUGIN_FILES.some((f) => !fs.existsSync(path.join(ROOT, f)));
    if (needBuild) {
        console.log("• Building plugin (npm run build)…");
        execSync("npm run build", { cwd: ROOT, stdio: "inherit", shell: true });
    }

    // Assemble the distributable folder.
    const outRoot = path.resolve(ROOT, args.out);
    const pluginDir = path.join(outRoot, "onyxaz");
    fs.rmSync(pluginDir, { recursive: true, force: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    for (const f of PLUGIN_FILES) {
        fs.copyFileSync(path.join(ROOT, f), path.join(pluginDir, f));
    }
    const config = { organizationUrl: org, clientId: client, tenantId: tenant };
    fs.writeFileSync(path.join(pluginDir, "onyxaz.config.json"), JSON.stringify(config, null, 2) + "\n");

    console.log(`\n✓ Built distributable plugin folder: ${pluginDir}`);
    console.log(`  organizationUrl: ${org}`);
    console.log(`  clientId:        ${client}`);
    console.log(`  tenantId:        ${tenant}`);

    if (args.zip) {
        const zipPath = path.join(outRoot, `onyxaz-${name}.zip`);
        fs.rmSync(zipPath, { force: true });
        if (tryZip(pluginDir, zipPath)) {
            console.log(`✓ Zipped: ${zipPath}`);
        } else {
            console.log("⚠ Could not create a zip automatically — distribute the folder above as-is.");
        }
    }

    console.log(
        "\nHand the folder (or zip) to your team. They extract it into:\n" +
        "  <their vault>/.obsidian/plugins/\n" +
        "so the path is …/.obsidian/plugins/onyxaz/main.js — then enable OnyxAz in Community plugins.\n" +
        "Sign-in is pre-filled from onyxaz.config.json; users just enter their email."
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
