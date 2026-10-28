import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rankRefreshCandidates, planRefresh, reserveRefresh, submitRefresh, rollbackRefresh, extractRefreshedPost } from '../../scripts/content/refresh.mjs';
import { fetchRefreshRows } from '../../scripts/content/refresh-gsc.mjs';
import { checkKindPolicy } from '../../scripts/content/submit.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';
import { readLive } from '../../scripts/content/store.mjs';
import { recordSha } from '../../scripts/content/canonical.mjs';
import { recordAction } from '../../scripts/content/ledger.mjs';
import { GATE_MODEL } from '../../scripts/automation/constants.mjs';
import { makeRowRepairValidator } from '../../scripts/content/repair-adapter.mjs';
import { buildRecordRepairPlan } from '../../scripts/automation/record-repair.mjs';
import { seededDb, liveRecord, localSite, FAST_SMOKE, hasTestDb, publishDirect } from './fixtures/content-db.mjs';
import { invoke } from '../runner/fixtures/refresh-writer.mjs';
import { refreshDeps } from '../../ops/exedev-runner/runner.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const NOW = new Date();
const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
const sources = Object.fromEntries(['posts', 'topics', 'services', 'businesses'].map((dataset) => [dataset, JSON.parse(fs.readFileSync(new URL(`../../data/${dataset}.json`, import.meta.url)))]));
const kinds = { posts: 'blog', topics: 'guide', services: 'best', businesses: 'directory' };
const url = (dataset, slug) => `https://libertyvillage.co/${kinds[dataset]}/${slug}`;
const gscFor = (records) => {
  const rows = Object.entries(records).map(([dataset, [record]]) => ({ page: url(dataset, record.slug), clicks: 1, impressions: 300, ctr: 1 / 300, position: 8 }));
  return { pages: rows, queries: rows.map((row) => ({ ...row, query: 'liberty village local guide' })) };
};
const pass = async ({ contentSha }) => ({ overall: 9, findings: [], model: GATE_MODEL, commit_sha: contentSha });
const policy = (dataset, original, payload, live = sources) => checkKindPolicy({ kind: 'refresh',
  items: [{ dataset, key: original.slug, op: 'update', payload }],
  ctx: { refresh: { dataset, mode: 'snippet', original } }, live, deps: { validateRecord, lintMode: 'fail' } });
const changed = (record) => ({ ...record, description: 'A vibrant local guide for planning your visit.' });

// This uses only existing public entry points, so base fails behavior assertions,
// rather than failing to import a newly introduced helper.
test('GSC fetch includes guide, best, directory and home, with final data only', async () => {
  const requests = [];
  await fetchRefreshRows({ client: { searchanalytics: { query: async (args) => { requests.push(args.requestBody); return { data: { rows: [] } }; } } } });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.dataState, 'final');
    const filter = request.dimensionFilterGroups[0].filters[0];
    assert.equal(filter.operator, 'includingRegex');
    const pattern = new RegExp(filter.expression);
    for (const route of ['/', '/blog/post', '/guide/parking-guide', '/best/gyms', '/directory/cleaners']) assert.ok(pattern.test(`https://libertyvillage.co${route}`), route);
    assert.equal(pattern.test('https://other.co/guide/parking-guide'), false);
  }
});

// GSC page totals include demand hidden/anonymized in page+query rows. Like
// the staging pull, no individual parking query clears the 50-impression floor.
const fragmentedGsc = {
  startDate: '2026-09-27', endDate: '2026-10-24',
  pages: [
    { page: url('topics', 'parking-guide'), clicks: 27, impressions: 1487, ctr: 27 / 1487, position: 7.2373907195696034 },
    { page: url('services', 'gyms'), clicks: 8, impressions: 828, ctr: 8 / 828, position: 7.461352657004831 },
  ],
  queries: [
    { page: url('topics', 'parking-guide'), query: '34 hanna ave parking', clicks: 0, impressions: 49, ctr: 0, position: 11.1 },
    { page: url('topics', 'parking-guide'), query: 'green p liberty village', clicks: 0, impressions: 26, ctr: 0, position: 4.7 },
    { page: url('services', 'gyms'), query: 'liberty village gym', clicks: 0, impressions: 49, ctr: 0, position: 4.3 },
  ],
};

