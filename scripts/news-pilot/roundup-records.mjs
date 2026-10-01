/**
 * Deterministic record extraction for the weekly roundup v2 (spec §6.1).
 *
 * Shared by the collector and the verifier: the verifier re-extracts records from
 * a fresh fetch with this same code and locates the cited one by `recordId`.
 * `recordId` is always a stable hash of trusted fields, never a model value.
 *
 * extractRoundupRecords({ source, url, body, post }) =>
 *   [{ recordId, kind, text, typed, sourceId, url }]
 *
 * kinds: 'listing-row' | 'jsonld-event' | 'feed' | 'section' | 'ig-event'
 */

import { createHash } from 'node:crypto';

const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const rid = (kind, ...parts) => `${kind}:${sha(parts.map((p) => String(p ?? '')).join('␟')).slice(0, 32)}`;

// ---------------------------------------------------------------------------
// Text normalization (§6.1 step 2)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', middot: '·', bull: '•',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û',
  icirc: 'î', iuml: 'ï', euml: 'ë', uuml: 'ü', ouml: 'ö', auml: 'ä', Eacute: 'É', copy: '©', reg: '®',
  trade: '™', deg: '°', frac12: '½', times: '×', shy: '', zwj: '', zwnj: '', thinsp: ' ', ensp: ' ', emsp: ' ',
});

/** Decode HTML character references (named subset + numeric). */
export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      try {
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
      } catch {
        return '';
      }
    }
    return Object.hasOwn(NAMED_ENTITIES, ref) ? NAMED_ENTITIES[ref] : whole;
  });
}

/**
 * Matching normalization: entities decoded, whitespace collapsed, curly quotes
 * straightened, en/em dashes to '-', NFC. Case is preserved (matching is case-sensitive).
 */
export function normalizeRecordText(text) {
  return decodeEntities(text)
    .normalize('NFC')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Minimal HTML element scanner (no DOM dependency)
// ---------------------------------------------------------------------------

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param', 'keygen']);
// svg is not raw text: sites leave <svg> unclosed, and a lazy match would eat content.
const RAW_TEXT = /<(script|style|noscript|template|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function attrOf(attrs, name) {
  const m = String(attrs || '').match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** Remove comments and raw-text elements, keeping JSON-LD out of the text flow. */
function stripRaw(html) {
  return String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(RAW_TEXT, ' ');
}

/**
 * Scan elements. Returns [{tag, attrs, start, openEnd, closeStart, end}] for every
 * element whose close tag is found by same-name depth counting. Unclosed elements
 * end at the parent end (approximated as end of input).
 */
function scanElements(html) {
  const out = [];
  const stack = [];
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(html))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!closing) {
      const selfClosing = /\/\s*$/.test(m[3]) || VOID.has(tag);
      const el = { tag, attrs: m[3], start: m.index, openEnd: m.index + m[0].length, closeStart: null, end: null };
      out.push(el);
      if (!selfClosing) stack.push(el);
      else {
        el.closeStart = el.openEnd;
        el.end = el.openEnd;
      }
      continue;
    }
    // Close the nearest open element with this tag; implicitly close anything above it.
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].tag !== tag) continue;
      for (let j = stack.length - 1; j >= i; j--) {
        const open = stack[j];
        open.closeStart = j === i ? m.index : m.index;
        open.end = j === i ? m.index + m[0].length : m.index;
      }
      stack.length = i;
      break;
    }
  }
  for (const open of stack) {
    open.closeStart = html.length;
    open.end = html.length;
  }
  return out;
}

function parseSimpleSelector(part) {
  const nth = part.match(/:nth\((\d+)\)$/);
  const base = nth ? part.slice(0, nth.index) : part;
  const [tag, ...classes] = base.split('.');
  return { tag: tag ? tag.toLowerCase() : null, classes, nth: nth ? Number(nth[1]) : null };
}

function matches(el, sel) {
  if (sel.tag && el.tag !== sel.tag) return false;
  if (!sel.classes.length) return true;
  const cls = ` ${String(attrOf(el.attrs, 'class') || '').trim().split(/\s+/).join(' ')} `;
  return sel.classes.every((c) => cls.includes(` ${c} `));
}

/**
 * Select elements with a descendant selector of simple parts: `tag`, `.class`,
 * `tag.class.other`, with an optional trailing `:nth(i)` (0-based) per part.
 * Returns outer/inner HTML strings in document order; each match is cut at the
 * start of the next match, so rows never contain their following rows.
 */
