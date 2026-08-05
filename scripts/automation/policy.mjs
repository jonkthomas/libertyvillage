import {
  ALL_SEVERITIES,
  BLOCKING_SEVERITIES,
  FORBIDDEN_PATH_PREFIXES,
  FORBIDDEN_PATHS,
  GATE_MODEL,
  KIND_POLICIES,
  MAX_REPAIRS,
  SCORE_THRESHOLD,
  TRUSTED_PR_AUTHORS,
} from './constants.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const TEXT_FILE_PATTERN = /\.(?:cjs|css|csv|html|js|jsx|json|md|mdx|mjs|scss|ts|tsx|txt|xml|ya?ml)$/i;

export function isExactSha(value) {
  return typeof value === 'string' && SHA_PATTERN.test(value);
}

export function normalizeRepoPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || /[\0\r\n]/.test(value)) return null;
  if (value.startsWith('/') || value.split('/').some((part) => part === '..' || part === '')) return null;
  return value;
}

function matchesRule(file, rule) {
  return rule.endsWith('/') ? file.startsWith(rule) : file === rule;
}

export function isForbiddenPath(file) {
  const normalized = normalizeRepoPath(file);
  if (!normalized) return true;
  return FORBIDDEN_PATHS.includes(normalized) || FORBIDDEN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function validatePaths(kind, files, { repair = false } = {}) {
  const policy = KIND_POLICIES[kind];
  if (!policy) return { ok: false, errors: [`unknown generator kind: ${kind}`] };
  if (!Array.isArray(files) || files.length === 0) return { ok: false, errors: ['diff must contain at least one file'] };
  const rules = repair ? policy.repairablePaths : policy.allowedPaths;
  const errors = [];
  if (files.length > policy.maxFiles) errors.push(`file budget exceeded: ${files.length} > ${policy.maxFiles}`);
  for (const raw of files) {
    const file = normalizeRepoPath(raw);
    if (!file) errors.push(`invalid repository path: ${String(raw)}`);
    else if (isForbiddenPath(file)) errors.push(`forbidden path: ${file}`);
    else if (!rules.some((rule) => matchesRule(file, rule))) errors.push(`${repair ? 'non-repairable' : 'disallowed'} path for ${kind}: ${file}`);
  }
  return { ok: errors.length === 0, errors };
}

export function filterRepairablePaths(kind, files) {
  if (!Array.isArray(files)) return [];
  return files.filter((file) => validatePaths(kind, [file], { repair: true }).ok);
}

export function readRepairAttempt(labels) {
  if (!Array.isArray(labels)) throw new Error('labels must be an array');
  const values = labels
    .map((label) => typeof label === 'string' ? label : label?.name)
    .filter((name) => /^automation-repair-\d+$/.test(name || ''))
    .map((name) => Number(name.slice('automation-repair-'.length)));
  if (values.length > 1) throw new Error('multiple controlled repair labels found');
  const attempt = values[0] ?? 0;
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > MAX_REPAIRS) throw new Error(`invalid repair attempt: ${attempt}`);
  return attempt;
}

export function canRepair(attempt) {
  return Number.isInteger(attempt) && attempt >= 0 && attempt < MAX_REPAIRS;
}

export function validatePullRequest({ repository, kind, expectedSha, pr, files }) {
  const policy = KIND_POLICIES[kind];
  const errors = [];
  if (!policy) return { ok: false, errors: [`unknown generator kind: ${kind}`] };
  if (!isExactSha(expectedSha)) errors.push('payload head SHA is not an exact 40-character commit SHA');
  if (pr?.state !== 'open') errors.push('pull request is not open');
  if (pr?.draft !== false) errors.push('pull request must be non-draft');
  if (pr?.head?.repo?.full_name !== repository) errors.push('pull request head is not from this repository');
  if (pr?.base?.repo?.full_name !== repository) errors.push('pull request base is not in this repository');
  if (!TRUSTED_PR_AUTHORS.includes(pr?.user?.login)) errors.push(`untrusted pull request author: ${pr?.user?.login || 'missing'}`);
  if (pr?.base?.ref !== policy.base) errors.push(`unexpected base branch: ${pr?.base?.ref || 'missing'}`);
  const expectedHead = policy.exactHead
    ? pr?.head?.ref === policy.exactHead
    : policy.headPrefixes.some((prefix) => pr?.head?.ref === prefix || pr?.head?.ref?.startsWith(prefix));
  if (!expectedHead) errors.push(`unexpected head branch: ${pr?.head?.ref || 'missing'}`);
  if (pr?.head?.sha !== expectedSha) errors.push('payload SHA does not match current pull request head');
  const pathResult = validatePaths(kind, files);
  errors.push(...pathResult.errors);
  let attempt = 0;
  try { attempt = readRepairAttempt(pr?.labels || []); } catch (error) { errors.push(error.message); }
  return { ok: errors.length === 0, errors, attempt };
}

