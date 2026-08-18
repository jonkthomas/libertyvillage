#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  FIXER_MODEL, GATE_MODEL, MAX_HEALS, MAX_REPAIRS, STATUS_CONTEXTS,
} from './constants.mjs';
import { github, mergeBaseSha, paged, writeOutput } from './github.mjs';
import {
  canHeal, evaluateGeneratorBase, evaluateObservedMerge, filterRepairablePaths, healLabel, isExactSha,
  isTextRepairPath, validatePaths, validatePromotionRange, validatePullRequest, validateRepairPlan,
} from './policy.mjs';
import { planBaseHeal, resolveAppendUnion } from './heal-base.mjs';
import {
  applyRecordRepairPlan, isRecordRepairPlan, partitionRepairFiles, readRecordFile,
} from './record-repair.mjs';

function parseArgs() {
  const values = {};
  for (let i = 3; i < process.argv.length; i += 1) {
    if (!process.argv[i].startsWith('--')) continue;
    const [key, inline] = process.argv[i].slice(2).split('=', 2);
    values[key] = inline ?? process.argv[++i];
  }
  return values;
}

function requireOptions(options, names) {
  for (const name of names) if (!options[name]) throw new Error(`missing --${name}`);
}

async function prData(repo, number) {
  const pr = await github(`/repos/${repo}/pulls/${number}`);
  const files = (await paged(`/repos/${repo}/pulls/${number}/files`)).map((file) => file.filename);
  return { pr, files };
}

async function validatePr(options) {
  requireOptions(options, ['repo', 'pr', 'kind', 'sha']);
  const { pr, files } = await prData(options.repo, options.pr);
  const result = validatePullRequest({ repository: options.repo, kind: options.kind, expectedSha: options.sha, pr, files });
  if (!result.ok) throw new Error(`pull request rejected: ${result.errors.join('; ')}`);
  writeOutput({
    trusted: 'true', pr_number: pr.number, head_sha: pr.head.sha, head_ref: pr.head.ref,
    base_ref: pr.base.ref, attempt: result.attempt, can_repair: result.attempt < MAX_REPAIRS ? 'true' : 'false',
    heal_attempt: result.healAttempt, can_heal: canHeal(result.healAttempt) ? 'true' : 'false',
    files: files.length,
  });
  console.log(`Validated trusted ${options.kind} PR #${pr.number} at ${pr.head.sha} (${files.length} files, attempt ${result.attempt}).`);
}

async function validatePromotion(options) {
  requireOptions(options, ['repo', 'sha']);
  if (!isExactSha(options.sha)) throw new Error('promotion payload SHA is invalid');
  const [staging, main, comparison] = await Promise.all([
    github(`/repos/${options.repo}/branches/staging`),
    github(`/repos/${options.repo}/branches/main`),
    github(`/repos/${options.repo}/compare/main...${options.sha}`),
  ]);
  const result = validatePromotionRange({
    expectedSha: options.sha, stagingSha: staging.commit.sha, mainSha: main.commit.sha, aheadBy: comparison.ahead_by,
  });
  if (options['main-sha'] && main.commit.sha !== options['main-sha']) result.errors.push('main head changed during promotion');
  if (!result.ok || result.errors.length) throw new Error(`promotion rejected: ${result.errors.join('; ')}`);
  writeOutput({ trusted: 'true', no_changes: result.noChanges ? 'true' : 'false', head_sha: staging.commit.sha, main_sha: main.commit.sha, range: result.range });
  console.log(result.noChanges ? 'Promotion is already complete; nothing to do.' : `Validated cumulative promotion range ${result.range}.`);
}

async function preparePromotion(options) {
  requireOptions(options, ['repo', 'sha']);
  const owner = options.repo.split('/')[0];
  const existing = await paged(`/repos/${options.repo}/pulls?state=open&base=main&head=${encodeURIComponent(`${owner}:staging`)}`);
  if (existing.length > 1) throw new Error('multiple open staging-to-main promotion PRs found');
  const pr = existing[0] || await github(`/repos/${options.repo}/pulls`, {
    method: 'POST', body: {
      title: 'promote: staging to main', head: 'staging', base: 'main', draft: false,
      body: 'Autonomous cumulative promotion. Merge requires `automation/ci` and `automation/opus-gate`.',
    },
  });
  if (pr.head.sha !== options.sha) throw new Error('promotion PR head is stale after creation/reuse');
  writeOutput({ pr_number: pr.number, head_sha: pr.head.sha, created: existing[0] ? 'false' : 'true' });
  console.log(`${existing[0] ? 'Reused' : 'Created'} promotion PR #${pr.number} at ${pr.head.sha}.`);
}

