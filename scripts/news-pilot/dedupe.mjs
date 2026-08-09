/**
 * PURE in-run clustering + already-covered checks against published posts.
 * No embeddings. No network.
 */

import { publisherDomain } from './normalize.mjs';

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'from',
  'by', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'its', 'it', 'this',
  'that', 'these', 'those', 'into', 'over', 'after', 'before', 'about', 'via',
]);

/** Boilerplate tokens common to CKAN development-application titles. */
const CKAN_BOILERPLATE = new Set([
  'development',
  'application',
  'ste',
  'sa',
  'oz',
  'nny',
  'cd',
  'sb',
  'ave',
  'st',
  'rd',
  'dr',
  'blvd',
  'unknown',
  'address',
]);

/** Entity-ish tokens used with date for soft clustering. */
const ENTITY_TERMS = [
  'liberty village',
  'exhibition place',
  'lamport',
  'ttc',
  'streetcar',
  'hanna',
  'atlantic',
  'east liberty',
  'dufferin',
  'king west',
  'king street',
  'mowat',
  'jefferson',
  'pirandello',
  'ordnance',
  'strachan',
  'cne',
  'enercare',
  'bmo field',
  'ontario place',
  'ontario line',
  'carpet factory',
  'world cup',
  'fifa',
  'development',
  'construction',
  'closure',
  'tower',
  'condo',
  'brewery',
];

/**
 * Primary topics used for alreadyCovered checks (deterministic phrase match).
 * Longer phrases preferred; matched against titles/slugs/tags only.
 *
 * Body-level topic/address matching was removed: a bare landmark or address
 * token in an evergreen guide body (e.g. "34 Hanna" inside the World Cup
 * survival guide) is a mention, not coverage, and was falsely suppressing
 * genuine local stories (park competition, municipal park project pages).
 */
export const COVERAGE_TOPICS = Object.freeze([
  { id: 'world-cup', phrases: ['world cup', 'fifa world cup', 'fifa 2026', 'world-cup'] },
  { id: 'ontario-line', phrases: ['ontario line', 'ontario-line'] },
  { id: 'carpet-factory', phrases: ['carpet factory', 'carpet-factory'] },
  { id: 'bmo-field', phrases: ['bmo field', 'bmo-field'] },
  { id: 'exhibition-place', phrases: ['exhibition place', 'explace'] },
  // hanna-park removed: no published post carries it in title/slug/tag, and body
  // matching is intentionally off — the topic id was dead weight against the corpus.
  { id: 'toy-factory', phrases: ['toy factory'] },
]);

/**
 * Tunable coverage-relation thresholds (duplicate vs follow-up vs new).
 * Kept here — not scattered as magic numbers.
 */
export const COVERAGE_CONFIG = Object.freeze({
  /** Title Jaccard at/above this → hard duplicate. */
  titleJaccardDuplicate: 0.62,
  /** Soft Jaccard used with shared topic + same angle and no new development. */
  titleJaccardSoftDuplicate: 0.45,
  /** Liberty Village-titled pair Jaccard → duplicate. */
  lvTitleJaccardDuplicate: 0.45,
  /** Candidate published this many days after covering post counts as newer development. */
  newerPublishDays: 14,
  /**
   * Relative-time novelty (tonight/today/matchup) only counts when the candidate
   * date is exact AND age is within roughly one freshness half-life.
   * Aligned with SCORE_CONFIG.freshnessHalfLifeHours (240h).
   */
  relativeNoveltyMaxAgeHours: 240,
  /** Signal ids that are relative-time words, not absolute new facts. */
  relativeNoveltySignalIds: Object.freeze(['temporal-imminent', 'matchup']),
});

/**
 * Reader-need / angle markers. Shared topic + different angle ⇒ follow-up, not rehash.
 * Small curated set — not a general similarity engine.
 */
export const COVERAGE_ANGLES = Object.freeze([
  {
    id: 'traffic-closure',
    phrases: [
      'road closure',
      'road closures',
      'lane closure',
      'lane closures',
      'traffic',
      'detour',
      'road closed',
      'street closure',
      'resident access',
      'haul route',
      'haul routes',
    ],
  },
  {
    id: 'dining-watch',
    phrases: [
      'restaurant',
      'restaurants',
      'bar ',
      'bars',
      'patio',
      'patios',
      'dining',
      'where to watch',
      'watch the world cup',
      'watch party',
      'coffee shop',
      'coffee shops',
      'cafe',
      'cafes',
      'where to eat',
      'late-night',
      'late night',
    ],
  },
  {
    id: 'parking',
    phrases: ['parking', 'green p', 'green-p'],
  },
  {
    id: 'tickets-schedule',
    phrases: ['ticket', 'tickets', 'match schedule', 'match dates', 'fixture'],
  },
  {
    id: 'construction',
    phrases: [
      'construction',
      'tunnelling',
      'tunneling',
      'tunnel boring',
      'boring machine',
      'haul route',
      'works yard',
    ],
  },
  {
    id: 'station-design',
    phrases: [
      'station design',
      'station entrance',
      'secondary entrance',
      'design approved',
      'design decision',
      'station plan',
    ],
  },
  {
    id: 'service-schedule-change',
    phrases: [
      'service change',
      'schedule change',
      'weekend closure',
      'overnight closure',
      'new closure',
      'full closure',
      'station closed',
    ],
  },
  {
    id: 'match-day',
    phrases: ['match day', 'match-day', 'game day', 'game-day', 'tonight', 'vs.', ' vs '],
  },
  {
    id: 'survival-guide',
    phrases: ['survival guide', 'what residents', 'how residents', 'prepare for', 'crowds', 'noise'],
  },
  {
    id: 'volunteer-jobs',
    phrases: ['volunteer', 'jobs', 'hiring', 'paid roles'],
  },
  {
    id: 'fan-guide',
    phrases: ['fans guide', "fan's guide", 'supporters guide', 'diaspora'],
  },
]);

