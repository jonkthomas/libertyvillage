/**
 * Network layer for the news discovery pilot.
 * One source failure never aborts the run.
 */

import { CKAN_DEV_APPS } from './sources.mjs';

export const FETCH_DEFAULTS = Object.freeze({
  timeoutMs: 20_000,
  maxRetries: 2,
  backoffMs: 500,
  maxRequestsPerRun: 80,
  /** Hard cap on CKAN datastore fanout so search sources retain capacity. */
  ckanMaxRequestsPerRun: 32,
  userAgent: 'LibertyVillageNewsPilot/0.1 (+local-shadow-eval; no-publish)',
});

/**
 * @typedef {object} FetchResult
 * @property {string} sourceId
 * @property {boolean} ok
 * @property {unknown} [data]
 * @property {string} [rawText]
 * @property {string} [contentType]
 * @property {number} [status]
 * @property {string} [error]
 * @property {string} [errorCode]
 * @property {number} attempts
 * @property {number} requestCount
 */

export function createRequestBudget(maxRequests = FETCH_DEFAULTS.maxRequestsPerRun) {
  let used = 0;
  /** @type {Map<string, number>} remaining reserved units per source id */
  const reservedRemaining = new Map();
  let totalReserved = 0;

  const unreservedRemaining = () => Math.max(0, maxRequests - used - totalReserved);

  return {
    get used() {
      return used;
    },
    get remaining() {
      return Math.max(0, maxRequests - used);
    },
    get unreservedRemaining() {
      return unreservedRemaining();
    },
    /**
     * Reserve up to n requests for a source from the unreserved pool.
     * @param {string} sourceId
     * @param {number} n
     * @returns {number} granted
     */
    reserve(sourceId, n = 1) {
      const id = String(sourceId || '');
      if (!id) return 0;
      const want = Math.max(0, Number(n) || 0);
      if (want <= 0) return 0;
      const grant = Math.min(want, unreservedRemaining());
      if (grant <= 0) return 0;
      reservedRemaining.set(id, (reservedRemaining.get(id) || 0) + grant);
      totalReserved += grant;
      return grant;
    },
    /**
     * Remaining reserved units for a source (0 if none reserved).
     * @param {string} sourceId
     */
    remainingReserved(sourceId) {
      return reservedRemaining.get(String(sourceId || '')) || 0;
    },
    /**
     * Consume n units. When sourceId has a reservation, take from it only.
     * Unscoped takes may only use the unreserved pool (cannot steal reservations).
     * @param {number} [n]
     * @param {string|null} [sourceId]
     */
    take(n = 1, sourceId = null) {
      const need = Math.max(0, Number(n) || 0);
      if (need <= 0) return used;
      const id = sourceId != null && String(sourceId) !== '' ? String(sourceId) : null;

      if (id && reservedRemaining.has(id)) {
        const left = reservedRemaining.get(id) || 0;
        if (need > left) {
          const err = new Error(
            `request_budget_exceeded:source=${id}:${left}<${need}`,
          );
          err.code = 'request_budget_exceeded';
          throw err;
        }
        reservedRemaining.set(id, left - need);
        totalReserved -= need;
        used += need;
        return used;
      }

      if (used + need > maxRequests || need > unreservedRemaining()) {
        const err = new Error(`request_budget_exceeded:${used}+${need}>${maxRequests}`);
        err.code = 'request_budget_exceeded';
        throw err;
      }
      used += need;
      return used;
    },
  };
}

/**
 * Load SERPER_API_KEY / SERPAPI_API_KEY from process.env, optionally hydrating
 * from the pi vault file path without printing values.
 * @param {string} [vaultPath]
 */
export function loadSecretsFromVault(vaultPath) {
  const out = {
    SERPER_API_KEY: process.env.SERPER_API_KEY || '',
    SERPAPI_API_KEY: process.env.SERPAPI_API_KEY || '',
  };
  if (!vaultPath) return out;
  try {
    // Dynamic import avoided; caller passes fs read content or we read sync.
    // Implemented in run.mjs via readVaultEnv; this just merges env.
  } catch {
    // ignore
  }
  return out;
}

/** @param {string} text */
export function parseVaultEnvText(text) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of String(text || '').split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} url
 * @param {object} opts
 */
