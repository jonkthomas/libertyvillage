import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reserveRefresh, submitRefresh, closeRefresh } from '../../scripts/content/refresh.mjs';
import { GATE_MODEL } from '../../scripts/automation/constants.mjs';
import { seededDb, liveRecord, localSite, FAST_SMOKE, hasTestDb, publishDirect } from './fixtures/content-db.mjs';
import { invoke } from '../runner/fixtures/refresh-writer.mjs';
import { queueAgent } from './fixtures/agent-sdk-mock.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => JSON.parse(fs.readFileSync(new URL(`../../data/${name}.json`, import.meta.url)));
const description = 'Plan parking in Liberty Village with this local guide, compare nearby options and check the details before you travel to the neighbourhood for your next visit.';
const original = { ...read('posts')[0], title: 'Liberty Village Parking Guide', description: 'Original local guide.',
  content: 'Plan your local visit.\n\n## Details\nExisting body stays here.' };
const patches = () => [
  { title: 'Liberty Village Parking: A Local Guide', description },
  { title: 'Parking Guide for Liberty Village Visitors', description },
  { title: 'Liberty Village Parking Guide and Local Tips', description },
];
const input = (options = {}, candidates = patches()) => {
  const prior = options.original ?? original;
  const dataset = options.dataset ?? 'posts';
  return { before: [prior], after: [{ ...prior, refreshCandidates: candidates }], slug: prior.slug, dataset,
    query: 'liberty village parking', live: { posts: dataset === 'posts' ? [prior] : [], topics: [], services: [], businesses: [], [dataset]: [prior] },
    deps: { lintMode: 'fail' }, ...options };
};
const filter = async (...args) => (await import('../../scripts/lib/refresh-candidates.mjs')).filterRefreshCandidates(...args);

test('candidate parsing requires 3–5 patches, unchanged envelope, permitted fields and no identity edits', async () => {
  for (const candidates of [null, [], patches().slice(0, 2), [...patches(), ...patches()]]) {
    await assert.rejects(filter(input({}, candidates)), (error) => error.reason === 'refresh-candidate-format');
  }
  const changed = input(); changed.after[0].slug = 'renamed';
  await assert.rejects(filter(changed), (error) => error.reason === 'refresh-candidate-format');
  const outer = input(); outer.after[0].title = 'Changed outside envelope';
  await assert.rejects(filter(outer), (error) => error.reason === 'refresh-candidate-format');
  const result = await filter(input({}, [{ ...patches()[0], content: 'Body edit' }, null, patches()[2]]));
  assert.deepEqual(result.dropped.map((row) => row.codes), [['refresh-candidate-fields'], ['refresh-candidate-fields']]);
  assert.deepEqual(result.survivors.map((row) => row.id), [3]);
  assert.equal(result.survivors[0].record.content, original.content);
  assert.equal(Object.hasOwn(result.survivors[0].record, 'refreshCandidates'), false);
});

test('mechanical filter drops title length, description length, late query, duplicate title and binding failures with codes', async () => {
  const cases = [
    [{ ...patches()[0], title: 'Liberty Village Parking Guide '.repeat(3) }, 'refresh-title-length'],
    [{ ...patches()[0], description: 'Too short.' }, 'refresh-description-length'],
    [{ ...patches()[0], description: 'x'.repeat(161) }, 'refresh-description-length'],
    [{ ...patches()[0], title: 'A useful local guide for visitors and residents: Parking' }, 'refresh-query-late'],
    [{ ...patches()[0], title: 'A completely different subject' }, 'draft-changed-topic'],
    [{ ...patches()[0], intro: '[Invented](/guide/missing-guide)\n\n' }, 'invalid-internal-link'],
  ];
  for (const [bad, code] of cases) {
    const result = await filter(input({}, [bad, ...patches().slice(1)]));
    assert.ok(result.dropped.find((row) => row.id === 1)?.codes.includes(code), JSON.stringify(result.dropped));
    assert.equal(result.survivors.some((row) => row.id === 1), false);
  }
  const duplicate = input(); duplicate.live.topics = [{ slug: 'another-guide', title: patches()[0].title.toUpperCase() }];
  assert.ok((await filter(duplicate)).dropped[0].codes.includes('refresh-title-duplicate'));
  const computed = input(); computed.live.services = [{ slug: 'parking', pluralName: 'Parking' }];
  computed.after[0].refreshCandidates[0].title = 'Best Parking in Liberty Village Toronto (2026)';
  assert.ok((await filter(computed)).dropped[0].codes.includes('refresh-title-duplicate'), 'computed titles participate in uniqueness');
  const restaurant = { ...original, title: 'Liberty Village Restaurant Guide' };
  const restaurantPatches = patches().map((patch) => ({ ...patch, title: 'Best Restaurants in Liberty Village: A Guide' }));
  const broadQuery = await filter(input({ original: restaurant, query: 'best restaurants liberty village' }, restaurantPatches));
  assert.equal(broadQuery.survivors.length, 3, JSON.stringify(broadQuery.dropped));
});

