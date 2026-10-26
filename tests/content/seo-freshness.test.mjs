import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseClaim } from '../../scripts/content/store.mjs';
import { deployContent } from '../../scripts/content/deploy.mjs';
import { seededDb, publishDirect, localSite, FAST_SMOKE, seedRecords } from './fixtures/content-db.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const key = '0f21be7a52664dbaae2fa2c782608b18';
const endpoint = 'https://api.indexnow.org/indexnow';
const datasets = ['services', 'neighborhoods', 'businesses', 'topics', 'posts', 'buildings'];

test('sitemap uses fixture updatedAt for every entity, with stable static dates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lv-seo-sitemap-'));
  try {
    await mkdir(path.join(root, 'data'));
    for (const dataset of datasets) await writeFile(path.join(root, 'data', `${dataset}.json`), JSON.stringify([
      { slug: `${dataset}-fixture`, updatedAt: '2026-01-12T14:30:00Z', publishedAt: '2025-12-01' },
      { slug: `${dataset}-unknown` },
    ]));
    const source = `process.chdir(${JSON.stringify(root)}); const imported = await import(${JSON.stringify(path.join(repo, 'app/sitemap.ts'))}); const sitemap = imported.default; console.log(JSON.stringify((typeof sitemap === "function" ? sitemap : sitemap.default)()));`;
    const rows = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { cwd: repo, encoding: 'utf8' }));
    for (const dataset of datasets) {
      assert.equal(rows.find((row) => row.url.endsWith(`${dataset}-fixture`)).lastModified, '2026-01-12T14:30:00Z');
      assert.equal(rows.find((row) => row.url.endsWith(`${dataset}-unknown`)).lastModified, undefined);
    }
    const home = rows.find((row) => row.url === 'https://libertyvillage.co');
    assert.equal(home.lastModified, '2026-08-10');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('build generation reads fixture exports and includes newly added and World Cup posts in both files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lv-seo-llms-'));
  try {
    await mkdir(path.join(root, 'data'));
    for (const dataset of datasets) await writeFile(path.join(root, 'data', `${dataset}.json`), '[]');
    const records = [
      { slug: 'fixture-post', title: 'Fixture Post', description: 'A fixture description.', answerBlock: 'A fuller fixture summary with local details.' },
      { slug: 'world-cup-fixture', title: 'World Cup Fixture', description: 'Historical World Cup coverage.' },
    ];
    await writeFile(path.join(root, 'data/posts.json'), JSON.stringify(records));
    // Resolve the actual prebuild command, not an independently maintained test hook.
    const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
    const generator = pkg.scripts.prebuild.split(' && ')[1];
    assert.ok(generator, 'prebuild must regenerate llms after the content export');
    const run = () => execFileSync(process.execPath, [path.join(repo, generator.replace(/^node /, ''))], { cwd: root });
    run();
    records.push({ slug: 'brand-new-post', title: 'Brand New Post', description: 'Newly published local news.', content: 'Fuller content from the new post.' });
    await writeFile(path.join(root, 'data/posts.json'), JSON.stringify(records));
    run();
    for (const file of ['llms.txt', 'llms-full.txt']) {
      const text = await readFile(path.join(root, 'public', file), 'utf8');
      assert.match(text, /https:\/\/libertyvillage.co\/blog\/brand-new-post/);
      assert.match(text, /World Cup Fixture/);
      assert.match(text, /A fixture description/);
      if (file === 'llms-full.txt') assert.match(text, /Fuller content from the new post/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function deployFixture({ enabled, failure = false, hook = 'build', count = 2 } = {}) {
  const handle = await seededDb();
  const site = await localSite(handle.db);
  const calls = [], logs = [];
  try {
    site.state.hook = hook;
    const post = seedRecords().posts[0];
    const items = Array.from({ length: count }, (_, i) => ({ dataset: 'posts', expectedLiveRev: i === 0 ? 1 : null, key: i === 0 ? post.slug : `seo-post-${i}`, payload: { ...post, slug: i === 0 ? post.slug : `seo-post-${i}`, updatedAt: '2026-10-25' } }));
    // Use separate submissions to prove the per-run cap spans the deploy replay.
    for (let i = 0; i < items.length; i++) {
      const published = await publishDirect(handle.db, { items: [items[i]], kind: 'manual', idempotencyKey: `seo-${i}` });
      await releaseClaim(handle.db, published.submissionId, published.token);
    }
    const result = await deployContent(handle.db, {}, {
      env: { ...site.env, ...(enabled === undefined ? {} : { INDEXNOW_ENABLED: enabled }) },
      deps: { smoke: FAST_SMOKE, indexNowLog: (line) => logs.push(line), fetchImpl: async (url, init) => {
        if (url !== endpoint) return fetch(url, init);
        assert.ok(site.state.builds > 0, 'deploy hook must have built successfully first');
        calls.push(JSON.parse(init.body));
        if (failure) throw new Error('local simulated network failure');
        return new Response('', { status: 200 });
      } },
    });
    return { result, calls, logs, origin: site.origin };
  } finally { await site.close(); await handle.close(); }
}

test('successful publish/refresh deploy sends changed URLs and the served key', async () => {
  const { result, calls, origin } = await deployFixture({ enabled: '1' });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.flatMap((call) => call.urlList), [`${origin}/blog/${seedRecords().posts[0].slug}`, `${origin}/blog/seo-post-1`]);
  for (const call of calls) {
    assert.equal(call.key, key);
    assert.equal(call.host, new URL(origin).host);
    assert.equal(call.keyLocation, `${origin}/${key}.txt`);
  }
  assert.equal((await readFile(path.join(repo, 'public', `${key}.txt`), 'utf8')).trim(), key);
});

test('IndexNow defaults off for local/staging, and explicit disable skips it', async () => {
  for (const enabled of [undefined, '0']) {
    const { result, calls } = await deployFixture({ enabled });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(calls, []);
  }
});

test('IndexNow network failure is logged and never fails the deploy', async () => {
  const { result, calls, logs } = await deployFixture({ enabled: '1', failure: true });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(calls.length, 2);
  assert.ok(logs.some((line) => line.includes('request failed')));
});

test('failed deployment never pings IndexNow', async () => {
  const { result, calls } = await deployFixture({ enabled: '1', hook: 500 });
  assert.equal(result.exitCode, 3);
  assert.deepEqual(calls, []);
});

test('IndexNow caps changed URLs across the entire deploy run', async () => {
  const { result, calls } = await deployFixture({ enabled: '1', count: 22 });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(calls.flatMap((call) => call.urlList).length, 20);
});
