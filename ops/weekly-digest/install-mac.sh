#!/usr/bin/env bash
# Install/update the LV weekly digest LaunchAgent on this Mac (the one hosting
# the spec-deck tailnet server). Idempotent. Run from the repo:
#   bash ops/weekly-digest/install-mac.sh
set -euo pipefail

PLIST_LABEL=com.jonkthomas.lv-weekly-digest
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
# The digest runs from the MAIN checkout (stable path across worktree churn).
MAIN_CHECKOUT="$HOME/Desktop/important-coding-projects/lib_village"
TARGET="$MAIN_CHECKOUT/ops/weekly-digest/run-digest.mjs"

if [ ! -f "$TARGET" ]; then
  echo "WARNING: $TARGET not found yet (feature not merged/pulled into the main"
  echo "checkout). The LaunchAgent installs now but each run fails until the file"
  echo "exists. Re-run this after the PR merges and the main checkout pulls."
fi

install -m 0644 "$SRC_DIR/$PLIST_LABEL.plist" "$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
launchctl enable "gui/$(id -u)/$PLIST_LABEL"

echo "installed; next fire:"
launchctl print "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null | grep -E 'state|next fire' || true
echo "manual test run:"
echo "  node $SRC_DIR/run-digest.mjs --dry-run"