/**
 * Signals that a candidate carries a NEW substantive development relative to a post.
 * Matched on candidate text; only counts when absent from the covering post text.
 */
export const NEW_DEVELOPMENT_PATTERNS = Object.freeze([
  { id: 'temporal-imminent', re: /\b(?:tonight|today|tomorrow|this weekend|overnight|starting monday|starting tuesday|starting wednesday|starting thursday|starting friday)\b/i },
  { id: 'calendar-date', re: /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s*20\d{2})?\b/i },
  { id: 'iso-date', re: /\b20\d{2}-\d{2}-\d{2}\b/ },
  { id: 'decision', re: /\b(?:approved|approves|approval|announced|announces|announcement|decision|voted|awards?|awarded|greenlit|green-lit)\b/i },
  { id: 'new-stage', re: /\b(?:new|newly)\s+(?:closure|station|schedule|phase|stage|entrance|detour|stoppage|restriction)s?\b/i },
  { id: 'phase-number', re: /\b(?:phase|stage)\s+[0-9ivx]+\b/i },
  // Sporting fixtures only — civic "residents vs developer" is handled via test fn.
  { id: 'matchup', test: (text) => hasSportingMatchup(text) },
  { id: 'quantity', re: /\b\d{1,3}\s*-\s*(?:storey|story|hour|day|week)s?\b|\$\s?\d[\d,]*(?:\.\d+)?[kmb]?\b/i },
  { id: 'schedule-shift', re: /\b(?:moved to|rescheduled|postponed|delayed until|begins? on|starts? on)\b/i },
]);

/**
 * @param {string} title
 * @returns {Set<string>}
 */
export function normalizeTitleTokens(title) {
  const raw = String(title || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOP.has(t));
  return new Set(raw);
}

/**
 * Jaccard similarity on token sets.
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
export function jaccard(a, b) {
  if (!a?.size && !b?.size) return 1;
  if (!a?.size || !b?.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** @param {string|null|undefined} iso */
