import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateIngestDiff, validateIngestPayload } from '../../scripts/supervisor/ingest-contract.mjs';
import {
  boundedCandidateFlow, COMMAND_OUTPUT_LIMIT, OUTCOME_REASON_LIMIT, readSelectedTopic, recordSupervisorOutcome,
  resolveCandidateReadOnly, resolveHostWeeklyOwner, resolveWeeklyOwner, runCommand,
} from '../../scripts/supervisor/host-run.mjs';
import {
  buildGeneratorPrompt, createConstrainedTools, createPersistentSessionManager, PI_SDK_VERSION, PI_TOOL_ALLOWLIST,
  piSessionOptions, sessionFileForReport, validateSubmittedPost,
} from '../../scripts/supervisor/pi-session.mjs';
import { promotionEnabled } from '../../scripts/automation/promotion-control.mjs';
import { parseWeeklyOwnerFile, readWeeklyOwner } from '../../scripts/automation/weekly-owner.mjs';
import { finalizeOwnedPr, finalizeSupervisorTerminal } from '../../scripts/supervisor/terminal-pr.mjs';
import { latestAuditForSha } from '../../scripts/supervisor/github-monitor.mjs';
import { MAX_RECOVERY_ATTEMPTS, recoverUnfinishedRows, resolveSmokeAgentDir } from '../../scripts/supervisor/cli.mjs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/supervisor-ingest.yml', import.meta.url), 'utf8');
const weekly = fs.readFileSync(new URL('../../.github/workflows/weekly-blog.yml', import.meta.url), 'utf8');
const coordinatorWorkflow = fs.readFileSync(new URL('../../.github/workflows/autonomous-coordinator.yml', import.meta.url), 'utf8');
const constants = fs.readFileSync(new URL('../../scripts/automation/constants.mjs', import.meta.url), 'utf8');
const host = fs.readFileSync(new URL('../../scripts/supervisor/host-run.mjs', import.meta.url), 'utf8');
const githubMonitor = fs.readFileSync(new URL('../../scripts/supervisor/github-monitor.mjs', import.meta.url), 'utf8');
const promotionSweep = fs.readFileSync(new URL('../../.github/workflows/promotion-sweep.yml', import.meta.url), 'utf8');
const piSession = fs.readFileSync(new URL('../../scripts/supervisor/pi-session.mjs', import.meta.url), 'utf8');

test('ingest accepts only bounded metadata and canonical blog paths', () => {
  const valid = { kind: 'blog', data_sha: 'a'.repeat(40), data_branch: 'supervisor/blog-data-1', topic_key: 'topic-one', regenerations: 2 };
  assert.equal(validateIngestPayload(valid).ok, true);
  assert.equal(validateIngestPayload({ ...valid, files: { 'data/posts.json': 'blob' } }).ok, false);
  assert.equal(validateIngestDiff(['data/posts.json', 'public/images/blog/one.jpg']).ok, true);
  assert.equal(validateIngestDiff(['scripts/evil.mjs']).ok, false);
});

test('ingest is repository_dispatch-only and keeps PR authorship in Actions', () => {
  assert.match(workflow, /repository_dispatch:/);
  assert.match(workflow, /Checkout trusted owner control from main/);
  assert.match(workflow, /needs\.resolve-owner\.outputs\.owner == 'exedev'/);
  assert.doesNotMatch(workflow, /vars\.LV_WEEKLY_OWNER/);
  assert.doesNotMatch(workflow, /workflow_dispatch:|schedule:/);
  assert.match(workflow, /github-actions\[bot\]/);
  assert.match(workflow, /coordinator\.mjs dispatch/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /git ls-remote origin "refs\/heads\/\$DATA_BRANCH"/);
  assert.match(constants, /TRUSTED_PR_AUTHORS = Object\.freeze\(\['github-actions\[bot\]'\]\)/);
});

