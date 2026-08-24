// Production-wiring tests for the bounded candidate ladder.
//
// These EXECUTE the shipped CLI — `node scripts/automation/coordinator.mjs ...` —
// against an in-memory GitHub, once per simulated scheduled run, exactly as the
// weekly workflows do. Nothing here greps source: every assertion is about what the
// real command did to real (fake-hosted) repository state.
//
// What they pin down:
//   * an automation-blocked PR whose recorded decision leaves no repair work does
//     NOT sit on `repair` forever (it closes after the cooldown and regenerates);
//   * a draft the claim linter refused BEFORE any PR existed still costs one
//     regeneration, still respects the >=24h cooldown, and still ends in a visible
//     ABANDONED_TOPIC at the cap;
//   * the same ladder governs `blog` and `seo`, each through its own kind;
//   * no path ever reuses the rejected draft, publishes, or lowers the gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createFakeGitHub } from './helpers/fake-github.mjs';
import { MAX_CANDIDATE_REGENERATIONS } from '../../scripts/automation/recovery.mjs';
import { parseCandidateState, stateIssueTitle } from '../../scripts/automation/candidate-state.mjs';

const REPO = 'owner/repo';
const COORDINATOR = fileURLToPath(new URL('../../scripts/automation/coordinator.mjs', import.meta.url));
const TOPIC_QUEUE_FIXTURE = fileURLToPath(new URL('./fixtures/candidate-ladder/topic-queue.json', import.meta.url));
const FROZEN_TOPIC_QUEUE = JSON.parse(fs.readFileSync(TOPIC_QUEUE_FIXTURE, 'utf8'));
const SHA = (char) => char.repeat(40);

const execFileAsync = promisify(execFile);

// One scheduled-run invocation of the real CLI. Returns the parsed step outputs,
// the exit code and the log, so a test can assert on what the workflow would see.
// It must stay ASYNC: the fake GitHub is served from this process, so blocking the
// event loop on the child would deadlock the request it is waiting for.
async function run(apiUrl, args, { cwd } = {}) {
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-ladder-')), 'out.txt');
  fs.writeFileSync(outputFile, '');
  let status = 0;
  let stdout = '';
  try {
    const result = await execFileAsync(process.execPath, [COORDINATOR, ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_API_URL: apiUrl,
        GH_TOKEN: 'test-token',
        GITHUB_OUTPUT: outputFile,
        TOPIC_QUEUE_PATH: TOPIC_QUEUE_FIXTURE,
      },
    });
    stdout = `${result.stdout}${result.stderr}`;
  } catch (error) {
    status = error.code ?? 1;
    stdout = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  const outputs = {};
  for (const line of fs.readFileSync(outputFile, 'utf8').split('\n').filter(Boolean)) {
    const index = line.indexOf('=');
    outputs[line.slice(0, index)] = line.slice(index + 1);
  }
  return { outputs, status, stdout };
}

function ladderState(hub, kind) {
  const issue = hub.issueByTitle(stateIssueTitle(kind));
  if (!issue) return null;
  const parsed = parseCandidateState(issue.body, kind);
  assert.equal(parsed.ok, true, `durable ladder must stay readable: ${parsed.errors.join('; ')}`);
  return { issue, state: parsed.state };
}

// The invariants that must hold on EVERY output of EVERY run, forever.
function assertSafeOutputs(result) {
  assert.notEqual(result.outputs.action, 'publish', 'the ladder must never force-publish a blocked candidate');
  assert.ok(!('reuse_draft' in result.outputs) || result.outputs.reuse_draft !== 'true',
    'regeneration must be a FRESH grounded draft, never the rejected one');
  assert.ok(!('lower_threshold' in result.outputs), 'the ladder must never expose a gate-lowering lever');
  assert.doesNotMatch(result.stdout, /reuseDraft|lowerThreshold|force[- ]publish/i,
    'no path may re-push the rejected draft or lower the gate');
}

async function withHub(fn) {
  const hub = createFakeGitHub({ repo: REPO });
  const url = await hub.listen();
  try {
    await fn(hub, url);
  } finally {
    await hub.close();
  }
}

