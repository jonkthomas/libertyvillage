// Serial negative controls N1–N5 for the local supervisor acceptance gate.
// Eval-owned; FROZEN by evals/local-supervisor-acceptance.sha256.
//
// Each scenario runs the REAL `cli.mjs run` child in a fresh isolated root
// (N3+N4 share one root: N4 is the transport of N3's diagnostic). Failure is
// acceptable only when it fails closed and cleans up. N5 is the second and
// last live-generation scenario; N1–N4 never touch the live model.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  Checks, assertTrue, readSpawnLog, spawnEntriesFor,
} from './helpers/acceptance-evidence.mjs';
import { prepareScenario, writeGenerateShim, shimPost, firstBlogImage, liveGenerationChecks } from './helpers/acceptance-scenario.mjs';

const noBaselineArtifacts = (scenario, ch, id) => {
  ch.check(`${id}-clean`, 'no data branch, dispatch, PR, or candidate-state write escaped the failure', () => {
    const heads = scenario.fixture.remoteHeads().map(([name]) => name);
    assertTrue(!heads.some((name) => name.startsWith('supervisor/blog-data-')), 'a data branch exists');
    assertTrue(!scenario.sim.events.some((event) => event.type === 'dispatch'), 'a repository dispatch was posted');
    assertTrue(scenario.sim.pulls().length === 0, 'a pull request exists');
    return null;
  });
};

