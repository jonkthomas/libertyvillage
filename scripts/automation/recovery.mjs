// Bounded self-recovery policy for the autonomous content loop.
//
// Every function here is pure and clock-injectable, and every budget it exposes
// is finite (N3). Nothing in this module can publish, lower the gate, or re-enter
// generation without crossing a cooldown — the exhaustion path always ends in a
// human-visible terminal state, never in a retry loop.
import { MAX_REPAIRS, MAX_TRANSIENT_RETRIES } from './constants.mjs';
import { isExactSha } from './policy.mjs';

const HOUR_MS = 60 * 60 * 1000;

// F7. One coordinator run may redispatch itself at most twice for a transient
// infrastructure failure; the third ends in a visible block. Bound in constants.mjs
// so the controlled retry-label lifecycle in policy.mjs enforces the same number.
export { MAX_TRANSIENT_RETRIES };
export const RETRY_BASE_DELAY_SECONDS = 60;

// F14. A topic gets at most three bounded candidates in total, each separated by
// a full cycle, and then a single human-visible abandonment.
export const MAX_CANDIDATE_REGENERATIONS = 2;
export const REGENERATION_COOLDOWN_HOURS = 24;

// F10. The sweep is the backstop for a lost promotion dispatch, not a second
// promotion path: one dispatch per tick, and only after the ordinary
// fire-and-forget path has had a full day to work.
export const PROMOTION_STALE_HOURS = 24;
export const SWEEP_MIN_DISPATCH_INTERVAL_HOURS = 6;

// A policy rejection is terminal by definition: retrying it changes nothing and
// only hides the refusal. Anything unrecognised is terminal too — fail closed.
const TERMINAL_PATTERNS = [
  /\brejected\b/i,
  /\binvalid\b/i,
  /\buntrusted\b/i,
  /\bforbidden\b/i,
  /\bnot allowed\b/i,
  /\bbudget exceeded\b/i,
];

const TRANSIENT_PATTERNS = [
  /\b(?:429|500|502|503|504)\b/,
  /\brate limit/i,
  /error_during_execution/,
  /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE)\b/,
  /socket hang up|network (?:error|timeout)|fetch failed/i,
  /\btimed out\b|\btimeout\b/i,
  /bad gateway|service unavailable|gateway time-?out|server error/i,
];

function messageOf(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
  return String(error ?? '');
}

export function classifyRunFailure(error) {
  const message = messageOf(error);
  if (TERMINAL_PATTERNS.some((pattern) => pattern.test(message))) return 'terminal';
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))) return 'transient';
  return 'terminal';
}

export function nextRetry({ attempts, classification } = {}) {
  if (classification !== 'transient') {
    return { action: 'block', delaySeconds: 0, reason: 'failure is terminal; a policy refusal never retries' };
  }
  if (!Number.isInteger(attempts) || attempts < 0) {
    return { action: 'block', delaySeconds: 0, reason: 'retry attempt count is unreadable; failing closed' };
  }
  if (attempts >= MAX_TRANSIENT_RETRIES) {
    return {
      action: 'block',
      delaySeconds: 0,
      reason: `transient retry budget exhausted at ${attempts}/${MAX_TRANSIENT_RETRIES}`,
    };
  }
  return {
    action: 'retry',
    delaySeconds: RETRY_BASE_DELAY_SECONDS * 2 ** attempts,
    reason: `transient failure; redispatch ${attempts + 1}/${MAX_TRANSIENT_RETRIES} after backoff`,
  };
}

// F4. #97 went 7.2 -> 6.5 and #75 went 5.0 -> 4.5 while the budget kept paying for
// rounds that were making the candidate worse. A round that regresses the score, or
// introduces a blocking finding the previous round did not have, ends the loop.
export function evaluateRepairProgress({ history } = {}) {
  const rounds = (Array.isArray(history) ? history : [])
    .filter((round) => round && Number.isFinite(round.overall))
    .slice()
    .sort((left, right) => (left.attempt ?? 0) - (right.attempt ?? 0));
  if (rounds.length < 2) {
    return { decision: 'continue', reason: 'not enough rounds to judge convergence', improving: false };
  }
  const previous = rounds.at(-2);
  const latest = rounds.at(-1);
  const blockingBefore = Number(previous.blockingCount ?? 0);
  const blockingAfter = Number(latest.blockingCount ?? 0);
  if (blockingAfter > blockingBefore) {
    return {
      decision: 'abandon',
      reason: `the repair introduced a new blocking finding (${blockingBefore} -> ${blockingAfter})`,
      improving: false,
    };
  }
  if (latest.overall < previous.overall) {
    return {
      decision: 'abandon',
      reason: `score regressed ${previous.overall} -> ${latest.overall}`,
      improving: false,
    };
  }
  return {
    decision: 'continue',
    reason: latest.overall > previous.overall
      ? `score improved ${previous.overall} -> ${latest.overall}`
      : `score held at ${latest.overall} within the bounded budget`,
    improving: latest.overall > previous.overall,
  };
}

