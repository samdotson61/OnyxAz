// Minimal stand-in for the "obsidian" module so the sync engine can run under
// vitest (integration tests against a fake ADO server). Wired up via the alias
// in vitest.config.ts — production builds never touch this file.

export type StubResponse = {
    status: number;
    json?: unknown;
    text?: string;
    arrayBuffer?: ArrayBuffer;
    headers?: Record<string, string>;
};

type Handler = (req: { url: string; method?: string; body?: string }) => Promise<StubResponse>;

let handler: Handler = async () => ({ status: 500, text: "no request handler installed" });

export function setRequestHandler(h: Handler): void {
    handler = h;
}

export async function requestUrl(req: { url: string; method?: string; body?: string; throw?: boolean }): Promise<StubResponse> {
    const resp = await handler(req);
    return { headers: {}, text: "", ...resp };
}

export function normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
}

export class Notice {
    constructor(_msg?: string, _duration?: number) {}
    setMessage(_msg: string): void {}
    hide(): void {}
}

export class TFile {}
export class TFolder {}
export class Modal {}
export class Plugin {}
export class Setting {}
export const moment = (t: number) => ({ fromNow: () => String(t) });
