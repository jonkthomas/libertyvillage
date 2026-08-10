/**
 * Normalize raw source payloads into uniform Candidate objects.
 * Pure-ish helpers are network-free and unit-testable.
 */

import { createHash } from 'node:crypto';

export const SNIPPET_MAX = 280;

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'spm',
  'cmp',
  'ocid',
  'ncid',
  'ref',
  'ref_src',
  's',
]);

/** Subdomains stripped before publisher-domain identity. */
const DROP_SUBDOMAINS = new Set([
  'www',
  'www2',
  'm',
  'mobile',
  'amp',
  'amp-cdn',
  'news',
  'edition',
]);

/**
 * @typedef {'exact' | 'approximate' | 'unknown'} DateConfidence
 */

/**
 * @typedef {object} Candidate
 * @property {string} id
 * @property {string} sourceId
 * @property {string} sourceTier
 * @property {string} title
 * @property {string} url
 * @property {string} canonicalUrl
 * @property {string|null} publishedAt
 * @property {DateConfidence} dateConfidence
 * @property {boolean} urlUsable
 * @property {string} snippet
 * @property {string} rawTextSample
 * @property {string} [applicationNumber]
 * @property {string} [addressKey]
 * @property {string} [publisherDomain]
 */

/** @param {string} html */
export function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {string} text */
export function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return '';
      }
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** @param {string} text @param {number} [max] */
export function truncateSnippet(text, max = SNIPPET_MAX) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/**
 * Strip tracking query params and hash. Returns original string on failure.
 * @param {string} url
 */
export function stripTrackingParams(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url.trim());
    const drop = [];
    for (const key of u.searchParams.keys()) {
      const lower = key.toLowerCase();
      if (TRACKING_PARAMS.has(lower) || lower.startsWith('utm_')) drop.push(key);
    }
    for (const key of drop) u.searchParams.delete(key);
    u.hash = '';
    let out = u.toString();
    if (out.endsWith('?')) out = out.slice(0, -1);
    return out;
  } catch {
    return String(url).split('#')[0];
  }
}

/** @param {string} url */
export function canonicalUrl(url) {
  const stripped = stripTrackingParams(url);
  if (!stripped) return '';
  try {
    const u = new URL(stripped);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = '';
    }
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {
    return stripped;
  }
}

/**
 * True for Google news redirect tokens that are not publisher article URLs.
 * @param {string} url
 */
export function isGoogleGotoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'google.com' && /^\/goto\/?$/i.test(u.pathname)) return true;
    if (host.endsWith('google.com') && /\/goto/i.test(u.pathname)) return true;
    return false;
  } catch {
    return /google\.com\/goto/i.test(url);
  }
}

/**
 * Attempt to resolve a usable publisher URL. Google goto protobuf tokens cannot
 * be decoded offline — those stay unusable.
 * @param {string} url
 * @returns {{ url: string, canonicalUrl: string, urlUsable: boolean }}
 */
export function resolveArticleUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return { url: '', canonicalUrl: '', urlUsable: false };
  }
  if (isGoogleGotoUrl(raw)) {
    return {
      url: stripTrackingParams(raw) || raw,
      canonicalUrl: canonicalUrl(raw),
      urlUsable: false,
    };
  }
  const stripped = stripTrackingParams(raw);
  const canon = canonicalUrl(stripped || raw);
  let usable = Boolean(canon);
  try {
    const host = new URL(canon || stripped || raw).hostname.toLowerCase();
    if (!host || host === 'google.com' || host.endsWith('.google.com')) {
      usable = false;
    }
  } catch {
    usable = false;
  }
  return {
    url: stripped || canon,
    canonicalUrl: canon,
    urlUsable: usable,
  };
}

/**
 * Registrable-ish publisher domain for corroboration counting.
 * Strips www and common subdomains. Returns '' for unusable/empty URLs.
 * @param {string} url
 */
export function publisherDomain(url) {
  if (!url || isGoogleGotoUrl(url)) return '';
  try {
    let host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    if (!host) return '';
    const labels = host.split('.').filter(Boolean);
    while (labels.length > 2 && DROP_SUBDOMAINS.has(labels[0])) {
      labels.shift();
    }
    if (labels[0] === 'www') labels.shift();
    host = labels.join('.');
    if (!host || host === 'google.com' || host.endsWith('.google.com')) return '';
    return host;
  } catch {
    return '';
  }
}

/**
 * Round a Date to UTC day start ISO (no sub-day precision).
 * @param {Date} d
 */
