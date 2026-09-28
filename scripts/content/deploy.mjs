// g6 deploy (§4.6): POST the target's Vercel deploy hook. A crash between the POST
// and markPhase('deploy_requested') re-POSTs on resume; a duplicate build is harmless.
import { keyOf, registry } from './canonical.mjs';
import {
  ClaimError, claimSubmission, compensateSubmission, ConflictError, getSubmission, listPending, markItemSmoke,
  markPhase, readLive, releaseClaim, renewClaim, adminAction, StateError, ValidationError,
} from './store.mjs';
import { createHttp, runSmoke } from './smoke.mjs';
import {
  describeItem, formatAdmin, formatAdminSmokeAlert, formatCompensationConflict, formatFailure,
  formatPropagationWarning, formatSuccess, notifyOnce, postSlack,
} from './notify.mjs';

export const DEPLOY_HOOK_ATTEMPTS = 2;
export const DEPLOY_HOOK_TIMEOUT_MS = 10_000;

export class DeployHookError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeployHookError';
    this.code = 'hook-failed';
  }
}

// 2 attempts, 10 s timeout each, 2xx required. Throws DeployHookError otherwise,
// which the gate treats as a propagation failure (content stays published, exit 3).
export async function requestDeploy({
  hookUrl, fetchImpl = globalThis.fetch, attempts = DEPLOY_HOOK_ATTEMPTS, timeoutMs = DEPLOY_HOOK_TIMEOUT_MS,
}) {
  if (!hookUrl) throw new DeployHookError('CONTENT_DEPLOY_HOOK_URL is not set');
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(hookUrl, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
      if (response.status >= 200 && response.status < 300) return { status: response.status, attempts: attempt };
      failures.push(`HTTP ${response.status}`);
    } catch (error) {
      failures.push(error?.name === 'TimeoutError' ? 'timeout' : String(error?.message || error));
    }
  }
  throw new DeployHookError(`deploy hook failed after ${attempts} attempts: ${failures.join('; ')}`);
}

// ---------------------------------------------------------------------------
// g6-g8 for one published submission (writer or admin), driven by its phase
// timestamps so a resume skips whatever already happened. Returns
// {state, deploy, smoke, notified, exitCode}; exit 3 = published, propagation pending.
// ---------------------------------------------------------------------------
export const RENEW_EVERY_MS = 5 * 60_000;

// DB current live rev (+ sha, payload) per item, from one readLive snapshot.
export const currentReader = (db) => async (items) => {
  const datasets = [...new Set(items.map((item) => item.dataset))];
  const snapshot = await readLive(db, { datasets });
  const current = new Map();
  for (const item of items) {
    const value = snapshot.datasets[item.dataset];
    const entry = value.entries[item.key];
    const record = entry ? value.records.find((candidate) => keyOf(item.dataset, candidate) === item.key) : null;
    current.set(`${item.dataset}\t${item.key}`, entry ? { rev: entry.rev, sha: entry.sha, payload: record } : { rev: null, sha: null, payload: null });
  }
  return current;
};

function runtime(env, deps = {}) {
  return {
    env,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    now: deps.now ?? Date.now,
    wait: deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    onPhase: deps.onPhase ?? (() => {}),
    smoke: deps.smoke ?? {},
    slack: (text) => postSlack({ webhookUrl: env.SLACK_WEBHOOK_URL, text, fetchImpl: deps.fetchImpl ?? globalThis.fetch }),
  };
}

// Warnings (propagation, compensation conflict, admin smoke alert) are best effort:
// the exit code carries the state; a Slack outage must not mask it.
const warn = async (rt, text) => { try { await rt.slack(text); } catch { /* exit code carries the state */ } };

const itemRows = (items) => items.map((item) => ({
  dataset: item.dataset, key: item.key, op: item.op, publishedRev: item.published_rev == null ? null : Number(item.published_rev),
}));

function publishedPayloads(rounds) {
  const last = rounds.at(-1);
  return new Map((last?.items ?? []).map((item) => [`${item.dataset}\t${item.key}`, item.payload]));
}

// g8 failure line for a rejected|blocked|error|compensated submission.
export async function notifyFailure(db, { submission, rounds, token, rt, decision }) {
  const last = rounds.at(-1);
  const text = formatFailure({
    submission, decision: decision ?? submission.decision, overall: last?.overall ?? null,
    findings: last?.verdict?.findings ?? [], errors: last?.lint?.errors ?? [], scripted: rounds.some((round) => round.scripted),
  });
  await notifyOnce({
    submission, text, post: rt.slack,
    markNotified: async () => { rt.onPhase('slack:delivered'); await markPhase(db, Number(submission.id), token, 'notified'); },
  });
  return true;
}

