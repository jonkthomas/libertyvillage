#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ALLOW_RECORD_DELETION_LABEL, BLOCKED_LABEL, FIXER_MODEL, GATE_MODEL, KIND_POLICIES,
  MAX_HEALS, MAX_REPAIRS, STATUS_CONTEXTS, TRUSTED_PR_AUTHORS,
} from './constants.mjs';
import { github, mergeBaseSha, paged, writeOutput } from './github.mjs';
import {
  canHeal, evaluateGeneratorBase, evaluateObservedMerge, filterRepairablePaths, healLabel, isExactSha,
  isTextRepairPath, readHealAttempt, readRegenerationCount, readRepairAttempt, readRetryAttempt,
  regenerationLabel, retryLabel, validatePaths, validatePromotionRange, validatePullRequest,
  validateRepairPlan,
} from './policy.mjs';
import { MAX_TRANSIENT_RETRIES } from './constants.mjs';
import {
  MAX_CANDIDATE_REGENERATIONS, nextCandidateAction, nextRetry,
} from './recovery.mjs';
import { planBaseHeal, resolveAppendUnion } from './heal-base.mjs';
import {
  applyRecordRepairPlan, isRecordFile, isRecordRepairPlan, partitionRepairFiles, readRecordFile,
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

// The dispatch payload is repo-scoped but still data: a PR number that reaches a
// GitHub path must be an exact positive integer, never a fragment.
function exactPrNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || String(value).trim() !== String(number)) {
    throw new Error(`pull request number is not an exact positive integer: ${String(value)}`);
  }
  return number;
}

async function prData(repo, number) {
  const pr = await github(`/repos/${repo}/pulls/${number}`);
  const files = (await paged(`/repos/${repo}/pulls/${number}/files`)).map((file) => file.filename);
  return { pr, files };
}

async function textAtSha(repo, file, sha) {
  const encoded = file.split('/').map(encodeURIComponent).join('/');
  const response = await github(`/repos/${repo}/contents/${encoded}?ref=${sha}`);
  if (response.type !== 'file' || response.encoding !== 'base64') throw new Error(`cannot load text file: ${file}`);
  return Buffer.from(response.content, 'base64').toString('utf8');
}

// Trusted base/head text for every slug-keyed record file in the diff, so the
// destructive-diff guard adjudicates real content instead of being skipped.
async function recordSources(repo, pr, files) {
  const recordFiles = files.filter((file) => isRecordFile(file));
  if (recordFiles.length === 0) return {};
  const baseSha = await mergeBaseSha(repo, pr.base.ref, pr.head.sha);
  const sources = {};
  for (const file of recordFiles) {
    sources[file] = {
      baseText: await textAtSha(repo, file, baseSha),
      headText: await textAtSha(repo, file, pr.head.sha),
    };
  }
  return sources;
}

