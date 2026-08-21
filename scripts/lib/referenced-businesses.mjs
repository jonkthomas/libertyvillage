// Shared trusted reference extractor for named-business facts.
//
// Leaf module: no CLI, no network, no process.argv. blog-lint, the gate, and the
// fixer all consume `extractReferencedBusinesses` so a post object, a unified
// diff, and a JSON fixer payload resolve the same repository records.
//
// Mentions are look-ups against recorded names and slugs only. Capitalized prose
// is never guessed to be a company.
//
// Allowed attribution channels: exact recorded names in factual text,
// `/directory/<slug>` links, explicit `relatedBusinesses` slugs, and bold names
// (which resolve through the recorded-name channel). `relatedPosts` and generic
// quoted slug strings are not attribution.

export const DIRECTORY_LINK_PREFIX = '/directory/';
export const MAX_REFERENCE_RECORDS = 40;
export const MAX_REFERENCE_BYTES = 120_000;

// Narrow operational-attribute taxonomy for slug/title (and immutable slug/image)
// premises. Outdoor dining / patios are intentionally not in this list.
export const OPERATIONAL_PREMISES = Object.freeze([
  {
    id: 'pet-friendly',
    label: 'pet-friendly / dog policy',
    core: /pet-friendly|dog-friendly|dog-policy|pet-policy|dining with (?:your )?dog\b|dine with (?:your )?dog\b/i,
    support: /pet-friendly|dog-friendly|dogs? are welcome|pets? (?:are )?welcome|(?<!\bno\s)(?<!\bwithout\s(?:a\s)?)(?:dog|pet) policy/i,
  },
  {
    id: 'happy-hour',
    label: 'happy hour',
    core: /\bhappy-hour\b|\bhappy hour\b/i,
    support: /\bhappy[\s-]*hour\b/i,
  },
  {
    id: 'accessibility',
    label: 'accessibility',
    core: /\bwheelchair\b|\baccessibility\b|accessible restaurants|accessible dining|\bstep-free\b/i,
    support: /\bwheelchair\b|\bstep-?free\b|\baccessibility\b|\bada-compliant\b|fully accessible/i,
  },
  {
    id: 'reservations',
    label: 'reservations',
    core: /\breservations?\b/i,
    support: /\breservations?\b|book(?:s|ing)? a table|takes bookings/i,
  },
]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceToText(source) {
  if (typeof source === 'string') return source;
  if (source == null) return '';
  try {
    return JSON.stringify(source);
  } catch {
    return String(source);
  }
}

function addSlug(slugs, value) {
  if (typeof value === 'string' && value.trim()) slugs.add(value.trim());
}

function collectRelatedBusinessSlugs(value, slugs, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectRelatedBusinessSlugs(item, slugs, seen);
    return;
  }
  if (Array.isArray(value.relatedBusinesses)) {
    for (const item of value.relatedBusinesses) addSlug(slugs, item);
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') collectRelatedBusinessSlugs(nested, slugs, seen);
  }
}