test('bounded-ladder scenarios ignore extra topics in the mutable repository queue', async () => {
  const mutableRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-ladder-live-queue-'));
  const mutableQueuePath = path.join(mutableRepo, 'data', 'topic-queue.json');
  fs.mkdirSync(path.dirname(mutableQueuePath), { recursive: true });

  const extraTopics = ['blog', 'seo'].map((kind, index) => ({
    key: String(index + 8).repeat(64),
    kind,
    title: `Mutable live ${kind} topic that must not enter the bounded ladder`,
    source: 'live-topic-discovery',
    rationale: 'Regression decoy: this eligible topic would rotate immediately after the fixture topic fails.',
    addedAt: '2026-08-24T00:00:00.000Z',
    attempts: 0,
    branchPrefix: `${kind}/auto-`,
  }));
  fs.writeFileSync(mutableQueuePath, `${JSON.stringify({
    ...FROZEN_TOPIC_QUEUE,
    topics: [...FROZEN_TOPIC_QUEUE.topics, ...extraTopics],
  }, null, 2)}\n`);

  for (const kind of ['blog', 'seo']) {
    const fixtureTopics = FROZEN_TOPIC_QUEUE.topics.filter((topic) => topic.kind === kind);
    assert.equal(fixtureTopics.length, 1, `${kind}: the bounded-ladder fixture must stay a one-topic queue`);

    await withHub(async (hub, url) => {
      const first = await run(url, ['plan-candidate', '--repo', REPO, '--kind', kind], { cwd: mutableRepo });
      assert.equal(first.status, 0, first.stdout);
      assert.equal(first.outputs.generate, 'true');
      assert.equal(first.outputs.topic_key, fixtureTopics[0].key);

      const failed = await run(url, [
        'record-candidate-outcome', '--repo', REPO, '--kind', kind,
        '--outcome', 'generation-failed', '--key', `${kind}-isolated-run`, '--reason', 'fixture candidate failed',
      ], { cwd: mutableRepo });
      assert.equal(failed.status, 0, failed.stdout);
      assert.equal(failed.outputs.regenerations, '1');

      const tooSoon = await run(url, ['plan-candidate', '--repo', REPO, '--kind', kind], { cwd: mutableRepo });
      assert.equal(tooSoon.status, 0, tooSoon.stdout);
      assert.equal(tooSoon.outputs.action, 'wait', `${kind}: an eligible live decoy must not bypass the fixture topic cooldown`);
      assert.equal(tooSoon.outputs.generate, 'false');
      assert.equal(tooSoon.outputs.topic_key, fixtureTopics[0].key);
    });
  }
});

test('a blocked candidate with no useful repair work left is not stranded on `repair`', async () => {
  await withHub(async (hub, url) => {
    // Exactly the reviewer's reproducer: automation-blocked, zero repair attempts,
    // zero heals, so canHeal(0) and canRepair(0) are both true — and the recorded
    // terminal decision is a validation failure no fixer round could ever clear.
    const pr = hub.addPull({ headRef: 'blog/auto-1', headSha: SHA('a'), labels: ['automation-blocked'] });
    hub.addComment(pr.number, `<!-- automation-audit:${SHA('a')}:validation-failed:0 -->\n## Autonomous gate audit`);

    const cooling = await run(url, ['plan-candidate', '--repo', REPO, '--kind', 'blog']);
    assert.equal(cooling.status, 0, cooling.stdout);
    assert.equal(cooling.outputs.action, 'wait', 'a just-blocked candidate cools down first');
    assert.equal(cooling.outputs.generate, 'false');
    assertSafeOutputs(cooling);

    hub.fastForward(48);
    const regenerate = await run(url, ['plan-candidate', '--repo', REPO, '--kind', 'blog']);
    assert.equal(regenerate.status, 0, regenerate.stdout);
    assert.equal(regenerate.outputs.action, 'close-and-regenerate',
      'a stranded validation-failed candidate must enter the bounded ladder, not wait on `repair` forever');
    assert.equal(regenerate.outputs.generate, 'true');
    assert.equal(regenerate.outputs.regenerations, '1');
    assert.equal(hub.pull(pr.number).state, 'closed', 'the failed candidate must actually be closed');
    assertSafeOutputs(regenerate);

    // The count survives the PR closing, because it lives in the durable ladder.
    assert.equal(ladderState(hub, 'blog').state.regenerations, 1);
  });
});

