// `content submit` (§4.4). This module owns the kind policy that submit, gate g1
// and the repair adapter all apply, so every round and every repair re-runs the
// exact checks the submission first passed.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintPost, resolveLintMode } from '../blog-lint.mjs';
import { validateSubmittedPost } from '../supervisor/pi-session.mjs';
import { validateDraft } from '../news-pilot/draft-validate.mjs';
import { AUTO_PUBLISH_CONFIG, evaluatePublishReadyDraft } from '../news-pilot/publish-gate.mjs';
import { structuredData } from '../automation/news-preflight.mjs';
import { loadSiteLinkIndex } from '../news-pilot/draft-evidence.mjs';
import { createLocalImageExists } from '../news-pilot/draft-validate.mjs';
import { isoWeekOf, roundupSlug } from '../news-pilot/roundup.mjs';
import { canonicalJson, checkDraftAgainstPack, verifySourcePack } from '../automation/blog-source-pack.mjs';
import { fromFile, keyOf, recordSha, registry, serialize } from './canonical.mjs';
import { roundupCoverageErrors, ROUNDUP_COVERAGE_MAX_KEYS, validateRecord } from './validate.mjs';
import { createSubmission, getSubmission, readLive, resolveAssets, ValidationError } from './store.mjs';
import { prepareImages } from './images.mjs';

const MANUAL_DATASETS = Object.freeze(['businesses', 'posts', 'buildings', 'neighborhoods', 'services', 'topics', 'guide-hub']);
export const BLOG_LIVE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
export const ROUNDUP_REVALIDATE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const BLOG_SOURCE_PACK_MAX_BYTES = 128 * 1024;
export const BLOG_SOURCE_PACK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PACK_FACT_CHARS = 600;
const PACK_FACTS_MAX_CHARS = 48000;

const INSERT = Object.freeze(['insert']);
const EDIT = Object.freeze(['insert', 'update']);

// kind -> datasets/ops, count limits and which deterministic checks apply.
// Generation checks (lint, validateSubmittedPost, news publish-ready) apply only
// to kinds that create new automated posts; seo/manual get storage validation.
export const KIND_RULES = Object.freeze({
  business: { datasets: { businesses: INSERT }, min: 1, max: 25, images: true },
  blog: { datasets: { posts: INSERT }, min: 1, max: 1, lint: true, images: true },
  'blog-live': { datasets: { posts: INSERT }, min: 1, max: 1, lint: true, submitted: true, images: true },
  news: { datasets: { posts: INSERT }, min: 1, max: 1, lint: true, news: true },
  roundup: { datasets: { posts: INSERT }, min: 1, max: 1, lint: true, roundup: true },
  'topic-discovery': { datasets: { 'topic-queue': INSERT }, min: 1, max: 25, queue: true },
  seo: {
    datasets: Object.fromEntries(['services', 'topics', 'neighborhoods', 'buildings', 'guide-hub', 'businesses', 'posts'].map((d) => [d, EDIT])),
    min: 1, max: 15, maxInserts: 2, images: true,
  },
  manual: { datasets: Object.fromEntries(MANUAL_DATASETS.map((d) => [d, EDIT])), min: 1, max: 1, images: true },
});

