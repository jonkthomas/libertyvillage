// g7 smoke (§4.6): prove each published item is what the deployed site serves.
//
// Every pass is sandwiched between two reads of the alias manifest (M1/M2). An item
// is judged only once the manifest shows the DB's CURRENT live rev L for it:
//   own (L === published_rev)   -> run its dataset adapter (page present/absent, snapshot);
//   superseded (L !== published) -> resolved once the manifest shows L; the successor's
//                                   own submission carries the page checks.
// A missing/different manifest entry is a freshness condition: keep waiting and never
// compare against an older payload. A pass whose deployment identity changed between
// M1 and M2 is discarded. A failing page check on an own item whose manifest entry is
// its published rev, on a stable identity, is a proven bad render.
import { createHash } from 'node:crypto';

export const SMOKE_INTERVAL_MS = 20_000;
export const SMOKE_DEADLINE_MS = 15 * 60_000;
export const GET_TRIES = 3;
export const GET_RETRY_MS = 10_000;
export const GET_TIMEOUT_MS = 10_000;
// Sitemap URLs are always rendered against the production origin (staging too).
export const CANONICAL_ORIGIN = 'https://libertyvillage.co';
export const MANIFEST_PATH = '/content-snapshot/manifest.json';
export const GUIDE_HUB_MARKER_CHARS = 60;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const itemId = ({ dataset, key }) => `${dataset}\t${key}`;

