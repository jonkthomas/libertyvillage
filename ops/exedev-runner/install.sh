#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'run as root' >&2; exit 1; }
root=$(cd "$(dirname "$0")" && pwd)
[[ "$(node --version)" == v22.23.2 ]] || { echo 'Node v22.23.2 required' >&2; exit 1; }
bash -n "$root/launcher.sh"
node --check "$root/runner.mjs"
id lv-runner >/dev/null 2>&1 || useradd --system --home /var/lib/lv-runner --shell /usr/sbin/nologin lv-runner
id lv-generator >/dev/null 2>&1 || useradd --system --home /var/cache/lv-generator --shell /usr/sbin/nologin lv-generator
install -d -m 0711 -o lv-runner -g lv-runner /var/lib/lv-runner /var/lib/lv-runner/scratch
install -d -m 0700 -o lv-runner -g lv-runner /var/lib/lv-runner/requests /var/lib/lv-runner/generator-requests /var/log/lv-runner
install -d -m 0700 -o lv-generator -g lv-generator /var/cache/lv-generator
install -d -m 0750 -o lv-runner -g lv-runner /srv/lv-runner
install -d -m 0755 /opt/lv-runner/chromium
install -d -m 0755 /usr/local/libexec /usr/local/bin
install -m 0755 -o root -g root "$root/launcher.sh" /usr/local/libexec/lv-runner-launcher
install -m 0644 -o root -g root "$root/runner.mjs" /usr/local/libexec/lv-runner-runner.mjs
ln -sfn /usr/local/libexec/lv-runner-launcher /usr/local/bin/lv-runner
ln -sfn /usr/local/libexec/lv-runner-launcher /usr/local/libexec/lv-runner-service
ln -sfn /usr/local/libexec/lv-runner-launcher /usr/local/libexec/lv-runner-generator
install -d -m 0750 /etc/sudoers.d
printf '%s\n' 'lv-runner ALL=(root) NOPASSWD: /usr/local/libexec/lv-runner-generator *' > /etc/sudoers.d/lv-runner-generator
chmod 0440 /etc/sudoers.d/lv-runner-generator
visudo -cf /etc/sudoers.d/lv-runner-generator
for file in "$root"/*.timer "$root/lv-runner@.service"; do install -m 0644 -o root -g root "$file" /etc/systemd/system/; done
systemctl daemon-reload
# SEO remains off even on reinstalls after the five accepted lanes are enabled.
# Its staging fixer has not reached a terminal gate/publish outcome (#182).
systemctl disable --now lv-runner-seo-improvements.timer
echo 'Installed runner. SEO timer disabled pending staging acceptance (#182); other timer states unchanged.'