test('supervisor baseline is staging-based and data branches are bounded and cleaned', () => {
  assert.ok(host.indexOf("command('git', ['fetch'") < host.indexOf("readRemoteOwner('main')"),
    'the VM owner check must begin with a read-only fetch before reading remote owner files');
  assert.ok(host.indexOf("readRemoteOwner('staging')") < host.indexOf("command('npm', ['ci']"),
    'both trusted remote branches must agree before work starts');
  assert.match(host, /worktree.*origin\/staging/s);
  assert.match(host, /npm.*lint:supervisor/s);
  assert.match(host, /npm.*test:supervisor/s);
  assert.match(host, /env: \{ \.\.\.process\.env, GITHUB_OUTPUT: output \}/,
    'host coordinator subprocesses must inherit the exe.dev proxy gate');
  assert.match(coordinatorWorkflow, /npm run lint:supervisor/);
  assert.match(coordinatorWorkflow, /npm run test:supervisor/);
  assert.match(host, /timeoutMs = 25 \* 60 \* 1000/);
  assert.match(host, /cleanupDataBranch\(repoRoot, dataBranch\)/);
  assert.match(host, /contextFiles:\s*\[\s*'data\/topic-queue\.json',\s*'data\/businesses\.json',\s*'data\/posts\.json',\s*'scripts\/prompts\/sections\/03-blog-generation\.md'/,
    'generation must receive the trusted queue and canonical local context');
  assert.match(host, /path\.join\(repoRoot, 'scripts\/blog-lint\.mjs'\), '--posts', 'data\/posts\.json', '--businesses', 'data\/businesses\.json'\], \{ cwd: workDir \}/,
    'the trusted main linter must resolve the staging worktree HEAD and relative data paths');
  assert.doesNotMatch(host, /LV_SEO_CONTEXT|LV_SEO_PREFETCH_COMMAND|LV_GCP_CREDENTIALS_PATH|seo-data-latest|refresh-seo/);
  assert.doesNotMatch(host, /trusted_main_sha/);
});

test('relative lint data paths compare only the staging worktree candidate against HEAD', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-lint-baseline-'));
  const data = path.join(directory, 'data');
  fs.mkdirSync(data);
  const historical = {
    slug: 'historical-post', title: 'Historical post',
    content: '**Not In Records Cafe** is the neighbourhood favourite.',
  };
  const candidate = { slug: 'candidate-post', title: 'Candidate post', content: 'A plain neighbourhood guide.' };
  fs.writeFileSync(path.join(data, 'posts.json'), JSON.stringify([historical]));
  fs.writeFileSync(path.join(data, 'businesses.json'), '[]');
  execFileSync('git', ['init', '--initial-branch=staging'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Lint Test'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'lint@example.test'], { cwd: directory });
  execFileSync('git', ['add', 'data/posts.json', 'data/businesses.json'], { cwd: directory });
  execFileSync('git', ['commit', '-m', 'baseline'], { cwd: directory });
  fs.writeFileSync(path.join(data, 'posts.json'), JSON.stringify([historical, candidate]));

  const script = path.resolve('scripts/blog-lint.mjs');
  const relative = execFileSync(process.execPath, [script, '--posts', 'data/posts.json', '--businesses', 'data/businesses.json'], {
    cwd: directory, encoding: 'utf8',
  });
  assert.match(relative, /blog-lint candidate-post: clean/);
  assert.doesNotMatch(relative, /historical-post/);

  assert.throws(() => execFileSync(process.execPath, [
    script, '--posts', path.join(data, 'posts.json'), '--businesses', path.join(data, 'businesses.json'),
  ], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), (error) => {
    assert.match(error.stdout, /No HEAD baseline for .*data\/posts\.json; linting every post/);
    assert.match(error.stdout, /blog-lint historical-post: 1 finding\(s\)/);
    return true;
  });
});

test('supervisor command failures preserve bounded stdout and stderr diagnostics', () => {
  assert.throws(() => runCommand(process.execPath, ['-e', [
    `process.stdout.write('x'.repeat(${COMMAND_OUTPUT_LIMIT + 100}) + 'STDOUT_TAIL')`,
    `process.stderr.write('x'.repeat(${COMMAND_OUTPUT_LIMIT + 100}) + 'STDERR_TAIL')`,
    'process.exit(7)',
  ].join(';')]), (error) => {
    assert.match(error.message, /supervisor command failed \(exit 7\)/);
    assert.match(error.message, /stdout:\n<\d+ characters omitted; showing tail>/);
    assert.match(error.message, /STDOUT_TAIL/);
    assert.match(error.message, /stderr:\n<\d+ characters omitted; showing tail>/);
    assert.match(error.message, /STDERR_TAIL/);
    assert.ok(error.message.length < (2 * COMMAND_OUTPUT_LIMIT) + 1_000);
    return true;
  });
});

test('host ownership ignores a stale local file after fetching trusted branches and fails closed remotely', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-host-owner-'));
  const remote = path.join(directory, 'remote.git');
  const source = path.join(directory, 'source');
  const vm = path.join(directory, 'vm');
  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(directory, ['init', '--bare', remote]);
  fs.mkdirSync(path.join(source, 'ops/exedev-supervisor'), { recursive: true });
  git(source, ['init', '--initial-branch=main']);
  git(source, ['config', 'user.name', 'Owner Test']);
  git(source, ['config', 'user.email', 'owner@example.test']);
  fs.writeFileSync(path.join(source, 'ops/exedev-supervisor/owner.txt'), 'gha\n');
  git(source, ['add', 'ops/exedev-supervisor/owner.txt']);
  git(source, ['commit', '-m', 'owner gha']);
  git(source, ['remote', 'add', 'origin', remote]);
  git(source, ['push', 'origin', 'main', 'HEAD:staging']);
  git(directory, ['clone', '--branch', 'main', remote, vm]);

  fs.writeFileSync(path.join(source, 'ops/exedev-supervisor/owner.txt'), 'exedev\n');
  git(source, ['commit', '-am', 'owner exedev']);
  git(source, ['push', 'origin', 'main', 'HEAD:staging']);
  assert.equal(fs.readFileSync(path.join(vm, 'ops/exedev-supervisor/owner.txt'), 'utf8'), 'gha\n');
  assert.equal(resolveHostWeeklyOwner(vm, { LV_WEEKLY_OWNER: 'exedev' }), 'exedev');

  fs.writeFileSync(path.join(source, 'ops/exedev-supervisor/owner.txt'), 'gha\n');
  git(source, ['commit', '-am', 'mismatch staging']);
  git(source, ['push', 'origin', 'HEAD:staging']);
  assert.throws(() => resolveHostWeeklyOwner(vm, { LV_WEEKLY_OWNER: 'exedev' }), /weekly owner mismatch: main=exedev staging=gha/);

  fs.writeFileSync(path.join(source, 'ops/exedev-supervisor/owner.txt'), 'invalid\n');
  git(source, ['commit', '-am', 'invalid main']);
  git(source, ['push', 'origin', 'HEAD:main']);
  assert.throws(() => resolveHostWeeklyOwner(vm, { LV_WEEKLY_OWNER: 'exedev' }), /must contain exactly/);
});

