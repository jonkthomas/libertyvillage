// Active ordinary-CI successor for the frozen PR #104 canary eval.
// tests/automation/canary104-grounding.eval.mjs is ARCHIVED AT REST: its bytes and
// evals/canary104-grounding.sha256 are the original lock and must not change.
// This file executes every live check in those original bytes and supersedes only
// the one historical assertion that read the retired autonomous-coordinator.yml.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CANARY = 'tests/automation/canary104-grounding.eval.mjs';
const ORIGINAL_SHA = '46a54c5a0f58a3ed831d485a66e57f6b81ba0eb21dc820765a793c9a141b1878';
const SUPERSEDED = '[RED] the additive canary eval is part of the ordinary automation CI command';
const read = (rel) => fs.readFileSync(new URL(rel, `file://${ROOT}`));

test('archived canary eval and every locked fixture keep their original hashes', () => {
  assert.equal(crypto.createHash('sha256').update(read(CANARY)).digest('hex'), ORIGINAL_SHA);
  const lines = read('evals/canary104-grounding.sha256').toString().split('\n').filter((l) => /^[0-9a-f]{64}  /.test(l));
  assert.equal(lines.length, 8);
  assert.ok(lines.includes(`${ORIGINAL_SHA}  ${CANARY}`));
  for (const line of lines) {
    const [sha, rel] = line.split('  ');
    assert.equal(crypto.createHash('sha256').update(read(rel)).digest('hex'), sha, rel);
  }
});

test('every live check in the original canary bytes runs and passes; only the retired CI-wiring check is superseded', () => {
  const titles = [...read(CANARY).toString().matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(titles.length, 13);
  assert.ok(titles.includes(SUPERSEDED));
  const live = titles.filter((t) => t !== SUPERSEDED);
  // A nested node --test must report TAP to us, not to the parent runner.
  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap',
    `--test-skip-pattern=^${SUPERSEDED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, CANARY], { cwd: ROOT, encoding: 'utf8', env: childEnv });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const passed = [...run.stdout.matchAll(/^ok \d+ - (.+?)(?: # .*)?$/gm)].map((m) => m[1].replace(/\\([#\\])/g, '$1')); // TAP escapes # and \\
  assert.doesNotMatch(run.stdout, /^not ok /m);
  assert.deepEqual([...passed].sort(), [...live].sort());
});

test('superseded wiring: the required content check runs this successor and every other automation eval', () => {
  const command = JSON.parse(read('package.json')).scripts['test:automation'];
  assert.match(command, /tests\/automation\/\*\.test\.mjs/);
  assert.doesNotMatch(command, /canary104-grounding\.eval\.mjs|\*\.eval\.mjs/, 'archived canary must run only through this successor');
  for (const file of fs.readdirSync(`${ROOT}tests/automation`).filter((f) => f.endsWith('.eval.mjs') && f !== 'canary104-grounding.eval.mjs')) {
    assert.ok(command.includes(`tests/automation/${file}`), `${file} missing from test:automation`);
  }
  const workflow = read('.github/workflows/content-ci.yml').toString();
  assert.match(workflow, /^jobs:\n {2}content:\n/m);
  const install = workflow.search(/^ {6}- run: npm ci\s*$/m);
  const automation = workflow.search(/^ {6}- run: npm run test:automation\s*$/m);
  assert.ok(install >= 0 && automation > install);
  assert.doesNotMatch(workflow, /continue-on-error/);
});