test('guide and best page totals qualify under the same leak thresholds with fragmented queries', () => {
  const ranked = rankRefreshCandidates({ ...sources, gsc: fragmentedGsc });
  assert.deepEqual(ranked.map((row) => [row.dataset, row.slug, row.mode, row.score]), [
    ['topics', 'parking-guide', 'snippet', 17.55], ['services', 'gyms', 'snippet', 12.67],
  ]);
  assert.equal(ranked[0].targetQuery, '34 hanna ave parking');
  assert.equal(ranked[1].targetQuery, 'liberty village gym');
  assert.equal(rankRefreshCandidates({ ...sources, gsc: fragmentedGsc, exclude: new Set(['topics:parking-guide']) }).some((row) => row.dataset === 'topics'), false);
  for (const metrics of [{ impressions: 50 }, { clicks: 100, impressions: 1000 }, { position: 3.9 }, { position: 20.1 }]) {
    const gsc = { pages: fragmentedGsc.pages.map((row) => ({ ...row, ...metrics })), queries: [] };
    assert.deepEqual(rankRefreshCandidates({ ...sources, gsc }), [], JSON.stringify(metrics));
  }
});

test('on-demand guide/best selection precedes top-four truncation and preserves eligibility', () => {
  const gsc = { ...fragmentedGsc, pages: [...fragmentedGsc.pages], queries: [...fragmentedGsc.queries] };
  for (const record of sources.businesses.slice(0, 4)) {
    const row = { page: url('businesses', record.slug), clicks: 0, impressions: 4000, ctr: 0, position: 6 };
    gsc.pages.push(row); gsc.queries.push({ ...row, query: record.name });
  }
  assert.equal(rankRefreshCandidates({ ...sources, gsc }).length, 4);
  assert.ok(rankRefreshCandidates({ ...sources, gsc }).every((row) => row.dataset === 'businesses'));
  for (const topic of ['guide/parking-guide', url('services', 'gyms'), 'gyms']) {
    const ranked = rankRefreshCandidates({ ...sources, gsc, topic });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].slug, topic.includes('parking') ? 'parking-guide' : 'gyms');
    assert.deepEqual(rankRefreshCandidates({ ...sources, gsc, topic, exclude: new Set([`${ranked[0].dataset}:${ranked[0].slug}`]) }), []);
  }
  assert.deepEqual(rankRefreshCandidates({ ...sources, gsc, topic: 'guide/not-live' }), []);
});