export function selectElements(html, selector) {
  const parts = String(selector || '').trim().split(/\s+/).filter(Boolean).map(parseSimpleSelector);
  let scopes = [String(html || '')];
  for (const sel of parts) {
    const next = [];
    for (const scope of scopes) {
      const els = scanElements(scope).filter((el) => matches(el, sel));
      const outer = els.map((el) => ({ ...el }));
      // Unbalanced markup can make an element swallow its following siblings; a
      // match never extends past the start of the next match.
      outer.forEach((el, i) => {
        if (outer[i + 1] && el.end > outer[i + 1].start) el.end = outer[i + 1].start;
      });
      const picked = sel.nth == null ? outer : outer.slice(sel.nth, sel.nth + 1);
      for (const el of picked) next.push({ el, scope });
    }
    scopes = next.map(({ el, scope }) => scope.slice(el.start, el.end));
    if (!scopes.length) return [];
  }
  return scopes.map((outerHtml) => {
    const open = outerHtml.match(/^<[^>]*>/)?.[0] || '';
    const inner = outerHtml.slice(open.length).replace(/<\/[a-zA-Z][\w:-]*\s*>$/, '');
    return { outerHtml, innerHtml: inner, attrs: open };
  });
}

const BLOCK_TAGS = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|main|aside|blockquote|dd|dt|dl|figure|figcaption|time|address|pre)\b[^>]*>/gi;

/** Visible text of an HTML fragment, one line per block element. */
export function htmlToText(html) {
  // Inline tags add no whitespace (textContent semantics): "o<b>pen</b>" is "open".
  const text = stripRaw(html).replace(BLOCK_TAGS, '\n').replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Main region (§6.1 step 2)
// ---------------------------------------------------------------------------

const NAV_TAGS = new Set(['nav', 'header', 'footer', 'aside', 'menu']);
const NAV_ROLES = /^(?:navigation|banner|contentinfo|menu|menubar|search|complementary)$/i;
const NAV_CLASS = /(?:^|[\s_-])(?:nav|navbar|navigation|menu|mega-menu|breadcrumbs?|skip-link|site-header|site-footer|cookie|share|social)(?:$|[\s_-])/i;

function removeRanges(html, ranges) {
  if (!ranges.length) return html;
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  for (const [s, e] of ranges) {
    if (e <= pos) continue;
    out += html.slice(pos, Math.max(pos, s)) + '\n';
    pos = Math.max(pos, e);
  }
  return out + html.slice(pos);
}

/** Strip navigation, headers, footers, asides, menus and breadcrumb-like elements. */
export function stripNavigation(html) {
  const src = stripRaw(html);
  const ranges = [];
  for (const el of scanElements(src)) {
    const role = attrOf(el.attrs, 'role') || '';
    const cls = `${attrOf(el.attrs, 'class') || ''} ${attrOf(el.attrs, 'id') || ''}`;
    if (NAV_TAGS.has(el.tag) || NAV_ROLES.test(role.trim()) || NAV_CLASS.test(cls)) ranges.push([el.start, el.end]);
  }
  return removeRanges(src, ranges);
}

/**
 * The page's main region HTML, before navigation stripping: `<main>` when present;
 * otherwise a single `<article>` (a listing page with several articles uses the
 * body); otherwise `<body>`; otherwise the whole document. This extends
 * draft-evidence `extractMainHtml` so nested/multiple articles never truncate it.
 */
export function mainRegionHtml(html) {
  const raw = String(html || '');
  const main = selectElements(raw, 'main')[0];
  if (main) return main.innerHtml;
  const articles = selectElements(raw, 'article');
  if (articles.length === 1) return articles[0].innerHtml;
  const body = selectElements(raw, 'body')[0];
  return body ? body.innerHtml : raw;
}

/** Main region with navigation removed. */
export function cleanMainHtml(html) {
  return stripNavigation(mainRegionHtml(html));
}

// ---------------------------------------------------------------------------
// JSON-LD Event records
// ---------------------------------------------------------------------------

const EVENT_TYPES = new Set([
  'Event', 'BusinessEvent', 'ChildrensEvent', 'ComedyEvent', 'CourseInstance', 'DanceEvent', 'DeliveryEvent',
  'EducationEvent', 'EventSeries', 'ExhibitionEvent', 'Festival', 'FoodEvent', 'Hackathon', 'LiteraryEvent',
  'MusicEvent', 'PublicationEvent', 'BroadcastEvent', 'OnDemandEvent', 'SaleEvent', 'ScreeningEvent',
  'SocialEvent', 'SportsEvent', 'TheaterEvent', 'VisualArtsEvent',
]);

function typesOf(obj) {
  const t = obj?.['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x) => typeof x === 'string').map((x) => x.replace(/^https?:\/\/schema\.org\//, ''));
}

function flattenLd(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) flattenLd(v, out);
  } else if (value && typeof value === 'object') {
    out.push(value);
    if (Array.isArray(value['@graph'])) flattenLd(value['@graph'], out);
  }
  return out;
}

