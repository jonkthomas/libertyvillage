// Bounded self-recovery policy for the autonomous content loop.
//
// Every function here is pure and clock-injectable, and every budget it exposes
// is finite (N3). Nothing in this module can publish, lower the gate, or re-enter
// generation without crossing a cooldown — the exhaustion path always ends in a
// human-visible terminal state, never in a retry loop.
import { MAX_REPAIRS, MAX_TRANSIENT_RETRIES, TRUSTED_PR_AUTHORS } from './constants.mjs';
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
export const ABANDON_EXPIRY_DAYS = 30;
export const MAX_QUEUE_ATTEMPTS = 3;

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

// F5/F14. What the last *durable* coordinator decision on a candidate actually was.
// A candidate that carries the blocked label is a candidate the loop already
// stopped: `block-generator` writes one of these decisions and only then applies
// `automation-blocked`. Reading the repair counter alone cannot tell a genuinely
// repairable mid-flight candidate from a validation-failed / unrepairable / errored
// one that will never move again — which is exactly how attempts=0 blocked PRs were
// stranded forever on `repair`.
export const NO_USEFUL_WORK_DECISIONS = Object.freeze([
  'blocked', 'error', 'exhausted', 'unrepairable', 'validation-failed', 'abandoned', 'lint-discarded',
]);

// The documented continuations plus the success terminals: while one of these is the
// latest durable decision the loop is still doing real work on this candidate, so the
// bounded repair budget is the right thing to read.
export const IN_FLIGHT_DECISIONS = Object.freeze(['repairing', 'healing', 'passed', 'promoted']);

export function classifyBlockDecision(decision) {
  const value = typeof decision === 'string' ? decision.trim() : '';
  if (IN_FLIGHT_DECISIONS.includes(value)) return 'in-flight';
  // Unknown or unreadable durable evidence is NOT a reason to keep waiting: a
  // blocked candidate nobody can explain is precisely the stranded case. Fail
  // closed towards the bounded close-and-regenerate ladder, never towards forever.
  return 'no-useful-work';
}

// The machine-readable half of the durable audit comment the coordinator posts on
// every round. It is written by trusted code and read back by trusted code; the
// human-readable body next to it is what a person reads.
export const AUDIT_DATA_MARKER = 'automation-audit-data';
const AUDIT_DATA_PATTERN = new RegExp(`<!--\\s*${AUDIT_DATA_MARKER}:(\\{[\\s\\S]*?\\})\\s*-->`);

// Decisions that carry a genuine Opus gate verdict into the ordered repair history.
// Heal / validation / lint / error audits are durable coordinator bookkeeping but
// they are not scored rounds — putting them in the history lets a missing score
// look like 0 and a harmless heal look like a catastrophic regression.
const SCORED_GATE_DECISIONS = new Set([
  'repairing', 'passed', 'blocked', 'exhausted', 'unrepairable', 'reviewing', 'promoted',
]);

