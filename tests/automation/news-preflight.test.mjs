import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GATE_MODEL } from '../../scripts/automation/constants.mjs';
import { runPreflight } from '../../scripts/automation/news-preflight.mjs';

const old = { slug: 'old', title: 'Old' };
const post = {
  slug: 'new-post', title: 'Title', description: 'Description', content: 'Content',
  publishedAt: '2026-08-10', updatedAt: '2026-08-10', category: 'news', tags: [],
  answerBlock: 'Answer', faqs: [], keyTakeaways: [], relatedServices: [], relatedTopics: [],
  relatedPosts: [], author: 'Liberty Village Newsroom', image: '/og.png',
};

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'news-preflight-'));
  fs.mkdirSync(path.join(root, 'data'));
  const baseline = `${JSON.stringify([old], null, 2)}\n`;
  const candidate = `${JSON.stringify([old, post], null, 2)}\n`;
  fs.writeFileSync(path.join(root, 'data/posts.json'), candidate);
  fs.writeFileSync(path.join(root, 'baseline.json'), baseline);
  fs.mkdirSync(path.join(root, 'publish'));
  fs.writeFileSync(path.join(root, 'publish/result.json'), JSON.stringify({ clusterId: 'c1', now: '2026-08-10T16:00:00.000Z' }));
  fs.writeFileSync(path.join(root, 'publish/evidence-c1.json'), JSON.stringify({ clusterId: 'c1', sources: [] }));
  return { root, baseline, candidate, args: { root, posts: 'data/posts.json', baseline: path.join(root, 'baseline.json'), publishOut: path.join(root, 'publish'), out: path.join(root, 'preflight'), slug: post.slug, baselineBlob: 'b'.repeat(40), stagingSha: 'c'.repeat(40) } };
}

function verdict(sha, overall = 9) {
  return { overall, passed: overall >= 8, findings: [], model: GATE_MODEL, commit_sha: sha };
}

test('first-review GO writes bound attestation and preserves candidate bytes', async () => {
  const f = fixture(); const outputs = [];
  const result = await runPreflight(f.args, {
    diff: () => 'diff --git a/data/posts.json b/data/posts.json\n+post', hashObject: () => 'a'.repeat(40),
    hashBaseline: () => 'b'.repeat(40),
    review: ({ contentSha, env }) => { assert.equal(env.GITHUB_OUTPUT, undefined); return verdict(contentSha); },
    writeOutput: (value) => outputs.push(value), clock: () => Date.parse('2026-08-10T16:00:00Z'),
  });
  assert.equal(result.exitCode, 0); assert.equal(result.repairs_used, 0);
  assert.equal(fs.readFileSync(path.join(f.root, 'data/posts.json'), 'utf8'), f.candidate);
  assert.equal(outputs.at(-1).gate_go, 'true');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'preflight/preflight-attestation.json'))).blob_sha, 'a'.repeat(40));
});

