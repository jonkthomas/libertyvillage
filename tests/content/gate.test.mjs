// Gate decision (g4), --script seam, reviewRows and lenses. DB-free: the round
// state machine against a real store lands with A1 (gate-resume.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fakeAgent, queueAgent } from './fixtures/agent-sdk-mock.mjs';
import { GATE_MODEL, MAX_REPAIRS, SCORE_THRESHOLD } from '../../scripts/automation/constants.mjs';
import { evaluateRepairProgress } from '../../scripts/automation/recovery.mjs';
import { preflightDecision } from '../../scripts/automation/preflight.mjs';
import { evaluateVerdict } from '../../scripts/automation/policy.mjs';
import { buildReviewDocument } from '../../scripts/content/review-document.mjs';
import * as store from '../../scripts/content/store.mjs';
import { candidateDigest } from '../../scripts/content/canonical.mjs';
import { submitContent } from '../../scripts/content/submit.mjs';
import { adminContent, deployContent } from '../../scripts/content/deploy.mjs';
import { runDbIngest } from '../../scripts/supervisor/ingest-db.mjs';
import { publishDirect, baselineFile, FAST_SMOKE, liveRecord, localSite, seededDb, seedRecords, tempJson } from './fixtures/content-db.mjs';

// gate.mjs reaches review-agent -> the agent SDK, so it is imported only after
// agent-sdk-mock has redirected the SDK (static imports would link the real one).
const {
  assertScriptAllowed, decideRound, fixerPayload, loadScript, POLICY_KIND, scriptedFix, scriptedVerdict, gateContent,
  toNumeric2, roundVector, basePayloads,
} = await import('../../scripts/content/gate.mjs');
const { reviewRows, LENSES, VERDICT_SCHEMA } = await import('../../scripts/automation/review-agent.mjs');
const { lensesFor, MANUAL_LENSES } = await import('../../scripts/content/lenses.mjs');

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SHA = 'c'.repeat(40);
const verdict = (overall, findings = []) => ({ overall, findings, model: GATE_MODEL, commit_sha: SHA });
const high = (path = 'data/businesses.json#wilbur-s-taco-shop', note = 'unsupported claim') => ({ severity: 'high', path, note });

test('round 0 7.2 repair -> round 1 6.5 is not-converging; prior-rounds-only history would have continued', () => {
  const round0 = decideRound({ kind: 'business', verdict: verdict(7.2, [high()]), contentSha: SHA, repairs: 0, round: 0, datasets: ['businesses'] });
  assert.equal(round0.decision, 'repair');
  assert.equal(round0.blockingCount, 1);
  const stored = [{ round: 0, overall: '7.20', blocking_count: 1 }]; // numeric(4,2) comes back as a string
  const round1 = decideRound({ kind: 'business', verdict: verdict(6.5, [high()]), contentSha: SHA, repairs: 1, round: 1, priorRounds: stored, datasets: ['businesses'] });
  assert.equal(round1.decision, 'not-converging');
  assert.equal(round1.progress.decision, 'abandon');
  assert.match(round1.progress.reason, /score regressed 7\.2 -> 6\.5/);
  // Regression: the history without the current round has a single entry and continues.
  const priorOnly = evaluateRepairProgress({ history: stored.map((row) => ({ attempt: row.round, overall: Number(row.overall), blockingCount: row.blocking_count })) });
  assert.equal(priorOnly.decision, 'continue');
});

test('a new blocking finding after a repair is not-converging even when the score holds', () => {
  const result = decideRound({
    kind: 'blog', verdict: verdict(7.5, [high('data/posts.json#p'), high('data/posts.json#p', 'another')]), contentSha: SHA,
    repairs: 1, round: 1, priorRounds: [{ round: 0, overall: '7.50', blocking_count: 1 }], datasets: ['posts'],
  });
  assert.equal(result.decision, 'not-converging');
});

test('go / unrepairable / block / exhausted routing, with finding paths cut at #', () => {
  assert.equal(decideRound({ kind: 'manual', verdict: verdict(SCORE_THRESHOLD), contentSha: SHA, repairs: 0, round: 0, datasets: ['services'] }).decision, 'go');
  assert.equal(decideRound({ kind: 'manual', verdict: verdict(SCORE_THRESHOLD), contentSha: SHA, repairs: 0, round: 0, datasets: ['services'] }).passed, true);
  // topic-discovery is noFixer: anything short of go is unrepairable.
  assert.equal(decideRound({ kind: 'topic-discovery', verdict: verdict(5, [high('data/topic-queue.json#' + 'a'.repeat(64))]), contentSha: SHA, repairs: 0, round: 0, datasets: ['topic-queue'] }).decision, 'unrepairable');
  // Structural note => unrepairable even on a repairable path.
  assert.equal(decideRound({ kind: 'business', verdict: verdict(6, [high(undefined, 'immutable slug duplicates another')]), contentSha: SHA, repairs: 0, round: 0, datasets: ['businesses'] }).decision, 'unrepairable');
  // Budget spent: block becomes exhausted at repairs === MAX_REPAIRS.
  const spent = decideRound({ kind: 'business', verdict: verdict(7.4, [high()]), contentSha: SHA, repairs: MAX_REPAIRS, round: MAX_REPAIRS, priorRounds: [{ round: MAX_REPAIRS - 1, overall: '7.0', blocking_count: 1 }], datasets: ['businesses'] });
  assert.equal(spent.decision, 'exhausted');
  // A verdict bound to another sha is invalid: block, never repair.
  const wrongSha = { ...verdict(9), commit_sha: 'd'.repeat(40) };
  assert.equal(decideRound({ kind: 'business', verdict: wrongSha, contentSha: SHA, repairs: 0, round: 0, datasets: ['businesses'] }).decision, 'block');
  // Without the cut, the #key path is not a repo path and the same verdict would be unrepairable.
  const raw = verdict(7, [high()]);
  assert.equal(preflightDecision({ verdict: raw, contentSha: SHA, attempts: 0, kind: 'business', changedFiles: ['data/businesses.json'] }), 'unrepairable');
  assert.equal(decideRound({ kind: 'business', verdict: raw, contentSha: SHA, repairs: 0, round: 0, datasets: ['businesses'] }).decision, 'repair');
  assert.equal(POLICY_KIND.manual, 'seo');
  assert.equal(decideRound({ kind: 'manual', verdict: verdict(7, [high('data/guide-hub.json#guide-hub')]), contentSha: SHA, repairs: 0, round: 0, datasets: ['guide-hub'] }).decision, 'repair');
});

