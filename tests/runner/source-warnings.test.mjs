import test from 'node:test';
import assert from 'node:assert/strict';
import { command, sourceWarnings } from '../../ops/exedev-runner/runner.mjs';

test('a discovery source failure on stderr reaches the runner log as a bounded warning', () => {
  const script = "console.error('topic discovery: PostHog source failed: buildPosthogLandingQuery is not a function'); console.error('unrelated noise SECRET=x');";
  const result = command(process.execPath, ['-e', script]);
  assert.equal(result.code, 0);
  assert.deepEqual(sourceWarnings(result.stderr), ['topic discovery: PostHog source failed: buildPosthogLandingQuery is not a function']);
  assert.deepEqual(sourceWarnings(''), []);
  assert.equal(sourceWarnings(`topic discovery: PostHog source failed: ${'x'.repeat(500)}`)[0].length, 200);
});
