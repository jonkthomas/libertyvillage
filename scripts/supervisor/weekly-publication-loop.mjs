// Weekly grounded publication loop (issue #152).
//
// The weekly objective is explicit: by Sunday 23:59 UTC the target branch
// contains at least one newly published, grounded article for that ISO week.
// This module is the one place that objective lives. It is a loop engine, not
// a script: candidate generation, gate review, repair, fallback, and
// promotion are adapter seams so the same policy runs offline in the locked
// journey (deterministic adapters, no network, no model spend) and in the
// scheduled supervisor lanes (real adapters).
//
// The loop's invariants, none of which are configurable:
//   - The gate profile is frozen: threshold 8, blocking severities critical
//     and high, model claude-opus-5. A weaker profile supplied at the seam is
//     refused, never adopted.
//   - Success is repository truth: the exact article commit must be contained
//     in refs/heads/<targetBranch>. A terminal/status claim is evidence only.
//   - A topic and its deterministic intent fingerprint are consumed only
//     AFTER verified containment; failed attempts stay auditable on their
//     candidate branches and never block the next distinct topic.
//   - One invocation advances past rejection, abandonment, gate exhaustion,
//     and unrepairable content to the next distinct eligible topic, within a
//     bounded same-cycle budget. No hot loops, no budget resets.
//   - The Sunday deadline lane first checks the weekly success predicate
//     (no-op when the week is already satisfied), then publishes one
//     conservative record-backed fallback guide, and if even that fails it
//     records exactly one WEEKLY_PUBLICATION_MISSED terminal with evidence.
//     Nothing is ever published below the gate.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BLOCKING_SEVERITIES, GATE_MODEL, SCORE_THRESHOLD } from '../automation/constants.mjs';

// At most three fresh normal-topic candidates per Wednesday cycle (spec §32).
export const MAX_WEEKLY_FRESH_CANDIDATES = 3;
// The Sunday fallback guide must carry at least six verbatim specifics drawn
// from at least three resolving repository records, with zero deferral hedges.
export const MIN_VERBATIM_SPECIFICS = 6;
export const MIN_RESOLVING_RECORDS = 3;
export const PUBLISHED_MAIN = 'PUBLISHED_MAIN';
export const WEEKLY_PUBLICATION_MISSED = 'WEEKLY_PUBLICATION_MISSED';
export const WEEKLY_OBJECTIVE_MET = 'WEEKLY_OBJECTIVE_MET';
export const DEFERRED_TO_DEADLINE = 'DEFERRED_TO_DEADLINE';
export const FALLBACK_CATEGORIES = Object.freeze([
  'lifestyle', 'community', 'food-drink', 'transit', 'real-estate', 'development', 'events', 'news',
]);
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeTitle(title) {
  return String(title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// The deterministic intent fingerprint: stable across regenerations of the
// same topic, distinct across topics. A consumed fingerprint permanently
// blocks the topic from being regenerated under a near-duplicate slug.
export function intentFingerprint({ kind = 'blog', title } = {}) {
  const normalized = normalizeTitle(title);
  if (!normalized) throw new Error('intent fingerprint requires a topic title');
  return createHash('sha256').update(`${kind}|${normalized}`, 'utf8').digest('hex');
}

export function slugForTitle(title) {
  const slug = normalizeTitle(title).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return slug || 'weekly-grounded-guide';
}

// ISO week window in UTC: Monday 00:00:00.000 through Sunday 23:59:59.999.
export function isoWeekWindow(scheduledAt) {
  const date = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (!Number.isFinite(date.getTime())) throw new Error(`unreadable scheduled-at timestamp: ${String(scheduledAt)}`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset));
  const end = new Date(start.getTime() + 7 * DAY_MS - 1);
  const thursday = new Date(start.getTime() + 3 * DAY_MS);
  const januaryFirst = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - januaryFirst.getTime()) / DAY_MS + januaryFirst.getUTCDay() + 1) / 7);
  return { key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, start, end };
}

// The Sunday run is the deadline catch-up lane; the Wednesday run defers to it.
export function isDeadlineLane(scheduledAt) {
  const date = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (!Number.isFinite(date.getTime())) throw new Error(`unreadable scheduled-at timestamp: ${String(scheduledAt)}`);
  return date.getUTCDay() === 0;
}

