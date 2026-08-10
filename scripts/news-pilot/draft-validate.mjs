/**
 * Post-generation deterministic validation for news drafts.
 * Fail closed — never treat a bad draft as publishable.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DRAFT_VALIDATION_CONFIG = Object.freeze({
  maxQuoteWords: 25,
  requiredPostFields: Object.freeze([
    'slug',
    'title',
    'description',
    'content',
    'publishedAt',
    'updatedAt',
    'category',
    'tags',
    'answerBlock',
    'faqs',
    'keyTakeaways',
    'relatedServices',
    'relatedTopics',
    'relatedPosts',
    'author',
  ]),
  // image is intentionally NOT required here: drafts must omit/null it rather than
  // fabricate a path. Missing image is a blocking human-gate for publish readiness.
  categories: Object.freeze([
    'news',
    'development',
    'food-drink',
    'events',
    'transit',
    'real-estate',
    'lifestyle',
    'community',
  ]),
  dateRe: /^\d{4}-\d{2}-\d{2}$/,
  slugRe: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
});

/** ISO calendar date in Liberty Village's Toronto timezone. */
export function runDateIso(nowMs) {
  if (!Number.isFinite(Number(nowMs))) {
    throw new Error('runDateIso requires a finite nowMs');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Number(nowMs)));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/**
 * Force frontmatter + NewsArticle dates onto the actual run date.
 * Model output must not be able to backdate publishedAt/updatedAt to a source date.
 * @param {object|null|undefined} post
 * @param {object|null|undefined} newsArticleStructuredData
 * @param {number} nowMs
 */
export function enforceRunDates(post, newsArticleStructuredData, nowMs) {
  const runDate = runDateIso(nowMs);
  const nextPost =
    post && typeof post === 'object' && !Array.isArray(post)
      ? { ...post, publishedAt: runDate, updatedAt: runDate }
      : post;
  let nextSd = newsArticleStructuredData;
  if (nextSd && typeof nextSd === 'object' && !Array.isArray(nextSd)) {
    nextSd = {
      ...nextSd,
      datePublished: runDate,
      dateModified: runDate,
    };
  }
  return {
    post: nextPost,
    newsArticleStructuredData: nextSd,
    runDate,
    corrections: {
      publishedAt: runDate,
      updatedAt: runDate,
      datePublished: runDate,
      dateModified: runDate,
    },
  };
}

/**
 * Site-relative image path under /images/ with a real image extension.
 * Rejects absolute URLs, path traversal, and non-image shapes.
 * @param {string} image
 */
export function isPlausibleLocalImagePath(image) {
  const s = String(image || '').trim();
  if (!s.startsWith('/images/')) return false;
  if (s.includes('\\') || s.includes('\0') || s.includes('..')) return false;
  if (/\s/.test(s)) return false;
  if (!/^\/images\/[A-Za-z0-9][A-Za-z0-9/_-]*\.(?:jpe?g|png|webp|gif|avif)$/i.test(s)) {
    return false;
  }
  return true;
}

/**
 * Build an existence checker for local public image assets.
 * @param {string} root repo root containing public/
 */
