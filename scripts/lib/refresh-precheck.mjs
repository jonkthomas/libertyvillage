// Shared deterministic refresh policy. The isolated writer and trusted submit
// execute this same function; storage, lint modes and binding rules are unchanged.
import { lintPost, resolveLintMode } from '../blog-lint.mjs';
import { canonicalJson, checkRefreshAgainstOriginal, refreshTitleWords } from '../automation/blog-source-pack.mjs';
import { validateRecord } from '../content/validate.mjs';
import { refreshFailureDetail, refreshBindingDetail } from '../content/refresh-diagnostics.mjs';
import { splitIntro } from './refresh-lint.mjs';
import { refreshPage, refreshBindingRecord, refreshClaimRecord } from './refresh-pages.mjs';
const hasOwn = (value, field) => value !== null && typeof value === 'object' && Object.hasOwn(value, field);
const list = (value) => (Array.isArray(value) ? value : []);

// These dataset fields render as text. Markdown belongs only in post/guide
// content; reject it here so the writer can use its existing repair attempt.
const MARKDOWN = /!?\[[^\]\n]+\]\s*(?:\([^\n)]*\)|\[[^\]\n]*\])|`+[^`]+`+|\*\*[^\n]+?\*\*|__[^\n]+?__|~~[^\n]+?~~|(?<!\w)([*_])[^\s*_][^\n]*?\1(?!\w)|^\s{0,3}(?:#{1,6}\s|>\s?|[-+*]\s|\d+[.)]\s|```|~~~|(?:[-*_]\s*){3,}$)/m;

export class RefreshRefused extends Error {
  constructor(reason, message = reason, detail = null) { super(message); this.code = 'RefreshRefused'; this.reason = reason; this.detail = detail; }
}

// Null when `record` changes only what a snippet refresh may change relative to
// `prior` (the snapshot). Shared with the submit/gate kind policy, so it holds for
// the generator output, every fixer repair and every gate round.
export function snippetOverreach(prior, record, dataset = 'posts') {
  const page = refreshPage(dataset);
  const SNIPPET_FIELDS = new Set(page.fields);
  const keys = new Set([...Object.keys(prior ?? {}), ...Object.keys(record ?? {})]);
  for (const key of keys) if (!SNIPPET_FIELDS.has(key) && canonicalJson(prior?.[key]) !== canonicalJson(record?.[key])) return `snippet refresh changed ${key}`;
  if (splitIntro(prior?.[page.intro]).rest !== splitIntro(record?.[page.intro]).rest) return 'snippet refresh changed the body beyond the intro';
  return null;
}
function checkSnippetOnly(prior, record, dataset) {
  const overreach = snippetOverreach(prior, record, dataset);
  if (overreach) throw new RefreshRefused('refresh-snippet-overreach', overreach);
}

