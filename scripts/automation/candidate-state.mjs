// Durable state for the bounded candidate ladder (PRD §6, ambiguity 12.4).
//
// `nextCandidateAction` is pure and takes `regenerations` and `blockedAt` as
// inputs. Until now the only place those lived was a controlled label on the open
// candidate PR — which means the budget evaporated the moment the PR closed, and
// never existed at all for a draft the claim linter refused *before* a PR was ever
// opened. A topic could therefore be regenerated forever, one cycle at a time,
// without ever reaching a human-visible `ABANDONED_TOPIC`.
//
// This module gives the ladder one auditable, repository-native home: a single
// controlled GitHub issue per generator kind, written only by the trusted bot,
// carrying a machine-readable state block next to a human-readable summary. It is
// the same discipline as the controlled label series — one binding site, one
// record, a rerun cannot buy extra budget — with the one property labels cannot
// have: it outlives the pull request, and it exists before one.
//
// Nothing here is content. It is never staged, never merged, and never reaches a
// scored diff; the ladder's bookkeeping cannot leak into a post.
import {
  MAX_CANDIDATE_REGENERATIONS, REGENERATION_COOLDOWN_HOURS, isTopicAbandoned, selectNextTopic,
} from './recovery.mjs';
import { KIND_POLICIES, TRUSTED_PR_AUTHORS } from './constants.mjs';
import { github as defaultGithub, paged as defaultPaged } from './github.mjs';

export const CANDIDATE_STATE_LABEL = 'automation-state';
export const CANDIDATE_STATE_MARKER = 'automation-candidate-state';
export const CANDIDATE_STATE_VERSION = 1;
// A bounded ring of processed event keys is what makes every write idempotent: a
// rerun of the same workflow attempt replays the same key and changes nothing.
export const MAX_SEEN_EVENT_KEYS = 24;

const STATE_PATTERN = new RegExp(`<!--\\s*${CANDIDATE_STATE_MARKER}:(\\{[\\s\\S]*?\\})\\s*-->`);

export function isGeneratorKind(kind) {
  return typeof kind === 'string' && Object.hasOwn(KIND_POLICIES, kind) && kind !== 'promotion';
}

export function stateIssueTitle(kind) {
  return `automation-state: ${kind} candidate ladder`;
}

export function emptyTopicState() {
  return {
    regenerations: 0,
    lastFailureAt: null,
    abandoned: false,
    abandonedAt: null,
    reason: null,
  };
}

export function emptyCandidateState(kind) {
  return {
    version: CANDIDATE_STATE_VERSION,
    kind,
    regenerations: 0,
    lastFailureAt: null,
    lastReason: null,
    abandoned: false,
    topics: {},
    seen: [],
  };
}

export function recomputeCandidateRollups(state, { queue, kind, now } = {}) {
  const topics = state?.topics ?? {};
  const entries = Object.entries(topics);
  if (entries.length === 0) {
    return { ...state, topics: {} };
  }

  let regenSum = 0;
  for (const [, topic] of entries) {
    if (!isTopicAbandoned(topic, now)) {
      regenSum += Number.isInteger(topic.regenerations) ? topic.regenerations : 0;
    }
  }

  const scopedKind = kind ?? state.kind;
  const scoped = queue
    ? (Array.isArray(queue.topics) ? queue.topics : []).filter((entry) => entry?.kind === scopedKind)
    : null;
  let abandoned;
  if (scoped && scoped.length === 0) {
    abandoned = false;
  } else if (scoped) {
    const anyEligible = selectNextTopic(queue, { ...state, topics, kind: scopedKind }, now) !== null;
    const allAbandoned = scoped.every((entry) => isTopicAbandoned(topics[entry.key], now));
    abandoned = !anyEligible && allAbandoned;
  } else {
    abandoned = entries.length > 0 && entries.every(([, topic]) => isTopicAbandoned(topic, now));
  }

  return { ...state, topics, regenerations: regenSum, abandoned };
}

