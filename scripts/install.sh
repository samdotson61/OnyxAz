#!/usr/bin/env bash
# OnyxAz quick installer (macOS / Linux) — copies the plugin into your Obsidian
# vault. No admin rights required. Run:  bash install.sh   (or ./install.sh)
#
# Downloads the plugin from GitHub. If your network blocks GitHub, place
# main.js / manifest.json / styles.css next to this script and it uses those.
set -e

FILES=(main.js manifest.json styles.css)
REPO_BASE="https://raw.githubusercontent.com/samdotson61/OnyxAz/master"

# Prefer local files beside this script (or one level up); else download.
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC=""
for c in "$DIR" "$(dirname "$DIR")"; do
    if [ -f "$c/main.js" ]; then SRC="$c"; break; fi
done

# Try to read vault paths from Obsidian's config (needs python3; optional).
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
if [ -z "$VAULT" ]; then
    read -rp "Enter the full path to your Obsidian vault folder: " VAULT
fi

VAULT="${VAULT/#\~/$HOME}"
if [ ! -d "$VAULT" ]; then echo "Folder not found: $VAULT"; exit 1; fi
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
        if ! curl -fsSL "$REPO_BASE/$f" -o "$DEST/$f"; then
            echo "Could not download $f from GitHub."
            echo "If your network blocks GitHub, ask IT for the OnyxAz files and put them next to this script."
            exit 1
        fi
    done
fi

echo
echo "Done. OnyxAz installed to: $DEST"
echo "Next: open Obsidian, enable OnyxAz in Settings -> Community plugins, choose SSO,"
echo "paste your setup document, enter your email, and sign in."
