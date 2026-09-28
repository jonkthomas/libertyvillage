import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  blobSha1, buildReviewDocument, cutFindingPaths, REVIEW_DOCUMENT_MAX_BYTES, unifiedDiffLines,
} from '../../scripts/content/review-document.mjs';

const ROOT = new URL('../../', import.meta.url);
const posts = JSON.parse(fs.readFileSync(new URL('data/posts.json', ROOT), 'utf8'));
const businesses = JSON.parse(fs.readFileSync(new URL('data/businesses.json', ROOT), 'utf8'));

function gitDiffLines(aText, bText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-doc-'));
  fs.writeFileSync(path.join(dir, 'a'), aText);
  fs.writeFileSync(path.join(dir, 'b'), bText);
  let out = '';
  try { execFileSync('git', ['diff', '--no-index', '--no-color', '-U3', 'a', 'b'], { cwd: dir }); } catch (error) { out = error.stdout.toString(); }
  fs.rmSync(dir, { recursive: true, force: true });
  const lines = out.split('\n').filter((line) => !/^(diff |index |--- |\+\+\+ |\\ )/.test(line));
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

test('document header, (dataset,key) ordering and per-item headers are exact', () => {
  const edited = { ...businesses[1], description: `${businesses[1].description} Updated.` };
  const inserted = { ...businesses[0], slug: 'aaa-new-place', name: 'AAA New Place' };
  const post = { ...posts[0], title: `${posts[0].title} (updated)` };
  const { document } = buildReviewDocument({
    submissionId: 17, round: 2, kind: 'seo', target: 'staging',
    items: [
      { dataset: 'posts', key: post.slug, base: posts[0], candidate: post },
      { dataset: 'businesses', key: edited.slug, base: businesses[1], candidate: edited },
      { dataset: 'businesses', key: 'aaa-new-place', base: null, candidate: inserted },
    ],
  });
  const lines = document.split('\n');
  assert.equal(lines[0], 'content submission 17 round 2 kind seo target staging');
  const headers = lines.filter((line) => /^(---|\+\+\+) [ab]\//.test(line));
  assert.deepEqual(headers, [
    '--- a/data/businesses.json#aaa-new-place', '+++ b/data/businesses.json#aaa-new-place',
    `--- a/data/businesses.json#${edited.slug}`, `+++ b/data/businesses.json#${edited.slug}`,
    `--- a/data/posts.json#${post.slug}`, `+++ b/data/posts.json#${post.slug}`,
  ]);
  assert.ok(document.endsWith('\n'));
  // Insert diffs against an empty base: every candidate line is an addition.
  const insertLines = JSON.stringify(inserted, null, 2).split('\n');
  const insertHunk = lines.indexOf('+++ b/data/businesses.json#aaa-new-place') + 1;
  assert.equal(lines[insertHunk], `@@ -0,0 +1,${insertLines.length} @@`);
  assert.deepEqual(lines.slice(insertHunk + 1, insertHunk + 1 + insertLines.length), insertLines.map((line) => `+${line}`));
});

test('item order and input order do not change the bytes or contentSha', () => {
  const items = [
    { dataset: 'posts', key: posts[2].slug, base: null, candidate: posts[2] },
    { dataset: 'businesses', key: businesses[3].slug, base: businesses[3], candidate: { ...businesses[3], proTip: 'Go early.' } },
  ];
  const one = buildReviewDocument({ submissionId: 5, round: 0, kind: 'seo', target: 'test', items });
  const two = buildReviewDocument({ submissionId: 5, round: 0, kind: 'seo', target: 'test', items: [...items].reverse() });
  assert.equal(one.document, two.document);
  assert.equal(one.contentSha, two.contentSha);
});

// Rebuild b from a and the hunks; also checks every header count against its body.
function applyHunks(aText, lines) {
  const a = aText === '' ? [] : aText.split('\n');
  const out = [];
  let cursor = 0;
  for (let index = 0; index < lines.length;) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(lines[index]);
    assert.ok(match, `hunk header expected: ${lines[index]}`);
    const aCount = match[2] === undefined ? 1 : Number(match[2]);
    const bCount = match[4] === undefined ? 1 : Number(match[4]);
    const aStart = aCount === 0 ? Number(match[1]) : Number(match[1]) - 1;
    out.push(...a.slice(cursor, aStart));
    cursor = aStart;
    let seenA = 0;
    let seenB = 0;
    for (index += 1; index < lines.length && !lines[index].startsWith('@@'); index += 1) {
      const [op, text] = [lines[index][0], lines[index].slice(1)];
      if (op !== '+') { assert.equal(a[cursor], text); cursor += 1; seenA += 1; }
      if (op !== '-') { out.push(text); seenB += 1; }
    }
    assert.equal(seenA, aCount);
    assert.equal(seenB, bCount);
  }
  out.push(...a.slice(cursor));
  return out.join('\n');
}

const changeCount = (lines) => lines.filter((line) => /^[+-]/.test(line)).length;

test('3-context unified diff is a valid, minimal diff of real records (same size as git diff -U3)', () => {
  let identical = 0;
  for (let index = 0; index < 40; index += 1) {
    const base = posts[index];
    const candidate = structuredClone(base);
    if (index % 4 === 0) candidate.title += ' — revised';
    if (index % 4 === 1) { candidate.tags = [...candidate.tags, 'extra']; candidate.faqs = candidate.faqs.slice(1); }
    if (index % 4 === 2) { candidate.description = 'Short.'; candidate.keyTakeaways = [...candidate.keyTakeaways].reverse(); }
    if (index % 4 === 3) { delete candidate.image; candidate.relatedPosts = []; }
    const a = JSON.stringify(base, null, 2);
    const b = JSON.stringify(candidate, null, 2);
    const mine = unifiedDiffLines(a, b);
    const git = gitDiffLines(a, b);
    assert.equal(applyHunks(a, mine), b, `post ${index}: hunks rebuild the candidate`);
    assert.equal(changeCount(mine), changeCount(git), `post ${index}: same number of changed lines as git`);
    if (mine.join('\n') === git.join('\n')) identical += 1;
  }
  // Only ambiguous slides (e.g. which of two identical "{" lines is deleted) may differ.
  assert.ok(identical >= 30, `byte-identical to git for unambiguous edits (${identical}/40)`);
  assert.deepEqual(unifiedDiffLines('', ''), []);
  assert.deepEqual(unifiedDiffLines('a\nb', 'a\nb'), []);
});

test('contentSha is the git blob id of the document bytes', () => {
  const { document, contentSha, bytes } = buildReviewDocument({
    submissionId: 9, round: 1, kind: 'manual', target: 'staging',
    items: [{ dataset: 'guide-hub', key: 'guide-hub', base: { answerSummary: 'Old — café' }, candidate: { answerSummary: 'New — café' } }],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-doc-sha-'));
  fs.writeFileSync(path.join(dir, 'doc'), document);
  const gitSha = execFileSync('git', ['hash-object', path.join(dir, 'doc')], { encoding: 'utf8' }).trim();
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(contentSha, gitSha);
  assert.equal(blobSha1(document), gitSha);
  assert.equal(bytes, Buffer.byteLength(document));
  assert.match(contentSha, /^[0-9a-f]{40}$/);
});

test('document over 500,000 bytes and malformed input are refused', () => {
  const huge = { slug: 'huge', content: 'x'.repeat(REVIEW_DOCUMENT_MAX_BYTES) };
  assert.throws(() => buildReviewDocument({ submissionId: 1, round: 0, kind: 'seo', target: 'test', items: [{ dataset: 'posts', key: 'huge', base: null, candidate: huge }] }),
    /review document budget exceeded/);
  assert.throws(() => buildReviewDocument({ submissionId: 1, round: 0, kind: 'seo', target: 'test', items: [] }), /at least one item/);
  const item = { dataset: 'posts', key: 'a', base: null, candidate: { slug: 'a' } };
  assert.throws(() => buildReviewDocument({ submissionId: 1, round: 0, kind: 'seo', target: 'test', items: [item, item] }), /duplicate/);
});

test('cutFindingPaths strips #key and leaves everything else intact', () => {
  const verdict = {
    overall: 7.5, model: 'm', commit_sha: 'a'.repeat(40),
    findings: [
      { severity: 'high', path: 'data/businesses.json#wilbur-s-taco-shop', note: 'n' },
      { severity: 'low', path: 'data/posts.json', note: 'm' },
    ],
  };
  const cut = cutFindingPaths(verdict);
  assert.deepEqual(cut.findings.map((finding) => finding.path), ['data/businesses.json', 'data/posts.json']);
  assert.equal(verdict.findings[0].path, 'data/businesses.json#wilbur-s-taco-shop', 'input is not mutated');
  assert.equal(cut.overall, 7.5);
});
