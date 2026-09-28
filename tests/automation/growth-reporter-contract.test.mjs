// Source contract for the weekly growth reporter the exe.dev runner invokes. The
// weekly-growth-report workflow tests were removed with that workflow in r7.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const reporter = fs.readFileSync('scripts/generate-weekly-growth-report.mjs', 'utf8');

test('reporter uses authoritative finalized GSC totals and bounded aggregate PostHog queries', () => {
  assert.match(reporter, /dataState: 'final'/);
  assert.match(reporter, /dimensions \? \{ dimensions, rowLimit: TOP_LIMIT, startRow: 0 \} : \{\}/);
  assert.match(reporter, /if \(rows\.length > 1\) throw new Error\('gsc_schema_error'\)/);
  assert.match(reporter, /kind: 'HogQLQuery'/);
  assert.match(reporter, /countIf\(event = 'site_landing'\)/);
  assert.match(reporter, /deployment_environment = 'production'/);
  assert.match(reporter, /site_hostname = '\$\{PRODUCTION_HOSTNAME\}'/);
  assert.doesNotMatch(reporter, /SELECT \*|distinct_id|person_id|\$session_id/);
});
