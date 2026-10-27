import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateRecord } from '../../scripts/content/validate.mjs';
import { lintPost } from '../../scripts/blog-lint.mjs';
import { checkRefreshPreSubmission } from '../../scripts/lib/refresh-precheck.mjs';
import { checkRecordPolicy } from '../../scripts/content/submit.mjs';
import { refreshPrecheckCases } from './fixtures/refresh-precheck-cases.mjs';

const phrases = ['delve', 'nestled', 'vibrant', 'bustling', 'hidden gem', 'tapestry',
  'elevate', 'seamless', 'leverage', 'robust', 'game changer', "whether you're", 'in conclusion'];

test('every requested phrase warns, without changing the record or blocking it', () => {
  for (const phrase of phrases) {
    const post = { title: phrase.toUpperCase().replaceAll("'", '’') };
    const before = JSON.stringify(post);
    const checked = lintPost(post);
    assert.equal(checked.ok, true, phrase);
    assert.deepEqual(checked.findings, []);
    assert.ok(checked.warnings?.some((w) => w.rule === 'voice-banned-phrase'), phrase);
    assert.equal(JSON.stringify(post), before);
    assert.equal(lintPost(post, { voiceBlocking: true }).ok, false, phrase);
  }
  assert.deepEqual(lintPost({ title: 'Check the local listing for current hours.' }), { ok: true, findings: [] });
  assert.deepEqual(lintPost({ content: '[a local resource](https://example.test/vibrant) and `robust` code.' }), { ok: true, findings: [] });
});

test('framings, density, FAQs and takeaways warn; low dash density and ordinary words pass', () => {
  const checked = lintPost({ title: 'Not a guide, but a lifestyle.', description: 'That’s it.',
    content: 'Local — clear — useful.', faqs: [{ question: 'Seamless?', answer: 'Hidden gem.' }], keyTakeaways: ['Leverage it.'] });
  assert.equal(checked.ok, true);
  assert.ok(checked.warnings.some((w) => w.rule === 'voice-framing' && w.field === 'title'));
  assert.ok(checked.warnings.some((w) => w.rule === 'voice-framing' && w.field === 'description'));
  assert.ok(checked.warnings.some((w) => w.rule === 'voice-em-dash-density'));
  assert.ok(checked.warnings.some((w) => w.field === 'faqs[0].answer'));
  assert.ok(checked.warnings.some((w) => w.field === 'keyTakeaways[0]'));
  assert.equal(lintPost({ content: 'Local — clear.' }).warnings, undefined);
  assert.equal(lintPost({ content: `${'word '.repeat(200)} — local — clear.` }).warnings, undefined);
  assert.equal(lintPost({ title: 'The leverageable delver.' }).warnings, undefined);
});

test('writer and trusted submit preserve warn-only behavior and existing failures', () => {
  const args = refreshPrecheckCases[0];
  const item = { ...args.item, payload: { ...args.item.payload, description: 'A vibrant local fitness review.' } };
  const writer = checkRefreshPreSubmission({ ...args, item });
  const submitted = checkRecordPolicy({ kind: 'refresh', ...args, item, deps: { ...args.deps, validateRecord } });
  assert.equal(writer.ok, true);
  assert.ok(writer.warnings.length > 0);
  assert.deepEqual(submitted.warnings, writer.warnings);
  assert.deepEqual(submitted.errors, []);
  assert.deepEqual(submitted.lint, []);
  const bad = refreshPrecheckCases.find((c) => c.name === 'lint');
  const badItem = { ...bad.item, payload: { ...bad.item.payload, description: 'A vibrant review.' } };
  const rejected = checkRefreshPreSubmission({ ...bad, item: badItem });
  assert.equal(rejected.ok, false, 'existing unsupported-address remains blocking during rollout');
  assert.ok(rejected.findings.some((f) => f.rule === 'unsupported-address'));
});

test('real blog lint command prints a warning, exits zero, and blocks only with explicit flag', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-voice-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const post = path.join(dir, 'post.json');
  fs.writeFileSync(post, JSON.stringify({ title: 'A vibrant local guide.' }));
  const args = ['scripts/blog-lint.mjs', '--post', post];
  const warn = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, LV_VOICE_BLOCKING: '' } });
  assert.equal(warn.status, 0, warn.stderr);
  assert.match(warn.stdout, /WARN \[voice-banned-phrase\]/);
  assert.match(warn.stdout, /"warnOnlySince":"2026-10-27"/);
  const block = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, LV_VOICE_BLOCKING: '1', LINT_MODE: 'warn' } });
  assert.equal(block.status, 1);
  assert.match(block.stderr, /refused the draft/);
});
