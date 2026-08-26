// Trust boundary and generator-kind wiring for the scheduled content pipelines.
//
// `staging` is the GENERATED-DATA worktree: the agent writes data/posts.json and
// images into it. Nothing that DECIDES anything may be run from there — the candidate
// policy and the claim linter must come from protected `main`, or a mutated staging
// checkout would be rewriting the rules it is about to be judged by.
//
// The second half pins the objective: the bounded ladder governs blog *and* SEO,
// each through its own kind, with no `--kind blog` hardcoded into the SEO path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createFakeGitHub, fakeGithubEnv } from './helpers/fake-github.mjs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const BLOG_YML = read('../../.github/workflows/weekly-blog.yml');
const SEO_YML = read('../../.github/workflows/weekly-seo-improvements.yml');
const SWEEP_YML = read('../../.github/workflows/promotion-sweep.yml');
const COORDINATOR_YML = read('../../.github/workflows/autonomous-coordinator.yml');
const REVIEW_AGENT = fileURLToPath(new URL('../../scripts/automation/review-agent.mjs', import.meta.url));
const SHA = 'a'.repeat(40);
const execFileAsync = promisify(execFile);

// Every `run:` line that executes automation TOOLING (`*.mjs` under scripts/), so
// "which copy did this step actually run" is answered by parsing the workflow rather
// than by eyeballing it. The content generators themselves (`scripts/*-agent.js`)
// deliberately stay on the staging worktree: they resolve their own paths from
// __dirname and they produce the generated data rather than judging it.
function runLines(yaml) {
  return yaml.split('\n').filter((line) => /(?:^|\s)node\s+\S+\.mjs/.test(line)).map((line) => line.trim());
}

for (const [name, yaml] of [['weekly-blog.yml', BLOG_YML], ['weekly-seo-improvements.yml', SEO_YML]]) {
  test(`${name} runs every deciding tool from the trusted main checkout`, () => {
    assert.match(yaml, /uses: actions\/checkout@v4\n\s+with:\n\s+ref: main\n\s+path: trusted/,
      `${name} must check trusted tooling out of main`);
    assert.match(yaml, /ref: staging/, `${name} still needs the generated-data worktree`);
    assert.match(yaml, /echo 'trusted\/' >> \.git\/info\/exclude/,
      `${name} must keep the trusted checkout out of the generated-data worktree`);

    for (const line of runLines(yaml)) {
      assert.match(line, /node trusted\/scripts\//,
        `${name} runs a deciding tool from the mutable staging checkout: ${line}`);
    }
    assert.ok(runLines(yaml).length > 0, `${name} must actually run trusted tooling`);
  });
}

test('the blog pipeline lints from trusted tooling before anything is committed', () => {
  const lintIndex = BLOG_YML.indexOf('trusted/scripts/blog-lint.mjs');
  const commitIndex = BLOG_YML.indexOf('git commit');
  assert.ok(lintIndex > 0, 'the claim linter must run from the trusted checkout');
  assert.ok(lintIndex < commitIndex, 'the linter must run BEFORE the draft is committed');
  assert.doesNotMatch(BLOG_YML, /node scripts\/blog-lint\.mjs/, 'the staging copy of the linter must not be the one that runs');
});

test('a lint refusal records the durable ladder and then stops the run without a PR', () => {
  const discardIndex = BLOG_YML.indexOf('--outcome lint-discarded');
  const prIndex = BLOG_YML.indexOf('Open non-draft pull request into staging');
  assert.ok(discardIndex > 0, 'a refused draft must be recorded in the bounded ladder');
  assert.ok(discardIndex < prIndex, 'the ladder must move before the pull-request step is even considered');
  assert.match(BLOG_YML, /--outcome lint-discarded/);
  assert.match(BLOG_YML, /--key "\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/,
    'the ladder event needs a stable idempotency key so a rerun buys nothing');
  assert.match(BLOG_YML, /DISCARDED_PRE_PR/, 'the refusal must be a named, visible terminal state');
  assert.match(BLOG_YML, /steps\.lint\.outcome == 'failure'[\s\S]{0,900}exit 1/,
    'the run must still fail after recording, so no pull request is opened for a refused draft');
  assert.match(BLOG_YML, /steps\.candidate\.outputs\.generate == 'true'/,
    'nothing may generate while the ladder says wait or abandon');
  assert.match(BLOG_YML, /steps\.generate\.outcome == 'success'[\s\S]{0,400}blog-lint\.mjs/,
    'lint must not run after a failed generation, or a throw would be double-counted as a lint refusal');
});