async function publishStatus(options) {
  requireOptions(options, ['repo', 'sha', 'context', 'state', 'description']);
  if (!isExactSha(options.sha)) throw new Error('status SHA is invalid');
  if (!Object.values(STATUS_CONTEXTS).includes(options.context)) throw new Error('status context is not controlled');
  if (!['pending', 'success', 'failure', 'error'].includes(options.state)) throw new Error('invalid status state');
  await github(`/repos/${options.repo}/statuses/${options.sha}`, {
    method: 'POST', body: { state: options.state, context: options.context, description: options.description.slice(0, 140) },
  });
  console.log(`Published ${options.context}=${options.state} on ${options.sha}.`);
}

async function createLabel(repo, name, color, description) {
  try { await github(`/repos/${repo}/labels`, { method: 'POST', body: { name, color, description } }); }
  catch (error) { if (!error.message.includes('(422)')) throw error; }
}

async function setLabels(repo, prNumber, decision, attempt) {
  await createLabel(repo, 'automation-blocked', 'b60205', 'Autonomous promotion gate blocked this PR');
  for (let n = 1; n <= MAX_REPAIRS; n += 1) await createLabel(repo, `automation-repair-${n}`, 'fbca04', `Autonomous repair attempt ${n}`);
  if (decision === 'blocked' || decision === 'error' || decision === 'exhausted') {
    await github(`/repos/${repo}/issues/${prNumber}/labels`, { method: 'POST', body: { labels: ['automation-blocked'] } });
  } else {
    try { await github(`/repos/${repo}/issues/${prNumber}/labels/automation-blocked`, { method: 'DELETE' }); }
    catch (error) { if (!error.message.includes('(404)')) throw error; }
  }
  if (attempt !== undefined) {
    for (let n = 1; n <= MAX_REPAIRS; n += 1) {
      if (n === attempt) continue;
      try { await github(`/repos/${repo}/issues/${prNumber}/labels/automation-repair-${n}`, { method: 'DELETE' }); }
      catch (error) { if (!error.message.includes('(404)')) throw error; }
    }
    if (attempt > 0) await github(`/repos/${repo}/issues/${prNumber}/labels`, { method: 'POST', body: { labels: [`automation-repair-${attempt}`] } });
  }
}

async function audit(options) {
  requireOptions(options, ['repo', 'pr', 'sha', 'kind', 'decision', 'attempt', 'out']);
  const attempt = Number(options.attempt);
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > MAX_REPAIRS) throw new Error('invalid audit attempt');
  let verdict = null;
  if (options.verdict && fs.existsSync(options.verdict)) verdict = JSON.parse(fs.readFileSync(options.verdict, 'utf8'));
  const record = {
    commit_sha: options.sha, kind: options.kind, decision: options.decision, attempts: attempt,
    reviewer_model: GATE_MODEL, fixer_model: FIXER_MODEL,
    score: verdict?.overall ?? null, findings: verdict?.findings ?? [], range: verdict?.range ?? options.range ?? null,
    recorded_at: new Date().toISOString(),
  };
  fs.writeFileSync(options.out, `${JSON.stringify(record, null, 2)}\n`);
  await setLabels(options.repo, options.pr, options.decision, attempt);
  const marker = `<!-- automation-audit:${options.sha}:${options.decision}:${attempt} -->`;
  const comments = await paged(`/repos/${options.repo}/issues/${options.pr}/comments`);
  if (comments.some((comment) => comment.body?.includes(marker))) {
    writeOutput({ comment_created: 'false' });
    console.log('Audit comment already exists; notification remains deduplicated.');
    return;
  }
  const findings = record.findings.length ? record.findings.map((finding) => `- **${finding.severity}** \`${finding.path}\`: ${finding.note}`).join('\n') : '- none';
  const body = [
    marker, '## Autonomous gate audit', '',
    `- Decision: **${record.decision}**`, `- Commit: \`${record.commit_sha}\``,
    `- Reviewer: \`${record.reviewer_model}\``, `- Fixer: \`${record.fixer_model}\``,
    `- Score: ${record.score ?? 'unavailable'}`, `- Repair attempts: ${record.attempts}/${MAX_REPAIRS}`,
    `- Range: \`${record.range ?? `PR #${options.pr} @ ${record.commit_sha}`}\``, '', '### Findings', findings,
  ].join('\n');
  await github(`/repos/${options.repo}/issues/${options.pr}/comments`, { method: 'POST', body: { body } });
  writeOutput({ comment_created: 'true' });
}

