import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const launcher = fs.readFileSync(path.join(dirname, '../../ops/exedev-runner/launcher.sh'), 'utf8');
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
  assert.match(launcher, /is-active/);
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

test('generator path logs no secrets and captures no scratch/model output', () => {
  assert.equal((generatorBlock.match(/print\(/g) || []).length, 0, 'no print() in generator block');
  for (const run of generatorBlock.match(/subprocess\.run\(.*\)/g) || []) {
    assert.match(run, /DEVNULL/, `subprocess output must be discarded: ${run}`);
  }
  assert.doesNotMatch(generatorBlock, /print\(env|print\(secrets|os\.environ/);
});

test('launcher.sh passes bash syntax check and embedded generator python parses', () => {
  const shell = spawnSync('bash', ['-n', path.join(dirname, '../../ops/exedev-runner/launcher.sh')]);
  assert.equal(shell.status, 0, shell.stderr.toString());
  const parse = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: generatorBlock });
  assert.equal(parse.status, 0, parse.stderr.toString());
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
  fs.writeFileSync(path.join(bin, 'systemctl'), `#!/usr/bin/env bash\necho "systemctl $@" >> "${calls}"\nif [[ "$1" == stop || "$1" == kill ]]; then rm -f "${marker}"; exit 0; fi\nif [[ "$1" == is-active ]]; then [[ -e "${marker}" ]] && exit 0 || exit 3; fi\nexit 0\n`);
  fs.chmodSync(path.join(bin, 'systemd-run'), 0o755);
  fs.chmodSync(path.join(bin, 'systemctl'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const oldFlow = 'import subprocess\ntry:\n    subprocess.run(["systemd-run", "--wait", "--unit=u", "node", "x"], timeout=2)\nexcept subprocess.TimeoutExpired:\n    pass\n';
  const newFlow = 'import subprocess, time\ntry:\n    subprocess.run(["systemd-run", "--wait", "--unit=u", "node", "x"], timeout=2)\nexcept subprocess.TimeoutExpired:\n    subprocess.run(["systemctl", "stop", "u"], capture_output=True, timeout=10)\n    subprocess.run(["systemctl", "kill", "--kill-all", "u"], capture_output=True, timeout=10)\n    for _ in range(10):\n        done = subprocess.run(["systemctl", "is-active", "--quiet", "u"], timeout=10)\n        if done.returncode != 0:\n            break\n        time.sleep(1)\n';
  fs.rmSync(calls, { force: true });
  spawnSync('python3', ['-c', oldFlow], { env, timeout: 20000 });
  assert.equal(fs.existsSync(marker), true, 'old flow (no stop) leaves the unit alive after client timeout');
  fs.rmSync(calls, { force: true });
  const probed = spawnSync('python3', ['-c', newFlow], { env, timeout: 30000 });
  assert.equal(probed.status, 0, probed.stderr.toString());
  assert.equal(fs.existsSync(marker), false, 'new flow (stop + observe inactive) leaves no live unit');
  assert.match(fs.readFileSync(calls, 'utf8'), /systemctl stop/);
});
