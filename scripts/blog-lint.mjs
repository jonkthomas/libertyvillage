#!/usr/bin/env node
// Fail-closed claim linter for generated blog posts (PRD ticket 1c).
//
// It runs BEFORE the draft is ever committed, so a fabricating draft is discarded
// without spending a PR, a CI run, a gate round or a repair budget on it. Every
// rule answers one question: is this specific claim copied from a record this
// repository already owns? Anything a `data/businesses.json` record cannot
// support is a finding — the linter never "corrects" a claim, it only refuses it.
//
// Pure and deterministic: no network, no model, no clock unless one is injected.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unsupportedOperationalPremises } from './lib/referenced-businesses.mjs';

export { extractReferencedBusinesses } from './lib/referenced-businesses.mjs';

export const LINT_MODES = Object.freeze(['fail', 'warn']);

// Unset and invalid both mean `fail`: a linter that silently degrades to warn is
// the same hole as no linter at all. `warn` is the documented L1 rollback lever.
export function resolveLintMode(env = {}) {
  const raw = typeof env?.LINT_MODE === 'string' ? env.LINT_MODE.trim().toLowerCase() : '';
  return LINT_MODES.includes(raw) ? raw : 'fail';
}

const TEXT_FIELDS = Object.freeze(['title', 'description', 'answerBlock', 'content']);

const MONTHS = Object.freeze([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]);

// Ontario statutory holidays as computable rules. `weekday` is 0=Sunday.
const HOLIDAYS = Object.freeze([
  { name: "New Year's Day", match: /\bnew year'?s day\b/i, fixed: [0, 1] },
  { name: 'Family Day', match: /\bfamily day\b/i, nth: [1, 1, 3] },
  { name: 'Victoria Day', match: /\bvictoria day\b/i, mondayBefore: [4, 25] },
  { name: 'Canada Day', match: /\bcanada day\b/i, fixed: [6, 1] },
  { name: 'Civic Holiday', match: /\b(civic holiday|simcoe day)\b/i, nth: [7, 1, 1] },
  { name: 'Labour Day', match: /\blabou?r day\b/i, nth: [8, 1, 1] },
  { name: 'Thanksgiving', match: /\bthanksgiving\b/i, nth: [9, 1, 2] },
  { name: 'Remembrance Day', match: /\bremembrance day\b/i, fixed: [10, 11] },
  { name: 'Christmas Day', match: /\bchristmas day\b/i, fixed: [11, 25] },
  { name: 'Boxing Day', match: /\bboxing day\b/i, fixed: [11, 26] },
]);

const BOLD_PATTERN = /\*\*([^*\n]{2,80})\*\*/g;
// The site's business pages live at /directory/<slug>, so a markdown link into that
// route is a deterministic, repository-checkable attribution: the slug either names
// a record or it does not. This is the format the generator must emit for any
// business it makes a specific claim about — no capitalized-prose guessing.
export const DIRECTORY_LINK_PREFIX = '/directory/';
const DIRECTORY_LINK_PATTERN = /\[([^\]\n]{1,120})\]\((\/directory\/[A-Za-z0-9._-]+)\)/g;
const STREET_TYPES = 'St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Lane|Ln|Cres|Crescent|Pl|Place|Ct|Court|Terrace|Trail|Parkway|Pkwy';
const STREET_SUFFIX = String.raw`(?:\s+(?:West|East|North|South|W|E|N|S)\b)?`;
const ADDRESS_PATTERN = new RegExp(
  String.raw`\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][A-Za-z.'’-]*\s+){0,3}(?:${STREET_TYPES})\b\.?${STREET_SUFFIX}(?:\s+(?:Unit|Suite|Ste|#)\s*[\w-]+)?`,
  'g',
);
// #97 was never a street NUMBER: it was "sits where Hanna Ave meets Wellington St W".
// A business's location expressed as an intersection, a bare street, or a bearing
// off some landmark is exactly as specific — and exactly as unverifiable from the
// record — as a civic address, so it is the same rule.
const PROPER_PLACE = String.raw`(?:the\s+)?[A-Z][A-Za-z.'’-]*(?:\s+(?:of|and|the|de|la))?(?:\s+[A-Z][A-Za-z.'’-]*){0,3}`;
const RELATIVE_GEOGRAPHY_PATTERNS = Object.freeze([
  new RegExp(String.raw`\bwhere\s+${PROPER_PLACE}\s+(?:meets|crosses|intersects)\s+${PROPER_PLACE}`, 'g'),
  new RegExp(String.raw`\b(?:at|on|near)\s+the\s+(?:corner|intersection)\s+of\s+${PROPER_PLACE}\s+(?:and|&|at)\s+${PROPER_PLACE}`, 'g'),
  new RegExp(String.raw`\b(?:just\s+|immediately\s+|directly\s+|right\s+)?(?:north|south|east|west|north-?east|north-?west|south-?east|south-?west)\s+of\s+${PROPER_PLACE}`, 'gi'),
  new RegExp(String.raw`\b(?:steps|a\s+[\w-]+-minute\s+walk|a\s+short\s+walk|across(?:\s+the\s+street)?|opposite|next\s+door|around\s+the\s+corner)\s+(?:from|to)\s+${PROPER_PLACE}`, 'gi'),
  new RegExp(String.raw`\b(?:on|along)\s+the\s+(?:north|south|east|west)\s+side\s+of\s+${PROPER_PLACE}`, 'gi'),
]);
const BARE_STREET_PATTERN = new RegExp(
  String.raw`\b[A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,2}\s+(?:${STREET_TYPES})\b\.?${STREET_SUFFIX}`,
  'g',
);
const PRICE_PATTERN = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
const MERIDIEM = String.raw`(?:[ap]\.m\.|[ap]m)`;
const HOURS_PATTERN = new RegExp(
  String.raw`\b\d{1,2}(?::\d{2})?\s*${MERIDIEM}?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*${MERIDIEM}`,
  'gi',
);

