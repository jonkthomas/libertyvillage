import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  trailingWindow, gscWeeks, parseRun, parseRuns, summarizeRuns, failureRows,
  postedFromSitemap, buildModel, slackMessage,
} from '../../ops/weekly-digest/lib/digest.mjs';
import { gscDelta } from '../../ops/weekly-digest/lib/fetchers.mjs';
import { renderHtml } from '../../ops/weekly-digest/lib/render.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

const FROM = '2026-10-20T00:00:00.000Z';
const TO = '2026-10-27T00:00:00.000Z';

function fixtureFiles() {
  const files = {};
  for (const f of fs.readdirSync(fixtures)) {
    if (f.endsWith('.jsonl')) files[f] = read(f);
  }
  return files;
}

test('parseRun tolerates malformed lines and missing fields', () => {
  const run = parseRun('weekly-blog-production-20261020T1100-scheduled.jsonl',
    read('weekly-blog-production-20261020T1100-scheduled.jsonl'));
  assert.equal(run.job, 'weekly-blog');
  assert.equal(run.target, 'production');
  assert.equal(run.outcome, 'failure');
  assert.equal(run.error, 'cli-validation exit 2');
  assert.equal(run.detail, 'cli: validate');
  assert.equal(run.badLines, 1); // the "not json at all" line is skipped, counted
  assert.equal(run.sha, 'f0b8cd57');
  assert.ok(run.events >= 5);
});

test('success with reason and noChanges is parsed, not a failure', () => {
  const run = parseRun('news-production-20261021T1217-scheduled.jsonl',
    read('news-production-20261021T1217-scheduled.jsonl'));
  assert.equal(run.outcome, 'success');
  assert.equal(run.reason, 'no items passed the evidence bar');
});

test('sticky outcomes: hold-then-success stays held; failure beats later success', () => {
  const held = parseRun('weekly-roundup-production-20261023T1000-scheduled.jsonl',
    read('weekly-roundup-production-20261023T1000-scheduled.jsonl'));
  assert.equal(held.outcome, 'held'); // the runner emits hold-alerted BEFORE success
  const failThenOk = parseRun('x.jsonl',
    '{"at":"2026-10-21T01:00:00Z","event":"start","job":"news","target":"production"}\n' +
    '{"at":"2026-10-21T01:05:00Z","event":"failure","error":"gate exit 2"}\n' +
    '{"at":"2026-10-21T01:06:00Z","event":"success","result":{"id":"n1"}}\n');
  assert.equal(failThenOk.outcome, 'failure');
});

test('alert-failed marks a run failed with its error', () => {
  const run = parseRun('topic-discovery-production-20261022T1000-scheduled.jsonl',
    read('topic-discovery-production-20261022T1000-scheduled.jsonl'));
  assert.equal(run.outcome, 'failure');
  assert.equal(run.error, 'slack webhook 503');
});

test('parseRuns keeps only in-window runs and sorts by start time', () => {
  const runs = parseRuns(fixtureFiles(), FROM, TO);
  const jobs = runs.map((r) => r.job);
  // discover-businesses started Sep 28 -> outside the window
  assert.ok(!jobs.includes('discover-businesses'));
  // chronological by start time
  const starts = runs.map((r) => Date.parse(r.startedAt));
  assert.deepEqual([...starts].sort((a, b) => a - b), starts);
  assert.ok(jobs.includes('weekly-blog'));
  assert.ok(jobs.includes('news'));
  assert.ok(jobs.includes('topic-discovery'));
});

test('failures MUST surface: failureRows lists every failed run + stale incompletes', () => {
  const runs = parseRuns(fixtureFiles(), FROM, TO);
  const failures = failureRows(runs, TO);
  assert.equal(failures.length, 3, `expected 3 failures (2 failures + 1 stale incomplete), got ${failures.length}`);
  const reasons = failures.map((f) => f.reason).sort();
  assert.deepEqual(reasons, [
    'cli-validation exit 2',
    'no terminal event (killed/timeout/reboot?)',
    'slack webhook 503',
  ]);
});

test('a recent incomplete run is not a failure yet', () => {
  const runs = [parseRun('news.jsonl',
    '{"at":"2026-10-26T20:00:00Z","event":"start","job":"news","target":"production"}')];
  assert.deepEqual(failureRows(runs, '2026-10-26T22:00:00.000Z'), []); // started 2h ago
});

test('summarizeRuns counts outcomes per job', () => {
  const runs = parseRuns(fixtureFiles(), FROM, TO);
  const { summary, byJob } = summarizeRuns(runs);
  assert.equal(summary.total, 5);
  assert.equal(summary.success, 1);
  assert.equal(summary.failure, 2);
  assert.equal(summary.held, 1);
  assert.equal(summary.incomplete, 1);
  const blog = byJob.find((j) => j.job === 'weekly-blog');
  assert.equal(blog.failure, 1);
});

test('postedFromSitemap: only lastmod inside the window; missing lastmod skipped', () => {
  const items = postedFromSitemap(read('sitemap.xml'), FROM, TO);
  assert.deepEqual(items.map((i) => i.section), ['blog', 'blog']);
  assert.ok(items.every((i) => Date.parse(i.lastmod) >= Date.parse(FROM)));
  const urls = items.map((i) => i.url);
  assert.ok(!urls.includes('https://libertyvillage.co/blog/old-post'));
  assert.ok(!urls.includes('https://libertyvillage.co/news/index')); // no lastmod
});

