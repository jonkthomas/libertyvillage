import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPromotionControl, runPromotionControlCli } from '../../scripts/automation/promotion-control.mjs';

const CLI = fs.readFileSync(new URL('../../scripts/automation/promotion-control.mjs', import.meta.url), 'utf8');

function ownerFixture(owner) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-promotion-control-'));
  const ownerFile = path.join(directory, 'owner.txt');
  fs.writeFileSync(ownerFile, `${owner}\n`);
  return ownerFile;
}

test('promotion CLI reports a clean successful skip for canonical exedev ownership', () => {
  const messages = [];
  assert.equal(runPromotionControl(
    { LV_WEEKLY_OWNER: 'exedev', LV_PROMOTION_ENABLED: 'true' },
    { ownerFile: ownerFixture('exedev') },
    { log: (message) => messages.push(message) },
  ), 'skipped');
  assert.deepEqual(messages, ['promotion skipped: canonical weekly owner is exedev']);
  assert.match(CLI, /try \{\s*runPromotionControlCli\(\);/s);
});

test('promotion CLI keeps owner mismatches and the GHA emergency override loud', () => {
  assert.throws(() => runPromotionControl(
    { LV_WEEKLY_OWNER: 'gha' },
    { ownerFile: ownerFixture('exedev') },
  ), /weekly owner mismatch/);

  const messages = [];
  assert.throws(() => runPromotionControl(
    { LV_PROMOTION_ENABLED: 'false' },
    { ownerFile: ownerFixture('gha') },
    { log: (message) => messages.push(message) },
  ), /LV_PROMOTION_ENABLED=false emergency override/);
  assert.deepEqual(messages, []);
  assert.match(CLI, /process\.exitCode = 1/);
});

test('GitHub output reports enabled from injected canonical owner fixtures', () => {
  for (const [owner, enabled] of [['gha', 'true'], ['exedev', 'false']]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-promotion-output-'));
    const output = path.join(directory, 'github-output');
    const messages = [];
    const result = runPromotionControlCli({
      args: ['--github-output'],
      env: { GITHUB_OUTPUT: output },
      options: { ownerFile: ownerFixture(owner) },
      logger: { log: (message) => messages.push(message) },
    });
    assert.equal(result, owner === 'gha' ? 'enabled' : 'skipped');
    assert.equal(fs.readFileSync(output, 'utf8'), `enabled=${enabled}\n`);
    assert.equal(messages.length, 1);
  }
});

test('GitHub output mode fails before writing on overrides, mismatches, or missing output path', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-promotion-output-fail-'));
  const output = path.join(directory, 'github-output');
  assert.throws(() => runPromotionControlCli({
    args: ['--github-output'], env: { GITHUB_OUTPUT: output, LV_PROMOTION_ENABLED: 'false' },
    options: { ownerFile: ownerFixture('gha') },
  }), /emergency override/);
  assert.equal(fs.existsSync(output), false);
  assert.throws(() => runPromotionControlCli({
    args: ['--github-output'], env: { GITHUB_OUTPUT: output, LV_WEEKLY_OWNER: 'gha' },
    options: { ownerFile: ownerFixture('exedev') },
  }), /weekly owner mismatch/);
  assert.equal(fs.existsSync(output), false);
  assert.throws(() => runPromotionControlCli({
    args: ['--github-output'], env: {}, options: { ownerFile: ownerFixture('gha') },
  }), /GITHUB_OUTPUT is required/);
});
