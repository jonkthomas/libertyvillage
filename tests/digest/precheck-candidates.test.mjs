import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRuns, buildModel } from '../../ops/weekly-digest/lib/digest.mjs';
import { renderHtml } from '../../ops/weekly-digest/lib/render.mjs';

test('weekly digest lists recurring codes as candidate precheck, deduplicates snapshots, and includes voice warnings', () => {
  const window = { from: '2026-10-26T00:00:00Z', to: '2026-11-02T00:00:00Z' };
  const log = (slot, events, target = 'production', at = '2026-10-27T04:23:00Z') => [
    { event: 'start', job: 'seo-improvements', target, slot, at }, ...events.map((e) => ({ at, ...e })),
    { event: 'success', at },
  ].map(JSON.stringify).join('\n');
  const outcome = (snapshotId, reasonCode) => ({ event: 'refresh-outcome', snapshotId, state: 'failed', reasonCode,
    refusalDetail: { failures: [{ code: 'unsupported-address' }] } });
  const files = {
    'a.jsonl': log('a', [outcome(8, 'refresh-fact-check'), outcome(8, 'refresh-fact-check'), outcome(9, 'refresh-fact-check'),
      { event: 'lv-voice-warning', ruleCodes: ['voice-banned-phrase', '<private prose>'] }]),
    'b.jsonl': log('b', [outcome(9, 'refresh-fact-check'), { event: 'refresh-outcome', snapshotId: 10, state: 'published', reasonCode: null }]),
    'old.jsonl': log('old', [outcome(7, 'refresh-fact-check')], 'production', '2026-10-20T04:23:00Z'),
    'blog.jsonl': log('blog', [{ event: 'gate', id: 11, exit: 2, decision: 'lint', message: '[unsupported-price] private claim' },
      { event: 'gate', id: 11, exit: 2, decision: 'lint', message: '[unsupported-price] private claim' },
      { event: 'gate', id: 12, exit: 2, decision: 'lint', message: '[unsupported-price] private claim' }]),
  };
  const model = buildModel({ generatedAt: window.to, window, runs: parseRuns(files, window.from, window.to) });
  assert.deepEqual(model.precheckCandidates, [
    { code: 'blog-lint', count: 2, candidatePrecheck: true },
    { code: 'blog-lint:unsupported-price', count: 2, candidatePrecheck: true },
    { code: 'refresh-fact-check', count: 2, candidatePrecheck: true },
    { code: 'unsupported-address', count: 2, candidatePrecheck: true },
  ]);
  const html = renderHtml(model);
  assert.match(html, /refresh-fact-check: 2 — candidate precheck/);
  assert.match(html, /Voice warnings in 1 run event\(s\), warn-only since 2026-10-27: voice-banned-phrase/);
  assert.doesNotMatch(html.slice(html.indexOf('<summary>Writer diagnostics')), /private claim|private prose/);
});
