// The Opus review agent fails closed when its grounded reference records cannot be
// loaded, and blog-live shares the blog grounding. The staging-worktree trust
// boundary tests for the retired weekly-blog / weekly-seo-improvements /
// coordinator workflows were removed with those workflows in r7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createFakeGitHub, fakeGithubEnv } from './helpers/fake-github.mjs';
import { KIND_POLICIES } from '../../scripts/automation/constants.mjs';

const REVIEW_AGENT = fileURLToPath(new URL('../../scripts/automation/review-agent.mjs', import.meta.url));
const SHA = 'a'.repeat(40);
const execFileAsync = promisify(execFile);

test('the gate refuses to run ungrounded when its reference records cannot be loaded', async () => {
  const hub = createFakeGitHub({ repo: 'owner/repo' });
  const url = await hub.listen();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-grounding-'));
  const outputFile = path.join(workDir, 'out.txt');
  fs.writeFileSync(outputFile, '');
  try {
    const pr = hub.addPull({ headRef: 'blog/auto-1', headSha: SHA });
    // data/businesses.json is deliberately absent at that SHA.
    let status = 0;
    let stdout = '';
    try {
      const result = await execFileAsync(process.execPath, [
        REVIEW_AGENT, 'review', '--repo', 'owner/repo', '--pr', String(pr.number),
        '--kind', 'blog', '--sha', SHA, '--out', path.join(workDir, 'verdict.json'),
      ], {
        encoding: 'utf8',
        env: fakeGithubEnv(url, { GITHUB_OUTPUT: outputFile }),
      });
      stdout = `${result.stdout}${result.stderr}`;
    } catch (error) {
      status = error.code ?? 1;
      stdout = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    const outputs = fs.readFileSync(outputFile, 'utf8');
    assert.equal(status, 1, `the gate must fail closed, not score the diff from memory:\n${stdout}`);
    assert.match(stdout, /grounded reference records could not be loaded/);
    assert.match(outputs, /review_ok=false/);
    assert.ok(!fs.existsSync(path.join(workDir, 'verdict.json')), 'no verdict may be written for an ungrounded run');
  } finally {
    await hub.close();
  }
});

function groundedKindsFromSource() {
  const source = fs.readFileSync(REVIEW_AGENT, 'utf8');
  const match = source.match(/const GROUNDED_KINDS = Object\.freeze\(\[([^\]]+)\]\)/);
  assert.ok(match, 'GROUNDED_KINDS must be declared');
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

test('blog-live receives the same grounded reference context as blog', async () => {
  const grounded = groundedKindsFromSource();
  assert.ok(grounded.includes('blog'), 'blog must stay grounded');
  assert.ok(grounded.includes('blog-live'), 'blog-live must share blog grounding/reference records');
  for (const [kind, policy] of Object.entries(KIND_POLICIES)) {
    if ((policy.repairablePaths ?? []).includes('data/posts.json')) {
      assert.ok(
        grounded.includes(kind),
        `${kind} repairs data/posts.json but is missing from GROUNDED_KINDS`,
      );
    }
  }

  const hub = createFakeGitHub({ repo: 'owner/repo' });
  const url = await hub.listen();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-blog-live-grounding-'));
  const outputFile = path.join(workDir, 'out.txt');
  fs.writeFileSync(outputFile, '');
  try {
    const pr = hub.addPull({ headRef: 'blog/auto-1', headSha: SHA, baseRef: 'main' });
    let status = 0;
    let stdout = '';
    try {
      const result = await execFileAsync(process.execPath, [
        REVIEW_AGENT, 'review', '--repo', 'owner/repo', '--pr', String(pr.number),
        '--kind', 'blog-live', '--sha', SHA, '--out', path.join(workDir, 'verdict.json'),
      ], {
        encoding: 'utf8',
        env: fakeGithubEnv(url, { GITHUB_OUTPUT: outputFile }),
      });
      stdout = `${result.stdout}${result.stderr}`;
    } catch (error) {
      status = error.code ?? 1;
      stdout = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    const outputs = fs.readFileSync(outputFile, 'utf8');
    assert.equal(status, 1, `blog-live must fail closed like blog, not score from memory:\n${stdout}`);
    assert.match(stdout, /grounded reference records could not be loaded/);
    assert.match(outputs, /review_ok=false/);
    assert.ok(!fs.existsSync(path.join(workDir, 'verdict.json')), 'no verdict may be written for an ungrounded blog-live run');
  } finally {
    await hub.close();
  }
});
