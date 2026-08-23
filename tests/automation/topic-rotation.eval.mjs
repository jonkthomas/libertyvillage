#!/usr/bin/env node
// =============================================================================
// EVALUATOR-OWNED LOCKED EVAL — topical rotation on abandonment.
//
// Authored by the independent eval/spec author. The builder MUST NOT edit,
// weaken, delete, re-scope, or skip any assertion in this file. Any change to
// this file by the builder is an automatic FAIL. Maker != checker.
//
// Contract: /tmp/lv-topical-rotation-prd.md (copied into the fixture
//           expectation strings; production code is not modified by this eval)
// Lock:     evals/topic-rotation.sha256
//
// Run (offline, deterministic, zero model spend, no secrets, no network):
//   node --test tests/automation/topic-rotation.eval.mjs
//   (also invoked by the ordinary `npm run test:automation` CI command)
//
// This eval is the I/O contract the builder must satisfy. Until
// `scripts/automation/topic-queue.mjs` exists, each test executes the locked
// spec engine below. Once that module lands, the SAME eight tests bind to
// production exports and fail closed on any drift from the frozen fixtures.
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  CANDIDATE_STATE_LABEL,
  CANDIDATE_STATE_MARKER,
  CANDIDATE_STATE_VERSION,
  MAX_SEEN_EVENT_KEYS,
  parseCandidateState as productionParseCandidateState,
  stateIssueTitle,
} from '../../scripts/automation/candidate-state.mjs';
import { MAX_CANDIDATE_REGENERATIONS, REGENERATION_COOLDOWN_HOURS } from '../../scripts/automation/recovery.mjs';

const ROOT = new URL('../../', import.meta.url);
const FIXTURES = new URL('./fixtures/topic-rotation/', import.meta.url);
const TOPIC_QUEUE_REL = 'scripts/automation/topic-queue.mjs';

const HOUR_MS = 60 * 60 * 1000;
export const MAX_QUEUE_ATTEMPTS = 3;
export const ABANDONMENT_EXPIRY_DAYS = 30;
const ABANDON_REASON = `every bounded candidate failed (${MAX_CANDIDATE_REGENERATIONS}/${MAX_CANDIDATE_REGENERATIONS} regenerations); escalating once to a human`;

const readJson = (name) => JSON.parse(fs.readFileSync(new URL(name, FIXTURES), 'utf8'));
const repoFileExists = (rel) => fs.existsSync(new URL(rel, ROOT));
const iso = (now) => (now instanceof Date ? now.toISOString() : String(now));
const nowMs = (now) => {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  return Date.parse(String(now));
};