/** Every parseable JSON-LD object (each block parsed separately; malformed blocks skipped). */
export function jsonLdObjects(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try {
      flattenLd(JSON.parse(m[1].trim()), out);
    } catch {
      // Malformed blocks (e.g. the Star's `'+ com['` pattern) are ignored.
    }
  }
  return out;
}

const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function placeOf(location) {
  const loc = Array.isArray(location) ? location[0] : location;
  if (typeof loc === 'string') return { name: loc, address: null };
  if (!loc || typeof loc !== 'object') return { name: '', address: null };
  const a = loc.address;
  const address = typeof a === 'string'
    ? { streetAddress: a }
    : a && typeof a === 'object'
      ? {
        streetAddress: str(a.streetAddress), addressLocality: str(a.addressLocality), addressRegion: str(a.addressRegion),
        postalCode: str(a.postalCode),
      }
      : null;
  return { name: str(loc.name), address };
}

function jsonLdEventRecords({ source, url, body }) {
  const records = [];
  for (const obj of jsonLdObjects(body)) {
    if (!typesOf(obj).some((t) => EVENT_TYPES.has(t))) continue;
    const name = str(obj.name).trim();
    if (!name) continue;
    const location = placeOf(obj.location);
    const typed = { name, startDate: str(obj.startDate) || null, endDate: str(obj.endDate) || null, location,
      eventStatus: str(obj.eventStatus) || null, types: typesOf(obj) };
    const address = location.address || {};
    const text = [
      name, str(obj.description).slice(0, 1500), typed.startDate, typed.endDate, location.name,
      address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode,
    ].filter(Boolean).map((v) => decodeEntities(v)).join('\n');
    records.push({ recordId: rid('ld', url, name, typed.startDate, location.name), kind: 'jsonld-event', text, typed, sourceId: source.id, url });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Listing rows
// ---------------------------------------------------------------------------

function firstText(html, selector) {
  if (!selector) return '';
  const el = selectElements(html, selector)[0];
  return el ? normalizeRecordText(htmlToText(el.innerHtml)) : '';
}

function listingRecords({ source, url, body }) {
  const sel = source.recordSelector;
  if (!sel?.row) return [];
  const region = cleanMainHtml(body);
  const excluded = (source.excludedBuildings || []).map((b) => b.toLowerCase());
  const seen = new Set();
  const records = [];
  for (const row of selectElements(region, sel.row)) {
    const subject = firstText(row.innerHtml, sel.title);
    const dateText = firstText(row.innerHtml, sel.date);
    if (!subject || !dateText) continue;
    const building = firstText(row.innerHtml, sel.building);
    if (building && excluded.some((b) => building.toLowerCase().includes(b))) continue;
    const recordId = rid('row', source.id, normalizeRecordText(subject).toLowerCase(), dateText);
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    const typed = { subject, dateText, timeText: firstText(row.innerHtml, sel.time) || null, building: building || null };
    records.push({ recordId, kind: 'listing-row', text: htmlToText(row.innerHtml), typed, sourceId: source.id, url });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Page sections (html-page, news pages)
// ---------------------------------------------------------------------------

function sectionRecords({ source, url, body }) {
  const region = cleanMainHtml(body);
  const headings = scanElements(region)
    .filter((el) => /^h[1-6]$/.test(el.tag))
    .map((el) => ({ ...el, level: Number(el.tag[1]), heading: normalizeRecordText(htmlToText(region.slice(el.openEnd, el.closeStart))) }))
    .filter((h) => h.heading);
  const records = [];
  const push = (heading, ordinal, html) => {
    const text = htmlToText(html);
    if (!text.trim()) return;
    records.push({ recordId: rid('sec', url, heading, ordinal), kind: 'section', text,
      typed: { heading, ordinal }, sourceId: source.id, url });
  };
  if (!headings.length) {
    push('', 0, region);
    return records;
  }
  const preamble = region.slice(0, headings[0].start);
  if (htmlToText(preamble).length >= 40) push('', 0, preamble);
  headings.forEach((h, i) => {
    const next = headings.slice(i + 1).find((n) => n.level <= h.level);
    push(h.heading, i + 1, region.slice(h.start, next ? next.start : region.length));
  });
  return records;
}

// ---------------------------------------------------------------------------
// JSON feeds (road restrictions, TTC alerts)
// ---------------------------------------------------------------------------

/** Canonical JSON (sorted keys) — the raw serialization quotes must be found in. */
export function canonicalJson(value) {
  return JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v));
}

const epoch = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : /^\d{10,}$/.test(String(v)) ? Number(v) : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
};

function parseJson(body) {
  if (body && typeof body === 'object') return body;
  try {
    return JSON.parse(String(body || ''));
  } catch {
    return null;
  }
}

function roadRecords({ source, url, body }) {
  const data = parseJson(body);
  const rows = Array.isArray(data?.Closure) ? data.Closure : Array.isArray(data) ? data : [];
  const records = [];
  const seen = new Set();
  for (const raw of rows) {
    if (!raw || raw.id == null) continue;
    const id = String(raw.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const lat = Number(raw.latitude);
    const lon = Number(raw.longitude);
    const typed = {
      id, road: raw.road ?? null, fromRoad: raw.fromRoad ?? null, toRoad: raw.toRoad ?? null, atRoad: raw.atRoad ?? null,
      name: raw.name ?? null, startTime: epoch(raw.startTime), endTime: epoch(raw.endTime), description: raw.description ?? null,
      workPeriod: raw.workPeriod ?? null, type: raw.type ?? null,
      coordinates: Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null,
    };
    records.push({ recordId: id, kind: 'feed', text: canonicalJson(raw), typed, sourceId: source.id, url });
  }
  return records;
}

function ttcRecords({ source, url, body }) {
  const data = parseJson(body);
  const rows = Array.isArray(data?.routes) ? data.routes : [];
  const records = [];
  const seen = new Set();
  for (const raw of rows) {
    if (!raw || raw.id == null) continue;
    const id = String(raw.id);
    const route = raw.route == null ? '' : String(raw.route);
    const recordId = `${id}:${route}`;
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    const segment = [raw.stopStart, raw.stopEnd].filter(Boolean).join(' to ') || null;
    const typed = {
      id, route, stops: Array.isArray(raw.stops) ? raw.stops.map(String) : [], stopStart: raw.stopStart ?? null,
      stopEnd: raw.stopEnd ?? null, segment,
      segmentText: [raw.headerText || raw.title, raw.description, segment].filter(Boolean).join(' | '),
      effect: raw.effect ?? null, effectDesc: raw.effectDesc ?? null,
      activeStart: epoch(raw.activePeriod?.start), activeEnd: epoch(raw.activePeriod?.end), title: raw.title ?? null,
    };
    records.push({ recordId, kind: 'feed', text: canonicalJson(raw), typed, sourceId: source.id, url });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Instagram caption event records (§4.4, §6.1, §6.4)
// ---------------------------------------------------------------------------

const MONTH_RE = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE = '(Sun(?:day)?|Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?)';
const CALENDAR = new RegExp(`(?<![A-Za-z])(?:${WEEKDAY_RE}\\.?,?\\s+)?${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(20\\d\\d)(?!\\d))?`, 'gi');
// Day-first form ("Saturday 3 October", "12th of Sept").
const CALENDAR_DAY_FIRST = new RegExp(`(?<![\\d:.])(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?![A-Za-z])\\.?(?:,?\\s+(20\\d\\d)(?!\\d))?`, 'gi');
const RELATIVE = new RegExp(`(?<![A-Za-z])(?:(today|tonight|tomorrow)|(this|next)\\s+${WEEKDAY_RE})(?![A-Za-z])`, 'gi');
const MONTH_INDEX = new Map(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m, i) => [m, i + 1]));
const DAY_MS = 86_400_000;

const torontoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Toronto calendar date (YYYY-MM-DD) of an instant. */
export function torontoDay(instant) {
  return torontoDate.format(new Date(instant));
}
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (day) => new Date(day + 'T00:00:00Z').getUTCDay();
const validDay = (y, m, d) => {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) === iso ? iso : null;
};
const weekdayIndex = (token) => WEEKDAYS.findIndex((w) => w.startsWith(token.toLowerCase().slice(0, 3)));

/**
 * Distinct dates stated in caption text, resolved against the post's provider
 * timestamp in America/Toronto (§6.4): explicit month-day (year optional; a
 * yearless date resolves to its unique occurrence in [P, P + 60 d]) and the
 * unambiguous relative words today/tonight/tomorrow/this <weekday>/next <weekday>.
 * Ambiguous phrases ("this weekend", "next week", "soon") resolve to nothing.
 * @param {string} text
 * @param {string|number} timestamp provider post timestamp
 * @returns {string[]} sorted distinct YYYY-MM-DD
 */
export function resolveCaptionDates(text, timestamp) {
  const at = typeof timestamp === 'number' ? timestamp : Date.parse(String(timestamp || ''));
  if (!Number.isFinite(at)) return [];
  const P = torontoDay(at);
  const [py] = P.split('-').map(Number);
  const dates = new Set();
  const src = String(text || '');
  const addCalendar = (month, day, year) => {
    const m = MONTH_INDEX.get(month.slice(0, 3).toLowerCase());
    const d = Number(day);
    if (year) {
      const iso = validDay(Number(year), m, d);
      if (iso) dates.add(iso);
    } else {
      const hits = [py, py + 1].map((y) => validDay(y, m, d)).filter((iso) => iso && iso >= P && iso <= addDays(P, 60));
      if (hits.length === 1) dates.add(hits[0]);
    }
  };
  const masked = src
    .replace(CALENDAR, (whole, _wd, month, day, year) => {
      addCalendar(month, day, year);
      return ' '.repeat(whole.length);
    })
    .replace(CALENDAR_DAY_FIRST, (whole, day, month, year) => {
      addCalendar(month, day, year);
      return ' '.repeat(whole.length);
    });
  let r;
  RELATIVE.lastIndex = 0;
  while ((r = RELATIVE.exec(masked))) {
    const word = (r[1] || '').toLowerCase();
    if (word === 'today' || word === 'tonight') dates.add(P);
    else if (word === 'tomorrow') dates.add(addDays(P, 1));
    else {
      const target = weekdayIndex(r[3]);
      if (target < 0) continue;
      const thisDay = addDays(P, (target - weekdayOf(P) + 7) % 7);
      dates.add(r[2].toLowerCase() === 'next' ? addDays(thisDay, 7) : thisDay);
    }
  }
  return [...dates].sort();
}

/**
 * Event records of one caption: one distinct date → the whole raw caption;
 * several → blank-line blocks, each kept only when it states exactly one
 * distinct date itself (a block with two dates, or none, is never a record).
 */
export function igEventRecords({ source, url, body, post }) {
  const caption = String(body ?? post?.caption ?? '');
  const shortcode = post?.shortcode || post?.shortCode || String(url || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1] || '';
  const timestamp = post?.timestamp ?? null;
  const owner = post?.ownerUsername ?? null;
  if (!caption.trim() || !shortcode || !timestamp) return [];
  const make = (text, ordinal, date) => ({
    recordId: rid('ig', shortcode, ordinal), kind: 'ig-event', text,
    typed: { owner, timestamp, shortcode, ordinal, date }, sourceId: source.id, url,
  });
  const all = resolveCaptionDates(caption, timestamp);
  if (all.length === 0) return [];
  if (all.length === 1) return [make(caption, 0, all[0])];
  const records = [];
  caption.split(/\r?\n[ \t ]*(?:\r?\n[ \t ]*)+/).forEach((block, i) => {
    const text = block.replace(/^\s+|\s+$/g, '');
    const dates = resolveCaptionDates(text, timestamp);
    if (text && dates.length === 1) records.push(make(text, i + 1, dates[0]));
  });
  return records;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {{source: {id: string, parse: string, identityKind?: string, recordSelector?: object}, url: string, body: unknown, post?: object|null}} input
 * @returns {{recordId: string, kind: string, text: string, typed: object, sourceId: string, url: string}[]}
 */
export function extractRoundupRecords({ source, url, body, post = null } = {}) {
  if (!source?.id || !source.parse) return [];
  switch (source.parse) {
    case 'html-listing':
      return [...listingRecords({ source, url, body: String(body ?? '') }), ...jsonLdEventRecords({ source, url, body: String(body ?? '') })];
    case 'jsonld-event':
      return jsonLdEventRecords({ source, url, body: String(body ?? '') });
    case 'html-page':
    case 'serper-news':
      return [...sectionRecords({ source, url, body: String(body ?? '') }), ...jsonLdEventRecords({ source, url, body: String(body ?? '') })];
    case 'json-feed':
      return source.identityKind === 'transit-feed' ? ttcRecords({ source, url, body }) : roadRecords({ source, url, body });
    case 'ig-post':
      return igEventRecords({ source, url, body, post });
    default:
      return [];
  }
}
