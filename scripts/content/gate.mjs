// `content gate` (§4.6). Round decision (g4) and the --script seam.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { candidateDigest, registry } from './canonical.mjs';
import { MEDIA_PATH_PATTERN } from './images.mjs';
import {
  addRepairRound, ClaimError, claimSubmission, ConflictError, getSubmission, publishSubmission, recordRound,
  rejectSubmission, releaseClaim, renewClaim, StateError,
} from './store.mjs';
import { buildReviewDocument, blobSha1 } from './review-document.mjs';
import { lensesFor } from './lenses.mjs';
import { makeRowRepairValidator } from './repair-adapter.mjs';
import { describeRowContract } from './repair-rules.mjs';
import { actorFor, checkKindPolicy, KIND_RULES, liveContext, policyDeps, recheckImages, sourceRefFor } from './submit.mjs';
import { notifyFailure, propagate } from './deploy.mjs';
import { postSlack } from './notify.mjs';
import { lintPost } from '../blog-lint.mjs';
import { trimEvidence } from '../automation/news-preflight.mjs';

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

// gate_rounds.overall is numeric(4,2): PostgreSQL rounds the decimal text half away
// from zero (7.255 -> 7.26), which binary toFixed does not (7.255 -> "7.25"). The gate
// persists and compares this exact value so a resumed round, whose prior rounds come
// back from the DB, judges convergence on the same numbers as an uninterrupted run.
export function toNumeric2(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // String() is the shortest round-trip decimal, the same text pg sends to the server.
  const shortest = String(Math.abs(value));
  const text = shortest.includes('e') ? Math.abs(value).toFixed(20) : shortest;
  const [whole, fraction = ''] = text.split('.');
  let hundredths = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if ((fraction[2] ?? '0') >= '5') hundredths += 1n;
  const rounded = Number(hundredths) / 100;
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

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
        { attempt: round, overall: toNumeric2(verdict.overall), blockingCount },
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
    // Pass/fail stays on the raw verdict (7.996 never passes an 8 bar); only the
    // persisted/compared score is the numeric(4,2) value.
    passed: evaluated.ok && evaluated.passed,
    overall: toNumeric2(verdict?.overall),
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

// ---------------------------------------------------------------------------
// gateContent: g0-g8 driven only by DB state; every mutation carries the claim.
// ---------------------------------------------------------------------------
const GROUNDED = Object.freeze(['blog', 'blog-live', 'news']);
const DECISION_STATE = { validation: 'rejected', lint: 'rejected', unrepairable: 'blocked', exhausted: 'blocked', 'not-converging': 'blocked', block: 'blocked' };

export async function roundVector(db, id, round) {
  return (await db.query(`select i.dataset,i.key,i.rev,i.payload_sha256,r.payload from content.round_items i
    join content.revisions r using(dataset,key,rev) where i.submission_id=$1 and i.round=$2 order by i.dataset,i.key`, [id, round])).rows;
}

export async function basePayloads(db, items) {
  const out = new Map();
  for (const item of items) {
    if (item.expected_live_rev == null) continue;
    const row = (await db.query('select payload from content.revisions where dataset=$1 and key=$2 and rev=$3', [item.dataset, item.key, item.expected_live_rev])).rows[0];
    out.set(`${item.dataset}\t${item.key}`, row?.payload ?? null);
  }
  return out;
}

function listing(checkout, dir) {
  try { return fs.readdirSync(path.join(checkout, dir)); } catch { return []; }
}

// docs/specs/neon-gate-candidate-media-inventory.md: the distinct /media paths the
// current round vector's registry image fields reference, kept only when the exact
// content.assets row's stored bytes hash to its sha256, match byte_size, and the
// path's <sha16> is that digest's prefix. Which submission stored the row is
// irrelevant; candidate strings alone never qualify. Order: vector (dataset,key), field.
// Returns the verified paths and the referenced ones that failed verification.
export async function currentSubmissionMediaPaths(db, candidates) {
  const referenced = [];
  for (const item of candidates) {
    for (const field of registry[item.dataset]?.imageFields || []) {
      const value = item.payload?.[field];
      if (typeof value === 'string' && MEDIA_PATH_PATTERN.test(value) && !referenced.includes(value)) referenced.push(value);
    }
  }
  const verified = [];
  for (const mediaPath of referenced) {
    const row = (await db.query('select sha256,byte_size,bytes from content.assets where path=$1', [mediaPath])).rows[0];
    if (!row || !Buffer.isBuffer(row.bytes)) continue;
    const digest = createHash('sha256').update(row.bytes).digest('hex');
    if (digest !== row.sha256 || row.bytes.length !== Number(row.byte_size)) continue;
    if (mediaPath.split('/')[2] !== digest.slice(0, 16)) continue;
    verified.push(mediaPath);
  }
  return { verified, rejected: referenced.filter((mediaPath) => !verified.includes(mediaPath)) };
}

// Grounded kinds: bounded link/asset inventory — verified current-submission media,
// then live media, then checkout listings. A path the current vector references but
// that failed verification is withheld from the live source too, so it cannot come
// back in as "verified" just because a published record also uses it.
function inventoryFromLive(agent, live, checkout, { verified, rejected }) {
  return agent.inventoryFromData({
    services: live.live.services, topics: live.live.topics, posts: live.live.posts,
    blogImages: listing(checkout, 'public/images/blog'), neighborhoodImages: listing(checkout, 'public/images/neighborhood'),
    ogImages: listing(checkout, 'public/images/og'),
    images: live.mediaPaths.filter((mediaPath) => !rejected.includes(mediaPath)), currentImages: verified,
  });
}

// review-agent pulls in the agent SDK; load it only when the gate really runs.
const loadReviewAgent = () => import('../automation/review-agent.mjs');

// opts: {submission, script, actor, owner}; runtime: {env, deps:{review, fix, fetchImpl, now, wait,
// onPhase, smoke}, checkout}. Returns {result, exitCode}.
export async function gateContent(db, opts, { env = process.env, deps = {}, checkout = process.cwd() } = {}) {
  const id = Number(opts.submission);
  if (!Number.isInteger(id) || id <= 0) throw new Error('--submission required');
  const actor = actorFor(opts, env);
  const owner = opts.owner && opts.owner !== true ? opts.owner : actor;
  const script = opts.script && opts.script !== true ? loadScript(opts.script, { dbName: db.dbName }) : null;
  const onPhase = deps.onPhase ?? (() => {});
  const slack = (text) => postSlack({ webhookUrl: env.SLACK_WEBHOOK_URL, text, fetchImpl: deps.fetchImpl ?? globalThis.fetch });
  const rt = { slack, onPhase };

  let token;
  try {
    ({ token } = await claimSubmission(db, id, { owner }));
  } catch (error) {
    if (error instanceof ClaimError) return { result: { submissionId: id, error: 'claimed' }, exitCode: 1 };
    throw error;
  }
  try {
    return await drive({ db, id, token, actor, script, env, deps, checkout, rt });
  } catch (error) {
    if (!(error instanceof ClaimError)) {
      const reason = error?.name === 'TimeoutError' ? 'timeout' : error instanceof StateError ? 'state-error' : 'operational-error';
      try { await slack(`#${id} gate error: ${reason} — rerun: content gate --submission ${id}`); }
      catch { /* Preserve the original gate error and exit 1 when Slack is down. */ }
    }
    throw error;
  } finally {
    await releaseClaim(db, id, token).catch(() => {});
  }
}

async function drive({ db, id, token, actor, script, env, deps, checkout, rt }) {
  const agent = await loadReviewAgent();
  const review = deps.review ?? agent.reviewRows;
  const fix = deps.fix ?? agent.planRecordRepair;
  const inventoryFor = async (live, candidates) => inventoryFromLive(agent, live, checkout, await currentSubmissionMediaPaths(db, candidates));
  let fixerFailures = 0;
  const closed = ({ submission, rounds }, extra = {}) => {
    const last = rounds.at(-1);
    return {
      submissionId: id, state: submission.state, decision: submission.decision,
      overall: last?.overall == null ? null : Number(last.overall), repairs: submission.repairs, ...extra,
    };
  };

  for (;;) {
    let state = await getSubmission(db, id);
    const { submission } = state;
    if (submission.state === 'published') return publishTail({ db, id, token, actor, env, deps });
    if (['rejected', 'blocked', 'error', 'compensated'].includes(submission.state)) {
      const notified = submission.notified_at ? true : await notifyFailure(db, { submission, rounds: state.rounds, token, rt });
      return { result: closed(state, { notified }), exitCode: submission.state === 'error' ? 1 : 2 };
    }
    const n = submission.round;
    const recorded = state.rounds.find((round) => round.round === n);
    let decision = recorded?.decision;
    // recordRound closes terminal decisions atomically, so an open round cannot hold one.
    if (decision && TERMINAL_DECISIONS.includes(decision)) return { result: closed(state, { error: 'corrupt' }), exitCode: 1 };
    const vector = await roundVector(db, id, n);
    const opOf = new Map(state.items.map((item) => [`${item.dataset}\t${item.key}`, item.op]));
    const candidates = vector.map((row) => ({ dataset: row.dataset, key: row.key, op: opOf.get(`${row.dataset}\t${row.key}`), payload: row.payload }));
    const kind = submission.kind;
    const context = submission.context ?? {};
    const live = await liveContext(db);
    try {
      const grounded = GROUNDED.includes(kind);
      if (!decision) {
        // g1 deterministic
        const policy = checkKindPolicy({ kind, items: candidates, ctx: context, live: live.live, deps: policyDeps({ kind, context: { root: live.root }, checkout }) });
        const imageErrors = await recheckImages({ db, kind, items: candidates, checkout, sourceRef: sourceRefFor(submission.target) });
        const errors = [...policy.errors, ...imageErrors];
        // g2 document
        const bases = await basePayloads(db, state.items);
        let doc;
        try {
          doc = buildReviewDocument({
            submissionId: id, round: n, kind, target: submission.target,
            items: candidates.map((item) => ({ dataset: item.dataset, key: item.key, base: bases.get(`${item.dataset}\t${item.key}`) ?? null, candidate: item.payload })),
          });
        } catch (error) {
          errors.push(error.message);
          doc = { document: '', contentSha: blobSha1('') };
        }
        const digest = candidateDigest(vector);
        if (errors.length) {
          const failed = policy.decision === 'lint' && errors.length === policy.errors.length ? 'lint' : 'validation';
          await recordRound(db, id, token, {
            round: n, contentSha: doc.contentSha, candidateDigest: digest, verdict: null, overall: null, passed: false,
            blockingCount: 0, lint: { errors }, decision: failed, scripted: Boolean(script),
          });
          rt.onPhase('recordRound:terminal');
          continue;
        }
        // g3 review
        const lenses = lensesFor(kind, candidates[0].dataset);
        const references = grounded ? agent.selectReferenceRecords(doc.document, live.live.businesses ?? []) : [];
        const inventory = grounded ? await inventoryFor(live, candidates) : null;
        const evidence = kind === 'news' ? trimEvidence(context.evidence) : null;
        rt.onPhase(`review:${n}`);
        const verdict = script
          ? scriptedVerdict(script, n, doc.contentSha)
          : await review({ kind, lenses, document: doc.document, contentSha: doc.contentSha, references, inventory, evidence });
        // g4 decision, persisted once
        const decided = decideRound({
          kind, verdict, contentSha: doc.contentSha, repairs: submission.repairs, round: n,
          priorRounds: state.rounds.filter((round) => round.round < n), datasets: candidates.map((item) => item.dataset),
        });
        decision = decided.decision;
        await recordRound(db, id, token, {
          round: n, contentSha: doc.contentSha, candidateDigest: digest, verdict, overall: decided.overall,
          passed: decided.passed, blockingCount: decided.blockingCount, lint: null, decision, scripted: Boolean(script),
        });
        rt.onPhase(`recordRound:${decision === 'go' || decision === 'repair' ? decision : 'terminal'}`);
        if (DECISION_STATE[decision]) continue;
        state = await getSubmission(db, id);
      }
      await renewClaim(db, id, token);

      if (decision === 'go') {
        try {
          await publishSubmission(db, id, token, { actor });
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error;
          await rejectSubmission(db, id, token, { state: 'rejected', decision: 'conflict' });
          continue;
        }
        rt.onPhase('publishSubmission');
        continue;
      }

      // fixer (decision === 'repair')
      const roundRow = state.rounds.find((round) => round.round === n);
      const payload = fixerPayload(candidates);
      const files = payload.map((entry) => entry.file);
      const validate = makeRowRepairValidator({
        kind, candidates, ctx: context, live: live.live,
        deps: policyDeps({ kind, context: { root: live.root }, checkout }),
      });
      const references = grounded ? agent.selectReferenceRecords(JSON.stringify(payload), live.live.businesses ?? []) : [];
      const inventory = grounded ? await inventoryFor(live, candidates) : null;
      const lintFindings = KIND_RULES[kind].lint
        ? candidates.flatMap((item) => lintPost(item.payload, { businesses: live.live.businesses ?? [], now: context.now ? new Date(context.now) : undefined }).findings)
        : [];
      let repaired;
      try {
        if (script) {
          const plan = scriptedFix(script, submission.repairs);
          const check = validate(plan);
          if (!check.ok) throw new Error(`invalid repair plan: ${check.errors.join('; ')}`);
          repaired = check.repaired;
        } else {
          const result = await fix({
            kind: POLICY_KIND[kind], gateVerdict: roundRow?.verdict, payload, validate, references, inventory, lintFindings,
            schema: agent.rowRepairSchema(files), describeContract: describeRowContract,
          });
          repaired = result.check.repaired;
        }
      } catch {
        // No rows written: the round stays `repair`, so the loop (or a rerun) retries the
        // fixer; a second consecutive failure in this process closes the submission.
        fixerFailures += 1;
        if (fixerFailures >= 2) await rejectSubmission(db, id, token, { state: 'error', decision: 'error' });
        continue;
      }
      fixerFailures = 0;
      await addRepairRound(db, id, token, { fromRound: n, repairs: repaired });
      rt.onPhase('addRepairRound');
    } finally {
      live.cleanup();
    }
  }
}

async function publishTail({ db, id, token, actor, env, deps }) {
  const propagation = await propagate(db, { submissionId: id, token, actor, env, deps });
  const refreshed = await getSubmission(db, id);
  const last = refreshed.rounds.at(-1);
  const base = String(env.CONTENT_SITE_URL || '').replace(/\/+$/, '');
  const published = refreshed.items.map((item) => {
    const route = registry[item.dataset]?.route;
    return { dataset: item.dataset, key: item.key, rev: item.published_rev == null ? null : Number(item.published_rev), url: route ? `${base}${route.replace(':key', item.key)}` : `${base}/content-snapshot/${registry[item.dataset].file}` };
  });
  return {
    result: {
      submissionId: id, state: refreshed.submission.state, decision: refreshed.submission.decision,
      overall: last?.overall == null ? null : Number(last.overall), repairs: refreshed.submission.repairs,
      liveSeq: refreshed.submission.live_seq == null ? null : Number(refreshed.submission.live_seq), published,
      deploy: propagation.deploy, smoke: propagation.smoke, notified: propagation.notified,
      ...(propagation.compensation ? { compensation: propagation.compensation } : {}),
      ...(propagation.reason ? { reason: propagation.reason } : {}),
    },
    exitCode: propagation.exitCode,
  };
}
