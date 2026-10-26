// Refresh loop (docs/specs/refresh-loop.md). Once a week: pick the weakest live
// blog posts from Search Console page rows, snapshot each one in the DB, rewrite
// it with the existing generator, and send it through the `refresh` submission
// kind: the same lint, grounding and review gate as a new blog post, then the
// normal publish -> deploy hook -> smoke path. Same slug and URL, at most two
// refreshes per ISO week (counted from content.refresh_snapshots), snapshot
// before any change, one-command rollback.
//
// The runner binds the generator and calls this module through `content refresh
// <plan|reserve|submit|close|rollback|list>`; every DB write lives here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordSha, registry } from './canonical.mjs';
import { getSubmission, readLive, ValidationError } from './store.mjs';
import { isoWeekOf } from '../news-pilot/roundup.mjs';

export const REFRESH = Object.freeze({
  weeklyCap: 2,          // published (or in-flight) refreshes per ISO week
  weeklyAttempts: 4,     // snapshots per ISO week, failed ones included
  candidates: 4,         // ranked posts handed to one run
  minImpressions: 50,    // over the GSC window; below this the signal is noise
  pageOneTarget: 8,      // a post below page one is scored against position 8
  cooldownDays: 56,      // a refreshed post sits out 8 weeks so its effect can be measured
  staleHours: 6,         // a snapshot still reserved after this is settled on the next plan
});
// Leak lane (SEO roadmap P0-5): a query ranking 4-20 with real demand but a weak
// CTR is a snippet problem first. Such a page gets a snippet-only rewrite (title,
// meta description, intro) before any full rewrite is considered.
export const LEAK = Object.freeze({ minPosition: 4, maxPosition: 20, minImpressions: 50, maxCtr: 0.05 });
export const isLeakQuery = (row) => {
  const position = Number(row?.position);
  return position >= LEAK.minPosition && position <= LEAK.maxPosition && Number(row?.impressions) > LEAK.minImpressions && Number(row?.ctr) < LEAK.maxCtr;
};
export const MODES = Object.freeze(['snippet', 'full']);
export const actionTypeOf = (mode) => (mode === 'snippet' ? 'snippet' : 'refresh');
export const SITE = 'https://libertyvillage.co';
const ROUTE = registry.posts.route;
const WEEKLY_ROUNDUP = /^liberty-village-news-week-\d{4}-w\d{2}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/;

// Typical organic CTR by rounded position 1-10; 1% beyond page one.
const CTR_BY_POSITION = Object.freeze([0.28, 0.15, 0.10, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018]);
export function expectedCtr(position) {
  const p = Math.max(1, Math.round(Number(position) || 1));
  return p <= CTR_BY_POSITION.length ? CTR_BY_POSITION[p - 1] : 0.01;
}

// Weakness score = clicks the page missed over the window:
//   impressions × max(0, expectedCtr(min(position, 8)) − actual CTR)
// High impressions with a low CTR (weak title/description) and high impressions
// stuck below page one (scored as if it reached position 8) both rank high; a
// page already earning its expected CTR scores 0.
export function refreshScore({ impressions, ctr, position }) {
  const benchmark = expectedCtr(Math.min(Number(position) || 100, REFRESH.pageOneTarget));
  return Math.max(0, Number(impressions) * (benchmark - Number(ctr)));
}

export function slugFromPage(page) {
  let url;
  try { url = new URL(page, SITE); } catch { return null; }
  if (url.hostname.replace(/^www\./, '') !== new URL(SITE).hostname) return null;
  const match = /^\/blog\/([^/]+)\/?$/.exec(url.pathname);
  return match && SLUG.test(match[1]) ? match[1] : null;
}

const refreshable = (post) => post && post.category !== 'news' && !WEEKLY_ROUNDUP.test(post.slug ?? '') && !Object.hasOwn(post, 'roundupCoverage');
const round = (value, dp) => Number(Number(value).toFixed(dp));