export async function propagate(db, { submissionId, token, actor, env = process.env, deps = {}, hookPosted = false }) {
  const rt = runtime(env, deps);
  const id = Number(submissionId);
  let { submission, items, rounds } = await getSubmission(db, id);
  if (submission.state !== 'published') throw new StateError(`propagation needs a published submission, got ${submission.state}`);
  const isAdmin = submission.kind === 'admin';
  const scripted = rounds.some((round) => round.scripted);
  const pending = (reason) => ({ state: 'published', deploy: submission.deploy_requested_at ? 'requested' : 'failed', smoke: 'pending', notified: false, reason, exitCode: 3 });
  let lastRenew = rt.now();
  const renew = async () => { await renewClaim(db, id, token); lastRenew = rt.now(); };

  // g6 deploy
  if (!submission.deploy_requested_at) {
    if (!hookPosted) {
      try {
        await requestDeploy({ hookUrl: env.CONTENT_DEPLOY_HOOK_URL, fetchImpl: rt.fetchImpl });
      } catch (error) {
        if (!(error instanceof DeployHookError)) throw error;
        await warn(rt, formatPropagationWarning({ submission, reason: 'hook-failed', scripted }));
        return pending('hook-failed');
      }
      rt.onPhase('hook:posted');
    }
    await markPhase(db, id, token, 'deploy_requested');
    submission = { ...submission, deploy_requested_at: new Date() };
    await renew();
  }

  // g7 smoke
  if (!submission.smoke_passed_at) {
    const unresolved = itemRows(items.filter((item) => !item.smoke));
    if (unresolved.length) {
      const http = createHttp({ siteUrl: env.CONTENT_SITE_URL, bypass: env.CONTENT_SITE_BYPASS || null, fetchImpl: rt.fetchImpl });
      const result = await runSmoke({
        liveSeq: Number(submission.live_seq), items: unresolved, registry, readCurrent: currentReader(db), http,
        now: rt.now,
        wait: async (ms) => { await rt.wait(ms); if (rt.now() - lastRenew >= RENEW_EVERY_MS) await renew(); },
        ...rt.smoke,
      });
      if (result.status === 'timeout') {
        await warn(rt, formatPropagationWarning({ submission, reason: 'smoke-timeout', scripted }));
        return pending('smoke-timeout');
      }
      if (result.status === 'bad-render') {
        if (isAdmin) {
          await warn(rt, formatAdminSmokeAlert({ submission, failures: result.failures, scripted }));
          return { state: 'published', deploy: 'requested', smoke: 'failed', failures: result.failures, notified: false, exitCode: 2 };
        }
        let compensation;
        try {
          compensation = await compensateSubmission(db, id, token, {
            actor: actor || submission.actor, reason: `smoke-failed: ${result.failures.map((failure) => `${failure.dataset}/${failure.key}: ${failure.reason}`).join('; ')}`.slice(0, 1000),
          });
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error;
          await warn(rt, formatCompensationConflict({ submission, scripted }));
          return { state: 'published', deploy: 'requested', smoke: 'failed', compensation: 'conflict', failures: result.failures, notified: false, exitCode: 2 };
        }
        rt.onPhase('compensated');
        let adminResult;
        try {
          adminResult = await propagate(db, { submissionId: compensation.adminSubmissionId, token: compensation.adminToken, actor, env, deps });
        } finally {
          await releaseClaim(db, compensation.adminSubmissionId, compensation.adminToken).catch(() => {});
        }
        const refreshed = await getSubmission(db, id);
        await notifyFailure(db, { submission: refreshed.submission, rounds: refreshed.rounds, token, rt, decision: 'smoke-failed' });
        return {
          state: 'compensated', decision: 'smoke-failed', deploy: 'requested', smoke: 'failed', failures: result.failures,
          compensation: { adminSubmissionId: compensation.adminSubmissionId, liveSeq: compensation.liveSeq, reverted: compensation.reverted, smoke: adminResult.smoke },
          notified: true, exitCode: 2,
        };
      }
      await markItemSmoke(db, id, token, result.results);
    }
    await markPhase(db, id, token, 'smoke_passed');
    await renew();
  }

  // g8 notify
  if (!submission.notified_at) {
    const payloads = publishedPayloads(rounds);
    const text = isAdmin
      ? formatAdmin({ submission, items, scripted })
      : formatSuccess({
        submission: { ...submission, overall: rounds.at(-1)?.overall ?? null },
        items: items.map((item) => ({ dataset: item.dataset, key: item.key, payload: payloads.get(`${item.dataset}\t${item.key}`) })),
        registry, siteUrl: env.CONTENT_SITE_URL, scripted,
      });
    await notifyOnce({
      submission, text, post: rt.slack,
      markNotified: async () => { rt.onPhase('slack:delivered'); await markPhase(db, id, token, 'notified'); },
    });
  }
  return { state: 'published', deploy: 'requested', smoke: 'passed', notified: true, exitCode: 0 };
}

export function itemUrls(items, siteUrl) {
  return items.map((item) => ({ ...item, url: describeItem({ ...item, payload: {} }, { registry, siteUrl }).url }));
}

