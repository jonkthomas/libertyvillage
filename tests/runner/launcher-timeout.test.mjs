import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const owned = path.join(dirname, '../../ops/exedev-runner');
const launcher = fs.readFileSync(path.join(owned, 'launcher.sh'), 'utf8');
const generatorBlock = launcher.split("<<'PY'")[1].split('\nPY')[0];

test('generator unit has service-side runtime bound safely below the 45min client timeout', () => {
  const match = launcher.match(/RuntimeMaxSec=(\d+)\s*(min|s|sec)?/);
  assert.ok(match, 'expected RuntimeMaxSec on the systemd-run unit');
  const value = Number(match[1]);
  const seconds = match[2] === 'min' || !match[2] ? value * 60 : value;
  assert.ok(seconds < 45 * 60, `RuntimeMaxSec must be below client timeout, got ${match[0]}`);
  assert.ok(seconds >= 30 * 60, `RuntimeMaxSec should stay near the client budget, got ${match[0]}`);
});

test('timeout/error path stops the unit and confirms inactive before scratch ownership is returned', () => {
  assert.match(launcher, /except subprocess\.TimeoutExpired/);
  assert.match(launcher, /systemctl', 'stop'/);
  assert.match(launcher, /ActiveState/);
  assert.match(launcher, /--property=ActiveState/);
  // VM check (systemd 255): `systemctl kill` offers --signal/--kill-whom only;
  // --kill-all is unsupported, so cleanup must not invoke it.
  assert.doesNotMatch(launcher, /--kill-all/);
  const timeoutAt = launcher.indexOf('except subprocess.TimeoutExpired');
  const stopAt = launcher.indexOf("systemctl', 'stop'");
  const ownershipAt = launcher.indexOf('ownership(worker.pw_uid');
  assert.ok(timeoutAt < ownershipAt, 'stop handling must precede scratch ownership return');
  assert.ok(stopAt < ownershipAt, 'systemctl stop must precede scratch ownership return');
});

test('fail closed when the unit cannot be confirmed stopped', () => {
  assert.match(launcher, /if stop_ok:/);
  assert.match(launcher, /sys\.exit\(1\)/);
  // Ownership is restored only after a confirmed stop; env-file cleanup is unconditional.
  assert.match(launcher, /if stop_ok:\s*\n\s*ownership\(worker\.pw_uid/);
  assert.match(launcher, /envfile\.unlink\(missing_ok=True\)/);
});

test('unknown manager/status output is never classified as confirmed inactive', () => {
  // _unit_inactive must require returncode 0 plus an exact 'inactive' value.
  assert.match(generatorBlock, /proc\.returncode != 0:\s*\n\s*return False/);
  assert.match(generatorBlock, /== 'inactive'/);
  assert.match(generatorBlock, /Unknown manager\/status|explicit inactive/i);
});

test('generator path persists only bounded root diagnostics and never raw model output', () => {
  assert.equal((generatorBlock.match(/print\(/g) || []).length, 0, 'no print() in generator block');
  assert.match(generatorBlock, /GeneratorDiagnostic\(f'\/var\/log\/lv-generator\/generator-/);
  assert.match(generatorBlock, /capture_generator\(cmd, diag, CLIENT_TIMEOUT\)/);
  assert.doesNotMatch(generatorBlock, /print\(env|print\(secrets|os\.environ/);
  const sanitizer = fs.readFileSync(path.join(owned, 'generator_diag.py'), 'utf8');
  assert.match(sanitizer, /MAX_BYTES = 64 \* 1024/);
  assert.match(sanitizer, /O_NOFOLLOW, 0o600/);
  assert.match(sanitizer, /candidate text, tool output, environment values and raw errors are never persisted/);
});

test('launcher.sh passes bash syntax check and embedded generator python parses', () => {
  const shell = spawnSync('bash', ['-n', path.join(owned, 'launcher.sh')]);
  assert.equal(shell.status, 0, shell.stderr.toString());
  const parse = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: generatorBlock });
  assert.equal(parse.status, 0, parse.stderr.toString());
});

test('on-demand CLI rejects --scheduled: spoofed production scheduled run is denied', (t) => {
  // The on-demand parser must not accept --scheduled at all (it falls to usage);
  // timer units reach lv-runner-service directly, never through this parser.
  assert.doesNotMatch(launcher, /--scheduled\)/);
  assert.match(launcher, /production on-demand requires --production-approved/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-launcher-cli-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const copy = path.join(temp, 'test-launcher.sh');
  fs.writeFileSync(copy, launcher.replace(
    "if (( EUID != 0 )); then echo 'lv-runner requires root' >&2; exit 1; fi",
    "if false; then echo 'lv-runner requires root' >&2; exit 1; fi",
  ));
  const run = (args) => spawnSync('bash', [copy, ...args], { timeout: 15000 });
  // Fake timer-spoof routes: all must die in usage (exit 2) before any request write or start.
  for (const args of [
    ['run', 'weekly-blog', '--target', 'production', '--scheduled'],
    ['run', 'weekly-blog', '--target', 'staging', '--scheduled'],
    ['run', 'weekly-blog', '--target', 'production', '--scheduled', '--production-approved'],
  ]) {
    const probed = run(args);
    assert.equal(probed.status, 2, `${args.join(' ')} must exit 2, got ${probed.status}: ${probed.stderr.toString()}`);
    assert.match(probed.stderr.toString(), /usage:/);
  }
  // Control: ordinary on-demand parsing still passes (it fails later on VM-only
  // paths, but must NOT fail as usage).
  const control = run(['run', 'weekly-blog', '--target', 'staging']);
  assert.notEqual(control.status, 2, `ordinary on-demand run must parse, got: ${control.stderr.toString()}`);
});

test('legitimate timer path preserved: service :scheduled slot and six timer units', () => {
  // Real timer/service invocation maps the literal :scheduled slot internally.
  assert.match(launcher, /"\$slot" == scheduled/);
  for (const job of ['topic-discovery', 'seo-improvements', 'discover-businesses', 'news', 'weekly-growth-report', 'weekly-blog']) {
    const timer = fs.readFileSync(path.join(owned, `lv-runner-${job}.timer`), 'utf8');
    assert.ok(
      timer.includes(`Unit=lv-runner@${job}:production:scheduled.service`),
      `${job} timer must still target the :scheduled service instance`,
    );
  }
});

test('mocked probe: old client-timeout-only flow leaves the unit alive, stop+observe flow does not', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-launcher-timeout-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bin = path.join(temp, 'bin');
  const state = path.join(temp, 'state');
  fs.mkdirSync(bin);
  fs.mkdirSync(state);
  const marker = path.join(state, 'unit-alive');
  const calls = path.join(state, 'calls.log');
  fs.writeFileSync(path.join(bin, 'systemd-run'), `#!/usr/bin/env bash\necho "run $@" >> "${calls}"\ntouch "${marker}"\nexec sleep 30\n`);
  fs.writeFileSync(path.join(bin, 'systemctl'), `#!/usr/bin/env bash\necho "systemctl $@" >> "${calls}"\nif [[ "$1" == stop ]]; then rm -f "${marker}"; exit 0; fi\nif [[ "$1" == show ]]; then\n  if [[ "\${SHOW_MODE:-}" == fail ]]; then exit 1; fi\n  [[ -e "${marker}" ]] && echo active || echo inactive\n  exit 0\nfi\nexit 0\n`);
  fs.chmodSync(path.join(bin, 'systemd-run'), 0o755);
  fs.chmodSync(path.join(bin, 'systemctl'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const oldFlow = 'import subprocess\ntry:\n    subprocess.run(["systemd-run", "--wait", "--unit=u", "node", "x"], timeout=2)\nexcept subprocess.TimeoutExpired:\n    pass\n';
  // Mirrors the launcher pattern: stop, then require explicit ActiveState=inactive.
  const newFlow = 'import subprocess, time\nconfirmed = False\ntry:\n    subprocess.run(["systemd-run", "--wait", "--unit=u", "node", "x"], timeout=2)\nexcept subprocess.TimeoutExpired:\n    subprocess.run(["systemctl", "stop", "u"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)\n    for _ in range(10):\n        probe = subprocess.run(["systemctl", "show", "--property=ActiveState", "--value", "u"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)\n        if probe.returncode == 0 and probe.stdout.decode().strip() == "inactive":\n            confirmed = True\n            break\n        time.sleep(0.2)\nprint("CONFIRMED" if confirmed else "UNCONFIRMED")\n';
  fs.rmSync(calls, { force: true });
  spawnSync('python3', ['-c', oldFlow], { env, timeout: 20000 });
  assert.equal(fs.existsSync(marker), true, 'old flow (no stop) leaves the unit alive after client timeout');
  fs.rmSync(calls, { force: true });
  const probed = spawnSync('python3', ['-c', newFlow], { env, timeout: 30000 });
  assert.equal(probed.status, 0, probed.stderr.toString());
  assert.match(probed.stdout.toString(), /CONFIRMED/);
  assert.equal(fs.existsSync(marker), false, 'new flow (stop + observe inactive) leaves no live unit');
  assert.match(fs.readFileSync(calls, 'utf8'), /systemctl stop/);
  // Unknown manager status (show fails) must NOT count as confirmed stopped.
  fs.rmSync(calls, { force: true });
  const unknown = spawnSync('python3', ['-c', newFlow], { env: { ...env, SHOW_MODE: 'fail' }, timeout: 30000 });
  assert.equal(unknown.status, 0, unknown.stderr.toString());
  assert.match(unknown.stdout.toString(), /UNCONFIRMED/, 'failing status query must fail closed, never confirm');
});