// The trusted gate decision rule. The threshold and blocking severities always
// come from the supplied gate profile — the same frozen profile the journey
// binds its evidence to — and the outcome is recomputed here, never accepted
// from the reviewer's own verdict.
export function evaluateGateOutcome(gate, verdict) {
  const threshold = Number(gate?.scoreThreshold);
  const severities = Array.isArray(gate?.blockingSeverities) ? gate.blockingSeverities : [...BLOCKING_SEVERITIES];
  const findings = Array.isArray(verdict?.findings) ? verdict.findings : [];
  const overall = Number(verdict?.overall);
  const blocking = findings.filter((finding) => severities.includes(finding?.severity));
  return {
    overall: Number.isFinite(overall) ? overall : null,
    blocking,
    passed: Number.isFinite(overall) && overall >= threshold && blocking.length === 0,
  };
}

// Repair routing (spec §36-37): the fixer is dispatched only for blocking
// critical/high findings that are actually repairable. A sub-8 score without
// blocking findings returns to fresh-candidate selection — inviting broad
// "make it vaguer" repairs on it is how useful local details get sanded off.
export function routeFailedGate(gate, verdict, { repairable = true } = {}) {
  const outcome = evaluateGateOutcome(gate, verdict);
  if (outcome.passed) return { action: 'none', reason: 'the gate passed' };
  if (outcome.blocking.length === 0) {
    return {
      action: 'advance-topic',
      reason: `score ${outcome.overall} is below ${gate?.scoreThreshold} without blocking findings; returning to fresh-candidate selection`,
    };
  }
  if (!repairable) {
    return {
      action: 'advance-topic',
      reason: `every blocking finding is structurally unrepairable (${outcome.blocking.length}); terminating this candidate`,
    };
  }
  return { action: 'dispatch-fixer', reason: `${outcome.blocking.length} blocking finding(s) are repairable` };
}

// A repair that regresses the score, introduces a new blocking finding, or
// merely plateaus terminates the candidate immediately. A plateau is not
// progress: paying more rounds for the same score is the #97 failure mode.
export function evaluateRepairRound({ previous, latest } = {}) {
  if (!previous || !latest) {
    return { action: 'continue', reason: 'not enough scored rounds to judge the repair yet' };
  }
  if (latest.blockingCount > previous.blockingCount) {
    return {
      action: 'terminate-candidate',
      reason: `the repair introduced a new blocking finding (${previous.blockingCount} -> ${latest.blockingCount})`,
    };
  }
  if (latest.overall < previous.overall) {
    return { action: 'terminate-candidate', reason: `the repair regressed the score (${previous.overall} -> ${latest.overall})` };
  }
  if (latest.overall === previous.overall) {
    return { action: 'terminate-candidate', reason: `the repair plateaued at ${latest.overall}; a plateau is not progress` };
  }
  return { action: 'continue', reason: `the repair improved the score (${previous.overall} -> ${latest.overall})` };
}

// Deferral prose — "check current listings", "verify hours", "call ahead" —
// is the fallback guide's signature failure mode: it defers the very local
// specifics the repository already owns. Zero tolerance.
export const DEFERRAL_HEDGE_PATTERN = new RegExp(
  String.raw`\b(?:check|verify|confirm|research|double-?check)\b[^.!?\n]{0,60}\b(?:current|latest|up-?to-?date|updated|hours|prices|pricing|listings?|availability|schedules?)\b`
  + String.raw`|\b(?:call ahead|call (?:the|them) first|visit (?:their|the|our) (?:website|site|page|listing)|see (?:their|the|our) (?:website|site|page)|before (?:you|your) (?:go|visit))\b`,
  'i',
);

export function hasDeferralHedge(text) {
  return DEFERRAL_HEDGE_PATTERN.test(String(text ?? ''));
}