test('fractional overall round-trips through storage without changing the decision', () => {
  for (const overall of [7.25, 8.75, 8, 0.5, 9.99]) {
    const raw = verdict(overall, overall < SCORE_THRESHOLD ? [high()] : []);
    const first = decideRound({ kind: 'business', verdict: raw, contentSha: SHA, repairs: 0, round: 0, datasets: ['businesses'] });
    assert.equal(first.overall, overall);
    const replayed = JSON.parse(JSON.stringify(raw)); // gate_rounds.verdict json
    assert.deepEqual(decideRound({ kind: 'business', verdict: replayed, contentSha: SHA, repairs: 0, round: 0, datasets: ['businesses'] }), first);
    assert.equal(Number(overall.toFixed(2)), overall, 'numeric(4,2) holds the value exactly');
    assert.equal(typeof first.overall, 'number');
  }
});

test('--script seam: refused outside lv_staging/lv_test_*, fills model/commit_sha, still evaluated', () => {
  assert.throws(() => assertScriptAllowed('neondb'), /refused on database neondb/);
  assert.throws(() => assertScriptAllowed('lv_stagingx'), /refused/);
  assert.doesNotThrow(() => assertScriptAllowed('lv_staging'));
  assert.doesNotThrow(() => assertScriptAllowed('lv_test_123_ab'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-script-'));
  const file = path.join(dir, 's.json');
  fs.writeFileSync(file, JSON.stringify({ reviews: [{ overall: 6, findings: [high()] }, { overall: 8.5, findings: [] }], fixes: [{ files: [{ file: 'data/businesses.json', records: [] }], reason: 'fix' }] }));
  assert.throws(() => loadScript(file, { dbName: 'neondb' }), /refused/);
  const script = loadScript(file, { dbName: 'lv_test_1_x' });
  const round1 = scriptedVerdict(script, 1, SHA);
  assert.deepEqual(round1, { overall: 8.5, findings: [], model: GATE_MODEL, commit_sha: SHA });
  assert.equal(evaluateVerdict(round1, SHA).passed, true);
  assert.throws(() => scriptedVerdict(script, 2, SHA), /no review for round 2/);
  const bad = scriptedVerdict({ reviews: [{ overall: 11, findings: [] }] }, 0, SHA);
  assert.equal(decideRound({ kind: 'manual', verdict: bad, contentSha: SHA, repairs: 0, round: 0, datasets: ['posts'] }).decision, 'block');
  assert.equal(scriptedFix(script, 0).plan_type, 'record-repair');
  assert.throws(() => scriptedFix(script, 1), /no fix for fixer call 1/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fixerPayload groups round records per file in (dataset,key) order', () => {
  assert.deepEqual(fixerPayload([
    { dataset: 'posts', key: 'b', payload: { slug: 'b' } },
    { dataset: 'businesses', key: 'z', payload: { slug: 'z' } },
    { dataset: 'posts', key: 'a', payload: { slug: 'a' } },
  ]), [
    { file: 'data/businesses.json', records: [{ slug: 'z' }] },
    { file: 'data/posts.json', records: [{ slug: 'a' }, { slug: 'b' }] },
  ]);
});

test('reviewRows uses reviewContent\'s prompt structure and throws unless the verdict evaluates', async () => {
  const { document, contentSha } = buildReviewDocument({
    submissionId: 3, round: 0, kind: 'news', target: 'test',
    items: [{ dataset: 'posts', key: 'p', base: null, candidate: { slug: 'p', title: 'T' } }],
  });
  const references = [{ slug: 'wilbur', name: 'Wilbur' }];
  const inventory = { serviceSlugs: [], topicSlugs: [], postSlugs: ['/blog/x'], blogImages: [], count: 1 };
  const evidence = { clusterId: 'c1', sources: [] };
  queueAgent({ overall: 8.25, findings: [{ severity: 'low', path: 'data/posts.json#p', note: 'ok' }], model: GATE_MODEL, commit_sha: contentSha });
  const raw = await reviewRows({ kind: 'news', lenses: LENSES.news, document, contentSha, references, inventory, evidence });
  assert.equal(raw.overall, 8.25);
  const { prompt, options } = fakeAgent.calls[0];
  assert.equal(options.model, GATE_MODEL);
  assert.equal(options.outputFormat.schema, VERDICT_SCHEMA);
  assert.equal(options.maxBudgetUsd, 4);
  for (const lens of LENSES.news) assert.ok(prompt.includes(lens));
  assert.match(prompt, /GROUNDING lens/);
  assert.match(prompt, /INVENTORY lens/);
  assert.match(prompt, new RegExp(`overall >= ${SCORE_THRESHOLD} with zero blocking findings`));
  assert.ok(prompt.includes(`Set model exactly ${GATE_MODEL}; set commit_sha exactly ${contentSha}.`));
  assert.ok(prompt.includes(`<<<UNTRUSTED_DIFF_DATA>>>\n${document}\n<<<END_UNTRUSTED_DIFF_DATA>>>`));
  assert.match(prompt, /<<<UNTRUSTED_REFERENCE_DATA>>>/);
  assert.match(prompt, /<<<UNTRUSTED_INVENTORY_DATA>>>/);
  assert.match(prompt, /<<<UNTRUSTED_EVIDENCE_DATA>>>/);

  queueAgent({ overall: 9, findings: [], model: GATE_MODEL, commit_sha: 'e'.repeat(40) });
  await assert.rejects(reviewRows({ kind: 'seo', lenses: LENSES.seo, document, contentSha }), /invalid gate verdict: commit_sha/);
  queueAgent({ overall: 9, findings: [], model: GATE_MODEL, commit_sha: contentSha });
  await reviewRows({ kind: 'seo', lenses: LENSES.seo, document, contentSha });
  assert.doesNotMatch(fakeAgent.calls[0].prompt, /GROUNDING lens|INVENTORY lens|UNTRUSTED_EVIDENCE_DATA/);
});

test('lenses: automated kinds reuse LENSES verbatim, manual gets DATA/CONTENT/SHAPE per site dataset', () => {
  for (const kind of ['business', 'blog', 'blog-live', 'news', 'topic-discovery', 'seo']) assert.equal(lensesFor(kind, 'posts'), LENSES[kind]);
  const datasets = ['businesses', 'posts', 'buildings', 'neighborhoods', 'services', 'topics', 'guide-hub'];
  assert.deepEqual(Object.keys(MANUAL_LENSES).sort(), [...datasets].sort());
  for (const dataset of datasets) {
    const lenses = lensesFor('manual', dataset);
    assert.equal(lenses.length, 3);
    assert.match(lenses[0], /^DATA lens:/);
    assert.match(lenses[1], /^CONTENT lens:/);
    assert.match(lenses[2], /^SHAPE lens:/);
  }
  assert.throws(() => lensesFor('manual', 'topic-queue'), /no review lenses/);
  assert.throws(() => lensesFor('promotionx'), /no review lenses/);
});

test('B5: review-agent imports with no side effects and its CLI still runs', () => {
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e',
    "const m = await import('./scripts/automation/review-agent.mjs'); console.log(JSON.stringify({ exitCode: process.exitCode ?? null, keys: Object.keys(m).sort() }));"],
  { cwd: REPO, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stderr, '');
  const report = JSON.parse(imported.stdout.trim());
  assert.equal(report.exitCode, null);
  for (const name of ['planRecordRepair', 'LENSES', 'VERDICT_SCHEMA', 'MAX_FIXER_ATTEMPTS', 'reviewRows', 'rowRepairSchema', 'selectReferenceRecords']) {
    assert.ok(report.keys.includes(name), `missing export ${name}`);
  }
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cli-')), 'out');
  const cli = spawnSync(process.execPath, ['scripts/automation/review-agent.mjs', 'fix-content'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: outFile } });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /fix-content requires --kind news/);
  assert.match(fs.readFileSync(outFile, 'utf8'), /fix_ok=false/);
  // news-preflight's two helpers are exported (keyword-only edit) and its CLI guard is untouched.
  const src = fs.readFileSync(path.join(REPO, 'scripts/automation/news-preflight.mjs'), 'utf8');
  assert.match(src, /^export function trimEvidence\(value\) \{$/m);
  assert.match(src, /^export function structuredData\(post\) \{$/m);
  assert.equal(execFileSync('git', ['diff', '--numstat', '9b23de5', '--', 'scripts/automation/news-preflight.mjs'], { cwd: REPO, encoding: 'utf8' }).trim().split(/\s+/).slice(0, 2).join(' '), '2 2');
});

// ---------------------------------------------------------------------------
// B3 scripted gate against the real store (lv_test_*) and a local site/hook/Slack.
// ---------------------------------------------------------------------------

const BIZ = seedRecords().businesses[1];
const scriptFile = (value) => tempJson(value, 'script.json');
const PASS = scriptFile({ reviews: [{ overall: 8.5, findings: [] }] });

async function withSite(fn) {
  const handle = await seededDb();
  const site = await localSite(handle.db);
  await site.build();
  try { return await fn(handle.db, site); } finally { await site.close(); await handle.close(); }
}

async function submitEdit(db, record, key, kind = 'manual', dataset = 'businesses') {
  const { result } = await submitContent(db, {
    kind, idempotencyKey: `${key}:${Math.random()}`, actor: 'uat:test', recordFile: tempJson(record), dataset, baseline: await baselineFile(db),
  }, { checkout: REPO });
  return result.submissionId;
}

const gate = (db, site, id, script, extra = {}) => gateContent(db, { submission: id, script, actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE, ...extra }, checkout: REPO });

test('B3 pass -> publish -> deploy -> smoke -> one Slack line, not repeated on re-run', async () => {
  await withSite(async (db, site) => {
    const edited = { ...BIZ, description: `${BIZ.description} Now open Sundays.` };
    const id = await submitEdit(db, edited, 'pass');
    const out = await gate(db, site, id, PASS);
    assert.equal(out.exitCode, 0, JSON.stringify(out.result));
    assert.deepEqual([out.result.state, out.result.decision, out.result.overall, out.result.repairs, out.result.deploy, out.result.smoke, out.result.notified], ['published', 'go', 8.5, 0, 'requested', 'passed', true]);
    assert.equal(out.result.published[0].url, `${site.origin}/directory/${BIZ.slug}`);
    assert.equal(typeof out.result.liveSeq, 'number');
    const lines = site.slackWith(`(#${id},`);
    assert.deepEqual(lines, [`[scripted] ✅ test published: ${BIZ.name} — ${site.origin}/directory/${BIZ.slug} (#${id}, manual, 8.5, 0)`]);
    assert.equal(site.state.hookPosts, 1);
    const again = await gate(db, site, id, PASS);
    assert.equal(again.exitCode, 0);
    assert.equal(site.slackWith(`(#${id},`).length, 1, 'no repeat after notified_at');
    assert.equal(site.state.hookPosts, 1, 'no second hook after deploy_requested_at');
    const { rounds, items } = await store.getSubmission(db, id);
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].scripted, true);
    assert.equal(Number(rounds[0].overall), 8.5);
    assert.equal(items[0].smoke, 'passed');
    assert.equal((await liveRecord(db, 'businesses', BIZ.slug)).description, edited.description);
  });
});

