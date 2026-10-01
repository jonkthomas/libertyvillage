/**
 * News discovery pilot — source registry.
 *
 * Only sources verified live during pilot setup are enabled.
 * Unreachable or blocked candidates are listed at the bottom with enabled:false
 * and a short note so the next run does not re-guess dead URLs.
 */

import fs from 'node:fs';

/** @typedef {'official' | 'reputable' | 'lead'} SourceTier */
/** @typedef {'rss' | 'json' | 'serper' | 'serpapi'} SourceType */

/**
 * @typedef {object} NewsSource
 * @property {string} id
 * @property {string} label
 * @property {SourceTier} tier
 * @property {SourceType} type
 * @property {boolean} enabled
 * @property {string} [url]
 * @property {string} [query]
 * @property {number} [num]
 * @property {object} [ckan]
 * @property {string} [note]
 */

/** Curated Serper / SerpApi query set for Liberty Village adjacency. */
export const SEARCH_QUERIES = Object.freeze([
  {
    id: 'q-liberty-village',
    query: 'Liberty Village Toronto',
    label: 'Liberty Village core',
  },
  {
    id: 'q-lv-development',
    query: 'Liberty Village Toronto development OR construction OR tower OR condo',
    label: 'LV development/construction',
  },
  {
    id: 'q-lv-ttc',
    query: 'Liberty Village Toronto TTC OR streetcar OR "King streetcar" OR transit',
    label: 'LV transit',
  },
  {
    id: 'q-exhibition-place',
    query: 'Exhibition Place Toronto OR "Canadian National Exhibition" OR CNE OR "Enercare Centre"',
    label: 'Exhibition Place',
  },
  {
    id: 'q-king-west-adjacent',
    query: '"King West" OR "King Street West" "Liberty Village" OR Dufferin Toronto construction OR closure',
    label: 'King West adjacency',
  },
  {
    id: 'q-lv-landmarks',
    query:
      '"Lamport Stadium" OR "East Liberty Street" OR "Hanna Avenue" OR "Atlantic Avenue" OR "Toy Factory Lofts" Toronto',
    label: 'Named local landmarks',
  },
]);

/**
 * CKAN Development Applications resource (verified datastore_active).
 *
 * Fanout is intentionally narrow: LV-core short streets + one M6K postal query.
 * Long corridors (Dufferin/Strachan/Brock/Lisgar) are NOT queried unbound — they
 * pull applications far outside the neighbourhood. Corridor hits may still arrive
 * via the M6K postal filter and are post-filtered in fetch.mjs.
 */
export const CKAN_DEV_APPS = Object.freeze({
  packageName: 'development-applications',
  resourceId: '8907d8ed-c515-4ce9-b674-9f8c6eefcf0d',
  endpoint: 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search',
  // Short LV-core streets only (uppercase, no type suffix as stored in CKAN).
  // Streets west of Dufferin (CLOSE, BROCK, LISGAR) are Parkdale/Brockton, not
  // Liberty Village, and must not appear here — they manufacture false positives.
  streetNames: Object.freeze([
    'HANNA',
    'ATLANTIC',
    'LIBERTY',
    'JEFFERSON',
    'MOWAT',
    'FRASER',
    'PIRANDELLO',
    'ORDNANCE',
    'EAST LIBERTY',
    'LYNN WILLIAMS',
    'WESTERN BATTERY',
  ]),
  postalPrefixes: Object.freeze(['M6K']),
  /** Corridor streets allowed only when postal is M6K (applied in post-filter). */
  corridorStreets: Object.freeze(['DUFFERIN', 'STRACHAN', 'KING']),
  /**
   * King St W numbering rises westward; Strachan is ~900 and Dufferin ~1150.
   * Above this, addresses are Parkdale/Brockton rather than Liberty Village.
   */
  kingStWestMaxNumber: 1150,
  limitPerFilter: 20,
  /**
   * Drop decade-old applications. Dev apps are weeks–months old, not years.
   * Still wider than the general --since-hours news window.
   */
  maxAgeDays: 180,
});

