// Real-store fixtures: a per-test lv_test_* database seeded through the store API,
// and a local HTTP stand-in for Vercel (deploy hook -> build from readLive), Slack
// and the deployed site. No network beyond 127.0.0.1.
import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { testDb } from '../helpers/db.mjs';
import * as store from '../../../scripts/content/store.mjs';
import { candidateDigest, keyOf, registry, serialize } from '../../../scripts/content/canonical.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (rel) => JSON.parse(fs.readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

export const hasTestDb = Boolean(process.env.CONTENT_TEST_DATABASE_URL);

// Small but real slices of every site dataset plus two queue entries.
export function seedRecords() {
  const queue = readJson('data/topic-queue.json').topics.slice(0, 2);
  return {
    businesses: readJson('data/businesses.json').slice(0, 6),
    posts: readJson('data/posts.json').slice(0, 4),
    buildings: readJson('data/buildings.json').slice(0, 2),
    neighborhoods: readJson('data/neighborhoods.json').slice(0, 2),
    services: readJson('data/services.json').slice(0, 3),
    topics: readJson('data/topics.json').slice(0, 3),
    'guide-hub': [readJson('data/guide-hub.json')],
    'topic-queue': queue,
  };
}

// Publish records as one seed submission via the real store (round 0 go).
export async function publishDirect(db, { items, kind = 'seed', idempotencyKey, actor = 'test:seed', assets = [] }) {
  const created = await store.createSubmission(db, { kind, target: db.target, actor, idempotencyKey, items, assets });
  const { token } = await store.claimSubmission(db, created.submissionId, { owner: actor });
  const vector = (await db.query('select * from content.round_items where submission_id=$1 and round=0', [created.submissionId])).rows;
  await store.recordRound(db, created.submissionId, token, {
    round: 0, candidateDigest: candidateDigest(vector), contentSha: 'a'.repeat(40), verdict: null, overall: 10, passed: true, blockingCount: 0, lint: null, decision: 'go',
  });
  const published = await store.publishSubmission(db, created.submissionId, token, { actor });
  return { ...created, ...published, token };
}

export async function seededDb() {
  const handle = await testDb();
  const items = Object.entries(seedRecords()).flatMap(([dataset, records]) => records.map((payload) => ({ dataset, key: keyOf(dataset, payload), payload })));
  const seed = await publishDirect(handle.db, { items, idempotencyKey: 'seed:test' });
  // A seed submission is not a propagation subject in these tests.
  await handle.db.query('update content.submissions set deploy_requested_at=now(),smoke_passed_at=now(),notified_at=now() where id=$1', [seed.submissionId]);
  return handle;
}

