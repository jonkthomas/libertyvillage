/**
 * Pluggable Instagram provider for the weekly roundup v2 (spec §4.4).
 *
 * Interface (every adapter):
 *   listRecentPosts({ handles, newerThan, limit }) => { rows, unavailable: [{handle, reason}] }
 *   getPosts(shortcodes) => [{ shortcode, ownerUsername, timestamp, caption, status: 'ok'|'missing'|'private' }]
 * rows: { handle, ownerUsername, shortcode, url, timestamp, caption, images: [{url, altText}], type }
 *
 * `apify` (approved for staging and production, John 2026-09-29): apify/instagram-scraper
 * on PUBLIC profile URLs only. No login, cookies or session credentials; the only
 * secret is APIFY_API_TOKEN, sent as a bearer header (never in a URL), and never logged.
 * `meta` (Business Discovery) is a defined slot, not implemented until John
 * provides credentials.
 *
 * Every failure (missing token, HTTP error, timeout, budget stop, malformed
 * or empty response) throws IgProviderError; the collector marks Instagram
 * `unavailable` and every other source proceeds.
 */

export const IG_LIMITS = Object.freeze({
  maxHandles: 34,
  maxResultsPerHandle: 20,
  maxResults: 34 * 20,
  maxRunUsd: 1,
  timeoutMs: 300_000,
  lookbackDays: 21,
  maxBodyBytes: 10_000_000,
});

export const APIFY_ACTOR = 'apify~instagram-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';

export class IgProviderError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'IgProviderError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Shortcode timestamp check (§4.4)
// ---------------------------------------------------------------------------

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IG_EPOCH_MS = 1_314_220_021_721n;

/**
 * Upload-start time (ms) encoded in a shortcode's media id: id >> 23 is
 * milliseconds since the Instagram epoch. Private-post shortcodes carry a
 * suffix beyond 11 characters; only the first 11 encode the id.
 * @param {string} shortcode
 * @returns {number|null}
 */
export function shortcodeCreatedMs(shortcode) {
  const code = String(shortcode || '');
  if (!/^[A-Za-z0-9_-]{8,}$/.test(code)) return null;
  let id = 0n;
  for (const ch of code.slice(0, 11)) id = id * 64n + BigInt(SHORTCODE_ALPHABET.indexOf(ch));
  return Number((id >> 23n) + IG_EPOCH_MS);
}

/**
 * The provider timestamp is accepted when encoded − 2 min ≤ timestamp ≤ encoded + 72 h.
 * (Trial: 253 owned posts, median lag 0.4 min, max 50 h, none earlier than −1 min.)
 * @returns {{ok: boolean, lagMs: number|null, reason?: string}}
 */