/** @type {NewsSource[]} */
export const SOURCES = [
  {
    id: 'toronto-ca-feed',
    label: 'City of Toronto WordPress feed',
    tier: 'official',
    type: 'rss',
    url: 'https://www.toronto.ca/feed/',
    enabled: true,
    note: 'Responds 200 RSS; channel often empty of <item> entries.',
  },
  {
    id: 'ckan-dev-apps-lv',
    label: 'Toronto Open Data — Development Applications (LV streets/M6K)',
    tier: 'official',
    type: 'json',
    url: CKAN_DEV_APPS.endpoint,
    ckan: CKAN_DEV_APPS,
    enabled: true,
  },
  {
    id: 'exhibition-place-rss',
    label: 'Exhibition Place news',
    tier: 'official',
    type: 'rss',
    url: 'https://www.explace.on.ca/feed/',
    enabled: true,
  },
  {
    id: 'cbc-toronto-rss',
    label: 'CBC Toronto RSS',
    tier: 'reputable',
    type: 'rss',
    url: 'https://www.cbc.ca/webfeed/rss/rss-canada-toronto',
    enabled: true,
  },
  {
    id: 'global-toronto-rss',
    label: 'Global News Toronto RSS',
    tier: 'reputable',
    type: 'rss',
    url: 'https://globalnews.ca/toronto/feed/',
    enabled: true,
  },
  {
    id: 'star-lv-search-rss',
    label: 'Toronto Star search RSS — Liberty Village',
    tier: 'reputable',
    type: 'rss',
    url: 'https://www.thestar.com/search/?f=rss&t=article&l=30&s=start_time&sd=desc&k=%22liberty%20village%22',
    enabled: true,
  },
  // Serper news — one source entry per query
  ...SEARCH_QUERIES.map((q) => ({
    id: `serper-${q.id}`,
    label: `Serper News — ${q.label}`,
    tier: /** @type {SourceTier} */ ('lead'),
    type: /** @type {SourceType} */ ('serper'),
    query: q.query,
    num: 10,
    enabled: true,
  })),
  // SerpApi google_news secondary — core + development only (cap spend/requests)
  ...SEARCH_QUERIES.filter((q) =>
    ['q-liberty-village', 'q-lv-development', 'q-lv-ttc'].includes(q.id),
  ).map((q) => ({
    id: `serpapi-${q.id}`,
    label: `SerpApi Google News — ${q.label}`,
    tier: /** @type {SourceTier} */ ('lead'),
    type: /** @type {SourceType} */ ('serpapi'),
    query: q.query,
    num: 10,
    enabled: true,
  })),

  // --- verified dead / blocked (kept disabled, do not re-enable without re-probe) ---
  {
    id: 'ttc-alerts-live',
    label: 'TTC live alerts API',
    tier: 'official',
    type: 'json',
    url: 'https://alerts.ttc.ca/api/alerts/live',
    enabled: false,
    note: 'HTTP 404 as of pilot setup; documented path no longer serves JSON.',
  },
  {
    id: 'toronto-nm-opendata',
    label: 'City newsroom opendata.do',
    tier: 'official',
    type: 'json',
    url: 'https://secure.toronto.ca/nm/opendata.do',
    enabled: false,
    note: 'HTTP 403 Akamai Access Denied from this environment.',
  },
  {
    id: 'toronto-newsroom-rss',
    label: 'City newsroom rssNews.do',
    tier: 'official',
    type: 'rss',
    url: 'https://secure.toronto.ca/newsroom/rssNews.do',
    enabled: false,
    note: 'HTTP 403 Akamai Access Denied.',
  },
];

export function listEnabledSources({ maxSources } = {}) {
  const enabled = SOURCES.filter((s) => s.enabled);
  if (maxSources != null && Number.isFinite(maxSources) && maxSources >= 0) {
    return enabled.slice(0, maxSources);
  }
  return enabled;
}

