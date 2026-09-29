// Weekly roundup v2 submit boundary (docs/specs/weekly-roundup-v2.md §9.4, §10.2,
// A2 N1, A3, A5). The v2 verifier is a stub honouring the sibling contract
// (tests/content/fixtures/roundup-v2.mjs); everything else is the real submit,
// policy, store and gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasTestDb, seededDb, localSite, FAST_SMOKE, publishDirect } from './fixtures/content-db.mjs';
import { buildFixture, igUnit, stubApi, unit, writeIgRefetch, writeOut } from './fixtures/roundup-v2.mjs';
import {
  checkRecordPolicy, checkRoundupRecordV2, ROUNDUP_IG_REFETCH_MAX_AGE_MS, ROUNDUP_REVALIDATE_MAX_AGE_MS, submitContent,
} from '../../scripts/content/submit.mjs';
import { runCli } from '../../scripts/content/cli.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';
import { ROUNDUP_PUBLICATION } from '../../scripts/content/roundup-mode.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
const now = '2026-09-30T12:00:00.000Z';
const submitClock = Date.parse(now) + 60_000;
const DISABLED = /roundup publication disabled pending structured-source review/;
const CHANGED = /roundup source evidence changed or unreachable; rebuild before submit/;
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const threeUnits = () => [unit('a', { date: '2026-10-01' }), unit('b', { verdict: 'adjacent', date: '2026-10-02' }), unit('c', { verdict: 'adjacent', date: '2026-10-03' })];
const opts = (dir, extra = {}) => ({ recordFile: path.join(dir, 'post.json'), dataset: 'posts', baseline: path.join(dir, 'baseline.json'), root: ROOT,
  roundupOut: dir, kind: 'roundup', actor: 'uat:roundup', ...extra });
const submit = (db, options, { at = submitClock, controls = {} } = {}) =>
  submitContent(db, options, { checkout: ROOT, clock: () => at, roundup: { api: stubApi(controls) } });

// ---------------------------------------------------------------------------
// CLI boundary (§10.2): before any DB is opened.
// ---------------------------------------------------------------------------
test('roundup-mode: staging is structured-v2, production stays census-only', () => {
  assert.deepEqual({ ...ROUNDUP_PUBLICATION }, { staging: 'structured-v2', production: 'census-only' });
  assert.ok(Object.isFrozen(ROUNDUP_PUBLICATION));
});

test('trusted CLI refuses roundup submit unless staging mode, a v2 result and a verifyDigest all hold', async () => {
  const fixture = buildFixture({ now, units: threeUnits() });
  const dir = writeOut(fixture);
  const args = ['submit', '--kind', 'roundup', '--roundup-out', dir, '--record-file', path.join(dir, 'post.json')];
  const cli = (argv, env) => runCli(argv, { env });
  await assert.rejects(cli(['submit', '--kind=roundup', '--roundup-out', dir], { CONTENT_TARGET: 'staging' }), DISABLED, 'equals spelling');
  await assert.rejects(cli(args, { CONTENT_TARGET: 'production' }), DISABLED, 'production target');
  await assert.rejects(cli([...args, '--target', 'production'], {}), DISABLED, 'production via --target');
  await assert.rejects(cli([...args, '--target', 'staging'], { CONTENT_TARGET: 'production' }), DISABLED, 'conflicting target bindings');
  await assert.rejects(cli(args, {}), DISABLED, 'no target bound');
  await assert.rejects(cli(['submit', '--kind', 'roundup'], { CONTENT_TARGET: 'staging' }), DISABLED, 'no --roundup-out');
  write(path.join(dir, 'result.json'), { ...fixture.result, pipeline: undefined });
  await assert.rejects(cli(args, { CONTENT_TARGET: 'staging' }), DISABLED, 'pipeline missing');
  write(path.join(dir, 'result.json'), { ...fixture.result, verifyDigest: undefined });
  await assert.rejects(cli(args, { CONTENT_TARGET: 'staging' }), DISABLED, 'verifyDigest missing');
  write(path.join(dir, 'result.json'), { ...fixture.result, verifyDigest: 'not-a-digest' });
  await assert.rejects(cli(args, { CONTENT_TARGET: 'staging' }), DISABLED, 'verifyDigest malformed');
  write(path.join(dir, 'result.json'), fixture.result);
  // All three hold: the boundary passes and the next failure is the DB binding.
  await assert.rejects(cli(args, { CONTENT_TARGET: 'staging' }), (error) => !DISABLED.test(error.message));
});

