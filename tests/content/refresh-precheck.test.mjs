import './fixtures/agent-sdk-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkRefreshPreSubmission } from '../../scripts/lib/refresh-precheck.mjs';
import { checkRecordPolicy, checkKindPolicy } from '../../scripts/content/submit.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';
import { refreshPrecheckCases } from './fixtures/refresh-precheck-cases.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/refresh-policy-baseline.json', import.meta.url)));
test('writer precheck and submit give identical results; refresh record policy is byte-for-byte unchanged from f258d53', () => {
  for (const { name, ...args } of refreshPrecheckCases) {
    const deps = { validateRecord, ...args.deps };
    const writer = checkRefreshPreSubmission({ ...args, deps });
    const submitted = checkRecordPolicy({ kind: 'refresh', ...args, deps });
    assert.deepEqual(submitted, baseline[name], `${name}: staging policy semantics`);
    assert.deepEqual({ errors: writer.errors, lint: writer.lint, refusalDetail: writer.refusalDetail }, submitted, name);
    const vector = checkKindPolicy({ kind: 'refresh', items: [args.item], ctx: args.ctx, live: args.live, deps });
    assert.equal(vector.ok, writer.ok, name);
    assert.deepEqual(vector.errors, [...writer.errors, ...writer.lint].map((message) => `data/posts.json: fitness-review: ${message}`), name);
  }
});

test('one revision sees scope, storage, title and image failures together', async () => {
  const args = refreshPrecheckCases[0];
  const original = args.ctx.refresh.original;
  const payload = { ...args.item.payload, title: 'Yoga guide', unknown: 'field', content: original.content + '\nChanged body.' };
  const imageError = Object.assign(new Error('image-missing: fixture'), { code: 'ValidationError', reason: 'image-missing' });
  const result = await checkRefreshPreSubmission({ ...args, before: [original], after: [payload],
    deps: { ...args.deps, prepareImages: async () => { throw imageError; } } });
  assert.equal(result.ok, false);
  const codes = new Set(result.findings.map((finding) => finding.rule));
  for (const code of ['refresh-snippet-overreach', 'storage', 'draft-changed-topic', 'image-missing']) assert.ok(codes.has(code), code);
});