test('weekly ownership defaults to GHA and manual bypass is explicit', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-weekly-owner-'));
  const ghaOwner = path.join(directory, 'gha-owner.txt');
  const exedevOwner = path.join(directory, 'owner.txt');
  fs.writeFileSync(ghaOwner, 'gha\n');
  fs.writeFileSync(exedevOwner, 'exedev\n');
  assert.equal(resolveWeeklyOwner({}, ghaOwner), 'gha');
  assert.equal(resolveWeeklyOwner({}, exedevOwner), 'exedev');
  assert.equal(resolveWeeklyOwner({ LV_WEEKLY_OWNER: 'exedev' }, exedevOwner), 'exedev');
  assert.throws(() => resolveWeeklyOwner({ LV_WEEKLY_OWNER: 'gha' }, exedevOwner), /weekly owner mismatch/);
  assert.match(weekly, /Checkout trusted owner control from main/);
  assert.match(weekly, /needs\.resolve-owner\.outputs\.owner == 'gha'/);
  assert.match(weekly, /inputs\.force_gha == true/);
  assert.doesNotMatch(weekly, /vars\.LV_WEEKLY_OWNER/);
});

test('owner files are strict and missing, invalid, or VM-mismatched ownership fails closed', () => {
  assert.ok(['gha', 'exedev'].includes(readWeeklyOwner()), 'the committed canonical owner must always parse strictly');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-owner-invalid-'));
  const ownerFile = path.join(directory, 'owner.txt');
  assert.throws(() => readWeeklyOwner(ownerFile), /cannot read canonical weekly owner file/);
  for (const value of ['gha', 'gha\n\n', ' GHA\n', 'invalid\n', 'exedev \n']) {
    fs.writeFileSync(ownerFile, value);
    assert.throws(() => readWeeklyOwner(ownerFile), /must contain exactly/);
  }
  assert.equal(parseWeeklyOwnerFile('gha\n'), 'gha');
  assert.equal(parseWeeklyOwnerFile('exedev\n'), 'exedev');
});

