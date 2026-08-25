#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_dir=${LV_REPO_DIR:-$(cd "$script_dir/../.." && pwd)}
context_file=${LV_SEO_CONTEXT:?LV_SEO_CONTEXT is required}
node_binary=${LV_NODE_BINARY:-/usr/local/bin/node}
context_dir=$(dirname "$context_file")
gcp_credential=${LV_GCP_CREDENTIALS_PATH:?LV_GCP_CREDENTIALS_PATH is required}

file_mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
file_uid() { stat -c %u "$1" 2>/dev/null || stat -f %u "$1"; }

[[ -f "$repo_dir/scripts/pull-seo-data.js" ]] || { echo "Trusted SEO pull script is missing from $repo_dir" >&2; exit 1; }
[[ -d "$context_dir" ]] || { echo "SEO context directory is missing: $context_dir" >&2; exit 1; }
[[ -f "$gcp_credential" && ! -L "$gcp_credential" ]] || { echo "GCP credential must be a regular, non-symlink file: $gcp_credential" >&2; exit 1; }
[[ "$(file_mode "$gcp_credential")" == 600 ]] || { echo "GCP credential must have mode 0600: $gcp_credential" >&2; exit 1; }
[[ "$(file_uid "$gcp_credential")" == "$(id -u)" ]] || { echo "GCP credential must be owned by $(id -un): $gcp_credential" >&2; exit 1; }
temporary=$(mktemp "$context_dir/.seo-data-latest.XXXXXX")
trap 'rm -f "$temporary"' EXIT

LV_SEO_OUTPUT_PATH="$temporary" "$node_binary" "$repo_dir/scripts/pull-seo-data.js"
"$node_binary" -e 'const fs=require("fs");const file=process.argv[1];const value=JSON.parse(fs.readFileSync(file,"utf8"));if(!value?.collectedAt)throw new Error("SEO output lacks collectedAt");if(!value?.gsc?.thisWeek||value.gsc.thisWeek.error)throw new Error("SEO output lacks successful current GSC data");if(!value?.ga4?.totals||value.ga4.totals.error)throw new Error("SEO output lacks successful GA4 totals")' "$temporary"
chmod 0600 "$temporary"
mv -f "$temporary" "$context_file"
trap - EXIT