// ---------------------------------------------------------------------------
// Post policy (checkRoundupRecordV2) without a DB.
// ---------------------------------------------------------------------------
const policyCtx = (fixture, extra = {}) => ({
  pipeline: 'structured-v2', now, temporalValidationNow: new Date(submitClock).toISOString(), isoWeek: fixture.isoWeek,
  weekStartUtc: '2026-09-28T00:00:00.000Z', units: fixture.pack.units, stillInEffect: fixture.pack.stillInEffect, roundupCoverage: fixture.coverage, ...extra,
});
const news = { imageExists: () => true };
const policy = (fixture, extra) => checkRoundupRecordV2({ item: { key: fixture.slug }, record: fixture.post, ctx: policyCtx(fixture, extra), news });

test('v2 post policy accepts the assembled edition and enforces 3/1, labels, near/in and dates', () => {
  const ok = buildFixture({ now, units: threeUnits() });
  assert.deepEqual(policy(ok), []);
  const two = buildFixture({ now, units: threeUnits().slice(0, 2) });
  assert.match(policy(two).join('; '), /requires 3-12 counted units/);
  const classOnly = buildFixture({ now, units: [unit('a', { itemType: 'class', date: '2026-10-01' }), ...threeUnits().slice(1)] });
  assert.match(policy(classOnly).join('; '), /at least one core non-class unit/);
  const v1Label = buildFixture({ now, units: threeUnits(), mutatePost: (post) => { post.title = 'Liberty Village news roundup: 2026-W40'; } });
  assert.match(policy(v1Label).join('; '), /title must start with/);
  const inForAdjacent = buildFixture({ now, units: threeUnits(), mutatePost: (post) => { post.content = post.content.replace('near Liberty Village on October 2', 'in Liberty Village on October 2'); } });
  assert.match(policy(inForAdjacent).join('; '), /adjacent unit must be described as near/);
  const noDate = buildFixture({ now, units: threeUnits(), mutatePost: (post) => { post.content = post.content.replace('on October 3, 2026', 'this week'); } });
  assert.match(policy(noDate).join('; '), /actual date/);
  const outside = buildFixture({ now, units: threeUnits(), mutatePost: (post) => { post.content += '\n\nSee [elsewhere](https://example.net/other).'; } });
  assert.match(policy(outside).join('; '), /outside the verified pack/);
});

test('v2 post policy refuses unsupported impact wording unless a same-date road/transit unit or quote supports it', () => {
  const crowd = (post) => { post.content = post.content.replace('near Liberty Village on October 2, 2026.', 'near Liberty Village on October 2, 2026. Expect road closures and crowds.'); };
  const unsupported = buildFixture({ now, units: threeUnits(), mutatePost: crowd });
  assert.match(policy(unsupported).join('; '), /impact wording is not supported/);
  const road = unit('r', { verdict: 'adjacent', itemType: 'road', date: '2026-10-02', feed: true });
  const supported = buildFixture({ now, units: [...threeUnits(), road], mutatePost: crowd });
  assert.deepEqual(policy(supported), []);
});

test('v2 post policy allows a shared feed URL only with distinct record IDs', () => {
  const feedUrl = 'https://www.toronto.ca/roads/restrictions';
  const a = unit('r1', { verdict: 'adjacent', itemType: 'road', date: '2026-10-02', url: feedUrl, feed: true, recordId: 'Tor-1' });
  const b = unit('r2', { verdict: 'adjacent', itemType: 'road', date: '2026-10-03', url: feedUrl, feed: true, recordId: 'Tor-2' });
  const core = unit('core', { date: '2026-10-01' });
  assert.deepEqual(policy(buildFixture({ now, units: [core, a, b] })), []);
  const same = { ...b, citations: [{ ...b.citations[0], recordId: 'Tor-1' }] };
  assert.match(policy(buildFixture({ now, units: [core, a, same] })).join('; '), /shared across units/);
  const notFeed = unit('x', { verdict: 'adjacent', date: '2026-10-03', url: a.citations[0].url });
  assert.match(policy(buildFixture({ now, units: [core, a, notFeed] })).join('; '), /shared across units/);
});