// Fail closed. An unreadable or out-of-range state block is never silently reset to
// zero — that would hand the topic a fresh budget every time the block got corrupted.
export function parseCandidateState(body, kind) {
  const errors = [];
  const match = STATE_PATTERN.exec(String(body ?? ''));
  if (!match) return { ok: false, state: null, errors: ['no candidate-state block found'] };
  let value = null;
  try { value = JSON.parse(match[1]); } catch { return { ok: false, state: null, errors: ['candidate-state block is not valid JSON'] }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push('candidate-state block must be an object');
  if (value?.version !== CANDIDATE_STATE_VERSION) errors.push(`unsupported candidate-state version: ${String(value?.version)}`);
  if (value?.kind !== kind) errors.push(`candidate-state block is for kind ${String(value?.kind)}, not ${kind}`);
  if (value?.lastFailureAt !== null && value?.lastFailureAt !== undefined && !Number.isFinite(Date.parse(String(value.lastFailureAt)))) {
    errors.push('candidate-state lastFailureAt is unreadable');
  }
  if (typeof value?.abandoned !== 'boolean') errors.push('candidate-state abandoned must be a boolean');
  if (!Array.isArray(value?.seen) || value.seen.some((key) => typeof key !== 'string')) errors.push('candidate-state seen must be a string array');

  const hasTopics = value?.topics && typeof value.topics === 'object' && !Array.isArray(value.topics);
  const topics = hasTopics ? value.topics : {};
  if (hasTopics) {
    for (const [key, topic] of Object.entries(topics)) {
      const regenerations = Number(topic?.regenerations);
      if (!Number.isInteger(regenerations) || regenerations < 0 || regenerations > MAX_CANDIDATE_REGENERATIONS) {
        errors.push(`topic ${key} regenerations out of range: ${String(topic?.regenerations)}`);
      }
    }
  } else {
    const regenerations = Number(value?.regenerations);
    if (!Number.isInteger(regenerations) || regenerations < 0 || regenerations > MAX_CANDIDATE_REGENERATIONS) {
      errors.push(`candidate-state regenerations out of range: ${String(value?.regenerations)}`);
    }
  }
  if (errors.length) return { ok: false, state: null, errors };

  const state = {
    version: CANDIDATE_STATE_VERSION,
    kind,
    regenerations: Number(value.regenerations) || 0,
    lastFailureAt: value.lastFailureAt ?? null,
    lastReason: typeof value.lastReason === 'string' ? value.lastReason : null,
    abandoned: value.abandoned,
    topics,
    seen: value.seen.slice(-MAX_SEEN_EVENT_KEYS),
  };
  return {
    ok: true,
    errors: [],
    state: recomputeCandidateRollups(state, { now: state.lastFailureAt ?? '2026-01-01T00:00:00.000Z' }),
  };
}

export function renderCandidateState(state) {
  const block = JSON.stringify({
    version: CANDIDATE_STATE_VERSION,
    kind: state.kind,
    regenerations: state.regenerations,
    lastFailureAt: state.lastFailureAt,
    lastReason: state.lastReason,
    abandoned: state.abandoned,
    topics: state.topics ?? {},
    seen: (state.seen ?? []).slice(-MAX_SEEN_EVENT_KEYS),
  });
  return [
    `<!-- ${CANDIDATE_STATE_MARKER}:${block} -->`,
    `## Bounded candidate ladder — \`${state.kind}\``, '',
    'Machine-written bookkeeping for the autonomous content loop. Do not edit by hand:',
    'the block above is trusted state and an unreadable block fails the next run closed.',
    '', '| Field | Value |', '| --- | --- |',
    `| Regenerations used | ${state.regenerations}/${MAX_CANDIDATE_REGENERATIONS} |`,
    `| Last failed candidate | ${state.lastFailureAt ?? 'never'} |`,
    `| Cooldown before the next candidate | ${REGENERATION_COOLDOWN_HOURS}h |`,
    `| Topic abandoned | ${state.abandoned ? '**yes — waiting on a human**' : 'no'} |`,
    `| Last reason | ${state.lastReason ?? 'n/a'} |`, '',
    state.abandoned
      ? 'Every bounded candidate for this topic failed. Nothing further will be generated for it until a human closes this issue or clears the state.'
      : 'The next scheduled run generates a fresh grounded candidate once the cooldown has elapsed.',
  ].join('\n');
}

// The one write path. `key` makes it idempotent: replaying the same event (a rerun
// of the same job attempt) is a no-op, so a rerun can never buy extra budget.
export function applyCandidateEvent(state, { key, action, at, reason, topicKey } = {}) {
  if (typeof key !== 'string' || key.trim().length === 0) throw new Error('candidate event requires a stable idempotency key');
  if (state.seen.includes(key)) return { state, changed: false, reason: 'event already recorded; state unchanged' };
  const stamp = typeof at === 'string' && Number.isFinite(Date.parse(at)) ? at : new Date(at ?? Date.now()).toISOString();
  const seen = [...(state.seen ?? []), key].slice(-MAX_SEEN_EVENT_KEYS);
  const topics = state.topics ?? {};

  if (!topicKey) {
    if (state.abandoned) return { state, changed: false, reason: 'topic is already abandoned; the ladder is closed' };
    if (action === 'abandon-topic') {
      return {
        state: { ...state, topics, abandoned: true, lastFailureAt: stamp, lastReason: reason ?? null, seen },
        changed: true,
        reason: 'topic abandoned',
      };
    }
    if (action !== 'close-and-regenerate') {
      return { state, changed: false, reason: `no ladder movement for action ${String(action)}` };
    }
    const regenerations = Math.min(state.regenerations + 1, MAX_CANDIDATE_REGENERATIONS);
    return {
      state: { ...state, topics, regenerations, lastFailureAt: stamp, lastReason: reason ?? null, seen },
      changed: true,
      reason: `regeneration ${regenerations}/${MAX_CANDIDATE_REGENERATIONS} recorded`,
    };
  }

  const current = topics[topicKey] ?? emptyTopicState();
  if (isTopicAbandoned(current, stamp)) {
    return { state, changed: false, reason: 'topic is already abandoned; the ladder is closed' };
  }

  if (action === 'abandon-topic') {
    const nextTopics = {
      ...topics,
      [topicKey]: {
        ...current,
        abandoned: true,
        abandonedAt: stamp,
        lastFailureAt: stamp,
        reason: reason ?? null,
      },
    };
    return {
      state: { ...state, topics: nextTopics, lastFailureAt: stamp, lastReason: reason ?? null, seen },
      changed: true,
      reason: 'topic abandoned',
    };
  }
  if (action !== 'close-and-regenerate') {
    return { state, changed: false, reason: `no ladder movement for action ${String(action)}` };
  }
  const regenerations = Math.min((current.regenerations ?? 0) + 1, MAX_CANDIDATE_REGENERATIONS);
  const nextTopics = {
    ...topics,
    [topicKey]: {
      ...current,
      regenerations,
      lastFailureAt: stamp,
      lastReason: reason ?? null,
      abandoned: false,
      abandonedAt: null,
      reason: reason ?? null,
    },
  };
  return {
    state: { ...state, topics: nextTopics, lastFailureAt: stamp, lastReason: reason ?? null, seen },
    changed: true,
    reason: `regeneration ${regenerations}/${MAX_CANDIDATE_REGENERATIONS} recorded`,
  };
}

function defaultApi() {
  return { github: defaultGithub, paged: defaultPaged };
}

// Exactly one controlled state issue per kind, authored by the trusted bot. Two of
// them, or one written by anybody else, is ambiguity — and ambiguity fails closed.
export async function findStateIssue(repo, kind, api = defaultApi()) {
  const issues = await api.paged(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent(CANDIDATE_STATE_LABEL)}`);
  const title = stateIssueTitle(kind);
  const matches = (Array.isArray(issues) ? issues : [])
    .filter((issue) => !issue?.pull_request && issue?.title === title);
  if (matches.length > 1) throw new Error(`multiple ${CANDIDATE_STATE_LABEL} issues for kind ${kind}: #${matches.map((issue) => issue.number).join(', #')}`);
  const issue = matches[0] ?? null;
  if (issue && !TRUSTED_PR_AUTHORS.includes(issue?.user?.login)) {
    throw new Error(`candidate state issue #${issue.number} was not opened by trusted automation (${issue?.user?.login})`);
  }
  return issue;
}

export async function loadCandidateState(repo, kind, api = defaultApi()) {
  if (!isGeneratorKind(kind)) throw new Error(`candidate state requires a generator kind: ${String(kind)}`);
  const issue = await findStateIssue(repo, kind, api);
  if (!issue) return { issue: null, state: emptyCandidateState(kind) };
  const parsed = parseCandidateState(issue.body, kind);
  if (!parsed.ok) throw new Error(`candidate state issue #${issue.number} is unreadable: ${parsed.errors.join('; ')}`);
  return { issue, state: parsed.state };
}

async function ensureStateLabel(repo, api) {
  try {
    await api.github(`/repos/${repo}/labels`, {
      method: 'POST',
      body: { name: CANDIDATE_STATE_LABEL, color: '5319e7', description: 'Controlled automation bookkeeping issue — machine-written' },
    });
  } catch (error) {
    if (!String(error.message).includes('(422)')) throw error;
  }
}

export async function saveCandidateState(repo, kind, state, { issue } = {}, api = defaultApi()) {
  const body = renderCandidateState(state);
  if (issue) {
    await api.github(`/repos/${repo}/issues/${issue.number}`, { method: 'PATCH', body: { body } });
    return issue;
  }
  await ensureStateLabel(repo, api);
  return api.github(`/repos/${repo}/issues`, {
    method: 'POST',
    body: { title: stateIssueTitle(kind), body, labels: [CANDIDATE_STATE_LABEL] },
  });
}

// Deduplicated exactly like the gate audit comment: one marker, one comment.
async function commentOnce(repo, issueNumber, marker, body, api) {
  const comments = await api.paged(`/repos/${repo}/issues/${issueNumber}/comments`);
  if (comments.some((comment) => comment?.body?.includes(marker))) return false;
  await api.github(`/repos/${repo}/issues/${issueNumber}/comments`, { method: 'POST', body: { body: `${marker}\n${body}` } });
  return true;
}

/**
 * Records one ladder movement durably and idempotently.
 * @returns { state, changed, issue, announced }
 */
export async function recordCandidateEvent(repo, kind, { key, action, at, reason, topicKey, queue } = {}, api = defaultApi()) {
  const { issue, state } = await loadCandidateState(repo, kind, api);
  const applied = applyCandidateEvent(state, { key, action, at, reason, topicKey });
  if (!applied.changed) return { ...applied, issue, announced: false };
  const rolled = recomputeCandidateRollups(applied.state, { queue, kind, now: at ?? applied.state.lastFailureAt });
  const topics = { ...(rolled.topics ?? {}) };
  for (const entry of queue?.topics ?? []) {
    if (!topics[entry.key]) continue;
    topics[entry.key] = {
      ...topics[entry.key],
      attempts: Number.isInteger(entry.attempts) ? entry.attempts : 0,
    };
  }
  const next = { ...rolled, topics };
  const saved = await saveCandidateState(repo, kind, next, { issue }, api);
  let announced = false;
  const topicAbandoned = topicKey ? next.topics?.[topicKey]?.abandoned === true : next.abandoned;
  if (topicAbandoned) {
    const markerKey = topicKey ? `${kind}:${topicKey}` : kind;
    announced = await commentOnce(
      repo, saved.number, `<!-- ${CANDIDATE_STATE_MARKER}-abandoned:${markerKey} -->`,
      [
        `## ABANDONED_TOPIC — \`${kind}\``, '',
        `- Regenerations used: ${(topicKey ? next.topics?.[topicKey]?.regenerations : next.regenerations) ?? 0}/${MAX_CANDIDATE_REGENERATIONS}`,
        `- Reason: ${reason ?? 'every bounded candidate for this topic failed'}`, '',
        'No further candidate will be generated for this topic. The gate was never lowered and',
        'no rejected draft was published; the loop simply ran out of its bounded budget.',
      ].join('\n'),
      api,
    );
  }
  return { ...applied, state: next, issue: saved, announced };
}
