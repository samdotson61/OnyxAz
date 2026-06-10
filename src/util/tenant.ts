// Extracts the Azure AD tenant ID from an OpenID Connect issuer URL of the form
//   https://login.microsoftonline.com/{tenantId}/v2.0
// Returns null for the generic "common"/"organizations" placeholders or when no
// concrete tenant is present.

export function parseTenantFromIssuer(issuer: string): string | null {
    const match = issuer.match(/login\.microsoftonline\.com\/([^/]+)/);
    const tenantId = match?.[1];
    if (tenantId && tenantId !== "common" && tenantId !== "organizations") {
        return tenantId;
    }
    return null;
}
