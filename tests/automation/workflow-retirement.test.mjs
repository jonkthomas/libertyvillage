import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// r7 scope-only workflow retirement: autonomous coordination and all six
// scheduled writer workflows are deleted. Only the manual human queue
// news-discovery -> news-draft remains (plus the untouched content-ci).
// Contract: zero reachable GITHUB_TOKEN bot-PR paths in retained workflows.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');

const RETIRED = [
  // Autonomous-coordination trio + sentinel + ingest + sync.
  '.github/workflows/autonomous-coordinator.yml',
  '.github/workflows/promotion-sweep.yml',
  '.github/workflows/blocked-sentinel.yml',
  '.github/workflows/supervisor-ingest.yml',
  'scripts/automation/content-sync.mjs',
  // Scheduled writer workflows (runner now supplies all on-demand paths).
  '.github/workflows/discover-businesses.yml',
  '.github/workflows/weekly-topic-discovery.yml',
  '.github/workflows/weekly-seo-improvements.yml',
  '.github/workflows/weekly-blog.yml',
  '.github/workflows/weekly-growth-report.yml',
  '.github/workflows/news-autopublish.yml',
];

const RETAINED = ['content-ci.yml', 'news-discovery.yml', 'news-draft.yml'];

// Every bot-PR / autonomous-gate reachability pattern that must be gone.
const BOT_PR_PATTERNS = [
  'gh pr create',
  'git push',
  'coordinator.mjs dispatch',
  'create-pull-request',
];

function readWorkflow(name) {
  return fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');
}

function onBlock(text) {
  const match = /^on:\n((?:  .*\n?)+)/m.exec(text);
  assert.ok(match, 'missing on: block');
  return match[1];
}

test('all retired descriptors are gone', () => {
  for (const rel of RETIRED) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), false, `${rel} should be deleted`);
  }
});

test('only content-ci and the manual news queue remain', () => {
  const actual = fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml')).sort();
  assert.deepEqual(actual, [...RETAINED].sort(), 'no other workflow files may remain');
});

for (const name of ['news-discovery.yml', 'news-draft.yml']) {
  test(`${name} is manual-only with no bot-PR reachability`, () => {
    const text = readWorkflow(name);
    const triggers = onBlock(text);
    assert.ok(!text.includes('schedule:'), `${name} must not have a schedule trigger`);
    assert.ok(!text.includes('cron:'), `${name} must not have a cron entry`);
    assert.ok(!/^  workflow_run:/m.test(text), `${name} must not have a workflow_run trigger`);
    assert.ok(triggers.includes('workflow_dispatch'), `${name} must keep workflow_dispatch`);
    for (const pattern of BOT_PR_PATTERNS) {
      assert.ok(!text.includes(pattern), `${name} must not contain reachable bot-PR path: ${pattern}`);
    }
  });
}

test('manual news-discovery to news-draft artifact path is intact', () => {
  const draft = readWorkflow('news-draft.yml');
  assert.ok(draft.includes('discovery_run_id'), 'draft must consume a discovery run id');
  assert.ok(draft.includes('download-artifact'), 'draft must fetch the discovery artifact');
});

test('content-ci is untouched by the retirement', () => {
  const text = readWorkflow('content-ci.yml');
  assert.ok(text.includes('push:'), 'content-ci push trigger must remain');
  assert.ok(text.includes('pull_request:'), 'content-ci pull_request trigger must remain');
});
