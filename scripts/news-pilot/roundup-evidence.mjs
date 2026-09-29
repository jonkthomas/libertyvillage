import { createHash } from 'node:crypto';
import { isUnusableUrl } from './url-guard.mjs';
import { detectNonEventLabels, detectRiskFlags, isDevelopmentApplication, scoreLocalRelevance, SCORE_CONFIG } from './score.mjs';
import { publisherDomain } from './normalize.mjs';
import { matchExistingPost } from './dedupe.mjs';

const WEEK_MS = 604800000;
const DAY_MS = 86400000;
const torontoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const torontoParts = (ms) => Object.fromEntries(torontoDate.formatToParts(ms).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
function torontoMidnight(date) {
  const parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00.000Z') : NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) return NaN;
  const [year, month, day] = date.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day);
  // Resolve Toronto's offset at local midnight, including DST transitions.
  let instant = wall + 5 * 3600000;
  for (let n = 0; n < 3; n += 1) {
    const parts = torontoParts(instant);
    const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    instant += wall - local;
  }
  const parts = torontoParts(instant);
  return parts.year === year && parts.month === month && parts.day === day && parts.hour === 0 && parts.minute === 0 ? instant : NaN;
}
const localDate = (ms) => {
  const { year, month, day } = torontoParts(ms);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
const FULL_DATE = /\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi;
const MONTHS = new Map(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((month, index) => [month, index + 1]));
const fullDatesInSpan = (span) => [...String(span || '').matchAll(FULL_DATE)].map(([raw]) => {
  const match = raw.match(/^(\w+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  const date = match ? `${match[3]}-${String(MONTHS.get(match[1].slice(0, 3).toLowerCase())).padStart(2, '0')}-${match[2].padStart(2, '0')}` : raw;
  const parsed = Date.parse(date + 'T00:00:00.000Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
}).filter(Boolean);
/** A timed assertion needs a time in the cited passage, not just a calendar date. */
export function sourceSpanProvesTime(span, instant) {
  if (!Number.isFinite(instant)) return false;
  const text = String(span || '');
  const absolute = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/gi)]
    .some(([value]) => Date.parse(value) === instant);
  if (absolute) return true;
  const local = torontoParts(instant);
  if (!fullDatesInSpan(text).includes(localDate(instant))) return false;
  return [...text.matchAll(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)\b|\b(\d{1,2}):(\d{2})\b/gi)]
    .some(([, hour12, minute12, meridiem, hour24, minute24]) => {
      const hour = meridiem ? Number(hour12) % 12 + (/^p/i.test(meridiem) ? 12 : 0) : Number(hour24);
      const minute = Number(meridiem ? minute12 : minute24);
      return hour === local.hour && minute === local.minute;
    });
}
const sourceProves = (sources, url, span, dates) => {
  if (typeof span !== 'string' || !span.trim() || !fullDatesInSpan(span).some((date) => dates.includes(date))) return false;
  const cited = sources.find((s) => s.canonicalUrl === url && s.fetchOk === true && s.extractionSubstantive === true &&
    String(s.excerpt || '').includes(span));
  if (!cited) return false;
  if (['official', 'primary'].includes(cited.sourceTier)) return true;
  return new Set(sources.filter((s) => s.fetchOk === true && s.extractionSubstantive === true &&
    String(s.excerpt || '').includes(span)).map((s) => s.publisherDomain)).size >= 2;
};
const RISK_CATEGORIES = new Set(['crime', 'safety', 'election', 'elections', 'civic-controversy', 'development-application']);
const ELECTION_TEXT = /\b(?:elections?|electoral|ballots?|voters?|voting|candidates?|mayor(?:al)?|advance\s+poll(?:ing)?|polling\s+(?:place|station))\b/i;
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
  const riskText = [item?.title, item?.summary, ...(item?.claims || []).map((c) => c.text), ...sources.map((s) => s.excerpt)].join(' ');
  if (RISK_CATEGORIES.has(String(item?.category || '').toLowerCase()) || ELECTION_TEXT.test(String(item?.category || '')) ||
    ELECTION_TEXT.test(riskText) || item?.weakSource || (item?.riskFlags || []).length ||
    detectRiskFlags({ title: item?.title, snippet: riskText }).length) reasons.push('risky');
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
  const publicationDate = isoTime(item?.announcedAt) ? Date.parse(item.announcedAt) : NaN;
  const publicationProof = item?.announcedAtVerified === true && Number.isFinite(publicationDate) &&
    sourceProves(sources, item?.announcedAtSourceUrl, item?.announcedAtSpan,
      [new Date(publicationDate).toISOString().slice(0, 10), localDate(publicationDate)]);
  // When only a date is cited, assume its earliest plausible instant; an uncited
  // metadata time cannot extend the seven-day eligibility window.
  const citedDate = publicationProof ? fullDatesInSpan(item.announcedAtSpan).find((date) =>
    date === new Date(publicationDate).toISOString().slice(0, 10) || date === localDate(publicationDate)) : null;
  const publicationMs = publicationProof ? (sourceSpanProvesTime(item.announcedAtSpan, publicationDate)
    ? publicationDate : Math.min(Date.parse(citedDate + 'T00:00:00.000Z'), torontoMidnight(citedDate))) : NaN;
  const newsWindow = publicationMs >= nowMs - WEEK_MS && publicationMs <= nowMs &&
    (!item?.updatedOldPage || item?.substantiveDevelopment === true);
  const datedStart = item?.eventStartDate ? torontoMidnight(item.eventStartDate) : NaN;
  const datedEnd = item?.eventStartDate && Number.isFinite(datedStart)
    ? torontoMidnight(new Date(Date.parse(item.eventStartDate + 'T00:00:00.000Z') + DAY_MS).toISOString().slice(0, 10)) : NaN;
  const timedStart = isoTime(item?.eventStart) ? Date.parse(item.eventStart) : NaN;
  const hasEvent = !!(item?.eventStart || item?.eventStartDate);
  const eventDate = item?.eventStartDate || (Number.isFinite(timedStart) ? localDate(timedStart) : null);
  const eventProof = hasEvent && item?.eventStartVerified === true && eventDate &&
    sourceProves(sources, item?.eventStartSourceUrl, item?.eventStartSpan, [eventDate]) &&
    (!item?.eventStart || sourceSpanProvesTime(item.eventStartSpan, timedStart));
  const eventWindow = eventProof && !item?.eventConcluded &&
    (item?.eventStartDate ? Number.isFinite(datedStart) && datedStart > nowMs && datedEnd <= nowMs + 14 * DAY_MS
      : Number.isFinite(timedStart) && timedStart > nowMs && timedStart < nowMs + 14 * DAY_MS);
  if (item?.eventStart && !isoTime(item.eventStart)) reasons.push('invalid-event');
  if (hasEvent && !eventProof) reasons.push('invalid-event');
  if (item?.eventStartDate && (!Number.isFinite(datedStart) || item?.eventStart)) reasons.push('invalid-event');
  if (item?.eventEnd && (!isoTime(item.eventEnd) || Date.parse(item.eventEnd) <= nowMs)) reasons.push('concluded');
  if (item?.eventEnd && !hasEvent) reasons.push('invalid-event');
  if (isoTime(item?.eventEnd) && (Number.isFinite(timedStart) || Number.isFinite(datedStart)) &&
    Date.parse(item.eventEnd) <= (Number.isFinite(timedStart) ? timedStart : datedStart)) reasons.push('invalid-event');
  if (hasEvent && ((Number.isFinite(timedStart) && timedStart <= nowMs) ||
    (Number.isFinite(datedStart) && datedStart <= nowMs) || item?.eventConcluded === true)) reasons.push('concluded');
  if (!newsWindow && !eventWindow) reasons.push(!publicationProof && !eventProof ? 'undated' : 'stale');
  if (item?.updatedOldPage && item?.substantiveDevelopment !== true && !eventWindow) reasons.push('stale');
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
  return { item, decision, reasons: unique, temporalCategory: newsWindow ? 'news-update' : eventWindow ? 'upcoming-event' : null };
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
        riskFlags: item.riskFlags, announcedAt: item.announcedAt, eventStart: item.eventStart, eventStartDate: item.eventStartDate,
        eventEnd: item.eventEnd, duplicateRelation: item.duplicateRelation ?? null });
      const newDigest = sha({ sources: fresh.map((s) => [s?.canonicalUrl, s?.excerpt, s?.extractionSubstantive, s?.publisherDomain, s?.fetchOk, s?.urlUsable]),
        riskFlags: item.riskFlags, announcedAt: item.announcedAt, eventStart: item.eventStart, eventStartDate: item.eventStartDate,
        eventEnd: item.eventEnd, duplicateRelation: item.duplicateRelation ?? null });
      const changedFacts = fresh.some((source) => source &&
        ['riskFlags', 'announcedAt', 'eventStart', 'eventStartDate', 'eventEnd', 'eventConcluded', 'duplicateRelation']
          .some((key) => Object.hasOwn(source, key) && (key === 'eventConcluded'
            ? source[key] === true : JSON.stringify(source[key]) !== JSON.stringify(item[key] ?? null))));
      if (oldDigest !== newDigest || changedFacts) excluded.push({ item, reason: 'source-changed-rebuild' });
      else accepted.push(item);
    } catch { excluded.push({ item, reason: 'refetch-failed' }); }
  }
  return { accepted, excluded };
}
