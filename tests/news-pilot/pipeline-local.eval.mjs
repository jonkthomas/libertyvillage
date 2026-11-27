import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { seededDb, hasTestDb } from '../content/fixtures/content-db.mjs';
import { exportContent } from '../../scripts/content/export.mjs';
import { runPublish } from '../../scripts/news-pilot/publish.mjs';
import { AUTO_PUBLISH_CONFIG, prefilterAutoPublishCandidate, rankAutoPublishCandidates } from '../../scripts/news-pilot/publish-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = '2026-11-27T18:00:00.000Z';
const SOURCE = 'https://www.torontohydro.com/outage/fixture-liberty-village';

test('LOCAL DB export reaches a publish-ready dry run behind raw application rows', { skip: !hasTestDb }, async (t) => {
  const scratch = path.join(ROOT, '.pi/scratch/news-yield');
  // Keep generated baselines and verification receipts in ignored project scratch.
  execFileSync('git', ['check-ignore', path.join(scratch, 'local-dryrun.json')], { cwd: ROOT });
  const root = path.join(scratch, `local-eval-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  const handle = await seededDb();
  t.after(() => handle.close());
  assert.match(handle.name, /^lv_test_/);
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(handle.url).hostname));
  const exported = await exportContent(handle.db, { root });
  assert.equal(exported.manifest.db, handle.name);
  const image = path.join(root, 'public/images/og/og-home.jpg');
  fs.mkdirSync(path.dirname(image), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'public/images/og/og-home.jpg'), image);

  // External article transport and model generation are deterministic stand-ins.
  // Evidence extraction, publisher independence and both draft gates are real.
  const body = `<html><head><meta property="article:published_time" content="2026-11-26T12:00:00Z"></head><body><article>
    <h1>Toronto Hydro is responding to a power outage in Liberty Village</h1>
    <p>Toronto Hydro is responding to a power outage in Liberty Village. Crews are working to restore electricity in the neighbourhood.</p>
    <p>The utility's outage notice says service restoration is in progress. Residents can consult the outage notice for updates while crews restore electricity.</p>
    </article></body></html>`;
  let httpRequests = 0;
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/notice');
    httpRequests += 1;
    res.writeHead(200, { 'content-type': 'text/html' }).end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let fetchCalls = 0;
  let modelCalls = 0;
  const post = {
    slug: 'liberty-village-power-outage-local-eval',
    title: 'Toronto Hydro responds to Liberty Village power outage',
    description: 'Crews are working to restore electricity in Liberty Village.',
    content: `Toronto Hydro is responding to a power outage in Liberty Village, according to its [outage notice](${SOURCE}). Crews are working to restore electricity.\n\n## Why this matters in Liberty Village\n\nResidents in Liberty Village can consult the utility's outage notice for updates while crews restore electricity.`,
    publishedAt: '2026-11-27', updatedAt: '2026-11-27', category: 'news',
    tags: ['liberty-village', 'power-outage'],
    answerBlock: 'Toronto Hydro crews are working to restore electricity in Liberty Village.',
    faqs: [{ question: 'Where is the outage?', answer: 'The outage affects Liberty Village.' }],
    keyTakeaways: ['Crews are working to restore electricity.'],
    relatedServices: [], relatedTopics: [], relatedPosts: [], author: 'LibertyVillage.co', image: null,
  };
  const deps = {
    env: {}, log: { log() {}, error() {} },
    fetchFn: async (url, options) => {
      assert.equal(url, SOURCE);
      assert.equal(options.guardPublicHttp, true);
      fetchCalls += 1;
      const response = await fetch(`${origin}/notice`);
      return { ok: response.ok, status: response.status, rawText: await response.text(), contentType: response.headers.get('content-type') };
    },
    resolveModelProvider: async () => ({ ok: true, provider: { id: 'local-fixture', model: 'deterministic-fixture' }, envVar: 'NONE' }),
    generateDraftWithModel: async () => {
      modelCalls += 1;
      return { ok: true, providerId: 'local-fixture', model: 'deterministic-fixture', text: JSON.stringify({ post,
        newsArticleStructuredData: { '@context': 'https://schema.org', '@type': 'NewsArticle',
          headline: post.title, datePublished: post.publishedAt, dateModified: post.updatedAt },
      }) };
    },
  };
  const story = {
    id: 'outage', clusterId: 'outage', isClusterRepresentative: true,
    title: 'Toronto Hydro is responding to a power outage in Liberty Village',
    snippet: 'Crews are working to restore electricity in Liberty Village.',
    url: SOURCE, canonicalUrl: SOURCE, urlUsable: true, clusterHasUsableUrl: true,
    sourceId: 'official-outage-fixture', sourceTier: 'official', publisherDomain: 'torontohydro.com',
    publishedAt: '2026-11-26T12:00:00Z', dateConfidence: 'exact',
    coverageRelation: 'new', alreadyCovered: false, score: { total: 0.397, riskFlags: [] },
  };
  const rawRows = Array.from({ length: 28 }, (_, i) => ({
    ...story, id: `application-${i}`, clusterId: `application-${i}`,
    title: `Development application 26-${i} at 34 Hanna Avenue`, applicationNumber: `26-${i}`,
    score: { total: 0.9, riskFlags: [] },
  }));
  const candidates = [...rawRows, story];
  const beforeConfig = { ...AUTO_PUBLISH_CONFIG, minScore: 0.42 };
  const legacySelection = rankAutoPublishCandidates(candidates).slice(0, 25);
  const beforePrefilters = legacySelection.map((candidate) => prefilterAutoPublishCandidate(candidate, { nowMs: Date.parse(NOW), config: beforeConfig }));
  assert.equal(prefilterAutoPublishCandidate(story, { nowMs: Date.parse(NOW), config: beforeConfig }).code, 'score_below_bar');
  const beforeRun = path.join(root, 'legacy-selection');
  const afterRun = path.join(root, 'current-selection');
  for (const [run, items] of [[beforeRun, legacySelection], [afterRun, candidates]]) {
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'candidates.json'), JSON.stringify({ candidates: items }));
  }
  const baselinePosts = fs.readFileSync(path.join(root, 'data/posts.json'), 'utf8');
  const before = await runPublish({ root, run: beforeRun, out: path.join(root, 'before'), now: NOW, dryRun: true, vault: '/dev/null' }, { ...deps, config: beforeConfig });
  assert.equal(before.status, 'no_eligible_candidate');
  assert.equal(fetchCalls, 0);
  assert.equal(modelCalls, 0);
  const after = await runPublish({ root, run: afterRun, out: path.join(root, 'after'), now: NOW, dryRun: true, vault: '/dev/null' }, deps);
  assert.equal(after.status, 'dry_run_publish', JSON.stringify({ status: after.status, validation: after.validation, ready: after.ready }));
  assert.equal(after.discovered, 29);
  assert.equal(after.evaluated, 1);
  assert.equal(after.categoricalRefused, 28);
  assert.equal(after.passedPrefilter, 1);
  assert.equal(after.passedEvidence, 1);
  assert.equal(after.wouldPublish, 1);
  assert.equal(after.published, 0);
  assert.equal(after.image, AUTO_PUBLISH_CONFIG.neutralFallbackImage);
  assert.equal(fetchCalls, 1);
  assert.equal(httpRequests, 1);
  assert.equal(modelCalls, 1);
  assert.equal(fs.readFileSync(path.join(root, 'data/posts.json'), 'utf8'), baselinePosts);
  const finalValidation = JSON.parse(fs.readFileSync(path.join(root, 'after/final-validation-report.json'), 'utf8'));
  assert.equal(finalValidation.publishReady, true);
  assert.deepEqual(finalValidation.failures, []);
  assert.deepEqual(finalValidation.humanGates, []);
  const receipt = {
    kind: 'local-fixture-dry-run', database: handle.name,
    baseline: 'Legacy raw top-25 selection and .42 floor replayed against the same fixture inventory; not an old-SHA execution.',
    sources: 'Deterministic article served over loopback HTTP; model output is a fixture. No live publisher or model request.',
    before: { discovered: candidates.length, selected: legacySelection.length, evaluated: beforePrefilters.length,
      passedPrefilter: beforePrefilters.filter((p) => p.ok).length, passedEvidence: before.passedEvidence, wouldPublish: before.wouldPublish ?? 0 },
    after: { discovered: after.discovered, evaluated: after.evaluated, categoricalRefused: after.categoricalRefused,
      passedPrefilter: after.passedPrefilter, passedEvidence: after.passedEvidence, wouldPublish: after.wouldPublish },
    finalStatus: after.status, finalValidation: { publishReady: finalValidation.publishReady, failures: [], humanGates: [] },
    postsUnchanged: true, tregFallbackCalls: after.tregFallbackCalls,
  };
  fs.writeFileSync(path.join(scratch, 'local-dryrun.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`LOCAL news funnel ${JSON.stringify(receipt)}`);
});
