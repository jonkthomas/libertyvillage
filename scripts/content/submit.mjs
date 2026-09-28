// `content submit` (§4.4). This module owns the kind policy that submit, gate g1
// and the repair adapter all apply, so every round and every repair re-runs the
// exact checks the submission first passed.
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
import { fromFile, keyOf, recordSha, registry, serialize } from './canonical.mjs';
import { validateRecord } from './validate.mjs';
import { createSubmission, getSubmission, readLive, resolveAssets, ValidationError } from './store.mjs';
import { prepareImages } from './images.mjs';

const MANUAL_DATASETS = Object.freeze(['businesses', 'posts', 'buildings', 'neighborhoods', 'services', 'topics', 'guide-hub']);
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
  if (kind === 'news') deps.news = { root: context.root, loadSiteIndex: loadSiteLinkIndex, imageExists: createLocalImageExists(checkout) };
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

// Gate context: identical inputs for every round and every resume.
async function buildContext({ db, kind, opts, items, clock, idempotencyKey }) {
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
  // Submit wall time; an idempotent replay reuses the stored time so the request hash is stable.
  const prior = (await db.query('select context from content.submissions where idempotency_key=$1', [idempotencyKey])).rows[0];
  return { now: prior?.context?.now ?? new Date(clock()).toISOString() };
}

// opts: {kind, idempotencyKey, actor, dir | recordFile+dataset+baseline, topicKey, generatedAt,
// newsOut}; returns {result, exitCode}. Never gates.
export async function submitContent(db, opts, { env = process.env, clock = Date.now, checkout = process.cwd() } = {}) {
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
  const context = await buildContext({ db, kind, opts, items: images.items, clock, idempotencyKey });
  const liveCtx = await liveContext(db);
  try {
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