test('B3 repair -> pass: fixer rev lands as round 1 and publishes; history shows manual then fixer', async () => {
  await withSite(async (db, site) => {
    const fabricated = { ...BIZ, description: `${BIZ.description} Voted best tacos in Canada by 40,000 readers.` };
    const id = await submitEdit(db, fabricated, 'repair');
    const repaired = { ...fabricated, description: BIZ.description };
    const script = scriptFile({
      reviews: [{ overall: 6.5, findings: [{ severity: 'high', path: `data/businesses.json#${BIZ.slug}`, note: 'unsupported award claim' }] }, { overall: 8.8, findings: [] }],
      fixes: [{ files: [{ file: 'data/businesses.json', records: [{ key: BIZ.slug, record: repaired }] }], reason: 'remove unsupported claim' }],
    });
    const out = await gate(db, site, id, script);
    assert.equal(out.exitCode, 0, JSON.stringify(out.result));
    assert.deepEqual([out.result.state, out.result.repairs, out.result.overall], ['published', 1, 8.8]);
    const history = await store.history(db, { dataset: 'businesses', key: BIZ.slug });
    assert.deepEqual(history.revisions.map((rev) => rev.source), ['writer', 'manual', 'fixer']);
    assert.equal(history.revisions.at(-1).live, true);
    const { rounds } = await store.getSubmission(db, id);
    assert.deepEqual(rounds.map((round) => round.decision), ['repair', 'go']);
  });
});