// Fail-closed grounding validation. Every specific must appear verbatim in
// the record it resolves to; the guide must clear the minimum counts and
// carry zero deferral hedges. Anything less is not publishable, whatever the
// gate said.
export function validateGroundedGuide({ content, specifics, records } = {}) {
  const errors = [];
  const recordText = new Map((Array.isArray(records) ? records : [])
    .filter((record) => record && typeof record.slug === 'string')
    .map((record) => [record.slug, String(record.text ?? '')]));
  const valid = (Array.isArray(specifics) ? specifics : []).filter((specific) => {
    if (!specific || typeof specific.text !== 'string' || !specific.text.trim()) return false;
    const source = recordText.get(specific.recordSlug);
    return typeof source === 'string' && source.includes(specific.text);
  });
  const resolvingSlugs = new Set(valid.map((specific) => specific.recordSlug));
  if (valid.length < MIN_VERBATIM_SPECIFICS) {
    errors.push(`${valid.length} verbatim record specific(s); at least ${MIN_VERBATIM_SPECIFICS} are required`);
  }
  if (resolvingSlugs.size < MIN_RESOLVING_RECORDS) {
    errors.push(`${resolvingSlugs.size} resolving record slug(s); at least ${MIN_RESOLVING_RECORDS} are required`);
  }
  if (hasDeferralHedge(content)) {
    errors.push('the guide contains deferral prose; the repository records already own these specifics');
  }
  return { ok: errors.length === 0, errors, specifics: valid.length, records: resolvingSlugs.size };
}

// Concrete local details extracted verbatim from record text: civic addresses,
// clock ranges, and dollar amounts. Each specific is a substring of its record
// by construction, so the extraction can never invent a specific.
const SPECIFIC_PATTERNS = Object.freeze([
  String.raw`\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][A-Za-z.'’-]*\s+){0,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Lane|Ln|Cres|Crescent|Pl|Place|Ct|Court)\b`,
  String.raw`\b\d{1,2}:\d{2}\s*(?:a|p)\.?m\.?(?:\s*(?:to|-|–)\s*\d{1,2}:\d{2}\s*(?:a|p)\.?m\.?)?`,
  String.raw`\$\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:to|-|–)\s*\$\d[\d,]*(?:\.\d{1,2})?)?`,
]);

export function extractVerbatimSpecifics(records) {
  const specifics = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record.text !== 'string') continue;
    for (const source of SPECIFIC_PATTERNS) {
      for (const match of record.text.match(new RegExp(source, 'g')) ?? []) {
        specifics.push({ text: match, recordSlug: record.slug });
      }
    }
  }
  return specifics;
}

export function selectFallbackCategory(usedCategories = []) {
  const used = new Set(Array.isArray(usedCategories) ? usedCategories.map(String) : []);
  return FALLBACK_CATEGORIES.find((category) => !used.has(category)) ?? FALLBACK_CATEGORIES[0];
}

// The narrow record-backed Sunday fallback guide (spec §38): one conservative
// guide from an unused category, built only from verbatim specifics already in
// the repository records, with zero deferral hedges. It is validated before it
// is ever staged; a guide that cannot meet the bar is not returned at all.
export function buildFallbackGuide({ records, usedCategories = [], publishedAt, id }) {
  const specifics = extractVerbatimSpecifics(records);
  const byRecord = new Map();
  for (const specific of specifics) {
    if (!byRecord.has(specific.recordSlug)) byRecord.set(specific.recordSlug, []);
    byRecord.get(specific.recordSlug).push(specific.text);
  }
  const category = selectFallbackCategory(usedCategories);
  const recordLines = [...byRecord.entries()].map(([slug, values]) => {
    const record = (Array.isArray(records) ? records : []).find((entry) => entry?.slug === slug);
    return `- **${record?.name ?? slug}** (${slug}): ${values.join('; ')}.`;
  });
  const content = [
    '## The short answer',
    '',
    `This week's grounded ${category} guide is assembled directly from the site's own business records.`,
    'Every hour, price, and address below is copied verbatim from a linked repository record.',
    '',
    '## What the records say',
    '',
    ...recordLines,
    '',
    '## Why this guide is conservative',
    '',
    'No detail appears here that a repository record does not already contain.',
    'The linked directory pages carry the full records behind each entry above.',
  ].join('\n');
  const guide = {
    id,
    slug: slugForTitle(`grounded ${category} guide from repository records`),
    title: `Liberty Village ${category[0].toUpperCase()}${category.slice(1)} Guide: Straight From the Records`,
    category,
    grounded: true,
    publishedAt,
    updatedAt: publishedAt,
    content,
    specifics,
    author: 'LibertyVillage.co',
  };
  const validation = validateGroundedGuide({ content, specifics, records });
  if (!validation.ok) {
    throw new Error(`grounded fallback guide is not publishable: ${validation.errors.join('; ')}`);
  }
  return { guide, validation };
}

