import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const runner = fs.readFileSync(new URL('../../ops/exedev-runner/runner.mjs', import.meta.url), 'utf8');
const launcher = fs.readFileSync(new URL('../../ops/exedev-runner/launcher.sh', import.meta.url), 'utf8');
const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-scratch-cleanup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('generator failure removes scratch and preserves the original failure if cleanup fails', (t) => {
  const temp = tempDir(t);
  const repo = path.join(temp, 'repo');
  const state = path.join(temp, 'state');
  const bin = path.join(temp, 'bin');
  fs.mkdirSync(path.join(repo, 'data'), { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(repo, 'data/posts.json'), '[]');
  fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nprintf \'{"postWritten":false,"stopReason":"generator-error"}\\n\'\nexit 1\n', { mode: 0o755 });
  // Expose the private flow in a disposable module, leaving production exports unchanged.
  const modulePath = path.join(temp, 'runner.mjs');
  fs.writeFileSync(modulePath, `${runner}\nexport { generator };\n`);
  for (const failure of ['generator', 'copy', 'cleanup']) {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      import { pathToFileURL } from 'node:url';
      const { generator } = await import(pathToFileURL(process.env.PROBE_MODULE));
      const scratch = process.env.LV_RUNNER_STATE_ROOT + '/scratch/failure-slot';
      if (process.env.PROBE_FAILURE === 'copy') {
        fs.cpSync = () => { fs.writeFileSync(scratch + '/partial-copy', 'partial'); throw new Error('copy ENOSPC'); };
      }
      if (process.env.PROBE_FAILURE === 'cleanup') {
        const remove = fs.rmSync;
        let calls = 0;
        fs.rmSync = (...args) => { if (++calls > 1) throw new Error('cleanup EACCES'); return remove(...args); };
      }
      assert.throws(() => generator('weekly-blog', 'failure-slot', null, false, '/dev/null'),
        process.env.PROBE_FAILURE === 'copy' ? /copy ENOSPC/ : /generator technical failure/);
      if (process.env.PROBE_FAILURE !== 'cleanup') assert.equal(fs.existsSync(scratch), false, 'failed generator left scratch behind');
      console.log(process.env.PROBE_FAILURE + ': original error preserved; scratch cleanup checked');
    `], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LV_RUNNER_REPO: repo, LV_RUNNER_STATE_ROOT: state, PROBE_MODULE: modulePath, PROBE_FAILURE: failure },
    });
    assert.equal(probe.status, 0, `${failure}: ${probe.stdout}${probe.stderr}`);
  }
});

test('stale sweep uses age and active/current slots, visits direct children, and never follows symlinks', (t) => {
  const temp = tempDir(t);
  const scratch = path.join(temp, 'scratch');
  const secrets = path.join(temp, 'agent-secrets');
  const bin = path.join(temp, 'bin');
  for (const dir of [scratch, secrets, bin]) fs.mkdirSync(dir);
  const now = 1_800_000_000;
  const cutoff = now - 2 * 86400;
  const age = (entry, stamp) => fs.lutimesSync(entry, stamp, stamp);
  for (const [slot, stamp] of [
    ['stale-slot', cutoff - 1], ['recent-slot', cutoff + 1], ['cutoff-slot', cutoff],
    ['current-slot', cutoff - 100], ['runner-slot', cutoff - 100], ['generator-slot', cutoff - 100],
  ]) {
    fs.mkdirSync(path.join(scratch, slot));
    fs.writeFileSync(path.join(secrets, `${slot}.json`), '{}');
    age(path.join(scratch, slot), stamp);
    age(path.join(secrets, `${slot}.json`), stamp);
  }
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep'), 'untouched');
  fs.symlinkSync(outside, path.join(scratch, 'symlink-slot'));
  age(path.join(scratch, 'symlink-slot'), cutoff - 1);
  fs.symlinkSync(outside, path.join(scratch, 'stale-slot', 'nested-link'));
  age(path.join(scratch, 'stale-slot'), cutoff - 1);
  fs.mkdirSync(path.join(scratch, 'recent-slot', 'old-nested-slot'));
  age(path.join(scratch, 'recent-slot', 'old-nested-slot'), cutoff - 100);
  age(path.join(scratch, 'recent-slot'), cutoff + 1);
  fs.writeFileSync(path.join(secrets, 'orphan-slot.json'), '{}');
  age(path.join(secrets, 'orphan-slot.json'), cutoff - 1);
  fs.writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\n[ "$FAKE_STATUS" = fail ] && exit 1\nprintf "%s\\n" "$FAKE_UNITS"\n', { mode: 0o755 });
  const block = launcher.split("<<'PY_SCRATCH_SWEEP'\n")[1]?.split('\nPY_SCRATCH_SWEEP')[0];
  assert.ok(block, 'launcher must execute the stale sweep');
  assert.ok(launcher.indexOf("<<'PY_SCRATCH_SWEEP'") < launcher.indexOf('runuser -u lv-runner'));
  const script = `import time\ntime.time = lambda: ${now}\n` + block
    .replaceAll('/var/lib/lv-runner/scratch', scratch).replaceAll('/run/lv-runner/agent-secrets', secrets);
  const run = (status) => spawnSync('python3', ['-B', '-'], {
    input: script, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LV_RUNNER_SLOT: 'current-slot', FAKE_STATUS: status,
      FAKE_UNITS: 'lv-runner@weekly-blog:production:runner-slot.service loaded activating start\nlv-generator-generator-slot-abcd.service loaded active running' },
  });
  const unavailable = run('fail');
  assert.equal(unavailable.status, 0, unavailable.stderr);
  assert.match(unavailable.stdout, /sweep skipped/);
  assert.ok(fs.existsSync(path.join(scratch, 'stale-slot')));
  const swept = run('ok');
  assert.equal(swept.status, 0, swept.stderr);
  assert.deepEqual(fs.readdirSync(scratch).sort(), ['current-slot', 'cutoff-slot', 'generator-slot', 'recent-slot', 'runner-slot']);
  assert.deepEqual(fs.readdirSync(secrets).sort(), ['current-slot.json', 'cutoff-slot.json', 'generator-slot.json', 'recent-slot.json', 'runner-slot.json']);
  assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'untouched');
  assert.ok(fs.existsSync(path.join(scratch, 'recent-slot', 'old-nested-slot')));
  assert.equal(swept.stdout.split('\n').filter((line) => line.includes('sweep removed')).length, 4, swept.stdout);
});