export function toUtcDayIso(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

/**
 * Best-effort date parse → { iso, confidence }.
 * Relative strings are approximate (day granularity). RSS/CKAN-style absolutes are exact.
 * @param {unknown} value
 * @param {{ nowMs?: number }} [opts]
 * @returns {{ iso: string|null, confidence: DateConfidence }}
 */
export function parseToIsoDate(value, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  if (value == null || value === '') return { iso: null, confidence: 'unknown' };
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { iso: value.toISOString(), confidence: 'exact' };
  }
  const s = String(value).trim();
  if (!s) return { iso: null, confidence: 'unknown' };

  // Serper relative: "3 hours ago", "2 days ago", "1 week ago", "1 month ago"
  const rel = s.match(
    /^(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago$/i,
  );
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms =
      unit.startsWith('minute')
        ? n * 60_000
        : unit.startsWith('hour')
          ? n * 3_600_000
          : unit.startsWith('day')
            ? n * 86_400_000
            : unit.startsWith('week')
              ? n * 7 * 86_400_000
              : n * 30 * 86_400_000;
    // Day granularity only — do not fabricate millisecond-precision timestamps.
    const iso = toUtcDayIso(new Date(nowMs - ms));
    return { iso, confidence: 'approximate' };
  }

  // SerpApi style: "08/07/2026, 02:33 PM, +0000 UTC"
  const mdy = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})\s*(AM|PM))?(?:,\s*\+?(\d{4})\s*UTC)?/i,
  );
  if (mdy) {
    let hour = mdy[4] != null ? Number(mdy[4]) : 0;
    const minute = mdy[5] != null ? Number(mdy[5]) : 0;
    const ap = (mdy[6] || '').toUpperCase();
    if (ap === 'PM' && hour < 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    const hasTime = mdy[4] != null;
    const d = new Date(
      Date.UTC(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]), hour, minute),
    );
    if (!Number.isNaN(d.getTime())) {
      return {
        iso: hasTime ? d.toISOString() : toUtcDayIso(d),
        confidence: hasTime ? 'exact' : 'approximate',
      };
    }
  }

  // Date-only ISO / YMD → exact at midnight UTC (publisher gave a calendar day).
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), confidence: 'exact' };
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), confidence: 'exact' };
  return { iso: null, confidence: 'unknown' };
}

/**
 * Back-compat helper: ISO string or null.
 * @param {unknown} value
 * @param {{ nowMs?: number }} [opts]
 */
export function toIsoDate(value, opts = {}) {
  return parseToIsoDate(value, opts).iso;
}

function stableId(parts) {
  const h = createHash('sha256');
  h.update(parts.filter(Boolean).join('|'));
  return h.digest('hex').slice(0, 16);
}