// gsc: {pages:[{page,clicks,impressions,ctr,position}], queries?:[{page,query,...}]}.
// Rows for the same post (www, trailing slash) are merged impression-weighted.
// mode: 'snippet' when the page has a leak query and has not had a snippet
// refresh yet (snippetDone); otherwise 'full'.
export function rankRefreshCandidates({ gsc, posts, exclude = new Set(), snippetDone = new Set(), limit = REFRESH.candidates }) {
  const live = new Map((posts ?? []).filter(refreshable).map((post) => [post.slug, post]));
  const bySlug = new Map();
  for (const row of Array.isArray(gsc?.pages) ? gsc.pages : []) {
    const slug = slugFromPage(row?.page ?? row?.keys?.[0]);
    if (!slug || !live.has(slug) || exclude.has(slug)) continue;
    const impressions = Number(row.impressions) || 0;
    const acc = bySlug.get(slug) ?? { clicks: 0, impressions: 0, weighted: 0 };
    acc.clicks += Number(row.clicks) || 0;
    acc.impressions += impressions;
    acc.weighted += (Number(row.position) || 0) * impressions;
    bySlug.set(slug, acc);
  }
  const topQuery = new Map();
  const topLeak = new Map();
  const better = (map, slug, entry) => { if (!map.has(slug) || entry.impressions > map.get(slug).impressions) map.set(slug, entry); };
  for (const row of Array.isArray(gsc?.queries) ? gsc.queries : []) {
    const slug = slugFromPage(row?.page ?? row?.keys?.[0]);
    const query = row?.query ?? row?.keys?.[1];
    if (!slug || typeof query !== 'string' || !query.trim()) continue;
    const entry = { query: query.trim().slice(0, 200), impressions: Number(row.impressions) || 0 };
    better(topQuery, slug, entry);
    if (isLeakQuery(row)) better(topLeak, slug, entry);
  }
  return [...bySlug].filter(([, acc]) => acc.impressions >= REFRESH.minImpressions).map(([slug, acc]) => {
    const baseline = { clicks: acc.clicks, impressions: acc.impressions, ctr: round(acc.clicks / acc.impressions, 4), position: round(acc.weighted / acc.impressions, 1) };
    const mode = topLeak.has(slug) && !snippetDone.has(slug) ? 'snippet' : 'full';
    return { slug, url: `${SITE}${ROUTE.replace(':key', slug)}`, score: round(refreshScore(baseline), 2), baseline, mode,
      targetQuery: (mode === 'snippet' ? topLeak : topQuery).get(slug)?.query ?? null, title: live.get(slug).title };
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || b.baseline.impressions - a.baseline.impressions || a.slug.localeCompare(b.slug)).slice(0, limit);
}

export class RefreshRefused extends Error {
  constructor(reason, message = reason) { super(message); this.code = 'RefreshRefused'; this.reason = reason; }
}

// Intro = the body before its first `## ` section (or its first paragraph when it
// has none); a snippet refresh may rewrite only that, the title and description.
export function splitIntro(content) {
  const text = String(content ?? '');
  const heading = /^## /m.exec(text);
  const cut = heading ? heading.index : (text.indexOf('\n\n') >= 0 ? text.indexOf('\n\n') : text.length);
  return { intro: text.slice(0, cut), rest: text.slice(cut) };
}
const SNIPPET_FIELDS = new Set(['title', 'description', 'content', 'updatedAt']);
// Null when `record` changes only what a snippet refresh may change relative to
// `prior` (the snapshot). Shared with the submit/gate kind policy, so it holds for
// the generator output, every fixer repair and every gate round.
export function snippetOverreach(prior, record) {
  const keys = new Set([...Object.keys(prior ?? {}), ...Object.keys(record ?? {})]);
  for (const key of keys) if (!SNIPPET_FIELDS.has(key) && JSON.stringify(prior?.[key]) !== JSON.stringify(record?.[key])) return `snippet refresh changed ${key}`;
  if (splitIntro(prior?.content).rest !== splitIntro(record?.content).rest) return 'snippet refresh changed the body beyond the intro';
  return null;
}
function checkSnippetOnly(prior, record) {
  const overreach = snippetOverreach(prior, record);
  if (overreach) throw new RefreshRefused('refresh-snippet-overreach', overreach);
}

// The generator rewrites data/posts.json in a scratch copy. Accept exactly one
// changed record: the snapshot's post, same slug and publish date, nothing else
// added, removed or touched; in snippet mode only title, description and intro.
export function extractRefreshedPost({ before, after, slug, mode = 'full' }) {
  if (!Array.isArray(before) || !Array.isArray(after)) throw new RefreshRefused('refresh-off-target', 'posts are not arrays');
  const prior = new Map(before.map((post) => [post?.slug, post]));
  const next = new Map(after.map((post) => [post?.slug, post]));
  if (!next.has(slug)) throw new RefreshRefused('refresh-slug-changed', `post ${slug} is missing after generation`);
  if (after.length !== before.length || next.size !== after.length || [...prior.keys()].some((key) => !next.has(key))) {
    throw new RefreshRefused(after.some((post) => !prior.has(post?.slug)) ? 'refresh-slug-changed' : 'refresh-off-target', 'post set changed');
  }
  for (const [key, post] of prior) if (key !== slug && JSON.stringify(next.get(key)) !== JSON.stringify(post)) throw new RefreshRefused('refresh-off-target', `post ${key} changed`);
  const record = next.get(slug);
  if (record.slug !== slug) throw new RefreshRefused('refresh-slug-changed');
  if (record.publishedAt !== prior.get(slug).publishedAt) throw new RefreshRefused('refresh-date-changed');
  if (recordSha(record) === recordSha(prior.get(slug))) throw new RefreshRefused('refresh-no-change');
  if (mode === 'snippet') checkSnippetOnly(prior.get(slug), record);
  return record;
}

const TRACKED = ['title', 'description', 'answerBlock', 'content', 'faqs', 'keyTakeaways', 'tags', 'relatedPosts', 'relatedServices', 'relatedTopics', 'image'];
export function summarizeChange(before, after) {
  if (!after) return null;
  const changed = TRACKED.filter((field) => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]));
  const parts = changed.map((field) => {
    if (field === 'content') {
      const delta = String(after.content ?? '').length - String(before?.content ?? '').length;
      const headings = (text) => (String(text ?? '').match(/^#{2,3} /gm) ?? []).length;
      const added = headings(after.content) - headings(before?.content);
      return `body ${delta >= 0 ? '+' : ''}${delta} chars${added ? `, ${added > 0 ? '+' : ''}${added} sections` : ''}`;
    }
    if (field === 'faqs') return `FAQs ${before?.faqs?.length ?? 0}→${after.faqs?.length ?? 0}`;
    return field === 'answerBlock' ? 'answer block' : field === 'keyTakeaways' ? 'key takeaways' : field;
  });
  return parts.length ? `Changed ${parts.join('; ')}` : 'No visible change';
}
// Short ledger label so the planner can weigh refreshes by kind of search.
export const queryType = (query) => (!query ? null : /liberty village|king west|exhibition|near me|toronto/i.test(query) ? 'local-intent' : 'informational');
const face = (post) => (post ? { title: post.title ?? null, description: post.description ?? null } : null);

const n = (value) => (value == null ? null : Number(value));
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const weekOf = (now) => isoWeekOf(now ?? new Date()).isoWeek;
export const refreshIdempotencyKey = (target, snapshotId) => `refresh:${target}:${snapshotId}`;

async function weekUsage(c, target, isoWeek) {
  const row = await one(c, `select count(*) filter (where state in ('reserved','published','rolled-back'))::int as refreshes, count(*)::int as attempts
    from content.refresh_snapshots where target=$1 and iso_week=$2`, [target, isoWeek]);
  return { refreshes: row.refreshes, attempts: row.attempts };
}

// Rank this week's candidates. Settles abandoned snapshots first so a crashed run
// neither holds a post forever nor loses a refresh that did publish.
export async function planRefresh(db, { target = db.target, now = new Date(), gsc, env = process.env, deps = {}, checkout = process.cwd() }) {
  const settled = await settleStaleRefreshes(db, { target, now, env, deps, checkout });
  const isoWeek = weekOf(now);
  const usage = await weekUsage(db, target, isoWeek);
  const snippetDone = new Set((await db.query("select distinct key from content.refresh_snapshots where target=$1 and mode='snippet' and state in ('published','rolled-back')", [target])).rows.map((row) => row.key));
  const recent = (await db.query(`select key from content.refresh_snapshots where target=$1 and (state='reserved'
    or (state in ('published','rolled-back') and created_at > $2::timestamptz - make_interval(days => $3)))`, [target, now, REFRESH.cooldownDays])).rows.map((row) => row.key);
  const posts = (await readLive(db, { datasets: ['posts'] })).datasets.posts.records;
  const candidates = rankRefreshCandidates({ gsc, posts, exclude: new Set(recent), snippetDone });
  return {
    isoWeek, remaining: Math.max(0, REFRESH.weeklyCap - usage.refreshes), attemptsLeft: Math.max(0, REFRESH.weeklyAttempts - usage.attempts),
    candidates, settled,
  };
}

// Snapshot the live row, under the weekly cap, before anything changes it.
export async function reserveRefresh(db, { target = db.target, now = new Date(), candidate }) {
  const slug = candidate?.slug;
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new ValidationError('refresh candidate slug required');
  const url = `${SITE}${ROUTE.replace(':key', slug)}`;
  if (candidate.url && candidate.url !== url) throw new RefreshRefused('refresh-url-mismatch');
  const mode = candidate.mode ?? 'full';
  if (!MODES.includes(mode)) throw new ValidationError('refresh mode must be snippet or full');
  const isoWeek = weekOf(now);
  return db.tx(async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtext('content:refresh:' || $1))", [target]);
    const usage = await weekUsage(c, target, isoWeek);
    if (usage.refreshes >= REFRESH.weeklyCap || usage.attempts >= REFRESH.weeklyAttempts) return { capReached: true, isoWeek, ...usage };
    const live = await one(c, `select e.live_rev, r.payload, r.payload_sha256 from content.entries e
      join content.revisions r on r.dataset=e.dataset and r.key=e.key and r.rev=e.live_rev where e.dataset='posts' and e.key=$1 for update of e`, [slug]);
    if (!live) return { refused: 'refresh-not-live', slug };
    if (!refreshable(live.payload)) return { refused: 'refresh-not-eligible', slug };
    if (await one(c, "select 1 from content.refresh_snapshots where target=$1 and key=$2 and state='reserved'", [target, slug])) return { refused: 'refresh-already-open', slug };
    const baseline = candidate.baseline ? Object.fromEntries(['clicks', 'impressions', 'ctr', 'position'].map((k) => [k, candidate.baseline[k] ?? null])) : null;
    const row = await one(c, `insert into content.refresh_snapshots(target,iso_week,key,url,live_rev,payload,payload_sha256,target_query,baseline,score,mode)
      values($1,$2,$3,$4,$5,$6::json,$7,$8,$9::json,$10,$11) returning id`, [target, isoWeek, slug, url, live.live_rev, JSON.stringify(live.payload),
      live.payload_sha256, candidate.targetQuery ?? null, baseline && JSON.stringify(baseline), candidate.score ?? null, mode]);
    return { snapshotId: n(row.id), slug, url, isoWeek, mode, liveRev: n(live.live_rev), payloadSha256: live.payload_sha256,
      idempotencyKey: refreshIdempotencyKey(target, n(row.id)), targetQuery: candidate.targetQuery ?? null, before: face(live.payload) };
  });
}

