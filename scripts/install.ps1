# OnyxAz quick installer (Windows) — copies the plugin into your Obsidian vault.
# No administrator rights required. Launched by install.cmd (double-click).

$ErrorActionPreference = "Stop"
$files = @("main.js", "manifest.json", "styles.css")

function Pause-Exit($code) {
    Read-Host "`nPress Enter to close"
    exit $code
}

Write-Host "=== OnyxAz installer ===`n"

# Locate the plugin files: beside this script (release zip) or one level up (repo).
$src = $null
foreach ($c in @($PSScriptRoot, (Split-Path $PSScriptRoot -Parent))) {
    if (Test-Path (Join-Path $c "main.js")) { $src = $c; break }
}
if (-not $src) {
    Write-Host "Could not find main.js next to this script." -ForegroundColor Red
    Write-Host "Extract the whole OnyxAz download and run install.cmd from inside that folder."
    Pause-Exit 1
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
foreach ($f in $files) { Copy-Item (Join-Path $src $f) (Join-Path $dest $f) -Force }

Write-Host "`nDone. OnyxAz installed to:" -ForegroundColor Green
Write-Host "  $dest`n"
Write-Host "Next steps:"
Write-Host "  1. Open Obsidian (restart it if it's already running)."
Write-Host "  2. Settings -> Community plugins -> enable OnyxAz."
Write-Host "  3. Follow the setup screen: choose SSO, paste your setup document, sign in."
Pause-Exit 0
