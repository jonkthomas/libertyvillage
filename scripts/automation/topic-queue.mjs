#!/usr/bin/env node
// Topic queue + per-topic candidate planner for the autonomous content loop.
//
// Abandonment is a property of a topic, not of the blog/seo lane. The durable
// ladder issue stays one-per-kind; the topics{} block inside it is what rotates.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  emptyCandidateState,
  emptyTopicState,
  parseCandidateState,
  recomputeCandidateRollups,
  renderCandidateState,
  applyCandidateEvent,
} from './candidate-state.mjs';
import {
  ABANDON_EXPIRY_DAYS,
  MAX_CANDIDATE_REGENERATIONS,
  MAX_QUEUE_ATTEMPTS as RECOVERY_MAX_QUEUE_ATTEMPTS,
  REGENERATION_COOLDOWN_HOURS,
  expireAbandonedTopics,
  isTopicAbandoned,
  selectNextTopic,
} from './recovery.mjs';
import { writeOutput } from './github.mjs';
import { KIND_POLICIES } from './constants.mjs';

export const MAX_QUEUE_ATTEMPTS = RECOVERY_MAX_QUEUE_ATTEMPTS;
export const ABANDONMENT_EXPIRY_DAYS = ABANDON_EXPIRY_DAYS;
export const TOPIC_QUEUE_VERSION = 1;

const HOUR_MS = 60 * 60 * 1000;
const ABANDON_REASON = `every bounded candidate failed (${MAX_CANDIDATE_REGENERATIONS}/${MAX_CANDIDATE_REGENERATIONS} regenerations); escalating once to a human`;
const DEFAULT_QUEUE_REL = 'data/topic-queue.json';

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

export function topicKey(kind, title, branchPrefix) {
  return hashLowerHex(`${kind}|${normalizeTitle(title)}|${normalizeBranchPrefix(branchPrefix)}`);
}

function defaultBranchPrefix(kind) {
  const prefixes = KIND_POLICIES[kind]?.headPrefixes;
  return Array.isArray(prefixes) && prefixes[0] ? prefixes[0] : `${kind}/auto-`;
}

