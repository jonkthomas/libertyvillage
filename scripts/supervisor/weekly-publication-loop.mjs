// Weekly grounded publication loop (issue #152).
//
// Policy lives here. Production execution reuses coordinator, candidate-state,
// the isolated host-run worktree, ingest, and monitorOwnedPr. The locked journey
// eval drives the same policy against an isolated fixture via worktrees so the
// caller checkout is never switched or clobbered.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BLOCKING_SEVERITIES, GATE_MODEL, SCORE_THRESHOLD } from '../automation/constants.mjs';
import { classifyFindings } from '../automation/preflight.mjs';
import { evaluateRepairProgress } from '../automation/recovery.mjs';

export const MAX_WEEKLY_FRESH_CANDIDATES = 3;
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

export function intentFingerprint({ kind = 'blog', title } = {}) {
  const normalized = normalizeTitle(title);
  if (!normalized) throw new Error('intent fingerprint requires a topic title');
  return createHash('sha256').update(`${kind}|${normalized}`, 'utf8').digest('hex');
}

export function slugForTitle(title) {
  const slug = normalizeTitle(title).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return slug || 'weekly-grounded-guide';
}

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

export function isDeadlineLane(scheduledAt) {
  const date = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (!Number.isFinite(date.getTime())) throw new Error(`unreadable scheduled-at timestamp: ${String(scheduledAt)}`);
  return date.getUTCDay() === 0;
}

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

export function routeFailedGate(gate, verdict, {
  repairable = true, kind = 'blog-live', changedFiles = ['data/posts.json'],
} = {}) {
  const outcome = evaluateGateOutcome(gate, verdict);
  if (outcome.passed) return { action: 'none', reason: 'the gate passed' };
  if (outcome.blocking.length === 0) {
    return {
      action: 'advance-topic',
      reason: `score ${outcome.overall} is below ${gate?.scoreThreshold} without blocking findings; returning to fresh-candidate selection`,
    };
  }
  const classified = classifyFindings(kind, verdict, { changedFiles });
  if (repairable === false || classified.noFixer || classified.allUnrepairable) {
    return {
      action: 'advance-topic',
      reason: `every blocking finding is structurally unrepairable (${outcome.blocking.length}); terminating this candidate`,
    };
  }
  return { action: 'dispatch-fixer', reason: `${outcome.blocking.length} blocking finding(s) are repairable` };
}

export function evaluateRepairRound({ previous, latest, history } = {}) {
  const rounds = Array.isArray(history) && history.length
    ? history
    : [previous, latest]
      .filter((round) => round && Number.isFinite(round.overall))
      .map((round, attempt) => ({ ...round, attempt }));
  const progress = evaluateRepairProgress({ history: rounds });
  if (progress.decision === 'abandon') {
    return { action: 'terminate-candidate', reason: progress.reason };
  }
  return { action: 'continue', reason: progress.reason };
}

export const DEFERRAL_HEDGE_PATTERN = new RegExp(
  String.raw`\b(?:check|verify|confirm|research|double-?check)\b[^.!?\n]{0,60}\b(?:current|latest|up-?to-?date|updated|hours|prices|pricing|listings?|availability|schedules?)\b`
  + String.raw`|\b(?:call ahead|call (?:the|them) first|visit (?:their|the|our) (?:website|site|page|listing)|see (?:their|the|our) (?:website|site|page)|before (?:you|your) (?:go|visit))\b`,
  'i',
);

export function hasDeferralHedge(text) {
  return DEFERRAL_HEDGE_PATTERN.test(String(text ?? ''));
}