test('shared fact lint drops unsupported claims while voice remains a warning', async () => {
  const business = read('businesses')[0];
  const prior = { ...original, content: `Local guide.\n\n## Details\n[${business.name}](/directory/${business.slug})` };
  const options = input({ original: prior }); options.live.businesses = [business];
  options.after[0].refreshCandidates[0].description = `${business.name} charges $99999. `.padEnd(150, 'x');
  options.after[0].refreshCandidates[1].description = description.replace('local guide', 'vibrant guide').slice(0, 160);
  const result = await filter(options);
  assert.ok(result.dropped.find((row) => row.id === 1).codes.includes('unsupported-price'));
  assert.ok(result.survivors.find((row) => row.id === 2)?.warnings.includes('voice-banned-phrase'), JSON.stringify(result));
});

test('all dataset kinds preserve immutable fields, identities and paragraph bodies', async () => {
  for (const dataset of ['posts', 'topics', 'services', 'businesses']) {
    const source = dataset === 'posts' ? original : read(dataset)[0];
    const prior = dataset === 'topics' ? { ...source, title: original.title } : source;
    const list = ['services', 'businesses'].includes(dataset) ? patches().map(() => ({ description })) : patches();
    const result = await filter(input({ dataset, original: prior }, list));
    assert.equal(result.survivors.length, 3, `${dataset}: ${JSON.stringify(result.dropped)}`);
    const record = result.survivors[0].record;
    for (const key of Object.keys(prior)) if (!['title', 'description'].includes(key)) assert.deepEqual(record[key], prior[key], `${dataset}.${key}`);
    if (['services', 'businesses'].includes(dataset)) {
      const { snippetOverreach } = await import('../../scripts/lib/refresh-precheck.mjs');
      assert.equal(snippetOverreach(prior, record, dataset), null);
      const invalid = await filter(input({ dataset, original: prior }, [{ title: 'Identity edit', description }, ...list.slice(1)]));
      assert.deepEqual(invalid.dropped[0].codes, ['refresh-candidate-fields']);
    }
  }
});

test('judge receives only survivors and only its key; cannot edit text or select a dropped id; deterministic fallback', async () => {
  const { pickRefreshCandidate } = await import('../../scripts/content/refresh-candidate-judge.mjs');
  const options = input(); options.after[0].refreshCandidates[0].description = 'Too short';
  const { survivors } = await filter(options);
  const env = { DEEPSEEK_API_KEY: 'fixture-key', ANTHROPIC_API_KEY: 'writer-secret', GOOGLE_APPLICATION_CREDENTIALS: 'gsa', CONTENT_DATABASE_URL: 'db' };
  const chosen = await pickRefreshCandidate({ survivors, env, judge: async (request) => {
    assert.deepEqual(request.env, { DEEPSEEK_API_KEY: 'fixture-key' });
    assert.deepEqual(request.candidates.map((row) => row.id), [2, 3]);
    assert.ok(request.candidates.every((row) => !Object.hasOwn(row, 'record')));
    return { id: 3, reason: 'Clearer local intent.' };
  } });
  assert.deepEqual(chosen.record, survivors[1].record);
  assert.equal(chosen.audit.status, 'picked');
  for (const response of [{ id: 1, reason: 'Dropped' }, { id: 3, reason: 'Edit', title: 'Invented' }, { id: 3, reason: 'Two\nlines' }, { id: '3', reason: 'Invalid' }, {}, null]) {
    const result = await pickRefreshCandidate({ survivors, env, judge: async () => response });
    assert.deepEqual(result.record, survivors[0].record);
    assert.match(result.audit.status, /^fallback-/);
  }
  const unavailable = await pickRefreshCandidate({ survivors, env, judge: async () => { throw new Error('private provider error'); } });
  assert.equal(unavailable.audit.status, 'fallback-unavailable');
  assert.ok(!JSON.stringify(unavailable.audit).includes('private'));
  const missingKey = await pickRefreshCandidate({ survivors, env: {} });
  assert.equal(missingKey.audit.status, 'fallback-unavailable');
});

