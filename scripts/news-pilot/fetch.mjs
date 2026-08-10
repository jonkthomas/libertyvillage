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
  return {
    get used() {
      return used;
    },
    get remaining() {
      return Math.max(0, maxRequests - used);
    },
    take(n = 1) {
      if (used + n > maxRequests) {
        const err = new Error(`request_budget_exceeded:${used}+${n}>${maxRequests}`);
        err.code = 'request_budget_exceeded';
        throw err;
      }
      used += n;
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
  } = opts;

  let lastError = null;
  let attempts = 0;

  for (let i = 0; i <= maxRetries; i++) {
    attempts = i + 1;
    if (budget) {
      try {
        budget.take(1);
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
      const res = await fetch(url, {
        method,
        headers: {
          'User-Agent': userAgent,
          Accept: '*/*',
          ...headers,
        },
        body,
        signal: controller.signal,
      });
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
      const res = await fetchWithRetry(source.url, { budget, timeoutMs, maxRetries });
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
      const res = await fetchWithRetry(source.url, { budget, timeoutMs, maxRetries });
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

  // Core streets + single M6K postal query. No unbound corridor fanout.
  const filterJobs = [
    ...cfg.streetNames.map((name) => ({ filters: { STREET_NAME: name } })),
    ...cfg.postalPrefixes.map((p) => ({ filters: { POSTAL: p } })),
  ];

  for (const job of filterJobs) {
    if (budget.remaining <= 0) {
      errors.push({ error: 'request_budget_exceeded', filters: job.filters });
      break;
    }
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
    });
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