test('a blog generation failure before PR creation records the same bounded ladder', () => {
  const genIndex = BLOG_YML.indexOf('--outcome generation-failed');
  const prIndex = BLOG_YML.indexOf('Open non-draft pull request into staging');
  assert.ok(genIndex > 0, 'a generator throw must be recorded in the bounded ladder');
  assert.ok(genIndex < prIndex, 'the ladder must move before the pull-request step is even considered');
  assert.match(BLOG_YML, /failure\(\) && steps\.candidate\.outputs\.generate == 'true' && steps\.generate\.outcome == 'failure'/,
    'the original generate step must remain the visible failure; recording runs on failure()');
  assert.match(BLOG_YML, /GENERATION_FAILED_PRE_PR/, 'the generator throw must be a named, visible terminal state');
  assert.match(BLOG_YML, /generation-failed[\s\S]{0,1200}exit 1/,
    'the run must still fail after recording so no pull request is opened');
  assert.match(BLOG_YML, /steps\.generate\.outcome == 'success' && steps\.lint\.outcome == 'success'/,
    'the pull-request step must stay skipped when generate or lint did not succeed');
});

test('the SEO pipeline runs its own bounded ladder and never borrows the blog kind', () => {
  assert.match(SEO_YML, /plan-candidate --repo "\$GITHUB_REPOSITORY" --kind seo/,
    'the SEO ladder must be driven with --kind seo');
  assert.doesNotMatch(SEO_YML, /--kind blog/, 'no blog hardcode may leak into the SEO pipeline');
  assert.match(SEO_YML, /mark-regeneration[^\n]*--kind|mark-regeneration/, 'the SEO path must carry its regeneration budget forward');
  assert.match(SEO_YML, /issues: write/, 'the durable ladder needs to maintain its state issue');
  for (const step of ['Run SEO improvement agent', 'Guard — forbidden paths & change budget', 'Open Pull Request']) {
    const index = SEO_YML.indexOf(step);
    assert.ok(index > 0, `missing step: ${step}`);
    const gate = SEO_YML.slice(index, index + 400);
    assert.match(gate, /steps\.candidate\.outputs\.generate == 'true'/, `${step} must be gated on the candidate policy`);
  }
});

test('SEO generation and guard failures before PR creation record the bounded ladder', () => {
  const genIndex = SEO_YML.indexOf('--outcome generation-failed');
  const guardIndex = SEO_YML.indexOf('--outcome guard-failed');
  const prIndex = SEO_YML.indexOf('- name: Open Pull Request');
  assert.ok(genIndex > 0, 'an SEO generator throw must be recorded in the bounded ladder');
  assert.ok(guardIndex > 0, 'an SEO pre-PR guard refusal must be recorded as its own outcome');
  assert.ok(genIndex < prIndex && guardIndex < prIndex, 'the ladder must move before the pull-request step');
  assert.match(SEO_YML, /--kind seo --outcome generation-failed/);
  assert.match(SEO_YML, /--kind seo --outcome guard-failed/);
  assert.match(SEO_YML, /--key "\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/,
    'the SEO ladder event needs the same stable run key as blog');
  assert.match(SEO_YML, /GENERATION_FAILED_PRE_PR/);
  assert.match(SEO_YML, /GUARD_FAILED_PRE_PR/);
  assert.match(SEO_YML, /failure\(\) && steps\.candidate\.outputs\.generate == 'true' && steps\.generate\.outcome == 'failure'/);
  assert.match(SEO_YML, /failure\(\) && steps\.candidate\.outputs\.generate == 'true' && steps\.guard\.outcome == 'failure'/);
  assert.match(SEO_YML, /steps\.generate\.outcome == 'success' && steps\.guard\.outcome == 'success'/,
    'Open Pull Request must stay skipped when generate or guard did not succeed');
  assert.match(SEO_YML, /node trusted\/scripts\/automation\/coordinator\.mjs record-candidate-outcome/,
    'SEO pre-PR recording must use trusted main tooling');
});

test('every privileged coordinator and sweep job still executes tooling from main only', () => {
  const jobs = COORDINATOR_YML.split(/^ {2}[a-z0-9-]+:\s*$/m).slice(1);
  for (const job of jobs) {
    if (!/node (?:\.\.\/)?(?:trusted\/)?scripts\//.test(job)) continue;
    assert.match(job, /ref: main/, `a job runs automation tooling without checking main out:\n${job.slice(0, 200)}`);
  }
  assert.match(SWEEP_YML, /ref: main/, 'the sweep must plan from trusted tooling');
  // The one checkout of untrusted content is the PR merge ref, and nothing in it runs.
  const untrusted = COORDINATOR_YML.match(/ref: refs\/pull\/[^\n]*/g) || [];
  assert.ok(untrusted.length >= 1, 'CI still checks out the synthetic merge ref');
});

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