test('runner scopes DeepSeek to refresh submit and requires candidates for snippets', async () => {
  const { refreshCommandEnv, trustedEnv, generatorEnv, sourceEnv, refreshDeps } = await import('../../ops/exedev-runner/runner.mjs');
  const env = { DEEPSEEK_API_KEY: 'judge-key', ANTHROPIC_API_KEY: 'gate-key', GOOGLE_APPLICATION_CREDENTIALS: 'gsa' };
  assert.equal(refreshCommandEnv(env, ['refresh', 'submit']).DEEPSEEK_API_KEY, 'judge-key');
  for (const args of [['refresh', 'plan'], ['refresh', 'close'], ['gate'], ['submit']]) assert.equal(refreshCommandEnv(env, args).DEEPSEEK_API_KEY, undefined);
  assert.equal(trustedEnv(env).DEEPSEEK_API_KEY, undefined);
  assert.equal(generatorEnv(env).DEEPSEEK_API_KEY, undefined);
  assert.equal(sourceEnv(env, 'seo-improvements').DEEPSEEK_API_KEY, undefined);
  const root = fs.mkdtempSync('/tmp/lv-candidate-runner-');
  try {
    const calls = [], writes = [];
    const deps = refreshDeps({ target: 'test', slot: 'test-slot', request: {}, run: root, export: () => {},
      readPosts: () => [original], writePosts: (rows) => writes.push(rows),
      generate: () => ({ posts: input().after }), log: () => {},
      cli: (args) => { calls.push(args); return { stdout: '{}' }; } });
    const snapshot = { snapshotId: 1, slug: original.slug, mode: 'snippet' };
    const generated = deps.generate(snapshot, {});
    assert.deepEqual(writes, [[original]], 'transient options never enter trusted content files');
    deps.submit(snapshot, generated);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('--candidates'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
test('local candidate flow: filter -> independent pick -> one full-gate submit -> HTTP -> persisted snapshot and ledger', { skip }, async (t) => {
  const { db, close } = await seededDb(); t.after(close);
  const source = await liveRecord(db, 'posts', original.slug);
  const entry = (await db.query("select live_rev from content.entries where dataset='posts' and key=$1", [source.slug])).rows[0];
  await publishDirect(db, { kind: 'manual', idempotencyKey: 'candidate:original', items: [{ dataset: 'posts', key: source.slug, payload: original, expectedLiveRev: Number(entry.live_rev) }] });
  const site = await localSite(db); t.after(() => site.close()); await site.build();
  const snapshot = await reserveRefresh(db, { candidate: { slug: source.slug, mode: 'snippet', targetQuery: 'liberty village parking' } });
  const after = input().after;
  after[0].refreshCandidates[0].description = 'Too short';
  let judgeCalls = 0, gateCalls = 0;
  const result = await submitRefresh(db, { snapshotId: snapshot.snapshotId, before: [original], after,
    requireCandidates: true, actor: 'test:candidates', checkout: REPO, env: { ...site.env, DEEPSEEK_API_KEY: 'fixture-key' },
    deps: { candidateJudge: async ({ candidates, env }) => {
      judgeCalls++;
      assert.deepEqual(candidates.map((row) => row.id), [2, 3]);
      assert.deepEqual(env, { DEEPSEEK_API_KEY: 'fixture-key' });
      return { id: 3, reason: 'Makes the local parking intent clear.' };
    }, gate: { smoke: FAST_SMOKE, review: async ({ contentSha }) => {
      gateCalls++;
      return { overall: 9, findings: [], model: GATE_MODEL, commit_sha: contentSha };
    } } } });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(judgeCalls, 1); assert.equal(gateCalls, 1);
  const selected = await liveRecord(db, 'posts', source.slug);
  assert.equal(selected.title, patches()[2].title);
  assert.equal(Object.hasOwn(selected, 'refreshCandidates'), false);
  const submissions = (await db.query("select * from content.submissions where kind='refresh'")).rows;
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].state, 'published');
  const persisted = await closeRefresh(db, { snapshotId: snapshot.snapshotId });
  assert.equal(persisted.candidateSelection.selectedId, 3);
  assert.equal(persisted.candidateSelection.reason, 'Makes the local parking intent clear.');
  assert.ok(persisted.candidateSelection.dropped[0].codes.includes('refresh-description-length'));
  const ledger = (await db.query("select * from content.content_action_ledger where action_kind='refresh'")).rows;
  assert.equal(ledger.length, 1); assert.deepEqual(ledger[0].details.candidateSelection, persisted.candidateSelection);
  const response = await fetch(`${site.origin}/blog/${source.slug}`);
  assert.equal(response.status, 200); assert.ok((await response.text()).includes(selected.title));
  t.diagnostic(`LOCAL HTTP ${site.origin}/blog/${source.slug}: 200, selected title visible; one refresh submission, unchanged ${GATE_MODEL} gate, snapshot/ledger selectedId=3.`);
});

test('local zero survivors refuses before judge or submit, keeps live content and saves codes', { skip }, async (t) => {
  const { db, close } = await seededDb(); t.after(close);
  const source = await liveRecord(db, 'posts', original.slug);
  const snapshot = await reserveRefresh(db, { candidate: { slug: source.slug, mode: 'snippet' } });
  let calls = 0;
  const result = await submitRefresh(db, { snapshotId: snapshot.snapshotId, before: [source],
    after: [{ ...source, refreshCandidates: patches().map((patch) => ({ ...patch, description: 'Too short' })) }],
    requireCandidates: true, actor: 'test:candidates', checkout: REPO, env: {}, deps: { candidateJudge: () => { calls++; } } });
  assert.equal(result.exitCode, 2); assert.equal(result.result.reasonCode, 'refresh-no-candidates');
  assert.equal(calls, 0);
  assert.equal((await db.query("select count(*)::int as count from content.submissions where kind='refresh'")).rows[0].count, 0);
  assert.deepEqual(await liveRecord(db, 'posts', source.slug), source);
  assert.equal(result.result.candidateSelection.dropped.length, 3);
  const { explain } = await import('../../ops/weekly-digest/lib/plain-english.mjs');
  assert.equal(explain(result.result.reasonCode).known, true);
});

test('local CLI scopes the judge key away from the full gate SDK and makes exactly one provider pick', { skip }, async (t) => {
  const { db, name, close } = await seededDb(); t.after(close);
  const source = await liveRecord(db, 'services', read('services')[0].slug);
  const site = await localSite(db); t.after(() => site.close()); await site.build();
  const snapshot = await reserveRefresh(db, { candidate: { dataset: 'services', slug: source.slug, mode: 'snippet' } });
  const root = fs.mkdtempSync('/tmp/lv-candidate-cli-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(`${root}/before.json`, JSON.stringify([source]));
  fs.writeFileSync(`${root}/after.json`, JSON.stringify([{ ...source, refreshCandidates: patches().map(() => ({ description })) }]));
  const vars = { ...site.env, CONTENT_TARGET: 'test', DEEPSEEK_API_KEY: 'fixture-judge-key' };
  const prior = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  t.after(() => { for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const realFetch = globalThis.fetch;
  let picks = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== 'https://api.deepseek.com/chat/completions') return realFetch(url, init);
    picks++;
    assert.equal(init.headers.Authorization, 'Bearer fixture-judge-key');
    const request = JSON.parse(init.body);
    assert.equal(request.model, 'deepseek-chat');
    assert.deepEqual(JSON.parse(request.messages[1].content).candidates.map((row) => row.id), [1, 2, 3]);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ id: 2, reason: 'Clear local intent.' }) } }] }));
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const agent = queueAgent(({ prompt, options }) => {
    assert.equal(process.env.DEEPSEEK_API_KEY, undefined, 'gate SDK ambient environment excludes judge key');
    assert.equal(options.model, GATE_MODEL);
    return { overall: 9, findings: [], model: GATE_MODEL, commit_sha: prompt.match(/bound to exact content sha ([a-f0-9]+)/)[1] };
  });
  const { runCli } = await import('../../scripts/content/cli.mjs');
  const result = await runCli(['refresh', 'submit', '--snapshot', String(snapshot.snapshotId), '--before', `${root}/before.json`,
    '--after', `${root}/after.json`, '--candidates', '--actor', 'test:candidate-cli', '--target', 'test', '--expect-db', name]);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(picks, 1); assert.equal(agent.calls.length, 1);
  assert.equal(result.result.candidateSelection.selectedId, 2);
  assert.equal(result.result.candidateSelection.status, 'picked');
  assert.equal(process.env.DEEPSEEK_API_KEY, 'fixture-judge-key', 'CLI restores caller state after gate finishes');
});

