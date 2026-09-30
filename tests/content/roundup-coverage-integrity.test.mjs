// roundupCoverage integrity on every write path (docs/specs/weekly-roundup-v2.md
// §6.6 R6, A3), against local PG through the real submit, checkRecordPolicy, the
// gate and the fixer adapter. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAST_SMOKE, hasTestDb, localSite, publishDirect, seededDb } from './fixtures/content-db.mjs';
import { buildFixture, unit } from './fixtures/roundup-v2.mjs';
import { checkRecordPolicy, liveContext, policyDeps, submitContent } from '../../scripts/content/submit.mjs';
import { makeRowRepairValidator } from '../../scripts/content/repair-adapter.mjs';
import { exportContent } from '../../scripts/content/export.mjs';
import { adminAction, readLive } from '../../scripts/content/store.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const prior = buildFixture({ now: '2026-09-23T12:00:00.000Z', units: [unit('p1', { date: '2026-09-24' }), unit('p2', { verdict: 'adjacent', date: '2026-09-25' }), unit('p3', { verdict: 'adjacent', date: '2026-09-26' })] });

async function setup(t) {
  const handle = await seededDb();
  await publishDirect(handle.db, { items: [{ dataset: 'posts', key: prior.slug, payload: prior.post }], idempotencyKey: 'live-roundup' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-coverage-integrity-'));
  t.after(async () => { fs.rmSync(root, { recursive: true, force: true }); await handle.close(); });
  return { ...handle, root };
}

// Export the live store, apply `edit` to data/posts.json, and submit the diff.
async function editAndSubmit(ctx, kind, key, edit, idempotencyKey) {
  const root = fs.mkdtempSync(path.join(ctx.root, `${kind}-`));
  await exportContent(ctx.db, { root });
  fs.symlinkSync(path.join(ROOT, 'public'), path.join(root, 'public'));
  const file = path.join(root, 'data', 'posts.json');
  const posts = readJson(file);
  edit(posts);
  fs.writeFileSync(file, JSON.stringify(posts, null, 2));
  return submitContent(ctx.db, { kind, dir: root, idempotencyKey, actor: `uat:${kind}` }, { checkout: ROOT });
}
const findPost = (posts, slug) => posts.find((post) => post.slug === slug);

test('R6: seo and manual inserts may not create roundupCoverage', { skip }, async (t) => {
  const ctx = await setup(t);
  for (const kind of ['seo', 'manual']) {
    await assert.rejects(editAndSubmit(ctx, kind, 'x', (posts) => {
      posts.push({ ...prior.post, slug: `forged-${kind}-post`, title: 'Forged', roundupCoverage: { ...prior.coverage } });
    }, `insert-${kind}`), /roundupCoverage/);
  }
});

test('R6: seo/manual edits of a live roundup that change, clear or remove the field are refused; copy-only edits pass and keep coverage', { skip, timeout: 120_000 }, async (t) => {
  const ctx = await setup(t);
  const edits = {
    change: (post) => { post.roundupCoverage = { ...post.roundupCoverage, keys: [...post.roundupCoverage.keys, 'road:forged'] }; },
    clear: (post) => { post.roundupCoverage = { ...post.roundupCoverage, keys: [] }; },
    remove: (post) => { delete post.roundupCoverage; },
  };
  for (const kind of ['seo', 'manual']) {
    for (const [name, edit] of Object.entries(edits)) {
      await assert.rejects(editAndSubmit(ctx, kind, prior.slug, (posts) => edit(findPost(posts, prior.slug)), `${kind}-${name}`),
        /roundupCoverage must be preserved byte-identically/, `${kind} ${name}`);
    }
  }
  const accepted = await editAndSubmit(ctx, 'manual', prior.slug, (posts) => {
    const post = findPost(posts, prior.slug);
    post.description = `${post.description} Updated wording.`;
  }, 'manual-copy-only');
  assert.ok(accepted.result.submissionId);
  const site = await localSite(ctx.db);
  t.after(() => site.close());
  await site.build();
  const script = path.join(ctx.root, 'pass.json');
  fs.writeFileSync(script, JSON.stringify({ reviews: [{ overall: 9, findings: [] }] }));
  const { gateContent } = await import('../../scripts/content/gate.mjs');
  const gated = await gateContent(ctx.db, { submission: accepted.result.submissionId, script, actor: 'uat:manual' }, { env: site.env, deps: { smoke: FAST_SMOKE }, checkout: ROOT });
  assert.equal(gated.exitCode, 0, JSON.stringify(gated.result));
  const exported = fs.mkdtempSync(path.join(ctx.root, 'after-'));
  await exportContent(ctx.db, { root: exported });
  const live = findPost(readJson(path.join(exported, 'data', 'posts.json')), prior.slug);
  assert.match(live.description, /Updated wording/);
  assert.deepEqual(live.roundupCoverage, prior.coverage, 'coverage unchanged in the next export');
});

test('R6: gate-fixer revisions may not touch roundupCoverage (seo and roundup submissions)', { skip }, async (t) => {
  const ctx = await setup(t);
  const live = await liveContext(ctx.db);
  t.after(() => live.cleanup());
  const current = findPost(live.live.posts, prior.slug);
  const candidates = [{ dataset: 'posts', key: prior.slug, op: 'update', payload: current }];
  const deps = policyDeps({ kind: 'seo', context: { root: live.root }, checkout: ROOT });
  const seoValidator = makeRowRepairValidator({ kind: 'seo', candidates, ctx: { now: '2026-09-30T12:00:00.000Z' }, live: live.live, deps });
  const repaired = { ...current, description: `${current.description} Clarified.`, roundupCoverage: { ...current.roundupCoverage, keys: ['road:forged'] } };
  const plan = { plan_type: 'record-repair', reason: 'fix finding', files: [{ file: 'data/posts.json', records: [{ key: prior.slug, record: repaired }] }] };
  assert.equal(seoValidator(plan).ok, false);
  const seoPolicy = checkRecordPolicy({ kind: 'seo', item: { dataset: 'posts', key: prior.slug, op: 'update', payload: repaired }, live: live.live, deps: { validateRecord } });
  assert.match(seoPolicy.errors.join('; '), /roundupCoverage must be preserved byte-identically by a seo edit/);
  // A roundup submission's fixer runs under kind roundup: equality with its verified context.
  const fresh = buildFixture({ now: '2026-09-30T12:00:00.000Z', units: [unit('a', { date: '2026-10-01' }), unit('b', { verdict: 'adjacent', date: '2026-10-02' }), unit('c', { verdict: 'adjacent', date: '2026-10-03' })] });
  const roundupCtx = { pipeline: 'structured-v2', now: fresh.result.now, temporalValidationNow: '2026-09-30T12:01:00.000Z', isoWeek: fresh.isoWeek,
    weekStartUtc: '2026-09-28T00:00:00.000Z', units: fresh.pack.units, stillInEffect: [], roundupCoverage: fresh.coverage };
  const roundupCandidates = [{ dataset: 'posts', key: fresh.slug, op: 'insert', payload: fresh.post }];
  const roundupDeps = { ...policyDeps({ kind: 'roundup', context: { root: live.root }, checkout: ROOT }), lintMode: 'warn' };
  const roundupValidator = makeRowRepairValidator({ kind: 'roundup', candidates: roundupCandidates, ctx: roundupCtx, live: live.live, deps: roundupDeps });
  const tampered = { ...fresh.post, description: `${fresh.post.description} Clarified.`, roundupCoverage: { ...fresh.coverage, keys: fresh.coverage.keys.slice(1) } };
  const refused = roundupValidator({ plan_type: 'record-repair', reason: 'fix', files: [{ file: 'data/posts.json', records: [{ key: fresh.slug, record: tampered }] }] });
  assert.equal(refused.ok, false);
  const roundupPolicy = checkRecordPolicy({ kind: 'roundup', item: { dataset: 'posts', key: fresh.slug, op: 'insert', payload: tampered }, ctx: roundupCtx, live: live.live, deps: roundupDeps });
  assert.match(roundupPolicy.errors.join('; '), /roundupCoverage does not match the verified pack/);
  const copyOnly = roundupValidator({ plan_type: 'record-repair', reason: 'fix', files: [{ file: 'data/posts.json', records: [{ key: fresh.slug, record: { ...fresh.post, description: `${fresh.post.description} Clarified.` } }] }] });
  assert.equal(copyOnly.ok, true, copyOnly.errors.join('; '));
});

test('R6: unpublishing the whole roundup post is allowed and its keys leave live coverage', { skip }, async (t) => {
  const ctx = await setup(t);
  const coveredBefore = (await readLive(ctx.db)).datasets.posts.records.find((post) => post.slug === prior.slug)?.roundupCoverage?.keys;
  assert.deepEqual(coveredBefore, prior.coverage.keys);
  await adminAction(ctx.db, { op: 'unpublish', dataset: 'posts', key: prior.slug, actor: 'uat:admin', reason: 'test unpublish', idempotencyKey: 'unpublish-roundup', owner: 'uat:admin' });
  const after = (await readLive(ctx.db)).datasets.posts.records;
  assert.equal(after.some((post) => post.slug === prior.slug), false);
  assert.equal(after.flatMap((post) => post.roundupCoverage?.keys ?? []).length, 0, 'nothing live covers its keys');
});
