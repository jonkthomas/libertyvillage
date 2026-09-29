import { createHash } from 'node:crypto';
import { isUnusableUrl } from './url-guard.mjs';
import { detectNonEventLabels, detectRiskFlags, isDevelopmentApplication, scoreLocalRelevance, SCORE_CONFIG } from './score.mjs';
import { publisherDomain } from './normalize.mjs';
import { matchExistingPost } from './dedupe.mjs';

const WEEK_MS = 604800000;
const RISK_CATEGORIES = new Set(['crime', 'safety', 'civic-controversy', 'development-application']);
const NON_NEWS = new Set(['directory', 'query', 'landing-page', 'application', 'opinion', 'promotion']);
const isoTime = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
const canonical = (url) => { try { const u = new URL(url); u.hash = ''; return u.href.replace(/\/$/, ''); } catch { return ''; } };
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonicalJson = (value) => JSON.stringify(value, (_, item) =>
  item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
export const roundupPackDigest = (pack) => createHash('sha256').update(canonicalJson(pack)).digest('hex');
const postUrls = (post) => [post?.canonicalUrl, ...(String(post?.content ?? post?.body ?? '').match(/https:\/\/[^\s)\]>'"]+/g) || [])].filter(Boolean).map(canonical);

/** Each item is judged independently; no source from another item can support it. */
export function validateRoundupItem(item, { weekStartUtc, nowMs = Date.now(), livePosts = [], dailyNews = [] } = {}) {
  const reasons = [];
  const sources = Array.isArray(item?.sources) ? item.sources : [];
  if (!item || !String(item.title || '').trim()) reasons.push('invalid-item');
  if (NON_NEWS.has(item?.kind) || NON_NEWS.has(item?.category)) reasons.push('not-news');
  if (detectNonEventLabels({ title: item?.title, snippet: item?.summary }).length) reasons.push('not-news');
  if (isDevelopmentApplication(item)) reasons.push('risky');
  if (!Array.isArray(item?.riskFlags)) reasons.push('risk-unassessed');
  if (RISK_CATEGORIES.has(item?.category) || item?.weakSource || (item?.riskFlags || []).length ||
    detectRiskFlags({ title: item?.title, snippet: [item?.summary, ...(item?.claims || []).map((c) => c.text),
      ...sources.map((s) => s.excerpt)].join(' ') }).length) reasons.push('risky');
  const local = scoreLocalRelevance({ title: item?.title, snippet: String(item?.location || '') + ' ' + String(item?.actor || '') + ' ' + String(item?.summary || '') });
  if (local.score < SCORE_CONFIG.minLocalRelevance || !String(item?.location || '').trim() || !String(item?.actor || '').trim()) reasons.push('not-local');
  if (!sources.length) reasons.push('weak-source');
  const urls = new Set();
  for (const source of sources) {
    const url = source?.canonicalUrl;
    if (!url || !/^https:\/\//i.test(url) || isUnusableUrl(url) || canonical(url) !== url || urls.has(url)) reasons.push('invalid-source-url');
    urls.add(url);
    if (!String(source?.publisher || '').trim() || !String(source?.publisherDomain || '').trim() ||
      source.publisherDomain !== publisherDomain(url) ||
      !String(source?.excerpt || '').trim() || source?.extractionSubstantive !== true || !isoTime(source?.extractedAt) ||
      (isoTime(source?.extractedAt) && Date.parse(source.extractedAt) > nowMs) ||
      source?.fetchOk !== true || source?.urlUsable !== true) reasons.push('weak-source');
  }
  const primary = sources.some((s) => ['official', 'primary'].includes(s.sourceTier) && s.extractionSubstantive === true);
  const independent = new Set(sources.filter((s) => s.extractionSubstantive === true).map((s) => s.publisherDomain)).size >= 2;
  if (!primary && !independent) reasons.push('weak-source');
  if (!Array.isArray(item?.claims) || !item.claims.length) reasons.push('missing-claims');
  for (const claim of item?.claims || []) {
    const source = sources.find((s) => s.canonicalUrl === claim?.sourceUrl);
    if (!source || !String(claim?.span || '').trim() || !String(source.excerpt || '').includes(claim.span)) reasons.push('source-swapped');
    if (!String(claim?.text || '').trim()) reasons.push('missing-claims');
  }
  const start = Date.parse(weekStartUtc ?? '');
  if (!Number.isFinite(start) || new Date(start).toISOString() !== weekStartUtc || new Date(start).getUTCDay() !== 1 ||
    new Date(start).getUTCHours() !== 0 || new Date(start).getUTCMinutes() !== 0) reasons.push('invalid-week');
  if (item?.announcedAtVerified !== true || !isoTime(item?.announcedAt)) reasons.push('undated');
  else if (Number.isFinite(start) && (Date.parse(item.announcedAt) < start || Date.parse(item.announcedAt) >= start + WEEK_MS ||
    Date.parse(item.announcedAt) > nowMs)) reasons.push('stale');
  if (item?.updatedOldPage && item?.substantiveDevelopment !== true) reasons.push('stale');
  if (item?.eventStart && !isoTime(item.eventStart)) reasons.push('invalid-event');
  if (item?.eventEnd && (!isoTime(item.eventEnd) || Date.parse(item.eventEnd) <= nowMs)) reasons.push('concluded');
  if (item?.eventEnd && !item?.eventStart) reasons.push('invalid-event');
  if (isoTime(item?.eventStart) && isoTime(item?.eventEnd) && Date.parse(item.eventEnd) <= Date.parse(item.eventStart))
    reasons.push('invalid-event');
  if (item?.eventStart && Date.parse(item.eventStart) <= nowMs && !item?.eventEnd) reasons.push('concluded');
  if (item?.eventConcluded === true) reasons.push('concluded');
  const duplicate = [...livePosts, ...dailyNews].some((p) =>
    (item?.fingerprint && item.fingerprint === (p?.fingerprint ?? p?.newsFingerprint)) ||
    sources.some((s) => postUrls(p).includes(s.canonicalUrl)));
  if (duplicate) reasons.push('duplicate');
  const candidate = { title: item?.title, snippet: item?.summary, canonicalUrl: sources[0]?.canonicalUrl,
    publishedAt: item?.announcedAt, dateConfidence: 'exact' };
  const coveredLive = matchExistingPost(candidate, livePosts, { nowMs }).coverageRelation === 'duplicate';
  const coveredDaily = matchExistingPost(candidate, dailyNews, { nowMs }).coverageRelation === 'duplicate' ||
    dailyNews.some((p) => p?.relatedFingerprint === item?.fingerprint ||
      (item?.relatedDailySlug && p?.slug === item.relatedDailySlug));
  const distinct = item?.distinctDevelopment?.corroborated === true &&
    String(item.distinctDevelopment.description || '').trim() &&
    (primary || independent) &&
    (item.distinctDevelopment.sourceUrls || []).some((url) => urls.has(url));
  if (coveredLive || (coveredDaily && !distinct)) reasons.push('duplicate');
  const unique = [...new Set(reasons)];
  const decision = unique.some((r) => ['risky', 'risk-unassessed', 'weak-source', 'source-swapped', 'invalid-source-url'].includes(r)) ? 'refused'
    : unique.includes('undated') ? 'held' : unique.length ? 'excluded' : 'accepted';
  return { item, decision, reasons: unique };
}

export function validateRoundupPack(pack, opts = {}) {
  const items = Array.isArray(pack) ? pack : pack?.items;
  const result = { accepted: [], held: [], refused: [], excluded: [],
    census: { sourcesSeen: 0, byReason: { held: 0, refused: 0, excluded: 0, stale: 0, duplicate: 0, undated: 0, sourceSwapped: 0, risky: 0 } } };
  const seenUrls = new Set(), seenFingerprints = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    result.census.sourcesSeen += Array.isArray(item?.sources) ? item.sources.length : 0;
    let check = validateRoundupItem(item, opts);
    const urls = (item?.sources || []).map((s) => s.canonicalUrl).filter(Boolean);
    if (urls.some((url) => seenUrls.has(url)) || (item?.fingerprint && seenFingerprints.has(item.fingerprint)))
      check = { item, decision: 'excluded', reasons: ['duplicate'] };
    urls.forEach((url) => seenUrls.add(url));
    if (item?.fingerprint) seenFingerprints.add(item.fingerprint);
    result[check.decision].push(check);
    if (check.decision !== 'accepted') result.census.byReason[check.decision] += 1;
    for (const reason of check.reasons) {
      const key = reason === 'source-swapped' ? 'sourceSwapped' : reason;
      if (key in result.census.byReason && key !== check.decision) result.census.byReason[key] += 1;
    }
  }
  return result;
}

/** Changed or unavailable sources are withheld for a fresh validation pass. */
export async function revalidateRoundupItems(items, { refetch } = {}) {
  if (typeof refetch !== 'function') throw new Error('revalidation requires refetch');
  const accepted = [], excluded = [];
  for (const item of items || []) {
    try {
      const fresh = await Promise.all((item.sources || []).map((source) => refetch(source.canonicalUrl, source)));
      const oldDigest = sha({ sources: item.sources.map((s) => [s.canonicalUrl, s.excerpt, s.extractionSubstantive, s.publisherDomain, s.fetchOk, s.urlUsable]),
        riskFlags: item.riskFlags, announcedAt: item.announcedAt, duplicateRelation: item.duplicateRelation ?? null });
      const changedRisk = fresh.find((s) => s && Object.hasOwn(s, 'riskFlags'));
      const changedDate = fresh.find((s) => s && Object.hasOwn(s, 'announcedAt'));
      const changedRelation = fresh.find((s) => s && Object.hasOwn(s, 'duplicateRelation'));
      const newDigest = sha({ sources: fresh.map((s) => [s?.canonicalUrl, s?.excerpt, s?.extractionSubstantive, s?.publisherDomain, s?.fetchOk, s?.urlUsable]),
        riskFlags: changedRisk ? changedRisk.riskFlags : item.riskFlags,
        announcedAt: changedDate ? changedDate.announcedAt : item.announcedAt,
        duplicateRelation: changedRelation ? changedRelation.duplicateRelation : item.duplicateRelation ?? null });
      if (oldDigest !== newDigest) excluded.push({ item, reason: 'source-changed-rebuild' });
      else accepted.push(item);
    } catch { excluded.push({ item, reason: 'refetch-failed' }); }
  }
  return { accepted, excluded };
}
