/**
 * Weekly roundup v2 collector (spec §3 "collect", §4, §6.1, §8).
 *
 * collectRoundup({ out, now, env, fetcher }) => { signals, census, snapshots }
 *
 * Deterministic, network, no model. Every source failure is recorded in the
 * census and never aborts the run. Access rules (§4.3): robots.txt once per host
 * per run, at most one request per host per minIntervalMs (2 s), a budget of 80
 * page fetches plus 12 Serper calls, blocked responses (401/402/403/406/429 or a
 * challenge body) recorded as `blocked` with no retry, no alternate UA, no
 * cookies, no browser and no archive substitution. Instagram is read only
 * through ig-provider.mjs; instagram.com pages are never fetched.
 *
 * Signal: { signalId, sourceId, url, groupId?, records, post?, fetchedAt, fetchStatus, title?, publisherDomain, snapshotSha256? }
 * signalId = sha256(sourceId + url + recordId) for single-record signals
 * (listing rows, JSON-LD events, feed records); sha256(sourceId + url + '') for
 * whole-document signals (page sections, Instagram posts).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FETCH_DEFAULTS, createHostPacer, createRobotsCache, fetchWithRetry } from './fetch.mjs';
import { classifyBlockedResponse, isUnusableUrl } from './url-guard.mjs';
import { extractRoundupRecords } from './roundup-records.mjs';
import {
  ROUNDUP_IG_WATCH, ROUNDUP_ROAD_FRONTAGE, ROUNDUP_ROAD_LEAD_STREETS, ROUNDUP_SERPER_QUERIES, ROUNDUP_SOURCES, igWatchSources,
  registrableDomain,
} from './sources.mjs';
import { createIgProvider, filterOwnedPosts, IG_LIMITS } from './ig-provider.mjs';
import { isoWeekOf } from './roundup.mjs';
import { jaccard, normalizeTitleTokens } from './dedupe.mjs';

export const COLLECT_LIMITS = Object.freeze({
  maxFetches: FETCH_DEFAULTS.maxRequestsPerRun, // 80
  maxSerperCalls: 12,
  maxSignalRecordChars: 2_000,
  minRecordChars: 300,
  maxSnapshotBytes: 25 * 1024 * 1024,
  minIntervalMs: 2_000,
  timeoutMs: 20_000,
  serperResultsPerQuery: 10,
  groupTitleJaccard: 0.5,
});

const DAY_MS = 86_400_000;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const roundupSignalId = (sourceId, url, recordId = '') => sha256(`${sourceId}\n${url}\n${recordId}`);

function writePrivate(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** Normalize an injected fetcher result (Response or plain object) to {status, body, contentType}. */
async function readResult(res) {
  if (!res) return { status: null, body: '', contentType: '' };
  if (typeof res.text === 'function') {
    const contentType = res.headers?.get?.('content-type') || '';
    return { status: Number(res.status) || null, body: await res.text(), contentType };
  }
  const body = res.body ?? res.rawText ?? res.text ?? '';
  return { status: res.status == null ? (res.ok === false ? null : 200) : Number(res.status),
    body: typeof body === 'string' ? body : JSON.stringify(body), contentType: res.contentType || '' };
}

/**
 * Bound the record texts carried in a signal to the §5 per-signal budget.
 * Typed fields are kept whole; trailing records that do not fit are omitted.
 */
function boundRecords(records) {
  const out = [];
  let used = 0;
  const perRecord = Math.max(COLLECT_LIMITS.minRecordChars, Math.floor(COLLECT_LIMITS.maxSignalRecordChars / Math.max(1, records.length)));
  for (const r of records) {
    const left = COLLECT_LIMITS.maxSignalRecordChars - used;
    if (left <= 0) break;
    const cap = Math.min(perRecord, left);
    const text = r.text.length > cap ? r.text.slice(0, cap) : r.text;
    used += text.length;
    out.push({ recordId: r.recordId, kind: r.kind, text, typed: r.typed, ...(text.length < r.text.length ? { truncated: true } : {}) });
  }
  return { records: out, omitted: records.length - out.length };
}

const lower = (v) => String(v ?? '').trim().toLowerCase();
const LEAD_STREETS = new Set(ROUNDUP_ROAD_LEAD_STREETS.map(lower));
const FRONTAGE = new Map(Object.entries(ROUNDUP_ROAD_FRONTAGE).map(([road, cross]) => [lower(road), new Set(cross.map(lower))]));

