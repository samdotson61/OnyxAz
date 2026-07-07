// PKCE (RFC 7636) helpers for the interactive authorization-code sign-in.
// The verifier is a high-entropy random string kept locally; the challenge
// (its SHA-256, base64url) goes in the authorize URL. Entra later verifies the
// code exchange came from the same client that started the sign-in.

export function base64UrlEncode(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomUrlSafe(byteLength = 32): string {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}

// challenge = BASE64URL(SHA256(ASCII(verifier)))
export async function pkceChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64UrlEncode(new Uint8Array(digest));
}

export interface AuthorizeUrlParams {
    tenant: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    state: string;
    challenge: string;
}

export function buildAuthorizeUrl(p: AuthorizeUrlParams): string {
    const q = new URLSearchParams({
        client_id: p.clientId,
        response_type: "code",
        redirect_uri: p.redirectUri,
        response_mode: "query",
        scope: p.scope,
        state: p.state,
        code_challenge: p.challenge,
        code_challenge_method: "S256",
    });
    return `https://login.microsoftonline.com/${encodeURIComponent(p.tenant)}/oauth2/v2.0/authorize?${q.toString()}`;
}
