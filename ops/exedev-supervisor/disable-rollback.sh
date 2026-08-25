#!/usr/bin/env bash
set -euo pipefail

sudo systemctl disable --now lv-supervisor.timer lv-supervisor-sentinel.timer
sudo systemctl reset-failed lv-supervisor.service lv-supervisor-sentinel.service || true
echo "VM timers disabled. Ledger retained at /var/lib/lv-supervisor/ledger.json."
echo "Operator rollback: merge an owner.txt PR changing exedev to gha on staging and protected main, then set the VM env to gha."
echo "Keep the VM timers disabled through that sequence; the intentional no-run gap prevents dual scheduling. LV_PROMOTION_ENABLED=false remains an emergency stop."
echo "This script intentionally does not push, deploy, mutate GitHub, change owner.txt, or delete the VM."