test('renderHtml keeps failures and posted pages visible on the page', () => {
  const runs = parseRuns(fixtureFiles(), FROM, TO);
  const posted = postedFromSitemap(read('sitemap.xml'), FROM, TO);
  const model = buildModel({
    generatedAt: '2026-10-27T12:00:00.000Z',
    window: { from: FROM, to: TO },
    runs, posted,
    titles: { 'https://libertyvillage.co/blog/parking-guide': 'Parking in Liberty Village' },
    queue: { held: true, timers: [{ unit: 'lv-runner-news.timer', next: '2026-10-28 12:17 UTC', schedule: 'Tue..Sun 12:17 UTC' }] },
    gsc: {
      source: 'test', note: 'unit fixture',
      weeks: [
        { start: '2026-10-06', end: '2026-10-12', clicks: 100, impressions: 4000, ctr: 0.025, position: 12.5 },
        { start: '2026-10-13', end: '2026-10-19', clicks: 120, impressions: 4500, ctr: 0.027, position: 11.9 },
      ],
      topQueries: [{ keys: ['liberty village coffee'], clicks: 30, impressions: 900, position: 4.2 }],
      topPages: [{ keys: ['https://libertyvillage.co/blog/best-coffee-shops'], clicks: 25, impressions: 700, position: 3.8 }],
    },
    notes: ['test note'],
    links: { digestUrl: 'https://example/digest' },
  });
  const html = renderHtml(model);
  // A regression that hides failures or posted pages must fail these asserts.
  assert.ok(html.includes('cli-validation exit 2'), 'failure reason missing from HTML');
  assert.ok(html.includes('slack webhook 503'), 'alert-failed reason missing from HTML');
  // The Failures table itself must carry them (not just the runs table Note column).
  const failuresSection = html.split('<h2>Failures')[1]?.split('<h2>')[0] ?? '';
  assert.ok(failuresSection.includes('cli-validation exit 2'), 'Failures table empty or missing reason');
  assert.ok(failuresSection.includes('slack webhook 503'), 'Failures table missing alert-failed row');
  assert.ok(html.includes('Parking in Liberty Village'), 'posted title missing from HTML');
  assert.ok(html.includes('blog/parking-guide'), 'posted link missing from HTML');
  assert.ok(html.includes('loops HELD'), 'held state missing from HTML');
  assert.ok(html.includes('liberty village coffee'), 'top query missing from HTML');
  assert.ok(!html.includes('<script'), 'digest must be JS-free');
});

test('slackMessage summarizes counts and links the digest', () => {
  const runs = parseRuns(fixtureFiles(), FROM, TO);
  const model = buildModel({
    generatedAt: '2026-10-27T12:00:00.000Z', window: { from: FROM, to: TO }, runs,
    posted: postedFromSitemap(read('sitemap.xml'), FROM, TO),
    queue: { held: true, timers: [] },
    gsc: { source: 'test', weeks: [{ clicks: 120, impressions: 4500 }], delta: { clicksPct: 20 } },
    links: { digestUrl: 'https://example/d' },
  });
  const msg = slackMessage(model);
  assert.ok(msg.includes('2 failed'), msg);
  assert.ok(msg.includes('HELD'), msg);
  assert.ok(msg.includes('2 page(s)'), msg);
  assert.ok(msg.includes('+20% WoW'), msg);
  assert.ok(msg.endsWith('https://example/d'));
});

test('gscWeeks returns two complete Mon–Sun weeks ending before now', () => {
  // 2026-10-27 is a Tuesday; latest complete week = Mon 2026-10-19 → Sun 2026-10-25.
  const weeks = gscWeeks(new Date('2026-10-27T12:00:00Z'));
  assert.equal(weeks.length, 2);
  assert.deepEqual(weeks[1], { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(weeks[0], { start: '2026-10-12', end: '2026-10-18' });
});

test('gscDelta computes week-over-week percentages', () => {
  const d = gscDelta([
    { clicks: 100, impressions: 4000, ctr: 0.025, position: 12.5 },
    { clicks: 120, impressions: 3600, ctr: 0.033, position: 11.9 },
  ]);
  assert.equal(d.clicksPct, 20);
  assert.equal(d.impressionsPct, -10);
  assert.equal(d.position, -0.6);
});

test('trailingWindow is 7 days', () => {
  const w = trailingWindow('2026-10-27T12:00:00Z');
  assert.equal(w.to, '2026-10-27T12:00:00.000Z');
  assert.equal(w.from, '2026-10-20T12:00:00.000Z');
});

test('parseRun falls back to filename when the start line lacks job fields', () => {
  const run = parseRun('weekly-blog-staging-x1.jsonl',
    '{"at":"2026-10-21T01:02:03Z","event":"start"}\n{"at":"2026-10-21T01:03:03Z","event":"failure"}\n');
  assert.equal(run.job, 'weekly-blog');
  assert.equal(run.target, 'staging');
  assert.equal(run.outcome, 'failure');
});
