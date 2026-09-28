// `content gate` (§4.6). Round decision (g4) and the --script seam.
import fs from 'node:fs';
import { BLOCKING_SEVERITIES, GATE_MODEL, MAX_REPAIRS } from '../automation/constants.mjs';
import { evaluateVerdict } from '../automation/policy.mjs';
import { preflightDecision } from '../automation/preflight.mjs';
import { buildRecordRepairPlan } from '../automation/record-repair.mjs';
import { evaluateRepairProgress } from '../automation/recovery.mjs';
import { cutFindingPaths } from './review-document.mjs';
import { fileOf } from './repair-rules.mjs';

// Automated kinds map to themselves; operator `manual` edits use the seo policy.
export const POLICY_KIND = Object.freeze({
  business: 'business', blog: 'blog', 'blog-live': 'blog-live', news: 'news',
  'topic-discovery': 'topic-discovery', seo: 'seo', manual: 'seo',
});

export const TERMINAL_DECISIONS = Object.freeze(['validation', 'lint', 'unrepairable', 'exhausted', 'not-converging', 'block']);

export const blockingCountOf = (verdict) => (Array.isArray(verdict?.findings) ? verdict.findings : [])
  .filter((finding) => BLOCKING_SEVERITIES.includes(finding?.severity)).length;

// g4. priorRounds are the persisted gate_rounds rows (round, overall, blocking_count)
// before round n; the CURRENT round is appended before convergence is judged,
// because evaluateRepairProgress compares only the last two rounds it is given.
export function decideRound({ kind, verdict, contentSha, repairs, round, priorRounds = [], datasets }) {
  const policyKind = POLICY_KIND[kind];
  if (!policyKind) throw new Error(`no gate policy for kind ${kind}`);
  const cut = cutFindingPaths(verdict);
  const changedFiles = [...new Set(datasets.map(fileOf))].sort();
  const preflight = preflightDecision({
    verdict: cut, contentSha, attempts: repairs, maxRepairs: MAX_REPAIRS, kind: policyKind, changedFiles,
  });
  const blockingCount = blockingCountOf(verdict);
  const evaluated = evaluateVerdict(verdict, contentSha);
  let progress = null;
  let decision;
  if (preflight === 'repair' && round >= 1) {
    progress = evaluateRepairProgress({
      history: [
        ...priorRounds.map((prior) => ({ attempt: prior.round, overall: Number(prior.overall), blockingCount: prior.blocking_count })),
        { attempt: round, overall: Number(verdict.overall), blockingCount },
      ],
    });
    if (progress.decision === 'abandon') decision = 'not-converging';
  }
  if (!decision) {
    if (preflight === 'go') decision = 'go';
    else if (preflight === 'repair') decision = 'repair';
    else if (preflight === 'unrepairable') decision = 'unrepairable';
    else decision = repairs === MAX_REPAIRS ? 'exhausted' : 'block';
  }
  return {
    decision, preflight, progress, blockingCount, changedFiles,
    passed: evaluated.ok && evaluated.passed,
    overall: typeof verdict?.overall === 'number' && Number.isFinite(verdict.overall) ? verdict.overall : null,
  };
}

// --script seam: {"reviews":[{overall,findings}],"fixes":[{files,reason}]}; review i
// answers round i, fix j answers the j-th fixer call (= submissions.repairs).
// Refused unless the bound database is lv_staging or lv_test_*.
export function assertScriptAllowed(dbName) {
  if (!(dbName === 'lv_staging' || /^lv_test_/.test(String(dbName)))) {
    const error = new Error(`--script is refused on database ${dbName}`);
    error.code = 'script-refused';
    throw error;
  }
}

export function loadScript(file, { dbName }) {
  assertScriptAllowed(dbName);
  const script = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!script || typeof script !== 'object' || !Array.isArray(script.reviews)) throw new Error('gate script requires a reviews array');
  if (script.fixes !== undefined && !Array.isArray(script.fixes)) throw new Error('gate script fixes must be an array');
  return { reviews: script.reviews, fixes: script.fixes || [] };
}

// model/commit_sha are filled with GATE_MODEL and the real contentSha; the result
// still goes through evaluateVerdict and every deterministic check.
export function scriptedVerdict(script, round, contentSha) {
  const review = script.reviews[round];
  if (!review) throw new Error(`gate script has no review for round ${round}`);
  return { overall: review.overall, findings: review.findings ?? [], model: GATE_MODEL, commit_sha: contentSha };
}

export function scriptedFix(script, index) {
  const fix = script.fixes[index];
  if (!fix) throw new Error(`gate script has no fix for fixer call ${index}`);
  return buildRecordRepairPlan({ files: fix.files, reason: fix.reason });
}

// Fixer payload: one entry per candidate file with its round-n records.
export function fixerPayload(items) {
  const byFile = new Map();
  for (const item of [...items].sort((a, b) => (a.dataset === b.dataset ? (a.key < b.key ? -1 : 1) : (a.dataset < b.dataset ? -1 : 1)))) {
    const file = fileOf(item.dataset);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(item.payload);
  }
  return [...byFile.entries()].map(([file, records]) => ({ file, records }));
}