const getSnapshot = async (db, id) => {
  const row = await one(db, 'select * from content.refresh_snapshots where id=$1', [id]);
  if (!row) throw new ValidationError(`refresh snapshot ${id} not found`);
  return row;
};
// Plain-English code for a refused or rejected refresh, from the submit error or
// the deciding gate round's deterministic errors.
export function refusalReason(text) {
  const message = String(text ?? '');
  if (message.includes('refresh-snippet-overreach')) return 'refresh-snippet-overreach';
  if (message.includes('not bound to its original post')) return 'refresh-unbound';
  return /\[[a-z-]+\]/.test(message) ? 'refresh-fact-check' : 'refresh-validation';
}
const failedReason = (submission, rounds = []) => {
  if (['lint', 'validation'].includes(submission.decision)) {
    const reason = refusalReason((rounds.at(-1)?.lint?.errors ?? []).join('; '));
    return submission.decision === 'lint' && reason === 'refresh-validation' ? 'refresh-fact-check' : reason;
  }
  return submission.decision === 'conflict' ? 'refresh-conflict' : submission.state === 'compensated' ? 'refresh-smoke-failed' : 'refresh-gate-failed';
};
// Published in the DB but not yet confirmed live: the hook never landed, or smoke has not passed.
const propagationReason = (submission) => (submission.deploy_requested_at ? 'smoke-timeout' : 'hook-failed');