export function uniqueSpecifics(specifics) {
  const seen = new Set();
  return (Array.isArray(specifics) ? specifics : []).filter((specific) => {
    const text = String(specific?.text ?? '').trim();
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

export function validateGroundedGuide({ content, specifics, records, mode = 'candidate' } = {}) {
  const errors = [];
  const recordText = new Map((Array.isArray(records) ? records : [])
    .filter((record) => record && typeof record.slug === 'string')
    .map((record) => [record.slug, String(record.text ?? '')]));
  const valid = uniqueSpecifics(specifics).filter((specific) => {
    if (!specific || typeof specific.text !== 'string' || !specific.text.trim()) return false;
    const source = recordText.get(specific.recordSlug);
    return typeof source === 'string' && source.includes(specific.text);
  });
  const resolvingSlugs = new Set(valid.map((specific) => specific.recordSlug));
  const fallback = mode === 'sunday-grounded-fallback' || mode === 'fallback';
  if (fallback && valid.length < MIN_VERBATIM_SPECIFICS) {
    errors.push(`${valid.length} unique verbatim record specific(s); at least ${MIN_VERBATIM_SPECIFICS} are required`);
  }
  if (fallback && resolvingSlugs.size < MIN_RESOLVING_RECORDS) {
    errors.push(`${resolvingSlugs.size} resolving record slug(s); at least ${MIN_RESOLVING_RECORDS} are required`);
  }
  if (hasDeferralHedge(content)) {
    errors.push('the guide contains deferral prose; the repository records already own these specifics');
  }
  return { ok: errors.length === 0, errors, specifics: valid.length, records: resolvingSlugs.size };
}

const SPECIFIC_PATTERNS = Object.freeze([
  String.raw`\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][A-Za-z.'’-]*\s+){0,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Lane|Ln|Cres|Crescent|Pl|Place|Ct|Court)\b`,
  String.raw`\b\d{1,2}:\d{2}\s*(?:a|p)\.?m\.?(?:\s*(?:to|-|–)\s*\d{1,2}:\d{2}\s*(?:a|p)\.?m\.?)?`,
  String.raw`\$\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:to|-|–)\s*\$\d[\d,]*(?:\.\d{1,2})?)?`,
]);

export function extractVerbatimSpecifics(records) {
  const specifics = [];
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record.text !== 'string') continue;
    for (const source of SPECIFIC_PATTERNS) {
      for (const match of record.text.match(new RegExp(source, 'g')) ?? []) {
        const text = match.trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        specifics.push({ text, recordSlug: record.slug });
      }
    }
  }
  return specifics;
}

export function recordsFromBusinesses(businesses) {
  return (Array.isArray(businesses) ? businesses : []).map((business) => ({
    slug: business?.slug,
    name: business?.name,
    text: [
      business?.name, business?.address, business?.hours, business?.priceRange,
      business?.description, business?.answerBlock, business?.proTip,
    ].filter((value) => typeof value === 'string' && value.trim()).join(' '),
  })).filter((record) => record.slug && record.text);
}

export function selectFallbackCategory(usedCategories = []) {
  const used = new Set(Array.isArray(usedCategories) ? usedCategories.map(String) : []);
  return FALLBACK_CATEGORIES.find((category) => !used.has(category)) ?? FALLBACK_CATEGORIES[0];
}

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
    const name = record?.name ?? slug;
    return `- [${name}](/directory/${slug}): ${[...new Set(values)].join('; ')}.`;
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
  const validation = validateGroundedGuide({ content, specifics, records, mode: 'sunday-grounded-fallback' });
  if (!validation.ok) {
    throw new Error(`grounded fallback guide is not publishable: ${validation.errors.join('; ')}`);
  }
  return { guide, validation };
}

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

function publicationRef(target) {
  const value = String(target ?? '');
  if (value.startsWith('refs/') || value.includes('/')) return value;
  return `refs/heads/${value}`;
}

function makeGit(repoPath, scheduledAt) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: scheduledAt,
    GIT_COMMITTER_DATE: scheduledAt,
  };
  return (args, cwd = repoPath) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env,
  }).trim();
}

function readPostsAt(git, ref) {
  let raw;
  try {
    raw = git(['show', `${ref}:data/posts.json`]);
  } catch {
    return [];
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`malformed publication history: data/posts.json at ${ref} is not valid JSON`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`malformed publication history: data/posts.json at ${ref} is not a JSON array`);
  }
  return value;
}

export function branchPublicationHistory(git, targetBranch, { limit = 200 } = {}) {
  const ref = publicationRef(targetBranch);
  const shas = git(['log', '--format=%H', '-n', String(limit), ref, '--', 'data/posts.json'])
    .split('\n').map((line) => line.trim()).filter(Boolean);
  return shas.reverse().map((sha) => {
    let parentPosts = [];
    try {
      parentPosts = readPostsAt(git, `${sha}^`);
    } catch (error) {
      if (String(error.message).includes('malformed publication history')) throw error;
      parentPosts = [];
    }
    return { sha, posts: readPostsAt(git, sha), parentPosts };
  });
}

function existingPostSlugs(git, targetBranch) {
  return readPostsAt(git, publicationRef(targetBranch)).map((post) => post?.slug).filter(Boolean);
}

