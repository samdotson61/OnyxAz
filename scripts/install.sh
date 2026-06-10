#!/usr/bin/env bash
# OnyxAz quick installer (macOS / Linux) — copies the plugin into your Obsidian
# vault. No admin rights required. Run:  bash install.sh   (or ./install.sh)
set -e

FILES=(main.js manifest.json styles.css)

# Locate the plugin files: beside this script (release) or one level up (repo).
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC=""
for c in "$DIR" "$(dirname "$DIR")"; do
    if [ -f "$c/main.js" ]; then SRC="$c"; break; fi
done
if [ -z "$SRC" ]; then
    echo "Could not find main.js next to this script."
    echo "Extract the whole OnyxAz download and run install.sh from inside that folder."
    exit 1
fi

# Try to read vault paths from Obsidian's config (needs python3; optional).
case "$(uname -s)" in
    Darwin) CFG="$HOME/Library/Application Support/obsidian/obsidian.json" ;;
    *)      CFG="$HOME/.config/obsidian/obsidian.json" ;;
esac

VAULT=""
if [ -f "$CFG" ] && command -v python3 >/dev/null 2>&1; then
    mapfile -t VAULTS < <(python3 -c "import json,sys;d=json.load(open('$CFG'));[print(v['path']) for v in d.get('vaults',{}).values() if v.get('path')]" 2>/dev/null || true)
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
for f in "${FILES[@]}"; do cp -f "$SRC/$f" "$DEST/$f"; done

echo
echo "Done. OnyxAz installed to: $DEST"
echo "Next: open Obsidian, enable OnyxAz in Settings -> Community plugins, then follow the setup screen."