// React escapes text children as & < > " ' (the apostrophe as &#x27;).
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export function escapedMarkers(text) {
  const base = String(text).replace(/[&<>"]/g, (ch) => ESCAPES[ch]);
  return [...new Set([base.replace(/'/g, '&#x27;'), base.replace(/'/g, '&#39;')])];
}

export function markerFor(dataset, payload, registry) {
  const field = registry?.[dataset]?.marker;
  if (!field || typeof payload?.[field] !== 'string' || payload[field].length === 0) return null;
  return dataset === 'guide-hub' ? payload[field].slice(0, GUIDE_HUB_MARKER_CHARS) : payload[field];
}

export function routeFor(dataset, key, registry) {
  const route = registry?.[dataset]?.route;
  return route ? route.replace(':key', key) : null;
}

// GET against the site origin (paths) or absolute URLs, with the protection bypass
// header when set. Returns {status, contentType, body: Buffer}; network errors
// surface as status 0 so retries treat them like any other failed attempt.
export function createHttp({ siteUrl, bypass = null, fetchImpl = globalThis.fetch, timeoutMs = GET_TIMEOUT_MS }) {
  const origin = String(siteUrl || '').replace(/\/+$/, '');
  if (!origin) throw new Error('smoke requires CONTENT_SITE_URL');
  return {
    origin,
    async get(pathOrUrl) {
      const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${origin}${pathOrUrl}`;
      const headers = { 'cache-control': 'no-cache', ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };
      try {
        const response = await fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        const body = Buffer.from(await response.arrayBuffer());
        return { status: response.status, contentType: response.headers.get('content-type') || '', body };
      } catch (error) {
        return { status: 0, contentType: '', body: Buffer.alloc(0), error: String(error?.message || error) };
      }
    },
  };
}

// items: [{dataset, key, publishedRev}] still unresolved for this submission.
// readCurrent(items) -> Map(itemId -> {rev|null, sha|null, payload|null}): the DB's
// current live rev per item. registry: lib/content/datasets.json shape.
export async function runSmoke({
  liveSeq, items, registry, readCurrent, http,
  now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  intervalMs = SMOKE_INTERVAL_MS, deadlineMs = SMOKE_DEADLINE_MS, getTries = GET_TRIES, getRetryMs = GET_RETRY_MS,
}) {
  const deadline = now() + deadlineMs;
  const resolved = new Map();
  let passes = 0;
  let lastWaiting = [];

  const getUntil = async (target, accept) => {
    let response = null;
    for (let attempt = 1; attempt <= getTries; attempt += 1) {
      response = await http.get(target);
      if (accept(response)) return { ok: true, response };
      if (attempt < getTries) await wait(getRetryMs);
    }
    return { ok: false, response };
  };

  const readManifest = async () => {
    const response = await http.get(MANIFEST_PATH);
    if (response.status !== 200) return null;
    try { return JSON.parse(response.body.toString('utf8')); } catch { return null; }
  };

  const finish = (status, extra = {}) => ({
    status, passes,
    results: items.filter((item) => resolved.has(itemId(item)))
      .map((item) => ({ dataset: item.dataset, key: item.key, smoke: resolved.get(itemId(item)) })),
    pending: items.filter((item) => !resolved.has(itemId(item))).map(({ dataset, key }) => ({ dataset, key })),
    ...extra,
  });

  while (resolved.size < items.length) {
    if (now() >= deadline) return finish('timeout', { waiting: lastWaiting });
    passes += 1;
    const m1 = await readManifest();
    if (!m1 || !(Number(m1.live_seq) >= Number(liveSeq))) {
      lastWaiting = [{ reason: m1 ? `manifest live_seq ${m1.live_seq} < ${liveSeq}` : 'manifest unavailable' }];
      await wait(intervalMs);
      continue;
    }
    const unresolved = items.filter((item) => !resolved.has(itemId(item)));
    const current = await readCurrent(unresolved);
    const passResults = new Map();
    const failures = [];
    const waiting = [];
    let sitemap;
    const sitemapText = async () => {
      if (sitemap === undefined) {
        const got = await getUntil('/sitemap.xml', (response) => response.status === 200);
        sitemap = got.ok ? got.response.body.toString('utf8') : null;
      }
      return sitemap;
    };

    for (const item of unresolved) {
      const live = current.get(itemId(item)) || { rev: null, sha: null, payload: null };
      const liveRev = live.rev ?? null;
      const own = liveRev === (item.publishedRev ?? null);
      const entry = m1.datasets?.[item.dataset]?.entries?.[item.key] ?? null;
      const fresh = liveRev === null ? entry === null : Boolean(entry && entry.rev === liveRev && entry.sha === live.sha);
      if (!fresh) {
        waiting.push({ dataset: item.dataset, key: item.key, reason: `manifest shows ${entry ? `rev ${entry.rev}` : 'no entry'}, DB live ${liveRev === null ? 'absent' : `rev ${liveRev}`}` });
        continue;
      }
      if (!own) { passResults.set(itemId(item), 'superseded'); continue; }
      const check = await checkItem({ item, live, manifest: m1, registry, getUntil, sitemapText });
      if (check.ok) passResults.set(itemId(item), 'passed');
      else failures.push({ dataset: item.dataset, key: item.key, reason: check.reason });
    }

    const m2 = await readManifest();
    if (!m2 || m2.deployment_url !== m1.deployment_url) {
      lastWaiting = [{ reason: 'deployment identity changed during the pass' }];
      await wait(intervalMs);
      continue;
    }
    for (const [id, smoke] of passResults) resolved.set(id, smoke);
    if (failures.length) return finish('bad-render', { failures, deploymentUrl: m1.deployment_url });
    lastWaiting = waiting;
    if (resolved.size < items.length) await wait(intervalMs);
  }
  return finish('passed');
}

// Exact <loc> match, so /directory/x never matches /directory/x-y.
export const sitemapLists = (text, url) => text.includes(`<loc>${url}</loc>`);

async function checkItem({ item, live, manifest, registry, getUntil, sitemapText }) {
  const entry = registry?.[item.dataset];
  if (!entry) return { ok: false, reason: `unknown dataset ${item.dataset}` };
  if (!entry.route) {
    // snapshot adapter (topic-queue, discovery-seen)
    const expected = manifest.files?.[entry.file];
    if (!expected) return { ok: false, reason: `manifest has no files entry for ${entry.file}` };
    const got = await getUntil(`/content-snapshot/${entry.file}`, (response) => response.status === 200 && sha256(response.body) === expected);
    return got.ok ? { ok: true } : { ok: false, reason: `/content-snapshot/${entry.file} does not match the manifest sha256` };
  }
  const route = routeFor(item.dataset, item.key, registry);
  const canonical = `${CANONICAL_ORIGIN}${route}`;
  if (live.rev === null || live.rev === undefined) {
    // page absent: unpublish, or compensation of an insert
    const page = await getUntil(route, (response) => response.status === 404);
    if (!page.ok) return { ok: false, reason: `${route} returned ${page.response?.status}, expected 404` };
    const text = await sitemapText();
    if (text === null) return { ok: false, reason: '/sitemap.xml unavailable' };
    if (sitemapLists(text, canonical)) return { ok: false, reason: `sitemap still lists ${canonical}` };
    return { ok: true };
  }
  const marker = markerFor(item.dataset, live.payload, registry);
  if (!marker) return { ok: false, reason: `${item.dataset}/${item.key} has no marker field` };
  const markers = escapedMarkers(marker);
  const page = await getUntil(route, (response) => response.status === 200
    && markers.some((candidate) => response.body.toString('utf8').includes(candidate)));
  if (!page.ok) return { ok: false, reason: `${route} returned ${page.response?.status} without the ${entry.marker} marker` };
  const text = await sitemapText();
  if (text === null) return { ok: false, reason: '/sitemap.xml unavailable' };
  if (!sitemapLists(text, canonical)) return { ok: false, reason: `sitemap does not list ${canonical}` };
  for (const field of entry.imageFields || []) {
    const image = live.payload?.[field];
    if (typeof image !== 'string' || image.length === 0) continue;
    const media = image.startsWith('/media/') ? (manifest.media || []).find((asset) => asset.path === image) : null;
    if (image.startsWith('/media/') && !media) return { ok: false, reason: `manifest media has no entry for ${image}` };
    const got = await getUntil(image, (response) => response.status === 200 && /^image\//.test(response.contentType)
      && (!media || sha256(response.body) === media.sha256));
    if (!got.ok) return { ok: false, reason: `${image} is not the expected image (HTTP ${got.response?.status})` };
  }
  return { ok: true };
}