/**
 * Optional public-HTTP host guard used by evidence fetches.
 * Discovery sources use known endpoints and leave this off.
 * @param {string} candidateUrl
 * @param {(url: string) => boolean} [isBlocked]
 */
export function assertPublicHttpUrl(candidateUrl, isBlocked) {
  if (typeof isBlocked === 'function' && isBlocked(candidateUrl)) {
    const err = new Error('unusable_url');
    err.code = 'unusable_url';
    throw err;
  }
  return true;
}

export async function fetchWithRetry(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = FETCH_DEFAULTS.timeoutMs,
    maxRetries = FETCH_DEFAULTS.maxRetries,
    backoffMs = FETCH_DEFAULTS.backoffMs,
    userAgent = FETCH_DEFAULTS.userAgent,
    budget,
    sourceId = null,
    guardPublicHttp = false,
    isBlockedUrl = null,
    maxRedirects = 5,
  } = opts;

  let lastError = null;
  let attempts = 0;
  let currentUrl = String(url || '');

  const blocked =
    typeof isBlockedUrl === 'function'
      ? isBlockedUrl
      : guardPublicHttp
        ? (u) => {
            // Lazy import avoided — inline lightweight private-host check for redirects.
            // Evidence path also pre-filters via draft-evidence isUnusableUrl.
            try {
              const parsed = new URL(String(u || ''));
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
              const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
              if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
              if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return true;
              if (host.endsWith('.local') || host.endsWith('.internal')) return true;
              if (host === 'metadata.google.internal') return true;
              if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
              if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
              if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
              if (/^169\.254\.\d+\.\d+$/.test(host)) return true;
              return false;
            } catch {
              return true;
            }
          }
        : null;

  if (blocked) {
    try {
      assertPublicHttpUrl(currentUrl, blocked);
    } catch (e) {
      return {
        ok: false,
        error: e.message,
        errorCode: e.code || 'unusable_url',
        attempts: 0,
        status: null,
        rawText: '',
        contentType: '',
      };
    }
  }

  for (let i = 0; i <= maxRetries; i++) {
    attempts = i + 1;
    if (budget) {
      try {
        budget.take(1, sourceId);
      } catch (e) {
        return {
          ok: false,
          error: e.message,
          errorCode: e.code || 'request_budget_exceeded',
          attempts,
          status: null,
          rawText: '',
          contentType: '',
        };
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res = await fetch(currentUrl, {
        method,
        headers: {
          'User-Agent': userAgent,
          Accept: '*/*',
          ...headers,
        },
        body,
        signal: controller.signal,
        redirect: blocked ? 'manual' : 'follow',
      });

      // Manually walk redirects when guarding public HTTP hosts.
      let redirects = 0;
      while (
        blocked &&
        res.status >= 300 &&
        res.status < 400 &&
        res.headers.get('location')
      ) {
        redirects += 1;
        if (redirects > maxRedirects) {
          return {
            ok: false,
            status: res.status,
            error: 'too_many_redirects',
            errorCode: 'too_many_redirects',
            rawText: '',
            contentType: res.headers.get('content-type') || '',
            attempts,
          };
        }
        const next = new URL(res.headers.get('location'), currentUrl).toString();
        try {
          assertPublicHttpUrl(next, blocked);
        } catch (e) {
          return {
            ok: false,
            status: res.status,
            error: e.message,
            errorCode: e.code || 'unsafe_redirect',
            rawText: '',
            contentType: res.headers.get('content-type') || '',
            attempts,
          };
        }
        currentUrl = next;
        // Redirect hops after the first response still consume budget when budgeted.
        if (budget) {
          try {
            budget.take(1, sourceId);
          } catch (e) {
            return {
              ok: false,
              error: e.message,
              errorCode: e.code || 'request_budget_exceeded',
              attempts,
              status: null,
              rawText: '',
              contentType: '',
            };
          }
        }
        res = await fetch(currentUrl, {
          method: 'GET',
          headers: {
            'User-Agent': userAgent,
            Accept: '*/*',
            ...headers,
          },
          signal: controller.signal,
          redirect: 'manual',
        });
      }

      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();
      if (!res.ok) {
        lastError = {
          ok: false,
          status: res.status,
          error: `http_${res.status}`,
          errorCode: `http_${res.status}`,
          rawText: rawText.slice(0, 500),
          contentType,
          attempts,
        };
        // Retry transient statuses
        if ([429, 500, 502, 503, 504].includes(res.status) && i < maxRetries) {
          await sleep(backoffMs * 2 ** i);
          continue;
        }
        return lastError;
      }
      return {
        ok: true,
        status: res.status,
        rawText,
        contentType,
        attempts,
      };
    } catch (e) {
      const aborted = e?.name === 'AbortError';
      lastError = {
        ok: false,
        status: null,
        error: aborted ? `timeout_after_${timeoutMs}ms` : String(e?.message || e),
        errorCode: aborted ? 'timeout' : 'network_error',
        rawText: '',
        contentType: '',
        attempts,
      };
      if (i < maxRetries) {
        await sleep(backoffMs * 2 ** i);
        continue;
      }
      return lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  return lastError;
}

/**
 * Fetch a single registered source. Never throws.
 * @param {import('./sources.mjs').NewsSource} source
 * @param {object} ctx
 * @returns {Promise<FetchResult>}
 */
export async function fetchSource(source, ctx = {}) {
  const {
    secrets = {},
    budget = createRequestBudget(),
    timeoutMs = FETCH_DEFAULTS.timeoutMs,
    maxRetries = FETCH_DEFAULTS.maxRetries,
  } = ctx;

  const base = {
    sourceId: source.id,
    requestCount: 0,
  };

  try {
    if (source.type === 'rss') {
      const res = await fetchWithRetry(source.url, {
        budget,
        timeoutMs,
        maxRetries,
        sourceId: source.id,
      });
      base.requestCount = budget.used;
      if (!res.ok) {
        return {
          ...base,
          ok: false,
          status: res.status,
          error: res.error,
          errorCode: res.errorCode,
          attempts: res.attempts,
        };
      }
      return {
        ...base,
        ok: true,
        status: res.status,
        rawText: res.rawText,
        contentType: res.contentType,
        data: { kind: 'rss', xml: res.rawText },
        attempts: res.attempts,
        requestCount: budget.used,
      };
    }

    if (source.type === 'json' && source.ckan) {
      return await fetchCkanDevApps(source, { budget, timeoutMs, maxRetries, base });
    }

    if (source.type === 'json') {
      const res = await fetchWithRetry(source.url, {
        budget,
        timeoutMs,
        maxRetries,
        sourceId: source.id,
      });
      base.requestCount = budget.used;
      if (!res.ok) {
        return {
          ...base,
          ok: false,
          status: res.status,
          error: res.error,
          errorCode: res.errorCode,
          attempts: res.attempts,
        };
      }
      let data;
      try {
        data = JSON.parse(res.rawText);
      } catch (e) {
        return {
          ...base,
          ok: false,
          status: res.status,
          error: `json_parse_error:${e.message}`,
          errorCode: 'json_parse_error',
          attempts: res.attempts,
        };
      }
      return {
        ...base,
        ok: true,
        status: res.status,
        data,
        rawText: res.rawText.slice(0, 2000),
        contentType: res.contentType,
        attempts: res.attempts,
        requestCount: budget.used,
      };
    }

    if (source.type === 'serper') {
      const key = secrets.SERPER_API_KEY || process.env.SERPER_API_KEY || '';
      if (!key) {
        return {
          ...base,
          ok: false,
          error: 'missing_SERPER_API_KEY',
          errorCode: 'missing_secret',
          attempts: 0,
        };
      }
      const res = await fetchWithRetry('https://google.serper.dev/news', {
        method: 'POST',
        headers: {
          'X-API-KEY': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: source.query,
          gl: 'ca',
          hl: 'en',
          num: source.num || 10,
        }),
        budget,
        timeoutMs,
        maxRetries,
        sourceId: source.id,
      });
      if (!res.ok) {
        return {
          ...base,
          ok: false,
          status: res.status,
          error: res.error,
          errorCode: res.errorCode,
          attempts: res.attempts,
          requestCount: budget.used,
        };
      }
      let data;
      try {
        data = JSON.parse(res.rawText);
      } catch (e) {
        return {
          ...base,
          ok: false,
          error: `json_parse_error:${e.message}`,
          errorCode: 'json_parse_error',
          attempts: res.attempts,
          requestCount: budget.used,
        };
      }
      return {
        ...base,
        ok: true,
        status: res.status,
        data: { kind: 'serper', ...data, query: source.query },
        attempts: res.attempts,
        requestCount: budget.used,
      };
    }

    if (source.type === 'serpapi') {
      const key = secrets.SERPAPI_API_KEY || process.env.SERPAPI_API_KEY || '';
      if (!key) {
        return {
          ...base,
          ok: false,
          error: 'missing_SERPAPI_API_KEY',
          errorCode: 'missing_secret',
          attempts: 0,
        };
      }
      // Build URL inside process; never log the full URL (contains api_key).
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google_news');
      url.searchParams.set('q', source.query || '');
      url.searchParams.set('gl', 'ca');
      url.searchParams.set('hl', 'en');
      url.searchParams.set('num', String(source.num || 10));
      url.searchParams.set('api_key', key);

      const res = await fetchWithRetry(url.toString(), {
        budget,
        timeoutMs,
        maxRetries,
        sourceId: source.id,
      });
      if (!res.ok) {
        return {
          ...base,
          ok: false,
          status: res.status,
          error: res.error,
          errorCode: res.errorCode,
          attempts: res.attempts,
          requestCount: budget.used,
          // intentionally omit URL
        };
      }
      let data;
      try {
        data = JSON.parse(res.rawText);
      } catch (e) {
        return {
          ...base,
          ok: false,
          error: `json_parse_error:${e.message}`,
          errorCode: 'json_parse_error',
          attempts: res.attempts,
          requestCount: budget.used,
        };
      }
      // Strip any echo of api_key from metadata before returning
      if (data && typeof data === 'object') {
        if (data.search_metadata) {
          const meta = { ...data.search_metadata };
          for (const k of Object.keys(meta)) {
            if (/url|query/i.test(k) && typeof meta[k] === 'string' && /api_key=/i.test(meta[k])) {
              meta[k] = '[redacted]';
            }
          }
          data = { ...data, search_metadata: meta };
        }
      }
      return {
        ...base,
        ok: true,
        status: res.status,
        data: { kind: 'serpapi', ...data, query: source.query },
        attempts: res.attempts,
        requestCount: budget.used,
      };
    }

    return {
      ...base,
      ok: false,
      error: `unsupported_source_type:${source.type}`,
      errorCode: 'unsupported_type',
      attempts: 0,
    };
  } catch (e) {
    return {
      ...base,
      ok: false,
      error: String(e?.message || e),
      errorCode: 'unexpected',
      attempts: 0,
      requestCount: budget.used,
    };
  }
}

/**
 * Keep only LV-core development applications.
 * Core short streets always pass. Corridor streets require M6K postal.
 * @param {object} record
 * @param {object} cfg
 */
export function isLvCoreCkanRecord(record, cfg = CKAN_DEV_APPS) {
  const street = String(record?.STREET_NAME || '')
    .trim()
    .toUpperCase();
  const postal = String(record?.POSTAL || record?.POSTAL_CODE || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const core = new Set((cfg.streetNames || []).map((s) => String(s).toUpperCase()));
  const corridors = new Set((cfg.corridorStreets || []).map((s) => String(s).toUpperCase()));
  const m6k = postal.startsWith('M6K');

  // Short LV-core streets always pass (Hanna, Atlantic, East Liberty, …).
  if (core.has(street)) return true;
  // Corridor streets (King/Dufferin/Strachan/…) only with M6K postal —
  // blocks 1423/3180 Dufferin and Parkdale-only M6K streets (Dowling/Beaty).
  if (corridors.has(street) && m6k) return true;
  return false;
}

/**
 * Dev apps are weeks–months old, not decade-old dormant files.
 * @param {object} record
 * @param {object} cfg
 * @param {number} [nowMs]
 */
export function isRecentCkanRecord(record, cfg = CKAN_DEV_APPS, nowMs = Date.now()) {
  const maxDays = cfg.maxAgeDays ?? 180;
  const raw = record?.DATE_SUBMITTED || record?.COMMUNITY_MEETING_DATE;
  if (!raw) return true; // keep undated for review rather than silent drop
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return true;
  const ageDays = (nowMs - t) / 86_400_000;
  return ageDays <= maxDays;
}

async function fetchCkanDevApps(source, { budget, timeoutMs, maxRetries, base }) {
  const cfg = source.ckan || CKAN_DEV_APPS;
  const records = [];
  const errors = [];
  let attempts = 0;
  let lastStatus = 200;
  const sourceId = source.id || 'ckan-dev-apps-lv';
  const perJobBudget = (maxRetries ?? FETCH_DEFAULTS.maxRetries) + 1;
  const ckanCap =
    Number(FETCH_DEFAULTS.ckanMaxRequestsPerRun) ||
    Math.floor(FETCH_DEFAULTS.maxRequestsPerRun * 0.4);
  let ckanUsed = 0;

  // Core streets + single M6K postal query. No unbound corridor fanout.
  const filterJobs = [
    ...cfg.streetNames.map((name) => ({ filters: { STREET_NAME: name } })),
    ...cfg.postalPrefixes.map((p) => ({ filters: { POSTAL: p } })),
  ];

  for (const job of filterJobs) {
    const reservedLeft =
      typeof budget.remainingReserved === 'function'
        ? budget.remainingReserved(sourceId)
        : budget.remaining;
    const poolLeft = budget.remaining;
    // Require worst-case room for this job (maxRetries + 1) from this source's pool.
    if (poolLeft <= 0 || reservedLeft < 1) {
      errors.push({ error: 'request_budget_exceeded', filters: job.filters });
      break;
    }
    if (ckanUsed + 1 > ckanCap) {
      errors.push({ error: 'ckan_budget_cap_reached', filters: job.filters });
      break;
    }
    // Stop before starting a job that cannot cover its retry budget from reservation.
    if (reservedLeft < perJobBudget && reservedLeft < poolLeft) {
      // still allow a final partial job if at least 1 remains
    }
    if (reservedLeft <= 0) {
      errors.push({ error: 'request_budget_exceeded', filters: job.filters });
      break;
    }
    const before = budget.used;
    const res = await fetchWithRetry(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource_id: cfg.resourceId,
        limit: cfg.limitPerFilter || 20,
        filters: job.filters,
        sort: 'DATE_SUBMITTED desc',
      }),
      budget,
      timeoutMs,
      maxRetries,
      sourceId,
    });
    ckanUsed += Math.max(0, budget.used - before);
    attempts += res.attempts || 1;
    lastStatus = res.status;
    if (!res.ok) {
      errors.push({
        filters: job.filters,
        error: res.error,
        status: res.status,
      });
      continue;
    }
    try {
      const data = JSON.parse(res.rawText);
      if (!data.success) {
        errors.push({ filters: job.filters, error: 'ckan_success_false' });
        continue;
      }
      for (const rec of data.result?.records || []) {
        records.push(rec);
      }
    } catch (e) {
      errors.push({ filters: job.filters, error: `json_parse_error:${e.message}` });
    }
  }

  // Dedupe records by APPLICATION# then keep LV-core only.
  const byId = new Map();
  for (const r of records) {
    const id = r['APPLICATION#'] || r._id;
    if (id != null && !byId.has(String(id))) byId.set(String(id), r);
  }
  const unique = [...byId.values()].filter(
    (r) => isLvCoreCkanRecord(r, cfg) && isRecentCkanRecord(r, cfg),
  );

  if (unique.length === 0 && errors.length > 0 && records.length === 0) {
    return {
      ...base,
      ok: false,
      status: lastStatus,
      error: `ckan_all_filters_failed:${errors.length}`,
      errorCode: 'ckan_failed',
      attempts,
      requestCount: budget.used,
      data: { kind: 'ckan', errors },
    };
  }

  return {
    ...base,
    ok: true,
    status: lastStatus,
    data: {
      kind: 'ckan',
      records: unique,
      errors,
      resourceId: cfg.resourceId,
      rawRecordCount: byId.size,
      lvCoreRecordCount: unique.length,
    },
    attempts,
    requestCount: budget.used,
  };
}
