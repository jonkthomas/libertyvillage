// `content submit` (§4.4). This module owns the kind policy that submit, gate g1
// and the repair adapter all apply, so every round and every repair re-runs the
// exact checks the submission first passed.
import { lintPost, resolveLintMode } from '../blog-lint.mjs';
import { validateSubmittedPost } from '../supervisor/pi-session.mjs';
import { validateDraft } from '../news-pilot/draft-validate.mjs';
import { AUTO_PUBLISH_CONFIG, evaluatePublishReadyDraft } from '../news-pilot/publish-gate.mjs';
import { structuredData } from '../automation/news-preflight.mjs';

export const SITE_DATASETS = Object.freeze(['businesses', 'posts', 'buildings', 'neighborhoods', 'services', 'topics', 'guide-hub']);
export const BLOG_LIVE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

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
  'topic-discovery': { datasets: { 'topic-queue': INSERT }, min: 1, max: 25, queue: true },
  seo: {
    datasets: Object.fromEntries(['services', 'topics', 'neighborhoods', 'buildings', 'guide-hub', 'businesses', 'posts'].map((d) => [d, EDIT])),
    min: 1, max: 15, maxInserts: 2, images: true,
  },
  manual: { datasets: Object.fromEntries(SITE_DATASETS.map((d) => [d, EDIT])), min: 1, max: 1, images: true },
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
