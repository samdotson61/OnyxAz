# OnyxAz quick installer (Windows) — copies the plugin into your Obsidian vault.
# No administrator rights required. Launched by install.cmd (double-click).
#
# Hand a user just this script (via install.cmd) and a setup document — it
# downloads the plugin from GitHub itself. If your network blocks GitHub, place
# main.js / manifest.json / styles.css next to install.cmd and it uses those.

$ErrorActionPreference = "Stop"
$files = @("main.js", "manifest.json", "styles.css")
$RepoBase = "https://raw.githubusercontent.com/samdotson61/OnyxAz/master"

function Pause-Exit($code) {
    Read-Host "`nPress Enter to close"
    exit $code
}

Write-Host "=== OnyxAz installer ===`n"

# Prefer local files (offline / IT-bundled) beside this script or one level up;
# otherwise we'll download from GitHub after picking the vault.
$src = $null
foreach ($c in @($PSScriptRoot, (Split-Path $PSScriptRoot -Parent))) {
    if (Test-Path (Join-Path $c "main.js")) { $src = $c; break }
}

# Discover vaults from Obsidian's own config.
$vaults = @()
$cfg = Join-Path $env:APPDATA "obsidian\obsidian.json"
if (Test-Path $cfg) {
    try {
        $json = Get-Content $cfg -Raw | ConvertFrom-Json
        foreach ($v in $json.vaults.PSObject.Properties) {
            if ($v.Value.path -and (Test-Path $v.Value.path)) { $vaults += $v.Value.path }
        }
    } catch { }
}

$vault = $null
if ($vaults.Count -gt 0) {
    Write-Host "Obsidian vaults found on this PC:`n"
    for ($i = 0; $i -lt $vaults.Count; $i++) { Write-Host ("  [{0}] {1}" -f ($i + 1), $vaults[$i]) }
    Write-Host "  [C] Enter a different folder`n"
    $choice = Read-Host "Choose your vault (1-$($vaults.Count), or C)"
    if ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $vaults.Count) {
        $vault = $vaults[[int]$choice - 1]
    }
}
if (-not $vault) {
    $vault = Read-Host "Enter the full path to your Obsidian vault folder"
}
$vault = $vault.Trim().Trim('"')

if (-not (Test-Path $vault)) {
    Write-Host "Folder not found: $vault" -ForegroundColor Red
    Pause-Exit 1
}
if (-not (Test-Path (Join-Path $vault ".obsidian"))) {
    $ans = Read-Host "That folder has no .obsidian subfolder, so it may not be a vault. Continue anyway? (y/N)"
    if ($ans -ne "y") { Pause-Exit 1 }
}

$dest = Join-Path $vault ".obsidian\plugins\onyxaz"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

if ($src) {
    Write-Host "`nInstalling from local files in $src ..."
    foreach ($f in $files) { Copy-Item (Join-Path $src $f) (Join-Path $dest $f) -Force }
} else {
    Write-Host "`nDownloading OnyxAz from GitHub..."
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
    foreach ($f in $files) {
        try {
            Invoke-WebRequest -Uri "$RepoBase/$f" -OutFile (Join-Path $dest $f) -UseBasicParsing
        } catch {
            Write-Host "Could not download $f from GitHub." -ForegroundColor Red
            Write-Host "If your network blocks GitHub, ask IT for the OnyxAz files (main.js, manifest.json,"
            Write-Host "styles.css), put them in the same folder as this installer, and run it again."
            Pause-Exit 1
        }
    }
}

Write-Host "`nDone. OnyxAz installed to:" -ForegroundColor Green
Write-Host "  $dest`n"
Write-Host "Next steps:"
Write-Host "  1. Open Obsidian (restart it if it's already running)."
Write-Host "  2. Settings -> Community plugins -> enable OnyxAz."
Write-Host "  3. On the setup screen: choose SSO, click 'Paste setup document to autofill',"
Write-Host "     paste your organization's setup document, enter your email, and sign in."
Pause-Exit 0