// Consumption (spec §33): a fingerprint is marked consumed only after the
// exact article commit is actually contained in the target branch. A
// publication claim without containment consumes nothing.
export function consumePublishedIntent(consumed, { fingerprint, contained } = {}) {
  if (typeof fingerprint !== 'string' || !fingerprint) throw new Error('consuming an intent requires its fingerprint');
  const next = new Set(consumed ?? []);
  if (contained !== true) {
    return { consumed: next, consumedNow: false, reason: 'intent is consumed only after verified containment in the target branch' };
  }
  const consumedNow = !next.has(fingerprint);
  next.add(fingerprint);
  return { consumed: next, consumedNow, reason: consumedNow ? 'intent consumed after verified publication' : 'intent was already consumed' };
}

// Same-cycle distinct-topic advancement: pick the next eligible candidate,
// skipping fingerprints attempted (and failed) in this same run, fingerprints
// already consumed by a verified publication, and slugs that already exist as
// articles — all before any generation spend.
export function selectDistinctTopic({
  candidates, consumedFingerprints = [], excludeFingerprints = [], existingSlugs = [],
} = {}) {
  const consumed = new Set(Array.isArray(consumedFingerprints) ? consumedFingerprints : []);
  const excluded = new Set(Array.isArray(excludeFingerprints) ? excludeFingerprints : []);
  const slugs = new Set(Array.isArray(existingSlugs) ? existingSlugs : []);
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate.title !== 'string' || !candidate.title.trim()) continue;
    const fingerprint = intentFingerprint(candidate);
    if (excluded.has(fingerprint) || consumed.has(fingerprint)) continue;
    if (slugs.has(candidate.slug ?? slugForTitle(candidate.title))) continue;
    return { candidate, fingerprint };
  }
  return { candidate: null, fingerprint: null };
}

function postKeyOf(post) {
  return String(post?.id ?? post?.slug ?? '');
}

function introducedPosts({ posts, parentPosts } = {}) {
  const before = new Set((Array.isArray(parentPosts) ? parentPosts : []).map(postKeyOf).filter(Boolean));
  return (Array.isArray(posts) ? posts : []).filter((post) => {
    const key = postKeyOf(post);
    return key && !before.has(key);
  });
}

// The weekly success predicate, from repository truth only: an article
// introduced to the target branch by a contained commit whose publication
// date falls inside the ISO week. PR creation or a green review is not success.
export function findQualifyingPublication({ history, week } = {}) {
  const start = week?.start instanceof Date ? week.start.getTime() : Date.parse(week?.start);
  const end = week?.end instanceof Date ? week.end.getTime() : Date.parse(week?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('the weekly success predicate requires an ISO week window');
  for (const entry of Array.isArray(history) ? history : []) {
    for (const post of introducedPosts(entry)) {
      const at = Date.parse(String(post?.publishedAt ?? ''));
      if (Number.isFinite(at) && at >= start && at <= end) {
        return { sha: entry.sha, post: { id: post.id ?? null, slug: post.slug ?? null, publishedAt: post.publishedAt } };
      }
    }
  }
  return null;
}

// Exactly one visible terminal for a missed week, with the evidence an
// operator needs: the week, every attempted fingerprint, the exact failure
// stage of each attempt, and the run/PR links. Never a silent success.
export function weeklyPublicationMissed({
  week, attemptedFingerprints = [], failureStages = [], runUrl = null, prUrl = null,
} = {}) {
  if (!week) throw new Error('a missed week terminal requires the ISO week key');
  return {
    claimedTerminal: WEEKLY_PUBLICATION_MISSED,
    week,
    attemptedFingerprints: [...attemptedFingerprints],
    failureStages: [...failureStages],
    runUrl,
    prUrl,
    note: 'no grounded article passed the unchanged gate this week; nothing was published below it',
  };
}

// ---------------------------------------------------------------------------
// Journey executor: the loop driven against a real (isolated) git repository.
// ---------------------------------------------------------------------------

function makeGit(repoPath, scheduledAt) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: scheduledAt,
    GIT_COMMITTER_DATE: scheduledAt,
  };
  return (args) => execFileSync('git', args, {
    cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env,
  }).trim();
}