test('B3 unrepairable / exhausted / not-converging close blocked with a failure Slack line', async () => {
  await withSite(async (db, site) => {
    const cases = [
      ['unrepairable', { reviews: [{ overall: 5, findings: [{ severity: 'critical', path: `data/businesses.json#${BIZ.slug}`, note: 'slug duplicates another listing' }] }] }],
      ['not-converging', {
        reviews: [{ overall: 7.2, findings: [{ severity: 'high', path: `data/businesses.json#${BIZ.slug}`, note: 'claim' }] }, { overall: 6.5, findings: [{ severity: 'high', path: `data/businesses.json#${BIZ.slug}`, note: 'claim' }] }],
        fixes: [{ files: [{ file: 'data/businesses.json', records: [{ key: BIZ.slug, record: { ...BIZ, description: 'Reworded once.' } }] }], reason: 'r' }],
      }],
      ['exhausted', {
        reviews: [6, 6.5, 7, 7.5].map((overall) => ({ overall, findings: [{ severity: 'high', path: `data/businesses.json#${BIZ.slug}`, note: 'claim' }] })),
        fixes: [1, 2, 3].map((n) => ({ files: [{ file: 'data/businesses.json', records: [{ key: BIZ.slug, record: { ...BIZ, description: `Reworded ${n}.` } }] }], reason: `r${n}` })),
      }],
    ];
    for (const [decision, script] of cases) {
      const id = await submitEdit(db, { ...BIZ, description: `Edit for ${decision}.` }, decision);
      const out = await gate(db, site, id, scriptFile(script));
      assert.equal(out.exitCode, 2, `${decision}: ${JSON.stringify(out.result)}`);
      assert.deepEqual([out.result.state, out.result.decision], ['blocked', decision]);
      assert.equal(site.slackWith(`#${id} ${decision}`).length, 1, decision);
      assert.equal((await liveRecord(db, 'businesses', BIZ.slug)).description, BIZ.description, 'live rev unchanged');
    }
    const blocked = await store.listSubmissions(db, { state: 'blocked' });
    assert.equal(blocked.length, 3);
  });
});

test('B3 g1 validation failure closes rejected before any review', async () => {
  await withSite(async (db, site) => {
    const id = await submitEdit(db, { ...BIZ, description: 'ok' }, 'g1');
    // An operator edits the stored candidate context to force a deterministic failure on rerun of g1.
    await db.query("update content.submissions set kind='business' where id=$1", [id]);
    let reviews = 0;
    const out = await gate(db, site, id, undefined, { review: async () => { reviews += 1; throw new Error('must not review'); } });
    assert.equal(out.exitCode, 2, JSON.stringify(out.result));
    assert.deepEqual([out.result.state, out.result.decision], ['rejected', 'validation']);
    assert.equal(reviews, 0);
    assert.match(site.slackWith(`#${id} validation`)[0], /business may not update businesses/);
  });
});

test('B3 conflict: a newer publish on the key rejects the stale submission at publish', async () => {
  await withSite(async (db, site) => {
    const baseline = await baselineFile(db);
    const first = await submitContent(db, { kind: 'manual', idempotencyKey: 'c1', actor: 'uat:test', recordFile: tempJson({ ...BIZ, proTip: 'First.' }), dataset: 'businesses', baseline }, { checkout: REPO });
    const second = await submitContent(db, { kind: 'manual', idempotencyKey: 'c2', actor: 'uat:test', recordFile: tempJson({ ...BIZ, proTip: 'Second.' }), dataset: 'businesses', baseline }, { checkout: REPO });
    assert.equal((await gate(db, site, first.result.submissionId, PASS)).exitCode, 0);
    const out = await gate(db, site, second.result.submissionId, PASS);
    assert.equal(out.exitCode, 2);
    assert.deepEqual([out.result.state, out.result.decision], ['rejected', 'conflict']);
    assert.equal((await liveRecord(db, 'businesses', BIZ.slug)).proTip, 'First.');
  });
});

