import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { testDb } from './helpers/db.mjs';
import { createSubmission, claimSubmission, recordRound, publishSubmission, readLive } from '../../scripts/content/store.mjs';
import { candidateDigest } from '../../scripts/content/canonical.mjs';
import { consolidate, redirectsFor, routeRow, mergeCluster, validatePlan } from '../../scripts/content/consolidate-clusters.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';

const plan = JSON.parse(await fs.readFile(new URL('../../scripts/content/consolidation-clusters.json', import.meta.url)));
const datasets = {};
for (const d of ['posts', 'topics', 'services']) datasets[d] = JSON.parse(await fs.readFile(new URL(`../../data/${d}.json`, import.meta.url)));
const businesses = JSON.parse(await fs.readFile(new URL('../../data/businesses.json', import.meta.url)));
const configuredRedirects = (variant) => {
  let dir;
  try {
    const env = { ...process.env };
    if (variant) {
      dir = mkdtempSync(path.join(os.tmpdir(), 'lv-confirmed-redirects-'));
      mkdirSync(path.join(dir, 'scripts/content'), { recursive: true });
      copyFileSync(process.env.CONSOLIDATION_CONFIG || 'next.config.ts', path.join(dir, 'next.config.ts'));
      writeFileSync(path.join(dir, 'scripts/content/consolidation-clusters.json'), JSON.stringify(variant));
      env.CONSOLIDATION_CONFIG = path.join(dir, 'next.config.ts');
    }
    return JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "const {default:value} = await import(process.env.CONSOLIDATION_CONFIG || './next.config.ts'); const config = value.default ?? value; console.log(JSON.stringify(await config.redirects()))"], { encoding: 'utf8', env }));
  } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
};

test('unconfirmed clusters produce no redirects in either the tool or Next config', () => {
  assert.equal(plan.clusters.length, 13);
  assert.ok(plan.clusters.every(c => c.confirmed === false));
  assert.deepEqual(redirectsFor(plan), []);
  const all = configuredRedirects();
  const members = new Set(plan.clusters.flatMap(c => c.members.map(m => m.url)));
  assert.ok(!all.some(r => members.has(r.source)));
  assert.ok(!all.some(r => r.statusCode === 301));
});

test('confirming one cluster yields exactly its single-hop 301s', () => {
  const variant = structuredClone(plan);
  variant.clusters.forEach(c => { c.confirmed = false; });
  const selected = variant.clusters[0];
  selected.confirmed = true;
  const expected = selected.members.filter(m => m.url !== selected.primary)
    .map(m => ({ source: m.url, destination: selected.primary, statusCode: 301 }));
  assert.deepEqual(redirectsFor(variant), expected);
  const all = configuredRedirects(variant);
  assert.deepEqual(all.filter(r => r.statusCode === 301), expected);
  assert.ok(expected.every(r => !all.some(other => other.source === r.destination)));
});

test('every cluster source has an exact 301; destinations exist and no redirect chains', () => {
  const confirmed = structuredClone(plan);
  confirmed.clusters.forEach(c => { c.confirmed = true; });
  const all = configuredRedirects(confirmed);
  const redirects = redirectsFor(confirmed);
  const sources = new Set(all.map(r => r.source));
  for (const expected of redirects) {
    assert.deepEqual(all.filter(r => r.source === expected.source), [expected]);
    assert.ok(!sources.has(expected.destination), `chain: ${expected.source}`);
    const { dataset, key } = routeRow(expected.destination);
    assert.ok(datasets[dataset].some(r => r.slug === key), `missing primary: ${expected.destination}`);
  }
  assert.equal(new Set(redirects.map(r => r.source)).size, redirects.length);
});