function readPostsAt(git, ref) {
  let raw;
  try {
    raw = git(['show', `${ref}:data/posts.json`]);
  } catch {
    return [];
  }
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    throw new Error(`data/posts.json at ${ref} is not a JSON array; failing closed`);
  }
}

// Bounded walk of the commits on the target branch that touched posts.json,
// oldest first, with each commit's introduced posts computed against its first
// parent so the predicate sees exactly what main actually received.
export function branchPublicationHistory(git, targetBranch, { limit = 200 } = {}) {
  const shas = git(['log', '--format=%H', '-n', String(limit), `refs/heads/${targetBranch}`, '--', 'data/posts.json'])
    .split('\n').map((line) => line.trim()).filter(Boolean);
  return shas.reverse().map((sha) => {
    let parentPosts = [];
    try {
      parentPosts = readPostsAt(git, `${sha}^`);
    } catch {
      parentPosts = [];
    }
    return { sha, posts: readPostsAt(git, sha), parentPosts };
  });
}

function existingPostSlugs(git, targetBranch) {
  return readPostsAt(git, `refs/heads/${targetBranch}`).map((post) => post?.slug).filter(Boolean);
}

function commitIsContained(git, targetBranch, commit) {
  try {
    git(['merge-base', '--is-ancestor', commit, `refs/heads/${targetBranch}`]);
    return true;
  } catch {
    return false;
  }
}

function commitContainsCandidate(git, commit, candidateId) {
  return readPostsAt(git, commit).some((post) => post?.id === candidateId);
}

// Stage one candidate as an exact article commit on its own branch from the
// run's base commit. Rejected candidates stay here — auditable, never merged.
function stageCandidate(git, repoPath, { branch, baseCommit, post }) {
  git(['checkout', '-b', branch, baseCommit]);
  const posts = [...readPostsAt(git, baseCommit), post];
  fs.writeFileSync(path.join(repoPath, 'data/posts.json'), `${JSON.stringify(posts, null, 2)}\n`);
  git(['add', '--', 'data/posts.json']);
  git(['commit', '-m', `weekly: candidate ${post.id}`]);
  return git(['rev-parse', 'HEAD']);
}

// Protected-main promotion, then the load-bearing check: publication exists
// only when the exact article commit is verifiably contained in the target
// branch AND that commit carries this candidate's article. Anything else is a
// claim, and a claim is not publication.
function promoteAndVerifyContainment(git, { targetBranch, branch, articleCommit, candidateId }) {
  git(['checkout', targetBranch]);
  git(['merge', '--no-ff', '--no-edit', branch]);
  const contained = commitIsContained(git, targetBranch, articleCommit)
    && commitContainsCandidate(git, articleCommit, candidateId);
  return { contained };
}

function gateEvidence(gate, commitSha, verdict) {
  return {
    model: gate.model,
    scoreThreshold: gate.scoreThreshold,
    blockingSeverities: [...gate.blockingSeverities],
    commitSha,
    overall: verdict.overall,
    findings: verdict.findings,
    bypassed: false,
  };
}

// Deterministic journey evidence records. The journey repo is isolated, so the
// loop's grounding is exercised against seeded record text; in production the
// same validation runs against repository business records.
const SEEDED_EVIDENCE_RECORDS = Object.freeze([
  {
    slug: 'seeded-record-a',
    name: 'Seeded Cafe A',
    text: 'Seeded Cafe A operates at 85 Seeded Ave and serves brunch from 9:00 a.m. to 2:00 p.m. with mains priced from $14 to $26.',
  },
  {
    slug: 'seeded-record-b',
    name: 'Seeded Studio B',
    text: 'Seeded Studio B runs classes daily from 6:00 a.m. to 10:00 p.m. with drop-in passes at $22 beside Seeded Park.',
  },
  {
    slug: 'seeded-record-c',
    name: 'Seeded Market C',
    text: 'Seeded Market C opens at 8:00 a.m. daily and stocks local produce with weekly baskets at $34.',
  },
]);

