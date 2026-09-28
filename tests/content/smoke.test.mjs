// B4 smoke over fake HTTP (fake deployed site + fake current-rev adapter), and the
// g6/g8 propagation helpers. The real-store variants land with A1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import './fixtures/agent-sdk-mock.mjs';
import { buildDeployment, fakeAlias, fakeLive, virtualClock } from './fixtures/fake-site.mjs';
import {
  createHttp, escapedMarkers, runSmoke, SMOKE_DEADLINE_MS, SMOKE_INTERVAL_MS,
} from '../../scripts/content/smoke.mjs';
import { DeployHookError, requestDeploy } from '../../scripts/content/deploy.mjs';
import {
  formatAdmin, formatAdminSmokeAlert, formatCompensationConflict, formatFailure, formatPropagationWarning,
  formatSuccess, notifyOnce, postSlack,
} from '../../scripts/content/notify.mjs';

const registry = JSON.parse(fs.readFileSync(new URL('./fixtures/registry.json', import.meta.url), 'utf8'));
const business = (slug, name, extra = {}) => ({ slug, name, description: 'd', image: '', ...extra });

function smoke({ alias, live, clock, liveSeq, items, ...rest }) {
  return runSmoke({ liveSeq, items, registry, readCurrent: live.readCurrent, http: alias.http, now: clock.now, wait: clock.wait, ...rest });
}

test('own insert passes: page marker (escaped), sitemap <loc>, /media bytes match the manifest sha', async () => {
  const live = fakeLive();
  const image = '/media/0123456789abcdef/wilbur-s-taco-shop.jpg';
  live.set('businesses', 'wilbur-s-taco-shop', 1, business('wilbur-s-taco-shop', "Wilbur's Tacos & Co", { image }));
  const alias = fakeAlias(buildDeployment({ live, liveSeq: 42, url: 'https://dep-1', registry }));
  const clock = virtualClock();
  const result = await smoke({ alias, live, clock, liveSeq: 42, items: [{ dataset: 'businesses', key: 'wilbur-s-taco-shop', publishedRev: 1 }] });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.results, [{ dataset: 'businesses', key: 'wilbur-s-taco-shop', smoke: 'passed' }]);
  assert.ok(alias.state.requests.includes(image));
  assert.deepEqual(escapedMarkers("Wilbur's Tacos & Co"), ['Wilbur&#x27;s Tacos &amp; Co', 'Wilbur&#39;s Tacos &amp; Co']);
});

test('A and B on the same key coalesced into one build: A superseded, B passed, nothing compensated', async () => {
  const live = fakeLive();
  live.set('businesses', 'k', 1, business('k', 'Version A'));
  live.set('businesses', 'k', 2, business('k', 'Version B'));
  const alias = fakeAlias(buildDeployment({ live, liveSeq: 11, url: 'https://dep-ab', registry }));
  const clock = virtualClock();
  const a = await smoke({ alias, live, clock, liveSeq: 10, items: [{ dataset: 'businesses', key: 'k', publishedRev: 1 }] });
  const b = await smoke({ alias, live, clock, liveSeq: 11, items: [{ dataset: 'businesses', key: 'k', publishedRev: 2 }] });
  assert.deepEqual([a.status, a.results[0].smoke], ['passed', 'superseded']);
  assert.deepEqual([b.status, b.results[0].smoke], ['passed', 'passed']);
  assert.ok(!alias.state.requests.includes('/directory/k') || b.results[0].smoke === 'passed');
});

test('independent keys in one build both pass in a single pass', async () => {
  const live = fakeLive();
  live.set('businesses', 'one', 1, business('one', 'One'));
  live.set('posts', 'two', 3, { slug: 'two', title: 'Two', image: '/images/blog/two.jpg' });
  const alias = fakeAlias(buildDeployment({ live, liveSeq: 5, url: 'https://dep-5', registry }));
  const clock = virtualClock();
  const result = await smoke({ alias, live, clock, liveSeq: 5, items: [{ dataset: 'businesses', key: 'one', publishedRev: 1 }, { dataset: 'posts', key: 'two', publishedRev: 3 }] });
  assert.equal(result.status, 'passed');
  assert.equal(result.passes, 1);
  assert.deepEqual(result.results.map((entry) => entry.smoke), ['passed', 'passed']);
});

