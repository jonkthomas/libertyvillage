import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/weekly-growth-report.yml', 'utf8');
const reporter = fs.readFileSync('scripts/generate-weekly-growth-report.mjs', 'utf8');

test('weekly growth workflow is scheduled, manually backfillable, serialized, and read-only', () => {
  assert.match(workflow, /cron: '37 10 \* \* 4'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /end_date:/);
  assert.match(workflow, /group: weekly-growth-report/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:\s*write|statuses:\s*write/);
  assert.doesNotMatch(workflow, /git push|gh pr|repository_dispatch|coordinator\.mjs\s+dispatch/);
});

test('workflow handles credentials without exposing the PostHog personal token', () => {
  assert.match(workflow, /install -m 600 \/dev\/null \/tmp\/gsa-credentials\.json/);
  assert.match(workflow, /stat -c '%a'.*= 600/);
  assert.equal(
    workflow.match(/secrets\.POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE/g)?.length,
    1,
  );
  assert.match(
    workflow,
    /POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE: \$\{\{ secrets\.POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE \}\}/,
  );
  assert.doesNotMatch(workflow, /NEXT_PUBLIC_POSTHOG_PERSONAL|--(?:token|api-key)/);
  assert.match(workflow, /name: Cleanup credentials\n        if: always\(\)/);
  assert.match(workflow, /rm -f \/tmp\/gsa-credentials\.json/);
});

test('workflow uploads strict JSON and Markdown and appends the same Markdown to the summary', () => {
  assert.match(workflow, /cat artifacts\/growth\/weekly-growth\.md >> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /artifacts\/growth\/weekly-growth\.json/);
  assert.match(workflow, /artifacts\/growth\/weekly-growth\.md/);
  assert.match(workflow, /if-no-files-found: error/);
});

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
