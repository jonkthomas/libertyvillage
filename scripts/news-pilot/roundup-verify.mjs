import { createHash } from 'node:crypto';
import { registrableDomain } from './sources.mjs';
import { detectNonEventLabels, detectRiskFlags, isDevelopmentApplication } from './score.mjs';
import { roundupSourceQuality, sourceSpanProvesTime } from './roundup-evidence.mjs';
import { isoWeekOf, roundupCoveredKeys, planRoundupV2 } from './roundup.mjs';
export { roundupCoverageFromPack } from './roundup.mjs';

const DAY = 86400000;
const MONTH = new Map(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m, i) => [m, i + 1]));
const datePattern = /\b(?:20\d\d-\d\d-\d\d|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d\d)?)\b/gi;
const timePattern = /\b(?:noon|(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?))\b/gi;
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const local = (instant) => Object.fromEntries(fmt.formatToParts(new Date(instant)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
const dayOf = (instant) => { const p = local(instant); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const validDay = (day) => /^\d{4}-\d\d-\d\d$/.test(day) && Number.isFinite(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
const norm = (value) => String(value ?? '').normalize('NFC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const digest = (value) => createHash('sha256').update(JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)).digest('hex');
const fail = (reason) => { throw Object.assign(new Error(reason), { reason }); };
const isoWeekStart = (at) => isoWeekOf(at).weekStartUtc.slice(0, 10);
const sourceFor = (registry, id) => registry.find((s) => s.id === id);
const asText = (result) => typeof result === 'string' ? result : result?.body ?? result?.rawText ?? result?.text ?? '';
const responseStatus = (result) => result?.status ?? 200;
const blocked = (result) => result?.ok === false || responseStatus(result) >= 400;
const quoteFields = ['subject_quote', 'place_quote', 'date_quote'];
const feedFields = {
  'road-feed': ['id', 'road', 'fromRoad', 'toRoad', 'startTime', 'endTime', 'description'],
  'transit-feed': ['id', 'route', 'stops', 'segment', 'effect', 'activeStart', 'activeEnd', 'startTime', 'endTime'],
};
const canonical = (url) => { const parsed = new URL(url); parsed.hash = ''; return parsed.href.replace(/\/$/, ''); };
/** One verifier run shares robots decisions, per-host pacing and an 80-request budget. */
export async function createRoundupVerifierFetcher() {
  const [{ fetchWithRetry, createRequestBudget, createRobotsCache, createHostPacer, FETCH_DEFAULTS },
    { classifyBlockedResponse }] = await Promise.all([import('./fetch.mjs'), import('./url-guard.mjs')]);
  if (![fetchWithRetry, createRequestBudget, createRobotsCache, createHostPacer, classifyBlockedResponse]
    .every((part) => typeof part === 'function')) throw new Error('roundup access policy unavailable');
  const budget = createRequestBudget(80);
  const pacer = createHostPacer({ minIntervalMs: 2000 });
  const userAgent = FETCH_DEFAULTS.userAgent;
  const robots = createRobotsCache({ userAgent, fetchText: async (url) => {
    const result = await fetchWithRetry(url, { budget, pacer, userAgent, guardPublicHttp: true, maxRetries: 0 });
    return { status: result.status, body: result.rawText };
  } });
  return async (url, context = {}) => {
    const result = await fetchWithRetry(url, { budget, pacer, robots, userAgent, guardPublicHttp: true,
      sourceId: context.source?.id || null, maxRetries: 0 });
    if (classifyBlockedResponse(result.status, result.rawText) || result.errorCode === 'robots-disallowed')
      return { ...result, ok: false, errorCode: 'blocked' };
    return result;
  };
}
const syndicated = /originally published|first published|appeared originally|republished with permission|this article is from|©\s*Toronto Star/i;

async function originalFor(body, url, fetcher, recordTools = {}) {
  const html = String(body);
  const canonicalTag = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["']/i);
  const canonicalUrl = canonicalTag ? canonical(new URL(canonicalTag[1], url).href) : null;
  const foreign = canonicalUrl && registrableDomain(canonicalUrl) !== registrableDomain(url);
  const attribution = syndicated.test(html);
  if (!foreign && !attribution) return null;
  let originalUrl = foreign ? canonicalUrl : null;
  if (!originalUrl) {
    const sentence = html.match(/(?:originally published|first published|appeared originally|republished with permission|this article is from)[^.!?]{0,500}/i)?.[0] || '';
    const link = sentence.match(/href=["']([^"']+)["']/i);
    if (link) originalUrl = canonical(new URL(link[1], url).href);
  }
  if (!originalUrl || originalUrl === canonical(url) || registrableDomain(originalUrl) === registrableDomain(url)) fail('unverifiable');
  let original;
  try { original = await loadBody(originalUrl, fetcher, { originalOf: url }); } catch { fail('unverifiable'); }
  if (syndicated.test(original) || /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["']/i.test(original)) {
    const ownCanonical = original.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["']/i)?.[1];
    if (syndicated.test(original) || ownCanonical && canonical(new URL(ownCanonical, originalUrl).href) !== originalUrl) fail('unverifiable');
  }
  const visible = typeof recordTools.cleanMainHtml === 'function' && typeof recordTools.htmlToText === 'function'
    ? recordTools.htmlToText(recordTools.cleanMainHtml(original))
    : original.replace(/<[^>]+>/g, ' ');
  return { url: originalUrl, text: norm(visible) };
}

function parseCalendar(raw, { base, allowYearless = false, horizon = 60 } = {}) {
  const m = String(raw).match(/^(?:(\d{4})-(\d\d)-(\d\d)|([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?)$/i);
  if (!m) return null;
  const month = m[2] ? Number(m[2]) : MONTH.get(m[4].slice(0, 3).toLowerCase());
  const day = Number(m[3] || m[5]);
  const year = Number(m[1] || m[6]);
  if (year) {
    const out = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return validDay(out) ? out : null;
  }
  if (!allowYearless || !base) return null;
  const matches = [Number(base.slice(0, 4)) - 1, Number(base.slice(0, 4)), Number(base.slice(0, 4)) + 1].map((y) =>
    `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`).filter((d) => validDay(d) && d >= base && d <= addDays(base, horizon));
  return matches.length === 1 ? matches[0] : null;
}

function relativeDates(text, postDate) {
  if (!postDate) return [];
  const found = [];
  const words = /\b(today|tonight|tomorrow|(?:this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi;
  for (const [, raw] of text.matchAll(words)) {
    const word = raw.toLowerCase();
    if (word === 'today' || word === 'tonight') found.push(postDate);
    else if (word === 'tomorrow') found.push(addDays(postDate, 1));
    else {
      const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(word.split(' ')[1]);
      const today = new Date(postDate + 'T00:00:00Z').getUTCDay();
      found.push(addDays(postDate, (target - today + 7) % 7 + (word.startsWith('next') ? 7 : 0)));
    }
  }
  return found;
}

function resolvedDates(text, { source, post, now } = {}) {
  const kind = source?.parse;
  const postDate = post?.timestamp ? dayOf(post.timestamp) : null;
  const base = kind === 'ig-post' ? postDate : addDays(isoWeekStart(now), -7);
  const horizon = kind === 'ig-post' ? 60 : 35;
  const yearless = kind === 'ig-post' || (kind === 'html-listing' && source?.identityKind === 'venue');
  const dates = [...text.matchAll(datePattern)].map(([s]) => parseCalendar(s, { base, allowYearless: yearless, horizon })).filter(Boolean);
  if (kind === 'ig-post') dates.push(...relativeDates(text, postDate));
  return [...new Set(dates)];
}

function timeOf(raw) {
  if (/^noon$/i.test(raw.trim())) return '12:00';
  const m = raw.match(/(\d{1,2})(?::(\d\d))?\s*([ap])/i);
  if (!m) return null;
  const hour = Number(m[1]) % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${m[2] || '00'}`;
}

function torontoInstant(day, time = '00:00') {
  if (!validDay(day) || !/^\d\d:\d\d$/.test(time)) return NaN;
  const wall = Date.parse(`${day}T${time}:00Z`);
  let instant = wall + 5 * 3600000;
  for (let n = 0; n < 3; n++) {
    const p = local(instant);
    instant += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  const p = local(instant);
  return dayOf(instant) === day && `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` === time ? instant : NaN;
}
const typedTimeMatches = (record, field, day, time) => {
  const value = record.typed?.[field];
  const instant = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(instant) && dayOf(instant) === day &&
    `${String(local(instant).hour).padStart(2, '0')}:${String(local(instant).minute).padStart(2, '0')}` === time;
};

export function recordProvesTime(record, resolvedDate, instant) {
  if (!validDay(resolvedDate) || !Number.isFinite(instant) || dayOf(instant) !== resolvedDate) return false;
  const text = norm(typeof record === 'string' ? record : record?.text);
  if (sourceSpanProvesTime(text, instant)) return true;
  const target = `${String(local(instant).hour).padStart(2, '0')}:${String(local(instant).minute).padStart(2, '0')}`;
  if ([...text.matchAll(timePattern)].some(([raw]) => timeOf(raw) === target)) return true;
  return [...text.matchAll(/\b(\d{1,2})(?::(\d\d))?\s*-\s*(\d{1,2})(?::(\d\d))?\s*([ap])\.?m\.?\b/gi)]
    .some(([, startHour, startMinute, endHour, endMinute, period]) =>
      [timeOf(`${startHour}:${startMinute || '00'}${period}m`), timeOf(`${endHour}:${endMinute || '00'}${period}m`)].includes(target));
}

export function roundupTemporalReason(when, now, { editionNow = now, posts = [] } = {}) {
  const at = Date.parse(now);
  if (!Number.isFinite(at)) return 'undated';
  return temporalReason(when, at, isoWeekStart(editionNow), posts);
}

function temporalReason(when, at, weekStart, posts) {
  const date = when?.date;
  if (!validDay(date)) return 'undated';
  const weekEnd = addDays(weekStart, 7);
  if (when.kind === 'news-update') {
    if (date > dayOf(at)) return 'stale';
    if (date >= weekStart && date < weekEnd) return null;
    const previousStart = addDays(weekStart, -7);
    const previousWeek = isoWeekOf(previousStart).isoWeek;
    const previousSlug = `liberty-village-news-week-${previousWeek.slice(0, 4)}-w${previousWeek.slice(6)}`;
    const previous = (posts || []).find((p) => p.roundupCoverage?.isoWeek === previousWeek || p.slug === previousSlug);
    const cutoff = previous?.roundupCoverage?.planningCutoff || previous?.publishedAt;
    const cutoffDay = cutoff ? /^\d{4}-\d\d-\d\d$/.test(cutoff) ? cutoff : dayOf(cutoff) : previousStart;
    return date >= previousStart && date < weekStart && date >= cutoffDay ? null : 'stale';
  }
  if (when.kind === 'alert') return null;
  const start = torontoInstant(date, when.startTime || '00:00');
  const end = when.endDate && when.endTime ? torontoInstant(when.endDate, when.endTime)
    : when.endDate ? torontoInstant(addDays(when.endDate, 1)) : when.endTime ? torontoInstant(date, when.endTime)
    : when.startTime ? start : torontoInstant(addDays(date, 1));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'undated';
  if (when.kind === 'restriction') return end > at && start < at + 14 * DAY ? null : 'concluded';
  if (end <= at) return 'concluded';
  return date >= weekStart && date < weekEnd || start < at + 14 * DAY ? null : 'outside-window';
}

function dateFromRecord(record, source, when, post, now, claim) {
  const typed = record.typed || {};
  const text = norm(record.text);
  if (when.kind === 'alert' || when.kind === 'restriction') {
    const date = typed.startTime || typed.startDate || typed.activeStart || typed.activeFrom || typed.date;
    return date && dayOf(typeof date === 'number' ? date : Date.parse(date));
  }
  if (when.kind === 'news-update') {
    const quoted = norm(claim?.date_quote);
    const visible = resolvedDates(quoted, { source: { parse: 'html-page' }, now });
    return quoted && text.includes(quoted) && visible.includes(when.date) && text.indexOf(quoted) < 400 ? when.date : null;
  }
  if (source.identityKind === 'news-discovery' && source.parse !== 'jsonld-event' ||
    source.parse === 'html-page' && !['org', 'project'].includes(source.identityKind)) return null;
  if (source.parse === 'html-page' || source.parse === 'ig-post') {
    const quoted = norm(claim?.date_quote);
    if (!quoted || !text.includes(quoted) || /\blast updated\b/i.test(quoted)) return null;
    const dates = resolvedDates(quoted, { source, post, now });
    return dates.includes(when.date) && resolvedDates(text, { source, post, now }).includes(when.date) ? when.date : null;
  }
  const typedDate = typed.startDate || typed.date || typed.startTime;
  if (typedDate && /^\d{4}-\d\d-\d\d/.test(String(typedDate))) {
    const absolute = Date.parse(typedDate);
    const date = /T.*(?:Z|[+-]\d\d:?\d\d)$/.test(String(typedDate)) && Number.isFinite(absolute)
      ? dayOf(absolute) : String(typedDate).slice(0, 10);
    return validDay(date) ? date : null;
  }
  return resolvedDates(text, { source, post, now }).includes(when.date) ? when.date : null;
}

function trustedWhen(formWhen, record, source) {
  if (source.parse !== 'json-feed') return formWhen;
  const typed = record.typed || {};
  const startValue = typed.startTime || typed.activeStart || typed.activeFrom;
  const endValue = typed.endTime || typed.activeEnd || typed.activeUntil;
  const start = typeof startValue === 'number' ? startValue : Date.parse(startValue || '');
  const end = typeof endValue === 'number' ? endValue : Date.parse(endValue || '');
  if (!Number.isFinite(start)) return formWhen;
  const startLocal = local(start);
  const endLocal = Number.isFinite(end) ? local(end) : null;
  const clock = (parts) => `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  return { ...formWhen, date: dayOf(start), startTime: clock(startLocal),
    endDate: endLocal ? dayOf(end) : null, endTime: endLocal ? clock(endLocal) : null };
}

function identity(record, source, form, claim, geo) {
  const typed = record.typed || {};
  const text = norm(record.text);
  const invoke = (name, ...args) => {
    try { return typeof geo[name] === 'function' ? geo[name](...args) : null; } catch { return null; }
  };
  const context = { source, record, recordText: text, domain: new URL(claim.url).hostname,
    trustedToronto: ['venue', 'org', 'project'].includes(source.identityKind) || source.parse === 'ig-post',
    address: typed.location?.address || typed.address,
    addressLocality: typed.location?.address?.addressLocality || typed.addressLocality };
  let result;
  if (source.identityKind === 'road-feed') result = invoke('classifySegment', typed);
  else if (source.identityKind === 'transit-feed') result = invoke('classifyTransitAlert',
    { route: typed.route, stops: typed.stops, segmentText: typed.segment || typed.segmentText });
  else if (source.parse === 'html-listing') result = invoke('classifyVenueName',
    source.venueName || source.label || source.identityId || source.id, context);
  else if (source.parse === 'jsonld-event') {
    const named = invoke('classifyVenueName', typed.location?.name || typed.place || '', context);
    const addressed = invoke('classifyAddress', typed.location?.address || typed.address, context);
    if (named?.canonicalVenueId && addressed?.canonicalVenueId && named.canonicalVenueId !== addressed.canonicalVenueId)
      fail('unverifiable');
    result = named?.verdict === 'unverifiable' ? addressed : named || addressed;
  }
  else if (source.parse === 'ig-post') {
    const quote = claim?.place_quote;
    if (/\b(?:at|in|location\s*:|venue\s*:)\s*(?:High Park|Downsview Park|City Hall|Toronto Zoo|Parkdale)\b/i.test(text))
      return { locality: 'not-LV' };
    const statedAddress = invoke('classifyAddress', text, context);
    if (statedAddress?.verdict === 'not-LV') return { locality: 'not-LV' };
    if (statedAddress?.canonicalVenueId && source.canonicalVenueId &&
      statedAddress.canonicalVenueId !== source.canonicalVenueId && !quote) fail('unverifiable');
    if (quote) result = invoke('classifySectionPlace', { placeQuote: quote, sectionText: text,
      subject: form.subject, dateQuote: claim.date_quote, domain: new URL(claim.url).hostname, agentVerdict: form.verdict });
    if (!result && quote) result = invoke('classifyAddress', quote, context) || invoke('classifyVenueName', quote, context);
    if (!result && source.canonicalVenueId && !source.multiLocation && !source.requiresVenueInPost) {
      const other = invoke('statedOtherPlace', record.text, source.canonicalVenueId);
      if (other?.verdict === 'not-LV') return { locality: 'not-LV' };
      if (other) fail('unverifiable');
      result = { verdict: 'core', canonicalVenueId: source.canonicalVenueId };
    }
  } else result = invoke('classifySectionPlace', { placeQuote: claim?.place_quote,
    sectionText: text, subject: form.subject, dateQuote: claim?.date_quote,
    domain: new URL(claim.url).hostname, agentVerdict: form.verdict });
  const verdict = typeof result === 'string' ? result : result?.verdict || result?.locality || result?.classification;
  if (!['core', 'adjacent', 'not-LV'].includes(verdict)) fail('unverifiable');
  return { locality: verdict, canonicalVenueId: result?.canonicalVenueId || typed.canonicalVenueId || source.canonicalVenueId,
    venueId: result?.venueId || (source.identityKind === 'venue' ? source.identityId : undefined) };
}

function itemKey(form, source, record, place, originalUrl) {
  const typed = record.typed || {};
  if (form.when.kind === 'restriction') return 'road:' + (typed.id || record.recordId);
  if (form.when.kind === 'alert') return 'ttc:' + (typed.id || record.recordId);
  if (form.when.kind === 'news-update') return 'news:' + canonical(originalUrl || form.evidence[0].url);
  if (form.item_type === 'project' && form.when.kind !== 'event') return `project:${source.identityId}:${record.recordId}:${form.when.date}`;
  if (!place.canonicalVenueId) fail('unverifiable');
  return `occ:${place.canonicalVenueId}:${form.when.date}:${form.when.startTime || 'all-day'}`;
}

async function loadBody(url, fetcher, context) {
  const result = await fetcher(url, context);
  if (result && typeof result.text === 'function' && typeof result.status === 'number') {
    if (!result.ok) fail(result.status === 403 ? 'unverifiable' : 'record-missing');
    return result.text();
  }
  if (blocked(result)) fail(result?.errorCode === 'blocked' || responseStatus(result) === 403 ? 'unverifiable' : 'record-missing');
  return asText(result);
}

/** Re-fetch and re-extract every cited record. All model fields are untrusted. */
export async function verifyRoundupForms({ signals = [], forms = [], now, posts = [], fetcher, igRefetch,
  recordExtractor, recordTools, geography, sources, publisherTiers } = {}) {
  const at = Date.parse(now);
  if (!Number.isFinite(at)) throw new Error('roundup verifier requires now');
  const accessFetcher = fetcher || await createRoundupVerifierFetcher();
  const [recordModule, geo, sourceModule] = await Promise.all([
    recordExtractor ? { ...recordTools, extractRoundupRecords: recordExtractor } : import('./roundup-records.mjs'),
    geography || import('./roundup-geo.mjs'),
    sources && publisherTiers ? { ROUNDUP_SOURCES: sources, ROUNDUP_PUBLISHER_TIERS: publisherTiers } : import('./sources.mjs'),
  ]);
  const { extractRoundupRecords } = recordModule;
  const registry = sources || sourceModule.ROUNDUP_SOURCES || [];
  const tiers = publisherTiers || sourceModule.ROUNDUP_PUBLISHER_TIERS || {};
  const covered = roundupCoveredKeys(posts);
  const signalMap = new Map(signals.map((s) => [s.signalId, s]));
  const igRows = Array.isArray(igRefetch?.rows) ? igRefetch.rows : [];
  const expectedIg = [...new Set(signals.filter((signal) => signal.sourceId === 'rv2-instagram' ||
    signal.sourceId?.startsWith('ig:')).map((signal) => signal.post?.shortcode).filter(Boolean))].sort();
  const actualIg = [...new Set(igRows.map((row) => row.shortcode).filter(Boolean))].sort();
  const igSetValid = !igRefetch || JSON.stringify(expectedIg) === JSON.stringify(actualIg);
  const igFetchedAt = Date.parse(igRefetch?.fetchedAt || '');
  const items = [], excluded = [];
  for (const form of forms) {
    const signal = signalMap.get(form?.signalId);
    try {
      if (!signal || form?.recordId == null || !Array.isArray(form.evidence) || !form.evidence.length || form.evidence.length > 3) fail('form-invalid');
      if (form.exclude_reason) fail('not-news');
      if (Object.values(form.risk || {}).some(Boolean) || (form.people || []).some((p) => ['private-person', 'unclear'].includes(p.role))) fail('risky');
      const firstSource = sourceFor(registry, signal.sourceId);
      if (!firstSource) fail('unverifiable');
      const firstRecord = (signal.records || []).find((r) => r.recordId === form.recordId);
      if (!firstRecord || form.evidence[0].recordId !== form.recordId || form.evidence[0].url !== signal.url) fail('source-swapped');
      const evidence = [];
      let primary = null;
      for (const [index, claim] of form.evidence.entries()) {
        if (!/^https:\/\//.test(claim.url)) fail('source-swapped');
        const sourceSignal = signals.find((s) => s.url === claim.url && (s.signalId === signal.signalId || s.groupId && s.groupId === signal.groupId));
        if (!sourceSignal) { if (index === 0) fail('source-swapped'); else continue; }
        const source = sourceFor(registry, sourceSignal.sourceId);
        if (!source) { if (index === 0) fail('unverifiable'); else continue; }
        try {
          if (source.enabled === false || source.robotsAllowed === false) fail('unverifiable');
          const post = source.parse === 'ig-post' ? (igRefetch
            ? igRows.find((row) => row.shortcode === sourceSignal.post?.shortcode)
            : sourceSignal.post) : undefined;
          if (source.parse === 'ig-post' && (!post || post.status === 'missing' || post.status === 'private')) fail('record-missing');
          if (source.parse === 'ig-post' && (!Number.isFinite(Date.parse(post.timestamp)) || Date.parse(post.timestamp) > at)) fail('unverifiable');
          if (source.parse === 'ig-post' && igRefetch) {
            if (!igSetValid || !Number.isFinite(igFetchedAt) || igFetchedAt > at || at - igFetchedAt > 30 * 60000) fail('unverifiable');
            if (sourceSignal.post && (post.caption !== sourceSignal.post.caption || post.timestamp !== sourceSignal.post.timestamp ||
              post.ownerUsername !== sourceSignal.post.ownerUsername)) fail('unverifiable');
          }
          const body = source.parse === 'ig-post' ? post.caption : await loadBody(claim.url, accessFetcher, { source, signal: sourceSignal });
          const original = (source.parse === 'html-page' || source.identityKind === 'news-discovery') &&
            form.when?.kind === 'news-update' ? await originalFor(body, claim.url, accessFetcher, recordModule) : null;
          const fresh = extractRoundupRecords({ source, url: claim.url, body, post });
          const record = fresh.find((r) => r.recordId === claim.recordId);
          if (!record) fail('record-missing');
          const recordSource = record.kind === 'jsonld-event' ? { ...source, parse: 'jsonld-event' }
            : record.kind === 'listing-row' ? { ...source, parse: 'html-listing' }
              : record.kind === 'ig-event' ? { ...source, parse: 'ig-post' } : source;
          const normalized = norm(record.text);
          if (form.when?.kind === 'event' && /\b(?:cancelled|canceled|postponed)\b/i.test(normalized)) fail('concluded');
          for (const field of quoteFields) {
            const quote = claim[field];
            if (quote == null) continue;
            if (typeof quote !== 'string' || !quote.trim()) fail('unverifiable');
            if (!normalized.includes(norm(quote))) fail(fresh.some((r) => norm(r.text).includes(norm(quote))) ? 'cross-record' : 'source-swapped');
          }
          if (!claim.subject_quote || !norm(claim.subject_quote).includes(norm(form.subject))) fail('unverifiable');
          if (source.parse === 'json-feed') {
            const snapshot = (sourceSignal.records || []).find((r) => r.recordId === record.recordId)?.typed;
            const fields = feedFields[source.identityKind] || [];
            const projection = (typed) => Object.fromEntries(fields.map((field) => [field, typed?.[field] ?? null]));
            if (!snapshot || digest(projection(record.typed)) !== digest(projection(snapshot))) fail('record-missing');
          }
          if (source.parse === 'ig-post' && post.ownerUsername && post.ownerUsername.toLowerCase() !== String(source.handle || source.identityId?.replace(/^ig:/, '') || '').replace(/^@/, '').toLowerCase()) fail('unverifiable');
          if (original) {
            if (!resolvedDates(original.text.slice(0, 400), { source: { parse: 'html-page' }, now: at }).includes(form.when.date)) fail('stale');
          } else if (dateFromRecord(record, recordSource, form.when, post, at, claim) !== form.when?.date) fail('undated');
          if (source.parse !== 'json-feed' && form.when?.endDate && !(String(record.typed?.endDate || '').startsWith(form.when.endDate) ||
            resolvedDates(norm(record.text), { source: recordSource, post, now: at }).includes(form.when.endDate))) fail('undated');
          if (form.when?.startTime && !(source.parse === 'json-feed'
            ? typedTimeMatches(record, 'startTime', form.when.date, form.when.startTime)
            : recordProvesTime(record, form.when.date, torontoInstant(form.when.date, form.when.startTime)))) fail('undated');
          if (form.when?.endTime && !(source.parse === 'json-feed'
            ? typedTimeMatches(record, 'endTime', form.when.endDate || form.when.date, form.when.endTime)
            : recordProvesTime(record, form.when.endDate || form.when.date, torontoInstant(form.when.endDate || form.when.date, form.when.endTime)))) fail('undated');
          const place = identity(record, recordSource, form, claim, geo);
          if (place.locality === 'not-LV') fail('not-LV');
          const tier = source.identityKind === 'news-discovery'
            ? tiers[registrableDomain(claim.url)] || 'lead'
            : source.tier || 'lead';
          const entry = { url: claim.url, recordId: record.recordId, subject_quote: claim.subject_quote,
            place_quote: claim.place_quote, date_quote: claim.date_quote, tier, publisherDomain: registrableDomain(claim.url),
            publisher: source.label || source.identityId || registrableDomain(claim.url), sourceId: source.id,
            feed: source.parse === 'json-feed', listing: source.parse === 'html-listing',
            extractionSubstantive: record.extractionSubstantive ?? sourceSignal.extractionSubstantive ??
              (source.parse === 'html-page' ? normalized.length >= 40 : normalized.length >= 10),
            fetchOk: true, itemBound: true, locality: place.locality };
          evidence.push(entry);
          if (index === 0) primary = { source: recordSource, record, place, post, originalUrl: original?.url,
            when: trustedWhen(form.when, record, source) };
        } catch (error) { if (index === 0) throw error; }
      }
      if (!primary) fail('unverifiable');
      const riskText = [form.subject, form.what, primary.record.text].join(' ');
      if (detectRiskFlags({ title: form.subject, snippet: riskText }).length || isDevelopmentApplication({ title: form.subject, sourceId: signal.sourceId })) fail('risky');
      if (detectNonEventLabels({ title: form.subject, snippet: form.what }).length) fail('not-news');
      const level = { 'not-LV': 0, adjacent: 1, core: 2 };
      const locality = Object.keys(level).find((key) => level[key] === Math.min(level[form.verdict] ?? 0, level[primary.place.locality]));
      if (locality === 'not-LV') fail('not-LV');
      if (primary.source.parse === 'ig-post' && primary.post?.timestamp && form.when.kind === 'event') {
        const timestamp = Date.parse(primary.post.timestamp);
        if (form.when.startTime && timestamp >= torontoInstant(form.when.date, form.when.startTime) ||
          !form.when.startTime && dayOf(timestamp) >= form.when.date ||
          /\b(?:look back|recap|last (?:night|week|saturday|sunday)|yesterday|what a night)\b/i.test(primary.record.text)) fail('retrospective');
      }
      const reason = temporalReason(primary.when, at, isoWeekStart(at), posts);
      if (reason) fail(reason);
      if (!roundupSourceQuality(evidence)) fail('weak-source');
      const identityKey = itemKey(form, primary.source, primary.record, primary.place, primary.originalUrl);
      if (covered.has(identityKey)) fail('previously-covered');
      items.push({ ...form, when: primary.when, locality, verdict: locality, identityKey, keys: [identityKey],
        itemType: form.item_type, date: primary.when.date, citations: evidence.map((entry) => ({
          url: entry.url, publisher: entry.publisher, sourceId: entry.sourceId, recordId: entry.recordId,
          feed: entry.feed, listing: entry.listing })),
        canonicalVenueId: primary.place.canonicalVenueId, venueId: primary.place.venueId,
        tier: evidence[0].tier, evidence, active: true });
    } catch (error) { excluded.push({ signalId: form?.signalId, recordId: form?.recordId, reason: error.reason || 'unverifiable' }); }
  }
  return { items, excluded, verifyDigest: digest({ items, excluded, now: new Date(at).toISOString() }) };
}

export async function revalidateRoundupForms(pack, options = {}) {
  if ((pack.signals || []).some((signal) => signal.sourceId?.startsWith('ig:') || signal.sourceId === 'rv2-instagram') && !options.igRefetch)
    throw new Error('roundup source evidence changed or unreachable; rebuild before submit');
  const result = await verifyRoundupForms({ ...options, signals: pack.signals, forms: pack.forms });
  const plan = planRoundupV2(result.items, { now: options.now, posts: options.posts || [] });
  const oldKeys = (pack.units || pack.items || []).flatMap((item) => item.keys || [item.identityKey]).sort();
  const newKeys = plan.countedItems.flatMap((item) => item.keys).sort();
  if (plan.decision !== 'publish' || JSON.stringify(oldKeys) !== JSON.stringify(newKeys))
    throw new Error('roundup source evidence changed or unreachable; rebuild before submit');
  const projection = (item) => ({ identityKey: item.identityKey, keys: item.keys, members: item.members,
    subject: item.subject, what: item.what, verdict: item.verdict, itemType: item.itemType,
    date: item.date, citations: item.citations, evidence: item.evidence });
  if (digest((pack.units || pack.items || []).map(projection)) !== digest(plan.countedItems.map(projection)))
    throw new Error('roundup source evidence changed or unreachable; rebuild before submit');
  return { ...result, plan };
}
