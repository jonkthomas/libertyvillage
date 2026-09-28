#!/usr/bin/env bash
set -euo pipefail
umask 077
mode=$(basename "$0")
if [[ "$mode" == lv-runner-generator ]]; then
  exec python3 - "$@" <<'PY'
import json, os, pathlib, pwd, re, subprocess, sys, time
if os.geteuid() != 0 or len(sys.argv) != 3:
    sys.exit(2)
job, slot = sys.argv[1:]
if job not in ('weekly-blog', 'seo-improvements') or not re.fullmatch(r'[a-zA-Z0-9_-]{8,80}', slot):
    sys.exit(2)
root = pathlib.Path('/var/lib/lv-runner/scratch')
scratch = root / slot
if not scratch.is_dir() or scratch.is_symlink() or scratch.resolve().parent != root.resolve():
    sys.exit(2)
secrets = json.loads(pathlib.Path(f'/run/lv-runner/agent-secrets/{slot}.json').read_text())
request = json.loads(pathlib.Path(f'/var/lib/lv-runner/generator-requests/{slot}.json').read_text())
script = 'scripts/weekly-blog-agent.js' if job == 'weekly-blog' else 'scripts/seo-improve-agent.js'
keys = ('ANTHROPIC_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GA_PROPERTY_ID', 'PEXELS_API_KEY') if job == 'weekly-blog' else ('ANTHROPIC_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GA_PROPERTY_ID', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'SERPER_API_KEY')
env = {key: secrets[key] for key in keys if secrets.get(key)}
env.update(HOME='/var/cache/lv-generator', PATH='/usr/local/bin:/usr/bin:/bin', NODE_ENV='production', PLAYWRIGHT_BROWSERS_PATH='/opt/lv-runner/chromium', GIT_TERMINAL_PROMPT='0', GIT_CONFIG_COUNT='2', GIT_CONFIG_KEY_0='credential.helper', GIT_CONFIG_VALUE_0='', GIT_CONFIG_KEY_1='remote.origin.pushurl', GIT_CONFIG_VALUE_1='https://invalid.invalid/denied', DRY_RUN='true' if request.get('dryRun') else 'false')
if job == 'weekly-blog' and request.get('topic'):
    env['TOPIC_OVERRIDE'] = request['topic']
if job == 'seo-improvements': env['SEO_MODE'] = 'data'
for key, value in env.items():
    if '\x00' in value or '\n' in value or '\r' in value: sys.exit(2)
envfile = pathlib.Path(f'/run/lv-runner/generator-{slot}.env')
with envfile.open('x') as output:
    for key, value in env.items():
        output.write(f'{key}="{value.replace(chr(92), chr(92)*2).replace(chr(34), chr(92)+chr(34))}"\n')
envfile.chmod(0o600)
generator = pwd.getpwnam('lv-generator')
worker = pwd.getpwnam('lv-runner')
def ownership(uid, gid):
    for base, dirs, files in os.walk(scratch):
        os.chown(base, uid, gid)
        for name in dirs + files: os.chown(os.path.join(base, name), uid, gid, follow_symlinks=False)
