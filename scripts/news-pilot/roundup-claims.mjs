// Decision B: roundup-only deterministic refusal of civic-address and
// monetary-price copy in ALL visible roundup post fields.
//
// Scope: title, description, answerBlock, content (numbered headings, bodies,
// aggregate lines, trailing Still in effect, visible citation labels),
// keyTakeaways and FAQs. Attribution-independent: business attribution (or its
// absence) never permits these specifics. URL targets are not prose and are
// never scanned. Opaque evidence/identity keys (roundupCoverage, ctx units)
// are never scanned.
//
// Pure and deterministic: no network, no model, no clock. blog-lint.mjs is
// unchanged and still runs separately; this module only ADDS the roundup ban.
const STREET_TYPES = 'Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Crescent|Cres|Terrace|Trail|Parkway|Pkwy|Court|Ct|Place|Pl|Lane|Ln|Way';
const DIRECTION = '(?:West|East|North|South|W|E|N|S)';
// Numbered civic address, case-insensitive so lower-case evasion still holds.
// Conservative by design: ambiguous matches HOLD rather than pass.
const CIVIC_ADDRESS = new RegExp(
  String.raw`\b\d{1,5}[A-Za-z]?\s+(?:[\w.'’~-]+\s+){0,3}(?:${STREET_TYPES})\.?(?:\s+${DIRECTION}\b\.?)?(?:\s+(?:Unit|Suite|Ste|#)\s*[\w-]+)?`,
  'gi',
);
const PRICE_PATTERNS = Object.freeze([
  /\$\s?\d[\d,]*(?:\.\d{1,2})?/g,
  /[€£¥]\s?\d[\d,]*(?:\.\d{1,2})?/g,
  /\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars?|cents?|bucks?)\b/gi,
  /\b(?:CAD|USD)\s?\$?\s?\d[\d,]*(?:\.\d{1,2})?\b/gi,
  /\b\d[\d,]*(?:\.\d{1,2})?\s?(?:CAD|USD)\b/gi,
]);
// A promised free admission is a $0 price claim.
const FREE_ADMISSION = Object.freeze([
  /\bfree\s+(?:admission|entry|cover|tickets?)\b/gi,
  /\b(?:admission|entry|cover)(?:\s+is)?\s+free\b/gi,
  /\bno\s+cover(?:\s+charge)?\b/gi,
]);

// Numeric/named HTML entities that render as visible characters. Decoded
// before scanning so `&#36;999` cannot bypass the price ban; anything left
// over in entity shape is refused fail-closed below.
const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  dollar: '$', euro: '\u20AC', pound: '\u00A3', yen: '\u00A5', cent: '\u00A2' });
function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#(\d+);/g, (match, digits) => {
      const point = Number(digits);
      return Number.isSafeInteger(point) && point <= 0x10FFFF ? String.fromCodePoint(point) : match;
    })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (match, hex) => {
      const point = Number.parseInt(hex, 16);
      return Number.isSafeInteger(point) && point <= 0x10FFFF ? String.fromCodePoint(point) : match;
    })
    .replace(/&([A-Za-z][A-Za-z0-9]*);/g, (match, name) =>
      Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match);
}
// Any entity-shaped token surviving the decode (unknown named entities such
// as `&Dollar;`, double-encoded or malformed) is refused fail-closed: some
// renderer may still decode it, so it can never be trusted as plain text.
const ENTITY_PATTERN = /&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g;

// Fold rendering variants so Markdown/Unicode/entity evasion still matches:
// NFKC, entity decode, backslash escapes, emphasis markers, zero-width
// chars, whitespace.
function foldVisible(text) {
  return decodeEntities(String(text ?? '').normalize('NFKC'))
    .replace(/\\/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ');
}

// Visible text only: keep markdown link labels and image alt text, drop every
// URL target (link destinations and bare URLs are not prose).
function visibleText(text) {
  const folded = foldVisible(text);
  const labelled = folded
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ');
  return labelled.replace(/https?:\/\/[^\s)\]>'"]+/g, ' ');
}

function collect(patterns, text, kind, out) {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const claim = match[0].trim();
      if (claim) out.push({ kind, claim: claim.slice(0, 120) });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
}

/** All banned spans in one visible string, in scan order. Claim samples are
 * private diagnostics for the writer retry prompt only; they never enter
 * retained errors, logs or census fields. */
export function findRoundupBannedCopy(text) {
  const visible = visibleText(text);
  const out = [];
  collect([CIVIC_ADDRESS], visible, 'civic-address', out);
  collect(PRICE_PATTERNS, visible, 'price', out);
  collect(FREE_ADMISSION, visible, 'price', out);
  collect([ENTITY_PATTERN], visible, 'entity-encoded', out);
  return out;
}

const FIELDS = Object.freeze(['title', 'description', 'answerBlock', 'content']);

/**
 * Deterministic refusal errors for every visible field of a roundup post.
 * Bounded to rule + field + count: no generated claim snippet, URL or person
 * text ever enters a retained error (and so never reaches census/logs).
 */
export function checkRoundupVisibleCopy(post) {
  const errors = [];
  const push = (field, found) => {
    const counts = new Map();
    for (const span of found) counts.set(span.kind, (counts.get(span.kind) || 0) + 1);
    for (const [kind, count] of counts)
      errors.push(`roundup ${kind} copy is refused in ${field} (${count} match${count === 1 ? '' : 'es'})`);
  };
  if (post && typeof post === 'object') {
    for (const field of FIELDS) {
      if (typeof post[field] === 'string') push(field, findRoundupBannedCopy(post[field]));
    }
    for (const [index, item] of (Array.isArray(post.keyTakeaways) ? post.keyTakeaways : []).entries()) {
      if (typeof item === 'string') push(`keyTakeaways[${index}]`, findRoundupBannedCopy(item));
    }
    for (const [index, faq] of (Array.isArray(post.faqs) ? post.faqs : []).entries()) {
      if (typeof faq?.question === 'string') push(`faqs[${index}].question`, findRoundupBannedCopy(faq.question));
      if (typeof faq?.answer === 'string') push(`faqs[${index}].answer`, findRoundupBannedCopy(faq.answer));
    }
  }
  return errors.slice(0, 8);
}

/** Deterministic refusal codes for a writer draft (intro, headings, bodies). */
export function checkRoundupDraftCopy(draft) {
  const kinds = new Set();
  const scan = (text) => { for (const span of findRoundupBannedCopy(text)) kinds.add(span.kind); };
  scan(draft?.intro);
  for (const entry of draft?.units || []) {
    scan(entry?.heading);
    scan(entry?.body);
  }
  return [...kinds].map((kind) => `banned-${kind === 'civic-address' ? 'civic-address' : kind === 'price' ? 'price' : 'entity'}`);
}

/** Bounded claim samples for the targeted omission retry prompt. */
export function draftBannedSamples(draft, max = 3) {
  const samples = [];
  const scan = (text) => { for (const span of findRoundupBannedCopy(text)) samples.push(span.claim); };
  scan(draft?.intro);
  for (const entry of draft?.units || []) {
    scan(entry?.heading);
    scan(entry?.body);
  }
  return [...new Set(samples)].slice(0, max);
}
