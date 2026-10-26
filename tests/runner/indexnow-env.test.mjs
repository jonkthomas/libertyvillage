import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { command, trustedEnv } from '../../ops/exedev-runner/runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexnow = pathToFileURL(path.join(root, 'scripts/content/indexnow.mjs')).href;
const base = { PATH: process.env.PATH, HOME: '/tmp', CONTENT_TARGET: 'production', CONTENT_SITE_URL: 'https://libertyvillage.co', ANTHROPIC_API_KEY: 'k' };

test('trustedEnv passes INDEXNOW_ENABLED through to the content CLI when the runner env sets it', () => {
  assert.equal(trustedEnv({ ...base, INDEXNOW_ENABLED: '1' }).INDEXNOW_ENABLED, '1');
});

test('trustedEnv omits INDEXNOW_ENABLED when it is unset (staging stays off, no default)', () => {
  assert.equal('INDEXNOW_ENABLED' in trustedEnv(base), false);
  assert.equal('INDEXNOW_ENABLED' in trustedEnv({ ...base, INDEXNOW_ENABLED: '' }), false);
});

// The runner's cli() spawns scripts/content/cli.mjs with command(node, ..., { env: trustedEnv(process.env) }).
// Drive the same spawn and run the real pingIndexNow gate against the child's process.env.
function childPing(env) {
  const script = `const { pingIndexNow } = await import(${JSON.stringify(indexnow)});
const result = await pingIndexNow({ urls: ['https://libertyvillage.co/blog/x'],
  env: process.env, fetchImpl: async () => ({ ok: true, status: 200 }), log: () => {} });
process.stdout.write(JSON.stringify(result ?? null));`;
  return JSON.parse(command(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: trustedEnv(env) }).stdout);
}

test('a child spawned with trustedEnv sees INDEXNOW_ENABLED and pingIndexNow fires', () => {
  assert.deepEqual(childPing({ ...base, INDEXNOW_ENABLED: '1' }), { status: 200, count: 1 });
});

test('a child spawned with trustedEnv and no flag keeps pingIndexNow disabled', () => {
  assert.deepEqual(childPing(base), { skipped: 'disabled' });
});