// ---------------------------------------------------------------------------
// Weekly roundup v2 registry (docs/specs/weekly-roundup-v2.md §4). Separate from
// the daily-news SOURCES above, which are unchanged. Tiers here are the only
// tier authority for roundup evidence: Serper, queries and model output never
// assign or raise one (§6.7). Changed only by reviewed PR.
// ---------------------------------------------------------------------------

/** @typedef {'venue'|'road-feed'|'project'|'org'|'transit-feed'|'news-discovery'|'ig'} RoundupIdentityKind */
/** @typedef {'jsonld-event'|'html-listing'|'json-feed'|'html-page'|'serper-news'|'ig-post'} RoundupParse */

/**
 * @typedef {object} RoundupSource
 * @property {string} id
 * @property {string} label
 * @property {RoundupIdentityKind} identityKind
 * @property {string|null} identityId
 * @property {string} url
 * @property {RoundupParse} parse
 * @property {{row: string, title?: string, date?: string, time?: string, building?: string}|null} [recordSelector]
 * @property {'official'|'primary'|null} tier
 * @property {'core'|'adjacent'|null} [locality]
 * @property {string[]} officialDomains
 * @property {string[]} [venueAliases]
 * @property {number} minIntervalMs
 * @property {boolean} enabled
 * @property {boolean} [feed]
 * @property {boolean} [listing]
 * @property {boolean} [snapshot]
 * @property {string} note
 */

const PROBE_2026_09_29 = 'Re-probed 2026-09-29 by the roundup collector builder';

/** Fixed Serper `/news` query set (§4.2). Recall only; admission is §6. */
export const ROUNDUP_SERPER_QUERIES = Object.freeze([
  '"Liberty Village" Toronto',
  '"Exhibition Place" Toronto',
  '"BMO Field"',
  '"Coca-Cola Coliseum"',
  '"Enercare Centre"',
  '"Lamport Stadium"',
  '"Ontario Line" Exhibition',
  '"Hanna Avenue" OR "Atlantic Avenue" OR "Jefferson Avenue" OR "East Liberty Street" Toronto',
]);

/** TTC routes watched for LV (§4.1). Stop allowlists live in roundup-geo.mjs. */
export const ROUNDUP_TTC_ROUTES = Object.freeze(['504', '29', '509', '511', '63']);

/**
 * Road-restriction recall filter, used only when roundup-geo.mjs is not loadable.
 * A feed record becomes a signal when its `road` is an LV-interior street, or a
 * frontage road whose from/to/at street is one of that road's LV cross streets.
 * This only bounds the reasoner batch; locality is decided solely by the
 * generated segment table in roundup-geo.mjs (§6.2).
 */
export const ROUNDUP_ROAD_LEAD_STREETS = Object.freeze([
  'Hanna Ave', 'Atlantic Ave', 'Liberty St', 'East Liberty St', 'Jefferson Ave', 'Mowat Ave', 'Fraser Ave',
  'Pirandello St', 'Snooker St', 'Lynn Williams St', 'Western Battery Rd', "Princes' Blvd", 'Princes Blvd',
  'Manitoba Dr', 'Nunavut Rd', 'Saskatchewan Rd', 'British Columbia Rd', 'Ontario Dr', 'Remembrance Dr',
  'Newfoundland Rd', 'Canada Blvd', 'Stadium Rd', 'Exhibition Pl',
]);

export const ROUNDUP_ROAD_FRONTAGE = Object.freeze({
  'King St W': ['Strachan Ave', 'Shaw St', 'Crawford St', 'Atlantic Ave', 'Joe Shuster Way', 'Fraser Ave', 'Mowat Ave',
    'Jefferson Ave', 'Pardee Ave', 'Hanna Ave', 'Dufferin St'],
  'Strachan Ave': ['King St W', 'East Liberty St', 'Liberty St', 'Fleet St', 'Manitoba Dr', 'Lake Shore Blvd W', "Princes' Blvd", 'Princes Blvd'],
  'Dufferin St': ['King St W', 'Liberty St', 'East Liberty St', 'Springhurst Ave', 'Saskatchewan Rd', 'Lake Shore Blvd W'],
  'Lake Shore Blvd W': ['Strachan Ave', 'British Columbia Rd', 'Ontario Dr', 'Newfoundland Rd', 'Remembrance Dr', 'Dufferin St', "Princes' Blvd", 'Princes Blvd'],
});

