// Source contracts for the surviving Opus review agent and news preflight. The
// autonomous-coordinator, blocked-sentinel, supervisor-ingest and writer
// workflow contracts were removed with those workflows in r7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reviewAgent = fs.readFileSync(new URL('../../scripts/automation/review-agent.mjs', import.meta.url), 'utf8');
const preflight = fs.readFileSync(new URL('../../scripts/automation/news-preflight.mjs', import.meta.url), 'utf8');

test('every autonomous generator kind has an independent review lens', () => {
  for (const kind of ['seo', 'blog', 'blog-live', 'news', 'business', 'topic-discovery', 'promotion']) {
    assert.match(reviewAgent, new RegExp(`\\n  ['"]?${kind}['"]?: \\[`), `missing ${kind} review lens`);
  }
  assert.match(reviewAgent, /Liberty Township/);
});

test('preflight reuses canonical models and content commands avoid GitHub APIs', () => {
  assert.match(preflight, /from '\.\/constants\.mjs'/);
  assert.match(preflight, /GATE_MODEL/); assert.match(preflight, /FIXER_MODEL/);
  assert.match(preflight, /MAX_REPAIRS/); assert.match(preflight, /SCORE_THRESHOLD/);
  assert.equal((reviewAgent.match(/\n  news: \[/g) || []).length, 1);
  const contentCommands = reviewAgent.slice(reviewAgent.indexOf('async function reviewContent'), reviewAgent.indexOf('async function fileAtSha'));
  assert.doesNotMatch(contentCommands, /github\(/);
});
