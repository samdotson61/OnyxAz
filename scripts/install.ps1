# OnyxAz quick installer (Windows) — copies the plugin into your Obsidian vault.
# No administrator rights required. Launched by install.cmd (double-click).
#
# Hand a user just this script (via install.cmd) and a setup document — it
# downloads the plugin from GitHub itself. If your network blocks GitHub, place
# main.js / manifest.json / styles.css next to install.cmd and it uses those.
#
# If it finds your org's setup document (a .docx/.txt/.json with the org URL and
# client ID) in Downloads/Desktop/etc., it pre-fills the connection so you only
# need to enter your email on the sign-in screen.

$ErrorActionPreference = "Stop"
$files = @("main.js", "manifest.json", "styles.css")
$RepoBase = "https://raw.githubusercontent.com/samdotson61/OnyxAz/master"

function Pause-Exit($code) {
    Read-Host "`nPress Enter to close"
    exit $code
}

# Pulls { Org; Client } out of a setup file (.docx, .txt, or .json).
function Get-SetupFromFile($path) {
    try {
        $text = ""
        if ($path -match '\.docx$') {
            Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
            $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
            try {
                $entry = $zip.Entries | Where-Object { $_.FullName -eq "word/document.xml" }
                if ($entry) {
                    $sr = New-Object System.IO.StreamReader($entry.Open())
                    $text = [regex]::Replace($sr.ReadToEnd(), "<[^>]+>", " ")
                    $sr.Close()
                }
            } finally { $zip.Dispose() }
        } else {
            $text = Get-Content -Raw -LiteralPath $path
        }
        if (-not $text) { return $null }
        $org = [regex]::Match($text, 'https://(?:dev\.azure\.com/[^\s"<]+|[\w\-]+\.visualstudio\.com[^\s"<]*)').Value
        $cid = [regex]::Match($text, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}').Value
        if ($org -and $cid) { return @{ Org = $org.TrimEnd('.', ',', ';'); Client = $cid } }
    } catch { }
    return $null
}

Write-Host "=== OnyxAz installer ===`n"

# Prefer local plugin files (offline / IT-bundled); else download from GitHub.
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
$isNew = $false

Write-Host "Where should OnyxAz be installed?`n"
for ($i = 0; $i -lt $vaults.Count; $i++) { Write-Host ("  [{0}] {1}" -f ($i + 1), $vaults[$i]) }
Write-Host "  [N] Create a NEW vault (choose a folder for it)"
Write-Host "  [O] Use another existing folder`n"
$choice = (Read-Host "Choose").Trim()

if ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $vaults.Count) {
    $vault = $vaults[[int]$choice - 1]
} elseif ($choice -match '^[Nn]') {
    $vault = Read-Host "Enter the full path for the new vault folder (it will be created)"
    $isNew = $true
} else {
    $vault = Read-Host "Enter the full path to the vault folder"
}
$vault = ("" + $vault).Trim().Trim('"')
if (-not $vault) { Write-Host "No folder given." -ForegroundColor Red; Pause-Exit 1 }

if (-not (Test-Path $vault)) {
    if (-not $isNew) {
        $mk = Read-Host "That folder doesn't exist. Create it as a new vault? (Y/n)"
        if ($mk -match '^[Nn]') { Pause-Exit 1 }
        $isNew = $true
    }
    New-Item -ItemType Directory -Force -Path $vault | Out-Null
    Write-Host "Created new vault folder: $vault" -ForegroundColor Green
} elseif (-not $isNew -and -not (Test-Path (Join-Path $vault ".obsidian"))) {
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

# Look for a setup document on this machine and pre-fill the connection.
$autoFilled = $false
$dataPath = Join-Path $dest "data.json"
if (-not (Test-Path $dataPath)) {
    $searchDirs = @(
        $PSScriptRoot, (Get-Location).Path,
        (Join-Path $env:USERPROFILE "Downloads"), (Join-Path $env:USERPROFILE "Desktop"), $env:USERPROFILE
    )
    if ($env:OneDrive) { $searchDirs += (Join-Path $env:OneDrive "Downloads"); $searchDirs += (Join-Path $env:OneDrive "Desktop") }
    $patterns = @("*OnyxAz*Setup*.txt", "*OnyxAz*Setup*.json", "*OnyxAz*Guide*.docx", "*onyxaz*setup*.json")

    foreach ($d in ($searchDirs | Select-Object -Unique)) {
        if (-not (Test-Path $d)) { continue }
        foreach ($p in $patterns) {
            $hit = Get-ChildItem -LiteralPath $d -Filter $p -File -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($hit) {
                $s = Get-SetupFromFile $hit.FullName
                if ($s) {
                    @{ organizationUrl = $s.Org; entraClientId = $s.Client; authMethod = "entra" } |
                        ConvertTo-Json | Set-Content -LiteralPath $dataPath -Encoding UTF8
                    Write-Host "`nPre-filled your organization details from:" -ForegroundColor Green
                    Write-Host "  $($hit.FullName)"
                    $autoFilled = $true
                    break
                }
            }
        }
        if ($autoFilled) { break }
    }
}

Write-Host "`nDone. OnyxAz installed to:" -ForegroundColor Green
Write-Host "  $dest`n"
Write-Host "Next steps:"
if ($isNew) {
    Write-Host "  1. In Obsidian, click the vault switcher (bottom-left) -> Open folder as vault"
    Write-Host "     -> select:  $vault"
    Write-Host "  2. Settings -> Community plugins -> turn off Restricted mode -> enable OnyxAz."
} else {
    Write-Host "  1. Open Obsidian (restart it if it's already running)."
    Write-Host "  2. Settings -> Community plugins -> enable OnyxAz."
}
if ($autoFilled) {
    Write-Host "  3. On the setup screen: choose SSO, enter your work email, and sign in."
    Write-Host "     (Your organization URL and client ID are already filled in.)"
} else {
    Write-Host "  3. On the setup screen: choose SSO, click 'Paste setup document to autofill',"
    Write-Host "     paste your organization's setup document, enter your email, and sign in."
}
Pause-Exit 0