test('a still-pending successor: A waits for the manifest to show B, then times out, never bad-render', async () => {
  const live = fakeLive();
  live.set('businesses', 'k', 1, business('k', 'Version A'));
  const deployedA = buildDeployment({ live, liveSeq: 10, url: 'https://dep-a', registry });
  live.set('businesses', 'k', 2, business('k', 'Version B')); // B published, its build not live yet
  const alias = fakeAlias(deployedA);
  const clock = virtualClock();
  const result = await smoke({ alias, live, clock, liveSeq: 10, items: [{ dataset: 'businesses', key: 'k', publishedRev: 1 }] });
  assert.equal(result.status, 'timeout');
  assert.deepEqual(result.pending, [{ dataset: 'businesses', key: 'k' }]);
  assert.match(result.waiting[0].reason, /manifest shows rev 1, DB live rev 2/);
  assert.ok(!alias.state.requests.includes('/directory/k'), 'never compares against the older payload');
  assert.ok(clock.t - Date.parse('2026-09-27T12:00:00Z') >= SMOKE_DEADLINE_MS);
  assert.ok(clock.waits.every((ms) => ms === SMOKE_INTERVAL_MS));
});

test('an unpublish successor: DB live absent and manifest absent resolves A as superseded', async () => {
  const live = fakeLive();
  live.set('businesses', 'gone', 1, business('gone', 'Gone'));
  live.set('businesses', 'keep', 1, business('keep', 'Keep'));
  live.set('businesses', 'gone', null);
  const alias = fakeAlias(buildDeployment({ live, liveSeq: 8, url: 'https://dep-8', registry }));
  const result = await smoke({ alias, live, clock: virtualClock(), liveSeq: 7, items: [{ dataset: 'businesses', key: 'gone', publishedRev: 1 }] });
  assert.deepEqual([result.status, result.results[0].smoke], ['passed', 'superseded']);
});

test('page absent (unpublish / compensated insert): 404 and no sitemap <loc> passes; a still-served page is a bad render', async () => {
  const live = fakeLive();
  live.set('businesses', 'keep', 1, business('keep', 'Keep'));
  live.set('businesses', 'keep-more', 1, business('keep-more', 'Keep More'));
  const alias = fakeAlias(buildDeployment({ live, liveSeq: 20, url: 'https://dep-20', registry }));
  const ok = await smoke({ alias, live, clock: virtualClock(), liveSeq: 20, items: [{ dataset: 'businesses', key: 'keep-mo', publishedRev: null }] });
  assert.deepEqual([ok.status, ok.results[0].smoke], ['passed', 'passed'], 'prefix of a listed URL is not a match');
  const stale = buildDeployment({ live, liveSeq: 21, url: 'https://dep-21', registry });
  stale.pages.set('/directory/removed', { status: 200, contentType: 'text/html', body: Buffer.from('<h1>Removed</h1>') });
  const aliasStale = fakeAlias(stale);
  const bad = await smoke({ alias: aliasStale, live, clock: virtualClock(), liveSeq: 21, items: [{ dataset: 'businesses', key: 'removed', publishedRev: null }] });
  assert.equal(bad.status, 'bad-render');
  assert.match(bad.failures[0].reason, /returned 200, expected 404/);
});

test('deployment identity change mid-check discards the pass and repeats', async () => {
  const live = fakeLive();
  live.set('businesses', 'k', 1, business('k', 'K'));
  const first = buildDeployment({ live, liveSeq: 3, url: 'https://dep-old', registry, breakPages: ['/directory/k'] });
  const second = buildDeployment({ live, liveSeq: 3, url: 'https://dep-new', registry });
  const alias = fakeAlias(first);
  let manifestReads = 0;
  alias.state.onRequest = (target, state) => {
    if (target === '/content-snapshot/manifest.json' && ++manifestReads === 2) state.current = second; // M2 of pass 1
  };
  const result = await smoke({ alias, live, clock: virtualClock(), liveSeq: 3, items: [{ dataset: 'businesses', key: 'k', publishedRev: 1 }] });
  assert.equal(result.status, 'passed', 'the broken page seen before the identity switch is discarded');
  assert.equal(result.passes, 2);
});