test('promotion is coupled to the committed weekly owner and preserves GHA defaults', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-promotion-owner-'));
  const ghaOwner = path.join(directory, 'gha-owner.txt');
  const exedevOwner = path.join(directory, 'owner.txt');
  fs.writeFileSync(ghaOwner, 'gha\n');
  fs.writeFileSync(exedevOwner, 'exedev\n');
  assert.equal(promotionEnabled({}, { ownerFile: ghaOwner }), true);
  assert.equal(promotionEnabled({ LV_PROMOTION_ENABLED: 'true' }, { ownerFile: ghaOwner }), true);
  assert.equal(promotionEnabled({ LV_PROMOTION_ENABLED: 'false' }, { ownerFile: ghaOwner }), false);
  assert.equal(promotionEnabled({ LV_PROMOTION_ENABLED: ' False ' }, { ownerFile: ghaOwner }), false);
  assert.equal(promotionEnabled({}, { ownerFile: exedevOwner }), false);
  assert.equal(promotionEnabled({ LV_WEEKLY_OWNER: 'exedev', LV_PROMOTION_ENABLED: 'true' }, { ownerFile: exedevOwner }), false);
  assert.throws(() => promotionEnabled({ LV_WEEKLY_OWNER: 'gha' }, { ownerFile: exedevOwner }), /weekly owner mismatch/);
  const observeStep = coordinatorWorkflow.slice(
    coordinatorWorkflow.indexOf('- name: Observe staging merge and explicitly dispatch cumulative promotion'),
    coordinatorWorkflow.indexOf('\n\n  block-generator:'),
  );
  assert.match(observeStep, /LV_PROMOTION_ENABLED: \$\{\{ vars\.LV_PROMOTION_ENABLED \}\}/);
  assert.match(observeStep, /coordinator\.mjs observe-and-promote/);
  const validateStep = coordinatorWorkflow.slice(coordinatorWorkflow.indexOf('  validate-promotion:'), coordinatorWorkflow.indexOf('  prepare-promotion:'));
  assert.match(validateStep, /LV_PROMOTION_ENABLED: \$\{\{ vars\.LV_PROMOTION_ENABLED \}\}/);
  assert.doesNotMatch(coordinatorWorkflow, /vars\.LV_WEEKLY_OWNER/);
  assert.match(coordinatorWorkflow, /node scripts\/automation\/promotion-control\.mjs/,
    'the final merge path must hard-stop when ownership changes during a run');
  assert.match(promotionSweep, /LV_PROMOTION_ENABLED: \$\{\{ vars\.LV_PROMOTION_ENABLED \}\}/);
  assert.doesNotMatch(promotionSweep, /vars\.LV_WEEKLY_OWNER/);
  assert.match(promotionSweep, /steps\.sweep\.outputs\.action == 'dispatch'/);
});

test('pilot promotion gates exit before API access or dispatch', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-promotion-gate-'));
  const sha = 'a'.repeat(40);
  const common = {
    ...process.env, LV_PROMOTION_ENABLED: 'false',
    GITHUB_API_URL: 'http://127.0.0.1:9/api/v3', GITHUB_OUTPUT: path.join(directory, 'coordinator-output'),
  };
  execFileSync(process.execPath, ['scripts/automation/coordinator.mjs', 'validate-promotion', '--repo', 'owner/repo', '--sha', sha], { env: common });
  assert.match(fs.readFileSync(common.GITHUB_OUTPUT, 'utf8'), /trusted=false/);
  const sweepOutput = path.join(directory, 'sweep-output');
  execFileSync(process.execPath, ['scripts/automation/promotion-sweep.mjs', '--repo', 'owner/repo'], { env: { ...common, GITHUB_OUTPUT: sweepOutput } });
  assert.match(fs.readFileSync(sweepOutput, 'utf8'), /action=skip/);
});