function normalize(value) {
  return String(value ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// "Verbatim in the record" must mean the same FACT, not the same typography. The
// record says "165 East Liberty St", the post says "East Liberty Street"; the record
// says "7:00 AM - 7:00 PM", the post says "7 AM to 7 PM". Comparing those literally
// reported a fabrication every time a draft spelled a street out, which is noise, not
// grounding. Both sides go through the same fold, so nothing is loosened one-way.
const COMPARISON_FOLDS = Object.freeze([
  [/[.,]/g, ''],
  [/\bstreet\b/g, 'st'], [/\bavenue\b/g, 'ave'], [/\broad\b/g, 'rd'],
  [/\bboulevard\b/g, 'blvd'], [/\bdrive\b/g, 'dr'], [/\bcrescent\b/g, 'cres'],
  [/\bplace\b/g, 'pl'], [/\bcourt\b/g, 'ct'], [/\blane\b/g, 'ln'],
  [/\bparkway\b/g, 'pkwy'], [/\bterrace\b/g, 'terr'],
  [/\bwest\b/g, 'w'], [/\beast\b/g, 'e'], [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'],
  [/\bunit\b|\bsuite\b|\bste\b/g, '#'],
  [/(\d)\s*:\s*00\b/g, '$1'],
  // `to` is word-bounded on purpose: an unbounded alternative eats the "to" inside
  // "Toronto" and turns every address in the city into noise.
  [/\s*(?:–|—|-|\bto\b)\s*/g, '-'],
  [/\s+/g, ' '],
]);

export function comparable(value) {
  let text = normalize(value);
  for (const [pattern, replacement] of COMPARISON_FOLDS) text = text.replace(pattern, replacement);
  return text.trim();
}

// The comparison surface for "verbatim in the record": every string the record
// carries, so a claim grounded in the description counts as grounded.
function recordText(record) {
  const parts = [];
  const walk = (value) => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    else if (typeof value === 'number') parts.push(String(value));
  };
  walk(record);
  return normalize(parts.join(' | '));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function indexBusinesses(businesses) {
  const records = Array.isArray(businesses) ? businesses.filter((record) => record && typeof record === 'object') : [];
  const entries = records.map((record) => ({
    record,
    slug: normalize(record.slug),
    name: normalize(record.name),
    text: recordText(record),
    comparable: comparable(recordText(record)),
  }));
  // The repository owns the list of business names, so an unbolded, unlinked mention
  // of one is found by LOOKING IT UP, never by guessing which capitalised prose is a
  // company. Longest first so "Balzac's Coffee Roasters" wins over "Balzac's".
  const names = entries
    .map((entry) => String(entry.record?.name ?? '').trim())
    .filter((name) => name.length >= 4)
    .sort((left, right) => right.length - left.length);
  // Either apostrophe spelling resolves to the same record: "Mildred's" and
  // "Mildred’s" are the same business, and a curly quote is not a new company.
  const asPattern = (name) => escapeRegExp(name).replace(/['’]/g, "['’]");
  entries.namePattern = names.length
    ? new RegExp(`(?<![A-Za-z0-9])(?:${names.map(asPattern).join('|')})(?![A-Za-z0-9])`, 'g')
    : null;
  entries.bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  return entries;
}

// Bold is also used for streets, parks, trails and public venues, which are not
// businesses and have no `businesses.json` record by design. It is also the site's
// ordinary emphasis mark, a table header, and a section heading. None of those is a
// claim that a business exists, and treating them as one flagged ~70% of the
// historical corpus on strings like "Best For", "Pool", "Venue" and "Yes".
//
// So a bold span is a business mention only when it either resolves to a record, or
// it is a title-cased proper name that carries a business-type token ("... Cafe",
// "... Kitchen", "... Studio") or a possessive ("Balzac's ..."). Everything else is
// structure or emphasis, and the attributable formats — a bold recorded name, a
// /directory/<slug> link, a plain-text recorded name — are what carry the claims.
const PLACE_SUFFIX = new RegExp(String.raw`\b(?:park|parkette|trail|boulevard|blvd|street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|crescent|cres|court|square|stadium|arena|beach|bridge|station|line|garden|gardens|island|creek|river|lake|expressway|exhibition|grounds|run|loop|path|pier|quay|waterfront|neighbourhood|neighborhood|village|express|streetcar|subway|transit|route)\b\.?$`, 'i');

// Bold spans that are dates, seasons or a bare domain are never business names.
const NOT_A_NAME = [
  new RegExp(String.raw`^(?:${MONTHS.join('|')})\b`, 'i'),
  /^(?:spring|summer|fall|autumn|winter|q[1-4])\b/i,
  /^(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b/i,
  /^\d{4}(?:\s*[-–]\s*\d{2,4})?$/,
  /\.[a-z]{2,}(?:\/|$)/i,
  /^\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?:\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)?$/i,
];

// Lowercase words a real proper name may still contain.
const NAME_CONNECTORS = new Set(['of', 'and', 'the', 'a', 'an', 'at', 'on', 'in', 'for', 'by', 'de', 'la', 'le', 'du', 'des', 'von', '&', '+']);

// The vocabulary that makes a proper name read as a *business* rather than as a
// heading, a table label, or a piece of emphasis.
const BUSINESS_TYPE_TOKEN = new RegExp(String.raw`\b(?:cafe|café|caffe|coffee|roasters?|espresso|kitchen|restaurant|resto|bistro|brasserie|eatery|diner|grill|grille|bar|taproom|tavern|pub|brewery|brewhouse|brewing|distillery|winery|bakery|bakehouse|patisserie|creamery|gelato|pizzeria|pizza|taqueria|sushi|ramen|noodle|deli|delicatessen|butcher|grocer|grocery|market|marketplace|bodega|shop|store|boutique|outfitters?|studio|gym|fitness|crossfit|yoga|pilates|spa|salon|barbers?|barbershop|clinic|dental|dentistry|optical|optometry|pharmacy|apothecary|veterinary|academy|daycare|montessori|gallery|theatre|theater|cinema|hotel|inn|lounge|club|cleaners|laundry|realty|brokerage|company|co\.|inc\.?|ltd\.?|llc|corp\.?)\b`, 'i');
const POSSESSIVE_NAME = /^[A-Z][A-Za-z.'’-]*['’]s\b/;

// A heading, a table row, or a standalone bold line is document structure. The
// generator uses all three, and none of them asserts that a business exists.
function isStructuralBold(line, span) {
  const trimmed = String(line ?? '').trim();
  if (trimmed.startsWith('|')) return true;
  if (trimmed.startsWith('#')) return true;
  if (trimmed.startsWith('>')) return true;
  if (new RegExp(`^\\*\\*${escapeRegExp(span.trim())}\\*\\*[:.]?$`).test(trimmed)) return true;
  return false;
}

function isTitleCased(words) {
  return words.every((word, position) => {
    const bare = word.replace(/^[('"‘“]+|[)'"’”.,;!?]+$/g, '');
    if (!bare || /^[\d$#&+-]/.test(bare)) return true;
    if (/^[A-Z]/.test(bare)) return true;
    return position > 0 && NAME_CONNECTORS.has(bare.toLowerCase());
  });
}

export function isBusinessMention(text, { nextChar = '', line = '', resolved = false } = {}) {
  const trimmed = String(text ?? '').trim().replace(/[.,;!?]+$/, '');
  // `**Address**: 171 East Liberty St` — a bold field label, not a business name.
  if (nextChar === ':') return false;
  if (!trimmed || trimmed.endsWith(':') || !/^[A-Z0-9]/.test(trimmed)) return false;
  if (isStructuralBold(line, text)) return false;
  // A name the repository already records is a business by definition.
  if (resolved) return true;
  if (PLACE_SUFFIX.test(trimmed)) return false;
  if (NOT_A_NAME.some((pattern) => pattern.test(trimmed))) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 8) return false;
  if (!words.some((word) => /[A-Za-z]{2,}/.test(word))) return false;
  if (!isTitleCased(words)) return false;
  return BUSINESS_TYPE_TOKEN.test(trimmed) || POSSESSIVE_NAME.test(trimmed);
}

function resolveBusiness(mention, index) {
  const wanted = normalize(mention);
  if (!wanted) return null;
  const exact = index.find((entry) => entry.name === wanted || entry.slug === wanted);
  if (exact) return exact;
  if (wanted.length < 4) return null;
  return index.find((entry) => entry.name && (entry.name.includes(wanted) || wanted.includes(entry.name))) || null;
}

// Splits a field into [{ business, text }] so a specific is checked against the
// business it is attributed to, not against the union of every record mentioned.
//
// Attribution is SENTENCE-scoped. A specific belongs to a business only when that
// business is named in the same sentence; a business named in the intro does not
// silently own every dollar amount in the paragraph. Paragraph-scoped attribution
// was measurably worse in both directions — it adopted unrelated transit fares and
// civic addresses as if a nearby cafe had asserted them.
//
// Three attribution formats, all deterministic and all checkable against the
// repository — no guessing which capitalised prose is a company:
//   1. `[Name](/directory/<slug>)`  — the slug names a record, or it is a finding.
//   2. `**Name**`                   — a business-shaped bold span (isBusinessMention).
//   3. a plain-text occurrence of a name `businesses.json` already records, which is
//      what gives unbolded, unlinked mentions their coverage.
function attributionScanner(index) {
  const parts = [
    DIRECTORY_LINK_PATTERN.source,
    BOLD_PATTERN.source,
    ...(index.namePattern ? [index.namePattern.source] : []),
  ];
  return new RegExp(parts.join('|'), 'g');
}

function lineAt(text, position) {
  const start = text.lastIndexOf('\n', position - 1) + 1;
  const end = text.indexOf('\n', position);
  return text.slice(start, end === -1 ? text.length : end);
}

function attributeSegments(text, index) {
  const segments = [];
  const scanner = attributionScanner(index);
  for (const paragraph of sentences(text)) {
    // A markdown heading or a table row is document structure. "## The $50 Date" is
    // a section title, not a claim that the business named two sentences ago charges
    // fifty dollars, so structure neither carries specifics nor attributes them.
    const structural = /^\s*(?:#{1,6}\s|\||>|-{3,}|\*{3,})/.test(paragraph);
    if (structural) {
      segments.push({ business: null, text: '', mention: null });
      continue;
    }
    let cursor = 0;
    let current = null;
    scanner.lastIndex = 0;
    for (let match = scanner.exec(paragraph); match; match = scanner.exec(paragraph)) {
      const [whole, linkLabel, linkHref, boldText] = match;
      const before = paragraph.slice(cursor, match.index);
      cursor = match.index + whole.length;
      if (linkHref !== undefined) {
        segments.push({ business: current, text: before, mention: null });
        const slug = normalize(linkHref.slice(DIRECTORY_LINK_PREFIX.length));
        const resolved = index.bySlug.get(slug) ?? null;
        segments.push({ business: resolved, text: '', mention: resolved ? null : (linkLabel || linkHref) });
        current = resolved;
        continue;
      }
      if (boldText !== undefined) {
        segments.push({ business: current, text: before, mention: null });
        const mention = boldText.trim();
        const resolved = resolveBusiness(mention, index);
        const context = { nextChar: paragraph[match.index + whole.length] ?? '', line: lineAt(paragraph, match.index), resolved: Boolean(resolved) };
        if (isBusinessMention(mention, context)) {
          segments.push({ business: resolved, text: '', mention: resolved ? null : mention });
          current = resolved;
        } else {
          // Structure or emphasis: it neither attributes nor asserts anything.
          segments.push({ business: current, text: whole, mention: null });
        }
        continue;
      }
      // A plain-text occurrence of a recorded business name.
      segments.push({ business: current, text: before, mention: null });
      const resolved = resolveBusiness(whole, index);
      segments.push({ business: resolved, text: '', mention: null });
      if (resolved) current = resolved;
    }
    segments.push({ business: current, text: paragraph.slice(cursor), mention: null });
  }
  return segments;
}

function holidayDate(rule, year) {
  if (rule.fixed) return new Date(Date.UTC(year, rule.fixed[0], rule.fixed[1]));
  if (rule.nth) {
    const [month, weekday, ordinal] = rule.nth;
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, month, 1 + offset + (ordinal - 1) * 7));
  }
  const [month, day] = rule.mondayBefore;
  const anchor = new Date(Date.UTC(year, month, day));
  const back = (anchor.getUTCDay() + 6) % 7 || 7;
  return new Date(Date.UTC(year, month, day - back));
}

function formatDate(date) {
  return `${MONTHS[date.getUTCMonth()].replace(/^./, (c) => c.toUpperCase())} ${date.getUTCDate()}`;
}

function sentences(text) {
  return String(text ?? '').split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
}

function datesIn(sentence) {
  const found = [];
  const monthFirst = new RegExp(String.raw`\b(${MONTHS.join('|')})\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'gi');
  const dayFirst = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTHS.join('|')})\b`, 'gi');
  for (let m = monthFirst.exec(sentence); m; m = monthFirst.exec(sentence)) {
    found.push({ text: m[0], month: MONTHS.indexOf(m[1].toLowerCase()), day: Number(m[2]) });
  }
  for (let m = dayFirst.exec(sentence); m; m = dayFirst.exec(sentence)) {
    found.push({ text: m[0], month: MONTHS.indexOf(m[2].toLowerCase()), day: Number(m[1]) });
  }
  return found;
}

function postYear(post, now) {
  const published = Date.parse(post?.publishedAt ?? '');
  if (Number.isFinite(published)) return new Date(published).getUTCFullYear();
  const fallback = now instanceof Date ? now.getTime() : Number(now);
  return new Date(Number.isFinite(fallback) ? fallback : Date.now()).getUTCFullYear();
}

function collectFields(post) {
  const fields = [];
  for (const field of TEXT_FIELDS) {
    if (typeof post?.[field] === 'string') fields.push({ field, text: post[field] });
  }
  for (const [index, faq] of (Array.isArray(post?.faqs) ? post.faqs : []).entries()) {
    if (typeof faq?.question === 'string') fields.push({ field: `faqs[${index}].question`, text: faq.question });
    if (typeof faq?.answer === 'string') fields.push({ field: `faqs[${index}].answer`, text: faq.answer });
  }
  for (const [index, item] of (Array.isArray(post?.keyTakeaways) ? post.keyTakeaways : []).entries()) {
    if (typeof item === 'string') fields.push({ field: `keyTakeaways[${index}]`, text: item });
  }
  return fields;
}

// Geography is checked longest-phrase first and each match is blanked out of the
// working copy, so "171 East Liberty St Unit 130" is judged once as an address and
// never again as a bare street.
const GEOGRAPHY_RULES = Object.freeze([
  ...RELATIVE_GEOGRAPHY_PATTERNS.map((pattern) => ({ rule: 'unsupported-address', pattern, label: 'location' })),
  { rule: 'unsupported-address', pattern: ADDRESS_PATTERN, label: 'address' },
  { rule: 'unsupported-address', pattern: BARE_STREET_PATTERN, label: 'street' },
]);

const SPECIFIC_RULES = Object.freeze([
  { rule: 'unsupported-price', pattern: PRICE_PATTERN, label: 'price' },
  { rule: 'unsupported-hours', pattern: HOURS_PATTERN, label: 'opening hours' },
]);

function blankOut(text, start, length) {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
}

/**
 * @param post   a post record as it would be appended to data/posts.json
 * @param opts   { businesses: businesses.json records, now?: clock for the date rule }
 * @returns      { ok, findings: [{ rule, severity, claim, detail }] }
 */
export function lintPost(post, { businesses = [], now } = {}) {
  const index = indexBusinesses(businesses);
  const findings = [];
  const add = (rule, claim, detail, field) => findings.push({ rule, severity: 'high', claim, detail: `${field}: ${detail}` });
  const year = postYear(post, now);

  // Operational slug/title premises (pet-friendly, happy hour, accessibility,
  // reservations) fail closed unless an attributed record actually supports them.
  for (const premise of unsupportedOperationalPremises(post, businesses)) {
    add(
      'unsupported-operational-premise',
      premise.label,
      `slug/title asserts the ${premise.label} operational attribute but no attributed record supports that policy`,
      'slug',
    );
  }

  // Declared attribution: every slug the post claims to be about must be a record.
  for (const [position, slug] of (Array.isArray(post?.relatedBusinesses) ? post.relatedBusinesses : []).entries()) {
    if (!index.bySlug.has(normalize(slug))) {
      add('unrecorded-business', String(slug), 'no data/businesses.json record has this slug', `relatedBusinesses[${position}]`);
    }
  }

  for (const { field, text } of collectFields(post)) {
    for (const segment of attributeSegments(text, index)) {
      if (segment.mention && !segment.business) {
        add('unrecorded-business', segment.mention, 'no data/businesses.json record matches this business reference', field);
        continue;
      }
      // A specific is a claim about a business only when it is attributed to one.
      // An unattributed number (a transit fare, a park's size) belongs to no record
      // and is not something businesses.json can adjudicate.
      if (!segment.business) continue;
      const record = segment.business;
      let remaining = segment.text;
      for (const { rule, pattern, label } of [...GEOGRAPHY_RULES, ...SPECIFIC_RULES]) {
        pattern.lastIndex = 0;
        const hits = [];
        for (let match = pattern.exec(remaining); match; match = pattern.exec(remaining)) {
          hits.push({ index: match.index, text: match[0] });
          if (match[0].length === 0) pattern.lastIndex += 1;
        }
        for (const hit of hits) remaining = blankOut(remaining, hit.index, hit.text.length);
        for (const hit of hits) {
          const claim = hit.text.trim();
          if (!claim) continue;
          if (record.comparable.includes(comparable(claim))) continue;
          add(rule, claim, `${label} is not verbatim in the record for ${record.record.name}`, field);
        }
      }
    }

    for (const sentence of sentences(text)) {
      for (const holiday of HOLIDAYS) {
        if (!holiday.match.test(sentence)) continue;
        const expected = holidayDate(holiday, year);
        for (const found of datesIn(sentence)) {
          if (found.month === expected.getUTCMonth() && found.day === expected.getUTCDate()) continue;
          add('unsupported-date', `${holiday.name} — ${found.text}`,
            `${holiday.name} ${year} falls on ${formatDate(expected)}`, field);
        }
      }
    }
  }

  return { ok: findings.length === 0, findings };
}

export function formatFindings(findings) {
  if (!findings.length) return '- none';
  return findings.map((finding) => `- **${finding.rule}** \`${String(finding.claim).slice(0, 120)}\` — ${finding.detail}`).join('\n');
}

// ---------------------------------------------------------------------------
// CLI: lint a single post file, or every post this working tree added/changed in
// data/posts.json relative to HEAD. Runs before the blog PR is committed.
// ---------------------------------------------------------------------------
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function candidatePosts(options) {
  if (options.post) return [readJson(options.post)];
  const file = options.posts || 'data/posts.json';
  const head = readJson(file);
  let baseline = [];
  try {
    baseline = JSON.parse(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch {
    console.log(`No HEAD baseline for ${file}; linting every post.`);
    return Array.isArray(head) ? head : [];
  }
  const before = new Map((Array.isArray(baseline) ? baseline : []).map((record) => [record?.slug, JSON.stringify(record)]));
  return (Array.isArray(head) ? head : []).filter((record) => before.get(record?.slug) !== JSON.stringify(record));
}

function parseArgs(argv) {
  const values = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const [key, inline] = argv[i].slice(2).split('=', 2);
    values[key] = inline ?? argv[++i];
  }
  return values;
}

async function main() {
  const options = parseArgs(process.argv);
  const mode = resolveLintMode(process.env);
  const businesses = readJson(options.businesses || 'data/businesses.json');
  const posts = candidatePosts(options);
  if (posts.length === 0) {
    console.log('blog-lint: no new or changed post to lint.');
    return;
  }
  const lines = [];
  let total = 0;
  for (const post of posts) {
    const { ok, findings } = lintPost(post, { businesses });
    total += findings.length;
    lines.push(`### blog-lint \`${post?.slug ?? 'unknown'}\` — ${ok ? 'clean' : `${findings.length} finding(s)`}`, '', formatFindings(findings), '');
    console.log(`blog-lint ${post?.slug ?? 'unknown'}: ${ok ? 'clean' : `${findings.length} finding(s)`}`);
    for (const finding of findings) console.log(`  [${finding.rule}] ${finding.claim} — ${finding.detail}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${['## Blog claim linter', '', `Mode: \`${mode}\``, '', ...lines].join('\n')}\n`);
  }
  if (total > 0 && mode === 'fail') {
    throw new Error(`blog-lint refused the draft: ${total} ungrounded claim(s). No pull request was opened.`);
  }
  if (total > 0) console.log(`blog-lint mode=warn: ${total} finding(s) reported but not blocking (L1 rollback is active).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