test('freshness: waits while manifest live_seq is behind, then passes on the new deployment', async () => {
  const live = fakeLive();
  live.set('topics', 't', 1, { slug: 't', title: 'Old' });
  const alias = fakeAlias(buildDeployment({ live, liveSeq: 1, url: 'https://dep-1', registry }));
  live.set('topics', 't', 2, { slug: 't', title: 'New & improved' });
  const clock = virtualClock();
  clock.hooks.push((t) => { if (t - Date.parse('2026-09-27T12:00:00Z') >= 3 * SMOKE_INTERVAL_MS) alias.promote(buildDeployment({ live, liveSeq: 2, url: 'https://dep-2', registry })); });
  const result = await smoke({ alias, live, clock, liveSeq: 2, items: [{ dataset: 'topics', key: 't', publishedRev: 2 }] });
  assert.equal(result.status, 'passed');
  assert.ok(result.passes >= 4);
});

test('queue snapshot adapter: file sha must equal manifest.files; a tampered file is a bad render', async () => {
  const key = 'a'.repeat(64);
  const live = fakeLive();
  live.set('topic-queue', key, 1, { key, kind: 'blog', title: 'Topic', source: 's', rationale: 'r', addedAt: '2026-09-01', attempts: 0, branchPrefix: 'blog/auto-' });
  const good = await smoke({ alias: fakeAlias(buildDeployment({ live, liveSeq: 9, url: 'https://dep-9', registry })), live, clock: virtualClock(), liveSeq: 9, items: [{ dataset: 'topic-queue', key, publishedRev: 1 }] });
  assert.deepEqual([good.status, good.results[0].smoke], ['passed', 'passed']);
  const bad = await smoke({ alias: fakeAlias(buildDeployment({ live, liveSeq: 9, url: 'https://dep-9b', registry, breakFiles: ['topic-queue.json'] })), live, clock: virtualClock(), liveSeq: 9, items: [{ dataset: 'topic-queue', key, publishedRev: 1 }] });
  assert.equal(bad.status, 'bad-render');
  assert.match(bad.failures[0].reason, /topic-queue\.json does not match the manifest sha256/);
});

test('proven bad render: own item, manifest at its published sha, page check fails on a stable identity (after 3 tries)', async () => {
  const live = fakeLive();
  live.set('guide-hub', 'guide-hub', 4, { answerSummary: `Liberty Village is a former industrial district turned into a dense condo neighbourhood.` });
  const alias = fakeAlias(buildDeployment({ live, liveSeq: 30, url: 'https://dep-30', registry, breakPages: ['/guide'] }));
  const clock = virtualClock();
  const result = await smoke({ alias, live, clock, liveSeq: 30, items: [{ dataset: 'guide-hub', key: 'guide-hub', publishedRev: 4 }] });
  assert.equal(result.status, 'bad-render');
  assert.equal(result.deploymentUrl, 'https://dep-30');
  assert.deepEqual(result.failures.map((failure) => failure.key), ['guide-hub']);
  assert.equal(alias.state.requests.filter((target) => target === '/guide').length, 3);
  assert.deepEqual(clock.waits, [10_000, 10_000]);
});

test('a missing /media manifest entry or wrong bytes fail the image check', async () => {
  const live = fakeLive();
  const image = '/media/fedcba9876543210/p.png';
  live.set('posts', 'p', 1, { slug: 'p', title: 'P', image });
  const deployment = buildDeployment({ live, liveSeq: 2, url: 'https://dep-p', registry });
  deployment.pages.set(image, { status: 200, contentType: 'image/png', body: Buffer.from('different bytes') });
  const result = await smoke({ alias: fakeAlias(deployment), live, clock: virtualClock(), liveSeq: 2, items: [{ dataset: 'posts', key: 'p', publishedRev: 1 }] });
  assert.equal(result.status, 'bad-render');
  assert.match(result.failures[0].reason, /is not the expected image/);
});