function hoursSince(timestamp, now) {
  const then = Date.parse(timestamp ?? '');
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(then) || !Number.isFinite(nowMs)) return null;
  return (nowMs - then) / HOUR_MS;
}

// F8/F14. An exhausted candidate is CLOSED and a fresh grounded candidate is
// generated a full cycle later — never re-pushed, never force-published, and never
// past the gate (N4). `reuseDraft` is false on every path by construction.
export function nextCandidateAction({
  attempts, maxRepairs = MAX_REPAIRS, regenerations = 0, healExhausted = false, blockedAt, now,
} = {}) {
  const decision = (action, reason, closeCandidate = false) => ({
    action, reason, closeCandidate, reuseDraft: false, lowerThreshold: false,
  });
  const budget = Number.isInteger(maxRepairs) && maxRepairs >= 0 ? maxRepairs : MAX_REPAIRS;
  const used = Number.isInteger(attempts) && attempts >= 0 ? attempts : budget;
  const exhausted = Boolean(healExhausted) || used >= budget;

  if (!exhausted) return decision('repair', `repair budget remains: ${used}/${budget}`);

  const spent = Number.isInteger(regenerations) && regenerations >= 0 ? regenerations : MAX_CANDIDATE_REGENERATIONS;
  if (spent >= MAX_CANDIDATE_REGENERATIONS) {
    return decision(
      'abandon-topic',
      `every bounded candidate failed (${spent}/${MAX_CANDIDATE_REGENERATIONS} regenerations); escalating once to a human`,
      true,
    );
  }

  const idle = hoursSince(blockedAt, now);
  if (idle === null) return decision('wait', 'blocked-at timestamp is unreadable; waiting rather than regenerating');
  if (idle < REGENERATION_COOLDOWN_HOURS) {
    return decision('wait', `cooling down: ${idle.toFixed(1)}h of ${REGENERATION_COOLDOWN_HOURS}h elapsed`);
  }
  return decision(
    'close-and-regenerate',
    healExhausted
      ? 'base conflict is unhealable; closing this candidate and generating a fresh grounded draft'
      : `repair budget exhausted at ${used}/${budget}; closing this candidate and generating a fresh grounded draft`,
    true,
  );
}

// F10. Dispatch only when main is genuinely stranded behind staging, the ordinary
// path has had first refusal, nothing is already in flight, and this tick has not
// dispatched yet.
export function planPromotionSweep({
  aheadBy, stagingHeadAt, openPromotionPrs = [], lastDispatchAt = null, stagingSha, now,
} = {}) {
  const skip = (reason) => ({ action: 'skip', sha: null, reason });
  if (!Number.isInteger(aheadBy) || aheadBy <= 0) return skip('main already contains staging; nothing to promote');
  if (Array.isArray(openPromotionPrs) && openPromotionPrs.length > 0) {
    return skip(`a promotion PR is already open (#${openPromotionPrs.map((pr) => pr?.number ?? '?').join(', #')})`);
  }
  if (!isExactSha(stagingSha)) return skip('staging head is not an exact SHA; refusing to dispatch');

  const headAge = hoursSince(stagingHeadAt, now);
  if (headAge === null) return skip('staging head timestamp is unreadable; failing closed');
  if (headAge < PROMOTION_STALE_HOURS) {
    return skip(`staging head is ${headAge.toFixed(1)}h old; the fire-and-forget path gets first refusal`);
  }

  const sinceDispatch = lastDispatchAt === null ? null : hoursSince(lastDispatchAt, now);
  if (sinceDispatch !== null && sinceDispatch < SWEEP_MIN_DISPATCH_INTERVAL_HOURS) {
    return skip(`already dispatched ${sinceDispatch.toFixed(1)}h ago; at most one dispatch per tick`);
  }

  return {
    action: 'dispatch',
    sha: stagingSha,
    reason: `main is ${aheadBy} commit(s) behind a staging head that is ${headAge.toFixed(1)}h old with no promotion in flight`,
  };
}
