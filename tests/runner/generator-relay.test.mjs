// Drives the REAL embedded lv-runner-generator helper block with fake
// systemd-run/systemctl and sandboxed paths: its stdout must carry exactly one
// validated relay line after a normal unit completion, and nothing otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const owned = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ops/exedev-runner');
const launcher = fs.readFileSync(path.join(owned, 'launcher.sh'), 'utf8');
const block = launcher.split("<<'PY'")[1].split('\nPY')[0];
const SLOT = 'relay-test-slot';
const REFUSAL = '{"postWritten":false,"stopReason":"unsupported-grounding"}';
const TRAILER = (outcome) => `\n=== Pipeline Complete ===\nSuccess: true\n[outcome] ${outcome}\nCost: $0.1\nTurns: 3\nDuration: 9.0s\nLog saved: /x.json\n`;
const PROSE = '[agent] Candidate Name at 1 Private Rd is pet-friendly sk-PRIVATE\n[tool_use] Bash\nPipeline error: https://serpapi.com/?api_key=sk-PRIVATE\n';

function sandbox(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-relay-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dirs = { varlib: path.join(temp, 'varlib'), run: path.join(temp, 'run'), log: path.join(temp, 'log'), bin: path.join(temp, 'bin') };
  for (const dir of [path.join(dirs.varlib, 'scratch', SLOT), path.join(dirs.varlib, 'generator-requests'), path.join(dirs.run, 'agent-secrets'), dirs.log, dirs.bin]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dirs.run, 'agent-secrets', `${SLOT}.json`), JSON.stringify({ ANTHROPIC_API_KEY: 'sk-PRIVATE' }));
  fs.writeFileSync(path.join(dirs.varlib, 'generator-requests', `${SLOT}.json`), JSON.stringify({ topic: 'Candidate Topic', dryRun: false }));
  // Fake unit: replay FAKE_OUT to the captured pipe, then exit FAKE_CODE (or hang).
  fs.writeFileSync(path.join(dirs.bin, 'systemd-run'), '#!/usr/bin/env bash\n[[ "${FAKE_HANG:-}" == 1 ]] && exec sleep 30\ncat "$FAKE_OUT"\nexit "${FAKE_CODE:-0}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dirs.bin, 'systemctl'), '#!/usr/bin/env bash\nif [[ "$1" == stop ]]; then touch "$FAKE_STATE.stopped"; exit 0; fi\nif [[ "$1" == show ]]; then\n  if [[ "${FAKE_ACTIVE:-}" == 1 && ! -e "$FAKE_STATE.stopped" ]]; then echo active; else echo inactive; fi\n  exit 0\nfi\nexit 0\n', { mode: 0o755 });
  // Root/identity and fixed VM paths are the only substitutions; the helper logic runs unmodified.
  const prelude = 'import os as _os, pwd as _pwd\n_os.geteuid = lambda: 0\n_pwd.getpwnam = lambda _name: _pwd.getpwuid(_os.getuid())\n';
  const script = prelude + block
    .replace("sys.path.insert(0, '/usr/local/libexec')", `sys.path.insert(0, ${JSON.stringify(owned)})`)
    .replaceAll('/var/lib/lv-runner', dirs.varlib).replaceAll('/run/lv-runner', dirs.run).replaceAll('/var/log/lv-generator', dirs.log)
    .replace('CLIENT_TIMEOUT = 45 * 60', 'CLIENT_TIMEOUT = 2');
  assert.notEqual(script.indexOf('CLIENT_TIMEOUT = 2'), -1);
  return (output, env = {}) => {
    const out = path.join(temp, 'unit-output');
    fs.writeFileSync(out, output);
    fs.rmSync(path.join(temp, 'state.stopped'), { force: true });
    const run = spawnSync('python3', ['-B', '-', 'weekly-blog', SLOT], {
      input: script, encoding: 'utf8', timeout: 30_000,
      env: { PATH: `${dirs.bin}:${process.env.PATH}`, FAKE_OUT: out, FAKE_STATE: path.join(temp, 'state'), ...env },
    });
    const logs = fs.readdirSync(dirs.log).map((name) => fs.readFileSync(path.join(dirs.log, name), 'utf8')).join('');
    for (const name of fs.readdirSync(dirs.log)) fs.rmSync(path.join(dirs.log, name));
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, logs, envLeft: fs.existsSync(path.join(dirs.run, `generator-${SLOT}.env`)) };
  };
}

