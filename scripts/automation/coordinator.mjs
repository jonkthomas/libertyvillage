#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ABANDONED_LABEL, ALLOW_RECORD_DELETION_LABEL, BLOCKED_LABEL, BLOCKING_SEVERITIES, FIXER_MODEL, GATE_MODEL,
  KIND_POLICIES, MAX_HEALS, MAX_REPAIRS, TRUSTED_PR_AUTHORS,
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
  MAX_CANDIDATE_REGENERATIONS, nextCandidateAction, nextRetry, parseAuditRecord,
  recordCandidateFailure, REGENERATION_COOLDOWN_HOURS,
} from './recovery.mjs';
import { isGeneratorKind, loadCandidateState, recordCandidateEvent, saveCandidateState } from './candidate-state.mjs';
import {
  hydrateQueue, loadTopicQueue, planTopicCandidate, queueEntryTitle, recordTopicFailure, selectEligibleTopic,
} from './topic-queue.mjs';
import { planBaseHeal, resolveAppendUnion } from './heal-base.mjs';
import {
  applyRecordRepairPlan, isRecordFile, isRecordRepairPlan, partitionRepairFiles, readRecordFile,
} from './record-repair.mjs';
import { promotionEnabled } from './promotion-control.mjs';
import { publishStatus } from './statuses.mjs';
// The delegated runtime owns the exact-merge `sync/main-<sha>` branch lifecycle.
import { observeAndSyncStaging, waitForBlogLiveHeadStatuses } from './content-sync.mjs';

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