function commitIsContained(git, targetBranch, commit) {
  try {
    git(['merge-base', '--is-ancestor', commit, publicationRef(targetBranch)]);
    return true;
  } catch {
    return false;
  }
}

function commitContainsCandidate(git, commit, candidateId) {
  return readPostsAt(git, commit).some((post) => post?.id === candidateId);
}

function withWorktree(git, { branchFlags = [], commitish }, fn) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-weekly-wt-'));
  git(['worktree', 'add', ...branchFlags, workDir, commitish]);
  try {
    return fn(workDir);
  } finally {
    try { git(['worktree', 'remove', '--force', workDir]); } catch { /* best-effort */ }
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* already removed */ }
  }
}

function stageCandidate(git, _repoPath, { branch, baseCommit, post }) {
  return withWorktree(git, { branchFlags: ['-B', branch], commitish: baseCommit }, (workDir) => {
    const posts = [...readPostsAt(git, baseCommit), post];
    fs.mkdirSync(path.join(workDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'data/posts.json'), `${JSON.stringify(posts, null, 2)}\n`);
    git(['add', '--', 'data/posts.json'], workDir);
    git(['commit', '-m', `weekly: candidate ${post.id}`], workDir);
    return git(['rev-parse', 'HEAD'], workDir);
  });
}

function promoteAndVerifyContainment(git, _repoPath, { targetBranch, branch, articleCommit, candidateId }) {
  withWorktree(git, { branchFlags: ['--detach'], commitish: publicationRef(targetBranch) }, (workDir) => {
    git(['merge', '--no-ff', '--no-edit', branch], workDir);
    const merged = git(['rev-parse', 'HEAD'], workDir);
    git(['update-ref', publicationRef(targetBranch), merged]);
  });
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
        content: null,
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
  const grounding = validateGroundedGuide({
    content: candidate.content, specifics: candidate.specifics, records, mode,
  });
  if (!grounding.ok) {
    return {
      ...attempt,
      disposition: 'rejected',
      repairRouting: 'advance-topic',
      reason: `fail-closed grounding: ${grounding.errors.join('; ')}`,
    };
  }
  const promotion = (ctx.adapters.promote
    ? await ctx.adapters.promote({
      git, targetBranch: ctx.targetBranch, branch, articleCommit, candidateId: candidate.id,
    })
    : promoteAndVerifyContainment(git, ctx.repoPath, {
      targetBranch: ctx.targetBranch, branch, articleCommit, candidateId: candidate.id,
    }));
  if (!promotion.contained) {
    return {
      ...attempt,
      disposition: 'promotion-failed',
      reason: `the exact article commit ${articleCommit} is not verifiably contained in ${publicationRef(ctx.targetBranch)}`,
    };
  }
  return {
    ...attempt,
    disposition: 'published',
    grounding: { specifics: grounding.specifics, records: grounding.records },
  };
}

/**
 * Same-cycle Wednesday advancement + Sunday fallback/no-op.
 * Host-run injects coordinator, isolated worktree publish, and monitor adapters.
 */
