// Shared trusted reference extractor for named-business facts.
//
// Leaf module: no CLI, no network, no process.argv. blog-lint, the gate, and the
// fixer all consume `extractReferencedBusinesses` so a post object, a unified
// diff, and a JSON fixer payload resolve the same repository records.
//
// Mentions are look-ups against recorded names and slugs only. Capitalized prose
// is never guessed to be a company.

export const DIRECTORY_LINK_PREFIX = '/directory/';

// Narrow operational-attribute taxonomy for slug/title (and immutable slug/image)
// premises. Outdoor dining / patios are intentionally not in this list.
export const OPERATIONAL_PREMISES = Object.freeze([
  {
    id: 'pet-friendly',
    label: 'pet-friendly / dog policy',
    core: /pet-friendly|dog-friendly|dog-policy|pet-policy|dining with (?:your )?dog|dine with (?:your )?dog/i,
    support: /pet-friendly|dog-friendly|dogs? are welcome|pets? (?:are )?welcome|dog policy|pet policy/i,
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

function relatedBusinessSlugs(source) {
  const slugs = new Set();
  const collect = (value) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) slugs.add(item.trim());
    }
  };
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    collect(source.relatedBusinesses);
  }
  return slugs;
}

function nameAppears(text, name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < 4) return false;
  const escaped = escapeRegExp(trimmed).replace(/['’]/g, "['’]");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(text);
}

function slugDeclared(text, slug) {
  if (!slug) return false;
  if (text.includes(`${DIRECTORY_LINK_PREFIX}${slug}`)) return true;
  return text.includes(`"${slug}"`);
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
  if (slug && slugDeclared(text, slug)) return true;
  if (nameAppears(text, record?.name)) return true;
  return false;
}

/**
 * Identify every repository business used for factual claims in `source`.
 * `source` may be a post object, a unified diff, or fixer-payload JSON.
 * Returns stable, de-duplicated record objects in repository order.
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

export function operationalPremisesIn(text) {
  const blob = String(text ?? '');
  return OPERATIONAL_PREMISES.filter((premise) => premise.core.test(blob));
}

export function recordSupportsPremise(record, premise) {
  return Boolean(premise?.support?.test(recordSupportText(record)));
}

/**
 * Operational slug/title premises that no attributed record supports.
 * Missing or non-array `businesses` fails closed (no supporting record).
 */
export function unsupportedOperationalPremises(post, businesses) {
  const premises = operationalPremisesIn(`${post?.slug ?? ''} ${post?.title ?? ''}`);
  if (premises.length === 0) return [];
  const attributed = extractReferencedBusinesses(post, businesses);
  return premises.filter((premise) => !attributed.some((record) => recordSupportsPremise(record, premise)));
}

export function corePremiseText(record) {
  const tags = Array.isArray(record?.tags) ? record.tags.join(' ') : '';
  return `${record?.title ?? ''} ${record?.description ?? ''} ${tags}`;
}

export function identityPremiseText(record) {
  return `${record?.slug ?? ''} ${record?.image ?? ''}`;
}
