#!/usr/bin/env bash
set -euo pipefail

repo_dir=${LV_REPO_DIR:-/home/exedev/libertyvillage}
set -a
source /etc/lv-supervisor.env
set +a

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
origin_url=$(git -C "$repo_dir" remote get-url origin)
[[ "$origin_url" == "$repo_url" ]] || { echo "origin must be the exact internal repository URL: $repo_url" >&2; exit 1; }
"${service_env[@]}" git ls-remote "$repo_url" HEAD >/dev/null
"${service_env[@]}" git -C "$repo_dir" fetch --no-tags origin main staging
vm_owner=${LV_WEEKLY_OWNER-}
[[ "$vm_owner" == gha || "$vm_owner" == exedev ]] || { echo "LV_WEEKLY_OWNER must be exactly gha or exedev" >&2; exit 1; }
branch_owners=()
for required_branch in main staging; do
  for required_path in scripts/supervisor/cli.mjs scripts/supervisor/host-run.mjs scripts/automation/promotion-control.mjs scripts/automation/weekly-owner.mjs ops/exedev-supervisor/owner.txt data/topic-queue.json scripts/prompts/sections/03-blog-generation.md; do
    "${service_env[@]}" git -C "$repo_dir" cat-file -e "origin/$required_branch:$required_path" \
      || { echo "Cutover refused: $required_path is missing from origin/$required_branch" >&2; exit 1; }
  done
  "${service_env[@]}" git -C "$repo_dir" show "origin/$required_branch:data/topic-queue.json" \
    | "${service_env[@]}" /usr/local/bin/node -e '
      let input = "";
      process.stdin.on("data", chunk => input += chunk).on("end", () => {
        const queue = JSON.parse(input);
        const requiredStrings = ["key", "kind", "title", "source", "rationale", "addedAt", "branchPrefix"];
        if (queue?.version !== 1 || !Array.isArray(queue.topics) || queue.topics.length === 0) throw new Error("topic queue must use schema version 1 and contain topics");
        if (!queue.topics.some(entry => entry?.kind === "blog")) throw new Error("topic queue must contain a selectable blog entry");
        for (const entry of queue.topics) {
          if (requiredStrings.some(field => typeof entry?.[field] !== "string" || !entry[field].trim())) throw new Error(`topic queue entry lacks selected-topic field(s): ${entry?.key || "unknown"}`);
          if (!Number.isInteger(entry.attempts) || entry.attempts < 0) throw new Error(`topic queue entry has invalid attempts: ${entry.key}`);
        }
      });' \
    || { echo "Cutover refused: data/topic-queue.json has an invalid selected-entry schema on origin/$required_branch" >&2; exit 1; }
  branch_owner=$("${service_env[@]}" git -C "$repo_dir" show "origin/$required_branch:ops/exedev-supervisor/owner.txt" \
    | "${service_env[@]}" /usr/local/bin/node "$repo_dir/scripts/automation/weekly-owner.mjs" --stdin)
  branch_owners+=("$branch_owner")
  "${service_env[@]}" git -C "$repo_dir" show "origin/$required_branch:package.json" | grep -q '"test:supervisor"' \
    || { echo "Cutover refused: test:supervisor is missing from origin/$required_branch" >&2; exit 1; }
done
[[ "${branch_owners[0]}" == "${branch_owners[1]}" ]] || { echo "weekly owner mismatch: main=${branch_owners[0]} staging=${branch_owners[1]}" >&2; exit 1; }
[[ "${branch_owners[0]}" == "$vm_owner" ]] || { echo "weekly owner mismatch: committed=${branch_owners[0]} VM=$vm_owner" >&2; exit 1; }
sudo systemctl start lv-supervisor-smoke.service
/usr/local/bin/node "$repo_dir/scripts/supervisor/cli.mjs" status >/dev/null
unset service_env
echo "health/smoke passed; tokenless exe.dev proxy auth, exact repo scope over gh/raw API and git, identical committed branch owner plus VM match, trusted topic-queue schema on main/staging, and sandboxed real-agentDir SDK tool boundary verified"