test('pi tool boundary contains no shell, mutation, or GitHub tool and uses verified model default', () => {
  assert.deepEqual([...PI_TOOL_ALLOWLIST], ['context_read', 'context_grep', 'context_find', 'submit_candidate']);
  assert.equal(PI_SDK_VERSION, '0.84.2');
  const options = piSessionOptions({ cwd: '/work', agentDir: '/agent', customTools: [{ name: 'submit_candidate' }] });
  assert.deepEqual(options.tools, [...PI_TOOL_ALLOWLIST]);
  assert.equal(options.customTools[0].name, 'submit_candidate');
  assert.match(host, /PI_PROVIDER \|\| 'openai'/);
  assert.match(host, /PI_MODEL \|\| 'gpt-5\.6-sol'/);
  assert.match(host, /https:\/\/llm\.int\.exe\.xyz\/v1/);
  assert.match(piSession, /timeout: 5_000/);
  for (const token of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) {
    assert.match(piSession, new RegExp(`'${token}'`));
  }
});

test('persistent pi sessions preserve the worktree cwd and exact supervisor state root', () => {
  const cwd = '/var/lib/lv-supervisor/work/run-one';
  const sessionsDir = '/var/lib/lv-supervisor/pi-sessions';
  const sessionFile = path.join(sessionsDir, 'session.jsonl');
  const calls = [];
  const sdk = { SessionManager: { create: (...args) => {
    calls.push(args);
    return { getSessionDir: () => args[1] };
  } } };
  const sessionManager = createPersistentSessionManager({ sdk, cwd, sessionsDir });
  assert.deepEqual(calls, [[cwd, sessionsDir]]);
  assert.equal(sessionManager.getSessionDir(), sessionsDir);
  assert.equal(sessionFileForReport({ sessionFile }, sessionsDir), sessionFile);

  const homeDerivedSdk = { SessionManager: { create: () => ({
    getSessionDir: () => '/home/exedev/.pi/agent/sessions/--var-lib-lv-supervisor-pi-sessions--',
  }) } };
  assert.throws(() => createPersistentSessionManager({ sdk: homeDerivedSdk, cwd, sessionsDir }), /refused the supervisor sessions directory/);
  assert.throws(() => sessionFileForReport({ sessionFile: path.join(sessionsDir, '--var-lib-lv-supervisor-pi-sessions--', 'session.jsonl') }, sessionsDir), /escaped the supervisor sessions directory/);
  assert.doesNotMatch(piSession, /SessionManager\.create\(sessionsDir\)/);
});

test('pi prompt grounds the selected topic in its trusted queue evidence and canonical local context', () => {
  const contextFiles = [
    'data/topic-queue.json', 'data/businesses.json', 'data/posts.json',
    'scripts/prompts/sections/03-blog-generation.md',
  ];
  const prompt = buildGeneratorPrompt({
    topic: { key: 'topic-key', title: 'Topic title', source: 'gsc', rationale: 'GSC top query (8 clicks)' },
    contextFiles,
  });
  for (const file of contextFiles) assert.match(prompt, new RegExp(file.replaceAll('.', '\\.')));
  assert.match(prompt, /locate the selected entry by the exact topic key/i);
  assert.match(prompt, /entry's source and rationale/i);
  assert.match(prompt, /Topic source: gsc/);
  assert.match(prompt, /Topic rationale: GSC top query \(8 clicks\)/);
  assert.doesNotMatch(prompt, /SEO evidence|seo-data-latest|missing SEO/i);
});

test('staging grounding resolves the exact selected queue entry and rejects missing evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-topic-grounding-'));
  const queueFile = path.join(directory, 'topic-queue.json');
  const topic = {
    key: 'topic-key', kind: 'blog', title: 'Topic title', source: 'gsc', rationale: 'GSC top query',
    addedAt: '2026-08-24T00:00:00Z', attempts: 0, branchPrefix: 'blog/auto-',
  };
  fs.writeFileSync(queueFile, JSON.stringify({ version: 1, topics: [topic] }));
  assert.deepEqual(readSelectedTopic(queueFile, topic.key), {
    key: topic.key, title: topic.title, source: topic.source, rationale: topic.rationale,
  });
  assert.throws(() => readSelectedTopic(queueFile, 'missing'), /missing from the staging topic queue/);
  fs.writeFileSync(queueFile, JSON.stringify({ version: 1, topics: [{ ...topic, rationale: '' }] }));
  assert.throws(() => readSelectedTopic(queueFile, topic.key), /lacks rationale/);
});

