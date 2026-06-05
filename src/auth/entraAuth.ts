import {
    ENTRA_DEVICE_CODE_URL,
    ENTRA_SCOPE,
    ENTRA_TOKEN_URL,
    ONYX_AZ_DEFAULT_CLIENT_ID,
    ONYX_AZ_DEFAULT_TENANT_ID,
} from "../constants";
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

    // ── Resolved helpers (settings fall back to compiled-in defaults) ─────────

    private get clientId(): string {
        return this.plugin.settings.entraClientId || ONYX_AZ_DEFAULT_CLIENT_ID;
    }

    private get tenantId(): string {
        return this.plugin.settings.entraTenantId || ONYX_AZ_DEFAULT_TENANT_ID;
    }

    // ── Sign-in flow ──────────────────────────────────────────────────────────

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

        const resp = await fetch(ENTRA_DEVICE_CODE_URL(this.tenantId), {
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

            const resp = await fetch(ENTRA_TOKEN_URL(this.tenantId), {
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

        const resp = await fetch(ENTRA_TOKEN_URL(this.tenantId), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        if (!resp.ok) {
            s.entraAccessToken = "";
            s.entraRefreshToken = "";
            s.entraTokenExpiry = 0;
            await this.plugin.saveSettings();
            throw new Error("Token refresh failed. Please sign in again via Settings → OnyxAz.");
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
        s.entraTokenExpiry = Date.now() + token.expires_in * 1000 - 60_000;
        await this.plugin.saveSettings();
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
