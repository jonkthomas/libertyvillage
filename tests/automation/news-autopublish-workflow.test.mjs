import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/news-autopublish.yml', 'utf8');
const constants = fs.readFileSync('scripts/automation/constants.mjs', 'utf8');
const discovery = fs.readFileSync('.github/workflows/news-discovery.yml', 'utf8');

test('news autopublish opens staging PRs and dispatches coordinator kind news', () => {
  assert.match(workflow, /name: News Autopublish/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /News Discovery \(human review queue\)/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: news-autopublish/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /ref: staging/);
  assert.match(workflow, /scripts\/news-pilot\/publish\.mjs/);
  assert.match(workflow, /--vault=\/dev\/null/);
  assert.match(workflow, /default: "anthropic"/);
  assert.match(workflow, /git push -u origin/);
  assert.match(workflow, /gh pr create --base staging/);
  assert.match(workflow, /news\/auto-/);
  assert.match(constants, /news:\s*\{/);
  assert.match(constants, /headPrefixes: \['news\/auto-']/);
  assert.match(constants, /allowedPaths: \['data\/posts\.json'\]/);
  assert.match(workflow, /coordinator\.mjs dispatch/);
  assert.match(workflow, /--kind news/);
  assert.doesNotMatch(workflow, /gh pr merge/);
  assert.doesNotMatch(workflow, /--base main/);
});

test('news autopublish does not weaken discovery read-only posture', () => {
  assert.match(discovery, /permissions:\n  contents: read/);
  assert.doesNotMatch(discovery, /contents:\s*write|pull-requests:\s*write/);
  assert.doesNotMatch(discovery, /git push|gh pr create|coordinator\.mjs\s+dispatch/);
  assert.doesNotMatch(discovery, /git add data\/posts\.json/);
  assert.match(discovery, /never writes data\/posts\.json/);
});

test('news autopublish secrets are referenced by name only and no absolute user paths', () => {
  assert.match(workflow, /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.match(workflow, /BYTEPLUS_API_KEY: \$\{\{ secrets\.BYTEPLUS_API_KEY \}\}/);
  assert.match(workflow, /SERPER_API_KEY: \$\{\{ secrets\.SERPER_API_KEY \}\}/);
  assert.doesNotMatch(workflow, /\/Users\//);
  assert.doesNotMatch(workflow, /sk-live-|sk-proj-|sk-ant-/);
  assert.doesNotMatch(workflow, /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{8,}['"]/i);
});

test('workflow parses relative result.json as data and serializes pending news PRs', () => {
  assert.match(workflow, /JSON\.parse\(fs\.readFileSync\(process\.argv\[1\],"utf8"\)\)/);
  assert.doesNotMatch(workflow, /require\(process\.argv\[1\]\)/);
  assert.match(workflow, /headRefName \| startswith\("news\/auto-"\)/);
  assert.match(workflow, /status: 'pending_autopublish_pr'/);
  assert.match(workflow, /group: news-autopublish/);
  assert.match(workflow, /cancel-in-progress: false/);
});