// The generator rewrites data/posts.json in a scratch copy. Accept exactly one
// changed record: the snapshot's post, same slug and publish date, nothing else
// added, removed or touched; in snippet mode only title, description and intro.
export function extractRefreshedPost({ before, after, slug, mode = 'full', dataset = 'posts' }) {
  refreshPage(dataset);
  if (dataset !== 'posts' && mode !== 'snippet') throw new RefreshRefused('refresh-snippet-overreach', 'non-blog refresh must use snippet mode');
  if (!Array.isArray(before) || !Array.isArray(after)) throw new RefreshRefused('refresh-off-target', 'posts are not arrays', { kind: 'invalid-posts', slug: null });
  const prior = new Map(before.map((post) => [post?.slug, post]));
  const next = new Map(after.map((post) => [post?.slug, post]));
  if (!next.has(slug)) throw new RefreshRefused('refresh-slug-changed', `post ${slug} is missing after generation`, { kind: 'removed', slug });
  if (after.length !== before.length || next.size !== after.length || [...prior.keys()].some((key) => !next.has(key))) {
    const added = after.find((post) => !prior.has(post?.slug));
    const removed = before.find((post) => !next.has(post?.slug));
    const seen = new Set();
    const duplicate = after.find((post) => {
      if (seen.has(post?.slug)) return true;
      seen.add(post?.slug);
      return false;
    });
    const detail = added ? { kind: 'added', slug: added.slug } : removed ? { kind: 'removed', slug: removed.slug }
      : { kind: 'duplicate', slug: duplicate?.slug ?? null };
    throw new RefreshRefused(added ? 'refresh-slug-changed' : 'refresh-off-target', 'post set changed', detail);
  }
  // A JSON writer may reorder object keys throughout the file. Compare values
  // recursively (array order still matters), without normalizing any post data.
  for (const [key, post] of prior) if (key !== slug && canonicalJson(next.get(key)) !== canonicalJson(post)) throw new RefreshRefused('refresh-off-target', `post ${key} changed`, { kind: 'changed', slug: key });
  const record = next.get(slug);
  if (!prior.has(slug)) throw new RefreshRefused('refresh-off-target', 'target missing before generation');
  if (record.slug !== slug) throw new RefreshRefused('refresh-slug-changed');
  if (record.publishedAt !== prior.get(slug).publishedAt) throw new RefreshRefused('refresh-date-changed');
  if (canonicalJson(record) === canonicalJson(prior.get(slug))) throw new RefreshRefused('refresh-no-change');
  if (mode === 'snippet') checkSnippetOnly(prior.get(slug), record, dataset);
  return record;
}

export function refreshBindingErrors({ item, record, ctx = {}, live = {} }) {
  const bound = ctx.refresh;
  const dataset = item.dataset;
  if (!['posts', 'topics', 'services', 'businesses'].includes(dataset) || (bound?.dataset ?? 'posts') !== dataset || (dataset !== 'posts' && bound?.mode !== 'snippet')) return ['refresh draft is not bound to its original post: missing-snapshot-binding'];
  if (!bound?.original || bound.original.slug !== item.key || !['snippet', 'full'].includes(bound.mode)) return ['refresh draft is not bound to its original post: missing-snapshot-binding'];
  const errors = checkRefreshAgainstOriginal(refreshBindingRecord(record, dataset), refreshBindingRecord(bound.original, dataset), { businesses: live.businesses ?? [], posts: live.posts ?? [], services: live.services ?? [], topics: live.topics ?? [], mode: bound.mode })
    .slice(0, 20).map((error) => `refresh draft is not bound to its original post: ${error}`);
  const overreach = bound.mode === 'snippet' ? snippetOverreach(bound.original, record, dataset) : null;
  return overreach ? [...errors, `refresh-snippet-overreach: ${overreach}`] : errors;
}

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