export const itemLabel = ({ dataset, key }) => `data/${dataset}.json: ${key}`;
const normalizeTitle = (title) => String(title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Structure of the whole vector: datasets, ops and counts (checked before any write).
export function checkKindShape({ kind, items }) {
  const rules = KIND_RULES[kind];
  if (!rules) return { ok: false, errors: [`unsupported submit kind: ${kind}`] };
  const errors = [];
  const list = Array.isArray(items) ? items : [];
  if (list.length < rules.min || list.length > rules.max) {
    errors.push(rules.min === rules.max
      ? `${kind} requires exactly ${rules.min} record(s), got ${list.length}`
      : `${kind} requires ${rules.min}-${rules.max} records, got ${list.length}`);
  }
  const seen = new Set();
  for (const item of list) {
    const allowed = rules.datasets[item?.dataset];
    if (!allowed) errors.push(`${itemLabel(item)}: ${kind} may not write ${item?.dataset}`);
    else if (!allowed.includes(item.op)) errors.push(`${itemLabel(item)}: ${kind} may not ${item.op} ${item.dataset}`);
    const id = `${item?.dataset}\t${item?.key}`;
    if (seen.has(id)) errors.push(`${itemLabel(item)}: duplicate item`);
    seen.add(id);
  }
  const inserts = list.filter((item) => item?.op === 'insert').length;
  if (rules.maxInserts !== undefined && inserts > rules.maxInserts) {
    errors.push(`${kind} allows at most ${rules.maxInserts} inserts, got ${inserts}`);
  }
  return { ok: errors.length === 0, errors };
}

// Per-record policy for one candidate item. Returns {errors, lint} where lint
// holds claim-linter findings (decision `lint`) and errors everything else
// (decision `validation`). ctx = submissions.context; live = the live records the
// temp export root holds; deps binds storage validation and the news inputs.
export function checkRecordPolicy({ kind, item, ctx = {}, live = {}, deps = {} }) {
  const rules = KIND_RULES[kind];
  const errors = [];
  const lint = [];
  if (!rules) return { errors: [`unsupported submit kind: ${kind}`], lint };
  if (typeof deps.validateRecord !== 'function') throw new Error('kind policy requires deps.validateRecord');
  const record = item.payload;
  const storage = deps.validateRecord(item.dataset, item.key, record);
  if (!storage?.ok) errors.push(...(storage?.errors?.length ? storage.errors : ['record failed storage validation']));
  const now = ctx.now ? new Date(ctx.now) : null;
  if (item.dataset === 'posts') {
    const weeklySlug = /^liberty-village-news-week-\d{4}-w\d{2}$/;
    if (['blog', 'blog-live'].includes(kind) && (record?.category === 'news' || weeklySlug.test(record?.slug ?? '')))
      errors.push('blog kind may not submit news or a weekly roundup slug');
    if (kind === 'news' && weeklySlug.test(record?.slug ?? '')) errors.push('news kind may not submit a weekly roundup slug');
  }

  if (rules.lint) {
    const mode = deps.lintMode || resolveLintMode(process.env);
    const result = lintPost(record, { businesses: Array.isArray(live.businesses) ? live.businesses : [], now: now ?? undefined });
    if (!result.ok && mode === 'fail') lint.push(...result.findings.map((finding) => `[${finding.rule}] ${finding.claim} — ${finding.detail}`));
  }
  if (rules.submitted) {
    if (!ctx.topicKey) errors.push('blog-live requires context.topicKey');
    else if (!now || Number.isNaN(now.getTime())) errors.push('blog-live requires context.now');
    else {
      const check = validateSubmittedPost(record, { key: ctx.topicKey }, ctx.topicKey, { now });
      if (!check.ok) errors.push(...check.errors);
    }
    if (deps.submittedAt !== undefined) errors.push(...checkGeneratedAt(ctx.now, deps.submittedAt));
  }
  if (rules.news) errors.push(...checkNewsRecord({ record, ctx, live, news: deps.news }));
  if (rules.roundup) errors.push(...checkRoundupRecordV2({ item, record, ctx, news: deps.news }));
  errors.push(...roundupCoverageIntegrityErrors({ kind, item, ctx, live }));
  if (rules.queue) {
    const queue = Array.isArray(live['topic-queue']) ? live['topic-queue'] : [];
    if (queue.some((entry) => entry?.key === item.key)) errors.push('duplicate topic key already in the live queue');
    const title = normalizeTitle(record?.title);
    if (title && queue.some((entry) => normalizeTitle(entry?.title) === title)) errors.push('duplicate topic title already in the live queue');
  }
  if (rules.images && typeof deps.checkImages === 'function') errors.push(...deps.checkImages(item));
  return { errors, lint };
}

// --generated-at must be the DATA_SHA commit time, within 36 h before submit.
export function checkGeneratedAt(generatedAt, submittedAt) {
  const generated = Date.parse(generatedAt ?? '');
  const submitted = submittedAt instanceof Date ? submittedAt.getTime() : Date.parse(submittedAt ?? '');
  if (!Number.isFinite(generated)) return ['--generated-at must be an ISO timestamp'];
  if (!Number.isFinite(submitted)) return ['submit time is unknown'];
  if (generated > submitted) return ['--generated-at is in the future'];
  if (submitted - generated > BLOG_LIVE_MAX_AGE_MS) return ['--generated-at is more than 36 h before submit'];
  return [];
}

function checkNewsRecord({ record, ctx, live, news }) {
  const errors = [];
  if (typeof record?.image !== 'string' || !record.image.startsWith('/images/')) errors.push('news image must be an existing /images/ path');
  if (!news || typeof news.loadSiteIndex !== 'function' || typeof news.imageExists !== 'function' || !news.root) {
    return [...errors, 'news policy requires the export root, site index and image checker'];
  }
  if (!ctx.evidence) return [...errors, 'news requires context.evidence'];
  const nowMs = Date.parse(ctx.now ?? '');
  if (!Number.isFinite(nowMs)) return [...errors, 'news requires context.now'];
  const siteIndex = news.loadSiteIndex(news.root);
  siteIndex?.postSlugs?.delete(record.slug);
  const validation = validateDraft({
    post: record, newsArticleStructuredData: structuredData(record), evidencePack: ctx.evidence,
    siteIndex, nowMs, imageExists: news.imageExists,
  });
  const ready = evaluatePublishReadyDraft({
    validation, post: record, root: news.root, nowMs,
    posts: Array.isArray(live.posts) ? live.posts : [], imageExists: news.imageExists, config: AUTO_PUBLISH_CONFIG,
  });
  if (!validation.ok || !validation.publishReady || !ready.ok) {
    const reasons = [
      ...(validation.failures || []).map((failure) => failure.code),
      ...(validation.humanGates || []).map((gate) => gate.code),
      ready.ok ? null : ready.code,
    ].filter(Boolean);
    errors.push(`news draft is not publish-ready${reasons.length ? `: ${[...new Set(reasons)].slice(0, 5).join(', ')}` : ''}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Weekly roundup v2 (docs/specs/weekly-roundup-v2.md §6.6, §7, §9.4).
// ---------------------------------------------------------------------------
export const ROUNDUP_TITLE_LABEL = 'Liberty Village + Exhibition Place this week';
export const ROUNDUP_UNITS_MIN = 3;
export const ROUNDUP_UNITS_MAX = 12;
export const ROUNDUP_IG_REFETCH_MAX_AGE_MS = 30 * 60 * 1000;
const ROUNDUP_IG_REFETCH_MAX_BYTES = 1024 * 1024;
const ROUNDUP_CONTEXT_MAX_CHARS = 512 * 1024;
const ROUNDUP_CHANGED = 'roundup source evidence changed or unreachable; rebuild before submit';
const HEX64 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROUNDUP_POST_SLUG = /^liberty-village-news-week-\d{4}-w\d{2}$/;
// Claims a venue listing cannot prove on its own (§6.5 impact wording).
const IMPACT_WORDING = /\b(road closures?|street closures?|lane closures?|closed to traffic|detours?|diversions?|diverted|crowds?|crowded|congestion|congested|gridlock|traffic delays?|delays?|parking restrictions?|no parking|transit disruptions?|service disruptions?|shuttle bus(?:es)?|suspended|suspensions?)\b/gi;

const hasOwn = (value, field) => value !== null && typeof value === 'object' && Object.hasOwn(value, field);
const list = (value) => (Array.isArray(value) ? value : []);
const clipText = (value, max) => (value === undefined || value === null ? undefined : String(value).slice(0, max));

// Instagram signals (sourceId agreed with the source slice).
export const isInstagramSignal = (signal) => typeof signal?.sourceId === 'string'
  && (signal.sourceId === 'rv2-instagram' || signal.sourceId.startsWith('ig:'));
export function packInstagramShortcodes(pack) {
  return [...new Set(list(pack?.signals).filter(isInstagramSignal).map((signal) => signal?.post?.shortcode)
    .filter((code) => typeof code === 'string' && code))].sort();
}

// Every coverage key a counted unit contributes (its identity plus constituents).
export const unitCoverageKeys = (unit) => [unit?.identityKey, ...list(unit?.keys), ...list(unit?.members).map((member) => member?.identityKey)]
  .filter((key) => typeof key === 'string' && key);

// Keys any live roundup post (other than `slug`) already covers.
export function liveCoveredKeys(posts, slug) {
  return new Set(list(posts).filter((post) => post?.slug !== slug && ROUNDUP_POST_SLUG.test(post?.slug ?? '') && post?.category === 'news')
    .flatMap((post) => list(post?.roundupCoverage?.keys)).filter((key) => typeof key === 'string'));
}

// Decision-relevant identity of a unit: a changed date, locality, type or
// citation set at T_submit is a changed unit.
function unitSignature(unit) {
  return canonicalJson({
    identityKey: unit?.identityKey ?? null, verdict: unit?.verdict ?? null, itemType: unit?.itemType ?? null,
    date: unit?.date ?? null, endDate: unit?.endDate ?? null,
    urls: [...new Set(list(unit?.citations).map((citation) => citation?.url))].sort(),
    members: list(unit?.members).map((member) => member?.identityKey ?? null).sort(),
  });
}

const coreAnchor = (unit) => unit?.verdict === 'core' && unit?.itemType !== 'class';

function boundedTyped(typed) {
  if (typed === undefined || typed === null) return undefined;
  const text = JSON.stringify(typed);
  if (typeof text !== 'string') return undefined;
  return text.length <= 4096 ? typed : { truncated: true, text: text.slice(0, 4000) };
}

// Bounded, durable per-unit evidence for the submission context (§8) and gate (§9.4).
export function projectRoundupUnit(unit) {
  const citation = (entry) => ({
    url: clipText(entry?.url, 500), publisher: clipText(entry?.publisher, 200), recordId: clipText(entry?.recordId, 200),
    sourceId: clipText(entry?.sourceId, 80), tier: clipText(entry?.tier, 40), feed: entry?.feed === true, listing: entry?.listing === true,
  });
  const evidence = (entry) => ({
    url: clipText(entry?.url, 500), recordId: clipText(entry?.recordId, 200),
    snapshotSha256: HEX64.test(entry?.snapshotSha256 ?? '') ? entry.snapshotSha256 : undefined,
    typed: boundedTyped(entry?.typed), subject_quote: clipText(entry?.subject_quote, 300), place_quote: clipText(entry?.place_quote, 300),
    date_quote: clipText(entry?.date_quote, 200), tier: clipText(entry?.tier, 40),
    fetchStatus: Number.isInteger(entry?.fetchStatus) ? entry.fetchStatus : undefined,
    verifyStatus: Number.isInteger(entry?.verifyStatus) ? entry.verifyStatus : clipText(entry?.verifyStatus, 40),
    verifiedAt: clipText(entry?.verifiedAt, 40),
  });
  return {
    unitId: clipText(unit?.unitId, 80), identityKey: clipText(unit?.identityKey, 200),
    keys: list(unit?.keys).slice(0, 64).map((key) => clipText(key, 200)),
    label: clipText(unit?.label ?? unit?.subject, 200), verdict: clipText(unit?.verdict, 20), itemType: clipText(unit?.itemType, 20),
    date: DATE.test(unit?.date ?? '') ? unit.date : undefined, endDate: DATE.test(unit?.endDate ?? '') ? unit.endDate : undefined,
    startTime: clipText(unit?.startTime, 5), endTime: clipText(unit?.endTime, 5),
    members: list(unit?.members).slice(0, 20).map((member) => ({
      identityKey: clipText(member?.identityKey, 200), label: clipText(member?.label ?? member?.subject, 200),
      date: DATE.test(member?.date ?? '') ? member.date : undefined, startTime: clipText(member?.startTime, 5),
    })),
    citations: list(unit?.citations).slice(0, 6).map(citation),
    evidence: list(unit?.evidence).slice(0, 6).map(evidence),
  };
}

// §6.6 integrity of roundupCoverage on EVERY write path (submit of every kind and
// the gate fixer, both of which call checkRecordPolicy). Only kind='roundup' may
// set it, and only to the value submit re-derived from the verified pack; every
// other kind may not create it and must preserve it byte-identically, including
// absence. Deleting a whole post is an admin unpublish and never reaches here.
export function roundupCoverageIntegrityErrors({ kind, item, ctx = {}, live = {} }) {
  if (item?.dataset !== 'posts') return [];
  const record = item.payload;
  const has = hasOwn(record, 'roundupCoverage');
  if (kind === 'roundup') {
    if (!has) return ['roundup post requires roundupCoverage'];
    if (!hasOwn(ctx, 'roundupCoverage')) return ['roundup context lacks its verified roundupCoverage'];
    return canonicalJson(record.roundupCoverage) === canonicalJson(ctx.roundupCoverage) ? [] : ['roundupCoverage does not match the verified pack'];
  }
  if (item.op === 'insert') return has ? [`roundupCoverage is roundup-only trusted metadata; a ${kind} insert may not create it`] : [];
  const current = list(live.posts).find((post) => post?.slug === item.key);
  const liveHas = hasOwn(current, 'roundupCoverage');
  if (has !== liveHas || (has && canonicalJson(record.roundupCoverage) !== canonicalJson(current.roundupCoverage)))
    return [`roundupCoverage must be preserved byte-identically by a ${kind} edit`];
  return [];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dateForms(date) {
  if (!DATE.test(date ?? '')) return [];
  const [year, month, day] = date.split('-').map(Number);
  const name = MONTHS[month - 1];
  if (!name) return [];
  return [date, `${name} ${day}, ${year}`, `${name} ${day}`, `${name.slice(0, 3)} ${day}`, `${name.slice(0, 3)}. ${day}`];
}
const mentionsDate = (text, date) => dateForms(date).some((form) => new RegExp(`\\b${form.replace(/[.]/g, '\\.')}(?!\\d)`).test(text));
const markdownUrls = (text) => [...String(text).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
const bareUrls = (text) => [...String(text).matchAll(/https?:\/\/[^\s)\]>'"]+/g)].map((match) => match[0].replace(/[.,;:!?]+$/, ''));
const unitQuotes = (unit) => list(unit?.evidence).flatMap((entry) => [entry?.subject_quote, entry?.place_quote, entry?.date_quote])
  .filter((quote) => typeof quote === 'string').join('\n').toLowerCase();

// The v2 post policy, run at submit, every gate round and every fixer revision
// against the verified units stored in submissions.context.
export function checkRoundupRecordV2({ item, record, ctx = {}, news }) {
  const errors = [];
  if (ctx.pipeline !== 'structured-v2') return ['roundup context is not structured-v2'];
  if (record?.category !== 'news') errors.push('roundup category must be news');
  let expected;
  try {
    expected = roundupSlug(ctx.isoWeek);
    if (isoWeekOf(ctx.weekStartUtc).isoWeek !== ctx.isoWeek ||
      isoWeekOf(ctx.weekStartUtc).weekStartUtc !== ctx.weekStartUtc) errors.push('roundup weekStartUtc mismatch');
  } catch { errors.push('roundup ISO week is invalid'); }
  if (item.key !== expected || record?.slug !== expected) errors.push('roundup key/slug mismatch');
  const nowMs = Date.parse(ctx.temporalValidationNow ?? ctx.now ?? '');
  if (!Number.isFinite(nowMs) || isoWeekOf(nowMs).isoWeek !== ctx.isoWeek) errors.push('roundup now must be in its ISO week');
  if (typeof record?.image !== 'string' || !record.image.startsWith('/images/') ||
    !news || typeof news.imageExists !== 'function' || !news.imageExists(record.image))
    errors.push('roundup image must be an existing /images/ path');
  const title = String(record?.title ?? '');
  const description = String(record?.description ?? '');
  if (!title.startsWith(`${ROUNDUP_TITLE_LABEL}: `)) errors.push(`roundup title must start with "${ROUNDUP_TITLE_LABEL}: "`);
  if (/news roundup|weekly update/i.test(`${title} ${description}`)) errors.push('roundup v2 must not use the v1 news roundup/weekly update labels');

  const units = list(ctx.units);
  const still = list(ctx.stillInEffect);
  if (units.length < ROUNDUP_UNITS_MIN || units.length > ROUNDUP_UNITS_MAX)
    errors.push(`roundup requires ${ROUNDUP_UNITS_MIN}-${ROUNDUP_UNITS_MAX} counted units, got ${units.length}`);
  if (!units.some(coreAnchor)) errors.push('roundup requires at least one core non-class unit');
  for (const unit of units) {
    if (!['core', 'adjacent'].includes(unit?.verdict) || !unit?.identityKey || !list(unit?.citations).length)
      errors.push('roundup unit lacks verdict, identity or citations');
  }

  const body = String(record?.content || '');
  const stillAt = body.search(/^###\s+Still in effect\s*$/m);
  const numbered = stillAt >= 0 ? body.slice(0, stillAt) : body;
  const stillPart = stillAt >= 0 ? body.slice(stillAt) : '';
  const headings = numbered.match(/^##\s+\d+\.\s+.+$/gm) || [];
  const parts = numbered.split(/^##\s+\d+\.\s+.+$/m).slice(1);
  if (headings.length !== units.length) errors.push('roundup unit section count mismatch');
  if (/^##\s+\d+\./m.test(stillPart)) errors.push('roundup Still in effect must be the trailing unnumbered section');

  // Citations: each section cites exactly its own unit's URLs; a URL shared by two
  // units is allowed only for feed/listing citations with distinct record IDs.
  const byUrl = new Map();
  for (const unit of units) for (const citation of list(unit?.citations)) {
    if (!byUrl.has(citation?.url)) byUrl.set(citation?.url, []);
    byUrl.get(citation?.url).push({ unit, citation });
  }
  for (const [, uses] of byUrl) {
    const owners = new Set(uses.map((use) => use.unit));
    if (owners.size < 2) continue;
    const records = uses.map((use) => use.citation?.recordId);
    if (!uses.every((use) => use.citation?.feed === true || use.citation?.listing === true)
      || records.some((id) => typeof id !== 'string' || !id) || new Set(records).size !== records.length)
      errors.push('roundup URL shared across units without distinct feed/listing records');
  }
  const unitUrls = new Set(byUrl.keys());
  const stillUrls = new Set(still.flatMap((unit) => list(unit?.citations).map((citation) => citation?.url)));
  const linked = markdownUrls(body);
  for (const url of bareUrls(body)) {
    if (!unitUrls.has(url) && !stillUrls.has(url)) errors.push('roundup body cites URL outside the verified pack');
    if (!linked.includes(url)) errors.push('roundup source URL must be a visible Markdown citation');
  }
  for (const url of markdownUrls(stillPart)) if (!stillUrls.has(url)) errors.push('roundup Still in effect cites a URL outside its verified items');

  const verifiedImpactDates = new Set(units.filter((unit) => ['road', 'transit'].includes(unit?.itemType)).map((unit) => unit?.date));
  units.forEach((unit, index) => {
    const heading = headings[index] || '';
    const part = String(parts[index] || '');
    const section = `${heading}\n${part}`;
    const own = new Set(list(unit?.citations).map((citation) => citation?.url));
    const partUrls = markdownUrls(part);
    if (!partUrls.length || partUrls.some((url) => !own.has(url))) errors.push('roundup section has cross-unit or missing citation');
    for (const url of own) if (!partUrls.includes(url)) errors.push('roundup unit citation missing from its section');
    const dates = list(unit?.members).length ? list(unit.members).map((member) => member?.date) : [unit?.date];
    if (dates.some((date) => !DATE.test(date ?? ''))) errors.push('roundup unit actual date missing');
    else if (dates.some((date) => !mentionsDate(section, date))) errors.push('roundup section must state the unit\'s actual date');
    if (unit?.verdict !== 'core' && /\bin Liberty Village\b/i.test(section)) errors.push('roundup adjacent unit must be described as near, not in, Liberty Village');
    if (!['road', 'transit'].includes(unit?.itemType)) {
      const quotes = unitQuotes(unit);
      for (const match of section.matchAll(IMPACT_WORDING)) {
        if (!quotes.includes(match[0].toLowerCase()) && !verifiedImpactDates.has(unit?.date)) {
          errors.push('roundup impact wording is not supported by a verified road/transit item or quote');
          break;
        }
      }
    }
  });
  return [...new Set(errors)];
}

// Bounded read of a regular file the trusted runner wrote.
function readBoundedRunnerJson(file, maxBytes, label) {
  let fd;
  try { fd = fs.openSync(path.resolve(file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { throw new ValidationError(`${label} unreadable: ${error.code ?? 'open failed'}`); }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 2 || stat.size > maxBytes) throw new ValidationError(`${label} must be a bounded regular file`);
    const bytes = Buffer.alloc(stat.size);
    if (fs.readSync(fd, bytes, 0, stat.size, 0) !== stat.size) throw new ValidationError(`${label} changed while reading`);
    try { return JSON.parse(bytes.toString('utf8')); } catch { throw new ValidationError(`${label} is not JSON`); }
  } finally { fs.closeSync(fd); }
}

// The runner-provided Instagram re-fetch file (§4.4 N1). Submit never calls the
// provider: it checks the file deterministically; row-level checks (status,
// owner, timestamp, verbatim record text) are the verifier's, fed these rows.
// Anything but `ok` means every Instagram unit is treated as changed.
export function checkIgRefetch(file, { shortcodes, submittedAt }) {
  if (!shortcodes.length) return { status: 'not-needed' };
  if (!file || file === true) return { status: 'missing' };
  let data;
  try { data = readBoundedRunnerJson(file, ROUNDUP_IG_REFETCH_MAX_BYTES, 'roundup ig-refetch'); }
  catch { return { status: 'missing' }; }
  const rows = data?.rows;
  const rowOk = (entry) => entry && typeof entry === 'object' && typeof entry.shortcode === 'string'
    && ['ok', 'missing', 'private'].includes(entry.status);
  if (!Array.isArray(rows) || !rows.every(rowOk)) return { status: 'invalid' };
  const listed = rows.map((entry) => entry.shortcode);
  if (new Set(listed).size !== listed.length || canonicalJson([...listed].sort()) !== canonicalJson(shortcodes)) return { status: 'mismatch' };
  const fetchedAt = Date.parse(data.fetchedAt ?? '');
  const age = submittedAt - fetchedAt;
  if (!Number.isFinite(fetchedAt) || age < 0 || age > ROUNDUP_IG_REFETCH_MAX_AGE_MS) return { status: 'stale' };
  return { status: 'ok', refetch: { fetchedAt: data.fetchedAt, provider: data.provider, rows } };
}

// The v2 pipeline modules, loaded lazily so content/ never depends on them unless
// a roundup is submitted. Missing exports fail closed.
export async function loadRoundupV2() {
  let verify; let roundup; let evidence;
  try {
    [verify, roundup, evidence] = await Promise.all([
      import('../news-pilot/roundup-verify.mjs'), import('../news-pilot/roundup.mjs'), import('../news-pilot/roundup-evidence.mjs'),
    ]);
  } catch { throw new ValidationError('roundup v2 verifier unavailable'); }
  const api = {
    verifyRoundupForms: verify.verifyRoundupForms,
    roundupCoverageFromPack: verify.roundupCoverageFromPack ?? roundup.roundupCoverageFromPack ?? evidence.roundupCoverageFromPack,
    planRoundupV2: roundup.planRoundupV2 ?? verify.planRoundupV2,
    roundupPackDigest: evidence.roundupPackDigest,
  };
  if (Object.values(api).some((fn) => typeof fn !== 'function')) throw new ValidationError('roundup v2 verifier unavailable');
  return api;
}

// Submit-time re-verification at T_submit (§9.4): fresh fetches through the same
// verifier, prior coverage reconstructed from the live DB posts, the §7 rule
// re-applied, and roundupCoverage re-derived from the re-verified pack.
export async function reverifyRoundup({ pack, result, post, livePosts, submittedAt, igRefetchFile, api, fetcher }) {
  const nowIso = new Date(submittedAt).toISOString();
  const posts = list(livePosts).filter((entry) => entry?.slug !== result.slug);
  const shortcodes = packInstagramShortcodes(pack);
  const ig = checkIgRefetch(igRefetchFile, { shortcodes, submittedAt });
  let signals = list(pack.signals);
  let forms = list(pack.forms);
  if (shortcodes.length && ig.status !== 'ok') {
    // Missing, stale or mismatched file: every Instagram unit is changed.
    const dropped = new Set(signals.filter(isInstagramSignal).map((signal) => signal.signalId));
    signals = signals.filter((signal) => !dropped.has(signal.signalId));
    forms = forms.filter((form) => !dropped.has(form?.signalId));
  }
  // Round-2 private-person refusals (§9.2) stay removed: the runner records their
  // key digests in the pack, and no fresh item carrying one is ever re-planned.
  const refused = pack.refusedKeyDigests ?? [];
  if (!Array.isArray(refused) || !refused.every((entry) => HEX64.test(entry ?? '')))
    throw new ValidationError('roundup pack refusedKeyDigests must be sha256 digests');
  const refusedSet = new Set(refused);
  const isRefused = (item) => [item?.identityKey, ...list(item?.keys)].some((key) =>
    typeof key === 'string' && refusedSet.has(createHash('sha256').update(key).digest('hex')));
  let verified;
  let plan;
  try {
    verified = await api.verifyRoundupForms({ signals, forms, now: nowIso, posts,
      ...(ig.status === 'ok' ? { igRefetch: ig.refetch } : {}), ...(fetcher ? { fetcher } : {}) });
    plan = api.planRoundupV2(list(verified?.items).filter((item) => !isRefused(item)), { now: nowIso, posts });
  } catch (error) {
    if (error?.code === 'ValidationError') throw error;
    throw new ValidationError(ROUNDUP_CHANGED);
  }
  if (!HEX64.test(verified?.verifyDigest ?? '')) throw new ValidationError(ROUNDUP_CHANGED);
  // planRoundupV2 returns the counted units as `countedItems` and their count as `units`.
  if (!Array.isArray(plan?.countedItems) || plan.units !== plan.countedItems.length) throw new ValidationError(ROUNDUP_CHANGED);
  const freshUnits = plan.countedItems;
  const errors = [];
  const packSigs = list(pack.units).map(unitSignature).sort();
  const freshSigs = freshUnits.map(unitSignature).sort();
  if (canonicalJson(packSigs) !== canonicalJson(freshSigs)) errors.push(ROUNDUP_CHANGED);
  const anchors = Number.isInteger(plan?.coreAnchorUnits) ? plan.coreAnchorUnits : freshUnits.filter(coreAnchor).length;
  if (plan?.decision !== 'publish' || freshUnits.length < ROUNDUP_UNITS_MIN || anchors < 1)
    errors.push('roundup edition is below 3 units / 1 core anchor at submit; rebuild before submit');
  const covered = liveCoveredKeys(posts, result.slug);
  if (list(pack.units).some((unit) => unitCoverageKeys(unit).some((key) => covered.has(key))))
    errors.push('roundup pack counts a key already covered by a live roundup; rebuild before submit');
  if (errors.length) throw new ValidationError([...new Set(errors)].join('; '));
  const stillInEffect = list(plan?.stillInEffect);
  const derived = api.roundupCoverageFromPack({ ...pack, units: freshUnits, stillInEffect });
  if (list(derived?.keys).length > ROUNDUP_COVERAGE_MAX_KEYS)
    throw new ValidationError(`roundup coverage has more than ${ROUNDUP_COVERAGE_MAX_KEYS} keys; submission refused`);
  const shape = roundupCoverageErrors({ slug: result.slug, category: 'news', roundupCoverage: derived });
  if (shape.length) throw new ValidationError(`roundup derived coverage invalid: ${shape.join(', ')}`);
  if (canonicalJson(post?.roundupCoverage ?? null) !== canonicalJson(derived))
    throw new ValidationError('roundupCoverage does not match the verified pack');
  return {
    verifyDigest: verified.verifyDigest,
    counts: { units: freshUnits.length, coreUnits: freshUnits.filter((unit) => unit?.verdict === 'core').length, coreAnchorUnits: anchors },
    units: freshUnits.map(projectRoundupUnit),
    stillInEffect: stillInEffect.slice(0, 20).map(projectRoundupUnit),
    roundupCoverage: derived,
    instagram: { refetch: ig.status },
  };
}

async function roundupContext({ db, opts, items, clock, idempotencyKey, live, roundup = {} }) {
  if (!opts.roundupOut || opts.roundupOut === true) throw new ValidationError('roundup requires --roundup-out');
  if (opts.igRefetch === true) throw new ValidationError('--ig-refetch requires a file');
  const result = readJson(path.join(opts.roundupOut, 'result.json'), 'roundup result.json');
  const pack = readJson(path.join(opts.roundupOut, 'pack.json'), 'roundup pack.json');
  if (result?.pipeline !== 'structured-v2' || !HEX64.test(result.verifyDigest ?? ''))
    throw new ValidationError('roundup result.json is not a structured-v2 result with a verifyDigest');
  if (!Array.isArray(pack?.units) || !Array.isArray(pack.signals) || !Array.isArray(pack.forms))
    throw new ValidationError('roundup pack.json requires units, signals and forms');
  const api = roundup.api ?? await loadRoundupV2();
  const packDigest = api.roundupPackDigest(pack);
  if (result.packDigest !== packDigest) throw new ValidationError('roundup packDigest mismatch');
  if (!result.isoWeek || !result.now || !Number.isFinite(Date.parse(result.now))) throw new ValidationError('roundup result requires isoWeek and now');
  const week = isoWeekOf(result.now);
  if (week.isoWeek !== result.isoWeek || result.slug !== roundupSlug(result.isoWeek) || pack.isoWeek !== result.isoWeek ||
    items.length !== 1 || items[0].key !== result.slug || items[0].payload?.slug !== result.slug)
    throw new ValidationError('roundup result slug/week does not match candidate');
  // Keep the original context on idempotent replay, even after its freshness window.
  const prior = (await db.query('select context from content.submissions where idempotency_key=$1', [idempotencyKey])).rows[0];
  if (prior) return prior.context;
  const submittedAt = new Date(clock()).getTime();
  if (!Number.isFinite(submittedAt) || isoWeekOf(submittedAt).isoWeek !== result.isoWeek)
    throw new ValidationError('roundup submit is outside its ISO week');
  const ageMs = submittedAt - Date.parse(result.now);
  if (ageMs < 0 || ageMs > ROUNDUP_REVALIDATE_MAX_AGE_MS)
    throw new ValidationError('roundup pack must be revalidated before submit');
  const fresh = await reverifyRoundup({ pack, result, post: items[0].payload, livePosts: live.posts, submittedAt,
    igRefetchFile: opts.igRefetch, api, fetcher: roundup.fetcher });
  const context = { pipeline: 'structured-v2', now: result.now, temporalValidationNow: new Date(submittedAt).toISOString(),
    isoWeek: result.isoWeek, weekStartUtc: week.weekStartUtc, packDigest, planVerifyDigest: result.verifyDigest, ...fresh };
  if (JSON.stringify(context).length > ROUNDUP_CONTEXT_MAX_CHARS) throw new ValidationError('roundup evidence exceeds the context bound');
  return context;
}

// Whole-vector policy: shape, then every record. decision is `lint` only when the
// claim linter is the sole failure, else `validation`.
export function checkKindPolicy({ kind, items, ctx = {}, live = {}, deps = {} }) {
  const shape = checkKindShape({ kind, items });
  const errors = [...shape.errors];
  const lint = [];
  if (KIND_RULES[kind]) {
    for (const item of items) {
      const result = checkRecordPolicy({ kind, item, ctx, live, deps });
      errors.push(...result.errors.map((error) => `${itemLabel(item)}: ${error}`));
      lint.push(...result.lint.map((finding) => `${itemLabel(item)}: ${finding}`));
    }
  }
  const ok = errors.length === 0 && lint.length === 0;
  return { ok, decision: ok ? null : (errors.length ? 'validation' : 'lint'), errors: [...errors, ...lint], lint };
}

// ---------------------------------------------------------------------------
// Live context: one readLive snapshot written as a temp export root (data/*.json),
// the records the policy reads, and the live /media paths. Shared with gate g1.
// ---------------------------------------------------------------------------
export async function liveContext(db) {
  const snapshot = await readLive(db);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-content-live-'));
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const live = {};
  for (const [dataset, value] of Object.entries(snapshot.datasets)) {
    live[dataset] = value.records;
    fs.writeFileSync(path.join(root, 'data', registry[dataset].file), serialize(dataset, value.records));
  }
  return {
    snapshot, root, live,
    mediaPaths: snapshot.media.map((asset) => asset.path),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

// deploy-hook ref the target rebuilds; the workflow fetches it right before submit.
// Local lv_test_* databases have no deploy hook ref and check against HEAD.
export function sourceRefFor(target) {
  if (target === 'production') return 'origin/main';
  if (target === 'staging') return 'origin/staging';
  return 'HEAD';
}

export const assetExistsIn = (db) => async (assetPath) => (await db.query('select 1 from content.assets where path=$1', [assetPath])).rowCount > 0;

// Policy bindings for one submission: storage validation and the news inputs.
export function policyDeps({ kind, context, checkout }) {
  const deps = { validateRecord };
  if (kind === 'news' || kind === 'roundup') deps.news = { root: context.root, loadSiteIndex: loadSiteLinkIndex, imageExists: createLocalImageExists(checkout) };
  return deps;
}

// Gate-time image re-check: after submit every image is a stored /media asset or a
// file tracked at sourceRef; workspace bytes are never read or converted here.
export async function recheckImages({ db, kind, items, checkout, sourceRef }) {
  if (!KIND_RULES[kind]?.images) return [];
  try {
    await prepareImages({
      items, root: checkout, sourceRef, registry, verifyOnly: true,
      resolveAssets: (list) => resolveAssets(db, list), assetExists: assetExistsIn(db),
    });
    return [];
  } catch (error) {
    if (error.code === 'ValidationError') return [error.message];
    throw error;
  }
}

const readJson = (file, label) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new ValidationError(`${label} unreadable: ${error.message}`); }
};

// --dir: diff data/* against the immutable export baseline (never the DB's current state).
export function diffWorkspace(root, manifest) {
  const items = [];
  const discoverySeen = [];
  for (const [dataset, baseline] of Object.entries(manifest.datasets || {})) {
    const entry = registry[dataset];
    if (!entry) continue;
    const records = fromFile(dataset, readJson(path.join(root, 'data', entry.file), `data/${entry.file}`));
    const workspace = new Map(records.map((record) => [keyOf(dataset, record), record]));
    if (workspace.size !== records.length) throw new ValidationError(`duplicate key in data/${entry.file}`);
    for (const key of Object.keys(baseline.entries || {})) {
      if (!workspace.has(key)) throw new ValidationError(`deletion refused: data/${entry.file}#${key} is in the baseline but missing from the workspace`);
    }
    for (const [key, record] of workspace) {
      const base = baseline.entries?.[key];
      if (dataset === 'discovery-seen') {
        if (!base) discoverySeen.push({ nameKey: record.nameKey, firstSeen: record.firstSeen });
        else if (recordSha(record) !== base.sha) throw new ValidationError(`discovery-seen is insert-only: ${key} changed`);
        continue;
      }
      if (base && recordSha(record) === base.sha) continue;
      items.push({ dataset, key, op: base ? 'update' : 'insert', payload: record, expectedLiveRev: base ? base.rev : null });
    }
  }
  return { items, discoverySeen };
}

function recordFileItems(file, dataset, manifest) {
  if (!registry[dataset] || dataset === 'discovery-seen') throw new ValidationError(`unknown dataset ${dataset}`);
  const record = readJson(file, file);
  const key = keyOf(dataset, record);
  if (typeof key !== 'string' || !key) throw new ValidationError(`${file} has no ${dataset} key`);
  const base = manifest.datasets?.[dataset]?.entries?.[key];
  if (base && recordSha(record) === base.sha) return [];
  return [{ dataset, key, op: base ? 'update' : 'insert', payload: record, expectedLiveRev: base ? base.rev : null }];
}

export function actorFor(opts, env = process.env) {
  const actor = opts.actor ?? (env.GITHUB_ACTIONS === 'true' ? `gha:${env.GITHUB_WORKFLOW}#${env.GITHUB_RUN_ID}` : null);
  if (!actor || actor === true) throw new ValidationError('--actor required');
  return actor;
}

// Trusted blog source pack: bounded read of a regular file the trusted runner wrote.
function readSourcePack(file) {
  let fd;
  try { fd = fs.openSync(path.resolve(file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { throw new ValidationError(`blog source pack unreadable: ${error.code ?? 'open failed'}`); }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 2 || stat.size > BLOG_SOURCE_PACK_MAX_BYTES) throw new ValidationError('blog source pack must be a bounded regular file');
    const bytes = Buffer.alloc(stat.size);
    if (fs.readSync(fd, bytes, 0, stat.size, 0) !== stat.size) throw new ValidationError('blog source pack changed while reading');
    try { return JSON.parse(bytes.toString('utf8')); } catch { throw new ValidationError('blog source pack is not JSON'); }
  } finally { fs.closeSync(fd); }
}

// Bounded facts the gate reviewer and fixer see; never the scratch sidecar.
export function sourcePackFacts(pack) {
  const clip = (value) => String(value ?? '').slice(0, PACK_FACT_CHARS);
  const rows = (list) => (Array.isArray(list) ? list : []).slice(0, 12).map((claim) => ({ field: clip(claim?.field).slice(0, 40), verbatim: clip(claim?.verbatim) }));
  const facts = {
    fingerprint: pack.fingerprint, sha256: createHash('sha256').update(canonicalJson(pack)).digest('hex'),
    topic: clip(pack.topic).slice(0, 300), intentKey: clip(pack.intentKey).slice(0, 200), reserve: pack.reserve === true, generatedAt: pack.generatedAt,
    sources: pack.sources.slice(0, 12).map((source) => ({ id: clip(source.id).slice(0, 200), name: clip(source.name).slice(0, 200), claims: rows(source.claims), premiseClaims: rows(source.premiseClaims) })),
    directorySlugs: (pack.internal?.directorySlugs ?? []).slice(0, 12).map((slug) => clip(slug).slice(0, 200)),
  };
  if (JSON.stringify(facts).length > PACK_FACTS_MAX_CHARS) throw new ValidationError('blog source pack facts exceed the context bound');
  return facts;
}

// The pack's own verified internal inventory (posts/services/topics as captured).
const packInventory = (pack) => Object.fromEntries([['posts', 'postSlugs'], ['services', 'serviceSlugs'], ['topics', 'topicSlugs']]
  .map(([name, field]) => [name, (Array.isArray(pack?.internal?.[field]) ? pack.internal[field] : []).map((slug) => ({ slug }))]));

// Every internal link the draft actually uses must still resolve to a live record.
function draftLinksNotLive(post, live) {
  const known = (records) => new Set((Array.isArray(records) ? records : []).map((record) => record?.slug));
  const targets = { blog: known(live.posts), best: known(live.services), guide: known(live.topics), directory: known(live.businesses) };
  const list = (value) => (Array.isArray(value) ? value : []);
  const refs = [
    ...list(post?.relatedPosts).map((slug) => ['blog', slug]), ...list(post?.relatedServices).map((slug) => ['best', slug]),
    ...list(post?.relatedTopics).map((slug) => ['guide', slug]), ...list(post?.relatedBusinesses).map((slug) => ['directory', slug]),
    ...[...String(post?.content ?? '').matchAll(/\]\(\/(blog|guide|best|directory)\/([^)/#?\s]+)/g)].map((match) => [match[1], match[2]]),
  ];
  return [...new Set(refs.filter(([kind, slug]) => !targets[kind].has(slug)).map(([kind, slug]) => `internal-link-not-live:/${kind}/${String(slug).slice(0, 120)}`))];
}

// Binds a blog draft to its trusted pack (businesses, topic, premises, internal
// links, lint) against the pack's OWN captured inventory, so unrelated live
// posts/services/topics added later cannot unbind it; links the draft uses must
// still be live. After submit the hero is a verified /media asset owned by the
// image pipeline, so the gate passes checkImage:false.
export function blogDraftBindingErrors(post, pack, { live = {}, imagePaths = [], now, checkImage = true } = {}) {
  const { errors } = checkDraftAgainstPack(post, pack, { businesses: live.businesses ?? [], ...packInventory(pack), imagePaths, now });
  return [...errors.filter((error) => checkImage || error !== 'missing-or-invalid-hero-image'), ...draftLinksNotLive(post, live)]
    .slice(0, 20).map((error) => `blog draft is not bound to its source pack: ${error}`);
}

function workspaceBlogImages(root) {
  try { return fs.readdirSync(path.join(root, 'public', 'images', 'blog')).filter((name) => /^[a-z0-9-]+\.jpg$/.test(name)).slice(0, 5000).map((name) => `/images/blog/${name}`); }
  catch { return []; }
}

async function blogSourcePackContext({ db, opts, live, clock, idempotencyKey, draftItems, root }) {
  const pack = readSourcePack(opts.sourcePack);
  // Business claims re-verify against live records; inventory is the pack's own
  // (live link targets are checked by blogDraftBindingErrors).
  const checked = verifySourcePack(pack, {
    businesses: live.businesses, ...packInventory(pack), now: new Date(clock()), maxAgeMs: BLOG_SOURCE_PACK_MAX_AGE_MS,
  });
  if (!checked.ok) throw new ValidationError(`blog source pack failed verification: ${checked.errors.slice(0, 5).join(', ')}`);
  // A cadence key names one durable attempt; its recorded digest must be this pack.
  if (String(idempotencyKey).startsWith('cadence:')) {
    const attempt = (await db.query('select source_pack_digest from content.cadence_attempts where idempotency_key=$1 and target=$2', [idempotencyKey, db.target])).rows[0];
    if (!attempt || attempt.source_pack_digest !== pack.fingerprint) throw new ValidationError('blog source pack does not match its cadence attempt');
  }
  // The workspace draft (before /media conversion) must be the post this pack grounds.
  const binding = blogDraftBindingErrors(draftItems?.[0]?.payload, pack, { live, imagePaths: workspaceBlogImages(root), now: new Date(clock()) });
  if (binding.length) throw new ValidationError(binding.join('; '));
  // Facts feed review/fixer evidence; the full verified pack re-binds every gate round.
  return { ...sourcePackFacts(pack), pack };
}

// Gate context: identical inputs for every round and every resume.
async function buildContext({ db, kind, opts, items, clock, idempotencyKey, live, draftItems, root, roundup }) {
  if (opts.sourcePack !== undefined && kind !== 'blog') throw new ValidationError('--source-pack is only for blog');
  if (opts.igRefetch !== undefined && kind !== 'roundup') throw new ValidationError('--ig-refetch is only for roundup');
  if (opts.sourcePack === true) throw new ValidationError('--source-pack requires a file');
  if (kind === 'blog-live') {
    if (!opts.topicKey || opts.topicKey === true) throw new ValidationError('blog-live requires --topic-key');
    if (!opts.generatedAt || opts.generatedAt === true) throw new ValidationError('blog-live requires --generated-at');
    const stale = checkGeneratedAt(opts.generatedAt, new Date(clock()));
    if (stale.length) throw new ValidationError(stale.join('; '));
    return { now: new Date(Date.parse(opts.generatedAt)).toISOString(), topicKey: opts.topicKey };
  }
  if (kind === 'news') {
    if (!opts.newsOut || opts.newsOut === true) throw new ValidationError('news requires --news-out');
    const result = readJson(path.join(opts.newsOut, 'result.json'), 'news result.json');
    if (result.published !== 1) throw new ValidationError('news result.json is not published===1');
    if (items.length !== 1 || result.slug !== items[0].key) throw new ValidationError('news result.json slug does not match the candidate');
    if (!result.clusterId || !Date.parse(result.now ?? '')) throw new ValidationError('news result.json requires clusterId and now');
    const evidence = readJson(path.join(opts.newsOut, `evidence-${result.clusterId}.json`), 'news evidence');
    return { now: result.now, clusterId: result.clusterId, evidence };
  }
  if (kind === 'roundup') return roundupContext({ db, opts, items, clock, idempotencyKey, live, roundup });
  // Submit wall time; an idempotent replay reuses the stored time so the request hash is stable.
  const prior = (await db.query('select context from content.submissions where idempotency_key=$1', [idempotencyKey])).rows[0];
  // A cadence blog is always pack-bound; a pack-bound replay must still carry its full stored pack.
  const cadenceBlog = kind === 'blog' && String(idempotencyKey).startsWith('cadence:');
  if (cadenceBlog && !opts.sourcePack) throw new ValidationError('cadence blog submit requires --source-pack');
  if (prior && opts.sourcePack && !prior.context?.sourcePack?.pack) throw new ValidationError('blog replay lacks its stored source pack');
  // The stored context (including verified pack facts) is immutable on replay.
  if (prior && opts.sourcePack) return prior.context;
  const now = prior?.context?.now ?? new Date(clock()).toISOString();
  return opts.sourcePack ? { now, sourcePack: await blogSourcePackContext({ db, opts, live, clock, idempotencyKey, draftItems, root }) } : { now };
}

// opts: {kind, idempotencyKey, actor, dir | recordFile+dataset+baseline, topicKey, generatedAt,
// newsOut, roundupOut, igRefetch (roundup only: runner-owned Instagram re-fetch file), sourcePack (blog only:
// trusted runner pack file)}; roundup = {api, fetcher} test seams for the v2 verifier. Returns {result, exitCode}. Never gates.
export async function submitContent(db, opts, { env = process.env, clock = Date.now, checkout = process.cwd(), roundup = {} } = {}) {
  const kind = opts.kind;
  if (!KIND_RULES[kind]) throw new ValidationError(`unsupported submit kind: ${kind}`);
  const idempotencyKey = opts.idempotencyKey;
  if (!idempotencyKey || idempotencyKey === true) throw new ValidationError('--idempotency-key required');
  const actor = actorFor(opts, env);
  let manifest;
  let items;
  let discoverySeen = [];
  let root;
  if (opts.dir) {
    root = path.resolve(opts.dir);
    manifest = readJson(path.join(root, '.content-export', 'manifest.json'), 'export manifest');
    ({ items, discoverySeen } = diffWorkspace(root, manifest));
  } else if (opts.recordFile) {
    if (!opts.dataset || !opts.baseline) throw new ValidationError('--record-file requires --dataset and --baseline');
    root = path.resolve(opts.root || checkout);
    manifest = readJson(path.resolve(opts.baseline), 'baseline manifest');
    items = recordFileItems(path.resolve(opts.recordFile), opts.dataset, manifest);
  } else {
    throw new ValidationError('submit requires --dir or --record-file');
  }
  if (discoverySeen.length && kind !== 'business') throw new ValidationError(`${kind} may not add discovery-seen entries`);
  if (items.length === 0 && discoverySeen.length === 0) return { result: { submissionId: null, reason: 'no-changes' }, exitCode: 0 };
  const shape = checkKindShape({ kind, items });
  if (!shape.ok) throw new ValidationError(shape.errors.join('; '));

  const sourceRef = sourceRefFor(db.target);
  const images = KIND_RULES[kind].images
    ? await prepareImages({ items, root, sourceRef, registry, resolveAssets: (list) => resolveAssets(db, list), assetExists: assetExistsIn(db) })
    : { items, assets: [], report: [] };
  const liveCtx = await liveContext(db);
  let context;
  try {
    context = await buildContext({ db, kind, opts, items: images.items, clock, idempotencyKey,
      live: liveCtx.live, draftItems: items, root, roundup });
    const policy = checkKindPolicy({
      kind, items: images.items, ctx: context, live: liveCtx.live,
      deps: policyDeps({ kind, context: { root: liveCtx.root }, checkout: root }),
    });
    if (!policy.ok) throw new ValidationError(policy.errors.join('; '));
  } finally {
    liveCtx.cleanup();
  }
  const created = await createSubmission(db, {
    kind, target: db.target, actor, idempotencyKey, baseSnapshotId: manifest.snapshot_id ?? null, context,
    items: images.items.map(({ dataset, key, op, payload, expectedLiveRev }) => ({ dataset, key, op, payload, expectedLiveRev })),
    assets: images.assets, discoverySeen,
  });
  let outItems = created.items;
  if (created.existing) {
    const { items: stored } = await getSubmission(db, created.submissionId);
    const round0 = (await db.query('select dataset,key,rev from content.round_items where submission_id=$1 and round=0', [created.submissionId])).rows;
    const revOf = new Map(round0.map((row) => [`${row.dataset}\t${row.key}`, row.rev]));
    outItems = stored.map((item) => ({ dataset: item.dataset, key: item.key, op: item.op, rev: revOf.get(`${item.dataset}\t${item.key}`) ?? null, expectedLiveRev: item.expected_live_rev }));
  }
  return {
    result: {
      submissionId: created.submissionId, existing: created.existing, items: outItems,
      assets: images.report, discoverySeenAdded: created.discoverySeenAdded ?? 0,
    },
    exitCode: 0,
  };
}