async function defaultRecordAction(db, action) {
  const ledger = await import('./ledger.mjs');
  return ledger.recordAction(db, action);
}

// Close a reserved snapshot from its submission (or a refusal before submit).
// A published refresh writes one ledger row; the ledger is optional.
export async function closeRefresh(db, { snapshotId, submissionId = null, reasonCode = null, now = new Date(), deps = {} }) {
  const snap = await getSnapshot(db, snapshotId);
  const result = (row, extra = {}) => ({
    snapshotId: n(row.id), slug: row.key, url: row.url, target: row.target, isoWeek: row.iso_week, mode: row.mode, actionType: actionTypeOf(row.mode),
    state: row.state, reasonCode: row.reason_code,
    submissionId: n(row.submission_id), baseline: row.baseline, targetQuery: row.target_query,
    before: row.summary?.before ?? face(row.payload), after: row.summary?.after ?? null, change: row.summary?.change ?? null, ...extra,
  });
  if (snap.state !== 'reserved') return result(snap, { existing: true });
  // A submission under this snapshot's key decides the outcome even when the
  // caller only saw an error: it may still be gating, or may have published.
  submissionId ??= n((await one(db, 'select id from content.submissions where idempotency_key=$1', [refreshIdempotencyKey(snap.target, snap.id)]))?.id);
  let state = 'failed';
  let reason = reasonCode ?? 'refresh-error';
  let after = null;
  if (submissionId != null) {
    const { submission, items, rounds } = await getSubmission(db, submissionId);
    if (submission.idempotency_key !== refreshIdempotencyKey(snap.target, snap.id) || submission.kind !== 'refresh') throw new ValidationError('submission is not this refresh');
    if (['open', 'gating'].includes(submission.state)) return result(snap, { pending: true, submissionId });
    if (submission.state === 'published') {
      // Only a confirmed live page closes as published (cooldown, ledger, digest);
      // until then the snapshot stays open and the next submit/plan resumes propagation.
      if (!submission.smoke_passed_at) return result(snap, { pending: true, submissionId, reasonCode: propagationReason(submission) });
      const item = items.find((entry) => entry.dataset === 'posts' && entry.key === snap.key);
      after = (await one(db, 'select payload from content.revisions where dataset=$1 and key=$2 and rev=$3', ['posts', snap.key, item.published_rev])).payload;
      state = 'published';
      reason = null;
    } else reason = failedReason(submission, rounds);
  }
  const summary = { before: face(snap.payload), after: face(after), change: summarizeChange(snap.payload, after) };
  const closed = (await db.query(`update content.refresh_snapshots set state=$2, reason_code=$3, submission_id=$4, summary=$5::json, closed_at=$6
    where id=$1 and state='reserved' returning *`, [snap.id, state, reason, submissionId, JSON.stringify(summary), now])).rows[0];
  if (!closed) return result(await getSnapshot(db, snapshotId), { existing: true });
  let ledger = 'skipped';
  if (state === 'published') {
    try {
      await (deps.recordAction ?? defaultRecordAction)(db, {
        actionKind: 'refresh', actionType: actionTypeOf(snap.mode), slug: snap.key, url: snap.url, pageType: 'blog', targetQuery: snap.target_query,
        queryType: queryType(snap.target_query), actedAt: now, baseline: snap.baseline,
        details: { actionType: actionTypeOf(snap.mode), snapshotId: n(snap.id), submissionId, before: summary.before, after: summary.after, change: summary.change },
      });
      ledger = 'recorded';
    } catch { ledger = 'unavailable'; }   // the refresh already published; measurement is best effort
  }
  return result(closed, { ledger });
}