// Optional before/after runs the runner's exact extraction checks. prepareImages
// uses the same image validator with read-only snapshot adapters in the writer;
// submit supplies its already-prepared item and retains its normal write order.
export function checkRefreshPreSubmission({ item, ctx = {}, live = {}, deps = {}, before, after }) {
  let extractionFailure = null;
  const withFailure = (result, error, rule) => !error ? result : { ...result, ok: false,
    errors: [error.message, ...result.errors],
    findings: [{ rule, detail: error.message }, ...result.findings] };
  const withExtraction = (result) => withFailure(result, extractionFailure, extractionFailure?.reason);
  if (before !== undefined || after !== undefined) {
    try {
      const payload = extractRefreshedPost({ before, after, slug: item.key, mode: ctx.refresh?.mode, dataset: item.dataset });
      item = { ...item, payload };
    } catch (error) {
      if (error.code !== 'RefreshRefused') throw error;
      extractionFailure = error;
      const payload = Array.isArray(after) ? after.find((post) => post?.slug === item.key) : null;
      if (!payload) return withExtraction({ errors: [], lint: [], refusalDetail: null, findings: [] });
      item = { ...item, payload };
    }
  }
  if (deps.prepareImages) {
    return deps.prepareImages([item]).then((images) => checkRefreshPreSubmission({
      item: images.items[0], ctx, live, deps: { ...deps, prepareImages: null },
    })).then(withExtraction).catch((error) => {
      if (error.code !== 'ValidationError') throw error;
      const result = checkRefreshPreSubmission({ item, ctx, live, deps: { ...deps, prepareImages: null } });
      return withExtraction(withFailure(result, error, error.reason ?? 'image-invalid'));
    });
  }
  const record = item.payload;
  if (!['posts', 'topics', 'services', 'businesses'].includes(item.dataset)) return { ok: false, errors: ['unknown refresh dataset'], lint: [], findings: [{ rule: 'storage', detail: 'unknown refresh dataset' }], refusalDetail: null };
  const errors = [];
  const lint = [];
  const findings = [];
  const failures = [];
  for (const field of ['description', ...(['posts', 'topics'].includes(item.dataset) ? ['title'] : [])]) {
    if (typeof record?.[field] !== 'string' || !MARKDOWN.test(record[field])) continue;
    const rule = 'refresh-plain-text-markdown';
    const detail = `${item.dataset}.${field} is plain text; remove Markdown formatting`;
    errors.push(detail);
    findings.push({ rule, field, detail });
  }
  const storage = (deps.validateRecord ?? validateRecord)(item.dataset, item.key, record);
  if (!storage?.ok) {
    const messages = storage?.errors?.length ? storage.errors : ['record failed storage validation'];
    errors.push(...messages);
    findings.push(...messages.map((detail) => ({ rule: 'storage', detail })));
  }
  const mode = deps.lintMode || resolveLintMode(process.env);
  const now = ctx.now ? new Date(ctx.now) : null;
  const checked = lintPost(refreshClaimRecord(record, ctx.refresh?.mode, item.dataset), {
    businesses: Array.isArray(live.businesses) ? live.businesses : [], now: now ?? undefined,
    roundup: item.dataset === 'posts' && hasOwn(record, 'roundupCoverage'),
  });
  const blockingFindings = checked.findings.filter((f) => mode === 'fail' || f.rule.startsWith('voice-'));
  lint.push(...blockingFindings.map((f) => `[${f.rule}] ${f.claim} — ${f.detail}`));
  findings.push(...blockingFindings);
  failures.push(...blockingFindings.map((f) => ({ code: f.rule, field: f.field, businessSlug: f.businessSlug })));
  const binding = refreshBindingErrors({ item, record, ctx, live });
  errors.push(...binding);
  const detail = refreshBindingDetail(checkRefreshAgainstOriginal(refreshBindingRecord(record, item.dataset), refreshBindingRecord(ctx.refresh?.original, item.dataset), { ...live, mode: ctx.refresh?.mode }));
  failures.push(...detail);
  const words = refreshTitleWords(refreshBindingRecord(ctx.refresh?.original, item.dataset)?.title);
  for (const message of binding) {
    const rule = message.startsWith('refresh-snippet-overreach:') ? 'refresh-snippet-overreach'
      : message.split(': ')[1]?.split(':')[0] ?? 'missing-snapshot-binding';
    findings.push({ rule, field: detail.find((f) => f.code === rule)?.field ?? null,
      detail: rule === 'draft-changed-topic'
        ? `title must keep at least ${Math.ceil(words.length / 2)} of these words from the original: ${words.join(', ')}` : message });
  }
  const coverage = roundupCoverageIntegrityErrors({ kind: 'refresh', item, ctx, live });
  errors.push(...coverage);
  findings.push(...coverage.map((detail) => ({ rule: 'roundup-coverage', detail })));
  if (typeof deps.checkImages === 'function') {
    const images = deps.checkImages(item);
    errors.push(...images);
    findings.push(...images.map((detail) => ({ rule: 'image-invalid', detail })));
  }
  return withExtraction({ ok: errors.length === 0 && lint.length === 0, errors, lint,
    refusalDetail: refreshFailureDetail(failures), findings,
    ...(checked.warnings?.length ? { warnings: checked.warnings } : {}) });
}