async function withClaim(db, id, owner, fn) {
  let token;
  try {
    ({ token } = await claimSubmission(db, id, { owner }));
  } catch (error) {
    if (error instanceof ClaimError) return { claimed: true };
    throw error;
  }
  try {
    return await fn(token);
  } finally {
    await releaseClaim(db, id, token).catch(() => {});
  }
}

// Resume or keep the claim a caller already holds (the admin token adminAction
// returned); an expired/replayed token is re-claimed.
async function holdClaim(db, id, token, owner) {
  if (token) {
    try { await renewClaim(db, id, token); return token; } catch (error) { if (!(error instanceof ClaimError)) throw error; }
  }
  return (await claimSubmission(db, id, { owner })).token;
}

// `content deploy`: POST the target hook once, then g7-g8 for every listPending id.
// With {submission, token} (unpublish/rollback): g6-g8 for that admin submission only.
export async function deployContent(db, opts = {}, { env = process.env, deps = {} } = {}) {
  const rt = runtime(env, deps);
  const owner = opts.actor && opts.actor !== true ? opts.actor : `deploy:${process.pid}`;
  if (opts.submission !== undefined && opts.submission !== true) {
    const id = Number(opts.submission);
    let token;
    try {
      token = await holdClaim(db, id, opts.token, owner);
    } catch (error) {
      if (error instanceof ClaimError) return { result: { smoke: 'claimed' }, exitCode: 1 };
      throw error;
    }
    try {
      const propagation = await propagate(db, { submissionId: id, token, actor: owner, env, deps });
      return { result: { smoke: propagation.smoke, ...(propagation.reason ? { reason: propagation.reason } : {}) }, exitCode: propagation.exitCode };
    } finally {
      await releaseClaim(db, id, token).catch(() => {});
    }
  }
  let hookFailed = false;
  try {
    await requestDeploy({ hookUrl: env.CONTENT_DEPLOY_HOOK_URL, fetchImpl: rt.fetchImpl });
  } catch (error) {
    if (!(error instanceof DeployHookError)) throw error;
    hookFailed = true;
  }
  const submissions = [];
  for (const id of await listPending(db, { target: db.target })) {
    let outcome;
    try {
      outcome = await withClaim(db, id, owner, async (token) => {
        const { submission } = await getSubmission(db, id);
        if (hookFailed && !submission.deploy_requested_at) return { smoke: 'pending', exitCode: 3 };
        return propagate(db, { submissionId: id, token, actor: owner, env, deps, hookPosted: !hookFailed });
      });
    } catch {
      // A failed notice (or another per-submission operational failure) stays
      // pending, but later published submissions must still get their turn.
      outcome = { smoke: 'error', exitCode: 1 };
    }
    if (outcome.claimed) submissions.push({ id, smoke: 'claimed', exitCode: 3 });
    else submissions.push({ id, smoke: outcome.smoke, ...(outcome.compensation ? { compensation: outcome.compensation } : {}), exitCode: outcome.exitCode });
  }
  const exitCode = submissions.some((entry) => entry.exitCode === 1) ? 1
    : hookFailed || submissions.some((entry) => entry.exitCode === 3) ? 3
      : submissions.some((entry) => entry.exitCode === 2) ? 2 : 0;
  return {
    result: {
      ...(hookFailed ? { deploy: 'failed' } : {}),
      submissions: submissions.map((entry) => Object.fromEntries(Object.entries(entry).filter(([name]) => name !== 'exitCode'))),
    },
    exitCode,
  };
}

// `content unpublish|rollback` as one call (the CLI composes adminAction + deployContent
// the same way): adminAction, then g6-g8 on the admin submission.
export async function adminContent(db, opts, { env = process.env, deps = {} } = {}) {
  const op = opts.op;
  const actor = opts.actor && opts.actor !== true ? opts.actor
    : (env.GITHUB_ACTIONS === 'true' ? `gha:${env.GITHUB_WORKFLOW}#${env.GITHUB_RUN_ID}` : null);
  if (!actor) throw new ValidationError('--actor required');
  if (!opts.idempotencyKey || opts.idempotencyKey === true) throw new ValidationError('--idempotency-key required');
  if (!opts.reason || opts.reason === true) throw new ValidationError('--reason required');
  const admin = await adminAction(db, {
    op, dataset: opts.dataset, key: opts.key, toRev: opts.toRev === undefined ? undefined : Number(opts.toRev),
    actor, reason: opts.reason, idempotencyKey: opts.idempotencyKey, owner: actor,
  });
  const propagation = await deployContent(db, { actor, submission: admin.submissionId, token: admin.token }, { env, deps });
  return {
    result: { submissionId: admin.submissionId, existing: admin.existing, liveSeq: admin.liveSeq, fromRev: admin.fromRev, rev: admin.rev, ...propagation.result },
    exitCode: propagation.exitCode,
  };
}