function hoursSince(timestamp, now) {
  const then = Date.parse(timestamp ?? '');
  const ms = nowMs(now);
  if (!Number.isFinite(then) || !Number.isFinite(ms)) return null;
  return (ms - then) / HOUR_MS;
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

function emptyQueue() {
  return { version: TOPIC_QUEUE_VERSION, topics: [] };
}

export function queuePath() {
  if (process.env.TOPIC_QUEUE_PATH) return path.resolve(process.env.TOPIC_QUEUE_PATH);
  return path.resolve(process.cwd(), DEFAULT_QUEUE_REL);
}

export function loadTopicQueue(filePath = queuePath()) {
  try {
    if (!fs.existsSync(filePath)) return emptyQueue();
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyQueue();
    const topics = Array.isArray(value.topics) ? value.topics.filter((entry) => entry && typeof entry === 'object') : [];
    return { version: TOPIC_QUEUE_VERSION, topics };
  } catch {
    return emptyQueue();
  }
}

export function saveTopicQueue(queue, filePath = queuePath()) {
  const next = {
    version: TOPIC_QUEUE_VERSION,
    topics: Array.isArray(queue?.topics) ? queue.topics : [],
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function appendTopic(queue, { kind, title, source, rationale, addedAt, branchPrefix, attempts = 0 } = {}) {
  if (!kind || !title) return { queue, added: false, reason: 'kind and title are required' };
  const key = topicKey(kind, title, branchPrefix ?? defaultBranchPrefix(kind));
  const current = Array.isArray(queue?.topics) ? queue.topics : [];
  if (current.some((entry) => entry.key === key)) {
    return { queue: queue ?? emptyQueue(), added: false, key, reason: 'topic already queued' };
  }
  const entry = {
    key,
    kind,
    title: String(title).trim(),
    source: source ?? 'implicit-discovery',
    rationale: rationale ?? '',
    addedAt: addedAt ?? new Date().toISOString(),
    attempts: Number.isInteger(attempts) ? attempts : 0,
    branchPrefix: branchPrefix ?? defaultBranchPrefix(kind),
  };
  return { queue: { version: TOPIC_QUEUE_VERSION, topics: [...current, entry] }, added: true, key, entry };
}

export function selectEligibleTopic({ queue, state, kind, now } = {}) {
  return selectNextTopic(queue, { ...state, kind: kind ?? state?.kind }, now);
}

function applyExpiry(state, queue, now) {
  const nextState = expireAbandonedTopics(clone(state), now);
  const nextQueue = clone(queue);
  if (Array.isArray(nextQueue?.topics)) {
    nextQueue.topics = nextQueue.topics.map((entry) => {
      const before = state?.topics?.[entry.key];
      const after = nextState.topics?.[entry.key];
      if (before?.abandoned && after && !after.abandoned) return { ...entry, attempts: 0 };
      return entry;
    });
  }
  return { state: nextState, queue: nextQueue };
}

function mirrorLegacyTopic(state, queue, kind, now) {
  if (Object.keys(state.topics ?? {}).length > 0) return state;
  if (!state.regenerations && !state.lastFailureAt && !state.abandoned) return state;
  const selected = selectEligibleTopic({ queue, state: { ...state, topics: {} }, kind, now });
  if (!selected) return state;
  return {
    ...state,
    topics: {
      [selected.key]: {
        regenerations: Number.isInteger(state.regenerations) ? state.regenerations : 0,
        lastFailureAt: state.lastFailureAt ?? null,
        abandoned: state.abandoned === true,
        abandonedAt: state.abandoned ? (state.lastFailureAt ?? iso(now)) : null,
        reason: state.lastReason ?? null,
      },
    },
  };
}

export function hydrateQueue(queue, state) {
  const topics = state?.topics ?? {};
  return {
    version: TOPIC_QUEUE_VERSION,
    topics: (Array.isArray(queue?.topics) ? queue.topics : []).map((entry) => {
      const topic = topics[entry.key];
      if (!topic || !Number.isInteger(topic.attempts)) return entry;
      return { ...entry, attempts: topic.attempts };
    }),
  };
}

function persistAttempts(state, queue) {
  const topics = { ...(state.topics ?? {}) };
  for (const entry of queue?.topics ?? []) {
    if (!topics[entry.key]) continue;
    topics[entry.key] = { ...topics[entry.key], attempts: Number.isInteger(entry.attempts) ? entry.attempts : 0 };
  }
  return { ...state, topics };
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

export function applyTopicEvent(state, { key, action, at, reason, topicKey: topic } = {}) {
  return applyCandidateEvent(state, { key, action, at, reason, topicKey: topic });
}

export function recordTopicFailure({ queue, state, kind, now, key, topicKey: topic, reason } = {}) {
  const stamp = iso(now);
  const current = topicOf(state, topic);
  const spent = Number.isInteger(current.regenerations) ? current.regenerations : 0;
  const action = spent >= MAX_CANDIDATE_REGENERATIONS ? 'abandon-topic' : 'close-and-regenerate';
  const applied = applyTopicEvent(state, { key, action, at: stamp, reason, topicKey: topic });
  const nextQueue = applied.changed ? incrementAttempts(queue, topic) : queue;
  const rolled = recomputeCandidateRollups(applied.state, { queue: nextQueue, kind, now: stamp });
  const withAttempts = persistAttempts(rolled, nextQueue);
  const nextTopic = topicOf(withAttempts, topic);
  return {
    action,
    recorded: applied.changed,
    generate: false,
    topicKey: topic,
    regenerations: nextTopic.regenerations,
    reason: applied.reason,
    state: withAttempts,
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
  const mirrored = mirrorLegacyTopic(migrated, queue, kind, now);
  const expired = applyExpiry(mirrored, queue, now);
  const rolled = recomputeCandidateRollups(expired.state, { queue: expired.queue, kind, now });
  const selected = selectEligibleTopic({ queue: expired.queue, state: rolled, kind, now });

  if (!selected) {
    const scoped = kindQueue(expired.queue, kind);
    return {
      action: 'wait',
      reason: 'no eligible topics',
      generate: false,
      topicKey: null,
      regenerations: rolled.regenerations,
      state: persistAttempts({ ...rolled, abandoned: scoped.length === 0 ? false : rolled.abandoned }, expired.queue),
      queue: expired.queue,
    };
  }

  const topic = topicOf(rolled, selected.key);
  if (topic.regenerations >= MAX_CANDIDATE_REGENERATIONS) {
    const stamp = iso(now);
    const key = `${kind}:ladder:${selected.key}:${topic.regenerations}:abandon-topic`;
    const applied = applyTopicEvent(rolled, { key, action: 'abandon-topic', at: stamp, reason: ABANDON_REASON, topicKey: selected.key });
    const next = recomputeCandidateRollups(applied.state, { queue: expired.queue, kind, now: stamp });
    return {
      action: 'abandon-topic',
      reason: ABANDON_REASON,
      generate: false,
      topicKey: selected.key,
      regenerations: topic.regenerations,
      state: persistAttempts(next, expired.queue),
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
        state: persistAttempts(rolled, expired.queue),
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
        state: persistAttempts(rolled, expired.queue),
        queue: expired.queue,
      };
    }
    return {
      action: 'generate',
      reason: `cooldown elapsed after a discarded ${kind} candidate; generating regeneration ${topic.regenerations}/${MAX_CANDIDATE_REGENERATIONS}`,
      generate: true,
      topicKey: selected.key,
      regenerations: topic.regenerations,
      state: persistAttempts(rolled, expired.queue),
      queue: expired.queue,
    };
  }

  return {
    action: 'generate',
    reason: 'no candidate is in flight',
    generate: true,
    topicKey: selected.key,
    regenerations: topic.regenerations,
    state: persistAttempts(rolled, expired.queue),
    queue: expired.queue,
  };
}

export function parseTopicalState(body, kind) {
  return parseCandidateState(body, kind);
}

export function renderTopicalState(state) {
  return renderCandidateState(state);
}

export function queueEntryTitle(queue, key) {
  const entry = (queue?.topics ?? []).find((item) => item.key === key);
  return entry?.title ?? '';
}

const SERPAPI_QUERIES = [
  'Liberty Village Toronto',
  'things to do in Liberty Village',
  'Liberty Village restaurants',
];

function titleFromQuery(query) {
  const cleaned = String(query ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

function titleFromPath(pathValue) {
  const slug = String(pathValue ?? '').replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? '';
  if (!slug) return '';
  return titleFromQuery(slug.replace(/[-_]+/g, ' '));
}

function neverEcho(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

async function discoverFromGsc() {
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentials) return [];
  try {
    const { google } = await import('googleapis');
    const { GSC_SITE } = await import('../lib/growth-report.mjs');
    const auth = new google.auth.GoogleAuth({
      keyFile: credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const client = google.searchconsole({ version: 'v1', auth });
    const end = new Date();
    const start = new Date(end.getTime() - 28 * 24 * HOUR_MS);
    const response = await client.searchanalytics.query({
      siteUrl: GSC_SITE,
      requestBody: {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: ['query'],
        rowLimit: 8,
        dataState: 'final',
      },
    });
    const rows = Array.isArray(response?.data?.rows) ? response.data.rows : [];
    return rows.slice(0, 5).map((row) => ({
      kind: 'blog',
      title: titleFromQuery(row.keys?.[0]),
      source: 'gsc',
      rationale: `GSC top query (${row.clicks ?? 0} clicks, ${row.impressions ?? 0} impressions)`,
    })).filter((entry) => entry.title);
  } catch {
    return [];
  }
}

async function discoverFromPosthog() {
  const token = neverEcho('POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE');
  if (!token) return [];
  try {
    const { POSTHOG_PROJECT_ID, PRODUCTION_HOSTNAME, REPORT_TIMEZONE, buildPosthogLandingQuery, buildWeeklyWindows } = await import('../lib/growth-report.mjs');
    const windows = buildWeeklyWindows({ now: new Date() });
    const window = windows.at(-1);
    const query = buildPosthogLandingQuery(window);
    const response = await fetch(`https://us.posthog.com/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    return rows.slice(0, 5).map((row) => ({
      kind: 'seo',
      title: titleFromPath(row[0]),
      source: 'implicit-discovery',
      rationale: `PostHog production landing on ${PRODUCTION_HOSTNAME} (${REPORT_TIMEZONE}): ${row[0]} (${row[1]} organic landings)`,
    })).filter((entry) => entry.title);
  } catch {
    return [];
  }
}

// SerpApi's People Also Ask results drift across similarly named places. Keep
// this source deterministic and conservative: only questions that name the
// neighbourhood explicitly may enter the queue. GSC and PostHog use their own
// source paths and are intentionally unaffected by this filter.
export function buildSerpApiPaaEntries(questions, query) {
  return (Array.isArray(questions) ? questions : []).flatMap((item) => {
    const raw = String(item?.question ?? '').replace(/\s+/g, ' ').trim();
    if (!/\bliberty village\b/i.test(raw)) return [];
    const title = titleFromQuery(raw);
    return title ? [{
      kind: 'blog',
      title,
      source: 'serpapi',
      rationale: `People Also Ask cluster for "${query}"`,
    }] : [];
  }).slice(0, 3);
}

async function discoverFromSerpApi() {
  const key = neverEcho('SERPAPI_API_KEY');
  if (!key) return [];
  const found = [];
  for (const query of SERPAPI_QUERIES) {
    try {
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', query);
      url.searchParams.set('api_key', key);
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) continue;
      const payload = await response.json();
      const questions = Array.isArray(payload?.related_questions) ? payload.related_questions : [];
      found.push(...buildSerpApiPaaEntries(questions, query));
    } catch {
      // Source-local failure must not halt the other discovery lanes.
    }
  }
  return found.slice(0, 8);
}

export async function discoverTopics({ now = new Date() } = {}) {
  const addedAt = iso(now);
  const [gsc, posthog, serp] = await Promise.all([
    discoverFromGsc(),
    discoverFromPosthog(),
    discoverFromSerpApi(),
  ]);
  return [...gsc, ...posthog, ...serp].map((entry) => ({ ...entry, addedAt }));
}

export async function appendDiscoveredTopics(queue, discoveries) {
  let next = queue ?? loadTopicQueue();
  const added = [];
  for (const discovery of discoveries) {
    const result = appendTopic(next, discovery);
    next = result.queue;
    if (result.added) added.push(result.entry);
  }
  return { queue: next, added };
}

function parseCli(argv) {
  const command = argv[2];
  const values = {};
  for (let i = 3; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const [key, inline] = argv[i].slice(2).split('=', 2);
    values[key] = inline ?? argv[++i];
  }
  return { command, values };
}

async function main() {
  const { command, values } = parseCli(process.argv);
  if (command === 'load') {
    process.stdout.write(`${JSON.stringify(loadTopicQueue(), null, 2)}\n`);
    return;
  }
  if (command === 'select' || command === 'resolve') {
    const kind = values.kind;
    if (!kind) throw new Error('missing --kind');
    const queue = hydrateQueue(loadTopicQueue(), emptyCandidateState(kind));
    const selected = selectEligibleTopic({ queue, state: emptyCandidateState(kind), kind, now: new Date() });
    writeOutput({
      kind,
      topic_key: selected?.key ?? '',
      topic_title: selected?.title ?? '',
      source: selected?.source ?? '',
      reason: selected ? 'next eligible topic' : 'no eligible topics',
    });
    return;
  }
  if (command === 'append') {
    const result = appendTopic(loadTopicQueue(), {
      kind: values.kind, title: values.title, source: values.source,
      rationale: values.rationale, branchPrefix: values['branch-prefix'],
    });
    saveTopicQueue(result.queue);
    writeOutput({ added: result.added ? 'true' : 'false', topic_key: result.key ?? '', reason: result.reason ?? '' });
    return;
  }
  if (command === 'discover') {
    const current = loadTopicQueue();
    const discoveries = await discoverTopics();
    const result = await appendDiscoveredTopics(current, discoveries);
    saveTopicQueue(result.queue);
    writeOutput({
      added: String(result.added.length),
      topic_keys: result.added.map((entry) => entry.key).join(','),
    });
    console.log(`Appended ${result.added.length} topic(s) to ${queuePath()}.`);
    return;
  }
  throw new Error(`unknown topic-queue command: ${String(command)}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { isTopicAbandoned };