test('pi context tools reject absolute and parent traversal outside the session cwd', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-pi-tools-'));
  fs.writeFileSync(path.join(cwd, 'allowed.txt'), 'allowed');
  const sdk = { defineTool: (tool) => tool };
  const Type = { Object: (shape) => shape, String: () => ({}) };
  const tools = createConstrainedTools({ sdk, Type, cwd, onSubmit: async () => ({}) });
  const read = tools.find((tool) => tool.name === 'context_read');
  assert.match((await read.execute('one', { path: 'allowed.txt' })).content[0].text, /allowed/);
  assert.match((await read.execute('two', { path: '/etc/passwd' })).content[0].text, /Rejected: path escapes/);
  assert.match((await read.execute('three', { path: '../../etc/passwd' })).content[0].text, /Rejected: path escapes/);
  fs.symlinkSync('/etc/passwd', path.join(cwd, 'escape-link'));
  assert.match((await read.execute('four', { path: 'escape-link' })).content[0].text, /Rejected: path escapes/);
});

test('submit_candidate keeps coordinator metadata outside the canonical post artifact', () => {
  const post = {
    slug: 'one-post', title: 'A grounded Liberty Village guide for local readers', description: 'A grounded guide to Liberty Village based on trusted local records and current search context for neighbourhood readers.',
    content: 'Grounded content', publishedAt: '2026-08-24', updatedAt: '2026-08-24', category: 'community',
    tags: ['one', 'two', 'three', 'four'], answerBlock: 'A grounded answer block for the selected topic.',
    faqs: Array.from({ length: 4 }, (_, index) => ({ question: `Question ${index}?`, answer: 'A substantive grounded answer.' })),
    image: '/og.png', relatedServices: [], relatedTopics: [], relatedPosts: [],
    keyTakeaways: ['one', 'two', 'three', 'four'], author: 'LibertyVillage.co',
  };
  assert.equal(validateSubmittedPost(post, { key: 'topic' }, 'topic', { now: new Date('2026-08-24T12:00:00Z') }).ok, true);
  assert.equal(validateSubmittedPost({ ...post, topicKey: 'topic' }, { key: 'topic' }, 'topic', { now: new Date('2026-08-24T12:00:00Z') }).ok, false);
  assert.equal(validateSubmittedPost({ ...post, faqs: [...post.faqs, { question: 'Secret?', answer: `github_pat_${'a'.repeat(30)}` }] }, { key: 'topic' }, 'topic', { now: new Date('2026-08-24T12:00:00Z') }).ok, false);
  assert.equal(validateSubmittedPost({ ...post, content: `-----BEGIN PRIVATE KEY-----\n${'a'.repeat(40)}` }, { key: 'topic' }, 'topic', { now: new Date('2026-08-24T12:00:00Z') }).ok, false);
  assert.equal('topicKey' in post, false);
});

test('monitor accepts durable audit decisions only from the canonical trusted author set', () => {
  assert.match(githubMonitor, /TRUSTED_PR_AUTHORS\.includes\(comment\?\.user\?\.login\)/);
  const old = 'a'.repeat(40);
  const current = 'b'.repeat(40);
  const comment = (sha, decision) => ({ user: { login: 'github-actions[bot]' }, body: `<!-- automation-audit-data:{"sha":"${sha}","decision":"${decision}","attempt":0} -->` });
  assert.equal(latestAuditForSha([comment(old, 'repairing'), comment(current, 'passed')], old).decision, 'repairing');
});

test('dry run resolves only and never invokes the mutating candidate planner', () => {
  let planned = false;
  const result = resolveCandidateReadOnly({ dryRun: true, resolve: () => ({ topic_key: 'one' }), plan: () => { planned = true; } });
  assert.equal(result.terminal, 'DRY_RUN');
  assert.equal(planned, false);
});