// Extracts the machine payload of the durable candidate-state issue and walks
// its string values, so equality checks are made against parsed content rather
// than a raw (JSON-escaped) body substring.
const candidateStateStrings = (issueBody) => {
  const match = String(issueBody).match(/automation-candidate-state:({[\s\S]*?}) -->/);
  if (!match) return null;
  const values = [];
  const walk = (node) => {
    if (typeof node === 'string') { values.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  try { walk(JSON.parse(match[1])); } catch { return null; }
  return values;
};

const cleanupAsserts = (scenario, ch, id, runRow) => {
  ch.check(`${id}-cleanup`, 'lease null, owner lock absent, supervisor worktree removed', () => {
    const ledger = fs.existsSync(scenario.ledgerFile) ? JSON.parse(fs.readFileSync(scenario.ledgerFile, 'utf8')) : { lease: null };
    assertTrue(!ledger.lease, 'ledger lease survived');
    assertTrue(!fs.existsSync(path.join(scenario.stateDir, 'run.owner')), 'run.owner lock survived');
    if (runRow?.run_id) assertTrue(!fs.existsSync(path.join(scenario.stateDir, 'work', runRow.run_id)), 'worktree directory survived');
    return null;
  });
};

async function runN1(context) {
  const ch = new Checks('N1-baseline-failure');
  const scenario = await prepareScenario(context, {
    name: 'n1',
    mutateStaging: (build, git) => {
      fs.writeFileSync(path.join(build, 'tests/supervisor/acceptance-n1-fail.test.mjs'), [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "test('acceptance N1 deliberately failing baseline test', () => { assert.equal(1, 2, 'planted baseline failure'); });",
        '',
      ].join('\n'));
      git(['add', '--all']);
      git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=a@b.c', 'commit', '-m', 'fixture: N1 failing supervisor test']);
    },
  });
  try {
    const result = await scenario.runChild(20 * 60_000);
    const rows = scenario.ledgerRows();
    const runRow = rows.at(-1);
    ch.check('N1-terminal', 'nonzero exit with ledger terminal BASELINE_FAILED', () => {
      assertTrue(result.code !== 0 && !result.deadlineHit, `exit ${result.code} deadline=${result.deadlineHit}`);
      assertTrue(runRow?.terminal === 'BASELINE_FAILED', `terminal ${runRow?.terminal}`);
      return null;
    });
    ch.check('N1-order', 'baseline commands before the failing one ran in order; nothing ran after it', () => {
      const entries = readSpawnLog(scenario.spawnLog);
      const observed = [];
      for (const entry of entries) {
        const argv = (entry.argv || []).map(String);
        const npmIndex = argv.findIndex((part) => /npm-cli\.js$/.test(part));
        if (npmIndex >= 0) {
          const rest = argv.slice(npmIndex + 1).filter((part) => !part.startsWith('-'));
          if (rest[0] === 'ci') observed.push('ci');
          else if (rest[0] === 'run') observed.push(rest[1]);
        }
      }
      const expected = ['ci', 'lint:automation', 'lint:supervisor', 'test:automation', 'test:supervisor'];
      for (const [index, step] of expected.entries()) {
        assertTrue(observed.indexOf(step) >= 0, `baseline step never ran: ${step}`);
        if (index > 0) assertTrue(observed.indexOf(step) > observed.indexOf(expected[index - 1]), `baseline order broke at ${step}`);
      }
      assertTrue(!spawnEntriesFor(entries, 'coordinator.mjs').some((entry) => entry.cwd === scenario.fixture.clone),
        'a host coordinator subprocess ran after the failing baseline');
      assertTrue(scenario.sessionFiles().length === 0, 'a Pi session exists');
      return observed;
    });
    ch.check('N1-error', 'ledger error preserves full bounded command stdout/stderr', () => {
      assertTrue(typeof runRow?.error === 'string' && runRow.error.includes('stdout:') && runRow.error.includes('stderr:'),
        'bounded stdout/stderr missing from ledger error');
      assertTrue(runRow.error.includes('planted baseline failure') || runRow.error.includes('test:supervisor'),
        'ledger error does not carry the failing test evidence');
      return null;
    });
    noBaselineArtifacts(scenario, ch, 'N1');
    ch.check('N1-noladder', 'candidate-state issue body is byte-identical to the seeded empty state (no candidate-state write)', () => {
      const issue = [...scenario.sim.issues.values()].find((entry) => entry.title === 'automation-state: blog candidate ladder');
      assertTrue(issue, 'the seeded candidate-state issue is missing');
      assertTrue(typeof scenario.seededIssueBody === 'string', 'no seeded issue body was captured before the run');
      assertTrue(issue.body === scenario.seededIssueBody, 'the durable candidate-state body changed during a baseline failure');
      assertTrue(!scenario.sim.requests.some((entry) => entry.method === 'PATCH' && entry.path.endsWith(`/issues/${issue.number}`)),
        'a PATCH was issued against the candidate-state issue');
      return null;
    });
    cleanupAsserts(scenario, ch, 'N1', runRow);
  } catch (error) {
    ch.check('N1', 'N1 executed', () => { throw error; });
  } finally { await scenario.cleanup(); }
  return ch;
}

async function runN2(context) {
  const ch = new Checks('N2-sdk-session-failure');
  const scenario = await prepareScenario(context, {
    name: 'n2',
    pi: { model: 'openai/acceptance-missing-model', apiKey: 'acceptance-n2-dummy' },
  });
  try {
    const result = await scenario.runChild(20 * 60_000);
    const rows = scenario.ledgerRows();
    const runRow = rows.at(-1);
    ch.check('N2-terminal', 'reaches GENERATE then fails GENERATION_FAILED_PRE_PR naming the exact unavailable model', () => {
      assertTrue(result.code !== 0 && !result.deadlineHit, `exit ${result.code} deadline=${result.deadlineHit}`);
      assertTrue(runRow?.terminal === 'GENERATION_FAILED_PRE_PR', `terminal ${runRow?.terminal}`);
      assertTrue(String(runRow?.error || '').includes('acceptance-missing-model'), 'error does not name the unavailable model');
      assertTrue((runRow?.sha_history || []).length === 0 && runRow?.pr_number === null, 'run advanced past generation');
      return { error: String(runRow?.error || '').slice(0, 200) };
    });
    ch.check('N2-ladder', 'durable candidate outcome recorded exactly once with the run/topic idempotency key', () => {
      const issue = [...scenario.sim.issues.values()].find((entry) => entry.title === 'automation-state: blog candidate ladder');
      assertTrue(issue, 'candidate-state issue is missing');
      const occurrences = issue.body.split(`blog:${runRow.run_id}`).length - 1;
      assertTrue(occurrences === 1, `run key appears ${occurrences} times in the durable ladder`);
      return null;
    });
    noBaselineArtifacts(scenario, ch, 'N2');
    cleanupAsserts(scenario, ch, 'N2', runRow);
  } catch (error) {
    ch.check('N2', 'N2 executed', () => { throw error; });
  } finally { await scenario.cleanup(); }
  return ch;
}

async function runN3N4(context) {
  const ch = new Checks('N3-N4-lint-rejection');
  const scenario = await prepareScenario(context, { name: 'n3n4' });
  try {
    writeGenerateShim(scenario, { post: shimPost({ dirty: true, image: firstBlogImage(context.repoRoot) }) });
    const result = await scenario.runChild(15 * 60_000);
    const rows = scenario.ledgerRows();
    const runRow = rows.at(-1);
    ch.check('N3-terminal', "real CLI mapped LINT → DISCARDED_PRE_PR (cli.mjs catch boundary), nonzero exit", () => {
      assertTrue(result.code !== 0 && !result.deadlineHit, `exit ${result.code} deadline=${result.deadlineHit}`);
      assertTrue(runRow?.terminal === 'DISCARDED_PRE_PR', `terminal ${runRow?.terminal}`);
      assertTrue(runRow?.pi_session_file && runRow.pi_session_file.startsWith(path.join(scenario.stateDir, 'pi-sessions')),
        'LINT state was never persisted with a session file');
      return null;
    });
    ch.check('N3-linter', 'real 557-line linter rejected the shimmed unsupported claim', () => {
      assertTrue(String(runRow?.error || '').includes('blog-lint refused') || String(runRow?.error || '').includes('unrecorded-business'),
        'ledger error does not carry the linter rejection');
      return null;
    });
    ch.check('N3-shape', 'trusted linter invocation shape: repoRoot script, cwd=workDir, relative data paths', () => {
      const lint = spawnEntriesFor(readSpawnLog(scenario.spawnLog), 'scripts/blog-lint.mjs')
        .find((entry) => entry.cwd.startsWith(path.join(scenario.stateDir, 'work')));
      assertTrue(lint, 'no lint invocation from the staging worktree was observed');
      assertTrue(lint.argv[1] === path.join(scenario.fixture.clone, 'scripts/blog-lint.mjs'), `script path ${lint.argv[1]}`);
      assertTrue(lint.argv[lint.argv.indexOf('--posts') + 1] === 'data/posts.json'
        && lint.argv[lint.argv.indexOf('--businesses') + 1] === 'data/businesses.json', 'data paths are not relative');
      return null;
    });
    ch.check('N3-lint-mode', 'unset/invalid LINT_MODE still resolves to fail; warn is not used by acceptance', () => {
      assertTrue(scenario.prod.resolveLintMode({}) === 'fail' && scenario.prod.resolveLintMode({ LINT_MODE: 'nonsense' }) === 'fail',
        'resolveLintMode default drifted');
      assertTrue(!('LINT_MODE' in scenario.env), 'acceptance env must not set LINT_MODE');
      return null;
    });
    noBaselineArtifacts(scenario, ch, 'N3');
    ch.check('N4-multiline', 'ledger error preserves rich multiline bounded diagnostics beyond 512 characters', () => {
      const error = String(runRow?.error || '');
      assertTrue(error.includes('\n') && [...error].length > 512, `error is ${[...error].length} chars, multiline=${error.includes('\n')}`);
      assertTrue(error.includes('stdout:'), 'bounded stdout section missing');
      return null;
    });
    ch.check('N4-reason', 'coordinator --reason is one bounded line: ≤512 chars, no Unicode control/separator chars, literal …[truncated], equal to boundedOutcomeReason', () => {
      const record = spawnEntriesFor(readSpawnLog(scenario.spawnLog), 'coordinator.mjs')
        .find((entry) => entry.argv.includes('record-candidate-outcome'));
      assertTrue(record, 'record-candidate-outcome never ran');
      const reason = record.argv[record.argv.indexOf('--reason') + 1];
      assertTrue(typeof reason === 'string' && reason === reason.trim() && [...reason].length <= 512, 'reason is not a bounded trimmed line');
      assertTrue(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(reason), 'reason contains Unicode control or separator characters');
      assertTrue([...String(runRow.error)].length > 512, 'control error: the raw diagnostic is not longer than the bound, so truncation cannot be proven');
      assertTrue(reason.endsWith('…[truncated]'), 'a >512-char diagnostic was not truncated with the literal …[truncated] marker');
      assertTrue(reason === scenario.prod.boundedOutcomeReason(runRow.error), 'reason does not equal boundedOutcomeReason(ledger error)');
      return { reason: reason.slice(0, 120) };
    });
    ch.check('N4-durable', 'durable candidate-state issue content carries the exact bounded reason', () => {
      const issue = [...scenario.sim.issues.values()].find((entry) => entry.title === 'automation-state: blog candidate ladder');
      assertTrue(issue, 'candidate-state issue is missing');
      const record = spawnEntriesFor(readSpawnLog(scenario.spawnLog), 'coordinator.mjs')
        .find((entry) => entry.argv.includes('record-candidate-outcome'));
      const reason = record.argv[record.argv.indexOf('--reason') + 1];
      const values = candidateStateStrings(issue.body);
      assertTrue(Array.isArray(values), 'candidate-state issue body has no parseable machine payload');
      assertTrue(values.some((value) => value === reason || value.endsWith(reason)),
        'no durable candidate-state value equals the bounded reason');
      return null;
    });
    await ch.checkAsync('N4-replay', 'replaying the same run/topic outcome key moves the ladder zero times', async () => {
      const issue = [...scenario.sim.issues.values()].find((entry) => entry.title === 'automation-state: blog candidate ladder');
      const before = issue.body;
      const outputFile = path.join(scenario.root, 'replay-output.txt');
      fs.writeFileSync(outputFile, '');
      execFileSync(process.execPath, [
        path.join(scenario.fixture.clone, 'scripts/automation/coordinator.mjs'), 'record-candidate-outcome',
        '--repo', 'acceptance/libertyvillage', '--kind', 'blog', '--outcome', 'DISCARDED_PRE_PR',
        '--key', runRow.run_id, '--topic-key', runRow.topic_key, '--reason', 'replay',
      ], {
        cwd: scenario.fixture.clone, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...scenario.env, GITHUB_OUTPUT: outputFile, NODE_OPTIONS: '', LV_ACCEPT_SPAWN_LOG: '' },
      });
      const output = fs.readFileSync(outputFile, 'utf8');
      assertTrue(/recorded=false/.test(output), `replay recorded a second ladder movement: ${output}`);
      assertTrue(issue.body === before, 'replay changed the durable ladder body');
      return null;
    });
    cleanupAsserts(scenario, ch, 'N3', runRow);
  } catch (error) {
    ch.check('N3N4', 'N3/N4 executed', () => { throw error; });
  } finally { await scenario.cleanup(); }
  return ch;
}

async function runN5(context) {
  const ch = new Checks('N5-pr-check-failure');
  let scenario = null;
  let result = null;
  try {
    for (let attempt = 1; attempt <= 2 && !result; attempt += 1) {
      context.budget.claim('serial-n5', attempt);
      const candidate = await prepareScenario(context, { name: `n5-a${attempt}`, pi: { live: true }, controls: { checks: 'fail' } });
      const attemptResult = await candidate.runChild(25 * 60_000);
      const row = candidate.ledgerRows().at(-1);
      if (row?.terminal === 'BLOCKED_VALIDATION') { scenario = candidate; result = attemptResult; } else {
        ch.note(`attempt-${attempt}`, `live N5 attempt ended ${row?.terminal ?? 'without a terminal'} (exit ${attemptResult.code})`, attemptResult.stderr.slice(-800));
        const failedScan = candidate.shredAndScan({ stdout: attemptResult.stdout, stderr: attemptResult.stderr });
        await candidate.cleanup();
        if (failedScan.hits.length) throw new Error(`SECRET_LEAKED after a failed N5 live attempt: ${failedScan.hits.join(', ')}`);
        if (attempt === 2) throw new Error('N5 never reached BLOCKED_VALIDATION within the live budget');
      }
    }
    const { fixture, sim } = scenario;
    const runRow = scenario.ledgerRows().at(-1);
    const pr = sim.pulls().find((entry) => entry.baseRef === 'main');
    const n5Scan = scenario.shredAndScan({ stdout: result.stdout, stderr: result.stderr });
    scenario.retain(context.reportDir, 'serial-n5', { 'child-stdout.txt': result.stdout, 'child-stderr.txt': result.stderr });
    ch.check('N5-secrets', 'auth.json shredded; no literal credential in ledger, sessions, HTTP log, or simulator events', () => {
      assertTrue(n5Scan.hits.length === 0, `SECRET_LEAKED: ${n5Scan.hits.join(', ')}`);
      return null;
    });
    ch.check('N5-terminal', 'monitor returned BLOCKED_VALIDATION (never PUBLISHED_MAIN / MERGED_STAGING), child nonzero', () => {
      assertTrue(result.code !== 0 && !result.deadlineHit, `exit ${result.code} deadline=${result.deadlineHit}`);
      assertTrue(runRow.terminal === 'BLOCKED_VALIDATION', `terminal ${runRow.terminal}`);
      assertTrue(!result.stdout.includes('PUBLISHED_MAIN:') && !result.stdout.includes('MERGED_STAGING:'), 'a success terminal was printed');
      return null;
    });
    liveGenerationChecks({ scenario, runRow, stagingBefore: fixture.stagingSha, ch, prefix: 'N5-live' });
    ch.check('N5-order', 'generation/lint preceded the data branch and dispatch; failed statuses were driven only after the host pinned the OPEN PR', () => {
      assertTrue(scenario.sessionFiles().length >= 1 && runRow.pi_session_file, 'no live session evidence');
      const types = sim.events.map((event) => event.type);
      assertTrue(types.indexOf('dispatch') >= 0 && types.indexOf('ingest-pr-created') > types.indexOf('dispatch'),
        'PR was not created by the ingest dispatch');
      const pinned = sim.events.findIndex((event) => event.type === 'host-observed-pinned-head' && event.number === pr?.number);
      const firstFailed = sim.events.findIndex((event) => event.type === 'status' && event.sha === pr?.headSha && event.state === 'failure');
      assertTrue(pinned >= 0, 'the host was never observed pinning the head');
      assertTrue(sim.events[pinned].prState === 'open' && sim.events[pinned].statusesAtObservation === 0,
        'the host did not observe an OPEN, status-free PR before checks existed');
      assertTrue(firstFailed > pinned, 'failed statuses existed before the host pinned the head');
      return null;
    });
    ch.check('N5-audit', 'trusted validation-failed audit existed for the exact head before the monitor returned', () => {
      assertTrue(pr, 'no owned PR');
      const audit = sim.events.find((event) => event.type === 'audit-comment' && event.sha === pr.headSha && event.decision === 'validation-failed');
      assertTrue(audit, 'no trusted audit for the exact head');
      const failed = sim.statusesFor(pr.headSha).filter((status) => status.state === 'failure');
      assertTrue(failed.length >= 1, 'no failed exact-head status was published');
      return null;
    });
    ch.check('N5-finalize', 'ladder outcome recorded before the exact owned PR was closed unmerged', () => {
      const requests = sim.requests;
      const ladderIndex = requests.findIndex((entry) => entry.method === 'PATCH' && /\/issues\/\d+$/.test(entry.path));
      const closeIndex = requests.findIndex((entry) => entry.method === 'PATCH' && entry.path.endsWith(`/pulls/${pr.number}`) && entry.body?.state === 'closed');
      assertTrue(closeIndex >= 0, 'the owned PR was never closed');
      assertTrue(ladderIndex >= 0 && ladderIndex < closeIndex, 'durable ladder write did not precede PR closure');
      assertTrue(pr.state === 'closed' && pr.merged === false, 'PR is not closed-unmerged');
      return null;
    });
    ch.check('N5-refs', 'main and staging trees are unchanged; data branch and worktree removed', () => {
      assertTrue(fixture.rev('main') === fixture.baseSha, 'main moved');
      assertTrue(fixture.rev('staging') === fixture.stagingSha, 'staging moved');
      assertTrue(!fixture.remoteHeads().some(([name]) => name.startsWith('supervisor/blog-data-')), 'data branch survived');
      return null;
    });
    ch.check('N5-antigaming', 'wrong-SHA statuses, untrusted audits, and unrelated drift cannot turn this green', () => {
      const { prod } = scenario;
      let threw = false;
      try { prod.statusForExactSha({ sha: 'a'.repeat(40), statuses: [] }, pr.headSha); } catch { threw = true; }
      assertTrue(threw, 'statusForExactSha accepted a drifted payload SHA');
      const untrusted = prod.latestAuditForSha([{ user: { login: 'mallory' }, body: `<!-- automation-audit-data:${JSON.stringify({ sha: pr.headSha, decision: 'passed', attempt: 0 })} -->` }], pr.headSha);
      assertTrue(untrusted === null, 'an untrusted audit author was honored');
      return null;
    });
    cleanupAsserts(scenario, ch, 'N5', runRow);
    verifyNoSuccess(ch, runRow);
    await scenario.cleanup();
  } catch (error) {
    ch.check('N5', 'N5 executed', () => { throw error; });
    if (scenario) { try { await scenario.cleanup(); } catch { /* best effort */ } }
  }
  return ch;
}

function verifyNoSuccess(ch, runRow) {
  ch.check('N5-nosuccess', 'BLOCKED_VALIDATION is terminal and is not a success token', () => {
    assertTrue(runRow.state === 'TERMINAL' && runRow.terminal === 'BLOCKED_VALIDATION', 'terminal drifted');
    return null;
  });
}

export async function run(context) {
  return [await runN1(context), await runN2(context), await runN3N4(context), await runN5(context)];
}