async function validatePr(options) {
  requireOptions(options, ['repo', 'pr', 'kind', 'sha']);
  const { pr, files } = await prData(options.repo, options.pr);
  const sources = await recordSources(options.repo, pr, files);
  const result = validatePullRequest({
    repository: options.repo, kind: options.kind, expectedSha: options.sha, pr, files, sources,
  });
  if (!result.ok) throw new Error(`pull request rejected: ${result.errors.join('; ')}`);
  writeOutput({
    trusted: 'true', pr_number: pr.number, head_sha: pr.head.sha, head_ref: pr.head.ref,
    base_ref: pr.base.ref, attempt: result.attempt, can_repair: result.attempt < MAX_REPAIRS ? 'true' : 'false',
    heal_attempt: result.healAttempt, can_heal: canHeal(result.healAttempt) ? 'true' : 'false',
    files: files.length,
    record_deletion_overridden: result.destructiveOverridden ? 'true' : 'false',
  });
  if (result.destructiveOverridden) {
    console.log(`WARNING: a human applied ${ALLOW_RECORD_DELETION_LABEL} to PR #${pr.number}; record deletions were allowed through the merge-time guard.`);
  }
  console.log(`Validated trusted ${options.kind} PR #${pr.number} at ${pr.head.sha} (${files.length} files, attempt ${result.attempt}, destructive-diff guard ${result.destructiveChecked ? 'ran' : 'not applicable'}).`);
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

// Every decision that leaves the candidate stopped and human-visible. A decision
// missing from this set is how a blocked PR goes silent, so it lives next to the
// single BLOCKED_LABEL binding the sentinel reads.
const BLOCKED_DECISIONS = Object.freeze(['blocked', 'error', 'exhausted', 'unrepairable', 'validation-failed', 'abandoned']);

async function setLabels(repo, prNumber, decision, attempt) {
  await createLabel(repo, BLOCKED_LABEL, 'b60205', 'Autonomous promotion gate blocked this PR');
  for (let n = 1; n <= MAX_REPAIRS; n += 1) await createLabel(repo, `automation-repair-${n}`, 'fbca04', `Autonomous repair attempt ${n}`);
  if (BLOCKED_DECISIONS.includes(decision)) {
    await github(`/repos/${repo}/issues/${prNumber}/labels`, { method: 'POST', body: { labels: [BLOCKED_LABEL] } });
  } else {
    try { await github(`/repos/${repo}/issues/${prNumber}/labels/${BLOCKED_LABEL}`, { method: 'DELETE' }); }
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
  exactPrNumber(options.pr);
  if (!isExactSha(options.sha)) throw new Error('audit SHA is invalid');
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

// Same single-controlled-label lifecycle as repairs and heals, on the transient
// retry budget: a rerun cannot buy extra redispatches.
async function setRetryLabels(repo, prNumber, attempt) {
  for (let n = 1; n <= MAX_TRANSIENT_RETRIES; n += 1) await createLabel(repo, retryLabel(n), '5319e7', `Autonomous transient redispatch ${n}`);
  for (let n = 1; n <= MAX_TRANSIENT_RETRIES; n += 1) {
    if (n === attempt) continue;
    try { await github(`/repos/${repo}/issues/${prNumber}/labels/${retryLabel(n)}`, { method: 'DELETE' }); }
    catch (error) { if (!error.message.includes('(404)')) throw error; }
  }
  await github(`/repos/${repo}/issues/${prNumber}/labels`, { method: 'POST', body: { labels: [retryLabel(attempt)] } });
}

// F7. Decide, and consume the budget BEFORE anything redispatches, so a rerun of
// this job cannot buy a third try. A terminal failure never reaches `retry`.
async function recover(options) {
  requireOptions(options, ['repo', 'pr', 'sha', 'classification']);
  const prNumber = exactPrNumber(options.pr);
  if (!isExactSha(options.sha)) throw new Error('recovery SHA is invalid');
  const pr = await github(`/repos/${options.repo}/pulls/${prNumber}`);
  if (pr.state !== 'open' || pr.head.sha !== options.sha) {
    writeOutput({ action: 'block', delay_seconds: 0, attempt: 0, reason: 'PR moved on; failing closed to a visible block' });
    return;
  }
  const attempts = readRetryAttempt(pr.labels || []);
  const plan = nextRetry({ attempts, classification: options.classification });
  if (plan.action !== 'retry') {
    writeOutput({ action: 'block', delay_seconds: 0, attempt: attempts, reason: plan.reason });
    console.log(`No bounded recovery available: ${plan.reason}.`);
    return;
  }
  await setRetryLabels(options.repo, prNumber, attempts + 1);
  writeOutput({ action: 'retry', delay_seconds: plan.delaySeconds, attempt: attempts + 1, reason: plan.reason });
  console.log(`Consumed transient redispatch ${attempts + 1}/${MAX_TRANSIENT_RETRIES} on PR #${prNumber}: ${plan.reason}.`);
}

// 3h. The attempt label is the live budget; a `needs.` output captured before the
// repair job bumped it is stale, and acting on a stale count is how a candidate
// buys an extra round.
async function readAttempt(options) {
  requireOptions(options, ['repo', 'pr']);
  const prNumber = exactPrNumber(options.pr);
  const pr = await github(`/repos/${options.repo}/pulls/${prNumber}`);
  const labels = pr.labels || [];
  const attempt = readRepairAttempt(labels);
  const healAttempt = readHealAttempt(labels);
  writeOutput({
    attempt, heal_attempt: healAttempt,
    can_repair: attempt < MAX_REPAIRS ? 'true' : 'false',
    can_heal: canHeal(healAttempt) ? 'true' : 'false',
    regenerations: readRegenerationCount(labels),
  });
  console.log(`Live budgets on PR #${prNumber}: repair ${attempt}/${MAX_REPAIRS}, heal ${healAttempt}/${MAX_HEALS}.`);
}

async function setHeal(options) {
  requireOptions(options, ['repo', 'pr', 'heal']);
  const attempt = Number(options.heal);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_HEALS) throw new Error('invalid next heal attempt');
  await setHealLabels(options.repo, options.pr, attempt);
  console.log(`Consumed base heal ${attempt}/${MAX_HEALS} on PR #${options.pr}.`);
}

const ABANDONED_LABEL = 'automation-abandoned';

// F14. Runs at the START of a generation cycle, before any model spend. It answers
// one question: may this topic have a new candidate right now? The decision itself
// is nextCandidateAction's; everything here is reading the controlled labels that
// carry the budget between candidates, and closing what the policy says to close.
async function planCandidate(options) {
  requireOptions(options, ['repo', 'kind']);
  const policy = KIND_POLICIES[options.kind];
  if (!policy || options.kind === 'promotion') throw new Error(`plan-candidate requires a generator kind: ${options.kind}`);
  const open = await paged(`/repos/${options.repo}/pulls?state=open&base=${encodeURIComponent(policy.base)}`);
  const candidates = open
    .filter((pr) => TRUSTED_PR_AUTHORS.includes(pr?.user?.login))
    .filter((pr) => policy.headPrefixes.some((prefix) => pr?.head?.ref === prefix || pr?.head?.ref?.startsWith(prefix)))
    .sort((left, right) => right.number - left.number);

  const emit = (values, message) => { writeOutput(values); console.log(message); };
  if (candidates.length === 0) {
    emit({ action: 'generate', generate: 'true', regenerations: 0, pr_number: '', reason: 'no candidate is in flight' },
      `No open ${options.kind} candidate; generating a fresh one.`);
    return;
  }

  const candidate = candidates[0];
  const labels = candidate.labels || [];
  const names = labels.map((label) => (typeof label === 'string' ? label : label?.name));
  if (names.includes(ABANDONED_LABEL)) {
    emit({ action: 'abandon-topic', generate: 'false', regenerations: readRegenerationCount(labels), pr_number: candidate.number, reason: 'topic is already abandoned and waiting on a human' },
      `PR #${candidate.number} is already abandoned; no new candidate until a human acts.`);
    return;
  }
  if (!names.includes(BLOCKED_LABEL)) {
    emit({ action: 'wait', generate: 'false', regenerations: readRegenerationCount(labels), pr_number: candidate.number, reason: 'a candidate is still in flight' },
      `PR #${candidate.number} is still in flight; not opening a second candidate.`);
    return;
  }

  const attempts = readRepairAttempt(labels);
  const regenerations = readRegenerationCount(labels);
  const decision = nextCandidateAction({
    attempts, maxRepairs: MAX_REPAIRS, regenerations,
    healExhausted: !canHeal(readHealAttempt(labels)),
    blockedAt: candidate.updated_at, now: Date.now(),
  });

  if (decision.action === 'abandon-topic') {
    await createLabel(options.repo, ABANDONED_LABEL, '000000', 'Every bounded candidate for this topic failed');
    await github(`/repos/${options.repo}/issues/${candidate.number}/labels`, { method: 'POST', body: { labels: [ABANDONED_LABEL] } });
    await postOnce(options.repo, candidate.number, `<!-- automation-candidate:${candidate.head.sha}:abandon-topic -->`, [
      '## Autonomous candidate policy — topic abandoned', '',
      `- Decision: **abandon-topic**`,
      `- Regenerations used: ${regenerations}/${MAX_CANDIDATE_REGENERATIONS}`,
      `- Reason: ${decision.reason}`, '',
      'No further candidate will be generated for this topic. Read the gate audit comments above and decide whether it is worth a hand-written post.',
    ].join('\n'));
    emit({ action: decision.action, generate: 'false', regenerations, pr_number: candidate.number, reason: decision.reason },
      `Abandoned the topic behind PR #${candidate.number}: ${decision.reason}.`);
    return;
  }

  if (decision.action !== 'close-and-regenerate') {
    emit({ action: decision.action, generate: 'false', regenerations, pr_number: candidate.number, reason: decision.reason },
      `Holding: ${decision.reason}.`);
    return;
  }

  // N4: the failed candidate is CLOSED. The next cycle generates a fresh grounded
  // draft through the linter — the rejected draft is never re-pushed.
  await postOnce(options.repo, candidate.number, `<!-- automation-candidate:${candidate.head.sha}:close-and-regenerate -->`, [
    '## Autonomous candidate policy — closing and regenerating', '',
    `- Decision: **close-and-regenerate**`,
    `- Repair attempts used: ${attempts}/${MAX_REPAIRS}`,
    `- Regeneration: ${regenerations + 1}/${MAX_CANDIDATE_REGENERATIONS}`,
    `- Reason: ${decision.reason}`, '',
    'This draft is not being re-pushed. The next cycle generates a fresh, grounded candidate through the claim linter.',
  ].join('\n'));
  await github(`/repos/${options.repo}/pulls/${candidate.number}`, { method: 'PATCH', body: { state: 'closed' } });
  emit({
    action: decision.action, generate: 'true', regenerations: regenerations + 1,
    pr_number: candidate.number, reason: decision.reason,
  }, `Closed exhausted candidate PR #${candidate.number} and cleared the way for regeneration ${regenerations + 1}/${MAX_CANDIDATE_REGENERATIONS}.`);
}

// Deduplicated by marker, exactly like the gate audit comment.
async function postOnce(repo, prNumber, marker, body) {
  const comments = await paged(`/repos/${repo}/issues/${prNumber}/comments`);
  if (comments.some((comment) => comment.body?.includes(marker))) return false;
  await github(`/repos/${repo}/issues/${prNumber}/comments`, { method: 'POST', body: { body: `${marker}\n${body}` } });
  return true;
}

// Carries the regeneration budget onto the freshly opened candidate, using the same
// single-controlled-label discipline as the repair and heal series.
async function markRegeneration(options) {
  requireOptions(options, ['repo', 'pr', 'regenerations']);
  const prNumber = exactPrNumber(options.pr);
  const count = Number(options.regenerations);
  if (!Number.isInteger(count) || count < 0 || count > MAX_CANDIDATE_REGENERATIONS) throw new Error(`invalid regeneration count: ${options.regenerations}`);
  if (count === 0) { console.log('First candidate for this topic; no regeneration label needed.'); return; }
  for (let n = 1; n <= MAX_CANDIDATE_REGENERATIONS; n += 1) await createLabel(options.repo, regenerationLabel(n), 'd93f0b', `Autonomous candidate regeneration ${n}`);
  for (let n = 1; n <= MAX_CANDIDATE_REGENERATIONS; n += 1) {
    if (n === count) continue;
    try { await github(`/repos/${options.repo}/issues/${prNumber}/labels/${regenerationLabel(n)}`, { method: 'DELETE' }); }
    catch (error) { if (!error.message.includes('(404)')) throw error; }
  }
  await github(`/repos/${options.repo}/issues/${prNumber}/labels`, { method: 'POST', body: { labels: [regenerationLabel(count)] } });
  console.log(`PR #${prNumber} is regeneration ${count}/${MAX_CANDIDATE_REGENERATIONS} for this topic.`);
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
  // F11. A passing, auto-merge-armed PR must never be relabelled automation-blocked
  // just because observation ran out of wall clock. Record the observed timeout as
  // a handoff and exit 0; the scheduled promotion sweep owns the outcome from here.
  writeOutput({ observed: 'timeout', promotion_dispatched: 'false', handoff: 'promotion-sweep' });
  console.log(`Observation window elapsed for PR #${options.pr} at ${options.sha} while auto-merge is still armed.`
    + ' Handing off to the scheduled promotion sweep and exiting 0 — this is not a block.');
}

const commands = {
  'validate-pr': validatePr, 'validate-promotion': validatePromotion, 'prepare-promotion': preparePromotion,
  status: publishStatus, audit, 'apply-fix': applyFix, 'set-attempt': setAttempt, dispatch,
  'refresh-generator-base': refreshGeneratorBase, 'observe-and-promote': observeAndPromote,
  'heal-generator-base': healGeneratorBase, 'set-heal': setHeal,
  recover, 'read-attempt': readAttempt, 'plan-candidate': planCandidate, 'mark-regeneration': markRegeneration,
};
try {
  const command = process.argv[2];
  if (!commands[command]) throw new Error(`unknown command: ${command}`);
  await commands[command](parseArgs());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