test('createHttp sends the protection bypass header and no-cache, and maps network errors to status 0', async () => {
  const seen = [];
  const http = createHttp({
    siteUrl: 'https://staging.example/', bypass: 'secret-bypass',
    fetchImpl: async (url, init) => { seen.push({ url, headers: init.headers }); if (url.endsWith('/boom')) throw new Error('ECONNRESET'); return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }); },
  });
  const ok = await http.get('/x');
  assert.deepEqual([ok.status, ok.contentType, ok.body.toString()], [200, 'text/plain', 'ok']);
  assert.equal(seen[0].url, 'https://staging.example/x');
  assert.equal(seen[0].headers['x-vercel-protection-bypass'], 'secret-bypass');
  assert.equal(seen[0].headers['cache-control'], 'no-cache');
  assert.equal((await http.get('/boom')).status, 0);
  const plain = createHttp({ siteUrl: 'https://libertyvillage.co', fetchImpl: async (url, init) => { seen.push({ url, headers: init.headers }); return new Response('', { status: 404 }); } });
  await plain.get('/y');
  assert.equal(seen.at(-1).headers['x-vercel-protection-bypass'], undefined);
});

test('deploy hook: 2 attempts, 2xx required, failure is a DeployHookError (propagation)', async () => {
  const calls = [];
  const ok = await requestDeploy({ hookUrl: 'https://hook', fetchImpl: async (url, init) => { calls.push([url, init.method]); return new Response('{}', { status: calls.length === 1 ? 500 : 201 }); } });
  assert.deepEqual(ok, { status: 201, attempts: 2 });
  assert.deepEqual(calls, [['https://hook', 'POST'], ['https://hook', 'POST']]);
  let tries = 0;
  await assert.rejects(requestDeploy({ hookUrl: 'https://hook', fetchImpl: async () => { tries += 1; return new Response('', { status: 500 }); } }),
    (error) => error instanceof DeployHookError && error.code === 'hook-failed' && /HTTP 500; HTTP 500/.test(error.message));
  assert.equal(tries, 2);
  await assert.rejects(requestDeploy({ hookUrl: 'https://127.0.0.1:9/x', fetchImpl: async () => { throw new TypeError('fetch failed'); } }), /fetch failed; fetch failed/);
  await assert.rejects(requestDeploy({ hookUrl: '' }), /CONTENT_DEPLOY_HOOK_URL is not set/);
});

