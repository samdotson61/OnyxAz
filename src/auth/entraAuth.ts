import { requestUrl } from "obsidian";
import type { Server, IncomingMessage, ServerResponse } from "http";
import {
    ENTRA_DEVICE_CODE_URL,
    ENTRA_SCOPE,
    ENTRA_TOKEN_URL,
    ONYX_AZ_DEFAULT_CLIENT_ID,
    ONYX_AZ_DEFAULT_TENANT_ID,
} from "../constants";
import type OnyxAz from "../main";
import { parseTenantFromIssuer } from "../util/tenant";
import { buildAuthorizeUrl, pkceChallenge, randomUrlSafe } from "../util/pkce";

export interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
    message: string;
}

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    error?: string;
    error_description?: string;
}

export class EntraAuth {
    private polling = false;

    constructor(private readonly plugin: OnyxAz) {}

    // ── Resolved helpers (settings fall back to compiled-in defaults) ─────────

    private get clientId(): string {
        return this.plugin.settings.entraClientId || ONYX_AZ_DEFAULT_CLIENT_ID;
    }

    private get tenantId(): string {
        return this.plugin.settings.entraTenantId || ONYX_AZ_DEFAULT_TENANT_ID;
    }

    // ── Tenant discovery ──────────────────────────────────────────────────────

    // Given a work email address, discover the Azure AD tenant ID for that
    // domain via Microsoft's OpenID Connect discovery endpoint.
    // Falls back to "organizations" (accepts any work/school account) if the
    // domain can't be resolved.
    async discoverTenantFromEmail(email: string): Promise<string> {
        const domain = email.split("@")[1]?.trim().toLowerCase();
        if (!domain) throw new Error("Enter a valid work email address.");

        try {
            const resp = await requestUrl({
                url: `https://login.microsoftonline.com/${domain}/v2.0/.well-known/openid-configuration`,
                method: "GET",
                throw: false,
            });
            if (resp.status === 200) {
                // issuer format: "https://login.microsoftonline.com/{tenantId}/v2.0"
                const tenantId = parseTenantFromIssuer(resp.json?.issuer ?? "");
                if (tenantId) return tenantId;
            }
        } catch { /* fall through */ }

        return "organizations"; // works for any work/school account
    }

    // ── Interactive sign-in (authorization code + PKCE, system browser) ───────
    // Opens the user's default browser for sign-in and catches the redirect on a
    // local loopback listener. Because the sign-in happens in the real browser
    // (with the Windows SSO broker / PRT), device-based Conditional Access
    // policies — "require compliant/managed device" — are satisfied on managed
    // machines, which the device-code flow structurally cannot do (AADSTS530033).
    // Requires the app registration to list http://localhost as a redirect URI
    // under "Mobile and desktop applications". Falls back to device code via the
    // separate startDeviceCodeFlow/pollForToken path.

    private interactiveServer: Server | null = null;
    private interactiveCancel: (() => void) | null = null;
    private interactiveRedirectUri = "";