function distinctGuideContent() {
  return [
    '## The short answer',
    '',
    'This grounded guide is assembled directly from the linked repository records.',
    'Seeded Cafe A operates at 85 Seeded Ave and serves brunch from 9:00 a.m. to 2:00 p.m. with mains priced from $14 to $26.',
    'Seeded Studio B runs classes daily from 6:00 a.m. to 10:00 p.m. with drop-in passes at $22.',
    'Seeded Market C opens at 8:00 a.m. daily and stocks local produce with weekly baskets at $34.',
    '',
    '## Why this guide is grounded',
    '',
    'Every address, hour range, and price above is copied verbatim from a repository record.',
  ].join('\n');
}

function seededVerbatimSpecifics() {
  return [
    { text: '85 Seeded Ave', recordSlug: 'seeded-record-a' },
    { text: '9:00 a.m. to 2:00 p.m.', recordSlug: 'seeded-record-a' },
    { text: '$14 to $26', recordSlug: 'seeded-record-a' },
    { text: '6:00 a.m. to 10:00 p.m.', recordSlug: 'seeded-record-b' },
    { text: '$22', recordSlug: 'seeded-record-b' },
    { text: '8:00 a.m.', recordSlug: 'seeded-record-c' },
    { text: '$34', recordSlug: 'seeded-record-c' },
  ];
}

// The seeded topic plan models the measured baseline scenario: a first fresh
// candidate whose local specifics are not supported by any record (the gate
// rejects it under the frozen profile), then a distinct grounded topic, then
// the Sunday fallback. The loop treats these exactly as it treats any adapter
// plan: selection, gating, grounding, promotion, and consumption are all
// decided by the shared policy, never by the seed.
function defaultJourneyAdapters(input) {
  const publishedAt = input.scheduledAt;
  const { seed } = input;
  return {
    records: () => SEEDED_EVIDENCE_RECORDS,
    plan: () => ([
      {
        id: seed.firstCandidateId,
        title: 'First fresh weekly candidate with an unsupported local claim',
        mode: 'distinct-candidate',
        grounded: false,
        repairable: false,
        content: 'Seeded first candidate asserting one local specific no repository record contains.',
        specifics: [{ text: '999 Unsupported Blvd', recordSlug: 'seeded-record-a' }],
        verdict: {
          overall: 7,
          findings: [{ severity: 'high', path: 'data/posts.json', note: 'unsupported local claim: no repository record contains it' }],
        },
      },
      {
        id: seed.distinctCandidateId,
        title: 'Distinct grounded weekly candidate from repository records',
        mode: 'distinct-candidate',
        grounded: true,
        repairable: false,
        content: distinctGuideContent(),
        specifics: seededVerbatimSpecifics(),
        verdict: { overall: 9, findings: [] },
      },
      {
        id: seed.sundayFallbackId,
        title: 'Sunday grounded fallback guide from repository records',
        mode: 'sunday-grounded-fallback',
        grounded: true,
        repairable: false,
        content: null, // built from records by the fallback lane
        specifics: null,
        verdict: { overall: 9, findings: [] },
      },
    ].map((candidate) => ({ ...candidate, publishedAt }))),
    review: async ({ candidate, commitSha }) => {
      if (!commitSha) throw new Error('the gate reviews an exact article commit, never a draft');
      return candidate.verdict;
    },
    repairable: ({ candidate }) => candidate.repairable === true,
  };
}

function journeyContext(input) {
  if (!input || typeof input !== 'object') throw new Error('the weekly journey requires its input contract');
  for (const field of ['repoPath', 'targetBranch', 'baseCommit', 'scheduledAt']) {
    if (!input[field]) throw new Error(`the weekly journey requires ${field}`);
  }
  const gate = input.gate;
  if (!gate || gate.model !== GATE_MODEL) throw new Error(`the weekly gate model is frozen at ${GATE_MODEL}`);
  if (Number(gate.scoreThreshold) !== SCORE_THRESHOLD) {
    throw new Error(`the weekly gate threshold is frozen at ${SCORE_THRESHOLD}; refusing a weaker profile`);
  }
  if ([...(gate.blockingSeverities ?? [])].join(',') !== [...BLOCKING_SEVERITIES].join(',')) {
    throw new Error(`the weekly blocking severities are frozen at ${BLOCKING_SEVERITIES.join(', ')}`);
  }
  const seed = input.seed;
  for (const field of ['firstCandidateId', 'distinctCandidateId', 'sundayFallbackId']) {
    if (typeof seed?.[field] !== 'string' || !seed[field]) throw new Error(`the weekly journey requires seed.${field}`);
  }
  return {
    repoPath: input.repoPath,
    targetBranch: input.targetBranch,
    baseCommit: input.baseCommit,
    scheduledAt: input.scheduledAt instanceof Date ? input.scheduledAt.toISOString() : String(input.scheduledAt),
    gate,
    seed,
    adapters: { ...defaultJourneyAdapters(input), ...(input.adapters ?? {}) },
  };
}

