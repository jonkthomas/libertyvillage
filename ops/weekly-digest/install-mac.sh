#!/usr/bin/env bash
# Install/update the LV weekly digest LaunchAgent on this Mac (the one hosting
# the spec-deck tailnet server). Idempotent. Run from the repo:
#   bash ops/weekly-digest/install-mac.sh
#
# launchd cannot read ~/Desktop (TCC) and has no shell profile, so the job
# runs from a stable copy in ~/.local/share/lv-weekly-digest with the keys it
# needs in digest.env (0600, synced from the pi tool vault, never printed).
set -euo pipefail

PLIST_LABEL=com.jonkthomas.lv-weekly-digest
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.local/share/lv-weekly-digest"
VAULT="$HOME/Desktop/important-coding-projects/claude-config/secrets/pi-tool-vault.env"
PLIST_SRC="$SRC_DIR/$PLIST_LABEL.plist"
NODE_BIN="$HOME/.hermes/node/bin/node"

[ -x "$NODE_BIN" ] || { echo "FATAL: node not found at $NODE_BIN" >&2; exit 1; }

# 1. Stable, launchd-readable copy of the digest code (source of truth stays the repo).
mkdir -p "$INSTALL_DIR"
install -m 0644 "$SRC_DIR/run-digest.mjs" "$INSTALL_DIR/"
cp -R "$SRC_DIR/lib" "$INSTALL_DIR/lib"

# 2. Keys for the launchd context: pull the needed names from the vault into a
#    0600 env file (values go file-to-file; they are never echoed).
touch "$INSTALL_DIR/digest.env"
chmod 600 "$INSTALL_DIR/digest.env"
if [ -r "$VAULT" ]; then
  for key in EXEDEV_API_KEY TREG_TOKEN; do
    line="$(grep -m1 "^${key}=" "$VAULT" || true)"
    if [ -n "$line" ] && ! grep -q "^${key}=" "$INSTALL_DIR/digest.env"; then
      printf '%s\n' "$line" >> "$INSTALL_DIR/digest.env"
    elif [ -n "$line" ]; then
      python3 - "$INSTALL_DIR/digest.env" "$line" <<'PY'
import sys
path, new = sys.argv[1], sys.argv[2]
key = new.split('=', 1)[0]
lines = [new if l.startswith(key + '=') else l for l in open(path).read().splitlines()]
open(path, 'w').write('\n'.join(lines) + '\n')
PY
    fi
  done
else
  echo "warning: vault unreadable from this shell; digest.env not synced"
fi

# 3. Templated plist -> LaunchAgents.
sed -e "s|__NODE__|$NODE_BIN|g" -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" -e "s|__HOME__|$HOME|g" \
  "$PLIST_SRC" > "$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

# 4. (Re)load; bootstrap can hit a known race right after bootout — retry once.
launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$PLIST_LABEL.plist" \
  || { sleep 1; launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"; }
launchctl enable "gui/$(id -u)/$PLIST_LABEL"

echo "installed; next fire:"
launchctl print "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null | grep -E 'state|program =' || true
echo "manual test run: node $INSTALL_DIR/run-digest.mjs --dry-run"