test('B3 propagation: hook 500 and freshness timeout exit 3, then content deploy exits 0', async () => {
  await withSite(async (db, site) => {
    site.state.hook = 500;
    const hookId = await submitEdit(db, { ...BIZ, proTip: 'Hook failure.' }, 'hook');
    const failed = await gate(db, site, hookId, PASS);
    assert.equal(failed.exitCode, 3, JSON.stringify(failed.result));
    assert.deepEqual([failed.result.state, failed.result.deploy, failed.result.smoke], ['published', 'failed', 'pending']);
    assert.equal(site.state.hookPosts, 2, 'two attempts');
    assert.equal(site.slackWith(`#${hookId} published but not yet live (hook-failed)`).length, 1);

    site.state.hook = 'accept'; // hook accepted, the build never lands
    const staleId = await submitEdit(db, { ...BIZ, answerBlock: 'Freshness.', proTip: 'Hook failure.' }, 'fresh');
    const stale = await gate(db, site, staleId, PASS);
    assert.equal(stale.exitCode, 3);
    assert.equal(stale.result.reason, 'smoke-timeout');

    site.state.hook = 'build';
    const resumed = await deployContent(db, { actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE } });
    assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.result));
    assert.deepEqual(resumed.result.submissions.map((entry) => [entry.id, entry.smoke]), [[hookId, 'passed'], [staleId, 'passed']]);
    // Coalesced on one key: the older publish is superseded, never page-checked or compensated.
    assert.equal((await store.getSubmission(db, hookId)).items[0].smoke, 'superseded');
    assert.equal((await store.getSubmission(db, staleId)).items[0].smoke, 'passed');
    assert.deepEqual(await store.listPending(db, { target: 'test' }), []);
    assert.equal(site.slackWith(`(#${hookId},`).length, 1);
    assert.equal(site.slackWith(`(#${staleId},`).length, 1);
  });
});

test('B3 bad render -> compensate -> admin submission smoked absent (insert -> 404), exit 2 smoke-failed', async () => {
  await withSite(async (db, site) => {
    const inserted = { ...BIZ, slug: 'uat-render-probe', name: 'UAT Render Probe' };
    const id = await submitEdit(db, inserted, 'render');
    site.state.breakRoutes = ['/directory/uat-render-probe'];
    const out = await gate(db, site, id, PASS);
    assert.equal(out.exitCode, 2, JSON.stringify(out.result));
    assert.deepEqual([out.result.state, out.result.decision, out.result.smoke], ['compensated', 'smoke-failed', 'failed']);
    const adminId = out.result.compensation.adminSubmissionId;
    assert.equal(out.result.compensation.smoke, 'passed');
    assert.deepEqual(out.result.compensation.reverted, [{ dataset: 'businesses', key: 'uat-render-probe', fromRev: 1, toRev: null }]);
    const admin = await store.getSubmission(db, adminId);
    assert.deepEqual([admin.submission.kind, admin.items[0].op, admin.items[0].smoke], ['admin', 'compensate', 'passed']);
    assert.ok(admin.submission.smoke_passed_at && admin.submission.notified_at);
    assert.equal((await fetch(`${site.origin}/directory/uat-render-probe`)).status, 404);
    assert.equal(site.slackWith(`🔁 test compensate businesses/uat-render-probe (#${adminId})`).length, 1);
    assert.equal(site.slackWith(`#${id} smoke-failed`).length, 1);
    assert.equal(await liveRecord(db, 'businesses', 'uat-render-probe'), undefined);
  });
});

test('admin unpublish/rollback: hook failure -> exit 3 -> content deploy resumes -> passed; replay is existing', async () => {
  await withSite(async (db, site) => {
    const key = seedRecords().businesses[2].slug;
    site.state.hook = 500;
    const unpublish = await adminContent(db, { op: 'unpublish', dataset: 'businesses', key, reason: 'uat', idempotencyKey: 'u1', actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE } });
    assert.equal(unpublish.exitCode, 3, JSON.stringify(unpublish.result));
    assert.deepEqual([unpublish.result.rev, unpublish.result.smoke], [null, 'pending']);
    site.state.hook = 'build';
    const deployed = await deployContent(db, { actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE } });
    assert.equal(deployed.exitCode, 0, JSON.stringify(deployed.result));
    assert.equal((await fetch(`${site.origin}/directory/${key}`)).status, 404);
    const rollback = await adminContent(db, { op: 'rollback', dataset: 'businesses', key, toRev: 1, reason: 'uat', idempotencyKey: 'r1', actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE } });
    assert.equal(rollback.exitCode, 0, JSON.stringify(rollback.result));
    assert.deepEqual([rollback.result.fromRev, rollback.result.rev, rollback.result.smoke], [null, 2, 'passed']);
    assert.equal((await fetch(`${site.origin}/directory/${key}`)).status, 200);
    const replay = await adminContent(db, { op: 'rollback', dataset: 'businesses', key, toRev: 1, reason: 'uat', idempotencyKey: 'r1', actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE } });
    assert.deepEqual([replay.exitCode, replay.result.existing, replay.result.rev], [0, true, 2]);
    assert.deepEqual((await store.history(db, { dataset: 'businesses', key })).revisions.map((rev) => rev.source), ['writer', 'rollback']);
    await assert.rejects(adminContent(db, { op: 'unpublish', dataset: 'guide-hub', key: 'guide-hub', reason: 'uat', idempotencyKey: 'g1', actor: 'uat:test' }, { env: site.env }), { code: 'ValidationError' });
    assert.equal(site.slackWith(`🔁 test unpublish businesses/${key}`).length, 1);
    assert.equal(site.slackWith(`🔁 test rollback businesses/${key}`).length, 1);
  });
});