function repairTarget(file) {
  const root = fs.realpathSync(process.cwd());
  const target = path.resolve(root, file);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`repair escaped checkout: ${file}`);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`repair target must be a regular file: ${file}`);
  return target;
}

function changedFiles() {
  return execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

// Per-record repair of the monolithic slug-keyed data files: the plan carries only
// the records the PR appended or modified, so the whole-file byte budget never
// applies. Every other guard the whole-file path uses is enforced here against the
// trusted base/head.
async function applyRecordFix(options, { plan, files, baseRef }) {
  const { recordFiles } = partitionRepairFiles(filterRepairablePaths(options.kind, files));
  const planned = plan.files.map((entry) => entry?.file);
  if (recordFiles.length === 0 || planned.some((file) => !recordFiles.includes(file))) {
    throw new Error(`per-record repair may only target repairable record files: ${recordFiles.join(', ') || 'none'}`);
  }
  const baseSha = await mergeBaseSha(options.repo, baseRef, options.sha);
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseSha, options.sha], { stdio: 'ignore' }); }
  catch { throw new Error('resolved merge base is not an ancestor of the validated head'); }
  const sources = {};
  const targets = new Map();
  for (const file of planned) {
    const target = repairTarget(file);
    targets.set(file, target);
    sources[file] = {
      baseText: execFileSync('git', ['show', `${baseSha}:${file}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
      headText: fs.readFileSync(target, 'utf8'),
    };
  }
  const applied = applyRecordRepairPlan(options.kind, plan, { changedFiles: files, sources });
  if (!applied.ok) throw new Error(`repair rejected before write: ${applied.errors.join('; ')}`);
  for (const result of applied.results) fs.writeFileSync(targets.get(result.file), result.text);
  const changed = changedFiles();
  const expected = new Set(applied.files);
  if (changed.length !== expected.size || changed.some((file) => !expected.has(file))) {
    throw new Error('repair changed a file outside its validated plan');
  }
  const paths = validatePaths(options.kind, changed, { repair: true });
  if (!paths.ok || !changed.every(isTextRepairPath)) throw new Error(`repair rejected after write: ${[...paths.errors, 'non-text repair target'].join('; ')}`);
  for (const result of applied.results) {
    const written = fs.readFileSync(targets.get(result.file), 'utf8');
    if (written !== result.text) throw new Error(`repair rejected after write: ${result.file} does not match the validated splice`);
    const verified = readRecordFile(written, result.file, 'repaired');
    if (!verified.ok) throw new Error(`repair rejected after write: ${verified.errors.join('; ')}`);
  }
  const bytes = applied.results.reduce((sum, result) => sum + result.bytes, 0);
  const summary = applied.results.map((result) => `${result.file} [${result.slugs.join(', ')}]`).join('; ');
  writeOutput({ changed_files: changed.length });
  console.log(`Validated per-record repair diff (${changed.length} file(s), ${bytes} bytes, ${summary}).`);
}

async function applyFix(options) {
  requireOptions(options, ['repo', 'pr', 'kind', 'sha', 'plan']);
  const current = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (current !== options.sha) throw new Error('repair checkout does not match validated exact SHA');
  const plan = JSON.parse(fs.readFileSync(options.plan, 'utf8'));
  const livePr = await github(`/repos/${options.repo}/pulls/${options.pr}`);
  if (livePr.state !== 'open' || livePr.head.sha !== options.sha) throw new Error('PR became stale before repair application');
  const files = (await paged(`/repos/${options.repo}/pulls/${options.pr}/files`)).map((file) => file.filename);
  if (isRecordRepairPlan(plan)) {
    if (!Array.isArray(plan.files) || plan.files.length === 0) throw new Error('record repair plan must contain files');
    await applyRecordFix(options, { plan, files, baseRef: livePr.base.ref });
    return;
  }
  const valid = validateRepairPlan(options.kind, plan, files);
  if (!valid.ok) throw new Error(`repair rejected before write: ${valid.errors.join('; ')}`);
  for (const edit of plan.edits) fs.writeFileSync(repairTarget(edit.path), edit.content);
  const changed = changedFiles();
  const post = validateRepairPlan(options.kind, { edits: changed.map((file) => ({ path: file, content: fs.readFileSync(file, 'utf8'), reason: 'post-write validation' })) }, files);
  if (!post.ok) throw new Error(`repair rejected after write: ${post.errors.join('; ')}`);
  if (changed.some((file) => !valid.paths.includes(file))) throw new Error('repair changed a file outside its validated plan');
  writeOutput({ changed_files: changed.length });
  console.log(`Validated repair diff (${changed.length} files, ${post.bytes} bytes).`);
}

async function setAttempt(options) {
  requireOptions(options, ['repo', 'pr', 'attempt']);
  const attempt = Number(options.attempt);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_REPAIRS) throw new Error('invalid next repair attempt');
  await setLabels(options.repo, options.pr, 'repairing', attempt);
}

// Heal budget lifecycle, mirroring the repair label series: exactly one
// automation-heal-N label survives, so a rerun cannot buy extra heals.
async function setHealLabels(repo, prNumber, attempt) {
  for (let n = 1; n <= MAX_HEALS; n += 1) await createLabel(repo, healLabel(n), '0e8a16', `Autonomous base heal ${n}`);
  for (let n = 1; n <= MAX_HEALS; n += 1) {
    if (n === attempt) continue;
    try { await github(`/repos/${repo}/issues/${prNumber}/labels/${healLabel(n)}`, { method: 'DELETE' }); }
    catch (error) { if (!error.message.includes('(404)')) throw error; }
  }
  await github(`/repos/${repo}/issues/${prNumber}/labels`, { method: 'POST', body: { labels: [healLabel(attempt)] } });
}

async function setHeal(options) {
  requireOptions(options, ['repo', 'pr', 'heal']);
  const attempt = Number(options.heal);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_HEALS) throw new Error('invalid next heal attempt');
  await setHealLabels(options.repo, options.pr, attempt);
  console.log(`Consumed base heal ${attempt}/${MAX_HEALS} on PR #${options.pr}.`);
}

async function dispatch(options) {
  requireOptions(options, ['repo', 'kind', 'sha']);
  if (!isExactSha(options.sha)) throw new Error('dispatch SHA is invalid');
  const payload = { kind: options.kind, head_sha: options.sha };
  if (options.pr) payload.pr_number = Number(options.pr);
  await github(`/repos/${options.repo}/dispatches`, { method: 'POST', body: { event_type: 'autonomous-coordinate', client_payload: payload } });
  console.log(`Dispatched ${options.kind} coordinator for ${options.sha}.`);
}

function assertSamePrIdentity(before, after, expectedSha, repository) {
  if (
    after?.number !== before.number || after?.state !== 'open' || after?.draft !== false
    || after?.head?.sha !== expectedSha || after?.head?.ref !== before.head.ref
    || after?.head?.repo?.full_name !== repository || after?.base?.ref !== before.base.ref
    || after?.base?.repo?.full_name !== repository || after?.user?.login !== before.user.login
  ) throw new Error('pull request identity changed during base refresh');
}

async function refreshGeneratorBase(options) {
  requireOptions(options, ['repo', 'pr', 'kind', 'sha']);
  const { pr, files } = await prData(options.repo, options.pr);
  const trusted = validatePullRequest({
    repository: options.repo, kind: options.kind, expectedSha: options.sha, pr, files,
  });
  if (!trusted.ok) throw new Error(`pull request rejected before base refresh: ${trusted.errors.join('; ')}`);

  const staging = await github(`/repos/${options.repo}/branches/staging`);
  const comparison = await github(`/repos/${options.repo}/compare/${options.sha}...${staging.commit.sha}`);
  const decision = evaluateGeneratorBase({
    expectedSha: options.sha, prHeadSha: pr.head.sha, stagingSha: staging.commit.sha,
    stagingAheadBy: comparison.ahead_by,
  });
  if (decision === 'continue') {
    const current = await github(`/repos/${options.repo}/pulls/${options.pr}`);
    assertSamePrIdentity(pr, current, options.sha, options.repo);
    writeOutput({ refreshed: 'false', head_sha: options.sha });
    console.log(`PR #${pr.number} already contains current staging base ${staging.commit.sha}.`);
    return;
  }

  await github(`/repos/${options.repo}/pulls/${options.pr}/update-branch`, {
    method: 'PUT', body: { expected_head_sha: options.sha },
  });
  for (let poll = 0; poll < 12; poll += 1) {
    const current = await github(`/repos/${options.repo}/pulls/${options.pr}`);
    if (current.head.sha === options.sha) {
      assertSamePrIdentity(pr, current, options.sha, options.repo);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }

    assertSamePrIdentity(pr, current, current.head.sha, options.repo);
    const currentFiles = (await paged(`/repos/${options.repo}/pulls/${options.pr}/files`)).map((file) => file.filename);
    const updated = validatePullRequest({
      repository: options.repo, kind: options.kind, expectedSha: current.head.sha, pr: current, files: currentFiles,
    });
    if (!updated.ok) throw new Error(`updated pull request rejected: ${updated.errors.join('; ')}`);
    const commit = await github(`/repos/${options.repo}/git/commits/${current.head.sha}`);
    if (
      commit.sha !== current.head.sha || commit.parents?.length !== 2
      || commit.parents[0]?.sha !== options.sha || commit.parents[1]?.sha !== staging.commit.sha
    ) throw new Error('PR head changed unexpectedly during base refresh');

    await dispatch({ repo: options.repo, pr: options.pr, kind: options.kind, sha: current.head.sha });
    writeOutput({ refreshed: 'true', head_sha: current.head.sha });
    console.log(`Refreshed PR #${pr.number} from ${options.sha} to ${current.head.sha} and redispatched exact SHA.`);
    return;
  }
  throw new Error('timed out waiting for updated PR head');
}

// Hooks are disabled for every git invocation here: the checkout is untrusted PR
// content and nothing in it may execute.
function git(args, options = {}) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options,
  });
}

