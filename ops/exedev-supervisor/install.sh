#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as exedev; this script uses sudo only for system installation." >&2
  exit 1
fi
repo_dir=${LV_REPO_DIR:-/home/exedev/libertyvillage}
repo_url=${LV_REPO_URL:-https://github.int.exe.xyz/jonkthomas/libertyvillage.git}
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

"$script_dir/install-node22.sh"
if [[ ! -d "$repo_dir/.git" ]]; then
  git clone "$repo_url" "$repo_dir"
fi
git -C "$repo_dir" fetch --no-tags origin main staging
for required_branch in main staging; do
  branch_ready=true
  for required_path in scripts/supervisor/cli.mjs scripts/supervisor/host-run.mjs scripts/automation/promotion-control.mjs ops/exedev-supervisor/refresh-seo.sh; do
    git -C "$repo_dir" cat-file -e "origin/$required_branch:$required_path" || branch_ready=false
  done
  if [[ "$branch_ready" != true ]] || ! git -C "$repo_dir" show "origin/$required_branch:package.json" | grep -q '"test:supervisor"'; then
    echo "Install refused: the complete supervisor change must land on both main and staging first (missing on $required_branch)." >&2
    exit 1
  fi
done
git -C "$repo_dir" checkout -B supervisor-local origin/main
(cd "$repo_dir" && /usr/local/bin/npm ci)
sudo install -d -o exedev -g exedev -m 0700 /var/lib/lv-supervisor /var/lib/lv-supervisor/pi-runtime /var/lib/lv-supervisor/pi-sessions /var/lib/lv-supervisor/work /var/lib/lv-supervisor/context /var/lib/lv-supervisor/npm-cache
if [[ ! -f /var/lib/lv-supervisor/ledger.json ]]; then
  printf '%s\n' '{"schema_version":1,"lease":null,"runs":[]}' | sudo tee /var/lib/lv-supervisor/ledger.json >/dev/null
  sudo chown exedev:exedev /var/lib/lv-supervisor/ledger.json
  sudo chmod 0600 /var/lib/lv-supervisor/ledger.json
fi
sudo install -d -o root -g root -m 0755 /usr/local/libexec
sudo install -m 0644 "$script_dir/systemd/lv-supervisor.service" /etc/systemd/system/lv-supervisor.service
sudo install -m 0644 "$script_dir/systemd/lv-supervisor.timer" /etc/systemd/system/lv-supervisor.timer
sudo install -m 0644 "$script_dir/systemd/lv-supervisor-sentinel.service" /etc/systemd/system/lv-supervisor-sentinel.service
sudo install -m 0644 "$script_dir/systemd/lv-supervisor-sentinel.timer" /etc/systemd/system/lv-supervisor-sentinel.timer
sudo install -m 0644 "$script_dir/systemd/lv-supervisor-smoke.service" /etc/systemd/system/lv-supervisor-smoke.service
if [[ ! -f /etc/lv-supervisor.env ]]; then
  sudo install -m 0600 "$script_dir/lv-supervisor.env.example" /etc/lv-supervisor.env
fi
sudo systemctl daemon-reload
sudo systemctl enable --now lv-supervisor.timer lv-supervisor-sentinel.timer
echo "Installed timers after verifying supervisor tooling on origin/main and origin/staging. Edit /etc/lv-supervisor.env, keep LV_WEEKLY_OWNER=gha until cutover, then run health-smoke.sh and follow README.md."
