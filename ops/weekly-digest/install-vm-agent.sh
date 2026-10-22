#!/usr/bin/env bash
# Install the LV digest fix-it agent on the lv-content-runner VM. Run AS ROOT
# ON THE VM (the Mac-side helper pipes it over ssh):
#   bash ops/weekly-digest/install-vm-agent.sh
# Safe by construction: touches ONLY lv-digest assets — never lv-runner units,
# the hold file, or /etc/lv-runner*.env. Idempotent (re-run to update code).
set -euo pipefail

USER_NAME=lv-digest
HOME_DIR=/var/lib/lv-digest
AGENT_DIR=/opt/lv-digest-agent
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"   # repo ops/weekly-digest (or a copy of it)

# 1. Dedicated non-root user (no sudo, cannot read /etc/lv-runner*.env: root:root 0600).
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$HOME_DIR" --shell /bin/bash "$USER_NAME"
  echo "created user $USER_NAME"
fi

# 2. pi config: reuse the VM's existing pi install + exe-dev provider config.
# Copy ONLY the agent state (auth/model selection/extensions) — never session
# history — and refresh it on every install so rotated auth propagates.
mkdir -p "$HOME_DIR/.pi/agent"
for f in auth.json models-store.json settings.json AGENTS.md; do
  [ -f "/home/exedev/.pi/$f" ] && install -m 0644 -o "$USER_NAME" -g "$USER_NAME" "/home/exedev/.pi/$f" "$HOME_DIR/.pi/$f" || true
done
if [ -d /home/exedev/.pi/agent ]; then
  mkdir -p "$HOME_DIR/.pi/agent"
  for f in auth.json models-store.json settings.json; do
    [ -f "/home/exedev/.pi/agent/$f" ] && install -m 0644 -o "$USER_NAME" -g "$USER_NAME" "/home/exedev/.pi/agent/$f" "$HOME_DIR/.pi/agent/$f" || true
  done
  [ -d /home/exedev/.pi/agent/extensions ] && cp -r /home/exedev/.pi/agent/extensions "$HOME_DIR/.pi/agent/" || true
fi
mkdir -p "$HOME_DIR/agent-logs" "$HOME_DIR/.config/gh" "$HOME_DIR/repo"
chown -R "$USER_NAME:$USER_NAME" "$HOME_DIR"
chmod 700 "$HOME_DIR"

# 3. pi runtime: /usr/local/bin/pi symlinks into exedev's 0700 home. Install a
# root-owned copy the lv-digest user can execute, plus the theme assets pi
# resolves beside its binary (refreshed every install so upgrades propagate).
install -m 0755 /home/exedev/.local/bin/pi /usr/local/libexec/lv-digest-pi
install -d -m 0755 /usr/local/libexec/theme
install -m 0644 /home/exedev/.local/pi/theme/dark.json /home/exedev/.local/pi/theme/light.json /usr/local/libexec/theme/

# 4. Agent code (root-owned, world-readable: the service reads it, never writes).
install -m 0755 -d "$AGENT_DIR"
install -m 0644 "$SRC_DIR/agent/agent.mjs" "$AGENT_DIR/agent.mjs"

# 5. systemd unit + timer (Monday 09:00 America/Toronto, after the 08:00 digest).
install -m 0644 "$SRC_DIR/systemd/lv-digest-agent.service" /etc/systemd/system/
install -m 0644 "$SRC_DIR/systemd/lv-digest-agent.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lv-digest-agent.timer

# 6. Verify isolation: the agent user must NOT read runner secrets.
for envf in /etc/lv-runner.env /etc/lv-runner-staging.env /etc/lv-runner-production.env; do
  if sudo -u "$USER_NAME" test -r "$envf" 2>/dev/null; then
    echo "FATAL: $USER_NAME can read $envf" >&2
    exit 1
  fi
done
echo "isolation OK: $USER_NAME cannot read the root-only runner env files"
systemctl list-timers lv-digest-agent.timer --no-pager | head -3
echo "installed. Dry-run: sudo -u $USER_NAME node $AGENT_DIR/agent.mjs --dry-run"
echo "Real runs need /etc/lv-digest-agent.env with GH_TOKEN (repo-scoped fine-grained"
echo "token on jonkthomas/libertyvillage: Contents Read+Write, Issues Read+Write, Pull"
echo "requests Read+Write — nothing else):"
echo "  printf 'GH_TOKEN=github_pat_...' | sudo tee /etc/lv-digest-agent.env >/dev/null && sudo chmod 600 /etc/lv-digest-agent.env"