// Build what build-export + Next would serve for the DB's current live state.
export async function buildDeployment(db, url, { breakRoutes = [] } = {}) {
  const snapshot = await store.readLive(db);
  const pages = new Map();
  const locs = [];
  const files = {};
  for (const [dataset, value] of Object.entries(snapshot.datasets)) {
    const entry = registry[dataset];
    const text = serialize(dataset, value.records);
    files[entry.file] = sha256(Buffer.from(text));
    pages.set(`/content-snapshot/${entry.file}`, { status: 200, type: 'application/json', body: Buffer.from(text) });
    if (!entry.route) continue;
    for (const record of value.records) {
      const key = keyOf(dataset, record);
      const route = entry.route.replace(':key', key);
      locs.push(`https://libertyvillage.co${route}`);
      const marker = dataset === 'guide-hub' ? record[entry.marker].slice(0, 60) : record[entry.marker];
      const html = breakRoutes.includes(route) ? '<html><body>Application error</body></html>'
        : `<html><head><title>${escapeHtml(marker)} | Liberty Village</title></head><body><main><h1>${escapeHtml(marker)}</h1></main></body></html>`;
      pages.set(route, { status: 200, type: 'text/html; charset=utf-8', body: Buffer.from(html) });
      for (const field of entry.imageFields) {
        const image = record[field];
        if (typeof image === 'string' && image.startsWith('/images/')) pages.set(image, { status: 200, type: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
      }
    }
  }
  for (const asset of snapshot.media) {
    const row = (await db.query('select bytes,content_type from content.assets where path=$1', [asset.path])).rows[0];
    pages.set(asset.path, { status: 200, type: row.content_type, body: row.bytes });
  }
  pages.set('/sitemap.xml', { status: 200, type: 'application/xml', body: Buffer.from(`<urlset>${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`) });
  const datasets = Object.fromEntries(Object.entries(snapshot.datasets).map(([dataset, value]) => [dataset, { count: value.count, digest: value.digest, entries: value.entries }]));
  const manifest = { ...snapshot, datasets, deployment_url: url, files };
  pages.set('/content-snapshot/manifest.json', { status: 200, type: 'application/json', body: Buffer.from(JSON.stringify(manifest)) });
  return { url, pages, liveSeq: snapshot.live_seq };
}

// Local Vercel/Slack stand-in. hook: 'build' (default) | 'accept' (2xx, no build) | status code.
export async function localSite(db) {
  const state = { hook: 'build', hookPosts: 0, slack: [], slackStatus: 200, deployment: null, builds: 0, breakRoutes: [], requests: [] };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      state.requests.push(`${req.method} ${url.pathname}`);
      if (req.method === 'POST' && url.pathname === '/hook') {
        state.hookPosts += 1;
        if (typeof state.hook === 'number') { res.writeHead(state.hook).end('hook error'); return; }
        if (state.hook === 'build') await site.build();
        res.writeHead(201, { 'content-type': 'application/json' }).end('{"job":{"state":"PENDING"}}');
        return;
      }
      if (req.method === 'POST' && url.pathname === '/slack') {
        let body = '';
        for await (const chunk of req) body += chunk;
        if (state.slackStatus === 200) state.slack.push(JSON.parse(body).text);
        res.writeHead(state.slackStatus).end('ok');
        return;
      }
      const page = state.deployment?.pages.get(url.pathname);
      if (!page) { res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404</h1>'); return; }
      res.writeHead(page.status, { 'content-type': page.type }).end(page.body);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const site = {
    state, origin,
    env: { CONTENT_DEPLOY_HOOK_URL: `${origin}/hook`, SLACK_WEBHOOK_URL: `${origin}/slack`, CONTENT_SITE_URL: origin },
    async build() {
      state.builds += 1;
      state.deployment = await buildDeployment(db, `https://dep-${state.builds}.test`, { breakRoutes: state.breakRoutes });
      return state.deployment;
    },
    slackWith: (needle) => state.slack.filter((text) => text.includes(needle)),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
  return site;
}

// Fast smoke timings for tests (real clock).
export const FAST_SMOKE = { intervalMs: 5, getRetryMs: 1, deadlineMs: 400 };

// Submit helpers: a record file + the baseline manifest (readLive minus records).
export async function baselineFile(db) {
  const snapshot = await store.readLive(db);
  const datasets = Object.fromEntries(Object.entries(snapshot.datasets).map(([dataset, value]) => [dataset, { count: value.count, digest: value.digest, entries: value.entries }]));
  const dir = fs.mkdtempSync(`${os.tmpdir()}/lv-baseline-`);
  const file = `${dir}/manifest.json`;
  fs.writeFileSync(file, JSON.stringify({ ...snapshot, datasets }));
  return file;
}

export function tempJson(value, name = 'value.json') {
  const dir = fs.mkdtempSync(`${os.tmpdir()}/lv-json-`);
  fs.writeFileSync(`${dir}/${name}`, JSON.stringify(value, null, 2));
  return `${dir}/${name}`;
}

export async function liveRecord(db, dataset, key) {
  const snapshot = await store.readLive(db, { datasets: [dataset] });
  return snapshot.datasets[dataset].records.find((record) => keyOf(dataset, record) === key);
}