test('a genuinely repairable, still-in-flight candidate keeps its repair budget', async () => {
  await withHub(async (hub, url) => {
    const pr = hub.addPull({ headRef: 'blog/auto-2', headSha: SHA('b'), labels: ['automation-blocked', 'automation-repair-1'] });
    // The last durable decision is a repair continuation: the loop is mid-flight.
    hub.addComment(pr.number, `<!-- automation-audit:${SHA('b')}:repairing:1 -->`);
    hub.fastForward(48);

    const result = await run(url, ['plan-candidate', '--repo', REPO, '--kind', 'blog']);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.outputs.action, 'repair', 'a repairable block must not be misclassified as no useful work');
    assert.equal(result.outputs.generate, 'false');
    assert.equal(hub.pull(pr.number).state, 'open', 'a mid-flight candidate must not be closed');
    assertSafeOutputs(result);
  });
});

test('a lint-refused draft costs one regeneration, idempotently, with no pull request', async () => {
  await withHub(async (hub, url) => {
    const first = await run(url, ['plan-candidate', '--repo', REPO, '--kind', 'blog']);
    assert.equal(first.outputs.generate, 'true', 'the first cycle of a fresh topic generates');
    assert.equal(first.outputs.regenerations, '0');

    const discard = await run(url, [
      'record-candidate-outcome', '--repo', REPO, '--kind', 'blog',
      '--outcome', 'lint-discarded', '--key', 'run-1-attempt-1', '--reason', 'ungrounded claim',
    ]);
    assert.equal(discard.status, 0, discard.stdout);
    assert.equal(discard.outputs.action, 'close-and-regenerate');
    assert.equal(discard.outputs.recorded, 'true');
    assert.equal(discard.outputs.regenerations, '1');
    assert.equal(ladderState(hub, 'blog').state.regenerations, 1);

    // A rerun of the SAME workflow attempt replays the same key and buys nothing.
    const rerun = await run(url, [
      'record-candidate-outcome', '--repo', REPO, '--kind', 'blog',
      '--outcome', 'lint-discarded', '--key', 'run-1-attempt-1', '--reason', 'ungrounded claim',
    ]);
    assert.equal(rerun.status, 0, rerun.stdout);
    assert.equal(rerun.outputs.recorded, 'false', 'the ladder must dedupe a replayed event');
    assert.equal(ladderState(hub, 'blog').state.regenerations, 1, 'a rerun must not buy extra budget');

    // And no pull request was opened for the refused draft.
    assert.equal(hub.requests.filter((request) => request.method === 'POST' && /\/pulls$/.test(request.path)).length, 0);
  });
});

test('a lint refusal after a successful generation is not also counted as a generation failure', async () => {
  await withHub(async (hub, url) => {
    const lint = await run(url, [
      'record-candidate-outcome', '--repo', REPO, '--kind', 'blog',
      '--outcome', 'lint-discarded', '--key', 'run-1-attempt-1', '--reason', 'ungrounded claim',
    ]);
    assert.equal(lint.outputs.recorded, 'true');
    assert.equal(lint.outputs.regenerations, '1');

    const alsoGenerate = await run(url, [
      'record-candidate-outcome', '--repo', REPO, '--kind', 'blog',
      '--outcome', 'generation-failed', '--key', 'run-1-attempt-1', '--reason', 'generator threw',
    ]);
    assert.equal(alsoGenerate.status, 0, alsoGenerate.stdout);
    assert.equal(alsoGenerate.outputs.recorded, 'false',
      'the same run key must not spend a second regeneration when a later step also fails');
    assert.equal(ladderState(hub, 'blog').state.regenerations, 1);
  });
});