/** Fallback road recall filter (no geography module): LV-interior street, or a frontage road at an LV cross street. */
export function roadLeadByName(typed) {
  if (LEAD_STREETS.has(lower(typed.road))) return true;
  const cross = FRONTAGE.get(lower(typed.road));
  return Boolean(cross && [typed.fromRoad, typed.toRoad, typed.atRoad].some((name) => cross.has(lower(name))));
}

/**
 * Road recall filter: the geography module's segment classifier when it loads
 * (so collection and verification agree), else the checked-in name filter.
 */
async function loadRoadLead(geography) {
  let geo = geography;
  if (geo === undefined) {
    try {
      geo = await import('./roundup-geo.mjs');
    } catch {
      geo = null;
    }
  }
  if (typeof geo?.classifySegment !== 'function') return roadLeadByName;
  return (typed) => {
    try {
      const verdict = geo.classifySegment({ road: typed.road, fromRoad: typed.fromRoad, toRoad: typed.toRoad, coordinates: typed.coordinates });
      return ['core', 'adjacent'].includes(typeof verdict === 'string' ? verdict : verdict?.verdict);
    } catch {
      return false;
    }
  };
}

/** Same-story grouping inside one query's results: ≥2 distinct publishers with similar titles. */
function groupResults(results) {
  const tokens = results.map((r) => normalizeTitleTokens(r.title));
  const parent = results.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      if (jaccard(tokens[i], tokens[j]) >= COLLECT_LIMITS.groupTitleJaccard) parent[find(j)] = find(i);
    }
  }
  const clusters = new Map();
  results.forEach((r, i) => clusters.set(find(i), [...(clusters.get(find(i)) || []), r]));
  const groupOf = new Map();
  for (const members of clusters.values()) {
    const domains = new Set(members.map((m) => registrableDomain(m.link)));
    if (members.length < 2 || domains.size < 2) continue;
    const id = 'grp:' + sha256([...new Set(members.map((m) => m.link))].sort().join('\n')).slice(0, 24);
    for (const m of members) if (!groupOf.has(m.link)) groupOf.set(m.link, id);
  }
  return groupOf;
}

/**
 * @param {object} opts
 * @param {string} opts.out collect directory (signals.jsonl, census.json, snapshots/, robots/)
 * @param {string} opts.now T_plan ISO
 * @param {object} [opts.env] SERPER_API_KEY, APIFY_API_TOKEN (source process only)
 * @param {(url: string, init?: object) => Promise<any>} [opts.fetcher] injected transport (tests); default is the guarded public-HTTP fetch
 * @param {object} [opts.igProvider] injected Instagram provider (tests)
 * @param {object[]} [opts.watchList] Instagram watch entries (default: committed data/ig-watch.json)
 * @param {object[]} [opts.sources] registry (default ROUNDUP_SOURCES)
 * @param {() => number} [opts.clock]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {object|null} [opts.geography] roundup-geo module override (null = name filter only)
 */