test('GO is refused if the reviewed blob changes before attestation', async () => {
  const f = fixture(); let hashes = 0;
  const result = await runPreflight(f.args, {
    diff: () => 'diff',
    hashObject: () => (hashes++ === 0 ? 'a' : 'd').repeat(40),
    hashBaseline: () => 'b'.repeat(40),
    review: ({ contentSha }) => verdict(contentSha, 9),
    writeOutput: () => {},
    clock: () => Date.parse('2026-08-10T16:00:00Z'),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.gate_go, false);
  assert.match(result.reason, /reviewed posts blob changed/);
  assert.equal(fs.readFileSync(path.join(f.root, 'data/posts.json'), 'utf8'), f.baseline);
});

test('one repair is deterministically revalidated and re-reviewed to GO', async () => {
  const f = fixture(); const outputs = [];
  let reviews = 0; let fixes = 0; let hashes = 0;
  const result = await runPreflight(f.args, {
    diff: () => 'diff',
    hashObject: () => (hashes++ === 0 ? 'a' : 'd').repeat(40),
    hashBaseline: () => 'b'.repeat(40),
    review: ({ contentSha }) => verdict(contentSha, ++reviews === 1 ? 7 : 9),
    fix: () => ({ posts: [{ slug: post.slug, post: { ...post, content: `Grounded repair ${++fixes}` } }], reason: 'repair' }),
    validateDraft: () => ({ ok: true, publishReady: true, failures: [], humanGates: [] }),
    evaluatePublishReadyDraft: () => ({ ok: true }),
    loadSiteLinkIndex: () => ({ postSlugs: new Set([post.slug]) }),
    imageExists: () => true,
    writeOutput: (value) => outputs.push(value),
    clock: () => Date.parse('2026-08-10T16:00:00Z'),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.repairs_used, 1);
  assert.equal(reviews, 2);
  assert.equal(fixes, 1);
  const written = JSON.parse(fs.readFileSync(path.join(f.root, 'data/posts.json'), 'utf8'));
  assert.deepEqual(written[0], old, 'baseline post must remain unchanged');
  assert.equal(written[1].content, 'Grounded repair 1');
  assert.equal(outputs.at(-1).gate_go, 'true');
  assert.equal(result.blob_sha, 'd'.repeat(40));
});

test('three repairs without GO consume one shared budget and restore baseline', async () => {
  const f = fixture(); let fixes = 0;
  const result = await runPreflight(f.args, {
    diff: () => 'diff', hashObject: () => 'a'.repeat(40), hashBaseline: () => 'b'.repeat(40), review: ({ contentSha }) => verdict(contentSha, 7),
    fix: () => ({ posts: [{ slug: post.slug, post: { ...post, content: `Repair ${++fixes}` } }], reason: 'repair' }),
    validateDraft: () => ({ ok: true, publishReady: true, failures: [] }), evaluatePublishReadyDraft: () => ({ ok: true }),
    loadSiteLinkIndex: () => ({}), imageExists: () => true, writeOutput: () => {}, clock: () => Date.parse('2026-08-10T16:00:00Z'),
  });
  assert.equal(result.exitCode, 0); assert.equal(result.repairs_used, 3); assert.equal(fixes, 3);
  assert.equal(fs.readFileSync(path.join(f.root, 'data/posts.json'), 'utf8'), f.baseline);
  assert.equal(fs.existsSync(path.join(f.root, 'preflight/preflight-attestation.json')), false);
  const blockedResult = JSON.parse(fs.readFileSync(path.join(f.root, 'publish/result.json'), 'utf8'));
  assert.equal(blockedResult.status, 'preflight_blocked');
  assert.equal(blockedResult.published, 0);
});

test('immutable repair is rejected before write and reviewer failure is hard', async () => {
  const f = fixture();
  const blocked = await runPreflight(f.args, {
    diff: () => 'diff', hashObject: () => 'a'.repeat(40), hashBaseline: () => 'b'.repeat(40), review: ({ contentSha }) => verdict(contentSha, 7),
    fix: () => ({ posts: [{ slug: post.slug, post: { ...post, slug: 'changed', content: 'Repair' } }], reason: 'repair' }),
    writeOutput: () => {}, clock: () => Date.parse('2026-08-10T16:00:00Z'),
  });
  assert.equal(blocked.exitCode, 0); assert.equal(blocked.repairs_used, 1);
  assert.equal(fs.readFileSync(path.join(f.root, 'data/posts.json'), 'utf8'), f.baseline);

  const f2 = fixture();
  const hard = await runPreflight(f2.args, {
    diff: () => 'diff', hashObject: () => 'a'.repeat(40), hashBaseline: () => 'b'.repeat(40), review: () => { throw new Error('missing key'); },
    writeOutput: () => {}, clock: () => Date.parse('2026-08-10T16:00:00Z'),
  });
  assert.equal(hard.exitCode, 1);
  assert.equal(fs.readFileSync(path.join(f2.root, 'data/posts.json'), 'utf8'), f2.baseline);
});
