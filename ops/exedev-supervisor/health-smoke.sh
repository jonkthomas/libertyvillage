#!/usr/bin/env bash
set -euo pipefail

repo_dir=${LV_REPO_DIR:-/home/exedev/libertyvillage}
set -a
source /etc/lv-supervisor.env
set +a

file_mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
file_user() { stat -c %U "$1" 2>/dev/null || stat -f %Su "$1"; }

[[ "${GH_HOST:-}" == github.int.exe.xyz ]] || { echo "GH_HOST must be exactly github.int.exe.xyz" >&2; exit 1; }
[[ "${GITHUB_API_URL:-}" == https://github.int.exe.xyz/api/v3 ]] || { echo "GITHUB_API_URL must be the pinned exe.dev API URL" >&2; exit 1; }
[[ "${LV_EXE_GITHUB_PROXY_AUTH:-}" == true ]] || { echo "LV_EXE_GITHUB_PROXY_AUTH=true is required on exe.dev" >&2; exit 1; }
[[ "${LV_GITHUB_REPOSITORY:-}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "LV_GITHUB_REPOSITORY must be an exact owner/repository scope" >&2; exit 1; }
repo_url="https://github.int.exe.xyz/${LV_GITHUB_REPOSITORY}.git"
service_env=(env -i HOME=/var/empty PATH="$PATH" GH_HOST="$GH_HOST" GITHUB_API_URL="$GITHUB_API_URL" \
  LV_EXE_GITHUB_PROXY_AUTH="$LV_EXE_GITHUB_PROXY_AUTH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1)

systemctl is-active --quiet lv-supervisor.timer
systemctl is-active --quiet lv-supervisor-sentinel.timer
view_scope=$("${service_env[@]}" gh repo view "$LV_GITHUB_REPOSITORY" --json nameWithOwner --jq .nameWithOwner)
[[ "$view_scope" == "$LV_GITHUB_REPOSITORY" ]] || { echo "gh repo view scope mismatch: $view_scope" >&2; exit 1; }
raw_scope=$("${service_env[@]}" curl --fail --silent --show-error "$GITHUB_API_URL/repos/$LV_GITHUB_REPOSITORY" \
  | "${service_env[@]}" /usr/local/bin/node -e 'let input=""; process.stdin.on("data", chunk => input += chunk).on("end", () => process.stdout.write(JSON.parse(input).full_name || ""));')
[[ "$raw_scope" == "$LV_GITHUB_REPOSITORY" ]] || { echo "raw API scope mismatch: $raw_scope" >&2; exit 1; }
api_scope=$("${service_env[@]}" gh api --hostname "$GH_HOST" "repos/$LV_GITHUB_REPOSITORY" --jq .full_name)
[[ "$api_scope" == "$LV_GITHUB_REPOSITORY" ]] || { echo "gh API scope mismatch: $api_scope" >&2; exit 1; }
if ! remote_owner=$("${service_env[@]}" gh variable get LV_WEEKLY_OWNER --repo "$LV_GITHUB_REPOSITORY" --json value --jq .value); then
  echo "LV_WEEKLY_OWNER is unreadable through the exe.dev proxy; refusing to infer gha" >&2
  exit 1
fi
remote_owner=${remote_owner:-gha}
vm_owner=${LV_WEEKLY_OWNER:-gha}
[[ "$remote_owner" == "$vm_owner" ]] || { echo "LV_WEEKLY_OWNER mismatch: GitHub=$remote_owner VM=$vm_owner" >&2; exit 1; }
origin_url=$(git -C "$repo_dir" remote get-url origin)
[[ "$origin_url" == "$repo_url" ]] || { echo "origin must be the exact internal repository URL: $repo_url" >&2; exit 1; }
"${service_env[@]}" git ls-remote "$repo_url" HEAD >/dev/null
"${service_env[@]}" git -C "$repo_dir" fetch --no-tags origin main staging
for required_branch in main staging; do
  for required_path in scripts/supervisor/cli.mjs scripts/supervisor/host-run.mjs scripts/automation/promotion-control.mjs ops/exedev-supervisor/refresh-seo.sh; do
    "${service_env[@]}" git -C "$repo_dir" cat-file -e "origin/$required_branch:$required_path" \
      || { echo "Cutover refused: $required_path is missing from origin/$required_branch" >&2; exit 1; }
  done
  "${service_env[@]}" git -C "$repo_dir" show "origin/$required_branch:package.json" | grep -q '"test:supervisor"' \
    || { echo "Cutover refused: test:supervisor is missing from origin/$required_branch" >&2; exit 1; }
done
[[ -n "${LV_SEO_PREFETCH_COMMAND:-}" ]] || { echo "LV_SEO_PREFETCH_COMMAND is required" >&2; exit 1; }
[[ -f "$LV_GCP_CREDENTIALS_PATH" && ! -L "$LV_GCP_CREDENTIALS_PATH" ]] || { echo "GCP credential must be a regular, non-symlink file: $LV_GCP_CREDENTIALS_PATH" >&2; exit 1; }
[[ "$(file_mode "$LV_GCP_CREDENTIALS_PATH")" == 600 ]] || { echo "GCP credential must have mode 0600: $LV_GCP_CREDENTIALS_PATH" >&2; exit 1; }
[[ "$(file_user "$LV_GCP_CREDENTIALS_PATH")" == exedev ]] || { echo "GCP credential must be owned by exedev: $LV_GCP_CREDENTIALS_PATH" >&2; exit 1; }
(cd "$repo_dir" && /bin/sh -c "$LV_SEO_PREFETCH_COMMAND")
seo_max_age_hours=${LV_SEO_MAX_AGE_HOURS:-48}
[[ -f "$LV_SEO_CONTEXT" ]] || { echo "SEO snapshot missing: $LV_SEO_CONTEXT" >&2; exit 1; }
seo_age_seconds=$(( $(date +%s) - $(stat -c %Y "$LV_SEO_CONTEXT") ))
(( seo_age_seconds >= 0 && seo_age_seconds <= seo_max_age_hours * 3600 )) || { echo "SEO snapshot stale: $LV_SEO_CONTEXT" >&2; exit 1; }
sudo systemctl start lv-supervisor-smoke.service
/usr/local/bin/node "$repo_dir/scripts/supervisor/cli.mjs" status >/dev/null
unset service_env
echo "health/smoke passed; tokenless exe.dev proxy auth, exact repo scope over gh/raw API and git, owner, both branch prerequisites, automatic fresh SEO context, and sandboxed real-agentDir SDK tool boundary verified"