test('3-decimal scores: persisted and compared at numeric(4,2) exactly as PostgreSQL stores them', async () => {
  // 7.255 is stored as 7.26; an uninterrupted run and a resumed run must agree.
  const high0 = [high()];
  const round0 = decideRound({ kind: 'business', verdict: verdict(7.255, high0), contentSha: SHA, repairs: 0, round: 0, datasets: ['businesses'] });
  assert.equal(round0.overall, 7.26);
  const resumed = decideRound({ kind: 'business', verdict: verdict(7.255, high0), contentSha: SHA, repairs: 1, round: 1, priorRounds: [{ round: 0, overall: '7.26', blocking_count: 1 }], datasets: ['businesses'] });
  assert.equal(resumed.decision, 'repair', 'same score is not a regression');
  // Unaligned comparison (raw 7.255 vs stored 7.26) would have abandoned the candidate.
  assert.equal(evaluateRepairProgress({ history: [{ attempt: 0, overall: 7.26, blockingCount: 1 }, { attempt: 1, overall: 7.255, blockingCount: 1 }] }).decision, 'abandon');
  // A real regression at the third decimal still counts once rounded apart.
  assert.equal(decideRound({ kind: 'business', verdict: verdict(7.244, high0), contentSha: SHA, repairs: 1, round: 1, priorRounds: [{ round: 0, overall: '7.26', blocking_count: 1 }], datasets: ['businesses'] }).decision, 'not-converging');
  // The gate is not weakened: 7.996 persists as 8.00 but never passes the 8 bar.
  const near = decideRound({ kind: 'business', verdict: verdict(7.996), contentSha: SHA, repairs: 0, round: 0, datasets: ['businesses'] });
  assert.deepEqual([near.overall, near.passed], [8, false]);
  assert.notEqual(near.decision, 'go');

  const { db, close } = await seededDb();
  try {
    const values = [7.255, 7.245, 8.335, 0.005, 9.995, 7.2, 8, 6.125, 5.675];
    for (const [index, value] of values.entries()) {
      const created = await store.createSubmission(db, { kind: 'manual', target: 'test', actor: 't', idempotencyKey: `num-${index}`, items: [{ dataset: 'businesses', key: `num-probe-${index}`, payload: { ...BIZ, slug: `num-probe-${index}` }, expectedLiveRev: null }] });
      const { token } = await store.claimSubmission(db, created.submissionId, { owner: 't' });
      const vector = await roundVector(db, created.submissionId, 0);
      await store.recordRound(db, created.submissionId, token, { round: 0, candidateDigest: (await import('../../scripts/content/canonical.mjs')).candidateDigest(vector), contentSha: SHA, verdict: verdict(value), overall: toNumeric2(value), passed: false, blockingCount: 0, lint: null, decision: 'block' });
      const row = (await db.query('select overall from content.gate_rounds where submission_id=$1', [created.submissionId])).rows[0];
      assert.equal(Number(row.overall), toNumeric2(value), `${value}`);
      // Sending the raw value lets PostgreSQL round it: same result, so the helper matches the server.
      assert.equal(Number((await db.query('select $1::numeric(4,2) as v', [value])).rows[0].v), toNumeric2(value), `server rounding of ${value}`);
    }
  } finally { await close(); }
});

test('bounded read helpers: exact base revision payload bytes and round vector; unknown /media refused', async () => {
  const { db, close } = await seededDb();
  try {
    // A key order the canonical data never uses: json keeps it, so the review base must too.
    const reordered = Object.fromEntries(Object.entries({ ...BIZ, proTip: 'Reordered.' }).reverse());
    const updated = await publishDirect(db, { kind: 'manual', idempotencyKey: 'reorder', items: [{ dataset: 'businesses', key: BIZ.slug, payload: reordered, expectedLiveRev: 1 }] });
    assert.equal(updated.published[0].rev, 2);
    const next = await store.createSubmission(db, { kind: 'manual', target: 'test', actor: 't', idempotencyKey: 'edit-3', items: [{ dataset: 'businesses', key: BIZ.slug, payload: { ...BIZ, proTip: 'Third.' }, expectedLiveRev: 2 }] });
    const { items } = await store.getSubmission(db, next.submissionId);
    const bases = await basePayloads(db, items);
    assert.equal(JSON.stringify(bases.get(`businesses\t${BIZ.slug}`)), JSON.stringify(reordered), 'exact rev 2 payload, key order preserved');
    const vector = await roundVector(db, next.submissionId, 0);
    assert.deepEqual(vector.map((row) => [row.dataset, row.key, row.rev]), [['businesses', BIZ.slug, 3]]);
    assert.equal(vector[0].payload.proTip, 'Third.');
    assert.deepEqual(await roundVector(db, next.submissionId, 1), []);
    // Insert items have no base.
    const insert = await store.createSubmission(db, { kind: 'manual', target: 'test', actor: 't', idempotencyKey: 'ins', items: [{ dataset: 'businesses', key: 'fresh-key', payload: { ...BIZ, slug: 'fresh-key' }, expectedLiveRev: null }] });
    assert.equal((await basePayloads(db, (await store.getSubmission(db, insert.submissionId)).items)).size, 0);

    // /media presence is an exact path lookup in content.assets.
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const mediaPath = `/media/${sha.slice(0, 16)}/stored.jpg`;
    await publishDirect(db, { kind: 'manual', idempotencyKey: 'media', items: [{ dataset: 'businesses', key: 'media-biz', payload: { ...BIZ, slug: 'media-biz', image: mediaPath }, expectedLiveRev: null }], assets: [{ sha256: sha, path: mediaPath, contentType: 'image/jpeg', bytes }] });
    const { assetExistsIn } = await import('../../scripts/content/submit.mjs');
    assert.equal(await assetExistsIn(db)(mediaPath), true);
    assert.equal(await assetExistsIn(db)(`/media/${sha.slice(0, 16)}/other-name.jpg`), false);
    const baseline = await baselineFile(db);
    const reuse = await submitContent(db, { kind: 'manual', idempotencyKey: 'm1', actor: 't', recordFile: tempJson({ ...BIZ, slug: 'media-reuse', image: mediaPath }), dataset: 'businesses', baseline }, { checkout: REPO });
    assert.equal(reuse.exitCode, 0);
    await assert.rejects(
      submitContent(db, { kind: 'manual', idempotencyKey: 'm2', actor: 't', recordFile: tempJson({ ...BIZ, slug: 'media-missing', image: `/media/${'0'.repeat(16)}/missing.jpg` }), dataset: 'businesses', baseline }, { checkout: REPO }),
      (error) => error.code === 'ValidationError' && /^image-missing: /.test(error.message),
    );
  } finally { await close(); }
});