test('D2 protects every World Cup URL and includes all three recent duplicate auto-posts', () => {
  const confirmed = structuredClone(plan);
  confirmed.clusters.forEach(c => { c.confirmed = true; });
  const all = configuredRedirects(confirmed);
  const retired = new Set(all.map(r => r.source));
  for (const url of plan.protectedUrls) assert.ok(!retired.has(url));
  assert.ok(!all.some(r => /world-cup|fifa/.test(r.source)));
  for (const slug of ['dentists-liberty-village-2026', 'what-are-some-fun-things-to-do-liberty-village', 'jukebox-print-liberty-village-printing-guide-2026']) {
    assert.ok(plan.clusters.some(c => c.members.some(m => m.url === `/blog/${slug}`)));
  }
  const invalid = structuredClone(plan);
  invalid.clusters[0].members[0].url = '/blog/fifa-event';
  assert.throws(() => validatePlan(invalid));
});

test('directory hubs with businesses are never consolidation redirect sources', () => {
  const confirmed = structuredClone(plan);
  confirmed.clusters.forEach(c => { c.confirmed = true; });
  const sources = new Set(configuredRedirects(confirmed).map(r => r.source));
  for (const service of datasets.services) {
    if (businesses.some(b => b.category === service.slug || b.categories?.includes(service.slug))) {
      assert.ok(!sources.has(`/best/${service.slug}`), `directory hub must stay live: ${service.slug}`);
    }
  }
});