test('scheduled generation failures for blog and SEO each end in a visible ABANDONED_TOPIC', async () => {
  for (const kind of ['blog', 'seo']) {
    await withHub(async (hub, url) => {
      const fail = async (key) => run(url, [
        'record-candidate-outcome', '--repo', REPO, '--kind', kind,
        '--outcome', 'generation-failed', '--key', key, '--reason', `${kind} generator failed before a pull request existed`,
      ]);
      const plan = async () => run(url, ['plan-candidate', '--repo', REPO, '--kind', kind]);

      assert.equal((await plan()).outputs.generate, 'true', `${kind}: first cycle generates`);
      assert.equal((await fail('run-1')).outputs.regenerations, '1', `${kind}: first pre-PR failure costs one regeneration`);
      assert.equal(hub.requests.filter((request) => request.method === 'POST' && /\/pulls$/.test(request.path)).length, 0,
        `${kind}: a generator failure must not open a content PR`);

      const tooSoon = await plan();
      assert.equal(tooSoon.outputs.action, 'wait', `${kind}: a failed generation must not hot-loop`);
      assert.equal(tooSoon.outputs.generate, 'false');

      hub.fastForward(25);
      const second = await plan();
      assert.equal(second.outputs.generate, 'true', `${kind}: cooldown elapsed, fresh candidate`);
      assert.equal((await fail('run-3')).outputs.regenerations, String(MAX_CANDIDATE_REGENERATIONS));

      hub.fastForward(25);
      const abandoned = await plan();
      assert.equal(abandoned.status, 0, abandoned.stdout);
      assert.equal(abandoned.outputs.action, 'abandon-topic', `${kind}: third bounded candidate abandons`);
      assert.equal(abandoned.outputs.generate, 'false');
      assertSafeOutputs(abandoned);

      const ladder = ladderState(hub, kind);
      assert.equal(ladder.state.abandoned, true, `${kind}: abandonment must be durable`);
      assert.equal(
        hub.commentsOn(ladder.issue.number).filter((comment) => comment.body.includes('ABANDONED_TOPIC')).length, 1,
        `${kind}: ABANDONED_TOPIC must be visible exactly once`,
      );

      const after = await plan();
      assert.equal(after.outputs.action, 'wait');
      assert.equal(after.outputs.reason, 'no eligible topics');
      assert.equal(after.outputs.generate, 'false');
      assert.equal(
        hub.commentsOn(ladder.issue.number).filter((comment) => comment.body.includes('ABANDONED_TOPIC')).length, 1,
        `${kind}: a later tick must not re-announce abandonment`,
      );
    });
  }
});

test('an SEO pre-PR guard failure uses the same bounded ladder as a generation failure', async () => {
  await withHub(async (hub, url) => {
    const first = await run(url, [
      'record-candidate-outcome', '--repo', REPO, '--kind', 'seo',
      '--outcome', 'guard-failed', '--key', 'run-guard-1', '--reason', 'forbidden path',
    ]);
    assert.equal(first.status, 0, first.stdout);
    assert.equal(first.outputs.recorded, 'true');
    assert.equal(first.outputs.regenerations, '1');
    assert.equal(ladderState(hub, 'seo').state.regenerations, 1);

    const replay = await run(url, [
      'record-candidate-outcome', '--repo', REPO, '--kind', 'seo',
      '--outcome', 'guard-failed', '--key', 'run-guard-1', '--reason', 'forbidden path',
    ]);
    assert.equal(replay.outputs.recorded, 'false');
    assert.equal(ladderState(hub, 'seo').state.regenerations, 1);
  });
});

test('the lint-discard ladder respects the cooldown and ends in a visible ABANDONED_TOPIC', async () => {
  await withHub(async (hub, url) => {
    const discard = async (key) => run(url, [
      'record-candidate-outcome', '--repo', REPO, '--kind', 'blog',
      '--outcome', 'lint-discarded', '--key', key, '--reason', 'the claim linter refused the draft',
    ]);
    const plan = async () => run(url, ['plan-candidate', '--repo', REPO, '--kind', 'blog']);

    // Scheduled run 1 — generate, then the linter refuses the draft.
    assert.equal((await plan()).outputs.generate, 'true');
    assert.equal((await discard('run-1')).outputs.regenerations, '1');

    // Scheduled run 2, same day — the cooldown forbids an immediate retry.
    const tooSoon = await plan();
    assert.equal(tooSoon.outputs.action, 'wait', 'a discarded draft must not hot-loop into another generation');
    assert.equal(tooSoon.outputs.generate, 'false');

    // Scheduled run 3, a full cycle later — a FRESH candidate, regeneration 1.
    hub.fastForward(25);
    const second = await plan();
    assert.equal(second.outputs.generate, 'true');
    assert.equal(second.outputs.regenerations, String(MAX_CANDIDATE_REGENERATIONS - 1));
    assert.equal((await discard('run-3')).outputs.regenerations, String(MAX_CANDIDATE_REGENERATIONS));

    // Scheduled run 4, another cycle later — the budget is gone. Visibly.
    hub.fastForward(25);
    const abandoned = await plan();
    assert.equal(abandoned.status, 0, abandoned.stdout);
    assert.equal(abandoned.outputs.action, 'abandon-topic');
    assert.equal(abandoned.outputs.generate, 'false');
    assertSafeOutputs(abandoned);

    const ladder = ladderState(hub, 'blog');
    assert.equal(ladder.state.abandoned, true, 'the abandonment must be durable, not just an output');
    const announcements = hub.commentsOn(ladder.issue.number).filter((comment) => comment.body.includes('ABANDONED_TOPIC'));
    assert.equal(announcements.length, 1, 'the topic must be abandoned visibly, exactly once');

    // Scheduled run 5 — the topic stays abandoned; the kind waits rather than
    // blocking forever, and the announcement stays deduplicated.
    const after = await plan();
    assert.equal(after.outputs.action, 'wait');
    assert.equal(after.outputs.reason, 'no eligible topics');
    assert.equal(after.outputs.generate, 'false');
    assert.equal(
      hub.commentsOn(ladder.issue.number).filter((comment) => comment.body.includes('ABANDONED_TOPIC')).length, 1,
      'a later tick must not re-announce the abandonment',
    );
  });
});