export async function runWeeklyLane({
  scheduledAt,
  dryRun = false,
  maxFresh = MAX_WEEKLY_FRESH_CANDIDATES,
  fetchTarget,
  readPublicationHistory,
  resolveTopic,
  planCandidate,
  runCandidate,
  runFallback,
  consumeIntent,
  records,
  usedCategories = [],
  onUpdate = async () => {},
} = {}) {
  if (typeof fetchTarget === 'function') await fetchTarget();
  const week = isoWeekWindow(scheduledAt);
  const deadlineLane = isDeadlineLane(scheduledAt);

  let history;
  try {
    history = await readPublicationHistory();
  } catch (error) {
    return {
      terminal: WEEKLY_PUBLICATION_MISSED,
      week: week.key,
      reason: `malformed publication history: ${error.message}`,
      publication: weeklyPublicationMissed({
        week: week.key,
        failureStages: [`history:malformed:${error.message}`],
      }),
    };
  }

  const already = findQualifyingPublication({ history, week });
  if (already) {
    return {
      terminal: WEEKLY_OBJECTIVE_MET,
      topic_key: null,
      week: week.key,
      publication: {
        claimedTerminal: WEEKLY_OBJECTIVE_MET,
        week: week.key,
        articleCommit: already.sha,
        qualifyingPost: already.post,
      },
    };
  }

  const excludeTopicKeys = [];
  const attemptedFingerprints = [];
  const failureStages = [];
  let lastTopicKey = null;

  for (let fresh = 0; fresh < maxFresh;) {
    const topic = await resolveTopic({ excludeTopicKeys });
    if (dryRun) return { terminal: 'DRY_RUN', topic_key: topic?.topic_key || null };
    if (!topic?.topic_key) break;
    if (excludeTopicKeys.includes(topic.topic_key)) break;

    const candidate = await planCandidate(topic, { excludeTopicKeys });
    lastTopicKey = candidate?.topic_key || topic.topic_key;
    const fingerprint = intentFingerprint({ title: topic.topic_title || lastTopicKey });

    if (candidate?.action === 'abandon-topic') {
      excludeTopicKeys.push(lastTopicKey);
      attemptedFingerprints.push(fingerprint);
      failureStages.push(`${lastTopicKey}:abandoned`);
      fresh += 1;
      continue;
    }
    if (candidate?.generate !== 'true') {
      if (candidate?.action === 'wait' && /cooling down/.test(String(candidate.reason || ''))) {
        excludeTopicKeys.push(lastTopicKey);
        continue;
      }
      break;
    }

    fresh += 1;
    attemptedFingerprints.push(fingerprint);
    await onUpdate({ state: 'GENERATE', topic_key: lastTopicKey });
    const result = await runCandidate({ topic, candidate, fingerprint, mode: 'distinct-candidate' });
    if (result?.terminal === PUBLISHED_MAIN) {
      if (typeof consumeIntent === 'function') {
        await consumeIntent({ fingerprint, topicKey: lastTopicKey, contained: true });
      }
      return { ...result, topic_key: lastTopicKey, week: week.key };
    }
    failureStages.push(`${lastTopicKey}:${result?.terminal || 'rejected'}`);
    excludeTopicKeys.push(lastTopicKey);
  }

  if (!deadlineLane) {
    return {
      terminal: DEFERRED_TO_DEADLINE,
      topic_key: lastTopicKey,
      week: week.key,
      attemptedFingerprints,
      failureStages,
    };
  }

  if (typeof runFallback === 'function') {
    try {
      const fallback = await runFallback({
        records: typeof records === 'function' ? await records() : records,
        usedCategories,
        week,
        scheduledAt,
      });
      if (fallback?.terminal === PUBLISHED_MAIN) {
        const fingerprint = intentFingerprint({ title: fallback.title || 'sunday grounded fallback' });
        if (typeof consumeIntent === 'function') {
          await consumeIntent({ fingerprint, topicKey: fallback.topic_key, contained: true });
        }
        return { ...fallback, week: week.key };
      }
      failureStages.push(`fallback:${fallback?.terminal || 'rejected'}`);
    } catch (error) {
      failureStages.push(`fallback:${error.message}`);
    }
  }

  return {
    terminal: WEEKLY_PUBLICATION_MISSED,
    topic_key: lastTopicKey,
    week: week.key,
    publication: weeklyPublicationMissed({ week: week.key, attemptedFingerprints, failureStages }),
  };
}

export async function runWeeklyGroundedPublicationJourney(input) {
  const ctx = journeyContext(input);
  const week = isoWeekWindow(ctx.scheduledAt);
  const git = makeGit(ctx.repoPath, ctx.scheduledAt);
  const deadlineLane = isDeadlineLane(ctx.scheduledAt);

  let history;
  try {
    history = branchPublicationHistory(git, ctx.targetBranch);
  } catch (error) {
    return {
      week: week.key,
      attempts: [],
      consumedFingerprints: [],
      publication: weeklyPublicationMissed({
        week: week.key,
        failureStages: [`history:malformed:${error.message}`],
      }),
    };
  }

  const already = findQualifyingPublication({ history, week });
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
      if (typeof ctx.adapters.consume === 'function') {
        await ctx.adapters.consume({ fingerprint, contained: true, topicKey: candidate.id });
      }
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
        note: 'the bounded fresh-candidate budget did not publish this week; the Sunday deadline lane will catch up',
      },
    };
  }

  const fallbackPlan = plan.find((candidate) => candidate?.mode === 'sunday-grounded-fallback');
  if (fallbackPlan) {
    const usedCategories = readPostsAt(git, publicationRef(ctx.targetBranch))
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
      if (typeof ctx.adapters.consume === 'function') {
        await ctx.adapters.consume({ fingerprint, contained: true, topicKey: fallbackCandidate.id });
      }
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