export function createLocalImageExists(root) {
  const publicRoot = path.resolve(root, 'public');
  return (imagePath) => {
    if (!isPlausibleLocalImagePath(imagePath)) return false;
    const abs = path.resolve(publicRoot, String(imagePath).replace(/^\//, ''));
    if (abs !== publicRoot && !abs.startsWith(publicRoot + path.sep)) return false;
    try {
      return fs.existsSync(abs) && fs.statSync(abs).isFile();
    } catch {
      return false;
    }
  };
}

/**
 * Explicit image absence handling. Never invent an image path.
 * Fabricated or non-existent paths do NOT clear the human image gate.
 * @param {object|null|undefined} post
 * @param {{ imageExists?: (p: string) => boolean }} [opts]
 */
export function normalizeDraftImageField(post, opts = {}) {
  if (!post || typeof post !== 'object' || Array.isArray(post)) {
    return {
      post,
      imageStatus: 'absent',
      humanMustSupplyImage: true,
    };
  }
  const next = { ...post };
  const raw = next.image;
  const hasImage = typeof raw === 'string' && raw.trim().length > 0;
  if (!hasImage) {
    // Explicit null so downstream gates see intentional absence, not a forgotten key.
    next.image = null;
    return {
      post: next,
      imageStatus: 'absent',
      humanMustSupplyImage: true,
    };
  }
  const trimmed = raw.trim();
  // Shape first — remote URLs and invented non-/images paths never count as present.
  if (!isPlausibleLocalImagePath(trimmed)) {
    next.image = null;
    return {
      post: next,
      imageStatus: 'absent',
      humanMustSupplyImage: true,
      rejectedImage: trimmed,
    };
  }
  // Existence: require a checker. If none provided, do not trust the path.
  const verified =
    typeof opts.imageExists === 'function' ? Boolean(opts.imageExists(trimmed)) : false;
  if (!verified) {
    next.image = null;
    return {
      post: next,
      imageStatus: 'absent',
      humanMustSupplyImage: true,
      rejectedImage: trimmed,
    };
  }
  next.image = trimmed;
  return {
    post: next,
    imageStatus: 'present',
    humanMustSupplyImage: false,
  };
}

/**
 * Collect all absolute http(s) URLs allowed by the evidence pack.
 * @param {object} evidencePack
 */
export function evidenceAllowedUrls(evidencePack) {
  const urls = new Set();
  for (const s of evidencePack?.sources || []) {
    if (s.url) urls.add(normalizeUrl(s.url));
    if (s.canonicalUrl) urls.add(normalizeUrl(s.canonicalUrl));
  }
  for (const c of evidencePack?.claimSupport || []) {
    if (c.sourceUrl) urls.add(normalizeUrl(c.sourceUrl));
  }
  return urls;
}

/**
 * Flatten all evidence text for number/date grounding checks.
 * @param {object} evidencePack
 */
export function evidenceTextBlob(evidencePack) {
  const parts = [
    evidencePack?.title || '',
    evidencePack?.snippet || '',
    evidencePack?.relatedPostSlug || '',
    evidencePack?.matchingSlug || '',
  ];
  for (const s of evidencePack?.sources || []) {
    parts.push(s.publisher || '', s.publishDate || '', s.bodyExcerpt || '');
    for (const p of s.passages || []) parts.push(p);
  }
  for (const c of evidencePack?.claimSupport || []) {
    parts.push(c.passage || '', c.publishDate || '', c.publisher || '');
  }
  return parts.join('\n');
}

export function normalizeUrl(url) {
  try {
    const u = new URL(String(url).trim());
    u.hash = '';
    let href = u.href;
    if (href.endsWith('/')) href = href.slice(0, -1);
    return href;
  } catch {
    return String(url || '')
      .trim()
      .replace(/\/$/, '');
  }
}

/**
 * Extract quoted spans from text (straight and curly quotes).
 * @param {string} text
 */
export function extractQuotes(text) {
  const s = String(text || '');
  const out = [];
  // Only treat as a verbatim quote when quote chars wrap a span that looks like
  // spoken/written citation prose — not JSON string values (slug/title/FAQ fields).
  // We scan the markdown/prose body, so callers should pass content (not full JSON).
  // No upper bound: over-long quotes must be caught by the word cap, not skipped.
  const patterns = [/"([^"\n]{3,})"/g, /“([^”\n]{3,})”/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(s)) !== null) {
      const q = m[1].trim();
      if (!q || q.startsWith('{') || q.includes('://')) continue;
      // Skip likely non-quotes: title-case single words, pure numbers, href leftovers.
      if (/^https?:/i.test(q)) continue;
      out.push(q);
    }
  }
  return out;
}

export function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Extract absolute http(s) URLs from draft text.
 * @param {string} text
 */
export function extractHttpUrls(text) {
  const s = String(text || '');
  const out = [];
  const re = /https?:\/\/[^\s)\]>'"]+/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    let u = m[0];
    u = u.replace(/[.,;:!?]+$/g, '');
    out.push(u);
  }
  return out;
}

/**
 * Internal site paths that look like content links.
 * @param {string} text
 */
export function extractInternalPaths(text) {
  const s = String(text || '');
  const out = [];
  const re =
    /(?:\[[^\]]*\]\()?(\/(?:blog|guide|best|directory|buildings)\/[a-z0-9-]+)(?:\/)?(?:\)|(?=\s|$|[.,'"]))?/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1].replace(/\/$/, ''));
  }
  // Match JSON-ish "href": "/blog/slug" without nested regex groups that break parsers.
  const hrefNeedle = '"href"';
  let from = 0;
  while (from < s.length) {
    const idx = s.indexOf(hrefNeedle, from);
    if (idx < 0) break;
    const after = s.slice(idx + hrefNeedle.length);
    const hm = after.match(/^\s*:\s*"(\/(?:blog|guide|best|directory|buildings)\/[a-z0-9-]+)"/i);
    if (hm) out.push(hm[1]);
    from = idx + hrefNeedle.length;
  }
  return [...new Set(out)];
}

/**
 * Strip URLs so path digits (e.g. urbantoronto ...60605) are not treated as claims.
 * @param {string} text
 */
export function stripUrlsForNumberScan(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s)\]>'"]+/gi, ' ')
    .replace(/\/(?:blog|guide|best|directory|buildings)\/[a-z0-9-]+/gi, ' ');
}

