// Fake deployed site for smoke tests: renders what build-export + Next would
// serve for a given live DB state, behind a deployment identity, plus a virtual clock.
import { createHash } from 'node:crypto';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
export const recordSha = (record) => sha256(JSON.stringify(record));

// Live DB stand-in: entries[dataset][key] = {rev, payload}; revs keep every payload.
export function fakeLive() {
  const entries = {};
  return {
    entries,
    set(dataset, key, rev, payload) {
      entries[dataset] ??= {};
      entries[dataset][key] = rev === null ? null : { rev, payload, sha: recordSha(payload) };
    },
    // smoke's readCurrent adapter shape
    async readCurrent(items) {
      return new Map(items.map((item) => {
        const entry = entries[item.dataset]?.[item.key] ?? null;
        return [`${item.dataset}\t${item.key}`, entry ? { rev: entry.rev, sha: entry.sha, payload: entry.payload } : { rev: null, sha: null, payload: null }];
      }));
    },
  };
}

// Freeze the current live state into a deployment (the build export).
export function buildDeployment({ live, liveSeq, url, registry, media = {}, breakPages = [], breakFiles = [] }) {
  const pages = new Map();
  const manifest = { schema: 1, live_seq: liveSeq, snapshot_id: `snap-${liveSeq}`, deployment_url: url, datasets: {}, media: [], files: {} };
  const locs = [];
  for (const [dataset, keys] of Object.entries(live.entries)) {
    const entry = registry[dataset];
    manifest.datasets[dataset] = { entries: {} };
    const records = [];
    for (const [key, value] of Object.entries(keys)) {
      if (!value) continue;
      manifest.datasets[dataset].entries[key] = { rev: value.rev, sha: value.sha };
      records.push(value.payload);
      if (!entry.route) continue;
      const route = entry.route.replace(':key', key);
      locs.push(`https://libertyvillage.co${route}`);
      const marker = dataset === 'guide-hub' ? value.payload[entry.marker].slice(0, 60) : value.payload[entry.marker];
      const html = breakPages.includes(route) ? '<html><body>Something went wrong</body></html>'
        : `<html><head><title>${escapeHtml(marker)}</title></head><body><h1>${escapeHtml(marker)}</h1></body></html>`;
      pages.set(route, { status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(html) });
      for (const field of entry.imageFields || []) {
        const image = value.payload[field];
        if (!image) continue;
        const bytes = media[image] ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(image)]);
        pages.set(image, { status: 200, contentType: 'image/jpeg', body: bytes });
        if (image.startsWith('/media/')) manifest.media.push({ path: image, sha256: sha256(bytes), byte_size: bytes.length });
      }
    }
    const text = Buffer.from(`${JSON.stringify(dataset === 'topic-queue' ? { version: 1, topics: records } : records, null, 2)}\n`);
    manifest.files[entry.file] = sha256(text);
    pages.set(`/content-snapshot/${entry.file}`, {
      status: 200, contentType: 'application/json',
      body: breakFiles.includes(entry.file) ? Buffer.from('{"tampered":true}\n') : text,
    });
  }
  pages.set('/sitemap.xml', { status: 200, contentType: 'application/xml', body: Buffer.from(`<urlset>${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`) });
  pages.set('/content-snapshot/manifest.json', { status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(manifest)) });
  return { url, pages };
}

// The alias: serves whichever deployment is current; hooks can swap it per request.
export function fakeAlias(initial) {
  const state = { current: initial, requests: [], onRequest: null };
  return {
    state,
    promote(deployment) { state.current = deployment; },
    http: {
      async get(target) {
        state.requests.push(target);
        if (state.onRequest) state.onRequest(target, state);
        const page = state.current?.pages.get(target);
        return page ? { ...page } : { status: 404, contentType: 'text/html', body: Buffer.from('not found') };
      },
    },
  };
}

export function virtualClock(start = Date.parse('2026-09-27T12:00:00Z')) {
  const clock = { t: start, waits: [], hooks: [] };
  clock.now = () => clock.t;
  clock.wait = async (ms) => {
    clock.waits.push(ms);
    clock.t += ms;
    for (const hook of clock.hooks) hook(clock.t);
  };
  return clock;
}