// ---------------------------------------------------------------------------
// D's ingest-db contract, through the real cli.mjs: exact argv, JSON with liveSeq and
// published[{dataset,url}], exit 0 published / 2 blocked / 3 propagation pending.
// Only the agent SDK is faked (reviewRows and runStructured run for real).
// ---------------------------------------------------------------------------
const { runCli } = await import('../../scripts/content/cli.mjs');
const BLOG_IMAGE = '/images/blog/best-bars-liberty-village-toronto-guide-2026.jpg';

function blogLivePost(slug, generatedAt) {
  const day = generatedAt.slice(0, 10);
  return {
    slug, title: `Liberty Village park walks ${slug.slice(-4)}`, description: 'A short guide to walking loops through the neighbourhood parks.',
    content: '## Walking loops\n\nThe neighbourhood has a few short loops that connect its parks and quieter streets.\n',
    publishedAt: day, updatedAt: day, category: 'lifestyle', tags: ['parks', 'walking', 'liberty village', 'outdoors'],
    answerBlock: 'Liberty Village has several short walking loops that connect its parks.',
    faqs: [1, 2, 3, 4].map((n) => ({ question: `Question ${n}?`, answer: `Answer ${n}.` })),
    image: BLOG_IMAGE, relatedServices: [], relatedTopics: [], relatedPosts: [], keyTakeaways: ['One', 'Two', 'Three', 'Four'], author: 'LibertyVillage.co',
  };
}

const passingReview = ({ prompt }) => ({ overall: 8.6, findings: [], model: GATE_MODEL, commit_sha: /set commit_sha exactly ([0-9a-f]{40})/.exec(prompt)[1] });
const blockingReview = ({ prompt }) => ({ overall: 4, findings: [{ severity: 'critical', path: 'data/posts.json', note: 'slug duplicates an existing post' }], model: GATE_MODEL, commit_sha: /set commit_sha exactly ([0-9a-f]{40})/.exec(prompt)[1] });

