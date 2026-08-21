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
const STREET_TYPES = 'St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Lane|Ln|Cres|Crescent|Pl|Place|Ct|Court|Terrace|Trail|Parkway|Pkwy';
const ADDRESS_PATTERN = new RegExp(
  String.raw`\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][A-Za-z.'’-]*\s+){0,3}(?:${STREET_TYPES})\b\.?(?:\s+(?:Unit|Suite|Ste|#)\s*[\w-]+)?`,
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

function indexBusinesses(businesses) {
  const records = Array.isArray(businesses) ? businesses.filter((record) => record && typeof record === 'object') : [];
  return records.map((record) => ({
    record,
    slug: normalize(record.slug),
    name: normalize(record.name),
    text: recordText(record),
  }));
}

// Bold is also used for streets, parks, trails and public venues, which are not
// businesses and have no `businesses.json` record by design. Flagging those would
// discard every draft that names a landmark, so a place name is not a claim about
// a business. Anything else that reads like a proper name IS one, and must resolve.
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

// A bold span is a business mention only when it reads like a proper name: a
// title-cased noun phrase that is not a street, park or public venue. Bold is
// also the site's emphasis mark ("**Work from home**", "**Tip:**"), and emphasis
// is not a claim that a business exists.
function isBusinessMention(text, nextChar = '') {
  const trimmed = text.trim().replace(/[.,;!?]+$/, '');
  // `**Address**: 171 East Liberty St` — a bold field label, not a business name.
  if (nextChar === ':') return false;
  if (!trimmed || trimmed.endsWith(':') || !/^[A-Z0-9]/.test(trimmed)) return false;
  if (PLACE_SUFFIX.test(trimmed)) return false;
  if (NOT_A_NAME.some((pattern) => pattern.test(trimmed))) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 8) return false;
  if (!words.some((word) => /[A-Za-z]{2,}/.test(word))) return false;
  return words.every((word, position) => {
    const bare = word.replace(/^[('"]+|[)'".,;!?]+$/g, '');
    if (!bare || /^[\d$#&+-]/.test(bare)) return true;
    if (/^[A-Z]/.test(bare)) return true;
    return position > 0 && NAME_CONNECTORS.has(bare.toLowerCase());
  });
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
// Attribution resets at every paragraph so a business named in the intro does not
// silently own a number eight paragraphs later.
function attributeSegments(text, index) {
  const segments = [];
  for (const paragraph of String(text ?? '').split(/\n\s*\n+/)) {
    let cursor = 0;
    let current = null;
    BOLD_PATTERN.lastIndex = 0;
    for (let match = BOLD_PATTERN.exec(paragraph); match; match = BOLD_PATTERN.exec(paragraph)) {
      segments.push({ business: current, text: paragraph.slice(cursor, match.index), mention: null });
      const mention = match[1].trim();
      if (isBusinessMention(mention, paragraph[match.index + match[0].length] ?? '')) {
        const resolved = resolveBusiness(mention, index);
        segments.push({ business: resolved, text: '', mention });
        current = resolved;
      }
      cursor = match.index + match[0].length;
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

const SPECIFIC_RULES = Object.freeze([
  { rule: 'unsupported-address', pattern: ADDRESS_PATTERN, label: 'address' },
  { rule: 'unsupported-price', pattern: PRICE_PATTERN, label: 'price' },
  { rule: 'unsupported-hours', pattern: HOURS_PATTERN, label: 'opening hours' },
]);

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

  for (const { field, text } of collectFields(post)) {
    for (const segment of attributeSegments(text, index)) {
      if (segment.mention && !segment.business) {
        add('unrecorded-business', segment.mention, `no data/businesses.json record matches this bold business name`, field);
        continue;
      }
      for (const { rule, pattern, label } of SPECIFIC_RULES) {
        pattern.lastIndex = 0;
        for (let match = pattern.exec(segment.text); match; match = pattern.exec(segment.text)) {
          // A specific is a claim about a business only when it is attributed to
          // one. An unattributed number (a transit fare, a park's size) belongs to
          // no record and is not something businesses.json can adjudicate.
          if (!segment.business) continue;
          const claim = match[0].trim();
          if (segment.business.text.includes(normalize(claim))) continue;
          add(rule, claim, `${label} is not verbatim in the record for ${segment.business.record.name}`, field);
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
