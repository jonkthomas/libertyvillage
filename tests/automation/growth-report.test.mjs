import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertSafeReport,
  buildGrowthReport,
  buildWeeklyWindows,
  metricDelta,
  normalizeGscDetails,
  normalizeGscTotals,
  normalizePosthogTotals,
  renderGrowthMarkdown,
} from '../../scripts/lib/growth-report.mjs';
import {
  buildPosthogLandingQuery,
  buildPosthogTotalsQuery,
} from '../../scripts/generate-weekly-growth-report.mjs';

const fixture = JSON.parse(fs.readFileSync('tests/fixtures/weekly-growth-input.json', 'utf8'));
const windows = buildWeeklyWindows({ endDate: fixture.endDate });

function fixtureReport() {
  return buildGrowthReport({
    generatedAt: fixture.generatedAt,
    windows,
    weekly: fixture.weekly,
    top: fixture.top,
  });
}

test('weekly windows are four contiguous non-overlapping finalized Monday-Sunday buckets', () => {
  assert.deepEqual(windows, [
    { start: '2026-07-06', end: '2026-07-12' },
    { start: '2026-07-13', end: '2026-07-19' },
    { start: '2026-07-20', end: '2026-07-26' },
    { start: '2026-07-27', end: '2026-08-02' },
  ]);
  assert.deepEqual(
    buildWeeklyWindows({ now: new Date('2026-03-12T18:00:00.000Z') }).at(-1),
    { start: '2026-03-02', end: '2026-03-08' },
  );
  assert.throws(() => buildWeeklyWindows({ endDate: '2026-08-01' }), /end_date_must_be_sunday/);
  assert.throws(
    () => buildWeeklyWindows({ now: new Date('2026-08-06T18:00:00.000Z'), endDate: '2026-08-09' }),
    /end_date_not_finalized/,
  );
});

test('delta math returns N/A-compatible null for zero denominators and finite changes otherwise', () => {
  assert.deepEqual(metricDelta(0, 0), { absolute: 0, percent: null });
  assert.deepEqual(metricDelta(5, 0), { absolute: 5, percent: null });
  assert.deepEqual(metricDelta(15, 10), { absolute: 5, percent: 50 });
  assert.deepEqual(metricDelta(5, 10), { absolute: -5, percent: -50 });
  assert.throws(() => metricDelta(Number.NaN, 1), /invalid_current_metric/);
});

test('GSC totals use the authoritative no-dimension row and reject malformed aggregates', () => {
  assert.deepEqual(normalizeGscTotals(null), { clicks: 0, impressions: 0, ctr: 0, position: 0 });
  assert.deepEqual(normalizeGscTotals(fixture.weekly[3].gsc), fixture.weekly[3].gsc);
  assert.throws(
    () => normalizeGscTotals({ clicks: 1, impressions: 2, ctr: 1.5, position: 4 }),
    /invalid_gsc_ctr/,
  );
  assert.throws(() => normalizePosthogTotals([1, 2]), /invalid_posthog_totals/);
});

test('bounded detail rows strip query strings and drop contact-bearing search queries', () => {
  const queries = normalizeGscDetails(fixture.top.current.gscQueries, 'query');
  assert.equal(queries.length, 1);
  assert.equal(queries[0].query, 'liberty village parking');
  const pages = normalizeGscDetails(fixture.top.current.gscPages, 'page');
  assert.equal(pages[0].page, '/guide/parking-guide');
});

test('strict report and Markdown contain adjacent deltas, four-week trends, and no raw sensitive fields', () => {
  const report = fixtureReport();
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.current.start, '2026-07-27');
  assert.equal(report.prior.end, '2026-07-26');
  assert.equal(report.changes.gsc.clicks.percent, 50);
  assert.equal(report.changes.posthog.newsletterSucceeded.percent, null);
  assert.equal(report.trend.length, 4);
  assert.equal(report.top.current.gscQueries.length, 1);
  assert.equal(report.top.current.gscPages[0].page, '/guide/parking-guide');
  assertSafeReport(report);

  const markdown = renderGrowthMarkdown(report);
  assert.match(markdown, /Current finalized week: 2026-07-27 through 2026-08-02/);
  assert.match(markdown, /\| GSC clicks \| 18 \| 12 \| \+50\.0% \|/);
  assert.match(markdown, /\| Newsletter successes \| 3 \| 0 \| N\/A \|/);
  assert.doesNotMatch(markdown, /private@example\.com|\?private=|distinct_id|\$session_id|ph[ctx]_/i);
});

test('PostHog queries are aggregate-only, time-bounded, production-scoped, and person-free', () => {
  for (const query of [buildPosthogTotalsQuery(windows[3]), buildPosthogLandingQuery(windows[3])]) {
    assert.match(query, /toDate\(timestamp, 'America\/Los_Angeles'\)/);
    assert.match(query, /2026-07-27/);
    assert.match(query, /2026-08-02/);
    assert.match(query, /deployment_environment = 'production'/);
    assert.match(query, /site_hostname = 'libertyvillage\.co'/);
    assert.doesNotMatch(query, /distinct_id|person_id|\$session_id|SELECT \*/i);
  }
  assert.match(buildPosthogLandingQuery(windows[3]), /LIMIT 10/);
});

test('safe report guard rejects raw event/person/token keys without rejecting aggregate contact counts', () => {
  const report = fixtureReport();
  assert.doesNotThrow(() => assertSafeReport(report));
  assert.throws(
    () => assertSafeReport({ ...report, raw_events: [] }),
    /unsafe_report_field/,
  );
  assert.throws(
    () => assertSafeReport({ ...report, leaked: 'phx_not_allowed' }),
    /unsafe_report_value/,
  );
});

test('CLI writes strict fixture artifacts and fails closed before network access without credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'liberty-growth-test-'));
  try {
    const fixtureOutput = path.join(root, 'fixture');
    const fixtureRun = spawnSync(
      process.execPath,
      [
        'scripts/generate-weekly-growth-report.mjs',
        '--fixture', 'tests/fixtures/weekly-growth-input.json',
        '--end-date', '2026-08-02',
        '--out-dir', fixtureOutput,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(fixtureRun.status, 0, fixtureRun.stderr);
    const json = fs.readFileSync(path.join(fixtureOutput, 'weekly-growth.json'), 'utf8');
    const markdown = fs.readFileSync(path.join(fixtureOutput, 'weekly-growth.md'), 'utf8');
    assert.equal(JSON.parse(json).trend.length, 4);
    assert.doesNotMatch(`${json}${markdown}`, /private@example|distinct_id|\$session_id|ph[ctx]_/i);

    const environment = { ...process.env };
    delete environment.GOOGLE_APPLICATION_CREDENTIALS;
    delete environment.POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE;
    const failedOutput = path.join(root, 'failed');
    const failedRun = spawnSync(
      process.execPath,
      [
        'scripts/generate-weekly-growth-report.mjs',
        '--end-date', '2026-08-02',
        '--out-dir', failedOutput,
      ],
      { encoding: 'utf8', env: environment },
    );
    assert.notEqual(failedRun.status, 0);
    assert.match(failedRun.stderr, /^weekly growth report failed: configuration_error\n$/);
    assert.equal(fs.existsSync(path.join(failedOutput, 'weekly-growth.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