export function dateKey(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Site-specific landmarks that can justify cross-day same-story merges when
 * paired with a shared built-form specific. Broad topics (ontario line, world
 * cup, bmo field, ontario place) stay in ENTITY_TERMS for same-day clustering
 * only — they must NOT open the multi-day window.
 */
export const DISTINCTIVE_STORY_LANDMARKS = Object.freeze([
  'carpet factory',
  'toy factory',
  'lamport',
  'enercare',
]);

/**
 * Built-form / proposal specifics used with a distinctive landmark for strong
 * cross-day clustering (e.g. "37-storey" + "hotel").
 * Cross-day merges require at least one shared EXACT storey count; loose
 * hotel/mixed-use alone is not enough (avoids collapsing unrelated proposals).
 * @param {string} text
 * @returns {string[]}
 */
export function extractBuiltFormSpecs(text) {
  const lower = String(text || '').toLowerCase();
  const specs = new Set();
  for (const m of lower.matchAll(/\b(\d{1,3})\s*-\s*(?:storey|story)\b/g)) {
    specs.add(`${m[1]}-storey`);
  }
  if (/\bhotel\b/.test(lower)) specs.add('hotel');
  if (/\bmixed-?use\b/.test(lower)) specs.add('mixed-use');
  return [...specs].sort();
}

/** Shared exact storey-count specs only (e.g. "37-storey"). */
export function sharedExactStoreySpecs(specsA, specsB) {
  const b = new Set(specsB || []);
  return [...(specsA || [])].filter((s) => /^\d+-storey$/.test(s) && b.has(s));
}

/**
 * Long-window civic design-competition / public-realm project anchor.
 * Requires place + park + competition language so municipal facility pages
 * and unrelated park mentions do not join.
 * @param {string} text
 * @returns {string|null} stable anchor id or null
 */
export function extractCivicProjectAnchor(text) {
  const lower = String(text || '').toLowerCase();
  const place =
    /\bliberty village\b/.test(lower) ||
    /\b34\s*hanna\b/.test(lower) ||
    /\bhanna avenue\b/.test(lower) ||
    /\bhanna ave\b/.test(lower);
  const park = /\bpark\b/.test(lower);
  const competition =
    /\b(?:design\s+)?competition\b/.test(lower) ||
    /\bshortlisted\b/.test(lower) ||
    /\bshort-?listed\b/.test(lower) ||
    /\bdesign teams?\b/.test(lower) ||
    /\bpublic realm\b/.test(lower);
  if (place && park && competition) return 'lv-park-design-competition';
  return null;
}

/** @param {string|null|undefined} isoA @param {string|null|undefined} isoB */
export function calendarDayDelta(isoA, isoB) {
  const a = dateKey(isoA);
  const b = dateKey(isoB);
  if (!a || !b) return null;
  const ms = Math.abs(Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`));
  if (Number.isNaN(ms)) return null;
  return ms / 86_400_000;
}

/** @param {string} text */
export function extractEntities(text) {
  const lower = String(text || '').toLowerCase();
  const hits = [];
  for (const term of ENTITY_TERMS) {
    if (lower.includes(term)) hits.push(term);
  }
  // Distinctive money / quantity anchors (e.g. $5,000 / $5K)
  const money = lower.match(/\$\s?\d+[k0-9,]*/g);
  if (money) {
    for (const m of money) hits.push(m.replace(/\s+/g, ''));
  }
  // "likely stole" style anchors
  if (/\blikely\b.{0,20}\bstol/i.test(lower) || /\bstol(?:e|en)\b.{0,20}\b\$?\d/i.test(lower)) {
    hits.push('theft-allegation');
  }
  if (/\bpolice\b/i.test(lower) && /\bstol/i.test(lower)) {
    hits.push('police-theft');
  }
  return [...new Set(hits)].sort();
}

/** @param {object} candidate */
export function isCkanDevApp(candidate) {
  if (candidate?.applicationNumber) return true;
  if (String(candidate?.sourceId || '').startsWith('ckan-dev-apps')) return true;
  return /\bdevelopment application\b/i.test(candidate?.title || '');
}

/**
 * @param {object} a candidate
 * @param {object} b candidate
 * @param {object} [opts]
 */
export function sameStory(a, b, opts = {}) {
  const titleThreshold = opts.titleThreshold ?? 0.55;
  const entityMinShared = opts.entityMinShared ?? 1;

  // Distinct development applications never merge on boilerplate titles.
  if (isCkanDevApp(a) || isCkanDevApp(b)) {
    const appA = a.applicationNumber || null;
    const appB = b.applicationNumber || null;
    if (appA && appB) {
      if (appA === appB) return { match: true, reason: 'application_number' };
      return { match: false, reason: 'distinct_application_number' };
    }
    const addrA = (a.addressKey || '').toUpperCase();
    const addrB = (b.addressKey || '').toUpperCase();
    if (addrA && addrB && addrA === addrB) {
      return { match: true, reason: 'application_address' };
    }
    // Fall through only for URL identity; block weak title merges.
    const urlA0 = (a.canonicalUrl || a.url || '').toLowerCase();
    const urlB0 = (b.canonicalUrl || b.url || '').toLowerCase();
    if (urlA0 && urlB0 && urlA0 === urlB0 && a.urlUsable !== false && b.urlUsable !== false) {
      return { match: true, reason: 'canonical_url' };
    }
    return { match: false, reason: 'ckan_no_shared_application_key' };
  }

  const urlA = (a.canonicalUrl || a.url || '').toLowerCase();
  const urlB = (b.canonicalUrl || b.url || '').toLowerCase();
  if (
    urlA &&
    urlB &&
    urlA === urlB &&
    a.urlUsable !== false &&
    b.urlUsable !== false &&
    !/google\.com\/goto/i.test(urlA)
  ) {
    return { match: true, reason: 'canonical_url' };
  }

  const tokA = normalizeTitleTokens(a.title);
  const tokB = normalizeTitleTokens(b.title);
  // Drop CKAN boilerplate if present in non-ckan path (safety).
  for (const t of CKAN_BOILERPLATE) {
    tokA.delete(t);
    tokB.delete(t);
  }
  const jac = jaccard(tokA, tokB);
  if (jac >= titleThreshold) {
    return { match: true, reason: `title_jaccard:${jac.toFixed(2)}` };
  }

  const dayA = dateKey(a.publishedAt);
  const dayB = dateKey(b.publishedAt);
  const textA = `${a.title} ${a.snippet || ''}`;
  const textB = `${b.title} ${b.snippet || ''}`;
  const entA = new Set(extractEntities(textA));
  const entB = new Set(extractEntities(textB));
  let shared = 0;
  const sharedList = [];
  for (const e of entA) {
    if (entB.has(e)) {
      shared += 1;
      sharedList.push(e);
    }
  }
  // Strong story anchors can merge even when headlines diverge.
  const strongMoneyOrCrime = sharedList.some(
    (e) => e.startsWith('$') || e === 'theft-allegation' || e === 'police-theft',
  );
  const sharedDistinctiveLandmarks = sharedList.filter((e) =>
    DISTINCTIVE_STORY_LANDMARKS.includes(e),
  );
  const strongLandmark = sharedDistinctiveLandmarks.length > 0;
  const strong = strongMoneyOrCrime || strongLandmark;

  if (dayA && dayB && dayA === dayB) {
    if (shared >= entityMinShared && (jac >= 0.3 || strong)) {
      return {
        match: true,
        reason: `entity_date:shared=${shared},j=${jac.toFixed(2)},day=${dayA}${strong ? ',strong' : ''}`,
      };
    }
  }

  // Cross-day merge ONLY with a STRONG compound anchor: site-specific landmark +
  // shared EXACT storey count (not loose hotel/mixed-use alone), or shared
  // money/theft anchors. Broad topics (ontario line / world cup / …) never open
  // this window. Generic "development"/"tower" pairs stay same-day-only.
  const strongAnchorMaxDayDelta = opts.strongAnchorMaxDayDelta ?? 7;
  const dayDelta = calendarDayDelta(a.publishedAt, b.publishedAt);
  if (dayDelta != null && dayDelta > 0 && dayDelta <= strongAnchorMaxDayDelta) {
    const specsA = extractBuiltFormSpecs(textA);
    const specsB = extractBuiltFormSpecs(textB);
    const sharedStoreys = sharedExactStoreySpecs(specsA, specsB);
    if (strongLandmark && sharedStoreys.length > 0) {
      return {
        match: true,
        reason: `strong_anchor_window:landmarks=${sharedDistinctiveLandmarks.join('+')},specs=${sharedStoreys.join('+')},dayDelta=${dayDelta}`,
      };
    }
    if (strongMoneyOrCrime && shared >= entityMinShared) {
      return {
        match: true,
        reason: `strong_anchor_window:money_or_crime,shared=${shared},dayDelta=${dayDelta}`,
      };
    }
  }

  // Longer-window civic project anchor: same design-competition / public-realm
  // story reported months apart by independent publishers. Does not weaken
  // general clustering — requires the narrow civic-project anchor on both sides.
  const civicAnchorMaxDayDelta = opts.civicProjectAnchorMaxDayDelta ?? 366;
  if (dayDelta != null && dayDelta > 0 && dayDelta <= civicAnchorMaxDayDelta) {
    const civicA = extractCivicProjectAnchor(textA);
    const civicB = extractCivicProjectAnchor(textB);
    if (civicA && civicB && civicA === civicB) {
      return {
        match: true,
        reason: `civic_project_anchor_window:anchor=${civicA},dayDelta=${dayDelta}`,
      };
    }
  }

  return { match: false, reason: `no_match:j=${jac.toFixed(2)}` };
}

/**
 * Prefer a cluster member with a usable publisher URL; then higher source tier; then first.
 * @param {object[]} members
 * @param {number[]} idxs
 */
export function pickRepresentativeIndex(members, idxs) {
  const tierRank = { official: 0, reputable: 1, lead: 2 };
  let best = idxs[0];
  let bestScore = -Infinity;
  // members is parallel to idxs (clusterCandidates maps idxs → members in order).
  for (let i = 0; i < idxs.length; i++) {
    const m = members[i];
    const usable = m.urlUsable !== false && m.canonicalUrl && !/google\.com\/goto/i.test(m.url || '');
    const tier = tierRank[m.sourceTier] ?? 3;
    // Score: usable URL dominates, then tier, then prefer non-empty publisher domain
    let s = 0;
    if (usable) s += 100;
    s += (3 - Math.min(tier, 3)) * 10;
    if (m.publisherDomain || publisherDomain(m.canonicalUrl || m.url || '')) s += 1;
    // Stable preference for earlier index on ties
    s -= i * 0.001;
    if (s > bestScore) {
      bestScore = s;
      best = idxs[i];
    }
  }
  return best;
}

/**
 * Distinct publisher domains within a cluster (corroboration signal).
 * @param {object[]} members
 */
export function countIndependentPublishers(members) {
  const domains = new Set();
  for (const m of members) {
    const d =
      m.publisherDomain ||
      publisherDomain(m.urlUsable === false ? '' : m.canonicalUrl || m.url || '');
    if (d) domains.add(d);
  }
  return domains.size;
}

/**
 * Cluster candidates. Returns clusters with member indexes.
 * independentSourceCount is PUBLISHER-domain count (not sourceId / query config count).
 * @param {object[]} candidates
 */
export function clusterCandidates(candidates, opts = {}) {
  const items = Array.isArray(candidates) ? candidates : [];
  const parent = items.map((_, i) => i);

  function find(i) {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    let y = i;
    while (parent[y] !== y) {
      const p = parent[y];
      parent[y] = x;
      y = p;
    }
    return x;
  }
  function union(i, j) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const r = sameStory(items[i], items[j], opts);
      if (r.match) union(i, j);
    }
  }

  /** @type {Map<number, number[]>} */
  const groups = new Map();
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }

  const clusters = [];
  let n = 0;
  for (const idxs of groups.values()) {
    n += 1;
    const members = idxs.map((i) => items[i]);
    const sourceIds = [...new Set(members.map((m) => m.sourceId).filter(Boolean))];
    const independentPublisherCount = countIndependentPublishers(members);
    const clusterId = `c${String(n).padStart(4, '0')}`;
    const hasUsableUrl = members.some(
      (m) => m.urlUsable !== false && m.canonicalUrl && !/google\.com\/goto/i.test(m.url || ''),
    );
    const representativeIndex = pickRepresentativeIndex(members, idxs);
    clusters.push({
      clusterId,
      memberIndexes: idxs,
      members,
      sourceIds,
      // Publisher domains — NOT sourceIds. Kept under historical key for run.mjs.
      independentSourceCount: Math.max(1, independentPublisherCount),
      independentPublisherCount: Math.max(1, independentPublisherCount),
      clusterHasUsableUrl: hasUsableUrl,
      representativeIndex,
    });
  }

  return clusters;
}

/**
 * Extract coverage topics present in text.
 * @param {string} text
 * @returns {string[]} topic ids
 */
export function extractCoverageTopics(text) {
  const lower = String(text || '').toLowerCase();
  const hits = [];
  for (const topic of COVERAGE_TOPICS) {
    if (topic.phrases.some((p) => lower.includes(p))) hits.push(topic.id);
  }
  // Matchup framing at BMO/LV/Exhibition is World Cup coverage even without the words.
  if (
    !hits.includes('world-cup') &&
    /\bvs\.?\b/.test(lower) &&
    (/\bbmo field\b/.test(lower) ||
      /\bliberty village\b/.test(lower) ||
      /\bexhibition place\b/.test(lower))
  ) {
    hits.push('world-cup');
  }
  return hits;
}

/**
 * Extract reader-need angles present in text.
 * @param {string} text
 * @returns {string[]}
 */
export function extractCoverageAngles(text) {
  const lower = String(text || '').toLowerCase();
  const hits = [];
  for (const angle of COVERAGE_ANGLES) {
    if (angle.phrases.some((p) => lower.includes(p))) hits.push(angle.id);
  }
  return hits;
}

/**
 * True when publishedAt is exact and recent enough to trust relative-time novelty.
 * @param {{ dateConfidence?: string, publishedAt?: string|null }} dateInfo
 * @param {number} nowMs
 * @param {number} maxAgeHours
 */
export function isTrustedRecentDate(
  dateInfo = {},
  nowMs = Date.now(),
  maxAgeHours = COVERAGE_CONFIG.relativeNoveltyMaxAgeHours,
) {
  const confidence =
    dateInfo.dateConfidence || (dateInfo.publishedAt ? 'exact' : 'unknown');
  if (confidence !== 'exact') return false;
  if (!dateInfo.publishedAt) return false;
  const t = Date.parse(dateInfo.publishedAt);
  if (Number.isNaN(t)) return false;
  const ageHours = Math.max(0, (nowMs - t) / 3_600_000);
  return ageHours <= maxAgeHours;
}

/**
 * Civic/adversarial parties that appear in "X vs Y" phrasing but are not fixtures.
 * Single shared definition — imported by score.mjs (no cycle: score→dedupe only).
 * Kept small and positive-exclusion so real team matchups still count.
 */
export const NON_SPORT_VS_PARTIES = Object.freeze(
  new Set([
    'resident',
    'residents',
    'community',
    'neighbour',
    'neighbours',
    'neighbor',
    'neighbors',
    'neighbourhood',
    'neighborhood',
    'city',
    'council',
    'developer',
    'developers',
    'province',
    'police',
    'tenant',
    'tenants',
    'landlord',
    'landlords',
    'advocate',
    'advocates',
    'critic',
    'critics',
    'union',
    'workers',
    'owner',
    'owners',
    'homeowner',
    'homeowners',
    'business',
    'businesses',
    'officials',
    'mayor',
  ]),
);

/**
 * True when text contains a sporting-style "Team vs Team" matchup, not civic
 * adversarial phrasing like "residents vs developer".
 * @param {string} text
 */
export function hasSportingMatchup(text) {
  const raw = String(text || '');
  const re = /\b([a-z]{3,})\s+vs\.?\s+([a-z]{3,})\b/gi;
  let m;
  while ((m = re.exec(raw))) {
    const left = m[1].toLowerCase();
    const right = m[2].toLowerCase();
    if (NON_SPORT_VS_PARTIES.has(left) || NON_SPORT_VS_PARTIES.has(right)) continue;
    return true;
  }
  return false;
}

/**
 * Distinctive LV-core street addresses ("34 hanna", "58 atlantic avenue").
 * Used for local-scope checks and clustering — not as a standalone coverage key.
 * King Street requires an explicit street designator so TTC route copy like
 * "504 King streetcar" is not treated as a civic address key.
 * @param {string} text
 * @returns {string[]}
 */
export function extractAddressKeys(text) {
  const lower = String(text || '').toLowerCase();
  const keys = new Set();
  const re =
    /\b(\d{1,5})\s+(east\s+liberty|lynn\s+williams|western\s+battery|hanna|atlantic|liberty|jefferson|mowat|fraser|pirandello|ordnance|king)(?:\s+(ave(?:nue)?|st(?:reet)?|rd|road|blvd|boulevard))?\b/g;
  let m;
  while ((m = re.exec(lower))) {
    const num = m[1];
    const street = m[2].replace(/\s+/g, ' ').trim();
    const suffix = (m[3] || '').toLowerCase();
    // "504 King streetcar" / "504 King service" must not become address keys.
    if (street === 'king' && !suffix) continue;
    if (street === 'king' && suffix && !/^(?:st|street|ave|avenue|rd|road)$/.test(suffix)) {
      continue;
    }
    keys.add(`${num} ${street}`);
  }
  return [...keys].sort();
}

/**
 * New-development signal ids present in `candText` and absent from `postText`.
 * Relative-time signals (tonight/today, X vs Y matchup) only count when the
 * candidate carries an exact, recent publishedAt — they say nothing about
 * novelty on their own and fire hardest on stale previews.
 * @param {string} candText
 * @param {string} postText
 * @param {object} [opts]
 * @returns {string[]}
 */
export function extractNewDevelopmentSignals(candText, postText, opts = {}) {
  const cand = String(candText || '');
  const post = String(postText || '');
  const nowMs = opts.nowMs ?? Date.now();
  const maxAgeHours =
    opts.relativeNoveltyMaxAgeHours ?? COVERAGE_CONFIG.relativeNoveltyMaxAgeHours;
  const relativeIds = new Set(
    opts.relativeNoveltySignalIds || COVERAGE_CONFIG.relativeNoveltySignalIds,
  );
  const trustedRecent = isTrustedRecentDate(
    {
      dateConfidence: opts.dateConfidence,
      publishedAt: opts.publishedAt,
    },
    nowMs,
    maxAgeHours,
  );
  const hits = [];
  for (const p of NEW_DEVELOPMENT_PATTERNS) {
    const inCand = p.re ? p.re.test(cand) : p.test ? p.test(cand) : false;
    if (!inCand) continue;
    const inPost = p.re ? p.re.test(post) : p.test ? p.test(post) : false;
    if (inPost) continue;
    if (relativeIds.has(p.id) && !trustedRecent) continue;
    hits.push(p.id);
  }
  return hits;
}

/**
 * @param {string|null|undefined} candIso
 * @param {string|null|undefined} postIso
 * @param {number} minDays
 */
export function isMateriallyNewer(candIso, postIso, minDays = COVERAGE_CONFIG.newerPublishDays) {
  if (!candIso || !postIso) return false;
  const c = Date.parse(candIso);
  const p = Date.parse(postIso);
  if (Number.isNaN(c) || Number.isNaN(p)) return false;
  return c - p >= minDays * 86_400_000;
}

function emptyCoverage() {
  return {
    coverageRelation: 'new',
    alreadyCovered: false,
    matchingSlug: null,
    relatedPostSlug: null,
    matchSource: null,
    reason: null,
    coverageReason: null,
  };
}

function finalizeCoverage(hit) {
  if (!hit) return emptyCoverage();
  const relation = hit.coverageRelation;
  return {
    coverageRelation: relation,
    alreadyCovered: relation === 'duplicate',
    matchingSlug: hit.matchingSlug,
    relatedPostSlug: hit.matchingSlug,
    matchSource: hit.matchSource || null,
    reason: hit.reason,
    coverageReason: hit.reason,
  };
}

/**
 * Rank: duplicate beats follow-up; within a relation prefer higher strength.
 * @param {object|null} best
 * @param {object} next
 */
function preferCoverageHit(best, next) {
  if (!best) return next;
  const rank = { duplicate: 2, 'follow-up': 1, new: 0 };
  const br = rank[best.coverageRelation] ?? 0;
  const nr = rank[next.coverageRelation] ?? 0;
  if (nr > br) return next;
  if (nr < br) return best;
  if ((next.strength || 0) > (best.strength || 0)) return next;
  return best;
}

/**
 * Build a once-per-run coverage index over published posts.
 * Topics/addresses for match decisions come from title/slug/tags only.
 * Full post text (including body) is kept solely for angle/new-development
 * comparison after a title/slug/tag topic hit — never as a standalone match source.
 * @param {{slug?:string,title?:string,tags?:string[],publishedAt?:string,description?:string,body?:string}[]} posts
 */
export function buildCoverageIndex(posts) {
  const list = Array.isArray(posts) ? posts : [];
  return list.filter(Boolean).map((post) => {
    const slug = post.slug || '';
    const title = post.title || '';
    const tags = Array.isArray(post.tags) ? post.tags : [];
    const description = post.description || '';
    const body = post.body || '';
    const coreText = [title, slug.replace(/-/g, ' ')].join(' ');
    const tagText = tags.join(' ');
    const coreTopics = new Set(extractCoverageTopics(coreText));
    const tagTopics = new Set(extractCoverageTopics(tagText));
    // Drop topics already grounded in title/slug so source is explicit.
    for (const t of coreTopics) {
      tagTopics.delete(t);
    }
    const coreAddressKeys = new Set(extractAddressKeys(coreText));
    // Body retained for angle extraction / local-scope checks only.
    const bodyText = [description, body].join(' ');
    const postText = [coreText, tagText, description, body].join(' ');
    return {
      post,
      slug,
      title,
      tags,
      coreTopics,
      tagTopics,
      coreAddressKeys,
      bodyText,
      postText,
    };
  });
}

/**
 * Classify candidate against one indexed published post.
 * Coverage topics come from title/slug/tags only. Body text may refine the
 * angle once a title/slug/tag topic already matches; it never starts a match.
 * @returns {object|null}
 */
function classifyAgainstPost(candidate, indexed, config) {
  const post = indexed.post;
  const slug = indexed.slug || '';
  const title = indexed.title || '';
  const tags = indexed.tags || [];
  const candTitle = String(candidate?.title || '');
  const candUrl = (candidate?.canonicalUrl || candidate?.url || '').toLowerCase();
  const candText = [
    candTitle,
    candidate?.snippet || '',
    candidate?.rawTextSample || '',
  ].join(' ');
  const postText = indexed.postText;
  const nowMs = config.nowMs ?? Date.now();

  if (candUrl && slug && candUrl.includes(slug.toLowerCase())) {
    return {
      coverageRelation: 'duplicate',
      matchingSlug: slug,
      matchSource: 'url',
      reason: `duplicate of ${slug}: same URL/slug (match via url)`,
      strength: 1.0,
    };
  }

  const jac = jaccard(normalizeTitleTokens(candTitle), normalizeTitleTokens(title));
  if (jac >= config.titleJaccardDuplicate) {
    return {
      coverageRelation: 'duplicate',
      matchingSlug: slug,
      matchSource: 'title',
      reason: `duplicate of ${slug}: near-identical title (jaccard ${jac.toFixed(2)}; match via title)`,
      strength: jac,
    };
  }

  const candTopics = new Set(extractCoverageTopics(candText));
  // Addresses are only used for local-scope checks, never as a body-coverage key.
  const titleAddresses = extractAddressKeys(candTitle);
  const snippetAddresses = extractAddressKeys(
    [candidate?.snippet || '', candidate?.rawTextSample || ''].join(' '),
  );
  const candAddresses = titleAddresses.length
    ? titleAddresses
    : isCkanDevApp(candidate)
      ? []
      : snippetAddresses;

  /** @type {string|null} */
  let sharedTopic = null;
  /** @type {'title-slug'|'tag'|null} */
  let topicSource = null;

  for (const t of candTopics) {
    if (indexed.coreTopics.has(t)) {
      sharedTopic = t;
      topicSource = 'title-slug';
      break;
    }
  }
  if (!sharedTopic) {
    for (const t of candTopics) {
      if (indexed.tagTopics.has(t)) {
        sharedTopic = t;
        topicSource = 'tag';
        break;
      }
    }
  }

  const ct = candTitle.toLowerCase();
  const pt = title.toLowerCase();
  const slugL = slug.toLowerCase();
  const candLocal =
    /\bliberty village\b|liberty-village|\bm6k\b/.test(ct) ||
    /\bliberty village\b/.test(String(candidate?.snippet || '').toLowerCase()) ||
    candAddresses.length > 0;
  const postLocal =
    /\bliberty village\b|liberty-village/.test(pt) ||
    slugL.includes('liberty-village') ||
    tags.some((t) => /liberty/i.test(String(t))) ||
    /\bliberty village\b/i.test(indexed.bodyText || '');

  if (sharedTopic && topicSource) {
    const topicInScope =
      candLocal ||
      postLocal ||
      sharedTopic === 'ontario-line' ||
      sharedTopic === 'carpet-factory';
    if (topicInScope) {
      const candAngles = extractCoverageAngles(candText);
      const postAngles = extractCoverageAngles(postText);
      const sharedAngles = candAngles.filter((a) => postAngles.includes(a));
      // match-day angle often rides only on tonight/today/vs — treat it as a
      // novelty angle only when the candidate date is exact + recent.
      const trustedRecent = isTrustedRecentDate(
        {
          dateConfidence: candidate?.dateConfidence,
          publishedAt: candidate?.publishedAt,
        },
        nowMs,
        config.relativeNoveltyMaxAgeHours ?? COVERAGE_CONFIG.relativeNoveltyMaxAgeHours,
      );
      const onlyCandAngles = candAngles.filter((a) => {
        if (postAngles.includes(a)) return false;
        if (a === 'match-day' && !trustedRecent) return false;
        return true;
      });
      const newSignals = extractNewDevelopmentSignals(candText, postText, {
        dateConfidence: candidate?.dateConfidence,
        publishedAt: candidate?.publishedAt,
        nowMs,
        relativeNoveltyMaxAgeHours: config.relativeNoveltyMaxAgeHours,
        relativeNoveltySignalIds: config.relativeNoveltySignalIds,
      });
      const newer = isMateriallyNewer(
        candidate?.publishedAt,
        post.publishedAt,
        config.newerPublishDays,
      );

      // Distinct reader-need angle or a concrete new-development signal is
      // required. Publish-date recency alone must NOT flip a same-topic rehash
      // into follow-up (a months-later restatement is still a rehash).
      const hasNewDevelopment = onlyCandAngles.length > 0 || newSignals.length > 0;

      // Title/slug outranks tags.
      const sourceBonus = topicSource === 'title-slug' ? 0.35 : 0.12;
      const matchVia = `match via ${topicSource}`;

      if (!hasNewDevelopment) {
        // Same topic, same reader need, no new fact → rehash.
        return {
          coverageRelation: 'duplicate',
          matchingSlug: slug,
          matchSource: topicSource,
          reason: `duplicate of ${slug}: same topic (${sharedTopic}) and angle without new development (${matchVia})`,
          strength: Math.max(jac, 0.55) + sourceBonus,
        };
      }

      // Soft title collision with shared angle can still be a rehash even if a
      // weak temporal token appears — require either a distinct angle or a
      // strong signal / clear title divergence.
      if (
        jac >= config.titleJaccardSoftDuplicate &&
        sharedAngles.length > 0 &&
        onlyCandAngles.length === 0 &&
        newSignals.length === 0
      ) {
        return {
          coverageRelation: 'duplicate',
          matchingSlug: slug,
          matchSource: topicSource,
          reason: `duplicate of ${slug}: soft title overlap on ${sharedTopic} (${sharedAngles.join(',')}; ${matchVia})`,
          strength: jac + sourceBonus,
        };
      }

      const why = [];
      if (onlyCandAngles.length) why.push(`new angle: ${onlyCandAngles.join(', ')}`);
      if (newSignals.length) why.push(`new development: ${newSignals.join(', ')}`);
      if (newer) why.push(`materially newer than post (${post.publishedAt})`);
      // Prefer linking a follow-up to the prior post that already owns the closest
      // angle when the candidate adds new signals on top of it (e.g. match-night
      // closures → road-closures guide, not a dining guide).
      const sameAngleBonus =
        newSignals.length > 0 && sharedAngles.length > 0 ? sharedAngles.length * 0.15 : 0;
      return {
        coverageRelation: 'follow-up',
        matchingSlug: slug,
        matchSource: topicSource,
        reason: `follow-up to ${slug} on ${sharedTopic} — ${why.join('; ')} (${matchVia})`,
        strength:
          0.4 +
          sourceBonus +
          Math.min(0.4, (onlyCandAngles.length + newSignals.length) * 0.1) +
          sameAngleBonus +
          (newer ? 0.1 : 0),
      };
    }
  }

  // Shared LV title without a primary topic still catches near-rehashes.
  if (ct && pt && ct.includes('liberty village') && pt.includes('liberty village')) {
    if (jac >= config.lvTitleJaccardDuplicate) {
      return {
        coverageRelation: 'duplicate',
        matchingSlug: slug,
        matchSource: 'title',
        reason: `duplicate of ${slug}: Liberty Village title overlap (jaccard ${jac.toFixed(2)}; match via title)`,
        strength: jac,
      };
    }
  }

  return null;
}

/**
 * Read-only graded match against published posts.
 * Returns coverageRelation: duplicate | follow-up | new.
 * @param {object} candidate
 * @param {{slug:string,title:string,tags?:string[],publishedAt?:string,description?:string,body?:string}[]} posts
 * @param {object} [opts]
 */
export function matchExistingPost(candidate, posts, opts = {}) {
  const config = {
    ...COVERAGE_CONFIG,
    ...(opts.config || {}),
    nowMs: opts.nowMs ?? opts.config?.nowMs ?? Date.now(),
  };
  const index = opts.coverageIndex || buildCoverageIndex(Array.isArray(posts) ? posts : []);

  let best = null;
  for (const indexed of index) {
    const hit = classifyAgainstPost(candidate, indexed, config);
    if (hit) best = preferCoverageHit(best, hit);
  }
  return finalizeCoverage(best);
}

/**
 * Attach cluster metadata + graded coverage relation.
 * @param {object[]} candidates
 * @param {{slug:string,title:string,tags?:string[],publishedAt?:string,description?:string}[]} posts
 */
export function dedupeAndMarkCovered(candidates, posts, opts = {}) {
  const clusters = clusterCandidates(candidates, opts);
  /** Build body/title topic index once per run — not per candidate. */
  const coverageIndex = opts.coverageIndex || buildCoverageIndex(posts);
  /** nowMs must reach matchExistingPost so relative novelty gating is deterministic. */
  const coverageOpts = {
    ...opts,
    coverageIndex,
    nowMs: opts.nowMs ?? Date.now(),
  };
  /** @type {Map<string, object>} */
  const byId = new Map();

  for (const cluster of clusters) {
    const repMember = candidates[cluster.representativeIndex];
    for (const member of cluster.members) {
      const covered = matchExistingPost(member, posts, coverageOpts);
      const domain =
        member.publisherDomain ||
        publisherDomain(member.urlUsable === false ? '' : member.canonicalUrl || member.url || '');
      byId.set(member.id, {
        ...member,
        publisherDomain: domain,
        clusterId: cluster.clusterId,
        independentSourceCount: cluster.independentSourceCount,
        independentPublisherCount: cluster.independentPublisherCount,
        clusterSourceIds: cluster.sourceIds,
        clusterHasUsableUrl: cluster.clusterHasUsableUrl,
        isClusterRepresentative: member.id === repMember?.id,
        coverageRelation: covered.coverageRelation,
        alreadyCovered: covered.alreadyCovered,
        matchingSlug: covered.matchingSlug,
        relatedPostSlug: covered.relatedPostSlug,
        matchSource: covered.matchSource,
        coverageReason: covered.coverageReason,
      });
    }
  }

  // Preserve input order
  return {
    clusters,
    coverageIndex,
    candidates: candidates.map((c) => byId.get(c.id)).filter(Boolean),
  };
}

/**
 * Normalize posts.json shape to a read-only coverage index.
 * Body (`content`) is loaded for angle comparison after title/slug/tag matches
 * only — never written back, never used as a standalone coverage source.
 * @param {unknown} postsJson
 */
export function extractPostIndex(postsJson) {
  const arr = Array.isArray(postsJson) ? postsJson : [];
  return arr
    .map((p) => ({
      slug: String(p?.slug || ''),
      title: String(p?.title || ''),
      tags: Array.isArray(p?.tags) ? p.tags.map((t) => String(t)) : [],
      publishedAt: p?.publishedAt ? String(p.publishedAt) : null,
      description: p?.description ? String(p.description) : '',
      // Full post body for angle checks only (never written back).
      body: p?.content ? String(p.content) : p?.body ? String(p.body) : '',
    }))
    .filter((p) => p.slug || p.title);
}