function conflictedFiles() {
  return git(['diff', '--name-only', '--diff-filter=U']).trim().split('\n').filter(Boolean);
}

function conflictStage(file, stage) {
  try { return git(['show', `:${stage}:${file}`]); }
  catch { throw new Error(`base heal refused: ${file} has no stage-${stage} content`); }
}

// Merges the current staging head into the validated PR head inside a checkout
// that is never executed, resolving only both-appended record-file conflicts.
// Anything else — a clean merge, an unknown conflict, a raced head — throws, and
// block-generator keeps its existing fail-closed behaviour.
async function healGeneratorBase(options) {
  requireOptions(options, ['repo', 'pr', 'kind', 'sha']);
  const current = git(['rev-parse', 'HEAD']).trim();
  if (current !== options.sha) throw new Error('heal checkout does not match validated exact SHA');
  const { pr, files } = await prData(options.repo, options.pr);
  const trusted = validatePullRequest({
    repository: options.repo, kind: options.kind, expectedSha: options.sha, pr, files,
  });
  if (!trusted.ok) throw new Error(`pull request rejected before base heal: ${trusted.errors.join('; ')}`);
  if (!canHeal(trusted.healAttempt)) throw new Error(`base heal budget exhausted: ${trusted.healAttempt}/${MAX_HEALS}`);

  const staging = await github(`/repos/${options.repo}/branches/staging`);
  const stagingSha = staging?.commit?.sha;
  if (!isExactSha(stagingSha)) throw new Error('staging head is not an exact SHA');
  git(['fetch', '--no-tags', 'origin', '+refs/heads/staging:refs/remotes/origin/staging'], { stdio: 'ignore' });
  if (git(['rev-parse', 'refs/remotes/origin/staging']).trim() !== stagingSha) {
    throw new Error('fetched staging head does not match the live staging head');
  }
  let containsStaging = true;
  try { git(['merge-base', '--is-ancestor', stagingSha, options.sha], { stdio: 'ignore' }); }
  catch { containsStaging = false; }
  if (containsStaging) throw new Error('PR already contains the current staging head; nothing to heal');

  let conflicted = [];
  let mergeError = null;
  try {
    git(['merge', '--no-commit', '--no-ff', '--no-verify', stagingSha], { stdio: 'pipe' });
  } catch (error) {
    mergeError = error;
    conflicted = conflictedFiles();
  }
  if (conflicted.length === 0) {
    try { git(['merge', '--abort'], { stdio: 'ignore' }); } catch { /* nothing staged to abort */ }
    if (mergeError) throw new Error(`merge failed without a resolvable conflict: ${String(mergeError.stderr || mergeError.message).trim().slice(0, 200)}`);
    throw new Error('staging merges cleanly into this PR; the failure is not a base conflict');
  }

  const plan = planBaseHeal(options.kind, conflicted);
  if (!plan.ok) throw new Error(`base heal refused: ${plan.errors.join('; ')}`);
  const resolutions = [];
  for (const file of conflicted) {
    const target = repairTarget(file);
    const resolved = resolveAppendUnion(file, {
      baseText: conflictStage(file, 1), oursText: conflictStage(file, 2), theirsText: conflictStage(file, 3),
    });
    if (!resolved.ok) throw new Error(`base heal refused: ${resolved.errors.join('; ')}`);
    fs.writeFileSync(target, resolved.text);
    if (fs.readFileSync(target, 'utf8') !== resolved.text) throw new Error(`base heal refused: ${file} does not match the validated union`);
    git(['add', '--', file]);
    resolutions.push(resolved);
  }
  const remaining = conflictedFiles();
  if (remaining.length) throw new Error(`base heal refused: unresolved conflicts remain: ${remaining.join(', ')}`);

  git([
    '-c', 'user.name=LV Automation Healer', '-c', 'user.email=noreply@libertyvillage.co',
    'commit', '--no-verify', '-m', `automation: heal generator base conflict with staging (heal ${trusted.healAttempt + 1})`,
  ], { stdio: 'pipe' });
  const newSha = git(['rev-parse', 'HEAD']).trim();
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ');
  if (parents.length !== 3 || parents[1] !== options.sha || parents[2] !== stagingSha) {
    throw new Error('healed commit is not an exact merge of the validated head and staging');
  }
  const changed = git(['diff', '--name-only', `${stagingSha}..HEAD`]).trim().split('\n').filter(Boolean);
  const paths = validatePaths(options.kind, changed);
  if (!paths.ok) throw new Error(`healed tree is outside policy: ${paths.errors.join('; ')}`);

  writeOutput({
    healed: 'true', new_sha: newSha, staging_sha: stagingSha,
    next_heal: trusted.healAttempt + 1, resolved_files: resolutions.length,
  });
  const summary = resolutions.map((result) => `${result.file} [+${result.appendedSlugs.join(', ')}]`).join('; ');
  console.log(`Healed PR #${pr.number} base against staging ${stagingSha} as ${newSha} (${summary}).`);
}

