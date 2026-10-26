// "Refreshed this week": the runner's refresh-outcome log lines (written with the
// refresh loop's own refreshLogLine) become a digest section with before/after
// title and description, the change summary and the baseline search metrics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, parseRun } from '../../ops/weekly-digest/lib/digest.mjs';
import { renderHtml } from '../../ops/weekly-digest/lib/render.mjs';
import { renderRefreshed } from '../../ops/weekly-digest/lib/refreshed.mjs';
import { refreshLogLine } from '../../scripts/content/refresh.mjs';

const at = (t) => `2026-10-27T${t}Z`;
const line = (time, event, details = {}) => JSON.stringify({ at: at(time), event, ...details });
const published = refreshLogLine({
  snapshotId: 7, slug: 'parking-guide', url: 'https://libertyvillage.co/blog/parking-guide', mode: 'snippet', state: 'published', reasonCode: null, submissionId: 41,
  targetQuery: 'liberty village parking', baseline: { clicks: 4, impressions: 2000, ctr: 0.002, position: 14.2 },
  before: { title: 'Parking in Liberty Village', description: 'Where to park.' },
  after: { title: 'Liberty Village Parking: Lots, Rates & Street Rules', description: 'Every lot and street rule in one place.' },
  change: 'Changed title; description; body +420 chars, +2 sections; FAQs 4→6',
});
const failed = refreshLogLine({
  snapshotId: 8, slug: 'dog-parks', url: 'https://libertyvillage.co/blog/dog-parks', mode: 'full', state: 'failed', reasonCode: 'refresh-gate-failed',
  baseline: { clicks: 10, impressions: 1000, ctr: 0.01, position: 3 }, before: { title: 'Dog Parks', description: 'Off-leash areas.' }, after: null, change: null,
});
const LOG = [
  line('04:23:00', 'start', { job: 'seo-improvements', target: 'production', slot: '202610270423-scheduled' }),
  line('04:24:00', 'refresh-plan', { isoWeek: '2026-W44', remaining: 2 }),
  line('05:10:00', 'refresh-outcome', published),
  line('05:55:00', 'refresh-outcome', failed),
  line('05:56:00', 'success', { result: { reason: 'refreshed 1 of 2', noChanges: false } }),
].join('\n');

test('digest renders "Refreshed this week" with before/after and baseline metrics from runner log lines', () => {
  const run = parseRun('seo-improvements-production-202610270423-scheduled.jsonl', LOG);
  assert.equal(run.outcome, 'success');
  assert.equal(run.reason, 'refreshed 1 of 2');
  const model = buildModel({ generatedAt: '2026-11-02T13:00:00.000Z', window: { from: '2026-10-26T12:00:00.000Z', to: '2026-11-02T12:00:00.000Z' }, runs: [run], posted: [] });
  assert.deepEqual(model.refreshes.map((r) => [r.slug, r.state, r.target]), [['parking-guide', 'published', 'production'], ['dog-parks', 'failed', 'production']]);
  const html = renderHtml(model);
  const section = html.slice(html.indexOf('<h2>Refreshed this week</h2>'), html.indexOf('<h2>What went wrong'));
  assert.ok(section.length > 30, 'section present before the problems section');
  assert.match(section, /<s class="dim">Parking in Liberty Village<\/s><br>Liberty Village Parking: Lots, Rates &amp; Street Rules/);
  assert.match(section, /<s class="dim">Where to park\.<\/s><br>Every lot and street rule in one place\./);
  assert.match(section, /body \+420 chars, \+2 sections; FAQs 4→6/);
  assert.match(section, /4 clicks · 2,000 impressions · 0\.2% CTR · position 14\.2 · top search “liberty village parking”/);
  assert.match(section, /Dog Parks<\/a><\/b><span class="tag">full rewrite<\/span><span class="tag">not changed/);
  assert.match(section, /Lots, Rates &amp; Street Rules<\/a><\/b><span class="tag">snippet: title, description, intro<\/span><span class="tag">refreshed/);
  assert.match(section, /0 full rewrites · 1 snippet-only/, 'the lane count covers only refreshes that went live');
  assert.equal(published.actionType, 'snippet', 'the log line carries the ledger action type');
  assert.match(section, /Refresh did not pass the quality review\. .*The live page was left as it was\./);
  assert.doesNotMatch(section, /refresh-gate-failed/, 'raw codes stay out of the page');
});

test('section degrades: no refreshes, staging-only refreshes, malformed lines', () => {
  assert.match(renderRefreshed([]), /No posts were refreshed this week\./);
  const staging = parseRun('seo-improvements-staging-x.jsonl', [line('01:00:00', 'start', { job: 'seo-improvements', target: 'staging', slot: 'x' }), line('01:05:00', 'refresh-outcome', published)].join('\n'));
  const html = renderRefreshed(buildModel({ generatedAt: at('02:00:00'), window: { from: at('00:00:00'), to: at('03:00:00') }, runs: [staging] }).refreshes);
  assert.match(html, /No posts were refreshed this week\.[\s\S]*Test site only.*parking-guide \(snippet, published\)/);
  const junk = parseRun('j.jsonl', [line('01:00:00', 'start', { job: 'seo-improvements', target: 'production', slot: 'y' }), line('01:01:00', 'refresh-outcome', { slug: 42, before: 'x', baseline: null })].join('\n'));
  assert.doesNotThrow(() => renderRefreshed(junk.refreshes));
});
