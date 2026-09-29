import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededDb, localSite, FAST_SMOKE } from './fixtures/content-db.mjs';
import { submitContent, checkRecordPolicy } from '../../scripts/content/submit.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';
import { planRoundup, buildRoundupPost } from '../../scripts/news-pilot/roundup.mjs';
import { roundupPackDigest } from '../../scripts/news-pilot/roundup-evidence.mjs';

const { gateContent } = await import('../../scripts/content/gate.mjs');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const now = '2026-09-30T12:00:00.000Z';
const source = (id) => ({
  canonicalUrl: 'https://example.org/weekly/' + id, publisher: 'Example', publisherDomain: 'example.org',
  sourceTier: 'official', excerpt: 'Liberty Village community group announced a new local event at Hanna Avenue.',
  extractionSubstantive: true, extractedAt: '2026-09-29T11:00:00.000Z', fetchOk: true, urlUsable: true,
});
const item = (id) => ({
  id, title: 'Liberty Village update ' + id, location: 'Liberty Village', actor: 'Liberty Village community group',
  category: 'community', summary: 'A local event at Hanna Avenue was announced.',
  announcedAt: '2026-09-29T10:00:00.000Z', announcedAtVerified: true,
  riskFlags: [], fingerprint: id, sources: [source(id)],
  claims: [{ text: 'The group announced a local event.', sourceUrl: source(id).canonicalUrl, span: 'announced a new local event' }],
});
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

async function allowRoundupKind(db) {
  // Remove this test-only compatibility shim when migration 0003 adds roundup.
  const constraint = (await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='content.submissions'::regclass and conname='submissions_kind_check'")).rows[0]?.definition || '';
  if (constraint.includes("'roundup'")) return;
  await db.query('alter table content.submissions drop constraint submissions_kind_check');
  await db.query("alter table content.submissions add constraint submissions_kind_check check (kind in ('seed','business','blog','blog-live','news','roundup','seo','topic-discovery','manual','admin'))");
}

function filesFor(items) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-roundup-test-'));
  const pack = { items };
  const plan = planRoundup({ isoWeek: '2026-W40', now, items }, { nowMs: Date.parse(now) });
  const post = buildRoundupPost(plan, { image: '/images/og/og-home.jpg', root: ROOT });
  write(path.join(dir, 'pack.json'), pack);
  write(path.join(dir, 'result.json'), { isoWeek: '2026-W40', slug: plan.slug, now,
    packDigest: roundupPackDigest(pack) });
  write(path.join(dir, 'post.json'), post);
  write(path.join(dir, 'baseline.json'), { datasets: { posts: { entries: {} } } });
  return { dir, plan, post, opts: { recordFile: path.join(dir, 'post.json'), dataset: 'posts',
    baseline: path.join(dir, 'baseline.json'), root: ROOT, roundupOut: dir } };
}

async function setup() {
  const handle = await seededDb();
  await allowRoundupKind(handle.db);
  const site = await localSite(handle.db);
  await site.build();
  return { ...handle, site, closeAll: async () => { await site.close(); await handle.close(); } };
}

test('DB submit accepts two item roundup and one item weekly update; blog/news bypass refused', async () => {
  for (const [count, suffix] of [[2, 'two'], [1, 'one']]) {
    const ctx = await setup();
    try {
      const f = filesFor(Array.from({ length: count }, (_, n) => item(suffix + n)));
      const submitted = await submitContent(ctx.db, { ...f.opts, kind: 'roundup', actor: 'uat:roundup',
        idempotencyKey: 'roundup-' + suffix }, { checkout: ROOT });
      assert.ok(submitted.result.submissionId);
      assert.equal(submitted.result.items[0].key, f.plan.slug);
      if (count === 1) assert.match(f.post.description, /weekly update/);
      const blog = { ...f.post, slug: f.post.slug + '-blog' };
      write(path.join(f.dir, 'post.json'), blog);
      await assert.rejects(submitContent(ctx.db, { ...f.opts, kind: 'blog', actor: 'uat:roundup',
        idempotencyKey: 'bypass-blog-' + suffix }, { checkout: ROOT }), /blog kind may not submit news/);
      const newsCheck = checkRecordPolicy({ kind: 'news', item: { dataset: 'posts', key: f.plan.slug,
        op: 'insert', payload: f.post }, deps: { validateRecord } });
      assert.match(newsCheck.errors.join('; '), /news kind may not submit a weekly roundup slug/);
      write(path.join(f.dir, 'post.json'), f.post);
      const newsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-roundup-news-bypass-'));
      write(path.join(newsDir, 'result.json'), { published: 1, slug: f.plan.slug, clusterId: 'x', now });
      write(path.join(newsDir, 'evidence-x.json'), {});
      await assert.rejects(submitContent(ctx.db, { ...f.opts, kind: 'news', newsOut: newsDir,
        actor: 'uat:roundup', idempotencyKey: 'bypass-news-' + suffix }, { checkout: ROOT }),
      /news kind may not submit a weekly roundup slug/);
    } finally { await ctx.closeAll(); }
  }
});

test('link-only mention of a refused item is rejected at submit', async () => {
  const ctx = await setup();
  try {
    const risky = { ...item('risk'), riskFlags: ['crime'] };
    const f = filesFor([item('safe'), risky]);
    const safe = await submitContent(ctx.db, { ...f.opts, kind: 'roundup', actor: 'uat:roundup',
      idempotencyKey: 'safe-with-refused-census' }, { checkout: ROOT });
    assert.ok(safe.result.submissionId);
    const post = { ...f.post, content: f.post.content + '\n\nAlso see [this story](' + source('risk').canonicalUrl + ').' };
    write(path.join(f.dir, 'post.json'), post);
    await assert.rejects(submitContent(ctx.db, { ...f.opts, kind: 'roundup', actor: 'uat:roundup',
      idempotencyKey: 'risky-link' }, { checkout: ROOT }), /outside accepted pack/);
  } finally { await ctx.closeAll(); }
});

test('DB-backed scripted gate retains 8 threshold and HIGH blocker for roundup', async () => {
  for (const [overall, findings, expected] of [
    [7.99, [], false], [8, [{ severity: 'high', file: 'data/posts.json', line: 1, note: 'unsupported' }], false],
    [8, [], true],
  ]) {
    const ctx = await setup();
    try {
      const f = filesFor([item('gate-a'), item('gate-b')]);
      const submitted = await submitContent(ctx.db, { ...f.opts, kind: 'roundup', actor: 'uat:roundup',
        idempotencyKey: 'gate-' + overall + '-' + findings.length }, { checkout: ROOT });
      const script = path.join(f.dir, 'script.json');
      write(script, { reviews: [{ overall, findings }] });
      const gated = await gateContent(ctx.db, { submission: submitted.result.submissionId, script, actor: 'uat:roundup' },
        { env: ctx.site.env, deps: { smoke: FAST_SMOKE }, checkout: ROOT });
      assert.equal(gated.exitCode === 0, expected, JSON.stringify(gated.result));
      const row = (await ctx.db.query('select overall,passed,blocking_count from content.gate_rounds where submission_id=$1 order by round desc limit 1',
        [submitted.result.submissionId])).rows[0];
      assert.equal(row.passed, expected);
    } finally { await ctx.closeAll(); }
  }
});
