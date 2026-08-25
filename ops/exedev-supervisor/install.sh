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
pi_sdk_version=0.84.2
pi_sdk_prefix=/opt/lv-supervisor-sdk
pi_sdk_path=$pi_sdk_prefix/lib/node_modules/@earendil-works/pi-coding-agent
[[ "$(/usr/local/bin/pi --version)" == "$pi_sdk_version" ]] || { echo "Preinstalled pi binary must be $pi_sdk_version" >&2; exit 1; }
sudo /usr/local/bin/npm install --global --prefix "$pi_sdk_prefix" --no-audit --no-fund --ignore-scripts "@earendil-works/pi-coding-agent@$pi_sdk_version"
sudo test -f "$pi_sdk_path/node_modules/typebox/build/index.mjs" \
  || { echo "Pinned pi SDK install is missing TypeBox" >&2; exit 1; }
sudo /usr/local/bin/node --input-type=module -e "const sdk=await import('$pi_sdk_path/dist/index.js'); if(sdk.VERSION !== '$pi_sdk_version') throw new Error('pi SDK version mismatch: '+String(sdk.VERSION))"
if [[ ! -d "$repo_dir/.git" ]]; then
  git clone "$repo_url" "$repo_dir"
fi
git -C "$repo_dir" fetch --no-tags origin main staging
for required_branch in main staging; do
  branch_ready=true
  for required_path in scripts/supervisor/cli.mjs scripts/supervisor/host-run.mjs scripts/automation/promotion-control.mjs scripts/automation/weekly-owner.mjs ops/exedev-supervisor/owner.txt data/topic-queue.json scripts/prompts/sections/03-blog-generation.md; do
    git -C "$repo_dir" cat-file -e "origin/$required_branch:$required_path" || branch_ready=false
  done
  if [[ "$branch_ready" != true ]] || ! git -C "$repo_dir" show "origin/$required_branch:package.json" | grep -q '"test:supervisor"'; then
    echo "Install refused: the complete supervisor change must land on both main and staging first (missing on $required_branch)." >&2
    exit 1
  fi
done
git -C "$repo_dir" checkout -B supervisor-local origin/main
(cd "$repo_dir" && /usr/local/bin/npm ci)
sudo install -d -o exedev -g exedev -m 0700 /var/lib/lv-supervisor /var/lib/lv-supervisor/pi-runtime /var/lib/lv-supervisor/pi-sessions /var/lib/lv-supervisor/work /var/lib/lv-supervisor/npm-cache
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
  sudo install -o root -g exedev -m 0640 "$script_dir/lv-supervisor.env.example" /etc/lv-supervisor.env
else
  sudo chown root:exedev /etc/lv-supervisor.env
  sudo chmod 0640 /etc/lv-supervisor.env
fi
if sudo grep -q '^PI_SDK_PATH=' /etc/lv-supervisor.env; then
  sudo sed -i "s#^PI_SDK_PATH=.*#PI_SDK_PATH=$pi_sdk_path#" /etc/lv-supervisor.env
else
  printf '\nPI_SDK_PATH=%s\n' "$pi_sdk_path" | sudo tee -a /etc/lv-supervisor.env >/dev/null
fi
sudo systemctl daemon-reload
sudo systemctl enable --now lv-supervisor.timer lv-supervisor-sentinel.timer
echo "Installed timers after verifying supervisor tooling on origin/main and origin/staging. Edit /etc/lv-supervisor.env, keep LV_WEEKLY_OWNER=gha until cutover, then run health-smoke.sh and follow README.md."
