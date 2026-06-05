import { ENTRA_DEVICE_CODE_URL, ENTRA_SCOPE, ENTRA_TOKEN_URL } from "../constants";
import type OnyxAz from "../main";

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

    // ── Sign-in flow ──────────────────────────────────────────────────────────

    async startDeviceCodeFlow(): Promise<DeviceCodeResponse> {
        const { entraClientId, entraTenantId } = this.plugin.settings;
        if (!entraClientId) {
            throw new Error("Azure App Client ID is required. Enter it in OnyxAz settings.");
        }

        const body = new URLSearchParams({
            client_id: entraClientId,
            scope: ENTRA_SCOPE,
        });

        const resp = await fetch(ENTRA_DEVICE_CODE_URL(entraTenantId || "organizations"), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => resp.statusText);
            throw new Error(`Device code request failed: ${text}`);
        }

        return resp.json() as Promise<DeviceCodeResponse>;
    }

    async pollForToken(dcr: DeviceCodeResponse): Promise<void> {
        const { entraClientId, entraTenantId } = this.plugin.settings;
        this.polling = true;

        const expiresAt = Date.now() + dcr.expires_in * 1000;
        // ADO's minimum poll interval is 5s; respect what the server says
        const intervalMs = Math.max((dcr.interval ?? 5) * 1000, 5000);

        while (this.polling && Date.now() < expiresAt) {
            await sleep(intervalMs);
            if (!this.polling) break;

            const body = new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                client_id: entraClientId,
                device_code: dcr.device_code,
            });

            const resp = await fetch(ENTRA_TOKEN_URL(entraTenantId || "organizations"), {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString(),
            });

            const data = (await resp.json()) as TokenResponse;

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
            throw new Error("Not signed in. Use 'Sign in with Microsoft' in OnyxAz settings.");
        }
        if (Date.now() < s.entraTokenExpiry) {
            return s.entraAccessToken;
        }
        if (!s.entraRefreshToken) {
            throw new Error("Session expired. Please sign in again via OnyxAz settings.");
        }
        return this.refreshAccessToken();
    }

    private async refreshAccessToken(): Promise<string> {
        const s = this.plugin.settings;
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            client_id: s.entraClientId,
            refresh_token: s.entraRefreshToken,
            scope: ENTRA_SCOPE,
        });

        const resp = await fetch(ENTRA_TOKEN_URL(s.entraTenantId || "organizations"), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        if (!resp.ok) {
            // Wipe tokens so the user is prompted to sign in again
            s.entraAccessToken = "";
            s.entraRefreshToken = "";
            s.entraTokenExpiry = 0;
            await this.plugin.saveSettings();
            throw new Error("Token refresh failed. Please sign in again.");
        }

        const data = (await resp.json()) as TokenResponse;
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
        // Subtract 60s to refresh slightly before actual expiry
        s.entraTokenExpiry = Date.now() + token.expires_in * 1000 - 60_000;
        await this.plugin.saveSettings();
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