/** Watched City LV project pages (§4.1 rv2-city-projects). */
export const ROUNDUP_CITY_PROJECT_PAGES = Object.freeze([
  { id: '34-hanna-park', label: 'New park at 34 Hanna Avenue',
    url: 'https://www.toronto.ca/city-government/planning-development/construction-new-facilities/park-facility-projects/new-park-at-34-hanna-avenue/' },
  { id: 'liberty-st', label: 'Liberty Street pedestrian improvements',
    url: 'https://www.toronto.ca/services-payments/streets-parking-transportation/cycling-in-toronto/cycling-pedestrian-public-consultations/liberty-street-pedestrian-improvements/' },
  { id: 'liberty-for-all', label: 'Liberty For All',
    url: 'https://www.toronto.ca/city-government/planning-development/planning-studies-initiatives/liberty-for-all/' },
]);

/** Syndication partner domains (§6.4). */
export const SYNDICATION_PARTNERS = Object.freeze([
  'toronto.com', 'durhamregion.com', 'insidehalton.com', 'mississauga.com', 'hamiltonnews.com',
  'thespec.com', 'therecord.com', 'niagarafallsreview.ca', 'stcatharinesstandard.ca', 'wellandtribune.ca',
  'yorkregion.com', 'bramptonguardian.com', 'guelphmercury.com', 'cambridgetimes.ca', 'newhamburgindependent.ca',
  'thepeterboroughexaminer.com', 'wellingtonadvertiser.com', 'kawarthalakesthisweek.com', 'northumberlandnews.com',
  'insidebelleville.com', 'barrietoday.com',
]);

const STATIC_PUBLISHER_TIERS = Object.freeze({
  // official: the organisation's own domain for its own events, services or statements.
  'toronto.ca': 'official', 'ttc.ca': 'official', 'metrolinx.com': 'official', 'explace.on.ca': 'official',
  'libertyvillagebia.com': 'official', 'bmofield.com': 'official', 'coca-colacoliseum.com': 'official',
  'rbcamphitheatre.com': 'official', 'canadasoccer.com': 'official', 'torontofc.ca': 'official',
  'argonauts.ca': 'official', 'thepwhl.com': 'official',
  // reputable: carried from the daily-news SOURCES tiers.
  'cbc.ca': 'reputable', 'globalnews.ca': 'reputable', 'thestar.com': 'reputable',
});

/**
 * Committed Instagram watch list (§4.4), read from data/ig-watch.json. The file is
 * owned and validated by the geography slice; a missing or unreadable file means
 * no Instagram sources (fail closed), never an invented list.
 * @returns {object[]}
 */
export function loadIgWatchList(file = new URL('./data/ig-watch.json', import.meta.url)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.filter((e) => e && typeof e.handle === 'string' && /^[a-z0-9._]{1,30}$/i.test(e.handle));
  } catch {
    return [];
  }
}

export const ROUNDUP_IG_WATCH = Object.freeze(loadIgWatchList().map((e) => Object.freeze({ ...e })));