ownership(generator.pw_uid, generator.pw_gid)
CLIENT_TIMEOUT = 45 * 60
def _quiet(*args):
    try:
        return subprocess.run(list(args), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    except Exception:
        return None
def _unit_inactive(unit):
    # Unknown manager/status output is NOT stopped: require an explicit inactive.
    try:
        proc = subprocess.run(['systemctl', 'show', '--property=ActiveState', '--value', unit], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
    except Exception:
        return False
    if proc.returncode != 0:
        return False
    return proc.stdout.decode('utf-8', 'replace').strip() == 'inactive'
def _stop_unit(unit):
    # Transient default KillMode=control-group: stop kills the whole unit cgroup.
    _quiet('systemctl', 'stop', unit)
    for _ in range(30):
        if _unit_inactive(unit):
            return True
        time.sleep(1)
    return _unit_inactive(unit)
unit = None
stop_ok = True
try:
    unit = f'lv-generator-{slot}-{os.urandom(4).hex()}'
    cmd = ['systemd-run', '--wait', '--pipe', '--collect', '--quiet', f'--unit={unit}', '-p', 'User=lv-generator', '-p', 'NoNewPrivileges=yes', '-p', 'ProtectSystem=strict', '-p', 'ProtectHome=yes', '-p', 'PrivateTmp=yes', '-p', 'CapabilityBoundingSet=', '-p', 'RestrictSUIDSGID=yes', '-p', 'RuntimeMaxSec=40min', '-p', f'WorkingDirectory={scratch}', '-p', f'ReadWritePaths={scratch} /var/cache/lv-generator', '-p', f'EnvironmentFile={envfile}', 'node', script]
    try:
        result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=CLIENT_TIMEOUT)
    except subprocess.TimeoutExpired:
        stop_ok = _stop_unit(unit)
        sys.exit(124 if stop_ok else 1)
    except Exception:
        stop_ok = _stop_unit(unit) if unit else True
        sys.exit(1)
    if result.returncode != 0 and not _unit_inactive(unit):
        stop_ok = _stop_unit(unit)
        if not stop_ok:
            sys.exit(1)
    sys.exit(result.returncode)
finally:
    if stop_ok:
        ownership(worker.pw_uid, worker.pw_gid)
    envfile.unlink(missing_ok=True)
PY
fi
if [[ "$mode" == lv-runner-service ]]; then
  [[ $EUID == 0 && $# == 1 ]] || exit 2
  IFS=: read -r job target slot extra <<< "$1"
  [[ -z "${extra:-}" && "$slot" =~ ^[a-zA-Z0-9_-]{8,80}$ ]] || exit 2
  if [[ "$slot" == scheduled ]]; then slot="$(date -u +%Y%m%d%H%M)-scheduled"; fi
  case "$job" in topic-discovery|seo-improvements|discover-businesses|news|weekly-growth-report|weekly-blog) ;; *) exit 2;; esac
  [[ "$target" == staging || "$target" == production ]] || exit 2
  [[ ! -e /etc/lv-runner.hold ]] || { echo 'runner hold active' >&2; exit 1; }
  for file in /etc/lv-runner.env "/etc/lv-runner-${target}.env"; do
    [[ -f "$file" && $(stat -c '%a' "$file") == 600 && $(stat -c '%u' "$file") == 0 ]] || { echo 'runner env missing or unsafe' >&2; exit 1; }
    set -a; source "$file"; set +a
  done
  export CONTENT_TARGET="$target"
  if [[ "$target" == production ]]; then
    [[ "${LV_RUNNER_PRODUCTION_ENABLED:-}" == 1 && -z "${CONTENT_SITE_BYPASS:-}" ]] || { echo 'production disabled or bypass set' >&2; exit 1; }
  fi
  install -d -m 0711 -o lv-runner -g lv-runner /var/lib/lv-runner /var/lib/lv-runner/scratch
  install -d -m 0700 -o lv-runner -g lv-runner /var/log/lv-runner
  install -d -m 0711 /run/lv-runner
  install -d -m 0700 /run/lv-runner/agent-secrets
  exec 9>/run/lv-runner/global.lock
  flock -n 9 || { echo "lv-runner overlap ${job}/${target}/${slot}" >&2; exit 75; }
  for stale in "/run/lv-runner/agent-secrets/${slot}.json" "/run/lv-runner/gsa-runner-${slot}.json" "/run/lv-runner/gsa-generator-${slot}.json" "/run/lv-runner/generator-${slot}.env"; do unlink "$stale" 2>/dev/null || true; done
  export LV_RUNNER_SLOT="$slot"
  python3 - <<'PY'
import json, os, grp, pwd
slot = os.environ['LV_RUNNER_SLOT']
root = '/run/lv-runner'
raw = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON', '')
if raw:
    json.loads(raw)
    for user, suffix in [('lv-runner', 'runner'), ('lv-generator', 'generator')]:
        dest = f'{root}/gsa-{suffix}-{slot}.json'
        fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as file: file.write(raw)
        os.chown(dest, pwd.getpwnam(user).pw_uid, grp.getgrnam(user).gr_gid)
shared = {key: os.environ[key] for key in ('ANTHROPIC_API_KEY', 'GA_PROPERTY_ID', 'PEXELS_API_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'SERPER_API_KEY') if os.environ.get(key)}
if raw: shared['GOOGLE_APPLICATION_CREDENTIALS'] = f'{root}/gsa-generator-{slot}.json'
dest = f'{root}/agent-secrets/{slot}.json'
fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as file: json.dump(shared, file)
PY
  if [[ -f "/run/lv-runner/gsa-runner-${slot}.json" ]]; then export GOOGLE_APPLICATION_CREDENTIALS="/run/lv-runner/gsa-runner-${slot}.json"; fi
  cleanup() { unlink "/run/lv-runner/agent-secrets/${slot}.json" 2>/dev/null || true; unlink "/run/lv-runner/gsa-runner-${slot}.json" 2>/dev/null || true; unlink "/run/lv-runner/gsa-generator-${slot}.json" 2>/dev/null || true; unlink "/run/lv-runner/generator-${slot}.env" 2>/dev/null || true; }
  trap cleanup EXIT
  runuser -u lv-runner -- /usr/bin/env node /usr/local/libexec/lv-runner-runner.mjs "$job" "$target" "$slot"
  exit
fi
if (( EUID != 0 )); then echo 'lv-runner requires root' >&2; exit 1; fi
usage() { echo 'usage: lv-runner run JOB --target staging|production [--slot SLOT] [--topic TITLE] [--dry-run] [--production-approved] | report weekly-growth-report --latest' >&2; exit 2; }
[[ $# -ge 1 ]] || usage
action=$1; shift
if [[ "$action" == report ]]; then
  [[ "${1:-}" == weekly-growth-report && "${2:-}" == --latest && $# == 2 ]] || usage
  latest=$(find /var/lib/lv-runner/growth -mindepth 2 -maxdepth 2 -name 'weekly-growth.md' -type f -print 2>/dev/null | sort | tail -1)
  [[ -n "$latest" ]] || { echo 'no growth report' >&2; exit 1; }
  cat "$latest"
  exit 0
fi
[[ "$action" == run && $# -ge 1 ]] || usage
job=$1; shift
case "$job" in topic-discovery|seo-improvements|discover-businesses|news|weekly-growth-report|weekly-blog) ;; *) usage;; esac
target=''; slot=''; topic=''; dry_run=false; approved=false
while (($#)); do
  case "$1" in
    --target) target=${2:-}; shift 2;;
    --slot) slot=${2:-}; shift 2;;
    --topic) topic=${2:-}; shift 2;;
    --dry-run) dry_run=true; shift;;
    --production-approved) approved=true; shift;;
    *) usage;;
  esac
done
[[ "$target" == staging || "$target" == production ]] || usage
[[ ! -e /etc/lv-runner.hold ]] || { echo 'runner hold active' >&2; exit 1; }
# No --scheduled on-demand flag: timer units invoke lv-runner-service directly
# with the :scheduled slot, so any --scheduled here is a spoof and hits usage.
if [[ "$target" == production && "$approved" != true ]]; then
  echo 'production on-demand requires --production-approved after parent/John authorization' >&2; exit 1
fi
if [[ -z "$slot" ]]; then
  slot="$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)"
fi
[[ "$slot" =~ ^[a-zA-Z0-9_-]{8,80}$ ]] || usage
install -d -m 0700 -o lv-runner -g lv-runner /var/lib/lv-runner/requests
python3 - "$slot" "$topic" "$dry_run" <<'PY'
import json, os, sys
slot, topic, dry = sys.argv[1:]
dest = '/var/lib/lv-runner/requests/' + slot + '.json'
payload = {'topic': topic, 'dryRun': dry == 'true'}
if os.path.exists(dest):
    with open(dest) as f:
        if json.load(f) != payload:
            raise SystemExit('slot request differs from original')
else:
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(payload, f)
os.chown(dest, __import__('pwd').getpwnam('lv-runner').pw_uid, __import__('grp').getgrnam('lv-runner').gr_gid)
PY
systemctl start "lv-runner@${job}:${target}:${slot}.service"
echo "lv-runner ${job}/${target}/${slot}"
