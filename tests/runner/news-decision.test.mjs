import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JOBS, command, generatorEnv, runNewsPublish, sourceEnv, summarizeNewsDecision, trustedEnv } from '../../ops/exedev-runner/runner.mjs';

test('news receipt preserves the final zero-publication reason and funnel without story content', () => {
  const receipt = summarizeNewsDecision({
    published: 0, status: 'not_publish_ready', discovered: 137, evaluated: 3,
    passedPrefilter: 2, passedEvidence: 1, tregFallbackCalls: 4,
    title: 'Grandma Loves You is opening in Liberty Village',
    ready: { ok: false, code: 'draft_validation_failed', reasons: ['private article text'] },
    validation: { failureCodes: ['unsupported_claim', 'unsupported_claim'], humanGates: ['image_required_for_publish'] },
    evaluations: [
      { prefilter: { ok: false, code: 'development_application' } },
      { prefilter: { ok: true }, eligibility: { ok: false, code: 'evidence_gate' } },
      { prefilter: { ok: true }, eligibility: { ok: true }, gate: { ok: true } },
    ],
  });
  assert.deepEqual(receipt, {
    published: 0, discovered: 137, evaluated: 3, considered: 3,
    passedPrefilter: 2, passedEvidence: 1, tregFallbackCalls: 4,
    refusals: { development_application: 1, evidence_gate: 1 },
    status: 'not_publish_ready', errorCode: null, finalGateCode: 'draft_validation_failed',
    validationFailureCodes: ['unsupported_claim'], humanGates: ['image_required_for_publish'],
  });
  assert.doesNotMatch(JSON.stringify(receipt), /Grandma|private article/);
});

test('missing counts stay unknown; real evaluation arrays and discovery supply observed counts', () => {
  const unknown = summarizeNewsDecision({ published: 0, status: 'validation_failed' });
  assert.equal(unknown.considered, null);
  assert.equal(unknown.evaluated, null);
  assert.equal(unknown.discovered, null);
  assert.equal(unknown.tregFallbackCalls, null);
  const observed = summarizeNewsDecision({ published: 0, evaluations: [] }, { candidates: [{}, {}] });
  assert.equal(observed.considered, 0);
  assert.equal(observed.evaluated, 0);
  assert.equal(observed.discovered, 2);
  const numeric = summarizeNewsDecision({ considered: 25, tregFallbackCalls: 0 });
  assert.equal(numeric.evaluated, 25);
  assert.equal(numeric.tregFallbackCalls, 0);
});

test('news receipts allow only bounded code/count fields, including final validation object codes', () => {
  const result = summarizeNewsDecision({
    discovered: -1, considered: null, evaluated: '25', status: 'https://private.example/token',
    evaluations: [{ prefilter: { ok: false, code: '__proto__' } }, { eligibility: { ok: false, code: 'private article text' } }],
    validation: {
      failures: [{ code: 'missing_field', message: 'private article text' }, { code: 'https://private.example' }],
      humanGates: [{ code: 'image_required_for_publish' }, { code: 'x'.repeat(65) }],
    },
  });
  assert.equal(result.discovered, null);
  assert.equal(result.evaluated, 2);
  assert.equal(result.status, null);
  assert.deepEqual(result.refusals, { other: 2 });
  assert.deepEqual(result.validationFailureCodes, ['missing_field']);
  assert.deepEqual(result.humanGates, ['image_required_for_publish']);
  assert.doesNotMatch(JSON.stringify(result), /private|https|__proto__/);
});

test('treg token and cap reach only the news source process', () => {
  const env = { PATH: '/bin', TREG_TOKEN: 'fixture-token', LV_NEWS_TREG_MAX_CALLS: '5' };
  assert.deepEqual(sourceEnv(env, 'news'), env);
  for (const job of Object.keys(JOBS).filter((name) => name !== 'news')) {
    assert.equal(sourceEnv(env, job).TREG_TOKEN, undefined, job);
    assert.equal(sourceEnv(env, job).LV_NEWS_TREG_MAX_CALLS, undefined, job);
  }
  for (const bound of [trustedEnv(env), generatorEnv(env)]) {
    assert.equal(bound.TREG_TOKEN, undefined);
    assert.equal(bound.LV_NEWS_TREG_MAX_CALLS, undefined);
  }
});

for (const [exit, errorCode] of [[3, 'no_model_credential'], [4, 'json_parse_failed']]) {
  test(`publisher exit ${exit} records its persisted decision and preserves command failure`, (t) => {
    const scratch = new URL('../../.pi/scratch/', import.meta.url);
    fs.mkdirSync(scratch, { recursive: true });
    const dir = fs.mkdtempSync(new URL('news-decision-', scratch));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const log = path.join(dir, 'runner.jsonl');
    let commandFailure;
    assert.throws(() => runNewsPublish({ discovery: dir, publish: dir, discovered: { candidates: [{}, {}] }, log }, (script, args, job) => {
      assert.equal(script, 'scripts/news-pilot/publish.mjs');
      assert.equal(job, 'news');
      assert.ok(args.includes(`--out=${dir}`));
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ published: 0, status: 'error', error: errorCode,
        message: 'private candidate and credential details', evaluated: 1, tregFallbackCalls: 2 }));
      try { command(process.execPath, ['-e', `process.exit(${exit})`]); }
      catch (error) { commandFailure = error; throw error; }
    }), (error) => error === commandFailure);
    const receipt = JSON.parse(fs.readFileSync(log, 'utf8'));
    assert.equal(receipt.event, 'news-decision');
    assert.equal(receipt.errorCode, errorCode);
    assert.equal(receipt.discovered, 2);
    assert.equal(receipt.evaluated, 1);
    assert.equal(receipt.tregFallbackCalls, 2);
    assert.doesNotMatch(JSON.stringify(receipt), /private|candidate|credential details/);
  });
}

test('a missing decision artifact never masks the original publisher error', () => {
  const failure = new Error('source failure');
  assert.throws(() => runNewsPublish({ publish: '/nonexistent-news-publish-fixture' }, () => { throw failure; }), (error) => error === failure);
});

test('publisher error summaries classify free-form detail without logging it', () => {
  assert.equal(summarizeNewsDecision({ error: 'http_503' }).errorCode, 'http_503');
  assert.equal(summarizeNewsDecision({ error: 'timeout_after_30000ms' }).errorCode, 'model_timeout');
  for (const error of ['sk-fixture-secret', 'network failure at https://private.example?token=secret']) {
    const summary = summarizeNewsDecision({ error });
    assert.equal(summary.errorCode, 'other');
    assert.doesNotMatch(JSON.stringify(summary), /sk-|secret|private/);
  }
});