/** Registrable domain (eTLD+1 with the common two-part suffixes). */
export function registrableDomain(urlOrHost) {
  let host = String(urlOrHost || '').toLowerCase();
  try {
    if (/^[a-z]+:\/\//.test(host)) host = new URL(host).hostname;
  } catch {
    return '';
  }
  host = host.replace(/\.$/, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const twoPart = /^(?:co|com|org|gov|ac|on|net)\.(?:uk|au|nz|jp|ca)$/.test(labels.slice(-2).join('.'));
  return labels.slice(-(twoPart ? 3 : 2)).join('.');
}

function ownDomainOf(entry) {
  const raw = entry?.ownDomain || entry?.verificationUrl || '';
  return raw ? registrableDomain(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw) : '';
}

/**
 * Publisher tiers by registrable domain (§4.1). `primary` comes only from the
 * committed watch list's ownDomain; it never overrides an official entry.
 */
export const ROUNDUP_PUBLISHER_TIERS = Object.freeze({
  ...Object.fromEntries(ROUNDUP_IG_WATCH.map(ownDomainOf).filter(Boolean).map((d) => [d, 'primary'])),
  ...STATIC_PUBLISHER_TIERS,
});

/** Tier for a discovered page: registry map or `lead`. */
export function roundupPublisherTier(url, tiers = ROUNDUP_PUBLISHER_TIERS) {
  return tiers[registrableDomain(url)] || 'lead';
}

const LISTING_BASE = Object.freeze({ tier: 'official', minIntervalMs: 2_000, enabled: true, listing: true, snapshot: true });

/** @type {ReadonlyArray<RoundupSource>} */
const STATIC_ROUNDUP_SOURCES = [
  {
    id: 'rv2-serper-news', label: 'Google News via Serper', identityKind: 'news-discovery', identityId: null,
    url: 'https://google.serper.dev/news', parse: 'serper-news', tier: null, locality: null, officialDomains: [],
    minIntervalMs: 2_000, enabled: true, maxQueries: 12,
    note: 'Leads only; the fetched page tier comes from ROUNDUP_PUBLISHER_TIERS. Needs SERPER_API_KEY.',
  },
  {
    ...LISTING_BASE, id: 'rv2-bmo-field', label: 'BMO Field', identityKind: 'venue', identityId: 'venue:bmo-field',
    url: 'https://www.bmofield.com/events', parse: 'html-listing', locality: 'adjacent',
    recordSelector: { row: '.eventItem', title: '.title', date: '.date', time: '.start' },
    officialDomains: ['bmofield.com'], venueAliases: ['BMO Field'],
    note: PROBE_2026_09_29 + ': HTTP 200, robots `User-agent: *` with no rules, rows `.eventItem` with `.date` "Oct 03" (yearless) + `.start` "3:00 PM".',
  },
  {
    ...LISTING_BASE, id: 'rv2-coliseum', label: 'Coca-Cola Coliseum', identityKind: 'venue', identityId: 'venue:coca-cola-coliseum',
    url: 'https://www.coca-colacoliseum.com/events', parse: 'html-listing', locality: 'adjacent',
    recordSelector: { row: '.m-venueframework-eventslist__item', title: '.m-eventItem__title', date: '.m-eventItem__date', time: '.m-eventItem__start' },
    officialDomains: ['coca-colacoliseum.com'], venueAliases: ['Coca-Cola Coliseum'],
    note: PROBE_2026_09_29 + ': HTTP 200, robots no rules, rows carry "Saturday | Oct 3, 2026" (year-bearing) + start time.',
  },
  {
    ...LISTING_BASE, id: 'rv2-explace', label: 'Exhibition Place', identityKind: 'venue', identityId: 'venue:exhibition-place',
    url: 'https://www.explace.on.ca/event/', parse: 'html-listing', locality: 'adjacent',
    recordSelector: { row: '.card-events', title: '.card-events__title', date: '.card-events__bottom-text span', building: '.card-events__bottom-text span:nth(1)' },
    officialDomains: ['explace.on.ca'],
    venueAliases: ['Exhibition Place', 'Enercare Centre', 'Beanfield Centre', 'Queen Elizabeth Building'],
    excludedBuildings: ['Hotel X'],
    note: PROBE_2026_09_29 + ': /events/ 301 → /event/ (registered at the final URL), HTTP 200, robots disallows only wp-admin/plugins/readme; rows "Oct 1 - Oct 2, 2026" + building.',
  },
  {
    ...LISTING_BASE, listing: false, id: 'rv2-rbc-amphitheatre', label: 'RBC Amphitheatre', identityKind: 'venue',
    identityId: 'venue:rbc-amphitheatre', url: 'https://www.rbcamphitheatre.com/shows', parse: 'jsonld-event', locality: 'adjacent',
    officialDomains: ['rbcamphitheatre.com'], venueAliases: ['RBC Amphitheatre', 'Budweiser Stage'],
    note: PROBE_2026_09_29 + ': HTTP 200, robots no rules, JSON-LD MusicEvent with offset startDate and location.name "RBC Amphitheatre".',
  },
  {
    id: 'rv2-road-restrictions', label: 'City of Toronto road restrictions v3', identityKind: 'road-feed', identityId: null,
    url: 'https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json', parse: 'json-feed', tier: 'official',
    locality: null, officialDomains: ['toronto.ca'], minIntervalMs: 2_000, enabled: true, feed: true, snapshot: true,
    note: PROBE_2026_09_29 + ': HTTP 200 JSON {Closure:[…]} (~3.4 MB, 2,308 active records), robots.txt 403 (RFC 9309 unavailable → no rules); epoch-ms startTime/endTime.',
  },
  {
    id: 'rv2-lv-bia-events', label: 'Liberty Village BIA events', identityKind: 'org', identityId: 'org:lv-bia',
    url: 'https://www.libertyvillagebia.com/events', parse: 'html-page', tier: 'official', locality: null,
    officialDomains: ['libertyvillagebia.com'], minIntervalMs: 2_000, enabled: true, snapshot: true,
    note: PROBE_2026_09_29 + ': HTTP 200, robots `*` disallows /config /search /account /api /static only; one heading per event section.',
  },
  ...ROUNDUP_CITY_PROJECT_PAGES.map((p) => ({
    id: 'rv2-city-project-' + p.id, label: p.label, identityKind: 'project', identityId: 'project:' + p.id,
    url: p.url, parse: 'html-page', tier: 'official', locality: null, officialDomains: ['toronto.ca'],
    minIntervalMs: 2_000, enabled: true, snapshot: true,
    note: PROBE_2026_09_29 + ': HTTP 200, www.toronto.ca robots `*` does not disallow this path; dated statements are year-bearing.',
  })),
  {
    id: 'rv2-ttc-alerts', label: 'TTC live alerts', identityKind: 'transit-feed', identityId: null,
    url: 'https://alerts.ttc.ca/api/alerts/live-alerts', parse: 'json-feed', tier: 'official', locality: null,
    officialDomains: ['ttc.ca'], minIntervalMs: 2_000, enabled: true, feed: true, snapshot: true, routes: ROUNDUP_TTC_ROUTES,
    note: PROBE_2026_09_29 + ': HTTP 200 JSON {routes:[…]} with id/route/stopStart/stopEnd/effect/activePeriod; robots.txt 404 (no rules).',
  },
];

/** One registry entry per watch-list account; tier `primary` applies only to its own event (§6.7). */
export function igWatchSources(watch = ROUNDUP_IG_WATCH) {
  return watch.map((e) => {
    const handle = e.handle.toLowerCase();
    return {
      id: 'ig:' + handle, label: e.business || handle, identityKind: 'ig', identityId: 'ig:' + handle, handle,
      url: `https://www.instagram.com/${handle}/`, parse: 'ig-post', tier: 'primary', locality: null,
      canonicalVenueId: e.canonicalVenueId || null, verifiedAddress: e.address || e.verifiedAddress || null,
      ownDomain: ownDomainOf(e) || null, multiLocation: e.multiLocation === true,
      requiresVenueInPost: e.requiresVenueInPost === true, provider: e.provider || 'apify',
      officialDomains: [], minIntervalMs: 0, enabled: e.enabled !== false,
      note: 'Instagram watch-list account; read only through ig-provider.mjs.',
    };
  });
}

/** @type {ReadonlyArray<RoundupSource>} */
export const ROUNDUP_SOURCES = Object.freeze([...STATIC_ROUNDUP_SOURCES, ...igWatchSources()].map((s) => Object.freeze(s)));

export function roundupSourceById(id, registry = ROUNDUP_SOURCES) {
  return registry.find((s) => s.id === id) || null;
}