test('candidate ladder advances idempotently before blocked PR closure and reaches its cap', async () => {
  const events = new Set();
  const sequence = [];
  let regenerations = 0;
  for (const runId of ['run-1', 'run-2', 'run-3']) {
    const run = { run_id: runId, topic_key: 'topic-one', pr_number: 10 };
    await finalizeSupervisorTerminal({
      repo: 'owner/repo', run, terminal: 'BLOCKED_VALIDATION', expectedSha: 'a'.repeat(40), reason: 'blocked',
      recordOutcome: async () => {
        sequence.push(`ladder:${runId}`);
        if (!events.has(runId)) { events.add(runId); regenerations += 1; }
      },
      finalizePr: async () => { sequence.push(`close:${runId}`); return { prState: 'closed' }; },
    });
  }
  assert.equal(regenerations, 3, 'three exact run keys reach the candidate cap/cooldown ladder');
  assert.deepEqual(sequence, ['ladder:run-1', 'close:run-1', 'ladder:run-2', 'close:run-2', 'ladder:run-3', 'close:run-3']);
});

test('durable outcome command carries exact idempotency and topic keys', () => {
  let invocation;
  recordSupervisorOutcome({ repoRoot: '/repo', repo: 'owner/repo', runId: 'run-exact', topicKey: 'topic-exact', terminal: 'DISCARDED_PRE_PR', reason: 'lint' }, (...args) => { invocation = args; return {}; });
  assert.deepEqual(invocation, ['/repo', [
    'record-candidate-outcome', '--kind', 'blog', '--outcome', 'DISCARDED_PRE_PR',
    '--key', 'run-exact', '--topic-key', 'topic-exact', '--reason', 'lint',
  ], { repo: 'owner/repo' }]);
});

test('durable outcome command adapts rich diagnostics to bounded single-line GitHub output', () => {
  let invocation;
  const diagnostic = `supervisor command failed (exit 1): node blog-lint\nstdout:\n${'finding '.repeat(100)}\u0000\nstderr:\nfinal detail`;
  recordSupervisorOutcome({
    repoRoot: '/repo', repo: 'owner/repo', runId: 'run-multiline', topicKey: 'topic-multiline',
    terminal: 'DISCARDED_PRE_PR', reason: diagnostic,
  }, (...args) => { invocation = args; return {}; });
  const args = invocation[1];
  const reason = args[args.indexOf('--reason') + 1];
  assert.equal(reason.includes('supervisor command failed (exit 1)'), true);
  assert.equal(/[\p{C}\r\n\u2028\u2029]/u.test(reason), false);
  assert.ok([...reason].length <= OUTCOME_REASON_LIMIT);
  assert.match(reason, /…\[truncated\]$/);
  assert.match(diagnostic, /\nstdout:\n/, 'the original ledger/journal diagnostic remains rich and unchanged');
});

test('bounded candidate flow lints before its single publish path', async () => {
  const sequence = [];
  let published = false;
  const result = await boundedCandidateFlow({ generate: async () => { sequence.push('generate'); return { post: {} }; }, lint: async () => { sequence.push('lint'); }, publish: async () => { sequence.push('publish'); published = true; return 'done'; } });
  assert.equal(result.published, true);
  assert.equal(published, true);
  assert.deepEqual(sequence, ['generate', 'lint', 'publish']);
});

test('blocked terminal closes only the exact ledger-owned PR and verifies closure', async () => {
  const sha = 'a'.repeat(40);
  let state = 'open';
  const writes = [];
  const client = async (requestPath, options = {}) => {
    if (options.method) writes.push({ requestPath, ...options });
    if (requestPath.endsWith('/pulls/10') && options.method === 'PATCH') { state = 'closed'; return {}; }
    if (requestPath.endsWith('/pulls/10')) return { number: 10, state, merged: false, head: { sha, ref: 'blog/auto-owned', repo: { fork: false } }, base: { ref: 'staging' }, user: { login: 'github-actions[bot]' } };
    return {};
  };
  const result = await finalizeOwnedPr({ repo: 'owner/repo', prNumber: 10, expectedSha: sha, terminal: 'BLOCKED_VALIDATION', runId: 'run', githubClient: client, commentsClient: async () => [] });
  assert.equal(result.prState, 'closed');
  assert.equal(writes.some((write) => write.requestPath.endsWith('/pulls/10') && write.method === 'PATCH'), true);
  assert.equal(writes.some((write) => write.requestPath.includes('/pulls/999')), false);
  assert.equal(writes.some((write) => write.body?.state === 'closed'), true);
});