/**
 * Numbers/dates asserted in draft that must appear in evidence.
 * @param {string} text
 */
export function extractAssertedNumbersAndDates(text) {
  const s = stripUrlsForNumberScan(text);
  /** @type {{value: string, kind: string}[]} */
  const found = [];

  for (const m of s.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) {
    found.push({ value: m[1], kind: 'iso-date' });
  }
  for (const m of s.matchAll(/\b(20\d{2})\b/g)) {
    found.push({ value: m[1], kind: 'year' });
  }
  for (const m of s.matchAll(
    /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2})\b/gi,
  )) {
    found.push({ value: m[1], kind: 'long-date' });
  }
  for (const m of s.matchAll(/\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d{2,})\b/g)) {
    found.push({ value: m[1], kind: 'number' });
  }

  const seen = new Set();
  const out = [];
  for (const item of found) {
    const key = `${item.kind}:${item.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * @param {string} evidenceBlob
 */
export function buildEvidenceGroundingIndex(evidenceBlob) {
  const blob = String(evidenceBlob || '');
  const lower = blob.toLowerCase();
  const numbers = new Set();
  for (const m of blob.matchAll(/\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+)\b/g)) {
    numbers.add(m[1]);
    numbers.add(m[1].replace(/,/g, ''));
  }
  const years = new Set([...blob.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]));
  const isoDates = new Set(
    [...blob.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1]),
  );
  return { blob, lower, numbers, years, isoDates };
}

/**
 * @param {{value:string,kind:string}} item
 * @param {ReturnType<typeof buildEvidenceGroundingIndex>} index
 */
export function isGroundedInEvidence(item, index) {
  const v = item.value;
  if (item.kind === 'iso-date') {
    return index.isoDates.has(v) || index.blob.includes(v);
  }
  if (item.kind === 'year') {
    return index.years.has(v) || index.blob.includes(v);
  }
  if (item.kind === 'long-date') {
    const year = (v.match(/20\d{2}/) || [])[0];
    const month = (v.match(/[A-Za-z]+/) || [])[0]?.toLowerCase();
    if (year && !index.years.has(year) && !index.blob.includes(year)) return false;
    if (month && !index.lower.includes(month)) return false;
    return Boolean(year && month && index.lower.includes(month) && index.years.has(year));
  }
  if (item.kind === 'number') {
    const compact = v.replace(/,/g, '');
    if (index.numbers.has(v) || index.numbers.has(compact)) return true;
    if (index.blob.includes(v) || index.blob.includes(compact)) return true;
    return false;
  }
  return false;
}

/**
 * Validate frontmatter/post object shape.
 * @param {object} post
 * @param {typeof DRAFT_VALIDATION_CONFIG} [config]
 */
export function validateFrontmatter(post, config = DRAFT_VALIDATION_CONFIG) {
  const issues = [];
  if (!post || typeof post !== 'object' || Array.isArray(post)) {
    return [{ code: 'frontmatter_not_object', message: 'Post frontmatter is not an object.' }];
  }
  for (const field of config.requiredPostFields) {
    if (post[field] === undefined || post[field] === null || post[field] === '') {
      issues.push({ code: 'missing_field', message: `Missing required field: ${field}`, field });
    }
  }
  if (post.slug && !config.slugRe.test(post.slug)) {
    issues.push({ code: 'bad_slug', message: `Invalid slug: ${post.slug}`, field: 'slug' });
  }
  if (post.category && !config.categories.includes(post.category)) {
    issues.push({
      code: 'bad_category',
      message: `Invalid category: ${post.category}`,
      field: 'category',
    });
  }
  for (const df of ['publishedAt', 'updatedAt']) {
    if (post[df] && !config.dateRe.test(post[df])) {
      issues.push({
        code: 'bad_date',
        message: `${df} must be YYYY-MM-DD, got ${post[df]}`,
        field: df,
      });
    }
  }
  if (post.tags && !Array.isArray(post.tags)) {
    issues.push({ code: 'tags_not_array', message: 'tags must be an array', field: 'tags' });
  }
  if (post.faqs && !Array.isArray(post.faqs)) {
    issues.push({ code: 'faqs_not_array', message: 'faqs must be an array', field: 'faqs' });
  } else if (Array.isArray(post.faqs)) {
    for (const [i, faq] of post.faqs.entries()) {
      if (!faq || typeof faq.question !== 'string' || typeof faq.answer !== 'string') {
        issues.push({
          code: 'bad_faq',
          message: `faqs[${i}] must have question and answer strings`,
          field: 'faqs',
        });
      }
    }
  }
  for (const arrField of [
    'keyTakeaways',
    'relatedServices',
    'relatedTopics',
    'relatedPosts',
  ]) {
    if (post[arrField] !== undefined && !Array.isArray(post[arrField])) {
      issues.push({
        code: 'not_array',
        message: `${arrField} must be an array`,
        field: arrField,
      });
    }
  }
  return issues;
}

/**
 * @param {string} internalPath
 * @param {{ postSlugs: Set<string>, topicSlugs: Set<string>, serviceSlugs: Set<string>, businessSlugs: Set<string> }} siteIndex
 */
export function internalPathExists(internalPath, siteIndex) {
  const p = String(internalPath || '');
  const m = p.match(/^\/(blog|guide|best|directory|buildings)\/([a-z0-9-]+)$/);
  if (!m) return false;
  const [, kind, slug] = m;
  if (kind === 'blog') return siteIndex.postSlugs.has(slug);
  if (kind === 'guide') return siteIndex.topicSlugs.has(slug);
  if (kind === 'best') return siteIndex.serviceSlugs.has(slug);
  if (kind === 'directory' || kind === 'buildings') {
    return siteIndex.businessSlugs.has(slug) || siteIndex.postSlugs.has(slug);
  }
  return false;
}

/**
 * Full post-generation validation.
 * @param {object} args
 * @param {number} [args.nowMs] run clock; required to validate frontmatter dates
 * @param {{code:string,message:string,field?:string,detail?:unknown}[]} [args.repairWarnings]
 */
export function validateDraft({
  post,
  newsArticleStructuredData = null,
  evidencePack,
  siteIndex,
  nowMs = null,
  repairWarnings = [],
  imageExists = null,
  config = DRAFT_VALIDATION_CONFIG,
}) {
  /** @type {{code:string,message:string,field?:string,detail?:unknown}[]} */
  const failures = [];
  /** @type {{code:string,message:string,ok:boolean,detail?:unknown}[]} */
  const checks = [];
  /** @type {{code:string,message:string,blocking?:boolean,field?:string,detail?:unknown}[]} */
  const humanGates = [];
  /** @type {{code:string,message:string,field?:string,detail?:unknown}[]} */
  const warnings = [...(Array.isArray(repairWarnings) ? repairWarnings : [])];

  const fmIssues = validateFrontmatter(post, config);
  const fmOk = fmIssues.length === 0;
  checks.push({
    code: 'frontmatter_shape',
    message: fmOk
      ? 'Frontmatter matches required posts.json shape.'
      : 'Frontmatter malformed.',
    ok: fmOk,
    detail: fmIssues,
  });
  failures.push(...fmIssues);

  // Frontmatter dates must equal the drafting run date (never source article date).
  // Do NOT inject these into the evidence grounding index — that was the self-ground hole.
  const hasNow = Number.isFinite(Number(nowMs));
  const expectedRunDate = hasNow ? runDateIso(nowMs) : null;
  const fmDateIssues = [];
  if (!hasNow) {
    fmDateIssues.push({
      code: 'run_date_missing',
      message: 'nowMs is required to validate publishedAt/updatedAt against the run date',
      field: 'publishedAt',
    });
  } else {
    for (const df of ['publishedAt', 'updatedAt']) {
      const value = post?.[df];
      if (!value) continue; // missing handled by frontmatter_shape
      if (!config.dateRe.test(value)) continue; // format handled by frontmatter_shape
      if (value !== expectedRunDate) {
        fmDateIssues.push({
          code: 'frontmatter_date_not_run_date',
          message: `${df}=${value} must equal run date ${expectedRunDate} (source dates belong in the body, not frontmatter)`,
          field: df,
          detail: { value, expectedRunDate },
        });
      }
    }
    const sd = newsArticleStructuredData;
    if (sd && typeof sd === 'object') {
      for (const [field, key] of [
        ['datePublished', 'datePublished'],
        ['dateModified', 'dateModified'],
      ]) {
        const value = sd[key];
        if (value == null || value === '') continue;
        const day = String(value).slice(0, 10);
        if (config.dateRe.test(day) && day !== expectedRunDate) {
          fmDateIssues.push({
            code: 'structured_data_date_not_run_date',
            message: `newsArticleStructuredData.${key}=${value} must equal run date ${expectedRunDate}`,
            field: key,
            detail: { value, expectedRunDate },
          });
        }
      }
    }
  }
  const fmDatesOk = fmDateIssues.length === 0;
  checks.push({
    code: 'frontmatter_dates_are_run_date',
    message: fmDatesOk
      ? `publishedAt/updatedAt match run date${expectedRunDate ? ` ${expectedRunDate}` : ''}.`
      : 'Frontmatter or structured-data dates do not match the drafting run date.',
    ok: fmDatesOk,
    detail: { expectedRunDate, issues: fmDateIssues },
  });
  failures.push(...fmDateIssues);

  // Image: omit/null is correct (never fabricate), but blocks publish readiness.
  // Fabricated or non-existent paths are treated as absent and never clear the gate.
  const imageInfo = normalizeDraftImageField(post, {
    imageExists: typeof imageExists === 'function' ? imageExists : undefined,
  });
  const imagePresent = imageInfo.imageStatus === 'present';
  checks.push({
    code: 'image_field',
    message: imagePresent
      ? 'Image path present and verified on disk.'
      : imageInfo.rejectedImage
        ? 'Image path rejected (fabricated/unverified) — human must supply a real local asset.'
        : 'Image absent/null — human must supply image before publish (not fabricated).',
    ok: true, // absence is not a content-validation failure
    detail: {
      imageStatus: imageInfo.imageStatus,
      humanMustSupplyImage: imageInfo.humanMustSupplyImage,
      image: imagePresent ? imageInfo.post?.image : null,
      rejectedImage: imageInfo.rejectedImage || null,
    },
  });
  if (imageInfo.rejectedImage) {
    warnings.push({
      code: 'image_path_rejected',
      message: `Rejected unverified image path: ${imageInfo.rejectedImage}`,
      field: 'image',
      detail: { rejectedImage: imageInfo.rejectedImage },
    });
  }
  if (!imagePresent) {
    humanGates.push({
      code: 'image_required_for_publish',
      message:
        'Human must supply image before publish. Draft correctly omits/nulls image rather than fabricating a path.',
      blocking: true,
      field: 'image',
    });
  }

  // Quote scan: prose fields only. Do NOT JSON.stringify FAQs/takeaways — that
  // turns ordinary answer sentences into fake "quoted" spans and false-positives
  // the 25-word cap.
  const proseForQuotes = `${post?.content || ''}\n${post?.answerBlock || ''}\n${post?.description || ''}`;
  const content = `${proseForQuotes}\n${(post?.faqs || [])
    .map((f) => `${f?.question || ''} ${f?.answer || ''}`)
    .join('\n')}\n${(post?.keyTakeaways || []).join('\n')}`;

  const quotes = extractQuotes(proseForQuotes);
  const longQuotes = quotes.filter((q) => wordCount(q) > config.maxQuoteWords);
  const quotesOk = longQuotes.length === 0;
  checks.push({
    code: 'quote_length_cap',
    message: quotesOk
      ? `No quotes exceed ${config.maxQuoteWords} words.`
      : `${longQuotes.length} quote(s) exceed ${config.maxQuoteWords} words.`,
    ok: quotesOk,
    detail: longQuotes.map((q) => ({ words: wordCount(q), quote: q })),
  });
  if (!quotesOk) {
    failures.push({
      code: 'quote_too_long',
      message: `Quote exceeds ${config.maxQuoteWords} words`,
      detail: longQuotes,
    });
  }

  const allowed = evidenceAllowedUrls(evidencePack);
  const draftUrls = extractHttpUrls(content);
  const extraScan = JSON.stringify(newsArticleStructuredData || {});
  draftUrls.push(...extractHttpUrls(extraScan));
  const uniqueDraftUrls = [...new Set(draftUrls.map(normalizeUrl))];
  const unknownUrls = uniqueDraftUrls.filter((u) => {
    if (!u) return false;
    // Site origin and on-site absolute URLs are internal, not evidence URLs.
    if (/^https?:\/\/(www\.)?libertyvillage\.co\/?$/i.test(u)) return false;
    if (/^https?:\/\/(www\.)?libertyvillage\.co\//i.test(u)) return false;
    if (/^https?:\/\/schema\.org/i.test(u)) return false;
    return !allowed.has(u) && ![...allowed].some((a) => urlsLooselyEqual(a, u));
  });
  const urlsOk = unknownUrls.length === 0;
  checks.push({
    code: 'urls_in_evidence',
    message: urlsOk
      ? 'All external URLs appear in the evidence pack.'
      : `${unknownUrls.length} URL(s) absent from evidence pack.`,
    ok: urlsOk,
    detail: { unknownUrls, allowed: [...allowed] },
  });
  if (!urlsOk) {
    failures.push({
      code: 'url_not_in_evidence',
      message: 'Draft contains URL not present in evidence pack',
      detail: unknownUrls,
    });
  }

  const internalPaths = extractInternalPaths(content);
  for (const slug of post?.relatedPosts || []) internalPaths.push(`/blog/${slug}`);
  for (const slug of post?.relatedTopics || []) internalPaths.push(`/guide/${slug}`);
  for (const slug of post?.relatedServices || []) internalPaths.push(`/best/${slug}`);
  for (const cl of post?.crossLinks || []) {
    if (cl?.type === 'guide' && cl.slug) internalPaths.push(`/guide/${cl.slug}`);
    if (cl?.type === 'service' && cl.slug) internalPaths.push(`/best/${cl.slug}`);
  }

  const uniqueInternal = [...new Set(internalPaths)];
  const badInternal = uniqueInternal.filter((p) => !internalPathExists(p, siteIndex));
  const internalOk = badInternal.length === 0;
  checks.push({
    code: 'internal_links_exist',
    message: internalOk
      ? 'All internal content links resolve to site data slugs.'
      : `${badInternal.length} internal link(s) point at non-existent slugs.`,
    ok: internalOk,
    detail: { badInternal, checked: uniqueInternal },
  });
  if (!internalOk) {
    failures.push({
      code: 'internal_link_missing',
      message: 'Draft contains internal link to non-existent slug',
      detail: badInternal,
    });
  }

  // Evidence index is source text only — never seed with frontmatter dates
  // (that allowed publishedAt=2099 to self-ground). The drafting run date from
  // the injectable clock is a system fact, so body lines like "Published {runDate}"
  // may reference it without appearing in source evidence.
  const evidenceBlob = evidenceTextBlob(evidencePack);
  const index = buildEvidenceGroundingIndex(evidenceBlob);
  if (expectedRunDate) {
    index.isoDates.add(expectedRunDate);
    index.years.add(expectedRunDate.slice(0, 4));
    // Allow month-day fragments from the run date only (e.g. body "August 8, 2026").
    const runMs = Number(nowMs);
    if (Number.isFinite(runMs)) {
      const run = new Date(runMs);
      const months = [
        'january',
        'february',
        'march',
        'april',
        'may',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december',
      ];
      const monthName = months[run.getUTCMonth()];
      if (monthName) index.lower += `\n${monthName} ${run.getUTCDate()} ${expectedRunDate}`;
      index.numbers.add(String(run.getUTCDate()).padStart(2, '0'));
      index.numbers.add(String(run.getUTCDate()));
      index.numbers.add(String(run.getUTCMonth() + 1).padStart(2, '0'));
      index.numbers.add(String(run.getUTCMonth() + 1));
    }
  }

  const asserted = extractAssertedNumbersAndDates(content);
  const ungrounded = asserted.filter((item) => !isGroundedInEvidence(item, index));
  const numbersOk = ungrounded.length === 0;
  checks.push({
    code: 'numbers_dates_grounded',
    message: numbersOk
      ? 'All asserted numbers/dates appear in the evidence pack.'
      : `${ungrounded.length} number/date assertion(s) absent from evidence.`,
    ok: numbersOk,
    detail: { ungrounded, sampleEvidenceNumbers: [...index.numbers].slice(0, 40) },
  });
  if (!numbersOk) {
    failures.push({
      code: 'ungrounded_number_or_date',
      message: 'Draft asserts a number/date absent from the evidence pack',
      detail: ungrounded,
    });
  }

  const sd = newsArticleStructuredData;
  let sdOk = Boolean(sd && typeof sd === 'object');
  if (sdOk) {
    const type = sd['@type'] || sd.type;
    if (String(type) !== 'NewsArticle') {
      sdOk = false;
      failures.push({
        code: 'structured_data_type',
        message: `structured data @type must be NewsArticle, got ${type}`,
      });
    }
  } else {
    failures.push({
      code: 'structured_data_missing',
      message: 'Missing NewsArticle structured data',
    });
  }
  checks.push({
    code: 'news_article_structured_data',
    message: sdOk
      ? 'NewsArticle structured data present.'
      : 'NewsArticle structured data missing or malformed.',
    ok: sdOk,
  });

  const hasWhy =
    typeof post?.content === 'string' &&
    /##\s*Why this matters in Liberty Village\b/i.test(post.content);
  checks.push({
    code: 'why_this_matters_section',
    message: hasWhy
      ? 'Contains "Why this matters in Liberty Village" section.'
      : 'Missing "Why this matters in Liberty Village" section.',
    ok: hasWhy,
  });
  if (!hasWhy) {
    failures.push({
      code: 'missing_local_section',
      message: 'Content missing "## Why this matters in Liberty Village" section',
    });
  }

  if (warnings.length) {
    checks.push({
      code: 'repair_warnings',
      message: `${warnings.length} internal-link repair warning(s) recorded.`,
      ok: true,
      detail: warnings,
    });
  }

  const ok = failures.length === 0;
  const publishReady = ok && humanGates.length === 0;
  return {
    ok,
    passed: ok,
    publishReady,
    failures,
    humanGates,
    warnings,
    checks,
    stats: {
      quoteCount: quotes.length,
      externalUrlCount: uniqueDraftUrls.length,
      internalPathCount: uniqueInternal.length,
      assertedNumberDateCount: asserted.length,
      humanGateCount: humanGates.length,
      warningCount: warnings.length,
      imageStatus: imageInfo.imageStatus,
      expectedRunDate,
    },
  };
}

function urlsLooselyEqual(a, b) {
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  if (na === nb) return true;
  const stripWww = (u) => u.replace(/:\/\/www\./i, '://');
  return stripWww(na) === stripWww(nb);
}

/**
 * Drop or re-home internal link fields that point at real slugs under the wrong
 * bucket (e.g. crossLinks type=guide with a blog post slug). Does not invent slugs.
 * Returns warnings for every drop/move so validation can surface model hallucination.
 * @param {object} post
 * @param {{ postSlugs: Set<string>, topicSlugs: Set<string>, serviceSlugs: Set<string> }} siteIndex
 * @returns {{ post: object, warnings: {code:string,message:string,field?:string,detail?:unknown}[] }}
 */
export function repairInternalLinkFields(post, siteIndex) {
  if (!post || typeof post !== 'object') return { post, warnings: [] };
  const next = { ...post };
  /** @type {{code:string,message:string,field?:string,detail?:unknown}[]} */
  const warnings = [];

  const originalPosts = Array.isArray(next.relatedPosts) ? [...next.relatedPosts] : [];
  const originalTopics = Array.isArray(next.relatedTopics) ? [...next.relatedTopics] : [];
  const originalServices = Array.isArray(next.relatedServices)
    ? [...next.relatedServices]
    : [];
  const originalCross = Array.isArray(next.crossLinks) ? [...next.crossLinks] : [];

  const relatedPosts = new Set();
  const relatedTopics = new Set();
  const relatedServices = new Set();

  for (const s of originalPosts) {
    if (siteIndex.postSlugs.has(s)) {
      relatedPosts.add(s);
    } else if (siteIndex.topicSlugs.has(s)) {
      relatedTopics.add(s);
      warnings.push({
        code: 'internal_link_rebucketed',
        message: `relatedPosts slug "${s}" is a topic; moved to relatedTopics`,
        field: 'relatedPosts',
        detail: { slug: s, from: 'relatedPosts', to: 'relatedTopics' },
      });
    } else if (siteIndex.serviceSlugs.has(s)) {
      relatedServices.add(s);
      warnings.push({
        code: 'internal_link_rebucketed',
        message: `relatedPosts slug "${s}" is a service; moved to relatedServices`,
        field: 'relatedPosts',
        detail: { slug: s, from: 'relatedPosts', to: 'relatedServices' },
      });
    } else {
      warnings.push({
        code: 'internal_link_dropped',
        message: `relatedPosts slug "${s}" not found in site data; dropped`,
        field: 'relatedPosts',
        detail: { slug: s, from: 'relatedPosts', reason: 'unknown_slug' },
      });
    }
  }

  for (const s of originalTopics) {
    if (siteIndex.topicSlugs.has(s)) {
      relatedTopics.add(s);
    } else if (siteIndex.postSlugs.has(s)) {
      relatedPosts.add(s);
      warnings.push({
        code: 'internal_link_rebucketed',
        message: `relatedTopics slug "${s}" is a post; moved to relatedPosts`,
        field: 'relatedTopics',
        detail: { slug: s, from: 'relatedTopics', to: 'relatedPosts' },
      });
    } else if (siteIndex.serviceSlugs.has(s)) {
      relatedServices.add(s);
      warnings.push({
        code: 'internal_link_rebucketed',
        message: `relatedTopics slug "${s}" is a service; moved to relatedServices`,
        field: 'relatedTopics',
        detail: { slug: s, from: 'relatedTopics', to: 'relatedServices' },
      });
    } else {
      warnings.push({
        code: 'internal_link_dropped',
        message: `relatedTopics slug "${s}" not found in site data; dropped`,
        field: 'relatedTopics',
        detail: { slug: s, from: 'relatedTopics', reason: 'unknown_slug' },
      });
    }
  }

  for (const s of originalServices) {
    if (siteIndex.serviceSlugs.has(s)) {
      relatedServices.add(s);
    } else if (siteIndex.postSlugs.has(s)) {
      relatedPosts.add(s);
      warnings.push({
        code: 'internal_link_rebucketed',
        message: `relatedServices slug "${s}" is a post; moved to relatedPosts`,
        field: 'relatedServices',
        detail: { slug: s, from: 'relatedServices', to: 'relatedPosts' },
      });
    } else if (siteIndex.topicSlugs.has(s)) {
      relatedTopics.add(s);
      warnings.push({
        code: 'internal_link_rebucketed',
        message: `relatedServices slug "${s}" is a topic; moved to relatedTopics`,
        field: 'relatedServices',
        detail: { slug: s, from: 'relatedServices', to: 'relatedTopics' },
      });
    } else {
      warnings.push({
        code: 'internal_link_dropped',
        message: `relatedServices slug "${s}" not found in site data; dropped`,
        field: 'relatedServices',
        detail: { slug: s, from: 'relatedServices', reason: 'unknown_slug' },
      });
    }
  }

  const crossLinks = [];
  for (const cl of originalCross) {
    if (!cl || !cl.slug) continue;
    if (cl.type === 'guide' && siteIndex.topicSlugs.has(cl.slug)) {
      crossLinks.push({ ...cl, type: 'guide' });
      relatedTopics.add(cl.slug);
      continue;
    }
    if (cl.type === 'service' && siteIndex.serviceSlugs.has(cl.slug)) {
      crossLinks.push({ ...cl, type: 'service' });
      relatedServices.add(cl.slug);
      continue;
    }
    // Mis-typed blog post: keep as relatedPosts only (crossLinks schema has no post type).
    if (siteIndex.postSlugs.has(cl.slug)) {
      relatedPosts.add(cl.slug);
      warnings.push({
        code: 'internal_link_rebucketed',
        message: `crossLinks slug "${cl.slug}" (type=${cl.type || 'unset'}) is a post; moved to relatedPosts and removed from crossLinks`,
        field: 'crossLinks',
        detail: {
          slug: cl.slug,
          from: 'crossLinks',
          to: 'relatedPosts',
          originalType: cl.type || null,
        },
      });
      continue;
    }
    if (siteIndex.topicSlugs.has(cl.slug)) {
      crossLinks.push({ type: 'guide', slug: cl.slug, label: cl.label });
      relatedTopics.add(cl.slug);
      if (cl.type !== 'guide') {
        warnings.push({
          code: 'internal_link_rebucketed',
          message: `crossLinks slug "${cl.slug}" retyped to guide`,
          field: 'crossLinks',
          detail: {
            slug: cl.slug,
            from: 'crossLinks',
            to: 'crossLinks',
            originalType: cl.type || null,
            newType: 'guide',
          },
        });
      }
      continue;
    }
    if (siteIndex.serviceSlugs.has(cl.slug)) {
      crossLinks.push({ type: 'service', slug: cl.slug, label: cl.label });
      relatedServices.add(cl.slug);
      if (cl.type !== 'service') {
        warnings.push({
          code: 'internal_link_rebucketed',
          message: `crossLinks slug "${cl.slug}" retyped to service`,
          field: 'crossLinks',
          detail: {
            slug: cl.slug,
            from: 'crossLinks',
            to: 'crossLinks',
            originalType: cl.type || null,
            newType: 'service',
          },
        });
      }
      continue;
    }
    warnings.push({
      code: 'internal_link_dropped',
      message: `crossLinks slug "${cl.slug}" not found in site data; dropped`,
      field: 'crossLinks',
      detail: {
        slug: cl.slug,
        from: 'crossLinks',
        reason: 'unknown_slug',
        originalType: cl.type || null,
      },
    });
  }

  next.relatedPosts = [...relatedPosts];
  next.relatedTopics = [...relatedTopics];
  next.relatedServices = [...relatedServices];
  if (crossLinks.length) next.crossLinks = crossLinks;
  else delete next.crossLinks;
  return { post: next, warnings };
}

/**
 * Normalize a model payload into { post, newsArticleStructuredData, citations, ungroundedRiskNotes }.
 * @param {object} value
 */
export function normalizeModelDraftPayload(value) {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'payload_not_object' };
  }
  const post = value.post || value.frontmatter || value.article || null;
  if (!post || typeof post !== 'object') {
    if (value.slug && value.content) {
      return {
        ok: true,
        post: value,
        newsArticleStructuredData:
          value.newsArticleStructuredData || value.structuredData || null,
        citations: value.citations || [],
        ungroundedRiskNotes: value.ungroundedRiskNotes || [],
      };
    }
    return { ok: false, error: 'missing_post_object' };
  }
  return {
    ok: true,
    post,
    newsArticleStructuredData:
      value.newsArticleStructuredData ||
      value.structuredData ||
      post.newsArticleStructuredData ||
      null,
    citations: value.citations || [],
    ungroundedRiskNotes: value.ungroundedRiskNotes || [],
  };
}