function hashLowerHex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeTitle(title) {
  return String(title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeBranchPrefix(prefix) {
  return String(prefix ?? '').trim().toLowerCase();
}

// topicKey = hashLowerHex(`${kind}|${normalizedTitle}|${normalizedBranchPrefix}`)
export function topicKey(kind, title, branchPrefix) {
  return hashLowerHex(`${kind}|${normalizeTitle(title)}|${normalizeBranchPrefix(branchPrefix)}`);
}

function hoursSince(timestamp, now) {
  const then = Date.parse(timestamp ?? '');
  const ms = nowMs(now);
  if (!Number.isFinite(then) || !Number.isFinite(ms)) return null;
  return (ms - then) / HOUR_MS;
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

function emptyCandidateState(kind) {
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

function isExpired(topicState, now) {
  if (!topicState?.abandoned) return false;
  if (!topicState.abandonedAt) return false;
  const age = nowMs(now) - Date.parse(topicState.abandonedAt);
  if (!Number.isFinite(age)) return false;
  return age >= ABANDONMENT_EXPIRY_DAYS * 24 * HOUR_MS;
}

function isEffectivelyAbandoned(topicState, now) {
  return topicState?.abandoned === true && !isExpired(topicState, now);
}

function clone(value) {
  return structuredClone(value);
}

function kindQueue(queue, kind) {
  return (Array.isArray(queue?.topics) ? queue.topics : []).filter((entry) => entry?.kind === kind);
}

function topicOf(state, key) {
  return state?.topics?.[key] ?? emptyTopicState();
}

function queueEntry(queue, key) {
  return (queue?.topics ?? []).find((entry) => entry.key === key) ?? null;
}

function applyExpiry(state, queue, now) {
  const nextState = clone(state);
  const nextQueue = clone(queue);
  nextState.topics = { ...(nextState.topics ?? {}) };
  for (const [key, topic] of Object.entries(nextState.topics)) {
    if (!isExpired(topic, now)) continue;
    nextState.topics[key] = {
      ...emptyTopicState(),
      lastReason: topic.reason ?? topic.lastReason ?? null,
    };
    if (Array.isArray(nextQueue?.topics)) {
      nextQueue.topics = nextQueue.topics.map((entry) => (
        entry.key === key ? { ...entry, attempts: 0 } : entry
      ));
    }
  }
  return { state: nextState, queue: nextQueue };
}

function recomputeRollups(state, { queue, kind, now } = {}) {
  const topics = state.topics ?? {};
  const entries = Object.entries(topics);
  if (entries.length === 0) {
    return { ...state, topics: {} };
  }

  let regenSum = 0;
  for (const [, topic] of entries) {
    if (!isEffectivelyAbandoned(topic, now)) {
      regenSum += Number.isInteger(topic.regenerations) ? topic.regenerations : 0;
    }
  }

  const scoped = queue ? kindQueue(queue, kind ?? state.kind) : null;
  let abandoned;
  if (scoped && scoped.length === 0) {
    abandoned = false;
  } else if (scoped) {
    const anyEligible = selectEligibleTopic({ queue, state: { ...state, topics }, kind: kind ?? state.kind, now }) !== null;
    const allAbandoned = scoped.every((entry) => isEffectivelyAbandoned(topics[entry.key], now));
    abandoned = !anyEligible && allAbandoned;
  } else {
    abandoned = entries.length > 0 && entries.every(([, topic]) => isEffectivelyAbandoned(topic, now));
  }

  return { ...state, topics, regenerations: regenSum, abandoned };
}

export function selectEligibleTopic({ queue, state, kind, now }) {
  const list = kindQueue(queue, kind);
  const eligible = [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    const topic = topicOf(state, entry.key);
    if (isEffectivelyAbandoned(topic, now)) continue;
    const attempts = isExpired(topic, now) ? 0 : (Number.isInteger(entry.attempts) ? entry.attempts : 0);
    if (attempts > MAX_QUEUE_ATTEMPTS) continue;
    eligible.push({ entry, attempts, index });
  }
  eligible.sort((left, right) => left.attempts - right.attempts || left.index - right.index);
  return eligible[0]?.entry ?? null;
}

export function applyTopicEvent(state, { key, action, at, reason, topicKey: topic } = {}) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('candidate event requires a stable idempotency key');
  }
  if (state.seen.includes(key)) {
    return { state, changed: false, reason: 'event already recorded; state unchanged' };
  }
  const stamp = typeof at === 'string' && Number.isFinite(Date.parse(at)) ? at : new Date(at ?? Date.now()).toISOString();
  const seen = [...state.seen, key].slice(-MAX_SEEN_EVENT_KEYS);

  if (!topic) {
    if (state.abandoned) return { state, changed: false, reason: 'topic is already abandoned; the ladder is closed' };
    if (action === 'abandon-topic') {
      return {
        state: { ...state, abandoned: true, lastFailureAt: stamp, lastReason: reason ?? null, seen },
        changed: true,
        reason: 'topic abandoned',
      };
    }
    if (action !== 'close-and-regenerate') {
      return { state, changed: false, reason: `no ladder movement for action ${String(action)}` };
    }
    const regenerations = Math.min(state.regenerations + 1, MAX_CANDIDATE_REGENERATIONS);
    return {
      state: { ...state, regenerations, lastFailureAt: stamp, lastReason: reason ?? null, seen },
      changed: true,
      reason: `regeneration ${regenerations}/${MAX_CANDIDATE_REGENERATIONS} recorded`,
    };
  }

  const current = topicOf(state, topic);
  if (isEffectivelyAbandoned(current, stamp)) {
    return { state, changed: false, reason: 'topic is already abandoned; the ladder is closed' };
  }

  if (action === 'abandon-topic') {
    const topics = {
      ...state.topics,
      [topic]: {
        ...current,
        abandoned: true,
        abandonedAt: stamp,
        lastFailureAt: stamp,
        reason: reason ?? null,
      },
    };
    return {
      state: { ...state, topics, lastFailureAt: stamp, lastReason: reason ?? null, seen },
      changed: true,
      reason: 'topic abandoned',
    };
  }
  if (action !== 'close-and-regenerate') {
    return { state, changed: false, reason: `no ladder movement for action ${String(action)}` };
  }
  const regenerations = Math.min((current.regenerations ?? 0) + 1, MAX_CANDIDATE_REGENERATIONS);
  const topics = {
    ...state.topics,
    [topic]: {
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
    state: { ...state, topics, lastFailureAt: stamp, lastReason: reason ?? null, seen },
    changed: true,
    reason: `regeneration ${regenerations}/${MAX_CANDIDATE_REGENERATIONS} recorded`,
  };
}

function incrementAttempts(queue, key) {
  if (!queue || !Array.isArray(queue.topics)) return queue;
  return {
    ...queue,
    topics: queue.topics.map((entry) => (
      entry.key === key ? { ...entry, attempts: (Number.isInteger(entry.attempts) ? entry.attempts : 0) + 1 } : entry
    )),
  };
}

export function recordTopicFailure({ queue, state, kind, now, key, topicKey: topic, reason } = {}) {
  const stamp = iso(now);
  const current = topicOf(state, topic);
  const spent = Number.isInteger(current.regenerations) ? current.regenerations : 0;
  const action = spent >= MAX_CANDIDATE_REGENERATIONS ? 'abandon-topic' : 'close-and-regenerate';
  const applied = applyTopicEvent(state, { key, action, at: stamp, reason, topicKey: topic });
  const nextQueue = applied.changed ? incrementAttempts(queue, topic) : queue;
  const rolled = recomputeRollups(applied.state, { queue: nextQueue, kind, now: stamp });
  const nextTopic = topicOf(rolled, topic);
  return {
    action,
    recorded: applied.changed,
    generate: false,
    topicKey: topic,
    regenerations: nextTopic.regenerations,
    reason: applied.reason,
    state: rolled,
    queue: nextQueue,
  };
}

export function planTopicCandidate({ queue, state, kind, now } = {}) {
  const migrated = {
    ...emptyCandidateState(kind),
    ...state,
    kind,
    topics: state?.topics ?? {},
    seen: Array.isArray(state?.seen) ? state.seen : [],
  };
  const expired = applyExpiry(migrated, queue, now);
  const rolled = recomputeRollups(expired.state, { queue: expired.queue, kind, now });
  const selected = selectEligibleTopic({ queue: expired.queue, state: rolled, kind, now });

  if (!selected) {
    const scoped = kindQueue(expired.queue, kind);
    return {
      action: 'wait',
      reason: 'no eligible topics',
      generate: false,
      topicKey: null,
      regenerations: rolled.regenerations,
      state: { ...rolled, abandoned: scoped.length === 0 ? false : rolled.abandoned },
      queue: expired.queue,
    };
  }

  const topic = topicOf(rolled, selected.key);
  if (topic.regenerations >= MAX_CANDIDATE_REGENERATIONS) {
    const stamp = iso(now);
    const key = `${kind}:ladder:${selected.key}:${topic.regenerations}:abandon-topic`;
    const applied = applyTopicEvent(rolled, { key, action: 'abandon-topic', at: stamp, reason: ABANDON_REASON, topicKey: selected.key });
    const next = recomputeRollups(applied.state, { queue: expired.queue, kind, now: stamp });
    return {
      action: 'abandon-topic',
      reason: ABANDON_REASON,
      generate: false,
      topicKey: selected.key,
      regenerations: topic.regenerations,
      state: next,
      queue: expired.queue,
    };
  }

  if (topic.lastFailureAt) {
    const idle = hoursSince(topic.lastFailureAt, now);
    if (idle === null) {
      return {
        action: 'wait',
        reason: 'blocked-at timestamp is unreadable; waiting rather than regenerating',
        generate: false,
        topicKey: selected.key,
        regenerations: topic.regenerations,
        state: rolled,
        queue: expired.queue,
      };
    }
    if (idle < REGENERATION_COOLDOWN_HOURS) {
      return {
        action: 'wait',
        reason: `cooling down: ${idle.toFixed(1)}h of ${REGENERATION_COOLDOWN_HOURS}h elapsed`,
        generate: false,
        topicKey: selected.key,
        regenerations: topic.regenerations,
        state: rolled,
        queue: expired.queue,
      };
    }
    return {
      action: 'generate',
      reason: `cooldown elapsed after a discarded ${kind} candidate; generating regeneration ${topic.regenerations}/${MAX_CANDIDATE_REGENERATIONS}`,
      generate: true,
      topicKey: selected.key,
      regenerations: topic.regenerations,
      state: rolled,
      queue: expired.queue,
    };
  }

  return {
    action: 'generate',
    reason: 'no candidate is in flight',
    generate: true,
    topicKey: selected.key,
    regenerations: topic.regenerations,
    state: rolled,
    queue: expired.queue,
  };
}

const STATE_PATTERN = new RegExp(`<!--\\s*${CANDIDATE_STATE_MARKER}:(\\{[\\s\\S]*?\\})\\s*-->`);

export function parseTopicalState(body, kind) {
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
    topics: hasTopics ? topics : {},
    seen: value.seen.slice(-MAX_SEEN_EVENT_KEYS),
  };
  return { ok: true, errors: [], state: recomputeRollups(state, { now: state.lastFailureAt ?? '2026-01-01T00:00:00.000Z' }) };
}

export function renderTopicalState(state) {
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
  return `<!-- ${CANDIDATE_STATE_MARKER}:${block} -->\n## Bounded candidate ladder — \`${state.kind}\`\n`;
}

const SPEC = {
  MAX_QUEUE_ATTEMPTS,
  ABANDONMENT_EXPIRY_DAYS,
  topicKey,
  selectEligibleTopic,
  planTopicCandidate,
  recordTopicFailure,
  applyTopicEvent,
  parseTopicalState,
  renderTopicalState,
};

async function loadImpl() {
  if (!repoFileExists(TOPIC_QUEUE_REL)) return { production: false, ...SPEC };
  const mod = await import(new URL(TOPIC_QUEUE_REL, ROOT).href);
  const required = ['topicKey', 'selectEligibleTopic', 'planTopicCandidate', 'recordTopicFailure'];
  for (const name of required) {
    if (typeof mod[name] !== 'function') {
      throw new Error(`NOT IMPLEMENTED: ${TOPIC_QUEUE_REL} must export ${name}`);
    }
  }
  if (mod.MAX_QUEUE_ATTEMPTS !== MAX_QUEUE_ATTEMPTS) {
    throw new Error(`MAX_QUEUE_ATTEMPTS must remain ${MAX_QUEUE_ATTEMPTS}`);
  }
  if (mod.ABANDONMENT_EXPIRY_DAYS !== ABANDONMENT_EXPIRY_DAYS) {
    throw new Error(`ABANDONMENT_EXPIRY_DAYS must remain ${ABANDONMENT_EXPIRY_DAYS}`);
  }
  return {
    production: true,
    ...SPEC,
    ...mod,
    parseTopicalState: typeof mod.parseTopicalState === 'function' ? mod.parseTopicalState : parseTopicalState,
    renderTopicalState: typeof mod.renderTopicalState === 'function' ? mod.renderTopicalState : renderTopicalState,
  };
}

function summarize(out, queue, topicKeyOverride) {
  const key = topicKeyOverride !== undefined ? topicKeyOverride : out.topicKey;
  const topic = key ? topicOf(out.state, key) : emptyTopicState();
  const entry = key ? queueEntry(out.queue ?? queue, key) : null;
  return {
    action: out.action,
    reason: out.reason,
    generate: out.generate === true,
    recorded: out.recorded,
    topicKey: key ?? null,
    regenerations: out.regenerations,
    topicRegenerations: topic.regenerations ?? 0,
    topicAbandoned: topic.abandoned === true,
    topicAbandonedAt: topic.abandonedAt ?? null,
    rollupRegenerations: out.state.regenerations,
    rollupAbandoned: out.state.abandoned === true,
    queueAttempts: entry ? (Number.isInteger(entry.attempts) ? entry.attempts : 0) : null,
    seenCount: Array.isArray(out.state?.seen) ? out.state.seen.length : 0,
  };
}

function pickExpected(actual, expected) {
  const out = {};
  for (const key of Object.keys(expected)) out[key] = actual[key];
  return out;
}

function runTrace(impl, fixture) {
  let state = clone(fixture.initialState);
  let queue = clone(fixture.queue);
  const got = [];
  for (const step of fixture.steps) {
    if (step.op === 'plan') {
      const out = impl.planTopicCandidate({ queue, state, kind: fixture.kind, now: step.now });
      state = out.state;
      queue = out.queue ?? queue;
      got.push(summarize(out, queue, out.topicKey));
    } else if (step.op === 'fail') {
      const out = impl.recordTopicFailure({
        queue, state, kind: fixture.kind, now: step.now,
        key: step.key, topicKey: step.topicKey, reason: step.reason,
      });
      state = out.state;
      queue = out.queue ?? queue;
      got.push(summarize(out, queue, step.topicKey));
    } else {
      throw new Error(`unknown fixture op ${step.op}`);
    }
  }
  return { state, queue, got };
}

function assertTrace(impl, fixture) {
  const { got, state, queue } = runTrace(impl, fixture);
  assert.equal(got.length, fixture.expected.length, `${fixture.id}: step count`);
  for (let index = 0; index < fixture.expected.length; index += 1) {
    assert.deepEqual(
      pickExpected(got[index], fixture.expected[index]),
      fixture.expected[index],
      `${fixture.id} step ${index}: ${fixture.steps[index].op}`,
    );
  }
  return { got, state, queue };
}

// -----------------------------------------------------------------------------
// 1. Single topic A: T+1h wait -> T+24h+1m regenerate -> T+48h+1m abandon
// -----------------------------------------------------------------------------
test('1. single topic A: T+1h wait, T+24h+1m regenerate, T+48h+1m abandon', async () => {
  const impl = await loadImpl();
  const fixture = readJson('01-single-topic-abandonment.json');
  assert.equal(
    impl.topicKey(fixture.kind, fixture.title, fixture.branchPrefix),
    fixture.topicKey,
    'same candidate must hash to the same topicKey',
  );
  assert.equal(
    impl.topicKey(fixture.kind, `  ${fixture.title}  `, 'Blog/Auto-'),
    fixture.topicKey,
    'normalization must be stable across regenerations',
  );
  assert.notEqual(
    impl.topicKey('seo', fixture.title, 'seo/auto-'),
    fixture.topicKey,
    'different kind must hash differently',
  );

  const { got, state } = assertTrace(impl, fixture);

  assert.equal(got[0].action, 'generate');
  assert.equal(got[0].generate, true);
  assert.equal(got[0].regenerations, 0);

  assert.equal(got[2].action, 'wait');
  assert.equal(got[2].generate, false);
  assert.match(got[2].reason, /cooling down: 1\.0h of 24h elapsed/);

  assert.equal(got[3].action, 'generate');
  assert.equal(got[3].generate, true);
  assert.equal(got[3].topicRegenerations, 1, 'T+24h+1m regenerate has topic regenerations 1');

  assert.equal(got[5].action, 'abandon-topic');
  assert.equal(got[5].generate, false);
  assert.equal(got[5].topicRegenerations, 2, 'T+48h+1m abandon-topic has topic regenerations 2');
  assert.equal(got[5].topicAbandoned, true);
  assert.equal(got[5].topicAbandonedAt, fixture.t48h1m);
  assert.equal(got[5].rollupAbandoned, true, 'rollup abandoned=true only because the single topic is exhausted');
  assert.equal(state.topics[fixture.topicKey].abandoned, true);
  assert.equal(state.topics[fixture.topicKey].abandonedAt, fixture.t48h1m);
});

// -----------------------------------------------------------------------------
// 2. Multi-topic rotation: abandoned A does not halt the kind; B generates
// -----------------------------------------------------------------------------
test('2. multi-topic rotation: abandoned A yields generate with topicKey=B', async () => {
  const impl = await loadImpl();
  const fixture = readJson('02-multi-topic-rotation.json');
  assert.equal(impl.topicKey(fixture.kind, fixture.titleB, fixture.branchPrefix), fixture.topicKeyB);
  assert.notEqual(fixture.topicKeyA, fixture.topicKeyB);

  const { got, state } = assertTrace(impl, fixture);
  assert.equal(got[0].action, 'generate');
  assert.equal(got[0].generate, true);
  assert.equal(got[0].topicKey, fixture.topicKeyB);
  assert.equal(got[0].topicRegenerations, 0, 'B has regenerations=0');
  assert.equal(got[0].regenerations, 0);
  assert.equal(got[0].rollupAbandoned, false, 'lane must keep running while B is eligible');
  assert.equal(state.topics[fixture.topicKeyA].abandoned, true);
  assert.equal(topicOf(state, fixture.topicKeyB).regenerations, 0);
});

// -----------------------------------------------------------------------------
// 3. Empty queue: wait, do not mark abandoned
// -----------------------------------------------------------------------------
test('3. empty queue returns wait and does not mark abandoned', async () => {
  const impl = await loadImpl();
  const fixture = readJson('03-empty-queue.json');
  const { got, state } = assertTrace(impl, fixture);
  assert.equal(got[0].action, 'wait');
  assert.equal(got[0].reason, 'no eligible topics');
  assert.equal(got[0].generate, false);
  assert.equal(got[0].topicKey, null);
  assert.equal(got[0].rollupAbandoned, false);
  assert.equal(state.abandoned, false, 'empty queue must not mark abandoned');
  assert.deepEqual(state.topics, {});
});

// -----------------------------------------------------------------------------
// 4. Abandonment expiry: 30 days + 1 minute restores eligibility and resets attempts
// -----------------------------------------------------------------------------
test('4. abandoned topic older than 30 days becomes eligible and attempts reset', async () => {
  const impl = await loadImpl();
  const fixture = readJson('04-abandon-expiry.json');
  const ageMs = Date.parse(fixture.now) - Date.parse(fixture.abandonedAt);
  assert.ok(ageMs > ABANDONMENT_EXPIRY_DAYS * 24 * HOUR_MS, 'fixture must be strictly older than 30 days');

  const { got, state, queue } = assertTrace(impl, fixture);
  assert.equal(got[0].action, 'generate');
  assert.equal(got[0].generate, true);
  assert.equal(got[0].topicKey, fixture.topicKey);
  assert.equal(got[0].topicAbandoned, false);
  assert.equal(got[0].topicRegenerations, 0);
  assert.equal(got[0].queueAttempts, 0, 'attempts reset on expiry');
  assert.equal(got[0].rollupAbandoned, false);
  assert.equal(state.topics[fixture.topicKey].abandoned, false);
  assert.equal(queue.topics[0].attempts, 0);
});

// -----------------------------------------------------------------------------
// 5. Selection ordering: lowest attempts, skip abandoned unless expired, cap 3
// -----------------------------------------------------------------------------
test('5. selection: lowest attempts first, abandoned skipped unless expired, cap 3', async () => {
  const impl = await loadImpl();
  const fixture = readJson('05-selection-ordering.json');
  const expired = applyExpiry(clone(fixture.initialState), clone(fixture.queue), fixture.now);
  const selected = impl.selectEligibleTopic({
    queue: expired.queue,
    state: expired.state,
    kind: fixture.kind,
    now: fixture.now,
  });
  assert.equal(selected?.key, 'k-fresh');

  const order = [];
  const workingQueue = clone(expired.queue);
  const workingState = clone(expired.state);
  for (const key of ['k-fresh', 'k-expired', 'k-mid']) {
    const pick = impl.selectEligibleTopic({
      queue: workingQueue,
      state: workingState,
      kind: fixture.kind,
      now: fixture.now,
    });
    order.push(pick?.key ?? null);
    workingQueue.topics = workingQueue.topics.map((entry) => (
      entry.key === pick?.key ? { ...entry, attempts: MAX_QUEUE_ATTEMPTS + 1 } : entry
    ));
  }
  assert.deepEqual(order, fixture.eligibleInOrder);

  const { got } = assertTrace(impl, fixture);
  assert.equal(got[0].topicKey, 'k-fresh');
  assert.equal(got[0].action, 'generate');
  assert.equal(got[0].generate, true);

  for (const skipped of fixture.skipped) {
    assert.notEqual(got[0].topicKey, skipped, `${skipped} must not be selected`);
  }
  const capEntry = fixture.queue.topics.find((entry) => entry.key === 'k-cap');
  assert.ok(capEntry.attempts > MAX_QUEUE_ATTEMPTS);
});

// -----------------------------------------------------------------------------
// 6. Backward compatible parse of legacy state without a topics block
// -----------------------------------------------------------------------------
test('6. backward compatible parse of legacy state without topics', async () => {
  const impl = await loadImpl();
  const fixture = readJson('06-legacy-compat.json');

  const production = productionParseCandidateState(fixture.body, fixture.kind);
  assert.equal(production.ok, true, `production parse must not crash: ${production.errors?.join('; ')}`);
  assert.equal(production.state.regenerations, 1);
  assert.equal(production.state.abandoned, false);
  assert.equal(production.state.lastFailureAt, fixture.expected.state.lastFailureAt);
  assert.deepEqual(production.state.seen, fixture.expected.state.seen);

  const parsed = impl.parseTopicalState(fixture.body, fixture.kind);
  assert.equal(parsed.ok, true, `topical parse must not crash: ${parsed.errors?.join('; ')}`);
  assert.deepEqual(parsed.state, fixture.expected.state);
  assert.deepEqual(parsed.state.topics, {}, 'missing topics defaults to {}');
  assert.equal(parsed.state.regenerations, 1, 'legacy regenerations rollup is preserved');
  assert.equal(parsed.state.abandoned, false, 'legacy abandoned rollup is preserved');
});

// -----------------------------------------------------------------------------
// 7. One durable ladder issue per kind, with per-topic entries inside
// -----------------------------------------------------------------------------
test('7. topical-state remains one issue per kind', async () => {
  const impl = await loadImpl();
  const fixture = readJson('07-one-issue-per-kind.json');

  assert.equal(stateIssueTitle('blog'), fixture.issueTitleBlog);
  assert.equal(stateIssueTitle('seo'), fixture.issueTitleSeo);
  assert.notEqual(stateIssueTitle('blog'), stateIssueTitle('seo'));
  assert.equal(CANDIDATE_STATE_LABEL, fixture.label);
  assert.equal(CANDIDATE_STATE_MARKER, fixture.marker);

  const rendered = impl.renderTopicalState(fixture.state);
  const markers = rendered.match(new RegExp(`<!--\\s*${CANDIDATE_STATE_MARKER}:`, 'g')) || [];
  assert.equal(markers.length, 1, 'exactly one durable state block per kind');
  assert.equal(Object.keys(fixture.state.topics).sort().join(','), [fixture.topicKeyA, fixture.topicKeyB].sort().join(','));

  const roundTrip = impl.parseTopicalState(rendered, 'blog');
  assert.equal(roundTrip.ok, true, roundTrip.errors?.join('; '));
  assert.equal(roundTrip.state.kind, 'blog');
  assert.equal(roundTrip.state.topics[fixture.topicKeyA].abandoned, true);
  assert.equal(roundTrip.state.topics[fixture.topicKeyB].abandoned, false);
  assert.equal(roundTrip.state.abandoned, false, 'B still eligible so the kind rollup is not abandoned');
});

// -----------------------------------------------------------------------------
// 8. Idempotent replay of the same key/cycle does not double-spend
// -----------------------------------------------------------------------------
test('8. idempotent replay of the same key/cycle does not double-spend', async () => {
  const impl = await loadImpl();
  const fixture = readJson('08-idempotency.json');
  const { got, state } = assertTrace(impl, fixture);

  assert.equal(got[0].recorded, true);
  assert.equal(got[0].topicRegenerations, 1);
  assert.equal(got[1].recorded, false, 'replay of blog:cycle-1 must not spend a second regeneration');
  assert.equal(got[1].topicRegenerations, 1);
  assert.equal(got[1].queueAttempts, 1);
  assert.equal(got[1].seenCount, 1);
  assert.equal(state.seen.filter((key) => key === 'blog:cycle-1').length, 1);

  assert.equal(got[3].action, 'abandon-topic');
  assert.equal(got[3].seenCount, 3);
  assert.equal(got[4].action, 'wait');
  assert.equal(got[4].reason, 'no eligible topics');
  assert.equal(got[4].generate, false);
  assert.equal(got[4].seenCount, 3, 'replaying the abandon cycle must not append another seen key');
  assert.equal(state.topics[fixture.topicKey].abandoned, true);
});

