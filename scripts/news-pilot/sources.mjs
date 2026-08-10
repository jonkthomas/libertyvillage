/**
 * News discovery pilot — source registry.
 *
 * Only sources verified live during pilot setup are enabled.
 * Unreachable or blocked candidates are listed at the bottom with enabled:false
 * and a short note so the next run does not re-guess dead URLs.
 */

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
