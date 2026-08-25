#!/usr/bin/env bash
set -euo pipefail

sudo systemctl disable --now lv-supervisor.timer lv-supervisor-sentinel.timer
sudo systemctl reset-failed lv-supervisor.service lv-supervisor-sentinel.service || true
echo "VM timers disabled. Ledger retained at /var/lib/lv-supervisor/ledger.json."
echo "Operator rollback: set repository LV_WEEKLY_OWNER=gha, then verify the next GHA-owned weekly cycle. An explicit LV_PROMOTION_ENABLED=false remains authoritative."
echo "This script intentionally does not mutate GitHub variables or delete the VM."