test('validated refusal after normal completion: one relay line, unit exit code preserved', (t) => {
  const helper = sandbox(t);
  const refused = helper(PROSE + TRAILER(REFUSAL), { FAKE_CODE: '1' });
  assert.equal(refused.status, 1, refused.stderr);
  assert.equal(refused.stdout, `${REFUSAL}\n`);
  assert.equal(refused.envLeft, false);
  const posted = helper(PROSE + TRAILER('{"postWritten":true,"stopReason":"post-written"}'), { FAKE_CODE: '0' });
  assert.equal(posted.status, 0, posted.stderr);
  assert.equal(posted.stdout, '{"postWritten":true,"stopReason":"post-written"}\n');
  const insufficient = helper(TRAILER('{"postWritten":false,"stopReason":"insufficient-sources"}'), { FAKE_CODE: '1' });
  assert.equal(insufficient.stdout, '{"postWritten":false,"stopReason":"insufficient-sources"}\n');
});

test('duplicate, malformed, out-of-vocabulary or contradictory outcomes relay only absent', (t) => {
  const helper = sandbox(t);
  for (const [output, code] of [
    [TRAILER(REFUSAL) + `[outcome] ${REFUSAL}\n`, '1'],
    [TRAILER('{"postWritten":false,"stopReason":"unsupported-grounding"'), '1'],
    [TRAILER('{"postWritten":false,"stopReason":"pet-friendly"}'), '1'],
    [TRAILER('{"postWritten":true,"stopReason":"unsupported-grounding"}'), '1'],
    [TRAILER(REFUSAL), '0'],
    [PROSE, '1'],
  ]) {
    const run = helper(output, { FAKE_CODE: code });
    assert.equal(run.status, Number(code), run.stderr);
    assert.equal(run.stdout, '{"postWritten":false,"stopReason":"absent"}\n', output);
  }
});

test('timeout, abnormal exit or a unit still active after exit emit nothing on stdout', (t) => {
  const helper = sandbox(t);
  const timedOut = helper(TRAILER(REFUSAL), { FAKE_HANG: '1' });
  assert.equal(timedOut.status, 124, timedOut.stderr);
  assert.equal(timedOut.stdout, '');
  assert.match(timedOut.logs, /"event":"unit-timeout"/);
  const killed = helper(TRAILER(REFUSAL), { FAKE_CODE: '137' });
  assert.equal(killed.status, 137);
  assert.equal(killed.stdout, '');
  const lingering = helper(TRAILER(REFUSAL), { FAKE_CODE: '1', FAKE_ACTIVE: '1' });
  assert.equal(lingering.status, 1);
  assert.equal(lingering.stdout, '', 'a unit that outlived its exit is not a normal completion');
});

test('helper stdout and diagnostics never carry prose, secrets, topic or URLs', (t) => {
  const helper = sandbox(t);
  for (const [output, code] of [[PROSE + TRAILER(REFUSAL), '1'], [PROSE, '0'], [PROSE.repeat(2000), '1']]) {
    const run = helper(output, { FAKE_CODE: code });
    assert.ok(run.stdout.split('\n').filter(Boolean).length <= 1);
    assert.ok(Buffer.byteLength(run.stdout) <= 80);
    for (const secret of ['Candidate', 'sk-PRIVATE', 'pet-friendly', 'serpapi', 'Private Rd']) {
      assert.doesNotMatch(run.stdout + run.stderr + run.logs, new RegExp(secret));
    }
  }
});