test('candidates rewrite retired links, unlink self-links and render clean service prose', () => {
  const c = { id: 'links', primary: '/blog/current', members: [
    { url: '/blog/current', keepSections: ['Advice'] },
    { url: '/blog/old-self', keepSections: ['Advice'] },
  ] };
  const records = new Map([
    [c.primary, { content: '## Advice\n\nExisting [old guide](/guide/old).', faqs: [], relatedTopics: ['old'], relatedServices: [], relatedPosts: [] }],
    ['/blog/old-self', { content: '## Advice\n\nRead [self](/blog/current), [alias](/blog/old-self), [absolute self](https://libertyvillage.co/blog/current), [moved](/guide/old?from=advice#tips) and [outside](https://example.org/guide/old).', faqs: [{ question: 'Where?', answer: '[Here](/blog/old-self) or [elsewhere](/guide/old).' }] }],
  ]);
  const redirects = [{ source: '/blog/old-self', destination: c.primary }, { source: '/guide/old', destination: '/best/bars' }];
  const merged = mergeCluster(c, records, redirects, '2026-10-26');
  const html = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import value from './lib/markdown.ts'; import fs from 'node:fs'; const md = value.default ?? value; console.log(md.renderMarkdownContent(fs.readFileSync(0, 'utf8')))"], { encoding: 'utf8', input: merged.content });
  assert.match(html, /href="\/best\/bars\?from=advice#tips"/);
  assert.match(html, /href="https:\/\/example.org\/guide\/old"/);
  assert.doesNotMatch(html, /href="(?:https:\/\/libertyvillage.co)?\/blog\/(?:current|old-self)/);
  assert.doesNotMatch(html, /href="\/guide\/old/);
  assert.equal(merged.faqs[0].answer, 'Here or [elsewhere](/best/bars).');

  const service = { ...c, primary: '/best/bars', members: [{ url: '/best/bars', keepSections: ['Overview'] }, c.members[1]] };
  records.set('/best/bars', { definition: 'A [self](/best/bars) overview.', sections: [], specificFaqs: [] });
  records.get('/blog/old-self').content += '\n\n| Gym | Price |\n| --- | --- |\n| GoodLife | $50 |';
  const prose = mergeCluster(service, records, redirects, '2026-10-26');
  const text = prose.sections.map(s => s.content).join(' ');
  assert.match(text, /Read self, alias, absolute self, moved and outside\./);
  assert.match(text, /Gym: GoodLife; Price: \$50\./);
  assert.doesNotMatch(text, /\]\(|\(\/(?:guide|blog|best)\/|https?:\/\//);
});

test('retained content from every available real source has no self or retired link', () => {
  const confirmed = structuredClone(plan);
  confirmed.clusters.forEach(c => { c.confirmed = true; });
  const redirects = redirectsFor(confirmed);
  const retired = new Set(redirects.map(r => r.source));
  const records = new Map();
  for (const [dataset, prefix] of [['posts', '/blog/'], ['topics', '/guide/'], ['services', '/best/']])
    for (const record of datasets[dataset]) records.set(prefix + record.slug, record);
  for (const cluster of confirmed.clusters) {
    // The checkout seed predates some auto-posts; synthetic tests above cover arbitrary links.
    const c = { ...cluster, members: cluster.members.filter(m => records.has(m.url)) };
    const candidate = mergeCluster(c, records, redirects, '2026-10-26');
    const text = JSON.stringify(candidate);
    for (const [, href] of text.matchAll(/\]\(([^)]+)\)/g)) {
      const url = new URL(href, 'https://libertyvillage.co');
      if (url.hostname === 'libertyvillage.co') {
        assert.notEqual(url.pathname, c.primary, `${c.id}: self-link`);
        assert.ok(!retired.has(url.pathname), `${c.id}: retired ${url.pathname}`);
      }
    }
    if (routeRow(c.primary).dataset === 'services')
      for (const section of candidate.sections) assert.doesNotMatch(section.content, /\]\(|\(\/(?:best|guide|blog)\//, c.id);
    assert.equal(validateRecord(routeRow(c.primary).dataset, routeRow(c.primary).key, candidate).ok, true, c.id);
  }
});

test('planned primary images exist locally for the unchanged content image gate', async () => {
  for (const c of plan.clusters) {
    const { dataset, key } = routeRow(c.imageFrom ?? c.primary);
    const record = datasets[dataset].find(r => r.slug === key);
    assert.ok(record?.image?.startsWith('/images/'));
    assert.ok((await fs.stat(new URL(`../../public${record.image}`, import.meta.url))).isFile(), c.id);
  }
});

// Synthetic records keep the operational regression independent of editorial choices.
const fixturePlan = { version: 1, clusters: ['posts', 'topics', 'services'].map((dataset, i) => ({
  confirmed: true,
  id: `intent-${i}`, primary: `${{ posts: '/blog/', topics: '/guide/', services: '/best/' }[dataset]}fixture-primary-${i}`,
  members: ['primary', 'secondary'].map(role => ({
    url: `${{ posts: '/blog/', topics: '/guide/', services: '/best/' }[dataset]}fixture-${role}-${i}`,
    keepSections: [dataset === 'services' ? 'Overview' : 'Useful detail'],
  })),
})) };
async function setup() {
  const fixture = await testDb();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lv-consolidation-'));
  const items = fixturePlan.clusters.flatMap(c => c.members.map((m, index) => {
    const { dataset, key } = routeRow(m.url);
    const payload = structuredClone(datasets[dataset][0]);
    payload.slug = key;
    if (dataset !== 'services') payload.title = `Fixture ${key}`;
    if (dataset === 'posts') payload.category = 'lifestyle';
    if (dataset === 'services') {
      payload.definition = `Unique practical detail from ${key}. Read [primary](${c.primary}) and [old](${m.url}).`;
      payload.sections = [{ heading: 'Existing advice', content: `Advice for ${key}.` }];
    } else payload.content = `## Useful detail\n\nUnique practical detail from ${key}.\n\nShared paragraph. Read [primary](${c.primary}) and [old](${m.url}).`;
    // The same question must be retained only once.
    payload[dataset === 'services' ? 'specificFaqs' : 'faqs'] = [{ question: 'When should I book?', answer: 'Call ahead.' }];
    return { dataset, key, payload, expectedLiveRev: null };
  }));
  // Fixture publication only; the operation below must use the real gate API.
  const created = await createSubmission(fixture.db, { kind: 'seo', target: 'test', actor: 'fixture', idempotencyKey: 'fixture', items });
  const { token } = await claimSubmission(fixture.db, created.submissionId, { owner: 'fixture' });
  const vector = (await fixture.db.query('select * from content.round_items where submission_id=$1', [created.submissionId])).rows;
  await recordRound(fixture.db, created.submissionId, token, { round: 0, candidateDigest: candidateDigest(vector), contentSha: 'a'.repeat(40), verdict: {}, overall: 9, passed: true, blockingCount: 0, lint: {}, decision: 'go' });
  await publishSubmission(fixture.db, created.submissionId, token);
  const script = path.join(dir, 'gate.json');
  await fs.writeFile(script, JSON.stringify({ reviews: [{ overall: 9, findings: [] }] }));
  return { ...fixture, dir, opts: { plan: fixturePlan, runDir: path.join(dir, 'run'), gateScript: script },
    cleanup: async () => { await fixture.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}
async function databaseRows(db) {
  const tables = (await db.query("select tablename from pg_tables where schemaname='content' order by tablename")).rows;
  const result = {};
  for (const { tablename } of tables) result[tablename] = (await db.query(`select row_to_json(t) as row from content.${tablename} t order by row_to_json(t)::text`)).rows;
  return result;
}
const payloads = async db => Object.fromEntries(Object.entries((await readLive(db, { datasets: ['posts', 'topics', 'services'] })).datasets).map(([d, v]) => [d, v.records]));

test('apply refuses an unconfirmed cluster before any DB or file writes', async () => {
  const f = await setup();
  try {
    const before = await databaseRows(f.db);
    const unconfirmed = structuredClone(fixturePlan);
    unconfirmed.clusters[1].confirmed = false;
    await assert.rejects(consolidate(f.db, { ...f.opts, plan: unconfirmed, apply: true }), /unconfirmed cluster/i);
    assert.deepEqual(await databaseRows(f.db), before);
    await assert.rejects(fs.stat(f.opts.runDir), { code: 'ENOENT' });
    const planFile = path.join(f.dir, 'unconfirmed.json');
    await fs.writeFile(planFile, JSON.stringify(unconfirmed));
    assert.throws(() => execFileSync(process.execPath, ['scripts/content/consolidate-clusters.mjs', '--plan', planFile, '--run-dir', f.opts.runDir, '--apply'], {
      encoding: 'utf8', env: { ...process.env, CONTENT_DATABASE_URL: f.url }, stdio: ['ignore', 'pipe', 'pipe'],
    }), error => error.status === 1 && /unconfirmed cluster/i.test(error.stderr));
    assert.deepEqual(await databaseRows(f.db), before);
    await assert.rejects(fs.stat(f.opts.runDir), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('dry-run writes nothing, real gate apply is reversible, repeated apply is a no-op', async () => {
  const f = await setup();
  try {
    const before = await databaseRows(f.db);
    const original = await payloads(f.db);
    assert.equal((await consolidate(f.db, f.opts)).dryRun, true);
    const planFile = path.join(f.dir, 'plan.json');
    await fs.writeFile(planFile, JSON.stringify(fixturePlan));
    const cli = JSON.parse(execFileSync(process.execPath, ['scripts/content/consolidate-clusters.mjs', '--plan', planFile, '--run-dir', f.opts.runDir], {
      encoding: 'utf8', env: { ...process.env, CONTENT_DATABASE_URL: f.url },
    }));
    assert.equal(cli.dryRun, true);
    assert.equal(cli.candidates.length, 3);
    assert.deepEqual(await databaseRows(f.db), before);
    await assert.rejects(fs.stat(f.opts.runDir), { code: 'ENOENT' });
    const applied = await consolidate(f.db, { ...f.opts, apply: true });
    assert.equal(applied.state, 'applied');
    const journal = JSON.parse(await fs.readFile(path.join(f.opts.runDir, 'snapshot.json')));
    assert.equal(journal.snapshots.length, 6);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.opts.runDir, 'redirects.json'))), redirectsFor(fixturePlan));
    const rows = await payloads(f.db);
    for (const [dataset, records] of Object.entries(rows)) {
      assert.equal(records.length, 1);
      const text = records[0].content ?? records[0].sections.map(s => s.content).join('\n');
      assert.match(text, /fixture-secondary/);
      assert.doesNotMatch(text, /\]\(/, 'self-links remain unlinked after gated persistence and read');
      assert.equal(records[0][dataset === 'services' ? 'specificFaqs' : 'faqs'].length, 1);
      assert.equal(validateRecord(dataset, records[0].slug, records[0]).ok, true);
    }
    assert.equal(Number((await f.db.query('select count(*) from content.gate_rounds where scripted')).rows[0].count), 3);
    const afterApply = await databaseRows(f.db);
    const snapshotText = await fs.readFile(path.join(f.opts.runDir, 'snapshot.json'), 'utf8');
    await consolidate(f.db, { ...f.opts, apply: true });
    assert.deepEqual(await databaseRows(f.db), afterApply);
    assert.equal(await fs.readFile(path.join(f.opts.runDir, 'snapshot.json'), 'utf8'), snapshotText);
    await consolidate(f.db, { ...f.opts, rollback: true });
    assert.deepEqual(await databaseRows(f.db), afterApply);
    const rollback = JSON.parse(execFileSync(process.execPath, ['scripts/content/consolidate-clusters.mjs', '--run-dir', f.opts.runDir, '--rollback', '--apply'], {
      encoding: 'utf8', env: { ...process.env, CONTENT_DATABASE_URL: f.url },
    }));
    assert.equal(rollback.state, 'rolled-back');
    // Exact live JSON rows/visibility/order restored. Immutable audit/revision history remains.
    assert.deepEqual(await payloads(f.db), original);
    const restored = await databaseRows(f.db);
    await consolidate(f.db, { ...f.opts, apply: true, rollback: true });
    assert.deepEqual(await databaseRows(f.db), restored);
    console.log('LOCAL DB: dry-run unchanged; 3 gated primaries; 3 unpublished; repeat unchanged; exact JSON rows restored');
  } finally { await f.cleanup(); }
});

test('gate rejection leaves all secondary rows published and snapshot available', async () => {
  const f = await setup();
  try {
    await fs.writeFile(f.opts.gateScript, JSON.stringify({ reviews: [{ overall: 1, findings: [{ severity: 'critical', note: 'rejected fixture', path: 'data/posts.json' }] }] }));
    await assert.rejects(consolidate(f.db, { ...f.opts, apply: true }), /content gate did not publish/);
    assert.equal((await fs.stat(path.join(f.opts.runDir, 'snapshot.json'))).isFile(), true);
    assert.equal((await f.db.query('select count(*) from content.entries where live_rev is null')).rows[0].count, '0');
  } finally { await f.cleanup(); }
});

test('changing a primary uses the same operation and plan-derived redirects', () => {
  const c = structuredClone(fixturePlan.clusters[0]);
  const records = new Map(c.members.map((m, i) => [m.url, { slug: routeRow(m.url).key, content: `## Useful detail\n\nUseful ${i}.`, faqs: [] }]));
  c.primary = c.members[1].url;
  const r = redirectsFor({ version: 1, clusters: [c] });
  assert.equal(r[0].destination, c.primary);
  assert.match(mergeCluster(c, records, r, '2026-10-26').content, /Useful 0/);
});

test('live HTTP: unconfirmed sources do not redirect; confirmed 301s lead directly to 200 primaries', { skip: !process.env.CONSOLIDATION_BASE_URL }, async () => {
  const base = process.env.CONSOLIDATION_BASE_URL;
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
  for (const c of plan.clusters) {
    for (const m of c.members.filter(m => m.url !== c.primary)) {
      const response = await fetch(new URL(m.url, base), { method: 'HEAD', redirect: 'manual' });
      if (c.confirmed === true) {
        assert.equal(response.status, 301, m.url);
        assert.equal(new URL(response.headers.get('location'), base).pathname, c.primary);
      } else {
        assert.ok([200, 404].includes(response.status), `${m.url}: ${response.status}`);
        assert.equal(response.headers.get('location'), null, m.url);
      }
    }
    const target = await fetch(new URL(c.primary, base), { method: 'HEAD', redirect: 'manual' });
    assert.equal(target.status, 200, c.primary);
  }
});