test('roundupCoverage integrity runs through checkRecordPolicy for every kind', () => {
  const fixture = buildFixture({ now, units: threeUnits() });
  const insert = (kind, payload) => checkRecordPolicy({ kind, item: { dataset: 'posts', key: payload.slug, op: 'insert', payload }, deps: { validateRecord } }).errors.join('; ');
  const plain = { ...fixture.post, slug: 'plain-news-post' };
  for (const kind of ['seo', 'manual', 'news', 'blog']) assert.match(insert(kind, plain), /roundupCoverage/, kind);
  const ctx = policyCtx(fixture);
  const roundupErrors = (payload, context = ctx) => checkRecordPolicy({ kind: 'roundup', item: { dataset: 'posts', key: payload.slug, op: 'insert', payload }, ctx: context,
    deps: { validateRecord, news: { imageExists: () => true }, lintMode: 'warn' } }).errors;
  assert.deepEqual(roundupErrors(fixture.post), []);
  assert.match(roundupErrors({ ...fixture.post, roundupCoverage: { ...fixture.coverage, keys: fixture.coverage.keys.slice(1) } }).join('; '), /does not match the verified pack/);
  const withoutField = { ...fixture.post };
  delete withoutField.roundupCoverage;
  assert.match(roundupErrors(withoutField).join('; '), /requires roundupCoverage/);
});