async function attemptCandidate(ctx, git, { candidate, fingerprint, mode, records }) {
  const post = {
    id: candidate.id,
    slug: slugForTitle(candidate.title),
    title: candidate.title,
    category: candidate.category ?? 'lifestyle',
    grounded: candidate.grounded === true,
    publishedAt: candidate.publishedAt,
    updatedAt: candidate.publishedAt,
    content: candidate.content,
    specifics: candidate.specifics ?? [],
    author: 'LibertyVillage.co',
  };
  const branch = `weekly-candidates/${post.slug}`;
  const articleCommit = stageCandidate(git, ctx.repoPath, { branch, baseCommit: ctx.baseCommit, post });
  const verdict = await ctx.adapters.review({ candidate, commitSha: articleCommit });
  const gate = gateEvidence(ctx.gate, articleCommit, verdict);
  const outcome = evaluateGateOutcome(ctx.gate, verdict);
  const attempt = {
    candidateId: candidate.id,
    mode,
    fingerprint,
    articleCommit,
    branch,
    grounded: candidate.grounded === true,
    gate,
  };
  if (!outcome.passed) {
    const routing = routeFailedGate(ctx.gate, verdict, {
      repairable: ctx.adapters.repairable({ candidate, blocking: outcome.blocking }),
    });
    return {
      ...attempt,
      disposition: 'rejected',
      repairRouting: routing.action,
      reason: routing.reason,
    };
  }
  const grounding = validateGroundedGuide({ content: candidate.content, specifics: candidate.specifics, records });
  if (!grounding.ok) {
    return {
      ...attempt,
      disposition: 'rejected',
      repairRouting: 'advance-topic',
      reason: `fail-closed grounding: ${grounding.errors.join('; ')}`,
    };
  }
  const promotion = promoteAndVerifyContainment(git, {
    targetBranch: ctx.targetBranch, branch, articleCommit, candidateId: candidate.id,
  });
  if (!promotion.contained) {
    return {
      ...attempt,
      disposition: 'promotion-failed',
      reason: `the exact article commit ${articleCommit} is not verifiably contained in refs/heads/${ctx.targetBranch}`,
    };
  }
  return {
    ...attempt,
    disposition: 'published',
    grounding: { specifics: grounding.specifics, records: grounding.records },
  };
}

/**
 * Runs the weekly grounded publication loop against the supplied repository.
 *
 * The locked journey (tests/automation/weekly-grounded-publication-loop.eval.mjs)
 * drives this seam offline with deterministic adapters; the supervisor lanes
 * drive the same loop with the real generation and gate adapters.
 *
 * @returns {{ week: string, attempts: Array, publication: object, consumedFingerprints: string[] }}
 */
