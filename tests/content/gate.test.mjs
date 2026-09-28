// Gate decision (g4), --script seam, reviewRows and lenses. DB-free: the round
// state machine against a real store lands with A1 (gate-resume.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fakeAgent, queueAgent } from './fixtures/agent-sdk-mock.mjs';
import { GATE_MODEL, MAX_REPAIRS, SCORE_THRESHOLD } from '../../scripts/automation/constants.mjs';
import { evaluateRepairProgress } from '../../scripts/automation/recovery.mjs';
import { preflightDecision } from '../../scripts/automation/preflight.mjs';
import { evaluateVerdict } from '../../scripts/automation/policy.mjs';
import {
  assertScriptAllowed, decideRound, fixerPayload, loadScript, POLICY_KIND, scriptedFix, scriptedVerdict,
} from '../../scripts/content/gate.mjs';
import { buildReviewDocument } from '../../scripts/content/review-document.mjs';

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
