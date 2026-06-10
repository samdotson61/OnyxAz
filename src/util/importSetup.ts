// Extracts OnyxAz connection details from pasted text. Accepts either a JSON
// blob (any reasonable key spelling) or free-form text like an IT setup document,
// pulling out the organization URL, Azure application (client) ID, and tenant ID.

export interface ImportedSetup {
    organizationUrl?: string;
    clientId?: string;
    tenantId?: string;
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const GUID_G = new RegExp(GUID.source, "gi");
const ADO_URL = /https:\/\/(?:dev\.azure\.com\/[^\s"'),]+|[\w-]+\.visualstudio\.com[^\s"'),]*)/i;

export function parseSetupText(input: string): ImportedSetup {
    const text = (input ?? "").trim();
    if (!text) return {};

    // 1. Try strict JSON first (e.g. an onyxaz.config.json blob)
    const fromJson = tryParseJson(text);
    if (fromJson) return fromJson;

    // 2. Fall back to scraping free-form text (a setup doc, an email, etc.)
    const result: ImportedSetup = {};

    const url = text.match(ADO_URL);
    if (url) result.organizationUrl = url[0].replace(/[.,;]+$/, "");

    // Classify each GUID by the words immediately preceding it.
    let m: RegExpExecArray | null;
    GUID_G.lastIndex = 0;
    while ((m = GUID_G.exec(text)) !== null) {
        const ctx = text.slice(Math.max(0, m.index - 48), m.index).toLowerCase();
        if (/tenant|directory/.test(ctx)) {
            result.tenantId ??= m[0];
        } else if (/client|application|\bapp\b/.test(ctx)) {
            result.clientId ??= m[0];
        } else {
            // Unlabelled GUID — assume client ID if we don't have one yet.
            result.clientId ??= m[0];
        }
    }

    return result;
}

function tryParseJson(text: string): ImportedSetup | null {
    let obj: unknown;
    try {
        obj = JSON.parse(text);
    } catch {
        return null;
    }
    if (!obj || typeof obj !== "object") return null;

    const norm = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === "string") map.set(norm(k), v.trim());
    }

    const pick = (...keys: string[]): string | undefined => {
        for (const k of keys) {
            const v = map.get(k);
            if (v) return v;
        }
        return undefined;
    };

    const result: ImportedSetup = {};
    const org = pick("organizationurl", "orgurl", "organization", "devopsurl", "url");
    const client = pick("clientid", "applicationclientid", "applicationid", "appid", "client");
    const tenant = pick("tenantid", "directoryid", "directorytenantid", "tenant", "directory");
    if (org) result.organizationUrl = org;
    if (client) result.clientId = client;
    if (tenant) result.tenantId = tenant;
    return result;
}
