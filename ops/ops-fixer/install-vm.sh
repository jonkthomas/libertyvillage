#!/usr/bin/env bash
# Install the LV ops fixer on the lv-content-runner VM. Run AS ROOT ON THE VM.
# Idempotent. Installs code + units only: it NEVER enables or starts the timer
# (the parent turns it on after a dry run: see ops/ops-fixer/README.md).
#   bash ops/ops-fixer/install-vm.sh               # full install (root)
#   bash ops/ops-fixer/install-vm.sh --code-only D  # code tree only, into D (tests)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"   # repo ops/ (or a copy of it)
DEST=/opt/lv-ops-fixer
code_only=false
if [[ "${1:-}" == --code-only ]]; then code_only=true; DEST=${2:?destination required}; fi
[[ $code_only == true || $EUID == 0 ]] || { echo 'run as root' >&2; exit 1; }
# Copy every module the fixer imports (static closure), not a hand-kept list.
files=$(node "$SRC/ops-fixer/closure.mjs")
[[ -n "$files" ]] || { echo 'empty module closure' >&2; exit 1; }
while IFS= read -r rel; do
  node --check "$SRC/$rel"
  install -d -m 0755 "$DEST/$(dirname "$rel")"
  install -m 0644 "$SRC/$rel" "$DEST/$rel"
done <<< "$files"
[[ $code_only == true ]] && { echo "installed code into $DEST"; exit 0; }
install -d -m 0750 /var/lib/lv-ops-fixer
install -m 0644 "$SRC/ops-fixer/systemd/lv-ops-fixer.service" "$SRC/ops-fixer/systemd/lv-ops-fixer.timer" /etc/systemd/system/
systemctl daemon-reload
# Prove the installed tree loads (dry run: plans only, writes and starts nothing).
node "$DEST/ops-fixer/fixer.mjs" >/dev/null
echo "installed. Dry run: node $DEST/ops-fixer/fixer.mjs"
echo "timer state unchanged: $(systemctl is-enabled lv-ops-fixer.timer 2>&1 || true)"