test('blocked terminal refuses head drift before performing any write', async () => {
  const writes = [];
  const client = async (_requestPath, options = {}) => {
    if (options.method) writes.push(options);
    return { state: 'open', head: { sha: 'b'.repeat(40), ref: 'blog/auto-owned', repo: { fork: false } }, base: { ref: 'staging' }, user: { login: 'github-actions[bot]' } };
  };
  await assert.rejects(() => finalizeOwnedPr({ repo: 'owner/repo', prNumber: 10, expectedSha: 'a'.repeat(40), terminal: 'BLOCKED_EXHAUSTED', runId: 'run', githubClient: client, commentsClient: async () => [] }), /unrelated pull request head drift/);
  assert.deepEqual(writes, []);
});

test('merged repaired head is adopted only through old-head ancestry and live staging containment', async () => {
  const oldSha = 'a'.repeat(40);
  const liveSha = 'b'.repeat(40);
  const mergeSha = 'c'.repeat(40);
  const pr = { state: 'closed', merged: true, merge_commit_sha: mergeSha, head: { sha: liveSha, ref: 'blog/auto-owned', repo: { fork: false } }, base: { ref: 'staging' }, user: { login: 'github-actions[bot]' } };
  const requests = [];
  const client = async (requestPath) => {
    requests.push(requestPath);
    if (requestPath.endsWith('/pulls/10')) return pr;
    if (requestPath.endsWith(`/commits/${liveSha}`)) return { parents: [{ sha: oldSha }, { sha: 'd'.repeat(40) }] };
    if (requestPath.includes(`/compare/${mergeSha}...staging`)) return { status: 'ahead', behind_by: 0 };
    throw new Error(`unexpected request ${requestPath}`);
  };
  const result = await finalizeOwnedPr({ repo: 'owner/repo', prNumber: 10, expectedSha: oldSha, terminal: 'MERGED_STAGING', runId: 'run', githubClient: client });
  assert.deepEqual(result, { prState: 'closed', merged: true, headSha: liveSha });
  assert.equal(requests.some((request) => request.includes(`/compare/${mergeSha}...staging`)), true);
});

test('unfinished-row recovery isolates one failure and continues to a fresh row', async () => {
  const reconciled = [];
  const failed = [];
  const result = await recoverUnfinishedRows([{ run_id: 'bad' }, { run_id: 'good' }], {
    reconcile: async (row) => { reconciled.push(row.run_id); if (row.run_id === 'bad') throw new Error('wedged'); },
    markFailure: async (row, error) => failed.push(`${row.run_id}:${error.message}`),
  });
  assert.deepEqual(reconciled, ['bad', 'good']);
  assert.deepEqual(failed, ['bad:wedged']);
  assert.equal(result[1].recovered, true);
});

test('unrecoverable rows park at the bounded retry cap and are not reconciled again', async () => {
  let reconciliations = 0;
  let failure;
  const [result] = await recoverUnfinishedRows([{ run_id: 'wedged', recovery_attempts: MAX_RECOVERY_ATTEMPTS - 1 }], {
    reconcile: async () => { reconciliations += 1; throw new Error('permanent drift'); },
    markFailure: async (_row, error, metadata) => { failure = { message: error.message, ...metadata }; },
  });
  assert.deepEqual(failure, { message: 'permanent drift', attempts: MAX_RECOVERY_ATTEMPTS, parked: true });
  assert.equal(result.parked, true);
  const [parked] = await recoverUnfinishedRows([{ run_id: 'wedged', state: 'RECOVERY_PARKED', recovery_attempts: MAX_RECOVERY_ATTEMPTS }], {
    reconcile: async () => { reconciliations += 1; }, markFailure: async () => {},
  });
  assert.equal(parked.parked, true);
  assert.equal(reconciliations, 1);
});

test('smoke accepts the real service agent directory explicitly', () => {
  assert.equal(resolveSmokeAgentDir(['--agent-dir', '/var/lib/lv-supervisor/pi-runtime'], '/tmp/fallback'), '/var/lib/lv-supervisor/pi-runtime');
  assert.throws(() => resolveSmokeAgentDir(['--agent-dir'], '/tmp/fallback'), /requires a path/);
});