export async function runWeeklyGroundedPublicationJourney(input) {
  const ctx = journeyContext(input);
  const week = isoWeekWindow(ctx.scheduledAt);
  const git = makeGit(ctx.repoPath, ctx.scheduledAt);
  const deadlineLane = isDeadlineLane(ctx.scheduledAt);

  // Repository truth first: an article already contained in the target branch
  // for this ISO week makes the whole run a no-op (user story 8).
  const already = findQualifyingPublication({
    history: branchPublicationHistory(git, ctx.targetBranch),
    week,
  });
  if (already) {
    return {
      week: week.key,
      attempts: [],
      consumedFingerprints: [],
      publication: {
        claimedTerminal: WEEKLY_OBJECTIVE_MET,
        week: week.key,
        targetBranch: ctx.targetBranch,
        articleCommit: already.sha,
        qualifyingPost: already.post,
      },
    };
  }

  const plan = ctx.adapters.plan();
  const records = ctx.adapters.records();
  const attempts = [];
  const consumed = new Set();
  const attemptedFingerprints = [];
  const failureStages = [];
  const freshCandidates = plan.filter((candidate) => candidate?.mode === 'distinct-candidate');

  // The primary lane: bounded fresh, distinct topics in this same invocation.
  for (let fresh = 0; fresh < MAX_WEEKLY_FRESH_CANDIDATES;) {
    const { candidate, fingerprint } = selectDistinctTopic({
      candidates: freshCandidates,
      consumedFingerprints: [...consumed],
      excludeFingerprints: [...attemptedFingerprints],
      existingSlugs: existingPostSlugs(git, ctx.targetBranch),
    });
    if (!candidate) break;
    fresh += 1;
    attemptedFingerprints.push(fingerprint);
    const attempt = await attemptCandidate(ctx, git, { candidate, fingerprint, mode: 'distinct-candidate', records });
    attempts.push(attempt);
    if (attempt.disposition === 'published') {
      const consumption = consumePublishedIntent(consumed, { fingerprint, contained: true });
      return {
        week: week.key,
        attempts,
        consumedFingerprints: [...consumption.consumed],
        publication: {
          claimedTerminal: PUBLISHED_MAIN,
          week: week.key,
          targetBranch: ctx.targetBranch,
          articleCommit: attempt.articleCommit,
        },
      };
    }
    failureStages.push(`${candidate.id}:${attempt.disposition}`);
  }

  // The Wednesday lane defers to Sunday after its bounded budget; only the
  // deadline lane may publish the conservative fallback.
  if (!deadlineLane) {
    return {
      week: week.key,
      attempts,
      consumedFingerprints: [...consumed],
      publication: {
        claimedTerminal: DEFERRED_TO_DEADLINE,
        week: week.key,
        targetBranch: ctx.targetBranch,
        attemptedFingerprints: [...attemptedFingerprints],
        failureStages: [...failureStages],
        note: `the bounded fresh-candidate budget did not publish this week; the Sunday deadline lane will catch up`,
      },
    };
  }

  // The Sunday fallback lane: one conservative record-backed guide.
  const fallbackPlan = plan.find((candidate) => candidate?.mode === 'sunday-grounded-fallback');
  if (fallbackPlan) {
    const usedCategories = readPostsAt(git, `refs/heads/${ctx.targetBranch}`)
      .map((post) => post?.category).filter(Boolean);
    const { guide } = buildFallbackGuide({
      records,
      usedCategories,
      publishedAt: ctx.scheduledAt,
      id: fallbackPlan.id,
    });
    const fallbackCandidate = {
      ...fallbackPlan,
      title: guide.title,
      category: guide.category,
      content: guide.content,
      specifics: guide.specifics,
    };
    const fingerprint = intentFingerprint(fallbackCandidate);
    if (!attemptedFingerprints.includes(fingerprint)) attemptedFingerprints.push(fingerprint);
    const attempt = await attemptCandidate(ctx, git, {
      candidate: { ...fallbackCandidate, publishedAt: ctx.scheduledAt },
      fingerprint,
      mode: 'sunday-grounded-fallback',
      records,
    });
    attempts.push(attempt);
    if (attempt.disposition === 'published') {
      const consumption = consumePublishedIntent(consumed, { fingerprint, contained: true });
      return {
        week: week.key,
        attempts,
        consumedFingerprints: [...consumption.consumed],
        publication: {
          claimedTerminal: PUBLISHED_MAIN,
          week: week.key,
          targetBranch: ctx.targetBranch,
          articleCommit: attempt.articleCommit,
        },
      };
    }
    failureStages.push(`${fallbackCandidate.id}:${attempt.disposition}`);
  }

  // Even the grounded fallback failed. Nothing low-quality is published; the
  // week records exactly one visible missed terminal with its evidence.
  return {
    week: week.key,
    attempts,
    consumedFingerprints: [...consumed],
    publication: weeklyPublicationMissed({
      week: week.key,
      attemptedFingerprints,
      failureStages,
      runUrl: ctx.adapters.runUrl?.() ?? null,
      prUrl: ctx.adapters.prUrl?.() ?? null,
    }),
  };
}