test('local CLI and runner plan targeted guide/best leaks below top four; reservation still excludes the target', { skip }, async (t) => {
  const { db, close, url: dbUrl, name } = await seededDb(); t.after(close);
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-page-plan-'));
  t.after(() => fs.rmSync(run, { recursive: true, force: true }));
  await publishDirect(db, { kind: 'seed', idempotencyKey: 'leak-pages', items: [
    { dataset: 'services', key: 'gyms', payload: sources.services.find((row) => row.slug === 'gyms') },
  ] });
  const gsc = { ...fragmentedGsc, pages: [...fragmentedGsc.pages], queries: [...fragmentedGsc.queries] };
  for (const record of sources.businesses.slice(0, 4)) {
    const row = { page: url('businesses', record.slug), clicks: 0, impressions: 4000, ctr: 0, position: 6 };
    gsc.pages.push(row); gsc.queries.push({ ...row, query: record.name });
  }
  fs.writeFileSync(path.join(run, 'gsc.json'), JSON.stringify(gsc));
  const cli = (args) => {
    const result = spawnSync(process.execPath, ['scripts/content/cli.mjs', ...args, '--expect-db', name], {
      cwd: REPO, encoding: 'utf8', env: { PATH: process.env.PATH, CONTENT_DATABASE_URL: dbUrl },
    });
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const unfiltered = JSON.parse(cli(['refresh', 'plan', '--gsc', path.join(run, 'gsc.json'), '--target', 'test']).stdout);
  assert.equal(unfiltered.candidates.length, 4);
  assert.ok(unfiltered.candidates.every((row) => row.dataset === 'businesses'));
  for (const topic of ['guide/parking-guide', 'best/gyms']) {
    const deps = refreshDeps({ target: 'test', request: { topic }, run, cli });
    const plan = deps.plan();
    assert.equal(plan.candidates.length, 1);
    assert.equal(`${plan.candidates[0].pageKind}/${plan.candidates[0].slug}`, topic);
    assert.equal(plan.remaining, 2); assert.equal(plan.attemptsLeft, 4);
    t.diagnostic(`node scripts/content/cli.mjs refresh plan --gsc <fixture> --target test --expect-db ${name} --topic ${topic} -> ${JSON.stringify(plan.candidates[0])}`);
    if (topic === 'best/gyms') {
      await reserveRefresh(db, { candidate: plan.candidates[0] });
      const reserved = deps.plan();
      assert.deepEqual(reserved.candidates, []);
      assert.equal(reserved.remaining, 1); assert.equal(reserved.attemptsLeft, 3);
    }
  }
});

test('plan ranks non-blog leaks with unchanged score, excludes home/unknown, keeps dataset-qualified cooldowns', () => {
  const gsc = gscFor(sources);
  gsc.pages.push({ page: 'https://libertyvillage.co/', clicks: 0, impressions: 1045, position: 12 });
  gsc.queries.push({ page: 'https://libertyvillage.co/', query: 'liberty village', impressions: 1045, position: 12, ctr: 0 });
  const candidates = rankRefreshCandidates({ gsc, ...sources, limit: 10 });
  assert.deepEqual(new Set(candidates.map((row) => row.dataset)), new Set(Object.keys(kinds)));
  for (const row of candidates) { assert.equal(row.mode, 'snippet'); assert.equal(row.score, 6.51); assert.equal(row.url, url(row.dataset, row.slug)); }
  for (const dataset of ['topics', 'services', 'businesses']) {
    const selected = candidates.find((row) => row.dataset === dataset);
    const next = rankRefreshCandidates({ gsc, ...sources, exclude: new Set([`${dataset}:${selected.slug}`]), limit: 10 });
    assert.equal(next.some((row) => row.dataset === dataset && row.slug === selected.slug), false);
    // Neither page nor query meets the leak rule: never a non-blog rewrite.
    assert.equal(rankRefreshCandidates({ gsc: { ...gsc, pages: gsc.pages.map((row) => ({ ...row, position: 30 })), queries: [] }, ...sources }).some((row) => row.dataset === dataset), false);
  }
  assert.deepEqual(rankRefreshCandidates({ gsc: { pages: [{ page: 'https://libertyvillage.co/unknown/x', impressions: 999 }] }, ...sources }), []);
});

for (const dataset of ['topics', 'services', 'businesses']) {
  test(`${kinds[dataset]}: target-only extraction, identity/body containment, binding and claim lint`, () => {
    const original = sources[dataset][0], other = sources[dataset][1];
    const record = changed(original);
    assert.equal(extractRefreshedPost({ before: [original, other], after: [record, other], slug: original.slug, mode: 'snippet', dataset }), record);
    assert.throws(() => extractRefreshedPost({ before: [original, other], after: [record, changed(other)], slug: original.slug, mode: 'snippet', dataset }), (error) => error.reason === 'refresh-off-target');
    const bodyEdit = dataset === 'topics' ? { ...record, content: original.content + '\nBody changed' } : { ...record, answerBlock: 'Changed body field' };
    assert.throws(() => extractRefreshedPost({ before: [original], after: [bodyEdit], slug: original.slug, mode: 'snippet', dataset }), (error) => error.reason === 'refresh-snippet-overreach');
    assert.throws(() => extractRefreshedPost({ before: [original], after: [record], slug: original.slug, mode: 'full', dataset }), (error) => error.reason === 'refresh-snippet-overreach');
    const warned = policy(dataset, original, record);
    assert.equal(warned.ok, true, 'voice warning does not block any non-blog kind');
    assert.ok(warned.warnings.some((finding) => finding.rule === 'voice-banned-phrase'));
    assert.deepEqual(warned.lint, [], 'voice remains warn-only');
    assert.equal(policy(dataset, original, bodyEdit).ok, false);
    const field = dataset === 'topics' ? 'title' : dataset === 'services' ? 'pluralName' : 'name';
    assert.equal(policy(dataset, original, { ...record, [field]: 'Unrelated subject completely' }).ok, false);
    const business = sources.businesses[0];
    const originalWithBusiness = dataset === 'topics' ? { ...original, content: `See [${business.name}](/directory/${business.slug}).\n\n${original.content}` } : original;
    const unsupported = policy(dataset, originalWithBusiness, { ...changed(originalWithBusiness), description: `${business.name} charges $99999.` });
    assert.equal(unsupported.ok, false, 'unsupported fact never passes');
    assert.ok(unsupported.lint.some((finding) => finding.includes('[unsupported-price]')));
    const items = [{ dataset, key: original.slug, op: 'update', payload: record }];
    const validate = makeRowRepairValidator({ kind: 'refresh', candidates: items, ctx: { refresh: { dataset, mode: 'snippet', original } }, live: sources, deps: { validateRecord, lintMode: 'fail' } });
    const plan = (payload) => buildRecordRepairPlan({ files: [{ file: `data/${dataset}.json`, records: [{ key: original.slug, record: payload }] }], reason: 'Clarify snippet' });
    assert.equal(validate(plan({ ...record, description: 'Plan your local visit with this guide.' })).ok, true);
    assert.equal(validate(plan(bodyEdit)).ok, false, 'repair cannot widen scope');
  });

  test(`${kinds[dataset]}: local DB plan -> reserve -> full gate -> ledger -> live HTTP -> rollback`, { skip }, async (t) => {
    const { db, close } = await seededDb();
    t.after(close);
    const site = await localSite(db); t.after(() => site.close());
    await site.build();
    const live = Object.fromEntries(Object.entries((await readLive(db)).datasets).map(([key, value]) => [key, value.records]));
    const plan = await planRefresh(db, { gsc: gscFor({ [dataset]: live[dataset] }), now: NOW, env: site.env, checkout: REPO });
    const candidate = plan.candidates.find((row) => row.dataset === dataset);
    assert.ok(candidate, 'page planned from GSC');
    const snapshot = await reserveRefresh(db, { candidate, now: NOW });
    assert.equal(snapshot.dataset, dataset);
    const original = live[dataset].find((row) => row.slug === snapshot.slug);
    const raw = (await db.query('select * from content.refresh_snapshots where id=$1', [snapshot.snapshotId])).rows[0];
    assert.equal(raw.dataset, dataset); assert.equal(recordSha(raw.payload), recordSha(original));
    const before = live[dataset], after = before.map((row) => row.slug === snapshot.slug ? changed(row) : row);
    const result = await submitRefresh(db, { snapshotId: snapshot.snapshotId, before, after, actor: 'test:refresh-pages', env: site.env, checkout: REPO, now: NOW, deps: { gate: { review: pass, smoke: FAST_SMOKE } } });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(result.result.ledger, 'recorded');
    assert.ok(result.result.voiceWarnings.ruleCodes.includes('voice-banned-phrase'), 'non-blog warning survives full-gate submit receipt');
    assert.equal((await liveRecord(db, dataset, snapshot.slug)).description, changed(original).description);
    const route = new URL(candidate.url).pathname;
    assert.equal((await fetch(`${site.origin}${route}`)).status, 200);
    const exported = await (await fetch(`${site.origin}/content-snapshot/${dataset}.json`)).json();
    assert.equal(exported.find((row) => row.slug === snapshot.slug).description, changed(original).description);
    const ledger = (await db.query("select * from content.content_action_ledger where action_kind='refresh'")).rows;
    assert.equal(ledger.length, 1); assert.equal(ledger[0].page_type, kinds[dataset]); assert.equal(ledger[0].action_type, 'snippet');
    const next = await planRefresh(db, { gsc: gscFor({ [dataset]: live[dataset] }), now: NOW, env: site.env, checkout: REPO });
    assert.equal(next.candidates.length, 0, 'eight-week cooldown');
    const restored = await rollbackRefresh(db, { snapshotId: snapshot.snapshotId, actor: 'test:rollback', env: site.env, deps: { gate: { smoke: FAST_SMOKE } } });
    assert.equal(restored.exitCode, 0);
    assert.equal(recordSha(await liveRecord(db, dataset, snapshot.slug)), recordSha(original));
    const restoredExport = await (await fetch(`${site.origin}/content-snapshot/${dataset}.json`)).json();
    assert.equal(recordSha(restoredExport.find((row) => row.slug === snapshot.slug)), recordSha(original));
    // Trusted submission refuses body and second-record edits in the local DB.
    for (const [index, type] of [[1, 'body'], [2, 'second-record']]) {
      const target = before[index];
      const attempt = await reserveRefresh(db, { candidate: { dataset, slug: target.slug, mode: 'snippet' }, now: NOW });
      assert.ok(attempt.snapshotId);
      const bad = before.map((row) => row.slug === target.slug ? changed(row) : row);
      if (type === 'body') bad[index] = dataset === 'topics' ? { ...bad[index], content: target.content + '\nBody edit' } : { ...bad[index], answerBlock: 'Off-target body' };
      else bad[0] = changed(bad[0]);
      const refused = await submitRefresh(db, { snapshotId: attempt.snapshotId, before, after: bad, actor: 'test:containment', env: site.env, checkout: REPO, now: NOW });
      assert.equal(refused.exitCode, 2);
      assert.equal(refused.result.reasonCode, type === 'body' ? 'refresh-snippet-overreach' : 'refresh-off-target');
      assert.equal(recordSha(await liveRecord(db, dataset, target.slug)), recordSha(target));
    }
    t.diagnostic(`GET ${site.origin}${route} -> 200; full-gate publish, ledger ${kinds[dataset]}/snippet, warn-only voice receipt retained; exported description observed; rollback restored exact payload sha`);
  });

  test(`${kinds[dataset]}: real launcher/writer reads and writes only its one bounded dataset`, (t) => {
    const record = dataset === 'services' ? sources.services.find((row) => row.slug === 'gyms') : sources[dataset][0];
    const result = invoke(t, { dataset, slug: record.slug, query: 'local guide', mode: 'snippet' }, true, 'voice-warn');
    assert.equal(result.probes.length, 1, 'voice warning consumes no revision');
    assert.match(result.stdout, /"event":"lv-voice-warning"/);
    assert.deepEqual(result.files.filter((file) => /^data\/.*\.json$/.test(file)), [`data/${dataset}.json`]);
    assert.equal(result.env.REFRESH_DATASET, dataset);
    assert.equal(result.observed.result.after[0].description, 'A vibrant local guide.');
    assert.deepEqual(result.observed.result.after[1], result.observed.result.before[1]);
    assert.equal(extractRefreshedPost({ ...result.observed.result, slug: record.slug, dataset, mode: 'snippet' }).description, 'A vibrant local guide.');
    assert.equal(result.observed.scratchExists, false);
  });
}

test('unknown dataset fails closed; shared cap counts blog plus other kinds; identical slugs keep separate snapshots', { skip }, async (t) => {
  const { db, close } = await seededDb(); t.after(close);
  await assert.rejects(reserveRefresh(db, { candidate: { dataset: 'buildings', slug: 'unknown', mode: 'snippet' }, now: NOW }));
  await assert.rejects(reserveRefresh(db, { candidate: { dataset: 'topics', pageKind: 'unknown', slug: 'parking-guide', mode: 'snippet' }, now: NOW }));
  const live = (await readLive(db)).datasets;
  const post = live.posts.records[0], topic = live.topics.records[0], service = live.services.records[0];
  await publishDirect(db, { kind: 'seed', idempotencyKey: 'same-key', items: [{ dataset: 'topics', key: post.slug, payload: { ...topic, slug: post.slug } }] });
  const first = await reserveRefresh(db, { candidate: { dataset: 'posts', slug: post.slug, mode: 'snippet' }, now: NOW });
  const second = await reserveRefresh(db, { candidate: { dataset: 'topics', slug: post.slug, mode: 'snippet' }, now: NOW });
  assert.ok(first.snapshotId); assert.ok(second.snapshotId);
  assert.equal((await reserveRefresh(db, { candidate: { dataset: 'services', slug: service.slug, mode: 'snippet' }, now: NOW })).capReached, true);
  for (const [pageType, route] of [['blog', 'blog'], ['guide', 'guide']]) {
    await recordAction(db, { actionKind: 'refresh', actionType: 'snippet', pageType, slug: post.slug, url: `https://libertyvillage.co/${route}/${post.slug}`, targetQuery: 'local guide', queryType: 'local-intent', baseline: {}, actedAt: NOW });
  }
  assert.equal((await db.query('select count(*)::int as n from content.content_action_ledger')).rows[0].n, 2, 'same slug in two page kinds keeps both ledger entries');
});
