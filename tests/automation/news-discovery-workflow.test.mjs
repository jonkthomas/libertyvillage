// The retained manual news-discovery workflow stays read-only. The
// news-autopublish workflow tests were removed with that workflow in r7.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const discovery = fs.readFileSync('.github/workflows/news-discovery.yml', 'utf8');

test('news discovery keeps its read-only posture', () => {
  assert.match(discovery, /permissions:\n  contents: read/);
  assert.doesNotMatch(discovery, /contents:\s*write|pull-requests:\s*write/);
  assert.doesNotMatch(discovery, /git push|gh pr create|coordinator\.mjs\s+dispatch/);
  assert.doesNotMatch(discovery, /git add data\/posts\.json/);
  assert.match(discovery, /never writes data\/posts\.json/);
});
