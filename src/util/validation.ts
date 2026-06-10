// Validates an Azure DevOps organization URL. The bearer token / PAT is attached
// to every request sent to this host, so a malicious or mistyped URL could leak
// credentials to an attacker-controlled server. We hard-block non-https URLs and
// warn (but allow) hosts that aren't recognized Azure DevOps endpoints — the
// latter supports on-prem Azure DevOps Server without locking legitimate users out.

export interface OrgUrlCheck {
    ok: boolean;
    error?: string;
    warning?: string;
}

const ADO_HOSTS: RegExp[] = [
    /^dev\.azure\.com$/i,
    /\.visualstudio\.com$/i,
];

export function validateOrgUrl(raw: string): OrgUrlCheck {
    const url = (raw ?? "").trim();
    if (!url) return { ok: false, error: "Enter your Azure DevOps organization URL." };

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, error: "That doesn't look like a valid URL (e.g. https://dev.azure.com/myorg)." };
    }

    if (parsed.protocol !== "https:") {
        return {
            ok: false,
            error: "Organization URL must use https:// — your access token is sent to this host.",
        };
    }

    const known = ADO_HOSTS.some((re) => re.test(parsed.hostname));
    if (!known) {
        return {
            ok: true,
            warning:
                `"${parsed.hostname}" isn't a recognized Azure DevOps host ` +
                `(dev.azure.com or *.visualstudio.com). Your access token will be sent there — ` +
                `only continue if you trust it (e.g. an on-prem Azure DevOps Server).`,
        };
    }

    return { ok: true };
}
