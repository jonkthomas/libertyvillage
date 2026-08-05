#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  FIXER_MODEL, GATE_MODEL, MAX_REPAIRS, STATUS_CONTEXTS,
} from './constants.mjs';
import { github, paged, writeOutput } from './github.mjs';
import {
  evaluateObservedMerge, isExactSha, validatePromotionRange, validatePullRequest, validateRepairPlan,
} from './policy.mjs';

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

async function applyFix(options) {
  requireOptions(options, ['repo', 'pr', 'kind', 'sha', 'plan']);
  const current = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (current !== options.sha) throw new Error('repair checkout does not match validated exact SHA');
  const plan = JSON.parse(fs.readFileSync(options.plan, 'utf8'));
  const livePr = await github(`/repos/${options.repo}/pulls/${options.pr}`);
  if (livePr.state !== 'open' || livePr.head.sha !== options.sha) throw new Error('PR became stale before repair application');
  const files = (await paged(`/repos/${options.repo}/pulls/${options.pr}/files`)).map((file) => file.filename);
  const valid = validateRepairPlan(options.kind, plan, files);
  if (!valid.ok) throw new Error(`repair rejected before write: ${valid.errors.join('; ')}`);
  const root = fs.realpathSync(process.cwd());
  for (const edit of plan.edits) {
    const target = path.resolve(root, edit.path);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`repair escaped checkout: ${edit.path}`);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`repair target must be a regular file: ${edit.path}`);
    fs.writeFileSync(target, edit.content);
  }
  const changed = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
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

async function dispatch(options) {
  requireOptions(options, ['repo', 'kind', 'sha']);
  if (!isExactSha(options.sha)) throw new Error('dispatch SHA is invalid');
  const payload = { kind: options.kind, head_sha: options.sha };
  if (options.pr) payload.pr_number = Number(options.pr);
  await github(`/repos/${options.repo}/dispatches`, { method: 'POST', body: { event_type: 'autonomous-coordinate', client_payload: payload } });
  console.log(`Dispatched ${options.kind} coordinator for ${options.sha}.`);
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
  'observe-and-promote': observeAndPromote,
};
try {
  const command = process.argv[2];
  if (!commands[command]) throw new Error(`unknown command: ${command}`);
  await commands[command](parseArgs());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