export function checkIgTimestamp(shortcode, timestamp) {
  const encoded = shortcodeCreatedMs(shortcode);
  const at = Date.parse(String(timestamp || ''));
  if (encoded == null || !Number.isFinite(at)) return { ok: false, lagMs: null, reason: 'unparseable' };
  const lagMs = at - encoded;
  const ok = lagMs >= -2 * 60_000 && lagMs <= 72 * 3_600_000;
  return ok ? { ok, lagMs } : { ok, lagMs, reason: 'timestamp-band' };
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

const HANDLE = /^[a-z0-9._]{1,30}$/;
const lower = (v) => String(v || '').toLowerCase();

/** Normalize one apify/instagram-scraper post item; null for profile/error items. */
export function normalizeApifyPost(item, handle = null) {
  if (!item || typeof item !== 'object' || item.error) return null;
  const shortcode = item.shortCode || item.shortcode;
  if (typeof shortcode !== 'string' || !shortcode || typeof item.timestamp !== 'string') return null;
  const images = [];
  if (item.displayUrl) images.push({ url: String(item.displayUrl), altText: item.alt == null ? null : String(item.alt) });
  for (const child of Array.isArray(item.childPosts) ? item.childPosts : []) {
    if (child?.displayUrl) images.push({ url: String(child.displayUrl), altText: child.alt == null ? null : String(child.alt) });
  }
  return {
    handle: handle || lower(item.ownerUsername),
    ownerUsername: item.ownerUsername == null ? null : String(item.ownerUsername),
    shortcode,
    url: `https://www.instagram.com/p/${shortcode}/`,
    timestamp: item.timestamp,
    caption: typeof item.caption === 'string' ? item.caption : '',
    images,
    type: item.type == null ? null : String(item.type),
    isPinned: item.isPinned === true,
  };
}

function handleFromInputUrl(url) {
  const m = String(url || '').match(/^https:\/\/www\.instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/);
  return m ? lower(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Apify adapter
// ---------------------------------------------------------------------------

function apifyAdapter({ token, fetcher = globalThis.fetch, budgetUsd = IG_LIMITS.maxRunUsd, timeoutMs = IG_LIMITS.timeoutMs } = {}) {
  const runSync = async (input, maxItems) => {
    if (!token) throw new IgProviderError('missing-token', 'APIFY_API_TOKEN is not set');
    if (!(budgetUsd > 0) || budgetUsd > IG_LIMITS.maxRunUsd) throw new IgProviderError('budget', 'Instagram run budget must be within US$1');
    const params = new URLSearchParams({
      maxItems: String(maxItems),
      maxTotalChargeUsd: String(budgetUsd),
      timeout: String(Math.floor(timeoutMs / 1000)),
    });
    // The abort deadline stays armed through response-body consumption, so a
    // peer that sends headers then stalls still hits the provider timeout.
    // Error messages never carry the token value.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs + 15_000);
    try {
      let res;
      try {
        res = await fetcher(`${APIFY_BASE}/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?${params}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch (e) {
        throw new IgProviderError(e?.name === 'AbortError' ? 'timeout' : 'network', 'Instagram provider request failed');
      }
      const status = Number(res?.status);
      if (!(status >= 200 && status < 300)) throw new IgProviderError(status === 402 ? 'budget' : 'http', `Instagram provider HTTP ${status}`);
      let items;
      try {
        if (typeof res.text === 'function') {
          const raw = await res.text();
          if (raw.length > IG_LIMITS.maxBodyBytes) throw new IgProviderError('too-large', 'Instagram provider response exceeded size bound');
          items = JSON.parse(raw);
        } else if (typeof res.json === 'function') {
          items = await res.json();
          if (JSON.stringify(items)?.length > IG_LIMITS.maxBodyBytes)
            throw new IgProviderError('too-large', 'Instagram provider response exceeded size bound');
        } else {
          const raw = String(res.body ?? '');
          if (raw.length > IG_LIMITS.maxBodyBytes) throw new IgProviderError('too-large', 'Instagram provider response exceeded size bound');
          items = JSON.parse(raw);
        }
      } catch (e) {
        if (e instanceof IgProviderError) throw e;
        if (e?.name === 'AbortError' || controller.signal.aborted)
          throw new IgProviderError('timeout', 'Instagram provider request failed');
        throw new IgProviderError('malformed', 'Instagram provider returned non-JSON');
      }
      if (!Array.isArray(items)) throw new IgProviderError('malformed', 'Instagram provider returned a non-array');
      return items;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    name: 'apify',
    /**
     * @param {{handles: string[], newerThan: string, limit?: number}} args
     */
    async listRecentPosts({ handles, newerThan, limit = IG_LIMITS.maxResultsPerHandle } = {}) {
      const list = [...new Set((handles || []).map(lower))];
      if (!list.length) throw new IgProviderError('empty', 'no Instagram handles');
      if (list.length > IG_LIMITS.maxHandles || !list.every((h) => HANDLE.test(h))) throw new IgProviderError('budget', 'handle cap exceeded or invalid handle');
      if (!(Number.isInteger(limit) && limit > 0 && limit <= IG_LIMITS.maxResultsPerHandle)) throw new IgProviderError('budget', 'results-per-handle cap exceeded');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(newerThan || ''))) throw new IgProviderError('input', 'newerThan must be YYYY-MM-DD');
      const maxItems = list.length * limit;
      const items = await runSync({
        directUrls: list.map((h) => `https://www.instagram.com/${h}/`),
        resultsType: 'posts',
        resultsLimit: limit,
        onlyPostsNewerThan: newerThan,
        addParentData: false,
      }, maxItems);
      const unavailable = [];
      const rows = [];
      const perHandle = new Map();
      for (const item of items) {
        const inputHandle = handleFromInputUrl(item?.inputUrl) || lower(item?.username);
        if (item?.error) {
          if (inputHandle && list.includes(inputHandle)) unavailable.push({ handle: inputHandle, reason: item.isRestrictedProfile || item.private ? 'private' : String(item.error).slice(0, 60) });
          continue;
        }
        const handle = inputHandle && list.includes(inputHandle) ? inputHandle : null;
        const row = normalizeApifyPost(item, handle);
        if (!row || !row.handle) continue;
        const n = perHandle.get(row.handle) || 0;
        if (n >= limit) continue;
        perHandle.set(row.handle, n + 1);
        rows.push(row);
      }
      if (!rows.length && !unavailable.length) throw new IgProviderError('empty', 'Instagram provider returned no rows');
      return { rows, unavailable };
    },
    /** @param {string[]} shortcodes */
    async getPosts(shortcodes) {
      const codes = [...new Set((shortcodes || []).map(String))];
      if (!codes.length) return [];
      if (codes.length > IG_LIMITS.maxResults || !codes.every((c) => /^[A-Za-z0-9_-]{8,}$/.test(c))) throw new IgProviderError('budget', 'shortcode cap exceeded or invalid shortcode');
      const items = await runSync({
        directUrls: codes.map((c) => `https://www.instagram.com/p/${c}/`),
        resultsType: 'posts',
        resultsLimit: 1,
        addParentData: false,
      }, codes.length);
      const byCode = new Map();
      const privateCodes = new Set();
      for (const item of items) {
        const row = normalizeApifyPost(item);
        if (row) {
          if (!byCode.has(row.shortcode)) byCode.set(row.shortcode, row);
          continue;
        }
        const code = String(item?.inputUrl || item?.url || '').match(/\/p\/([A-Za-z0-9_-]+)/)?.[1];
        if (code && (item?.isRestrictedProfile || item?.private || /private|restricted/i.test(String(item?.error || '')))) privateCodes.add(code);
      }
      return codes.map((shortcode) => {
        const row = byCode.get(shortcode);
        if (row) return { shortcode, ownerUsername: row.ownerUsername, timestamp: row.timestamp, caption: row.caption, status: 'ok' };
        return { shortcode, ownerUsername: null, timestamp: null, caption: null, status: privateCodes.has(shortcode) ? 'private' : 'missing' };
      });
    },
  };
}

function metaAdapter() {
  const unavailable = async () => {
    throw new IgProviderError('not-configured', 'Meta Business Discovery adapter is not configured');
  };
  return { name: 'meta', listRecentPosts: unavailable, getPosts: unavailable };
}

/**
 * @param {{provider?: 'apify'|'meta', token?: string, fetcher?: Function, budgetUsd?: number, timeoutMs?: number}} [opts]
 */
export function createIgProvider({ provider = 'apify', ...opts } = {}) {
  if (provider === 'apify') return apifyAdapter(opts);
  if (provider === 'meta') return metaAdapter();
  throw new IgProviderError('input', `unknown Instagram provider ${provider}`);
}

/**
 * Owned-post filter (§4.4): the provider owner must equal the watch handle;
 * tagged, collaborator and reposted rows are dropped, and so are pinned or
 * old posts older than `newerThanMs`. Returns kept rows and a drop census.
 */
export function filterOwnedPosts(rows, { handles, newerThanMs } = {}) {
  const watch = new Set((handles || []).map(lower));
  const kept = [];
  const dropped = { 'not-owned': 0, 'too-old': 0, 'timestamp-band': 0 };
  for (const row of rows || []) {
    if (!watch.has(lower(row.handle)) || lower(row.ownerUsername) !== lower(row.handle)) {
      dropped['not-owned'] += 1;
      continue;
    }
    if (Number.isFinite(newerThanMs) && !(Date.parse(row.timestamp) >= newerThanMs)) {
      dropped['too-old'] += 1;
      continue;
    }
    if (!checkIgTimestamp(row.shortcode, row.timestamp).ok) {
      dropped['timestamp-band'] += 1;
      continue;
    }
    kept.push(row);
  }
  return { kept, dropped };
}