test('notify: success/admin/failure/warning lines carry the stable #id; [scripted] prefix; ≤ 10 item lines', () => {
  const submission = { id: 17, kind: 'business', target: 'staging', overall: '8.50', repairs: 1 };
  const items = [{ dataset: 'businesses', key: 'wilbur-s-taco-shop', payload: { name: "Wilbur's Taco Shop" } }];
  assert.equal(formatSuccess({ submission, items, registry, siteUrl: 'https://alias.example/' }),
    "✅ staging published: Wilbur's Taco Shop — https://alias.example/directory/wilbur-s-taco-shop (#17, business, 8.5, 1)");
  assert.equal(formatSuccess({ submission, items, registry, siteUrl: 'https://alias.example', scripted: true }).split('\n').length, 1);
  assert.match(formatSuccess({ submission, items, registry, siteUrl: 'https://a', scripted: true }), /^\[scripted\] ✅ /);
  const many = Array.from({ length: 12 }, (_, index) => ({ dataset: 'topic-queue', key: String(index).padStart(64, '0'), payload: { title: `Topic ${index}` } }));
  const lines = formatSuccess({ submission: { ...submission, kind: 'topic-discovery' }, items: many, registry, siteUrl: 'https://a' }).split('\n');
  assert.equal(lines.length, 11);
  assert.match(lines[0], /Topic 0 — https:\/\/a\/content-snapshot\/topic-queue\.json \(#17, topic-discovery/);
  assert.match(lines[10], /… and 2 more \(#17/);
  assert.equal(formatAdmin({ submission: { id: 21, target: 'staging' }, items: [{ op: 'unpublish', dataset: 'businesses', key: 'k' }] }), '🔁 staging unpublish businesses/k (#21)');
  const failure = formatFailure({
    submission: { id: 18, kind: 'manual', target: 'staging' }, decision: 'unrepairable', overall: 6.5,
    findings: [{ severity: 'low', path: 'l', note: 'low' }, { severity: 'critical', path: 'c', note: 'crit' }, { severity: 'high', path: 'h', note: 'high' }, { severity: 'medium', path: 'm', note: 'med' }],
  }).split('\n');
  assert.deepEqual(failure, ['❌ staging manual #18 unrepairable (score 6.5)', '• [critical] c: crit', '• [high] h: high', '• [medium] m: med', 'content show --submission 18']);
  assert.match(formatFailure({ submission: { id: 2, kind: 'blog', target: 'test' }, decision: 'lint', errors: ['data/posts.json: p: [unrecorded-business] X'] }), /#2 lint \(score n\/a\)\n• data\/posts\.json: p/);
  assert.match(formatPropagationWarning({ submission, reason: 'hook-failed' }), /^⚠ staging #17 published but not yet live \(hook-failed\); resume with content deploy --target staging$/);
  assert.match(formatCompensationConflict({ submission }), /#17 smoke-failed: compensation-conflict/);
  assert.match(formatAdminSmokeAlert({ submission: { id: 21, target: 'staging' }, failures: [{ dataset: 'businesses', key: 'k', reason: 'x' }] }), /admin #21 smoke failed \(businesses\/k: x\); no automatic undo/);
});

test('notifyOnce: skipped when notified_at is set; a crash after delivery repeats the same #id line on resume', async () => {
  const delivered = [];
  const marks = [];
  const post = async (text) => { delivered.push(text); };
  const text = '✅ staging published: X — https://a/directory/x (#17, manual, 9, 0)';
  await assert.rejects(notifyOnce({ submission: { id: 17, notified_at: null }, text, post, markNotified: async () => { throw new Error('killed before markPhase'); } }), /killed/);
  const resumed = await notifyOnce({ submission: { id: 17, notified_at: null }, text, post, markNotified: async () => { marks.push('notified'); } });
  assert.deepEqual(resumed, { posted: true, skipped: false });
  assert.deepEqual(delivered, [text, text], 'at-least-once: the same #17 line twice');
  assert.deepEqual(await notifyOnce({ submission: { id: 17, notified_at: '2026-09-27T12:00:00Z' }, text, post, markNotified: async () => marks.push('again') }), { posted: false, skipped: true });
  assert.deepEqual(marks, ['notified']);
  assert.equal(delivered.length, 2);
});

test('postSlack posts {text} and refuses a non-2xx or a missing webhook', async () => {
  const sent = [];
  await postSlack({ webhookUrl: 'https://hooks.slack.test/x', text: 'hi', fetchImpl: async (url, init) => { sent.push([url, init.method, init.body, init.headers['content-type']]); return new Response('ok', { status: 200 }); } });
  assert.deepEqual(sent, [['https://hooks.slack.test/x', 'POST', '{"text":"hi"}', 'application/json']]);
  await assert.rejects(postSlack({ webhookUrl: 'https://hooks.slack.test/x', text: 'hi', fetchImpl: async () => new Response('no', { status: 500 }) }), /slack-webhook-failed: HTTP 500/);
  await assert.rejects(postSlack({ webhookUrl: '', text: 'hi' }), /slack-webhook-missing/);
});

// ---------------------------------------------------------------------------
// B4 with the real store: DB current revs drive own/superseded classification.
// ---------------------------------------------------------------------------
import { fileURLToPath } from 'node:url';
import * as store from '../../scripts/content/store.mjs';
import { submitContent } from '../../scripts/content/submit.mjs';
import { adminContent, deployContent } from '../../scripts/content/deploy.mjs';
import { baselineFile, FAST_SMOKE, localSite, seededDb, seedRecords, tempJson } from './fixtures/content-db.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SEEDED = seedRecords().businesses;
const PASS_SCRIPT = tempJson({ reviews: [{ overall: 9, findings: [] }] }, 'pass.json');
const { gateContent } = await import('../../scripts/content/gate.mjs');

async function publishEdit(db, site, record, key) {
  const { result } = await submitContent(db, { kind: 'manual', idempotencyKey: key, actor: 'uat:test', recordFile: tempJson(record), dataset: 'businesses', baseline: await baselineFile(db) }, { checkout: REPO });
  return { id: result.submissionId, gate: await gateContent(db, { submission: result.submissionId, script: PASS_SCRIPT, actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE }, checkout: REPO }) };
}

async function realStore(fn) {
  const handle = await seededDb();
  const site = await localSite(handle.db);
  await site.build();
  try { await fn(handle.db, site); } finally { await site.close(); await handle.close(); }
}
const deploy = (db, site) => deployContent(db, { actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE } });
const itemSmoke = async (db, id) => (await store.getSubmission(db, id)).items[0].smoke;

test('real store: a still-pending successor keeps A waiting (exit 3, never compensated), then both resolve', async () => {
  await realStore(async (db, site) => {
    const biz = SEEDED[4];
    site.state.hook = 'accept'; // hook accepted, no build lands
    const a = await publishEdit(db, site, { ...biz, proTip: 'Version A.' }, 'pend-a');
    assert.equal(a.gate.exitCode, 3);
    await site.build(); // the build that contains A
    const b = await publishEdit(db, site, { ...biz, proTip: 'Version B.' }, 'pend-b');
    assert.equal(b.gate.exitCode, 3);
    const waiting = await deploy(db, site);
    assert.equal(waiting.exitCode, 3, JSON.stringify(waiting.result));
    assert.deepEqual(waiting.result.submissions.map((entry) => entry.smoke), ['pending', 'pending']);
    assert.equal((await store.getSubmission(db, a.id)).submission.state, 'published', 'A is never compensated');
    site.state.hook = 'build';
    const done = await deploy(db, site);
    assert.equal(done.exitCode, 0, JSON.stringify(done.result));
    assert.deepEqual([await itemSmoke(db, a.id), await itemSmoke(db, b.id)], ['superseded', 'passed']);
  });
});

test('real store: an unpublish successor resolves A as superseded; the admin item smokes absent', async () => {
  await realStore(async (db, site) => {
    site.state.hook = 'accept';
    const a = await publishEdit(db, site, { ...SEEDED[0], slug: 'short-lived', name: 'Short Lived' }, 'short');
    assert.equal(a.gate.exitCode, 3);
    site.state.hook = 'build';
    const unpublish = await adminContent(db, { op: 'unpublish', dataset: 'businesses', key: 'short-lived', reason: 'uat', idempotencyKey: 'u-short', actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE } });
    assert.equal(unpublish.exitCode, 0, JSON.stringify(unpublish.result));
    const done = await deploy(db, site);
    assert.equal(done.exitCode, 0, JSON.stringify(done.result));
    assert.equal(await itemSmoke(db, a.id), 'superseded');
    assert.equal(await itemSmoke(db, unpublish.result.submissionId), 'passed');
    assert.equal((await fetch(`${site.origin}/directory/short-lived`)).status, 404);
  });
});

test('real store: independent keys in one build; content deploy replays every pending submission with one hook POST', async () => {
  await realStore(async (db, site) => {
    site.state.hook = 'accept';
    const one = await publishEdit(db, site, { ...SEEDED[1], proTip: 'Independent one.' }, 'ind-1');
    const two = await publishEdit(db, site, { ...SEEDED[2], proTip: 'Independent two.' }, 'ind-2');
    assert.deepEqual([one.gate.exitCode, two.gate.exitCode], [3, 3]);
    const posts = site.state.hookPosts;
    site.state.hook = 'build';
    const done = await deploy(db, site);
    assert.equal(done.exitCode, 0, JSON.stringify(done.result));
    assert.equal(site.state.hookPosts, posts + 1, 'one hook POST for the whole replay');
    assert.equal(site.state.builds, 2);
    assert.deepEqual(done.result.submissions.map((entry) => [entry.id, entry.smoke]), [[one.id, 'passed'], [two.id, 'passed']]);
    assert.deepEqual([await itemSmoke(db, one.id), await itemSmoke(db, two.id)], ['passed', 'passed']);
    assert.deepEqual(await store.listPending(db, { target: 'test' }), []);
    assert.equal(site.state.slack.filter((text) => text.includes(`(#${one.id},`)).length, 1);
  });
});
