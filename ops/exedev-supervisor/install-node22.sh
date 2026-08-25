#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION=22.23.2
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
NODE_SHA256=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307
NODE_PREFIX="/opt/node-v${NODE_VERSION}-linux-x64"

if [[ "$(uname -m)" != x86_64 ]]; then
  echo "This pinned pilot installer supports the verified exe.dev x86_64 VM only." >&2
  exit 1
fi
if [[ -x "$NODE_PREFIX/bin/node" ]] && [[ "$($NODE_PREFIX/bin/node --version)" == "v${NODE_VERSION}" ]]; then
  exit 0
fi

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
curl --fail --silent --show-error --location "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" --output "$temporary/$NODE_ARCHIVE"
printf '%s  %s\n' "$NODE_SHA256" "$temporary/$NODE_ARCHIVE" | sha256sum --check --strict
sudo tar -xJf "$temporary/$NODE_ARCHIVE" -C /opt
sudo ln -sfn "$NODE_PREFIX/bin/node" /usr/local/bin/node
sudo ln -sfn "$NODE_PREFIX/bin/npm" /usr/local/bin/npm
sudo ln -sfn "$NODE_PREFIX/bin/npx" /usr/local/bin/npx