export async function collectRoundup({
  out, now, env = process.env, fetcher = null, igProvider = null, watchList = ROUNDUP_IG_WATCH,
  sources = ROUNDUP_SOURCES, clock = Date.now, sleep = null, geography = undefined,
} = {}) {
  const at = Date.parse(String(now || ''));
  if (!Number.isFinite(at)) throw new Error('collectRoundup requires now');
  if (!out) throw new Error('collectRoundup requires out');
  const week = isoWeekOf(at);
  const windowStartMs = Date.parse(week.weekStartUtc);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });

  const census = {
    now: new Date(at).toISOString(), isoWeek: week.isoWeek, sources: {},
    serper: { status: 'skipped', queries: 0, calls: 0, results: 0, pages: 0, groups: 0 },
    instagram: { status: 'skipped' },
    budget: { fetches: 0, maxFetches: COLLECT_LIMITS.maxFetches, serperCalls: 0, maxSerperCalls: COLLECT_LIMITS.maxSerperCalls },
    robots: {}, snapshots: { count: 0, bytes: 0, capped: 0 }, leads: [],
  };
  const signals = [];
  const snapshots = [];
  const stamp = () => new Date(clock()).toISOString();

  // ---- budget, pacing, robots -------------------------------------------------
  const budget = {
    used: 0,
    take(n = 1) {
      if (this.used + n > COLLECT_LIMITS.maxFetches) {
        const err = new Error('request_budget_exceeded');
        err.code = 'request_budget_exceeded';
        throw err;
      }
      this.used += n;
      census.budget.fetches = this.used;
    },
  };
  const pacer = createHostPacer({ minIntervalMs: COLLECT_LIMITS.minIntervalMs, now: clock, ...(sleep ? { sleep } : {}) });
  const headers = { Accept: 'text/html,application/json;q=0.9,*/*;q=0.5' };

  /** One request, no retry. Robots is checked by the caller layer below. */
  const transport = async (url, { robots = null, method = 'GET', body = undefined, extraHeaders = {} } = {}) => {
    if (fetcher) {
      if (robots && !(await robots.allowed(url))) return { outcome: 'robots-disallowed', status: null, body: '' };
      await pacer.wait(url);
      try {
        budget.take(1);
      } catch {
        return { outcome: 'budget', status: null, body: '' };
      }
      try {
        const res = await readResult(await fetcher(url, { method, headers: { ...headers, ...extraHeaders }, body }));
        return { outcome: 'response', ...res };
      } catch {
        return { outcome: 'network', status: null, body: '' };
      }
    }
    const res = await fetchWithRetry(url, {
      method, body, headers: { ...headers, ...extraHeaders }, maxRetries: 0, timeoutMs: COLLECT_LIMITS.timeoutMs,
      guardPublicHttp: true, robots, pacer, budget,
    });
    if (res.errorCode === 'robots-disallowed') return { outcome: 'robots-disallowed', status: null, body: '' };
    if (res.errorCode === 'request_budget_exceeded') return { outcome: 'budget', status: null, body: '' };
    if (res.status == null) return { outcome: 'network', status: null, body: '', error: res.errorCode };
    return { outcome: 'response', status: res.status, body: res.rawText || '', contentType: res.contentType || '' };
  };

  const robotsDir = path.join(out, 'robots');
  const robots = createRobotsCache({
    userAgent: FETCH_DEFAULTS.userAgent,
    dir: robotsDir,
    writeFile: (host, text) => writePrivate(path.join(robotsDir, host.replace(/[^a-z0-9.-]/gi, '_') + '.txt'), text),
    fetchText: async (robotsUrl) => {
      const r = await transport(robotsUrl);
      if (r.outcome !== 'response') throw new Error(r.outcome);
      return { status: r.status, body: r.body };
    },
  });

  /** Fetch a page under §4.3. Returns {ok, reason, status, body}. */
  const politeFetch = async (url) => {
    const r = await transport(url, { robots });
    if (r.outcome !== 'response') return { ok: false, reason: r.outcome, status: null, body: '' };
    if (classifyBlockedResponse(r.status, r.body)) return { ok: false, reason: 'blocked', status: r.status, body: '' };
    if (!(r.status >= 200 && r.status < 300)) return { ok: false, reason: `http-${r.status}`, status: r.status, body: '' };
    return { ok: true, reason: 'ok', status: r.status, body: r.body, contentType: r.contentType };
  };

  // ---- snapshots (§8): content-addressed, mode 0600, 25 MB per run -----------
  const snapshot = (sourceId, body, ext) => {
    const bytes = Buffer.byteLength(body);
    const digest = sha256(body);
    const rel = path.join('snapshots', sourceId.replace(/[^a-z0-9._:-]/gi, '_').replace(/:/g, '_'), `${digest}.${ext}`);
    const file = path.join(out, rel);
    const existing = snapshots.find((s) => s.path === rel);
    if (existing) return existing;
    if (census.snapshots.bytes + bytes > COLLECT_LIMITS.maxSnapshotBytes) {
      census.snapshots.capped += 1;
      return null;
    }
    writePrivate(file, body);
    const entry = { sourceId, sha256: digest, path: rel, bytes };
    snapshots.push(entry);
    census.snapshots.count += 1;
    census.snapshots.bytes += bytes;
    return entry;
  };

  const addSignal = ({ sourceId, url, records, recordId = '', extra = {}, fetchedAt, fetchStatus = null, snap }) => {
    const bounded = boundRecords(records);
    const signal = {
      signalId: roundupSignalId(sourceId, url, recordId), sourceId, url, records: bounded.records, fetchedAt,
      // The capture's actual HTTP code is distinct from the verifier's later refetch.
      // A provider that exposes no per-post HTTP code (Instagram) stays null.
      fetchStatus: Number.isInteger(fetchStatus) && fetchStatus >= 200 && fetchStatus < 300 ? fetchStatus : null,
      publisherDomain: registrableDomain(url), ...(snap ? { snapshotSha256: snap.sha256 } : {}), ...extra,
    };
    if (bounded.omitted) signal.omittedRecords = bounded.omitted;
    signals.push(signal);
    return signal;
  };

  // ---- identity sources --------------------------------------------------------
  const roadLead = await loadRoadLead(geography);
  const identity = sources.filter((s) => s.enabled !== false && !['news-discovery', 'ig'].includes(s.identityKind) && s.parse !== 'ig-post');
  for (const source of identity) {
    const entry = { status: 'ok', httpStatus: null, records: 0, signals: 0 };
    census.sources[source.id] = entry;
    const res = await politeFetch(source.url);
    entry.httpStatus = res.status;
    if (!res.ok) {
      entry.status = res.reason;
      continue;
    }
    const fetchedAt = stamp();
    const snap = source.snapshot === false ? null : snapshot(source.id, res.body, source.parse === 'json-feed' ? 'json' : 'html');
    let records;
    try {
      records = extractRoundupRecords({ source, url: source.url, body: res.body });
    } catch {
      entry.status = 'parse-error';
      continue;
    }
    entry.records = records.length;
    const before = signals.length;
    if (source.parse === 'html-page') {
      // A BIA/project page may contain many independent events. One signal per
      // section preserves the one-form-per-signal contract and record identity.
      for (const record of records) addSignal({ sourceId: source.id, url: source.url, records: [record],
        recordId: record.recordId, fetchedAt, fetchStatus: res.status, snap, extra: { title: source.label } });
    } else {
      for (const record of records) {
        if (source.identityKind === 'road-feed') {
          if (Number.isFinite(record.typed.endTime) && record.typed.endTime <= at) continue;
          if (!roadLead(record.typed)) continue;
        }
        if (source.identityKind === 'transit-feed' && Array.isArray(source.routes) && !source.routes.includes(String(record.typed.route))) continue;
        if (record.kind === 'jsonld-event' && Array.isArray(source.venueAliases) && source.venueAliases.length &&
          !source.venueAliases.some((alias) => lower(record.typed.location?.name) === lower(alias))) {
          entry.venueMismatch = (entry.venueMismatch || 0) + 1;
          continue;
        }
        addSignal({ sourceId: source.id, url: source.url, records: [record], recordId: record.recordId, fetchedAt,
          fetchStatus: res.status, snap, extra: { title: record.typed.subject || record.typed.name || record.typed.road || record.typed.title || null } });
      }
    }
    entry.signals = signals.length - before;
    if (!records.length) entry.status = 'no-records';
  }

  // ---- Instagram (§4.4): provider only; failure never blocks other sources ----
  const igWatch = (watchList || []).filter((e) => (e.provider || 'apify') === 'apify' && e.enabled !== false);
  const igSources = igWatchSources(igWatch);
  if (!igWatch.length) {
    census.instagram = { status: 'unavailable', reason: 'no-watch-list' };
  } else {
    const handles = igSources.map((s) => s.handle).slice(0, IG_LIMITS.maxHandles);
    const newerThanMs = windowStartMs - IG_LIMITS.lookbackDays * DAY_MS;
    const newerThan = new Date(newerThanMs).toISOString().slice(0, 10);
    const token = env?.APIFY_API_TOKEN || '';
    census.instagram = { status: 'ok', provider: 'apify', handles: handles.length, newerThan, rows: 0, owned: 0, signals: 0, dropped: {}, unavailableHandles: [] };
    if (!igProvider && !token) {
      census.instagram = { status: 'unavailable', reason: 'missing-token', handles: handles.length };
    } else {
      try {
        const provider = igProvider || createIgProvider({ provider: 'apify', token });
        const listed = await provider.listRecentPosts({ handles, newerThan, limit: IG_LIMITS.maxResultsPerHandle });
        const rows = Array.isArray(listed) ? listed : listed?.rows;
        if (!Array.isArray(rows)) throw Object.assign(new Error('malformed'), { code: 'malformed' });
        census.instagram.rows = rows.length;
        census.instagram.unavailableHandles = Array.isArray(listed?.unavailable) ? listed.unavailable : [];
        const { kept, dropped } = filterOwnedPosts(rows, { handles, newerThanMs });
        census.instagram.owned = kept.length;
        census.instagram.dropped = dropped;
        const fetchedAt = stamp();
        const snap = kept.length ? snapshot('instagram', JSON.stringify(kept), 'json') : null;
        for (const row of kept) {
          const source = igSources.find((s) => s.handle === lower(row.handle));
          const post = { shortcode: row.shortcode, ownerUsername: row.ownerUsername, timestamp: row.timestamp,
            caption: row.caption, url: row.url, type: row.type, images: row.images };
          const records = extractRoundupRecords({ source, url: row.url, body: row.caption, post });
          if (!records.length) {
            // Undated caption: a lead only (image-only dates are excluded in v2).
            census.leads.push({ sourceId: source.id, shortcode: row.shortcode, reason: 'no-caption-date' });
            continue;
          }
          // A single post may describe several independent dated events (including
          // an off-site event and a core one). Give each item-bound caption block
          // its own signal so one-form-per-signal cannot bury the core event.
          for (const record of records) addSignal({ sourceId: source.id, url: row.url,
            records: [record], recordId: record.recordId, fetchedAt, snap, extra: { post, title: source.label } });
          census.instagram.signals += records.length;
        }
      } catch (error) {
        census.instagram = { status: 'unavailable', reason: String(error?.code || 'provider-error').slice(0, 40), handles: handles.length };
      }
    }
  }

  // ---- Serper discovery (§4.2): leads only; the fetched page is the evidence ---
  const serperSource = sources.find((s) => s.identityKind === 'news-discovery' && s.enabled !== false);
  if (serperSource) {
    const key = env?.SERPER_API_KEY || '';
    if (!key) {
      census.serper = { ...census.serper, status: 'unavailable', reason: 'missing-key' };
    } else {
      census.serper.status = 'ok';
      const results = [];
      const groupOf = new Map();
      const queries = ROUNDUP_SERPER_QUERIES.slice(0, Math.min(COLLECT_LIMITS.maxSerperCalls, serperSource.maxQueries || 12));
      for (const q of queries) {
        if (census.budget.serperCalls >= COLLECT_LIMITS.maxSerperCalls) break;
        census.budget.serperCalls += 1;
        census.serper.calls += 1;
        let data = null;
        try {
          const init = { method: 'POST', body: JSON.stringify({ q, gl: 'ca', hl: 'en', num: COLLECT_LIMITS.serperResultsPerQuery }),
            headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' } };
          // The API key may only reach the fixed Serper origin: no redirects are followed.
          const res = fetcher
            ? await readResult(await fetcher(serperSource.url, init))
            : await fetchWithRetry(serperSource.url, { ...init, maxRetries: 0, timeoutMs: COLLECT_LIMITS.timeoutMs, guardPublicHttp: true, maxRedirects: 0 })
              .then((r) => ({ status: r.status, body: r.rawText || '' }));
          if (res.status >= 200 && res.status < 300) data = JSON.parse(res.body);
          else census.serper.errors = [...(census.serper.errors || []), `http-${res.status}`];
        } catch {
          census.serper.errors = [...(census.serper.errors || []), 'request-failed'];
        }
        census.serper.queries += 1;
        const news = (Array.isArray(data?.news) ? data.news : [])
          .filter((n) => typeof n?.link === 'string' && /^https:\/\//.test(n.link) && !isUnusableUrl(n.link))
          .filter((n) => !/(^|\.)instagram\.com$/i.test(new URL(n.link).hostname))
          .map((n) => ({ title: String(n.title || ''), link: n.link, query: q }));
        for (const [link, id] of groupResults(news)) if (!groupOf.has(link)) groupOf.set(link, id);
        for (const n of news) if (!results.some((r) => r.link === n.link)) results.push(n);
      }
      census.serper.results = results.length;
      census.serper.groups = new Set(groupOf.values()).size;
      const pageCensus = {};
      for (const result of results) {
        if (budget.used >= COLLECT_LIMITS.maxFetches) {
          pageCensus.budget = (pageCensus.budget || 0) + 1;
          continue;
        }
        const res = await politeFetch(result.link);
        if (!res.ok) {
          pageCensus[res.reason] = (pageCensus[res.reason] || 0) + 1;
          continue;
        }
        const records = extractRoundupRecords({ source: serperSource, url: result.link, body: res.body });
        if (!records.length) {
          pageCensus['no-records'] = (pageCensus['no-records'] || 0) + 1;
          continue;
        }
        const snap = snapshot(serperSource.id, res.body, 'html');
        for (const record of records) addSignal({ sourceId: serperSource.id, url: result.link,
          records: [record], recordId: record.recordId, fetchedAt: stamp(), fetchStatus: res.status, snap,
          extra: { title: result.title, query: result.query, ...(groupOf.has(result.link) ? { groupId: groupOf.get(result.link) } : {}) } });
        census.serper.pages += 1;
      }
      census.serper.pageOutcomes = pageCensus;
    }
  }

  census.robots = await robots.summary();
  census.signals = signals.length;
  writePrivate(path.join(out, 'signals.jsonl'), signals.map((s) => JSON.stringify(s)).join('\n') + (signals.length ? '\n' : ''));
  writePrivate(path.join(out, 'census.json'), JSON.stringify(census, null, 2) + '\n');
  return { signals, census, snapshots };
}