// `Number(null) === 0` and `Number('') === 0`. A missing score must stay missing;
// a genuine numeric 0 from a scored gate verdict must stay 0.
function parseFiniteScore(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseAuditRecord(body) {
  const match = AUDIT_DATA_PATTERN.exec(String(body ?? ''));
  if (!match) return null;
  let value = null;
  try { value = JSON.parse(match[1]); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!isExactSha(value.sha)) return null;
  const decision = typeof value.decision === 'string' ? value.decision : null;
  const blockingCount = Number(value.blockingCount);
  return {
    sha: value.sha,
    decision,
    attempt: Number.isInteger(value.attempt) ? value.attempt : null,
    overall: parseFiniteScore(value.overall),
    blockingCount: Number.isFinite(blockingCount) ? blockingCount : 0,
  };
}

function isScoredGateAudit(record) {
  return Boolean(
    record
    && SCORED_GATE_DECISIONS.has(record.decision)
    && Number.isFinite(record.overall),
  );
}

// F4. Rebuilds the ordered gate history for one candidate from the durable audit
// comments the coordinator has already posted, oldest first. Only comments written
// by a trusted author count, and only the FIRST scored gate-verdict record per
// reviewed SHA, so neither a rerun, an untrusted commenter, nor an unscored
// heal/validation audit can forge convergence.
export function buildRepairHistory(comments, { trustedAuthors = TRUSTED_PR_AUTHORS } = {}) {
  const bySha = new Map();
  for (const comment of Array.isArray(comments) ? comments : []) {
    const author = comment?.user?.login;
    if (!trustedAuthors.includes(author)) continue;
    const record = parseAuditRecord(comment?.body);
    if (!isScoredGateAudit(record) || bySha.has(record.sha)) continue;
    bySha.set(record.sha, record);
  }
  return [...bySha.values()].map((record, index) => ({ ...record, attempt: index }));
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

function clockMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  return Date.parse(String(now));
}

function emptyTopicState() {
  return {
    regenerations: 0,
    lastFailureAt: null,
    abandoned: false,
    abandonedAt: null,
    reason: null,
  };
}

function isExpiredTopic(topic, now) {
  if (!topic?.abandoned || !topic.abandonedAt) return false;
  const age = clockMs(now) - Date.parse(topic.abandonedAt);
  if (!Number.isFinite(age)) return false;
  return age >= ABANDON_EXPIRY_DAYS * 24 * HOUR_MS;
}

export function isTopicAbandoned(topic, now) {
  return topic?.abandoned === true && !isExpiredTopic(topic, now);
}

export function expireAbandonedTopics(state, now) {
  const topics = { ...(state?.topics ?? {}) };
  for (const [key, topic] of Object.entries(topics)) {
    if (!isExpiredTopic(topic, now)) continue;
    topics[key] = {
      ...emptyTopicState(),
      lastReason: topic.reason ?? topic.lastReason ?? null,
    };
  }
  return { ...state, topics };
}

function kindQueue(queue, kind) {
  const list = Array.isArray(queue) ? queue : (Array.isArray(queue?.topics) ? queue.topics : []);
  return list.filter((entry) => entry?.kind === kind);
}

export function selectNextTopic(queue, state, now) {
  const kind = state?.kind;
  const list = kindQueue(queue, kind);
  const topics = state?.topics ?? {};
  const exclude = new Set(Array.isArray(state?.excludeKeys) ? state.excludeKeys : []);
  const eligible = [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    const topic = topics[entry.key] ?? emptyTopicState();
    if (isTopicAbandoned(topic, now)) continue;
    if (topic.consumed === true) continue;
    if (exclude.has(entry.key)) continue;
    const attempts = isExpiredTopic(topic, now) ? 0 : (Number.isInteger(entry.attempts) ? entry.attempts : 0);
    if (attempts > MAX_QUEUE_ATTEMPTS) continue;
    eligible.push({ entry, attempts, index });
  }
  eligible.sort((left, right) => left.attempts - right.attempts || left.index - right.index);
  return eligible[0]?.entry ?? null;
}

// F14. The ladder movement a just-observed candidate failure causes. It is asked
// at the moment of failure and is deliberately independent of the cooldown: the
// cooldown governs when the NEXT candidate may start, never whether this failure
// counted. Splitting it out gives the ladder one binding site that both the open-PR
// path and the pre-PR claim-linter discard go through.
export function recordCandidateFailure({ regenerations = 0 } = {}) {
  const spent = Number.isInteger(regenerations) && regenerations >= 0 ? regenerations : MAX_CANDIDATE_REGENERATIONS;
  if (spent >= MAX_CANDIDATE_REGENERATIONS) {
    return {
      action: 'abandon-topic',
      regenerations: spent,
      reason: `every bounded candidate failed (${spent}/${MAX_CANDIDATE_REGENERATIONS} regenerations); escalating once to a human`,
    };
  }
  return {
    action: 'close-and-regenerate',
    regenerations: spent,
    reason: `regeneration ${spent + 1}/${MAX_CANDIDATE_REGENERATIONS} is still within the bounded ladder`,
  };
}

// F8/F14. An exhausted candidate is CLOSED and a fresh grounded candidate is
// generated a full cycle later — never re-pushed, never force-published, and never
// past the gate (N4). `reuseDraft` is false on every path by construction.
export function nextCandidateAction({
  attempts, maxRepairs = MAX_REPAIRS, regenerations = 0, healExhausted = false, blockDecision,
  blockedAt, now,
} = {}) {
  const decision = (action, reason, closeCandidate = false) => ({
    action, reason, closeCandidate, reuseDraft: false, lowerThreshold: false,
  });
  const budget = Number.isInteger(maxRepairs) && maxRepairs >= 0 ? maxRepairs : MAX_REPAIRS;
  const used = Number.isInteger(attempts) && attempts >= 0 ? attempts : budget;
  // A repair counter with budget left only means "keep repairing" when the durable
  // evidence says the loop is still mid-flight. A blocked candidate whose recorded
  // decision was validation-failed / unrepairable / errored has no useful repair
  // work left however many attempts it never spent, and must enter the bounded
  // close-and-regenerate ladder instead of waiting forever.
  const stranded = blockDecision !== undefined && classifyBlockDecision(blockDecision) === 'no-useful-work';
  const exhausted = Boolean(healExhausted) || used >= budget || stranded;

  if (!exhausted) return decision('repair', `repair budget remains: ${used}/${budget}`);

  const ladder = recordCandidateFailure({ regenerations });
  if (ladder.action === 'abandon-topic') return decision('abandon-topic', ladder.reason, true);

  const idle = hoursSince(blockedAt, now);
  if (idle === null) return decision('wait', 'blocked-at timestamp is unreadable; waiting rather than regenerating');
  if (idle < REGENERATION_COOLDOWN_HOURS) {
    return decision('wait', `cooling down: ${idle.toFixed(1)}h of ${REGENERATION_COOLDOWN_HOURS}h elapsed`);
  }
  const why = healExhausted
    ? 'base conflict is unhealable'
    : stranded
      ? `the recorded terminal decision \`${String(blockDecision)}\` leaves no repair work this candidate could ever do`
      : `repair budget exhausted at ${used}/${budget}`;
  return decision(
    'close-and-regenerate',
    `${why}; closing this candidate and generating a fresh grounded draft`,
    true,
  );
}

// F10. Telling a promotion coordinator run apart from an ordinary generator one.
// The dispatch payload is not exposed on the workflow-run API, but the job graph is:
// a promotion dispatch runs `validate-promotion` and skips `validate-generator`, and
// vice versa. Without this distinction any blog/SEO/news dispatch counted as "already
// dispatched this tick" and normal generator activity could suppress the sweep
// indefinitely — which is precisely the stranded-`main` case the sweep exists for.
export const PROMOTION_COORDINATOR_JOBS = Object.freeze(['validate-promotion', 'prepare-promotion', 'validate-promotion-pr']);

export function isPromotionCoordinatorRun(jobs) {
  return (Array.isArray(jobs) ? jobs : []).some((job) => (
    PROMOTION_COORDINATOR_JOBS.includes(job?.name)
    && job?.conclusion !== 'skipped'
    && job?.status !== 'skipped'
  ));
}

// The only runs worth inspecting are the ones recent enough to still suppress a
// dispatch. Newest first, and hard-capped so one tick cannot fan out over history.
export function selectRecentDispatchRuns(runs, { now, hours = SWEEP_MIN_DISPATCH_INTERVAL_HOURS, limit = 10 } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('sweep run selection requires an explicit clock');
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => Number.isFinite(Date.parse(run?.created_at ?? '')))
    .filter((run) => (nowMs - Date.parse(run.created_at)) / HOUR_MS < hours)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, limit);
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
