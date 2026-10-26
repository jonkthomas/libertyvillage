#!/usr/bin/env bash
# Install the LV ops fixer on the lv-content-runner VM. Run AS ROOT ON THE VM.
# Idempotent. Installs code + units only: it NEVER enables or starts the timer
# (the parent turns it on after a dry run: see ops/ops-fixer/README.md).
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'run as root' >&2; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"   # repo ops/ (or a copy of it)
DEST=/opt/lv-ops-fixer
node --check "$SRC/ops-fixer/fixer.mjs"
node --check "$SRC/ops-fixer/policy.mjs"
install -d -m 0755 "$DEST/ops-fixer" "$DEST/weekly-digest/lib"
install -m 0644 "$SRC/ops-fixer/fixer.mjs" "$SRC/ops-fixer/policy.mjs" "$DEST/ops-fixer/"
install -m 0644 "$SRC/weekly-digest/lib/digest.mjs" "$SRC/weekly-digest/lib/plain-english.mjs" "$DEST/weekly-digest/lib/"
install -d -m 0750 /var/lib/lv-ops-fixer
install -m 0644 "$SRC/ops-fixer/systemd/lv-ops-fixer.service" "$SRC/ops-fixer/systemd/lv-ops-fixer.timer" /etc/systemd/system/
systemctl daemon-reload
echo "installed. Dry run: node $DEST/ops-fixer/fixer.mjs"
echo "timer state unchanged: $(systemctl is-enabled lv-ops-fixer.timer 2>&1 || true)"