    async signInInteractive(): Promise<void> {
        if (!this.clientId) {
            throw new Error(
                "No Azure App Client ID configured. Enter it in Settings → OnyxAz, or import your setup document."
            );
        }
        this.cancelInteractive(); // only one attempt at a time

        const verifier = randomUrlSafe(32);
        const state = randomUrlSafe(16);
        const challenge = await pkceChallenge(verifier);

        // Loopback listener on an ephemeral port. Entra treats http://localhost
        // redirect URIs as port-agnostic (RFC 8252), so any port works as long as
        // http://localhost is registered on the app.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const http = require("http") as typeof import("http");

        const code = await new Promise<string>((resolve, reject) => {
            let settled = false;
            const done = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.interactiveCancel = null;
                const srv = this.interactiveServer;
                this.interactiveServer = null;
                try { srv?.close(); } catch { /* ignore */ }
                fn();
            };

            const timer = setTimeout(
                () => done(() => reject(new Error("Sign-in timed out — no response from the browser after 5 minutes."))),
                5 * 60 * 1000
            );
            this.interactiveCancel = () => done(() => reject(new Error("Sign-in cancelled.")));

            const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
                const url = new URL(req.url ?? "/", "http://localhost");
                const finish = (body: string) => {
                    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(`<!doctype html><body style="font-family:system-ui;padding:2rem"><h3>OnyxAz</h3><p>${body}</p></body>`);
                };
                const err = url.searchParams.get("error");
                if (err) {
                    finish("Sign-in failed — you can close this tab and return to Obsidian.");
                    done(() => reject(new Error(url.searchParams.get("error_description") ?? err)));
                    return;
                }
                const gotCode = url.searchParams.get("code");
                if (!gotCode) { finish("Waiting for sign-in…"); return; } // favicon etc.
                if (url.searchParams.get("state") !== state) {
                    finish("Sign-in failed (state mismatch) — you can close this tab.");
                    done(() => reject(new Error("State mismatch in sign-in response — try again.")));
                    return;
                }
                finish("✅ Signed in — you can close this tab and return to Obsidian.");
                done(() => resolve(gotCode));
            });
            this.interactiveServer = server;
            server.on("error", (e: Error) => done(() => reject(new Error(`Couldn't start the local sign-in listener: ${e.message}`))));
            server.listen(0, "127.0.0.1", () => {
                const addr = server.address();
                if (!addr || typeof addr === "string") {
                    done(() => reject(new Error("Couldn't determine the local sign-in port.")));
                    return;
                }
                const redirectUri = `http://localhost:${addr.port}/`;
                const authorizeUrl = buildAuthorizeUrl({
                    tenant: this.tenantId,
                    clientId: this.clientId,
                    redirectUri,
                    scope: ENTRA_SCOPE,
                    state,
                    challenge,
                });
                this.interactiveRedirectUri = redirectUri;
                window.open(authorizeUrl); // Obsidian routes this to the system browser
            });
        });

        // Exchange the code for tokens (public client — PKCE verifier, no secret).
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: this.clientId,
            code,
            redirect_uri: this.interactiveRedirectUri,
            code_verifier: verifier,
            scope: ENTRA_SCOPE,
        });
        const resp = await requestUrl({
            url: ENTRA_TOKEN_URL(this.tenantId),
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
            throw: false,
        });
        const data = resp.json as TokenResponse;
        if (resp.status >= 400 || data.error || !data.access_token) {
            throw new Error(data.error_description ?? data.error ?? `Token exchange failed (HTTP ${resp.status}).`);
        }
        await this.storeToken(data);
    }

    cancelInteractive(): void {
        this.interactiveCancel?.();
    }

    // ── Device-code sign-in (fallback) ────────────────────────────────────────
    // Kept for machines where the browser hand-off can't work. Note: device code
    // sign-ins carry no device identity, so tenants enforcing device-based
    // Conditional Access will block them (AADSTS530033) — use the interactive
    // flow or a PAT there.

    async startDeviceCodeFlow(): Promise<DeviceCodeResponse> {
        if (!this.clientId) {
            throw new Error(
                "No Azure App Client ID configured. " +
                "Ask your admin to set ONYX_AZ_DEFAULT_CLIENT_ID in the plugin, " +
                "or enter your own Client ID in Settings → OnyxAz → Advanced."
            );
        }

        const body = new URLSearchParams({
            client_id: this.clientId,
            scope: ENTRA_SCOPE,
        });

        const resp = await requestUrl({
            url: ENTRA_DEVICE_CODE_URL(this.tenantId),
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
            throw: false,
        });

        if (resp.status >= 400) {
            throw new Error(`Device code request failed: ${resp.text}`);
        }

        return resp.json as DeviceCodeResponse;
    }

    async pollForToken(dcr: DeviceCodeResponse): Promise<void> {
        this.polling = true;
        const expiresAt = Date.now() + dcr.expires_in * 1000;
        const intervalMs = Math.max((dcr.interval ?? 5) * 1000, 5000);

        while (this.polling && Date.now() < expiresAt) {
            await sleep(intervalMs);
            if (!this.polling) break;

            const body = new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                client_id: this.clientId,
                device_code: dcr.device_code,
            });

            const resp = await requestUrl({
                url: ENTRA_TOKEN_URL(this.tenantId),
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString(),
                throw: false,
            });

            const data = resp.json as TokenResponse;

            if (data.error === "authorization_pending") {
                continue;
            } else if (data.error === "slow_down") {
                await sleep(intervalMs);
                continue;
            } else if (data.error) {
                this.polling = false;
                throw new Error(data.error_description ?? data.error);
            } else if (data.access_token) {
                this.polling = false;
                await this.storeToken(data);
                return;
            }
        }

        this.polling = false;
        throw new Error("Sign-in timed out or was cancelled.");
    }

    cancelPoll(): void {
        this.polling = false;
    }

    // ── Token management ──────────────────────────────────────────────────────

    async getValidAccessToken(): Promise<string> {
        const s = this.plugin.settings;
        if (!s.entraAccessToken) {
            throw new Error(
                "Not signed in. Open Settings → OnyxAz and click 'Sign in with Microsoft'."
            );
        }
        if (Date.now() < s.entraTokenExpiry) {
            return s.entraAccessToken;
        }
        if (!s.entraRefreshToken) {
            throw new Error("Session expired. Please sign in again via Settings → OnyxAz.");
        }
        return this.refreshAccessToken();
    }

    private async refreshAccessToken(): Promise<string> {
        const s = this.plugin.settings;
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            client_id: this.clientId,
            refresh_token: s.entraRefreshToken,
            scope: ENTRA_SCOPE,
        });

        const resp = await requestUrl({
            url: ENTRA_TOKEN_URL(this.tenantId),
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
            throw: false,
        });

        if (resp.status >= 400) {
            s.entraAccessToken = "";
            s.entraRefreshToken = "";
            s.entraTokenExpiry = 0;
            await this.plugin.saveSettings();
            throw new Error("Token refresh failed. Please sign in again via Settings → OnyxAz.");
        }

        const data = resp.json as TokenResponse;
        await this.storeToken(data);
        return data.access_token;
    }

    async signOut(): Promise<void> {
        const s = this.plugin.settings;
        s.entraAccessToken = "";
        s.entraRefreshToken = "";
        s.entraTokenExpiry = 0;
        await this.plugin.saveSettings();
    }

    get isSignedIn(): boolean {
        return !!this.plugin.settings.entraAccessToken;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async storeToken(token: TokenResponse): Promise<void> {
        const s = this.plugin.settings;
        s.entraAccessToken = token.access_token;
        if (token.refresh_token) s.entraRefreshToken = token.refresh_token;
        s.entraTokenExpiry = Date.now() + token.expires_in * 1000 - 60_000;
        await this.plugin.saveSettings();
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