async function withCliEnv(site, name, fn) {
  const saved = {};
  const env = { ...site.env, CONTENT_DB_NAME: name, CONTENT_TARGET: 'test' };
  for (const key of [...Object.keys(env), 'GITHUB_ACTIONS']) saved[key] = process.env[key];
  Object.assign(process.env, env);
  delete process.env.GITHUB_ACTIONS;
  try { return await fn(); } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

async function ingestRun(name, suffix, { review, dataSha = suffix.padEnd(40, 'a') }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-ingest-'));
  const exported = await runCli(['export', '--root', root, '--expect-db', name]);
  assert.equal(exported.exitCode, 0);
  const generatedAt = new Date(Date.now() - 3_600_000).toISOString();
  const candidate = path.join(root, 'candidate.json');
  fs.writeFileSync(candidate, JSON.stringify(blogLivePost(`liberty-village-park-walks-${suffix}`, generatedAt)));
  const submit = await runCli(['submit', '--kind', 'blog-live', '--record-file', candidate, '--dataset', 'posts', '--baseline', path.join(root, '.content-export/manifest.json'),
    '--idempotency-key', `vm:${dataSha}`, '--actor', `ingest:${dataSha}`, '--topic-key', 'b'.repeat(64), '--generated-at', generatedAt, '--target', 'test', '--expect-db', name]);
  assert.equal(submit.exitCode, 0, JSON.stringify(submit.result));
  queueAgent(review);
  const gated = await runCli(['gate', '--submission', String(submit.result.submissionId), '--actor', `ingest:${dataSha}`, '--target', 'test', '--expect-db', name]);
  return { submit, gated };
}

test('D ingest-db contract: submit + gate via cli.mjs exit 0 / 2 / 3 with liveSeq and published[{dataset,url}]', async () => {
  const handle = await seededDb();
  const site = await localSite(handle.db);
  await site.build();
  try {
    await withCliEnv(site, handle.name, async () => {
      const ok = await ingestRun(handle.name, '0001', { review: passingReview });
      assert.equal(ok.gated.exitCode, 0, JSON.stringify(ok.gated.result));
      assert.equal(typeof ok.gated.result.liveSeq, 'number');
      assert.deepEqual(ok.gated.result.published.map(({ dataset, url }) => ({ dataset, url })), [{ dataset: 'posts', url: `${site.origin}/blog/liberty-village-park-walks-0001` }]);
      assert.equal(fakeAgent.calls.length, 1, 'real reviewRows ran against the fake SDK only');
      const { submission } = await store.getSubmission(handle.db, ok.submit.result.submissionId);
      assert.equal(submission.claim_token, null, 'claim released');
      assert.match((await store.getSubmission(handle.db, ok.submit.result.submissionId)).submission.actor, /^ingest:0001/);

      const blocked = await ingestRun(handle.name, '0002', { review: blockingReview });
      assert.equal(blocked.gated.exitCode, 2, JSON.stringify(blocked.gated.result));
      assert.deepEqual([blocked.gated.result.state, blocked.gated.result.decision], ['blocked', 'unrepairable']);

      site.state.hook = 500;
      const pending = await ingestRun(handle.name, '0003', { review: passingReview });
      assert.equal(pending.gated.exitCode, 3, JSON.stringify(pending.gated.result));
      assert.equal(typeof pending.gated.result.liveSeq, 'number');
      assert.equal(pending.gated.result.published[0].dataset, 'posts');
      // A stale --generated-at is refused before any write.
      const stale = await runCli(['submit', '--kind', 'blog-live', '--record-file', tempJson(blogLivePost('stale-walks', '2026-01-01T00:00:00Z')), '--dataset', 'posts', '--baseline', await baselineFile(handle.db),
        '--idempotency-key', 'vm:stale', '--actor', 'ingest:stale', '--topic-key', 'b'.repeat(64), '--generated-at', '2026-01-01T00:00:00Z', '--target', 'test', '--expect-db', handle.name]).catch((error) => error);
      assert.equal(stale.code, 'ValidationError');
      assert.match(stale.message, /more than 36 h before submit/);
    });
  } finally { await site.close(); await handle.close(); }
});

test('gate requires an explicit operator actor off GitHub Actions before claiming', async () => {
  const { db, close } = await seededDb();
  try {
    const originalToken = (await store.getSubmission(db, 1)).submission.claim_token;
    for (const opts of [{ submission: 1 }, { submission: 1, actor: true }]) {
      await assert.rejects(gateContent(db, opts, { env: { GITHUB_ACTIONS: 'false' } }),
        (error) => error.code === 'ValidationError' && /--actor required/.test(error.message));
      assert.equal((await store.getSubmission(db, 1)).submission.claim_token, originalToken);
    }
  } finally { await close(); }
});

test('ingest retry resumes the published submission after a fixer repair and missed status write', async () => {
  const handle = await seededDb();
  const site = await localSite(handle.db);
  await site.build();
  const dataSha = 'd'.repeat(40);
  const generatedAt = new Date(Date.now() - 3_600_000).toISOString();
  const candidate = blogLivePost('ingest-retry-repaired', generatedAt);
  const repaired = { ...candidate, content: `${candidate.content}\nA corrected detail.\n` };
  try {
    await withCliEnv(site, handle.name, async () => {
      const original = await submitContent(handle.db, {
        kind: 'blog-live', actor: `ingest:${dataSha}`, idempotencyKey: `vm:${dataSha}`,
        recordFile: tempJson(candidate), dataset: 'posts', baseline: await baselineFile(handle.db),
        topicKey: 'b'.repeat(64), generatedAt,
      }, { checkout: REPO });
      const id = original.result.submissionId;
      const token = (await store.claimSubmission(handle.db, id, { owner: 'test:repair' })).token;
      const vector = async (round) => (await handle.db.query('select * from content.round_items where submission_id=$1 and round=$2', [id, round])).rows;
      await store.recordRound(handle.db, id, token, { round: 0, candidateDigest: candidateDigest(await vector(0)),
        contentSha: 'a'.repeat(40), overall: 6, passed: false, blockingCount: 1, decision: 'repair' });
      await store.addRepairRound(handle.db, id, token, { fromRound: 0,
        repairs: [{ dataset: 'posts', key: candidate.slug, payload: repaired }] });
      await store.recordRound(handle.db, id, token, { round: 1, candidateDigest: candidateDigest(await vector(1)),
        contentSha: 'b'.repeat(40), overall: 8.6, passed: true, blockingCount: 0, decision: 'go' });
      const published = await store.publishSubmission(handle.db, id, token);
      await store.releaseClaim(handle.db, id, token);
      assert.equal((await store.getSubmission(handle.db, id)).rounds.length, 2);
      assert.equal((await store.readLive(handle.db, { datasets: ['posts'] })).datasets.posts.records.find((post) => post.slug === candidate.slug).content, repaired.content);

      const status = [];
      const commands = [];
      const command = (file, args) => {
        commands.push([file, args]);
        if (file === 'gh') { status.push(args.find((arg) => arg.startsWith('description='))?.slice(12)); return { status: 0, stdout: '{}' }; }
        if (file === 'git') {
          if (args[0] === 'rev-parse') return { status: 0, stdout: `${args[1] === 'HEAD' ? 'a'.repeat(40) : dataSha}\n` };
          if (args[0] === 'diff') return { status: 0, stdout: 'candidate/post.json\n' };
          if (args[0] === 'show') return { status: 0, stdout: JSON.stringify(candidate) };
          return { status: 0, stdout: '' };
        }
        if (file === process.execPath) {
          if (args[1] === 'gate') {
            assert.equal(args[args.indexOf('--submission') + 1], String(id));
            assert.equal(args[args.indexOf('--actor') + 1], `ingest:${dataSha}`);
            return { status: 0, stdout: JSON.stringify({ liveSeq: published.liveSeq,
              published: [{ dataset: 'posts', url: `${site.origin}/blog/${candidate.slug}` }] }) };
          }
          const child = spawnSync(file, args, { cwd: REPO, encoding: 'utf8', env: process.env });
          if (![0, 2, 3].includes(child.status)) throw new Error(child.stdout || child.stderr);
          return child;
        }
        throw new Error(`unexpected command ${file}`);
      };
      const resumed = runDbIngest({ kind: 'blog', data_sha: dataSha, data_branch: 'supervisor/blog-data-retry',
        topic_key: 'b'.repeat(64), regenerations: 0, store: 'db', target: 'test' }, { repo: 'fixture/local', command });
      assert.equal(resumed.state, 'published');
      assert.equal(resumed.submissionId, id);
      assert.equal(resumed.liveSeq, published.liveSeq);
      assert(status.includes(`published:${id}:seq:${published.liveSeq}`));
      assert.deepEqual(commands.filter(([file]) => file === process.execPath).map(([, args]) => args[1]), ['lookup', 'gate']);
      assert.equal((await handle.db.query('select count(*)::int as count from content.submissions where idempotency_key=$1', [`vm:${dataSha}`])).rows[0].count, 1);
    });
  } finally { await site.close(); await handle.close(); }
});