export function evaluateVerdict(raw, expectedSha) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, passed: false, errors: ['verdict must be an object'] };
  const keys = Object.keys(raw).sort();
  const expectedKeys = ['commit_sha', 'findings', 'model', 'overall', 'passed'];
  if (keys.join(',') !== expectedKeys.sort().join(',')) errors.push('verdict has missing or unexpected top-level fields');
  if (typeof raw.overall !== 'number' || !Number.isFinite(raw.overall) || raw.overall < 0 || raw.overall > 10) errors.push('overall must be a number from 0 to 10');
  if (typeof raw.passed !== 'boolean') errors.push('passed must be boolean');
  if (raw.model !== GATE_MODEL) errors.push(`model must be ${GATE_MODEL}`);
  if (!isExactSha(raw.commit_sha) || raw.commit_sha !== expectedSha) errors.push('commit_sha must match the reviewed exact SHA');
  if (!Array.isArray(raw.findings)) errors.push('findings must be an array');
  else {
    for (const [index, finding] of raw.findings.entries()) {
      const findingKeys = finding && typeof finding === 'object' ? Object.keys(finding).sort().join(',') : '';
      if (findingKeys !== 'note,path,severity') errors.push(`finding ${index} has invalid fields`);
      if (!ALL_SEVERITIES.includes(finding?.severity)) errors.push(`finding ${index} has invalid severity`);
      if (!normalizeRepoPath(finding?.path)) errors.push(`finding ${index} has invalid path`);
      if (typeof finding?.note !== 'string' || finding.note.trim().length === 0) errors.push(`finding ${index} has empty note`);
    }
  }
  const hasBlocking = Array.isArray(raw.findings) && raw.findings.some((finding) => BLOCKING_SEVERITIES.includes(finding?.severity));
  const computedPassed = typeof raw.overall === 'number' && raw.overall >= SCORE_THRESHOLD && !hasBlocking;
  if (raw.passed !== computedPassed) errors.push('passed does not match the enforced score/severity decision');
  return { ok: errors.length === 0, passed: errors.length === 0 && computedPassed, errors, hasBlocking };
}

export function validatePromotionRange({ expectedSha, stagingSha, mainSha, aheadBy }) {
  const errors = [];
  if (!isExactSha(expectedSha) || stagingSha !== expectedSha) errors.push('staging head does not match dispatched exact SHA');
  if (!isExactSha(mainSha)) errors.push('main head is not an exact SHA');
  if (!Number.isInteger(aheadBy) || aheadBy < 0) errors.push('invalid cumulative ahead count');
  return { ok: errors.length === 0, errors, noChanges: errors.length === 0 && aheadBy === 0, range: `${mainSha}...${stagingSha}` };
}

export function evaluateGeneratorBase({ expectedSha, prHeadSha, stagingSha, stagingAheadBy }) {
  if (!isExactSha(expectedSha) || prHeadSha !== expectedSha) throw new Error('PR head changed before base refresh');
  if (!isExactSha(stagingSha)) throw new Error('staging head is not an exact SHA');
  if (!Number.isInteger(stagingAheadBy) || stagingAheadBy < 0) throw new Error('invalid staging comparison');
  return stagingAheadBy > 0 ? 'refresh' : 'continue';
}

export function evaluateObservedMerge({ pr, expectedSha, stagingSha }) {
  if (pr?.head?.sha !== expectedSha) throw new Error('PR head changed while awaiting staging merge');
  if (!pr.merged) return 'wait';
  if (pr?.base?.ref !== 'staging' || !isExactSha(pr?.merge_commit_sha)) throw new Error('observed merge is not an exact staging merge');
  return stagingSha === pr.merge_commit_sha ? 'dispatch' : 'superseded';
}

export function validateRepairPlan(kind, plan, changedFiles) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.edits)) return { ok: false, errors: ['repair plan must contain edits'] };
  if (plan.edits.length === 0 || plan.edits.length > 10) errors.push('repair plan must contain 1-10 edits');
  const paths = plan.edits.map((edit) => edit?.path);
  const pathResult = validatePaths(kind, paths, { repair: true });
  errors.push(...pathResult.errors);
  const changed = new Set(changedFiles || []);
  let bytes = 0;
  for (const [index, edit] of plan.edits.entries()) {
    if (!changed.has(edit?.path)) errors.push(`repair may only touch an existing PR diff path: ${edit?.path}`);
    if (typeof edit?.path !== 'string' || !TEXT_FILE_PATTERN.test(edit.path)) errors.push(`repair target must be a text file: ${edit?.path}`);
    if (typeof edit?.content !== 'string') errors.push(`edit ${index} content must be a string`);
    else bytes += Buffer.byteLength(edit.content);
    if (typeof edit?.reason !== 'string' || !edit.reason.trim()) errors.push(`edit ${index} reason is required`);
  }
  if (bytes > (KIND_POLICIES[kind]?.maxRepairBytes ?? 0)) errors.push('repair byte budget exceeded');
  return { ok: errors.length === 0, errors, bytes, paths };
}