function extractRssTag(block, tag) {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`,
    'i',
  );
  const m = block.match(re);
  if (!m) return '';
  return decodeXmlEntities((m[1] ?? m[2] ?? '').trim());
}

/**
 * Hand-rolled RSS item extraction. Tolerates attributes on <item>.
 * @param {string} xml
 */
export function parseRssItems(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = extractRssTag(block, 'title');
    const link = extractRssTag(block, 'link');
    const guid = extractRssTag(block, 'guid');
    const pubDate = extractRssTag(block, 'pubDate');
    const description = stripHtml(extractRssTag(block, 'description'));
    items.push({
      title,
      link: link || guid,
      guid,
      pubDate,
      description,
    });
  }
  return items;
}

/**
 * @param {object} args
 * @returns {Candidate | null}
 */
export function makeCandidate({
  sourceId,
  sourceTier,
  title,
  url,
  publishedAt,
  snippet,
  rawTextSample,
  idSeed,
  applicationNumber,
  addressKey,
  dateConfidence: dateConfidenceOverride,
  nowMs,
}) {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  const resolved = resolveArticleUrl(url);
  if (!cleanTitle && !resolved.url && !resolved.canonicalUrl) return null;

  const parsed =
    dateConfidenceOverride && publishedAt != null && publishedAt !== ''
      ? {
          iso:
            typeof publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(publishedAt)
              ? publishedAt
              : parseToIsoDate(publishedAt, { nowMs }).iso,
          confidence: dateConfidenceOverride,
        }
      : parseToIsoDate(publishedAt, { nowMs });

  const id = stableId([
    sourceId,
    idSeed || resolved.canonicalUrl || cleanTitle,
    cleanTitle,
  ]);
  const domain = publisherDomain(resolved.urlUsable ? resolved.canonicalUrl || resolved.url : '');

  return {
    id,
    sourceId: String(sourceId || ''),
    sourceTier: String(sourceTier || 'lead'),
    title: cleanTitle || resolved.canonicalUrl || 'untitled',
    url: resolved.url || resolved.canonicalUrl,
    canonicalUrl: resolved.canonicalUrl,
    publishedAt: parsed.iso,
    dateConfidence: parsed.confidence,
    urlUsable: resolved.urlUsable,
    snippet: truncateSnippet(snippet || ''),
    rawTextSample: truncateSnippet(rawTextSample || snippet || cleanTitle, 200),
    publisherDomain: domain,
    ...(applicationNumber ? { applicationNumber: String(applicationNumber) } : {}),
    ...(addressKey ? { addressKey: String(addressKey) } : {}),
  };
}

function normalizeRssPayload(source, data) {
  const xml = data?.xml || data?.rawText || '';
  const items = parseRssItems(xml);
  /** @type {Candidate[]} */
  const out = [];
  for (const item of items) {
    const c = makeCandidate({
      sourceId: source.id,
      sourceTier: source.tier,
      title: item.title,
      url: item.link,
      publishedAt: item.pubDate,
      snippet: item.description,
      rawTextSample: item.description,
      idSeed: item.guid || item.link,
      // RSS pubDate is a real timestamp when present.
      dateConfidence: item.pubDate ? 'exact' : 'unknown',
    });
    if (c) out.push(c);
  }
  return out;
}

function normalizeSerper(source, data) {
  const news = Array.isArray(data?.news) ? data.news : [];
  const out = [];
  for (const n of news) {
    const c = makeCandidate({
      sourceId: source.id,
      sourceTier: source.tier,
      title: n.title,
      url: n.link,
      publishedAt: n.date,
      snippet: n.snippet || '',
      rawTextSample: [n.source, n.snippet].filter(Boolean).join(' — '),
      idSeed: n.link,
    });
    if (c) out.push(c);
  }
  return out;
}

function normalizeSerpApi(source, data) {
  const news = Array.isArray(data?.news_results) ? data.news_results : [];
  const out = [];
  for (const n of news) {
    const sourceName = typeof n.source === 'object' ? n.source?.name : n.source;
    const c = makeCandidate({
      sourceId: source.id,
      sourceTier: source.tier,
      title: n.title,
      url: n.link,
      publishedAt: n.date || n.published_at,
      snippet: n.snippet || n.content || '',
      rawTextSample: [sourceName, n.snippet].filter(Boolean).join(' — '),
      idSeed: n.link,
    });
    if (c) out.push(c);
  }
  return out;
}

function normalizeCkan(source, data) {
  const records = Array.isArray(data?.records) ? data.records : [];
  const out = [];
  for (const r of records) {
    const appNo = r['APPLICATION#'] || r.APPLICATION_NUMBER || r._id;
    const streetNum = String(r.STREET_NUM || '').trim();
    const streetName = String(r.STREET_NAME || '').trim();
    const streetType = String(r.STREET_TYPE || '').trim();
    const streetDir = String(r.STREET_DIRECTION || '').trim();
    const street = [streetNum, streetName, streetType, streetDir]
      .filter(Boolean)
      .join(' ');
    const title = `Development application ${appNo || ''} — ${street || 'unknown address'}`
      .replace(/\s+/g, ' ')
      .trim();
    const url =
      r.APPLICATION_URL ||
      (appNo
        ? `https://www.toronto.ca/city-government/planning-development/application-information-centre/`
        : '');
    const desc = String(r.DESCRIPTION || '').trim();
    const status = r.STATUS || '';
    const postal = String(r.POSTAL || r.POSTAL_CODE || '').trim();
    const snippet = [status && `Status: ${status}`, postal && `Postal: ${postal}`, desc]
      .filter(Boolean)
      .join('. ');
    // Include bare street tokens so local scoring can match "34 HANNA".
    const addressKey = `${streetNum} ${streetName}`.trim().toUpperCase();
    const c = makeCandidate({
      sourceId: source.id,
      sourceTier: source.tier,
      title,
      url: url || `https://www.toronto.ca/aic/#${encodeURIComponent(String(appNo || street))}`,
      publishedAt: r.DATE_SUBMITTED || r.COMMUNITY_MEETING_DATE,
      snippet,
      rawTextSample: `${snippet} ${street} ${streetName} ${postal}`.trim(),
      idSeed: String(appNo || `${addressKey}|${r.DATE_SUBMITTED}`),
      applicationNumber: appNo != null ? String(appNo) : undefined,
      addressKey: addressKey || undefined,
      dateConfidence: r.DATE_SUBMITTED || r.COMMUNITY_MEETING_DATE ? 'exact' : 'unknown',
    });
    if (c) out.push(c);
  }
  return out;
}

/**
 * Turn a fetch result + source into candidates. Never throws.
 * @param {object} source
 * @param {object} fetchResult
 * @returns {Candidate[]}
 */
export function normalizeSourceResult(source, fetchResult) {
  try {
    if (!source || !fetchResult || !fetchResult.ok) return [];
    const data = fetchResult.data;
    if (!data) {
      if (source.type === 'rss' && fetchResult.rawText) {
        return normalizeRssPayload(source, { xml: fetchResult.rawText });
      }
      return [];
    }
    if (data.kind === 'rss' || source.type === 'rss') {
      return normalizeRssPayload(source, data);
    }
    if (data.kind === 'serper' || source.type === 'serper') {
      return normalizeSerper(source, data);
    }
    if (data.kind === 'serpapi' || source.type === 'serpapi') {
      return normalizeSerpApi(source, data);
    }
    if (data.kind === 'ckan' || source.ckan) {
      return normalizeCkan(source, data);
    }
    return [];
  } catch {
    return [];
  }
}