async function observeAndPromote(options) {
  requireOptions(options, ['repo', 'pr', 'sha']);
  for (let poll = 0; poll < 72; poll += 1) {
    const pr = await github(`/repos/${options.repo}/pulls/${options.pr}`);
    const staging = pr.merged ? await github(`/repos/${options.repo}/branches/staging`) : null;
    const decision = evaluateObservedMerge({ pr, expectedSha: options.sha, stagingSha: staging?.commit?.sha });
    if (decision === 'superseded') {
      console.log(`Staging advanced beyond merged PR #${options.pr}; a newer serialized run will promote it.`);
      return;
    }
    if (decision === 'dispatch') {
      await dispatch({ repo: options.repo, kind: 'promotion', sha: pr.merge_commit_sha });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error('timed out waiting for native auto-merge into staging');
}

const commands = {
  'validate-pr': validatePr, 'validate-promotion': validatePromotion, 'prepare-promotion': preparePromotion,
  status: publishStatus, audit, 'apply-fix': applyFix, 'set-attempt': setAttempt, dispatch,
  'refresh-generator-base': refreshGeneratorBase, 'observe-and-promote': observeAndPromote,
  'heal-generator-base': healGeneratorBase, 'set-heal': setHeal,
};
try {
  const command = process.argv[2];
  if (!commands[command]) throw new Error(`unknown command: ${command}`);
  await commands[command](parseArgs());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