test('the same bounded ladder governs blog and SEO, each through its own kind', async () => {
  for (const [kind, prefix] of [['blog', 'blog/auto-'], ['seo', 'seo/auto-']]) {
    await withHub(async (hub, url) => {
      const plan = async () => run(url, ['plan-candidate', '--repo', REPO, '--kind', kind]);
      const outcomes = [];

      for (let candidate = 1; candidate <= MAX_CANDIDATE_REGENERATIONS + 1; candidate += 1) {
        const decision = await plan();
        outcomes.push(decision);
        assertSafeOutputs(decision);
        if (decision.outputs.generate !== 'true') break;

        // The generator opens a candidate; the loop blocks it with a decision that
        // has no repair work left, exactly as block-generator would record.
        const sha = SHA(String.fromCharCode(97 + candidate));
        const pr = hub.addPull({ headRef: `${prefix}${candidate}`, headSha: sha, labels: ['automation-blocked'] });
        hub.addComment(pr.number, `<!-- automation-audit:${sha}:unrepairable:0 -->`);
        hub.fastForward(30);
      }

      const last = await plan();
      assert.equal(last.outputs.action, 'abandon-topic',
        `${kind}: the ladder must end in a human-visible abandonment, not another candidate`);
      assert.equal(last.outputs.generate, 'false');
      assertSafeOutputs(last);
      assert.equal(ladderState(hub, kind).state.abandoned, true);
      assert.ok(outcomes.some((result) => result.outputs.action === 'close-and-regenerate'),
        `${kind}: the ladder must close and regenerate before it abandons`);

      // Every closed candidate carries the reason a human can read.
      const closingComments = hub.requests.filter((request) => /\/issues\/\d+\/comments$/.test(request.path) && request.method === 'POST');
      assert.ok(closingComments.some((request) => /close-and-regenerate/.test(request.body.body)),
        `${kind}: closing a candidate must leave a deduplicated audit comment`);
    });
  }
});

test('an unreadable durable ladder fails the run closed instead of restarting the budget', async () => {
  await withHub(async (hub, url) => {
    hub.addIssue({
      title: stateIssueTitle('blog'),
      labels: ['automation-state'],
      body: '<!-- automation-candidate-state:{"version":1,"kind":"blog","regenerations":99,"lastFailureAt":null,"abandoned":false,"seen":[]} -->',
    });
    const result = await run(url, ['plan-candidate', '--repo', REPO, '--kind', 'blog']);
    assert.equal(result.status, 1, 'an out-of-range ladder must fail closed');
    assert.match(result.stdout, /unreadable/i);
    assert.notEqual(result.outputs.generate, 'true', 'a corrupt ladder must never license a fresh candidate');
  });
});

test('a state issue nobody trusted opened is refused', async () => {
  await withHub(async (hub, url) => {
    hub.addIssue({
      title: stateIssueTitle('seo'),
      labels: ['automation-state'],
      author: 'someone-else',
      body: '<!-- automation-candidate-state:{"version":1,"kind":"seo","regenerations":0,"lastFailureAt":null,"abandoned":false,"seen":[]} -->',
    });
    const result = await run(url, ['plan-candidate', '--repo', REPO, '--kind', 'seo']);
    assert.equal(result.status, 1, 'an untrusted state issue must fail closed');
    assert.match(result.stdout, /not opened by trusted automation/i);
  });
});