function relatedBusinessSlugsFromText(text, slugs) {
  const pattern = /"relatedBusinesses"\s*:\s*\[([\s\S]*?)\]/g;
  for (const match of text.matchAll(pattern)) {
    for (const quoted of match[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
      addSlug(slugs, quoted[1].replace(/\\"/g, '"'));
    }
  }
}

function relatedBusinessSlugs(source) {
  const slugs = new Set();
  if (source && typeof source === 'object') {
    collectRelatedBusinessSlugs(source, slugs);
    return slugs;
  }
  const text = sourceToText(source);
  try {
    collectRelatedBusinessSlugs(JSON.parse(text), slugs);
    return slugs;
  } catch {
    relatedBusinessSlugsFromText(text, slugs);
    return slugs;
  }
}

function nameAppears(text, name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < 4) return false;
  const escaped = escapeRegExp(trimmed).replace(/['’]/g, "['’]");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(text);
}

function directoryLinkFor(text, slug) {
  if (!slug) return false;
  const needle = `${DIRECTORY_LINK_PREFIX}${slug}`;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    const after = text[index + needle.length] ?? '';
    if (!after || !/[A-Za-z0-9._-]/.test(after)) return true;
    index += needle.length;
  }
  return false;
}

function recordSupportText(record) {
  const parts = [];
  const walk = (value) => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    else if (typeof value === 'number') parts.push(String(value));
  };
  walk(record);
  return parts.join(' | ');
}

function isRecordReferenced(text, record, declaredSlugs) {
  const slug = typeof record?.slug === 'string' ? record.slug.trim() : '';
  if (slug && declaredSlugs.has(slug)) return true;
  if (slug && directoryLinkFor(text, slug)) return true;
  if (nameAppears(text, record?.name)) return true;
  return false;
}

/**
 * Identify every repository business used for factual claims in `source`.
 * `source` may be a post object, a unified diff, or fixer-payload JSON.
 * Returns stable, de-duplicated record objects in repository order.
 * Missing/non-array `businesses` fails closed (empty set). Never truncates.
 */
export function extractReferencedBusinesses(source, businesses) {
  if (!Array.isArray(businesses)) return [];
  const text = sourceToText(source);
  const declaredSlugs = relatedBusinessSlugs(source);
  const selected = [];
  const seen = new Set();
  for (const record of businesses) {
    if (!record || typeof record !== 'object') continue;
    const key = typeof record.slug === 'string' && record.slug.trim()
      ? record.slug.trim()
      : String(record.name ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    if (!isRecordReferenced(text, record, declaredSlugs)) continue;
    seen.add(key);
    selected.push(record);
  }
  return selected;
}

export function selectReferenceRecords(source, businesses) {
  if (!Array.isArray(businesses)) {
    throw new Error('grounded reference records are missing; refusing ungrounded selection');
  }
  const selected = extractReferencedBusinesses(source, businesses);
  if (selected.length > MAX_REFERENCE_RECORDS) {
    const error = new Error(
      `MAX_REFERENCE_RECORDS exceeded: extracted ${selected.length} records (limit ${MAX_REFERENCE_RECORDS}); refusing to drop the tail`,
    );
    error.name = 'MAX_REFERENCE_RECORDS';
    error.code = 'MAX_REFERENCE_RECORDS';
    throw error;
  }
  const text = JSON.stringify(selected, null, 2);
  if (Buffer.byteLength(text) > MAX_REFERENCE_BYTES) {
    throw new Error(`reference record byte budget exceeded: ${Buffer.byteLength(text)} > ${MAX_REFERENCE_BYTES}`);
  }
  return selected;
}

export function operationalPremisesIn(text) {
  const blob = String(text ?? '');
  return OPERATIONAL_PREMISES.filter((premise) => premise.core.test(blob));
}

export function recordSupportsPremise(record, premise) {
  return Boolean(premise?.support?.test(recordSupportText(record)));
}

function postPremiseText(post) {
  return `${post?.slug ?? ''} ${post?.title ?? ''}`;
}

/**
 * Operational slug/title premises that no attributed record supports.
 * Missing or non-array `businesses` fails closed (no supporting record).
 */
export function unsupportedOperationalPremises(post, businesses) {
  const premises = operationalPremisesIn(postPremiseText(post));
  if (premises.length === 0) return [];
  if (!Array.isArray(businesses)) return premises;
  const attributed = extractReferencedBusinesses(post, businesses);
  return premises.filter((premise) => !attributed.some((record) => recordSupportsPremise(record, premise)));
}

/**
 * Attributed businesses on a premise-bearing post whose own records do not
 * support that premise. One supported peer cannot license the rest.
 */
export function unsupportedPremiseAttributions(post, businesses) {
  const premises = operationalPremisesIn(postPremiseText(post));
  if (premises.length === 0 || !Array.isArray(businesses)) return [];
  const attributed = extractReferencedBusinesses(post, businesses);
  const rows = [];
  for (const premise of premises) {
    for (const record of attributed) {
      if (!recordSupportsPremise(record, premise)) rows.push({ premise, record });
    }
  }
  return rows;
}

export function corePremiseText(record) {
  const tags = Array.isArray(record?.tags) ? record.tags.join(' ') : '';
  return `${record?.title ?? ''} ${record?.description ?? ''} ${record?.content ?? ''} ${tags}`;
}

export function identityPremiseText(record) {
  return `${record?.slug ?? ''} ${record?.image ?? ''}`;
}
