#!/usr/bin/env bash
# OnyxAz quick installer (macOS / Linux) — copies the plugin into your Obsidian
# vault. No admin rights required. Run:  bash install.sh   (or ./install.sh)
#
# Downloads the plugin from GitHub. If your network blocks GitHub, place
# main.js / manifest.json / styles.css next to this script and it uses those.
# If it finds your org's setup document (.docx/.txt/.json with the org URL and
# client ID) in Downloads/Desktop/etc., it pre-fills the connection.
set -e

FILES=(main.js manifest.json styles.css)
REPO_BASE="https://raw.githubusercontent.com/samdotson61/OnyxAz/master"

ORG=""; CID=""
extract_setup() {
    local f="$1" text=""
    case "$f" in
        *.docx)
            if command -v unzip >/dev/null 2>&1; then
                text="$(unzip -p "$f" word/document.xml 2>/dev/null | sed -e 's/<[^>]*>/ /g')"
            elif command -v python3 >/dev/null 2>&1; then
                text="$(python3 -c "import zipfile,sys,re;print(re.sub(r'<[^>]+>',' ',zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode('utf8','ignore')))" "$f" 2>/dev/null)"
            fi ;;
        *) text="$(cat "$f" 2>/dev/null)" ;;
    esac
    [ -n "$text" ] || return 1
    ORG="$(printf '%s' "$text" | grep -Eo 'https://(dev\.azure\.com/[^[:space:]"<]+|[A-Za-z0-9_-]+\.visualstudio\.com[^[:space:]"<]*)' | head -1 | sed 's/[.,;]*$//')"
    CID="$(printf '%s' "$text" | grep -Eio '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
    [ -n "$ORG" ] && [ -n "$CID" ]
}

# Prefer local files beside this script (or one level up); else download.
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC=""
for c in "$DIR" "$(dirname "$DIR")"; do
    if [ -f "$c/main.js" ]; then SRC="$c"; break; fi
done

# Vault discovery from Obsidian's config (needs python3; optional).
case "$(uname -s)" in
    Darwin) CFG="$HOME/Library/Application Support/obsidian/obsidian.json" ;;
    *)      CFG="$HOME/.config/obsidian/obsidian.json" ;;
esac

VAULT=""
if [ -f "$CFG" ] && command -v python3 >/dev/null 2>&1; then
    mapfile -t VAULTS < <(python3 -c "import json;d=json.load(open('$CFG'));[print(v['path']) for v in d.get('vaults',{}).values() if v.get('path')]" 2>/dev/null || true)
    if [ "${#VAULTS[@]}" -gt 0 ]; then
        echo "Obsidian vaults found:"
        for i in "${!VAULTS[@]}"; do echo "  [$((i+1))] ${VAULTS[$i]}"; done
        echo "  [c] Enter a different folder"
        read -rp "Choose your vault: " choice
        if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#VAULTS[@]}" ]; then
            VAULT="${VAULTS[$((choice-1))]}"
        fi
    fi
fi
[ -n "$VAULT" ] || read -rp "Enter the full path to your Obsidian vault folder: " VAULT

VAULT="${VAULT/#\~/$HOME}"
[ -d "$VAULT" ] || { echo "Folder not found: $VAULT"; exit 1; }
if [ ! -d "$VAULT/.obsidian" ]; then
    read -rp "That folder has no .obsidian subfolder. Continue anyway? (y/N) " ans
    [ "$ans" = "y" ] || exit 1
fi

DEST="$VAULT/.obsidian/plugins/onyxaz"
mkdir -p "$DEST"

if [ -n "$SRC" ]; then
    echo "Installing from local files in $SRC ..."
    for f in "${FILES[@]}"; do cp -f "$SRC/$f" "$DEST/$f"; done
else
    echo "Downloading OnyxAz from GitHub..."
    for f in "${FILES[@]}"; do
        curl -fsSL "$REPO_BASE/$f" -o "$DEST/$f" || {
            echo "Could not download $f. If your network blocks GitHub, put the OnyxAz files next to this script."
            exit 1
        }
    done
fi

# Look for a setup document and pre-fill the connection.
AUTO=""
if [ ! -f "$DEST/data.json" ]; then
    shopt -s nullglob nocaseglob 2>/dev/null || true
    for d in "$DIR" "$PWD" "$HOME/Downloads" "$HOME/Desktop" "$HOME"; do
        [ -d "$d" ] || continue
        for f in "$d"/*onyxaz*setup*.txt "$d"/*onyxaz*setup*.json "$d"/*onyxaz*guide*.docx; do
            [ -f "$f" ] || continue
            if extract_setup "$f"; then
                printf '{\n  "organizationUrl": "%s",\n  "entraClientId": "%s",\n  "authMethod": "entra"\n}\n' "$ORG" "$CID" > "$DEST/data.json"
                echo "Pre-filled your organization details from: $f"
                AUTO=1
                break
            fi
        done
        [ -n "$AUTO" ] && break
    done
fi

echo
echo "Done. OnyxAz installed to: $DEST"
echo "Next: open Obsidian, enable OnyxAz in Settings -> Community plugins."
if [ -n "$AUTO" ]; then
    echo "Then choose SSO, enter your work email, and sign in (org details are pre-filled)."
else
    echo "Then choose SSO, paste your setup document, enter your email, and sign in."
fi
