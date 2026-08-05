#!/usr/bin/env bash
set -euo pipefail

# Idempotently enables the repository settings required by the autonomous gates.
# Safe default is read-only: pass --apply to perform remote mutations.
# Usage: scripts/setup-autonomous-protections.sh [owner/repo] [--apply]

REPO="${1:-${GITHUB_REPOSITORY:-}}"
MODE="${2:-}"
if [[ "$REPO" == "--apply" ]]; then MODE=--apply; REPO="${GITHUB_REPOSITORY:-}"; fi
[[ "$REPO" =~ ^[^/]+/[^/]+$ ]] || { echo "usage: $0 owner/repo [--apply]" >&2; exit 2; }

if [[ "$MODE" != "--apply" ]]; then
  cat <<EOF
DRY RUN — no GitHub settings changed.
Would enable native auto-merge and Actions-created PRs in: $REPO
Would protect staging and main with:
  - pull requests required, zero human approvals
  - strict required statuses: automation/ci, automation/opus-gate
  - force pushes/deletions disabled and conversations resolved
Re-run exactly: $0 '$REPO' --apply
EOF
  exit 0
fi

command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 1; }
gh auth status >/dev/null

repo_payload=$(mktemp)
workflow_payload=$(mktemp)
protection_payload=$(mktemp)
trap 'rm -f "$repo_payload" "$workflow_payload" "$protection_payload"' EXIT
chmod 600 "$repo_payload" "$workflow_payload" "$protection_payload"

cat >"$repo_payload" <<'JSON'
{"allow_auto_merge":true,"allow_merge_commit":true}
JSON
cat >"$workflow_payload" <<'JSON'
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}
JSON
cat >"$protection_payload" <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["automation/ci", "automation/opus-gate"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_linear_history": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

echo "Configuring repository settings for $REPO..."
gh api --method PATCH "repos/$REPO" --input "$repo_payload" >/dev/null
gh api --method PUT "repos/$REPO/actions/permissions/workflow" --input "$workflow_payload" >/dev/null
for branch in staging main; do
  gh api --method PUT "repos/$REPO/branches/$branch/protection" --input "$protection_payload" >/dev/null
  echo "Protected $branch."
done

echo "Configured $REPO idempotently. No branches or pull requests were modified."