// ---------------------------------------------------------------------------
// DB submit (local PG only).
// ---------------------------------------------------------------------------
async function allowRoundupKind(db) {
  const constraint = (await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='content.submissions'::regclass and conname='submissions_kind_check'")).rows[0]?.definition || '';
  if (constraint.includes("'roundup'")) return;
  await db.query('alter table content.submissions drop constraint submissions_kind_check');
  await db.query("alter table content.submissions add constraint submissions_kind_check check (kind in ('seed','business','blog','blog-live','news','roundup','seo','topic-discovery','manual','admin'))");
}
async function setup(t, { site = false } = {}) {
  const handle = await seededDb();
  await allowRoundupKind(handle.db);
  let server = null;
  if (site) { server = await localSite(handle.db); await server.build(); }
  t.after(async () => { await server?.close(); await handle.close(); });
  return { ...handle, site: server };
}

test('DB submit re-verifies at T_submit, stores bounded v2 evidence, and replays the stored context', { skip }, async (t) => {
  const ctx = await setup(t);
  const fixture = buildFixture({ now, units: threeUnits() });
  const dir = writeOut(fixture);
  const controls = { calls: [] };
  const first = await submit(ctx.db, opts(dir, { idempotencyKey: 'v2-accept' }), { controls });
  assert.ok(first.result.submissionId);
  assert.equal(controls.calls.length, 1);
  assert.equal(controls.calls[0].now, new Date(submitClock).toISOString(), 'verifier runs at T_submit');
  assert.ok(controls.calls[0].posts.length > 0, 'prior coverage comes from live DB posts');
  const stored = (await ctx.db.query('select context from content.submissions where id=$1', [first.result.submissionId])).rows[0].context;
  assert.equal(stored.pipeline, 'structured-v2');
  assert.equal(stored.now, now);
  assert.equal(stored.temporalValidationNow, new Date(submitClock).toISOString());
  assert.deepEqual(stored.roundupCoverage, fixture.coverage);
  assert.deepEqual(stored.counts, { units: 3, coreUnits: 1, coreAnchorUnits: 1 });
  assert.equal(stored.units.length, 3);
  assert.deepEqual(Object.keys(stored.units[0].evidence[0]).sort(), ['date_quote', 'fetchStatus', 'place_quote', 'recordId', 'snapshotSha256', 'subject_quote', 'tier', 'typed', 'url', 'verifiedAt', 'verifyStatus']);
  const replay = await submit(ctx.db, opts(dir, { idempotencyKey: 'v2-accept' }), { at: submitClock + ROUNDUP_REVALIDATE_MAX_AGE_MS, controls: { changed: new Set(fixture.pack.units.map((u) => u.identityKey)), calls: controls.calls } });
  assert.equal(replay.result.submissionId, first.result.submissionId);
  assert.equal(replay.result.existing, true);
  assert.equal(controls.calls.length, 1, 'idempotent replay never re-verifies');
  const after = (await ctx.db.query('select context from content.submissions where id=$1', [first.result.submissionId])).rows[0].context;
  assert.deepEqual(after, stored);
});

test('DB submit refuses changed evidence, a pack below 3/1 at T_submit, and a coverage mismatch', { skip }, async (t) => {
  const ctx = await setup(t);
  const units = threeUnits();
  const dir = writeOut(buildFixture({ now, units }));
  await assert.rejects(submit(ctx.db, opts(dir, { idempotencyKey: 'changed' }), { controls: { changed: new Set([units[1].identityKey]) } }), CHANGED);
  // Eligible at T_plan, concluded before T_submit (§6.5 two clocks).
  await assert.rejects(submit(ctx.db, opts(dir, { idempotencyKey: 'ended' }), { controls: { expiresAt: { [units[0].identityKey]: new Date(submitClock - 1000).toISOString() } } }),
    /below 3 units \/ 1 core anchor at submit/);
  const mismatched = buildFixture({ now, units, mutatePost: (post) => { post.roundupCoverage = { ...post.roundupCoverage, keys: post.roundupCoverage.keys.slice(0, 2) }; } });
  await assert.rejects(submit(ctx.db, opts(writeOut(mismatched), { idempotencyKey: 'coverage' })), /roundupCoverage does not match the verified pack/);
  const wrongPipeline = writeOut(buildFixture({ now, units }));
  write(path.join(wrongPipeline, 'result.json'), { ...buildFixture({ now, units }).result, pipeline: 'legacy' });
  await assert.rejects(submit(ctx.db, opts(wrongPipeline, { idempotencyKey: 'legacy' })), /not a structured-v2 result/);
  assert.equal((await ctx.db.query("select count(*)::int as n from content.submissions where kind='roundup'")).rows[0].n, 0);
});

test('DB submit refuses 65 coverage keys without truncating', { skip }, async (t) => {
  const ctx = await setup(t);
  const units = threeUnits();
  units[0] = { ...units[0], keys: Array.from({ length: 62 }, (_, n) => `occ:addr:extra:${n}`) };
  const fixture = buildFixture({ now, units });
  assert.equal(fixture.coverage.keys.length, 65);
  await assert.rejects(submit(ctx.db, opts(writeOut(fixture), { idempotencyKey: 'sixty-five' })), /more than 64 keys; submission refused/);
});

test('DB submit refuses a pack counting a key a live roundup now covers', { skip }, async (t) => {
  const ctx = await setup(t);
  const units = threeUnits();
  const prior = buildFixture({ now: '2026-09-23T12:00:00.000Z', units: [unit('p1', { date: '2026-09-24' }), unit('p2', { date: '2026-09-25' }), { ...units[2] }] });
  await publishDirect(ctx.db, { items: [{ dataset: 'posts', key: prior.slug, payload: prior.post }], idempotencyKey: 'prior-roundup' });
  await assert.rejects(submit(ctx.db, opts(writeOut(buildFixture({ now, units })), { idempotencyKey: 'covered' })), /already covered by a live roundup/);
});

test('DB submit keeps the ISO-week fence and the 6 h pack age bound', { skip }, async (t) => {
  const ctx = await setup(t);
  const dir = writeOut(buildFixture({ now, units: threeUnits() }));
  assert.equal(ROUNDUP_REVALIDATE_MAX_AGE_MS, 6 * 60 * 60 * 1000);
  await assert.rejects(submit(ctx.db, opts(dir, { idempotencyKey: 'stale' }), { at: Date.parse(now) + ROUNDUP_REVALIDATE_MAX_AGE_MS + 1 }), /must be revalidated before submit/);
  await assert.rejects(submit(ctx.db, opts(dir, { idempotencyKey: 'future' }), { at: Date.parse(now) - 1 }), /must be revalidated before submit/);
  await assert.rejects(submit(ctx.db, opts(dir, { idempotencyKey: 'next-week' }), { at: Date.parse('2026-10-05T00:00:00.000Z') }), /outside its ISO week/);
});

test('DB submit validates Instagram units only against the runner re-fetch file (N1)', { skip }, async (t) => {
  const ctx = await setup(t);
  const four = [...threeUnits(), igUnit('ig', '2026-10-03')];
  const fixture = buildFixture({ now, units: four });
  const dir = writeOut(fixture);
  const fresh = new Date(submitClock - 60_000).toISOString();
  const withFile = (key, file) => opts(dir, { idempotencyKey: key, igRefetch: file });
  await assert.rejects(submit(ctx.db, withFile('ig-missing', path.join(dir, 'absent.json'))), CHANGED, 'missing file refuses every IG unit');
  await assert.rejects(submit(ctx.db, withFile('ig-stale', writeIgRefetch(dir, fixture, { fetchedAt: new Date(submitClock - ROUNDUP_IG_REFETCH_MAX_AGE_MS - 1).toISOString() }))), CHANGED);
  await assert.rejects(submit(ctx.db, withFile('ig-future', writeIgRefetch(dir, fixture, { fetchedAt: new Date(submitClock + 1000).toISOString() }))), CHANGED);
  await assert.rejects(submit(ctx.db, withFile('ig-private', writeIgRefetch(dir, fixture, { fetchedAt: fresh, override: { SCig: { status: 'private' } } }))), CHANGED);
  await assert.rejects(submit(ctx.db, withFile('ig-caption', writeIgRefetch(dir, fixture, { fetchedAt: fresh, override: { SCig: { caption: 'Join us soon' } } }))), CHANGED);
  const extra = writeIgRefetch(dir, fixture, { fetchedAt: fresh });
  const parsed = JSON.parse(fs.readFileSync(extra, 'utf8'));
  parsed.rows.push({ ...parsed.rows[0], shortcode: 'SCother' });
  fs.writeFileSync(extra, JSON.stringify(parsed));
  await assert.rejects(submit(ctx.db, withFile('ig-set', extra)), CHANGED, 'shortcode set must equal the pack');
  const ok = await submit(ctx.db, withFile('ig-ok', writeIgRefetch(dir, fixture, { fetchedAt: fresh })));
  assert.ok(ok.result.submissionId, 'unchanged rows pass');
  const stored = (await ctx.db.query('select context from content.submissions where id=$1', [ok.result.submissionId])).rows[0].context;
  assert.deepEqual(stored.instagram, { refetch: 'ok' });
  // The IG unit as the third unit: its refusal drops the edition below 3/1.
  const three = buildFixture({ now, units: [...threeUnits().slice(0, 2), igUnit('ig3', '2026-10-03')] });
  const threeDir = writeOut(three);
  await assert.rejects(submit(ctx.db, opts(threeDir, { idempotencyKey: 'ig-below' })), /below 3 units/);
});

test('DB submit refuses the v2 roundup through blog and news kinds', { skip }, async (t) => {
  const ctx = await setup(t);
  const fixture = buildFixture({ now, units: threeUnits() });
  const dir = writeOut(fixture);
  write(path.join(dir, 'post.json'), { ...fixture.post, slug: `${fixture.slug}-blog` });
  await assert.rejects(submitContent(ctx.db, { ...opts(dir), kind: 'blog', idempotencyKey: 'bypass-blog' }, { checkout: ROOT }), /blog kind may not submit news/);
  const newsCheck = checkRecordPolicy({ kind: 'news', item: { dataset: 'posts', key: fixture.slug, op: 'insert', payload: fixture.post }, deps: { validateRecord } });
  assert.match(newsCheck.errors.join('; '), /news kind may not submit a weekly roundup slug/);
  assert.match(newsCheck.errors.join('; '), /roundupCoverage is roundup-only trusted metadata/);
});

test('DB-backed scripted gate keeps the 8 threshold and HIGH blocker for v2 roundups', { skip, timeout: 120_000 }, async (t) => {
  const { gateContent } = await import('../../scripts/content/gate.mjs');
  for (const [overall, findings, expected] of [
    [7.99, [], false], [8, [{ severity: 'high', file: 'data/posts.json', line: 1, note: 'unsupported' }], false], [8, [], true],
  ]) {
    const ctx = await setup(t, { site: true });
    const dir = writeOut(buildFixture({ now, units: threeUnits() }));
    const submitted = await submit(ctx.db, opts(dir, { idempotencyKey: `gate-${overall}-${findings.length}` }));
    const script = path.join(dir, 'script.json');
    write(script, { reviews: [{ overall, findings }] });
    const gated = await gateContent(ctx.db, { submission: submitted.result.submissionId, script, actor: 'uat:roundup' },
      { env: ctx.site.env, deps: { smoke: FAST_SMOKE }, checkout: ROOT });
    assert.equal(gated.exitCode === 0, expected, JSON.stringify(gated.result));
  }
});