// Trusted base/head text for every file with a deterministic content invariant:
// slug-keyed records use the destructive-diff guard, and topic discovery uses
// exact append-only queue validation.
async function validationSources(repo, pr, files, kind) {
  const sourceFiles = files.filter((file) => isRecordFile(file)
    || (kind === 'topic-discovery' && file === 'data/topic-queue.json'));
  if (sourceFiles.length === 0) return {};
  const baseSha = await mergeBaseSha(repo, pr.base.ref, pr.head.sha);
  const sources = {};
  for (const file of sourceFiles) {
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
  const sources = await validationSources(options.repo, pr, files, options.kind);
  const result = validatePullRequest({
    repository: options.repo, kind: options.kind, expectedSha: options.sha, pr, files, sources,
  });
  if (!result.ok) throw new Error(`pull request rejected: ${result.errors.join('; ')}`);
  const main = await github(`/repos/${options.repo}/branches/main`);
  if (!isExactSha(main?.commit?.sha)) throw new Error('main head is not an exact SHA');
  writeOutput({
    trusted: 'true', pr_number: pr.number, head_sha: pr.head.sha, head_ref: pr.head.ref,
    base_ref: pr.base.ref, main_sha: main.commit.sha,
    attempt: result.attempt, can_repair: result.attempt < MAX_REPAIRS ? 'true' : 'false',
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
  if (!promotionEnabled()) {
    writeOutput({ trusted: 'false', no_changes: 'true' });
    console.log('Promotion validation skipped because promotion is disabled for the supervisor pilot.');
    return;
  }
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
  const failure = options['failure-class'] ? {
    class: String(options['failure-class']),
    name: String(options['failure-name'] || 'unknown'),
    result: String(options['failure-result'] || 'failure'),
  } : null;
  const runUrl = process.env.GITHUB_SERVER_URL && /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '')
    ? `${process.env.GITHUB_SERVER_URL.replace(/\/$/, '')}/${options.repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  const record = {
    commit_sha: options.sha, kind: options.kind, decision: options.decision, attempts: attempt,
    reviewer_model: GATE_MODEL, fixer_model: FIXER_MODEL,
    score: verdict?.overall ?? null, findings: verdict?.findings ?? [], range: verdict?.range ?? options.range ?? null,
    failure, run_url: runUrl, recorded_at: new Date().toISOString(),
  };
  fs.writeFileSync(options.out, `${JSON.stringify(record, null, 2)}\n`);
  await setLabels(options.repo, options.pr, options.decision, attempt);
  // F13. A human-applied `allow-record-deletion` is read live from the PR so the
  // durable comment says so loudly. An override that only ever surfaced as an
  // internal return value and a job log line is an override nobody reviews.
  const live = await github(`/repos/${options.repo}/issues/${options.pr}`);
  const overridden = (live?.labels || [])
    .some((label) => (typeof label === 'string' ? label : label?.name) === ALLOW_RECORD_DELETION_LABEL);
  const marker = `<!-- automation-audit:${options.sha}:${options.decision}:${attempt} -->`;
  const comments = await paged(`/repos/${options.repo}/issues/${options.pr}/comments`);
  if (comments.some((comment) => comment.body?.includes(marker))) {
    writeOutput({ comment_created: 'false', record_deletion_overridden: overridden ? 'true' : 'false' });
    console.log('Audit comment already exists; notification remains deduplicated.');
    return;
  }
  const findings = record.findings.length
    ? record.findings.map((finding) => `- **${finding.severity}** \`${finding.path}\`: ${finding.note}`).join('\n')
    : failure
      ? `- No Opus verdict was produced. Blocking failure: **${failure.class}** / \`${failure.name}\` (${failure.result}).`
      : '- none';
  const blockingCount = record.findings.filter((finding) => BLOCKING_SEVERITIES.includes(finding?.severity)).length;
  const blockingSummary = failure && verdict === null
    ? `unavailable (no Opus verdict; ${failure.class}/${failure.name}=${failure.result})`
    : String(blockingCount);
  // The machine-readable half of the same evidence: what `recovery.buildRepairHistory`
  // replays on the next round to decide whether the repairs are converging at all.
  const data = `<!-- automation-audit-data:${JSON.stringify({
    sha: record.commit_sha, decision: record.decision, attempt,
    overall: record.score, blockingCount, recordDeletionOverridden: overridden,
  })} -->`;
  const body = [
    marker, data, '## Autonomous gate audit', '',
    `- Decision: **${record.decision}**`, `- Commit: \`${record.commit_sha}\``,
    `- Reviewer: \`${record.reviewer_model}\``, `- Fixer: \`${record.fixer_model}\``,
    `- Score: ${record.score ?? 'unavailable'}`, `- Repair attempts: ${record.attempts}/${MAX_REPAIRS}`,
    `- Blocking findings: ${blockingSummary}`,
    `- Range: \`${record.range ?? `PR #${options.pr} @ ${record.commit_sha}`}\``,
    ...(runUrl ? [`- GitHub Actions run: ${runUrl}`] : []),
    ...(overridden ? [
      '',
      `> [!CAUTION]`,
      `> **A human applied \`${ALLOW_RECORD_DELETION_LABEL}\` to this pull request.** The merge-time`,
      '> destructive-diff guard was overridden, so this diff was allowed to DELETE slug-keyed base',
      '> records. This was a person\'s decision, not the automation\'s — check the removed records.',
    ] : []),
    '', '### Findings', findings,
  ].join('\n');
  await github(`/repos/${options.repo}/issues/${options.pr}/comments`, { method: 'POST', body: { body } });
  writeOutput({ comment_created: 'true', record_deletion_overridden: overridden ? 'true' : 'false' });
  if (overridden) console.log(`WARNING: ${ALLOW_RECORD_DELETION_LABEL} override reported loudly in the audit comment on PR #${options.pr}.`);
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

// The latest durable coordinator decision on this candidate, read back from the
// audit comments the coordinator itself posted. Untrusted commenters are ignored,
// so a human cannot talk the ladder into believing a blocked PR is still healthy.
async function latestAuditDecision(repo, prNumber) {
  const comments = await paged(`/repos/${repo}/issues/${prNumber}/comments`);
  let decision = null;
  for (const comment of comments) {
    if (!TRUSTED_PR_AUTHORS.includes(comment?.user?.login)) continue;
    const record = parseAuditRecord(comment?.body);
    if (record?.decision) { decision = record.decision; continue; }
    const legacy = /<!--\s*automation-audit:[0-9a-f]{40}:([a-z-]+):\d+\s*-->/.exec(String(comment?.body ?? ''));
    if (legacy) decision = legacy[1];
  }
  return decision;
}

// F14. Runs at the START of a generation cycle, before any model spend. It answers
// one question: may this topic have a new candidate right now? The decision itself
// is nextCandidateAction's; everything here reads the durable ladder state and the
// controlled labels that carry the budget between candidates, and closes what the
// policy says to close.
//
// The ladder state lives in a controlled state issue rather than only on the open
// candidate's labels, because the two cases that used to lose it are exactly the
// two that matter: the PR closing, and a claim-linter refusal that never opened one.
function labelNames(labels) {
  return (labels || []).map((label) => (typeof label === 'string' ? label : label?.name));
}

function isAbandonedPull(pr) {
  return labelNames(pr?.labels).includes(ABANDONED_LABEL);
}

function parseExcludeTopicKeys(options) {
  return String(options['exclude-topic-keys'] ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

async function planFromQueue(options, { kind, state, issue, stateIssue, nowDate, prNumber = '' }) {
  const queue = hydrateQueue(loadTopicQueue(), state);
  const planned = planTopicCandidate({
    queue, state, kind, now: nowDate, excludeKeys: parseExcludeTopicKeys(options),
  });
  const title = queueEntryTitle(planned.queue, planned.topicKey);
  if (planned.action === 'abandon-topic' && planned.topicKey) {
    const recorded = await recordCandidateEvent(options.repo, kind, {
      key: `${kind}:ladder:${planned.topicKey}:${planned.regenerations}:abandon-topic`,
      action: 'abandon-topic',
      at: nowDate.toISOString(),
      reason: planned.reason,
      topicKey: planned.topicKey,
      queue: planned.queue,
    });
    writeOutput({
      kind, state_issue: recorded.issue?.number ?? stateIssue,
      action: 'abandon-topic', generate: 'false',
      regenerations: planned.regenerations,
      topic_key: planned.topicKey ?? '', topic_title: title,
      pr_number: prNumber, reason: planned.reason,
    });
    console.log(`ABANDONED_TOPIC for ${kind} topic ${planned.topicKey}: ${planned.reason}.`);
    return;
  }
  // Waiting because nothing is eligible is a no-op: the planner may rewrite
  // in-memory rollups (empty queue is not exhaustion; abandoned topics drop out
  // of the regen sum) but that must not PATCH the state issue or POST a PR.
  const idleNoTopics = planned.action === 'wait' && planned.reason === 'no eligible topics';
  if (!idleNoTopics) {
    const before = JSON.stringify({
      topics: state.topics ?? {}, seen: state.seen, abandoned: state.abandoned,
      regenerations: state.regenerations, lastFailureAt: state.lastFailureAt,
    });
    const after = JSON.stringify({
      topics: planned.state.topics ?? {}, seen: planned.state.seen, abandoned: planned.state.abandoned,
      regenerations: planned.state.regenerations, lastFailureAt: planned.state.lastFailureAt,
    });
    if (before !== after) {
      await saveCandidateState(options.repo, kind, planned.state, { issue });
    }
  }
  writeOutput({
    kind, state_issue: stateIssue,
    action: planned.action,
    generate: planned.generate ? 'true' : 'false',
    regenerations: planned.regenerations,
    topic_key: planned.topicKey ?? '',
    topic_title: title,
    pr_number: prNumber,
    reason: planned.reason,
  });
  if (planned.generate) {
    console.log(`No live ${kind} candidate; generating ${planned.topicKey ? `topic ${planned.topicKey}` : 'a fresh one'}: ${planned.reason}.`);
  } else {
    console.log(`Holding ${kind}: ${planned.reason}.`);
  }
}

async function planCandidate(options) {
  requireOptions(options, ['repo', 'kind']);
  const kind = options.kind;
  if (!isGeneratorKind(kind)) throw new Error(`plan-candidate requires a generator kind: ${kind}`);
  const policy = KIND_POLICIES[kind];
  const now = Date.now();
  const nowDate = new Date(now);
  // Fail closed: an unreadable ladder never silently restarts the budget at zero.
  const { issue, state } = await loadCandidateState(options.repo, kind);
  const stateIssue = issue?.number ?? '';

  const open = await paged(`/repos/${options.repo}/pulls?state=open&base=${encodeURIComponent(policy.base)}`);
  const candidates = open
    .filter((pr) => TRUSTED_PR_AUTHORS.includes(pr?.user?.login))
    .filter((pr) => policy.headPrefixes.some((prefix) => pr?.head?.ref === prefix || pr?.head?.ref?.startsWith(prefix)))
    .sort((left, right) => right.number - left.number);
  const live = candidates.filter((pr) => !isAbandonedPull(pr));

  const emit = (values, message) => {
    writeOutput({ kind, state_issue: stateIssue, topic_key: values.topic_key ?? '', topic_title: values.topic_title ?? '', ...values });
    console.log(message);
  };

  // An abandoned open PR no longer owns the kind: the next eligible topic may
  // generate. A still-live candidate (including PR #104) keeps the existing lane.
  if (live.length === 0) {
    await planFromQueue(options, { kind, state, issue, stateIssue, nowDate, prNumber: candidates[0]?.number ?? '' });
    return;
  }

  const candidate = live[0];
  const labels = candidate.labels || [];
  const names = labelNames(labels);
  // Neither store may lose budget: the durable ladder and the controlled label on
  // the candidate are reconciled upwards, never downwards.
  const regenerations = Math.max(state.regenerations, readRegenerationCount(labels));
  if (!names.includes(BLOCKED_LABEL)) {
    emit({ action: 'wait', generate: 'false', regenerations, pr_number: candidate.number, reason: 'a candidate is still in flight' },
      `PR #${candidate.number} is still in flight; not opening a second candidate.`);
    return;
  }

  const attempts = readRepairAttempt(labels);
  // A blocked candidate is a candidate the loop already stopped. Reading only the
  // repair counter mapped an automation-blocked, validation-failed PR with zero
  // attempts to `repair` and stranded it forever; the recorded decision is what
  // says whether any repair round could still do useful work.
  const blockDecision = (await latestAuditDecision(options.repo, candidate.number)) ?? 'blocked';
  const decision = nextCandidateAction({
    attempts, maxRepairs: MAX_REPAIRS, regenerations,
    healExhausted: !canHeal(readHealAttempt(labels)),
    blockDecision,
    blockedAt: candidate.updated_at, now,
  });
  console.log(`PR #${candidate.number} is blocked with recorded decision \`${blockDecision}\` at ${attempts}/${MAX_REPAIRS} repairs and ${regenerations}/${MAX_CANDIDATE_REGENERATIONS} regenerations.`);

  if (decision.action === 'abandon-topic') {
    await createLabel(options.repo, ABANDONED_LABEL, '000000', 'Every bounded candidate for this topic failed');
    await github(`/repos/${options.repo}/issues/${candidate.number}/labels`, { method: 'POST', body: { labels: [ABANDONED_LABEL] } });
    await postOnce(options.repo, candidate.number, `<!-- automation-candidate:${candidate.head.sha}:abandon-topic -->`, [
      '## Autonomous candidate policy — topic abandoned', '',
      `- Decision: **abandon-topic**`,
      `- Regenerations used: ${regenerations}/${MAX_CANDIDATE_REGENERATIONS}`,
      `- Recorded block decision: \`${blockDecision}\``,
      `- Reason: ${decision.reason}`, '',
      'No further candidate will be generated for this topic. Read the gate audit comments above and decide whether it is worth a hand-written post.',
    ].join('\n'));
    const recorded = await recordCandidateEvent(options.repo, kind, {
      key: `${kind}:pr-${candidate.number}:${candidate.head.sha}:abandon-topic`,
      action: 'abandon-topic', at: new Date(now).toISOString(), reason: decision.reason,
    });
    writeOutput({ kind, state_issue: recorded.issue?.number ?? stateIssue, action: decision.action, generate: 'false', regenerations: recorded.state.regenerations, pr_number: candidate.number, reason: decision.reason });
    console.log(`Abandoned the topic behind PR #${candidate.number}: ${decision.reason}.`);
    return;
  }

  if (decision.action !== 'close-and-regenerate') {
    emit({ action: decision.action, generate: 'false', regenerations, pr_number: candidate.number, reason: decision.reason },
      `Holding: ${decision.reason}.`);
    return;
  }

  // N4: the failed candidate is CLOSED. The next cycle generates a fresh grounded
  // draft through the linter — the rejected draft is never re-pushed. The ladder
  // moves in durable state FIRST, so the count survives the PR closing.
  const recorded = await recordCandidateEvent(options.repo, kind, {
    key: `${kind}:pr-${candidate.number}:${candidate.head.sha}:close-and-regenerate`,
    action: 'close-and-regenerate', at: new Date(now).toISOString(), reason: decision.reason,
  });
  await postOnce(options.repo, candidate.number, `<!-- automation-candidate:${candidate.head.sha}:close-and-regenerate -->`, [
    '## Autonomous candidate policy — closing and regenerating', '',
    `- Decision: **close-and-regenerate**`,
    `- Repair attempts used: ${attempts}/${MAX_REPAIRS}`,
    `- Recorded block decision: \`${blockDecision}\``,
    `- Regeneration: ${recorded.state.regenerations}/${MAX_CANDIDATE_REGENERATIONS}`,
    `- Reason: ${decision.reason}`, '',
    'This draft is not being re-pushed. The next cycle generates a fresh, grounded candidate through the claim linter.',
  ].join('\n'));
  await github(`/repos/${options.repo}/pulls/${candidate.number}`, { method: 'PATCH', body: { state: 'closed' } });
  writeOutput({
    kind, state_issue: recorded.issue?.number ?? stateIssue,
    action: decision.action, generate: 'true', regenerations: recorded.state.regenerations,
    pr_number: candidate.number, reason: decision.reason,
  });
  console.log(`Closed exhausted candidate PR #${candidate.number} and cleared the way for regeneration ${recorded.state.regenerations}/${MAX_CANDIDATE_REGENERATIONS}.`);
}

// F14, pre-PR half. A draft the claim linter refuses never becomes a pull request,
// so there is no PR and no label to carry its budget. This records that failure in
// the same durable ladder, idempotently: the discard costs one regeneration, starts
// the >=24h cooldown, and the third one ends in a visible ABANDONED_TOPIC. It never
// re-pushes the refused draft and never touches scored content.
async function recordCandidateOutcome(options) {
  requireOptions(options, ['repo', 'kind', 'outcome', 'key']);
  const kind = options.kind;
  if (!isGeneratorKind(kind)) throw new Error(`record-candidate-outcome requires a generator kind: ${kind}`);
  const { issue, state } = await loadCandidateState(options.repo, kind);
  const queue = hydrateQueue(loadTopicQueue(), state);
  const topic = options['topic-key'] || options.topicKey
    || selectEligibleTopic({ queue, state, kind, now: new Date() })?.key
    || null;
  const reason = options.reason || 'bounded candidate failed before a pull request existed';
  const eventKey = `${kind}:${options.key}`;

  if (options.outcome === 'PUBLISHED_MAIN') {
    if (!topic) throw new Error('record-candidate-outcome PUBLISHED_MAIN requires --topic-key');
    const recorded = await recordCandidateEvent(options.repo, kind, {
      key: eventKey, action: 'consume-intent', at: new Date().toISOString(), reason,
      topicKey: topic, queue, outcome: options.outcome,
    });
    writeOutput({
      kind, action: 'consume-intent', recorded: recorded.changed ? 'true' : 'false',
      regenerations: recorded.state.topics?.[topic]?.regenerations ?? recorded.state.regenerations,
      abandoned: recorded.state.abandoned ? 'true' : 'false',
      consumed: recorded.state.topics?.[topic]?.consumed ? 'true' : 'false',
      topic_key: topic, state_issue: recorded.issue?.number ?? issue?.number ?? '',
    });
    console.log(recorded.changed
      ? `Consumed published intent for ${kind} topic ${topic} after verified main containment.`
      : `Published intent for ${kind} topic ${topic} was already consumed (${recorded.reason}).`);
    return;
  }

  if (topic) {
    const preview = recordTopicFailure({
      queue, state, kind, now: new Date(), key: eventKey, topicKey: topic, reason,
    });
    const recorded = await recordCandidateEvent(options.repo, kind, {
      key: eventKey, action: preview.action, at: new Date().toISOString(), reason,
      topicKey: topic, queue: preview.queue, outcome: options.outcome,
    });
    writeOutput({
      kind, action: preview.action, recorded: recorded.changed ? 'true' : 'false',
      regenerations: recorded.state.topics?.[topic]?.regenerations ?? recorded.state.regenerations,
      abandoned: recorded.state.abandoned ? 'true' : 'false',
      topic_key: topic, state_issue: recorded.issue?.number ?? issue?.number ?? '',
    });
    console.log(recorded.changed
      ? `Recorded ${options.outcome} for ${kind} topic ${topic}: ${preview.action}, ladder now ${recorded.state.topics?.[topic]?.regenerations ?? recorded.state.regenerations}/${MAX_CANDIDATE_REGENERATIONS}`
        + `${recorded.state.topics?.[topic]?.abandoned ? ' — ABANDONED_TOPIC' : `, next candidate after ${REGENERATION_COOLDOWN_HOURS}h`}.`
      : `Outcome ${options.outcome} for ${kind} was already recorded (${recorded.reason}); the ladder is unchanged.`);
    return;
  }

  const ladder = recordCandidateFailure({ regenerations: state.regenerations });
  const recorded = await recordCandidateEvent(options.repo, kind, {
    key: eventKey, action: ladder.action, at: new Date().toISOString(), reason,
    outcome: options.outcome,
  });
  writeOutput({
    kind, action: ladder.action, recorded: recorded.changed ? 'true' : 'false',
    regenerations: recorded.state.regenerations, abandoned: recorded.state.abandoned ? 'true' : 'false',
    topic_key: '', state_issue: recorded.issue?.number ?? '',
  });
  console.log(recorded.changed
    ? `Recorded ${options.outcome} for ${kind}: ${ladder.action}, ladder now ${recorded.state.regenerations}/${MAX_CANDIDATE_REGENERATIONS}`
      + `${recorded.state.abandoned ? ' — ABANDONED_TOPIC' : `, next candidate after ${REGENERATION_COOLDOWN_HOURS}h`}.`
    : `Outcome ${options.outcome} for ${kind} was already recorded (${recorded.reason}); the ladder is unchanged.`);
}

async function resolveTopic(options) {
  requireOptions(options, ['repo', 'kind']);
  const kind = options.kind;
  if (!isGeneratorKind(kind)) throw new Error(`resolve-topic requires a generator kind: ${kind}`);
  const { state } = await loadCandidateState(options.repo, kind);
  const queue = hydrateQueue(loadTopicQueue(), state);
  const planned = planTopicCandidate({
    queue, state, kind, now: new Date(), excludeKeys: parseExcludeTopicKeys(options),
  });
  writeOutput({
    kind,
    topic_key: planned.topicKey ?? '',
    topic_title: queueEntryTitle(planned.queue, planned.topicKey),
    action: planned.action,
    generate: planned.generate ? 'true' : 'false',
    regenerations: planned.regenerations,
    reason: planned.reason,
  });
  console.log(planned.topicKey
    ? `Resolved ${kind} topic ${planned.topicKey}: ${planned.reason}.`
    : `No eligible ${kind} topic: ${planned.reason}.`);
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

  const policy = KIND_POLICIES[options.kind];
  const baseRef = policy?.base;
  if (!baseRef) throw new Error(`unknown generator kind: ${options.kind}`);
  if (options.kind === 'blog-live' && baseRef !== 'main') {
    throw new Error('blog-live refresh refused: incoming base must be main, never staging');
  }
  const incoming = await github(`/repos/${options.repo}/branches/${baseRef}`);
  const comparison = await github(`/repos/${options.repo}/compare/${options.sha}...${incoming.commit.sha}`);
  const decision = evaluateGeneratorBase({
    expectedSha: options.sha, prHeadSha: pr.head.sha, stagingSha: incoming.commit.sha,
    stagingAheadBy: comparison.ahead_by, baseSha: incoming.commit.sha, baseAheadBy: comparison.ahead_by,
  });
  if (decision === 'continue') {
    const current = await github(`/repos/${options.repo}/pulls/${options.pr}`);
    assertSamePrIdentity(pr, current, options.sha, options.repo);
    writeOutput({ refreshed: 'false', head_sha: options.sha });
    console.log(`PR #${pr.number} already contains current ${baseRef} base ${incoming.commit.sha}.`);
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
      || commit.parents[0]?.sha !== options.sha || commit.parents[1]?.sha !== incoming.commit.sha
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
// A current base or clean merge proves that the red job was not caused by a base
// conflict. Those are successful no-ops (healed=false), while block-generator
// still fails closed. Unknown conflicts and raced heads remain hard errors.
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

  const policy = KIND_POLICIES[options.kind];
  const baseRef = policy?.base;
  if (!baseRef) throw new Error(`unknown generator kind: ${options.kind}`);
  if (options.kind === 'blog-live' && baseRef !== 'main') {
    throw new Error('blog-live heal refused: incoming base must be main, never origin/staging');
  }
  const incoming = await github(`/repos/${options.repo}/branches/${baseRef}`);
  const incomingSha = incoming?.commit?.sha;
  if (!isExactSha(incomingSha)) throw new Error(`${baseRef} head is not an exact SHA`);
  git(['fetch', '--no-tags', 'origin', `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`], { stdio: 'ignore' });
  if (git(['rev-parse', `refs/remotes/origin/${baseRef}`]).trim() !== incomingSha) {
    throw new Error(`fetched ${baseRef} head does not match the live ${baseRef} head`);
  }
  let containsBase = true;
  try { git(['merge-base', '--is-ancestor', incomingSha, options.sha], { stdio: 'ignore' }); }
  catch { containsBase = false; }
  if (containsBase) {
    writeOutput({ healed: 'false', reason: 'current-base', staging_sha: incomingSha, base_sha: incomingSha });
    console.log(`PR #${pr.number} already contains current ${baseRef} ${incomingSha}; no base heal applies.`);
    return;
  }

  let conflicted = [];
  let mergeError = null;
  try {
    git(['merge', '--no-commit', '--no-ff', '--no-verify', incomingSha], { stdio: 'pipe' });
  } catch (error) {
    mergeError = error;
    conflicted = conflictedFiles();
  }
  if (conflicted.length === 0) {
    try { git(['merge', '--abort'], { stdio: 'ignore' }); } catch { /* nothing staged to abort */ }
    if (mergeError) throw new Error(`merge failed without a resolvable conflict: ${String(mergeError.stderr || mergeError.message).trim().slice(0, 200)}`);
    writeOutput({ healed: 'false', reason: 'clean-merge', staging_sha: incomingSha, base_sha: incomingSha });
    console.log(`${baseRef} ${incomingSha} merges cleanly into PR #${pr.number}; no base heal applies.`);
    return;
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
    'commit', '--no-verify', '-m', `automation: heal generator base conflict with ${baseRef} (heal ${trusted.healAttempt + 1})`,
  ], { stdio: 'pipe' });
  const newSha = git(['rev-parse', 'HEAD']).trim();
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ');
  if (parents.length !== 3 || parents[1] !== options.sha || parents[2] !== incomingSha) {
    throw new Error(`healed commit is not an exact merge of the validated head and ${baseRef}`);
  }
  if (options.kind === 'blog-live') {
    let stagingMergedIn = false;
    try {
      git(['fetch', '--no-tags', 'origin', '+refs/heads/staging:refs/remotes/origin/staging'], { stdio: 'ignore' });
      const liveStaging = git(['rev-parse', 'refs/remotes/origin/staging']).trim();
      git(['merge-base', '--is-ancestor', liveStaging, newSha], { stdio: 'ignore' });
      stagingMergedIn = true;
    } catch { stagingMergedIn = false; }
    if (stagingMergedIn) throw new Error('heal merged origin/staging into a blog-live head');
  }
  const changed = git(['diff', '--name-only', `${incomingSha}..HEAD`]).trim().split('\n').filter(Boolean);
  const paths = validatePaths(options.kind, changed);
  if (!paths.ok) throw new Error(`healed tree is outside policy: ${paths.errors.join('; ')}`);

  writeOutput({
    healed: 'true', new_sha: newSha, staging_sha: incomingSha, base_sha: incomingSha,
    next_heal: trusted.healAttempt + 1, resolved_files: resolutions.length,
  });
  const summary = resolutions.map((result) => `${result.file} [+${result.appendedSlugs.join(', ')}]`).join('; ');
  console.log(`Healed PR #${pr.number} base against ${baseRef} ${incomingSha} as ${newSha} (${summary}).`);
}

async function observeAndPromote(options) {
  requireOptions(options, ['repo', 'pr', 'sha']);
  if (options.kind === 'blog-live') {
    throw new Error('observe-and-promote refused: blog-live PRs must use observe-and-sync-staging');
  }
  if (!promotionEnabled()) {
    writeOutput({ observed: 'pilot-no-promote', promotion_dispatched: 'false' });
    console.log('Staging merge observation completed with promotion disabled for the supervisor pilot.');
    return;
  }
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
  'wait-for-blog-live-head': waitForBlogLiveHeadStatuses, 'observe-and-sync-staging': observeAndSyncStaging,
  'heal-generator-base': healGeneratorBase, 'set-heal': setHeal,
  recover, 'read-attempt': readAttempt, 'plan-candidate': planCandidate, 'mark-regeneration': markRegeneration,
  'record-candidate-outcome': recordCandidateOutcome, 'resolve-topic': resolveTopic,
};
try {
  const command = process.argv[2];
  if (!commands[command]) throw new Error(`unknown command: ${command}`);
  await commands[command](parseArgs());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