for (const dataset of ['topics', 'services', 'businesses']) {
  test(`local ${dataset} candidates: missing judge key falls back, one gated submission preserves identity/body and serves HTTP`, { skip }, async (t) => {
    const { db, close } = await seededDb(); t.after(close);
    const source = await liveRecord(db, dataset, read(dataset)[0].slug);
    const site = await localSite(db); t.after(() => site.close()); await site.build();
    const snapshot = await reserveRefresh(db, { candidate: { dataset, slug: source.slug, mode: 'snippet' } });
    const candidates = patches().map(() => ({ ...(dataset === 'topics' ? { title: 'Liberty Village Parking: Green P Lots & Monthly Rates' } : {}), description }));
    const result = await submitRefresh(db, { snapshotId: snapshot.snapshotId, before: [source],
      after: [{ ...source, refreshCandidates: candidates }], requireCandidates: true, actor: 'test:candidates', checkout: REPO, env: site.env,
      deps: { gate: { smoke: FAST_SMOKE, review: async ({ contentSha }) => ({ overall: 9, findings: [], model: GATE_MODEL, commit_sha: contentSha }) } } });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(result.result.candidateSelection.status, 'fallback-unavailable');
    assert.equal(result.result.candidateSelection.selectedId, 1);
    const live = await liveRecord(db, dataset, source.slug);
    const { snippetOverreach } = await import('../../scripts/lib/refresh-precheck.mjs');
    assert.equal(snippetOverreach(source, live, dataset), null);
    assert.equal(Object.hasOwn(live, 'refreshCandidates'), false);
    const route = new URL(snapshot.url).pathname;
    assert.equal((await fetch(`${site.origin}${route}`)).status, 200);
    assert.equal((await db.query("select count(*)::int as count from content.submissions where kind='refresh'")).rows[0].count, 1);
    t.diagnostic(`LOCAL HTTP ${site.origin}${route}: 200; ${dataset} selectedId=1, fallback-unavailable, one gated submission.`);
  });
}

test('real sandbox launcher/writer emits several options inside the single bounded file', (t) => {
  const result = invoke(t, { slug: 'target', query: 'parking', mode: 'snippet' }, false, 'candidates', { target: { ...original, slug: 'target' } });
  assert.match(result.stdout, /\[refresh-self-check\].*"ok":true/);
  assert.equal(result.posts[0].refreshCandidates.length, 3);
  assert.equal(result.probes.length, 1, 'same generator call and writer caps');
  assert.ok(result.diagnostics.find((row) => row.event === 'refresh-self-check').ok);
});

test('writer hands zero-survivor options to trusted filter for a durable content refusal', async (t) => {
  const result = invoke(t, { slug: 'target', query: 'parking', mode: 'snippet' }, false, 'candidates-none', { target: { ...original, slug: 'target' } });
  const checks = result.diagnostics.filter((row) => row.event === 'refresh-self-check');
  assert.equal(checks.at(-1).ok, false);
  assert.ok(checks.at(-1).ruleCodes.includes('refresh-description-length'));
  const filtered = await filter({ ...input({ original: { ...original, slug: 'target' } }), after: result.posts });
  assert.equal(filtered.survivors.length, 0);
  assert.equal(filtered.dropped.length, 3);
});