// Generator output -> refresh submission -> the full gate (review, repair,
// publish, deploy hook, smoke) -> closed snapshot. deps.gate reaches gateContent
// (review/fix/smoke seams), deps.recordAction the ledger. Exit 0 published, 2 refused
// or rejected (nothing published), 3 published with propagation pending.
export async function submitRefresh(db, { snapshotId, before, after, actor, env = process.env, deps = {}, checkout = process.cwd(), now = new Date() }) {
  const snap = await getSnapshot(db, snapshotId);
  if (snap.state !== 'reserved') return { result: await closeRefresh(db, { snapshotId, deps }), exitCode: snap.state === 'published' ? 0 : 2 };
  const close = async (fields) => closeRefresh(db, { snapshotId, now, deps, ...fields });
  // A retry of a snapshot that already has a submission never regenerates: it
  // resumes that submission (gate rounds or deploy/smoke) to a confirmed outcome.
  const existing = await one(db, 'select id from content.submissions where idempotency_key=$1', [refreshIdempotencyKey(snap.target, snap.id)]);
  if (existing) return gateAndClose(db, { snapshotId, submissionId: n(existing.id), actor, env, deps, checkout, now });
  let record;
  try {
    record = extractRefreshedPost({ before, after, slug: snap.key, mode: snap.mode });
  } catch (error) {
    if (error.code !== 'RefreshRefused') throw error;
    return { result: await close({ reasonCode: error.reason }), exitCode: 2 };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-refresh-'));
  let submissionId;
  try {
    const recordFile = path.join(dir, 'post.json');
    const baseline = path.join(dir, 'baseline.json');
    fs.writeFileSync(recordFile, JSON.stringify(record));
    // Baseline = the snapshot itself: a live row that moved since then is a conflict, never overwritten.
    fs.writeFileSync(baseline, JSON.stringify({ snapshot_id: null, datasets: { posts: { entries: { [snap.key]: { rev: snap.live_rev, sha: snap.payload_sha256 } } } } }));
    const { submitContent } = await import('./submit.mjs');
    try {
      // context.refresh binds the snapshot (mode + original post) to the submission:
      // the kind policy re-checks snippet scope and original-post binding at submit,
      // on every fixer plan and on every gate round, so a repair cannot widen it.
      ({ result: { submissionId } } = await submitContent(db, {
        kind: 'refresh', idempotencyKey: refreshIdempotencyKey(snap.target, snap.id), actor, root: checkout, recordFile, dataset: 'posts', baseline,
        refresh: { snapshotId: n(snap.id), mode: snap.mode, original: snap.payload },
      }, { env, checkout }));
    } catch (error) {
      if (!['ValidationError', 'ConflictError'].includes(error.code)) throw error;
      return { result: await close({ reasonCode: error.code === 'ConflictError' ? 'refresh-conflict' : refusalReason(error.message) }), exitCode: 2 };
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (submissionId == null) return { result: await close({ reasonCode: 'refresh-no-change' }), exitCode: 2 };
  return gateAndClose(db, { snapshotId, submissionId, actor, env, deps, checkout, now });
}

// gateContent resumes any state: open/gating rounds, or a published submission's
// deploy hook + smoke (publishTail). Exit 3 = published but not yet confirmed live.
async function gateAndClose(db, { snapshotId, submissionId, actor, env, deps, checkout, now }) {
  const { gateContent } = await import('./gate.mjs');
  const gated = await gateContent(db, { submission: submissionId, actor }, { env, deps: deps.gate ?? {}, checkout });
  const closed = await closeRefresh(db, { snapshotId, submissionId, now, deps });
  const exitCode = closed.pending ? (['hook-failed', 'smoke-timeout'].includes(closed.reasonCode) ? 3 : 1) : closed.state === 'published' ? 0 : 2;
  return { result: { ...closed, gate: { exitCode: gated.exitCode, decision: gated.result?.decision ?? null } }, exitCode };
}

// Every plan first finishes earlier work: a refresh published in the DB but not
// confirmed live gets its deploy hook + smoke resumed now; an abandoned snapshot
// (stale, no submission) closes as interrupted; a stale in-review one resumes its gate.
export async function settleStaleRefreshes(db, { target = db.target, now = new Date(), env = process.env, deps = {}, actor = 'refresh:settle', checkout = process.cwd() } = {}) {
  const open = (await db.query(`select r.id, s.id as submission_id, s.state as submission_state,
      r.created_at < $2::timestamptz - make_interval(hours => $3) as stale
    from content.refresh_snapshots r left join content.submissions s on s.idempotency_key = 'refresh:' || r.target || ':' || r.id
    where r.target=$1 and r.state='reserved' order by r.id`, [target, now, REFRESH.staleHours])).rows;
  const settled = [];
  for (const row of open) {
    let closed;
    if (row.submission_state === 'published' || (row.stale && ['open', 'gating'].includes(row.submission_state))) {
      ({ result: closed } = await gateAndClose(db, { snapshotId: n(row.id), submissionId: n(row.submission_id), actor, env, deps, checkout, now }));
    } else if (row.stale || ['rejected', 'blocked', 'error', 'compensated'].includes(row.submission_state)) {
      closed = await closeRefresh(db, { snapshotId: n(row.id), reasonCode: 'refresh-interrupted', now, deps });
    } else continue;
    settled.push({ snapshotId: closed.snapshotId, slug: closed.slug, state: closed.state, reasonCode: closed.reasonCode, pending: Boolean(closed.pending) });
  }
  return settled;
}

// Put the snapshot's exact payload back live through the existing admin rollback
// (new revision copying the snapshot revision, deploy hook, smoke).
export async function rollbackRefresh(db, { snapshotId, actor, reason = 'refresh rollback', env = process.env, deps = {} }) {
  const snap = await getSnapshot(db, snapshotId);
  const rev = await one(db, 'select payload_sha256, published_at from content.revisions where dataset=$1 and key=$2 and rev=$3', ['posts', snap.key, snap.live_rev]);
  if (!rev || rev.payload_sha256 !== snap.payload_sha256) throw new ValidationError('snapshot revision mismatch');
  const { adminContent } = await import('./deploy.mjs');
  const admin = await adminContent(db, { op: 'rollback', dataset: 'posts', key: snap.key, toRev: snap.live_rev, actor, reason,
    idempotencyKey: `refresh-rollback:${snap.target}:${snap.id}` }, { env, deps: deps.gate ?? {} });
  await db.query("update content.refresh_snapshots set state='rolled-back', rolled_back_at=coalesce(rolled_back_at, now()), closed_at=coalesce(closed_at, now()) where id=$1", [snap.id]);
  return { result: { snapshotId: n(snap.id), slug: snap.key, restoredRev: snap.live_rev, ...admin.result }, exitCode: admin.exitCode };
}

export async function listRefreshes(db, { target = db.target, since = null } = {}) {
  return (await db.query(`select * from content.refresh_snapshots where target=$1 and ($2::timestamptz is null or created_at >= $2) order by id`, [target, since])).rows
    .map((row) => ({ snapshotId: n(row.id), slug: row.key, url: row.url, isoWeek: row.iso_week, mode: row.mode, state: row.state, reasonCode: row.reason_code,
      submissionId: n(row.submission_id), liveRev: row.live_rev, baseline: row.baseline, targetQuery: row.target_query, summary: row.summary,
      createdAt: row.created_at, closedAt: row.closed_at, rolledBackAt: row.rolled_back_at }));
}

// One weekly run. deps bind the runner (CLI + sandboxed generator) or a test:
//   plan() -> {candidates, remaining}; reserve(candidate) -> snapshot | {capReached} | {refused}
//   generate(snapshot, candidate) -> {before, after} posts arrays (throws on failure)
//   submit(snapshot, generated) -> closed outcome; close({snapshotId, reasonCode}) -> closed outcome
//   log(event, details)
export async function runRefreshLoop({ deps }) {
  const plan = await deps.plan();
  deps.log('refresh-plan', { isoWeek: plan.isoWeek, remaining: plan.remaining, attemptsLeft: plan.attemptsLeft,
    candidates: plan.candidates.map((c) => ({ slug: c.slug, score: c.score, mode: c.mode })), settled: plan.settled?.length ?? 0 });
  const outcomes = [];
  for (const candidate of plan.candidates) {
    if (outcomes.filter((o) => o.state === 'published').length >= plan.remaining) break;
    const snapshot = await deps.reserve(candidate);
    if (snapshot.capReached) { deps.log('refresh-cap-reached', { isoWeek: snapshot.isoWeek }); break; }
    if (snapshot.refused) { deps.log('refresh-skipped', { slug: candidate.slug, reasonCode: snapshot.refused }); continue; }
    let outcome;
    let stop = false;
    try {
      const generated = await deps.generate(snapshot, candidate);
      outcome = await deps.submit(snapshot, generated);
    } catch (error) {
      // A technical failure (writer, CLI, DB) is not about this post: close it
      // honestly and end the run rather than spend the next attempt the same way.
      outcome = await deps.close({ snapshotId: snapshot.snapshotId, reasonCode: error?.reason ?? 'refresh-generator-failed' });
      stop = true;
    }
    deps.log('refresh-outcome', refreshLogLine(outcome));
    outcomes.push(outcome);
    // A deploy that did not confirm is not about this post either; the next plan resumes it.
    if (stop || outcome?.pending) break;
  }
  return { refreshed: outcomes.filter((o) => o.state === 'published').length, attempted: outcomes.length, outcomes };
}

// Bounded, public-only fields for the runner JSONL the weekly digest reads.
const clip = (text, max) => (typeof text === 'string' ? text.slice(0, max) : null);
const clipFace = (value) => (value ? { title: clip(value.title, 200), description: clip(value.description, 400) } : null);
export function refreshLogLine(o) {
  return {
    snapshotId: o.snapshotId ?? null, slug: o.slug ?? null, url: o.url ?? null, mode: MODES.includes(o.mode) ? o.mode : null,
    actionType: MODES.includes(o.mode) ? actionTypeOf(o.mode) : null, state: o.pending ? 'pending' : o.state ?? null, reasonCode: o.reasonCode ?? null,
    submissionId: o.submissionId ?? null, targetQuery: clip(o.targetQuery, 200), baseline: o.baseline ?? null,
    before: clipFace(o.before), after: clipFace(o.after), change: clip(o.change, 300),
  };
}
