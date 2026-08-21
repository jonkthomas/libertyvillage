import { BLOCKING_SEVERITIES, KIND_POLICIES, MAX_REPAIRS } from './constants.mjs';
import { POSTS_FILE, recordRepairRules } from './record-rules.mjs';
import { canRepair, evaluateVerdict, validatePaths } from './policy.mjs';

export {
  IMMUTABLE_POST_FIELDS, REPAIRABLE_POST_FIELDS, POSTS_FILE, RECORD_REPAIR_RULES, recordRepairRules,
} from './record-rules.mjs';

function parsePosts(text, label, errors) {
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value)) errors.push(`${label} must be a JSON array`);
    return Array.isArray(value) ? value : null;
  } catch {
    errors.push(`${label} must be valid JSON`);
    return null;
  }
}

export function assertAppendOnlyPostsChange(baselineText, candidateText, slug) {
  const errors = [];
  const baseline = parsePosts(baselineText, 'baseline', errors);
  const candidate = parsePosts(candidateText, 'candidate', errors);
  if (!baseline || !candidate) return { ok: false, errors };
  if (candidate.length !== baseline.length + 1) errors.push('candidate must append exactly one post');
  const common = Math.min(baseline.length, candidate.length);
  for (let index = 0; index < common; index += 1) {
    if (JSON.stringify(candidate[index]) !== JSON.stringify(baseline[index])) {
      errors.push(`baseline post ${index} was changed`);
    }
  }
  if (candidate[baseline.length]?.slug !== slug) errors.push('appended post slug does not match');
  return { ok: errors.length === 0, errors, baseline, candidate, post: candidate[baseline.length] };
}

export function validateRecordRepair(file, original, repaired, { maxBytes = 60_000 } = {}) {
  const rules = recordRepairRules(file);
  const errors = [];
  if (!original || typeof original !== 'object' || Array.isArray(original)
      || !repaired || typeof repaired !== 'object' || Array.isArray(repaired)) {
    return { ok: false, errors: [`original and repaired ${rules.label} must be objects`], changedFields: [] };
  }
  const originalKeys = Object.keys(original).sort();
  const repairedKeys = Object.keys(repaired).sort();
  if (originalKeys.join('\0') !== repairedKeys.join('\0')) errors.push('repair must preserve the exact top-level key set');
  for (const field of rules.requiredFields) {
    if (!Object.hasOwn(original, field)) errors.push(`original ${rules.label} is missing required field: ${field}`);
  }
  for (const field of rules.immutable) {
    if (JSON.stringify(original[field]) !== JSON.stringify(repaired[field])) errors.push(`immutable field changed: ${field}`);
  }
  const changedFields = originalKeys.filter((field) => JSON.stringify(original[field]) !== JSON.stringify(repaired[field]));
  const isRepairable = (field) => (rules.repairable ? rules.repairable.includes(field) : !rules.immutable.includes(field));
  if (!changedFields.some(isRepairable)) errors.push('repair must change at least one repairable field');
  for (const field of changedFields) {
    if (!isRepairable(field)) errors.push(`non-repairable field changed: ${field}`);
  }
  if (Buffer.byteLength(JSON.stringify(repaired)) > maxBytes) errors.push(`repaired ${rules.label} byte budget exceeded`);
  return { ok: errors.length === 0, errors, changedFields };
}

export function validatePostRepair(original, repaired, options = {}) {
  return validateRecordRepair(POSTS_FILE, original, repaired, options);
}

// F5. A finding is structurally unrepairable when no fixer run could ever clear
// it: it sits on a path this generator cannot repair, on a file that is not in the
// PR diff at all, or it is an identity/immutable-field error that the record
// contract forbids touching. Everything else is repairable — when in doubt the
// classifier biases towards attempting the repair (PRD 2c).
const STRUCTURAL_NOTE_PATTERNS = Object.freeze([
  /\bimmutable\b/i,
  /\bduplicat\w*\b[\s\S]{0,40}\bslug\b/i,
  /\bslug\b[\s\S]{0,40}\bduplicat/i,
  /\bslug\b[\s\S]{0,40}\b(?:collides|conflicts|already exists|is taken)\b/i,
]);

function repairableKinds(kind) {
  if (kind && KIND_POLICIES[kind]) return [kind];
  // No kind in hand (the news content path): a path is repairable only if some
  // generator could repair it. Nothing can repair what nothing declares.
  return Object.keys(KIND_POLICIES).filter((name) => name !== 'promotion');
}

function isRepairablePath(kind, file) {
  if (typeof file !== 'string' || file.length === 0) return false;
  return repairableKinds(kind).some((name) => validatePaths(name, [file], { repair: true }).ok);
}

export function classifyFindings(kind, verdict, { changedFiles } = {}) {
  const findings = Array.isArray(verdict?.findings) ? verdict.findings : [];
  const blocking = findings.filter((finding) => BLOCKING_SEVERITIES.includes(finding?.severity));
  const considered = blocking.length > 0 ? blocking : findings;
  const inDiff = Array.isArray(changedFiles) ? new Set(changedFiles) : null;

  const repairable = [];
  const unrepairable = [];
  for (const finding of considered) {
    const path = finding?.path;
    const structural = typeof finding?.note === 'string'
      && STRUCTURAL_NOTE_PATTERNS.some((pattern) => pattern.test(finding.note));
    const reachable = isRepairablePath(kind, path) && (!inDiff || inDiff.has(path));
    (reachable && !structural ? repairable : unrepairable).push(finding);
  }
  return {
    repairable,
    unrepairable,
    allUnrepairable: unrepairable.length > 0 && repairable.length === 0,
  };
}

export function preflightDecision({ verdict, contentSha, attempts, maxRepairs = MAX_REPAIRS, kind, changedFiles }) {
  const decision = evaluateVerdict(verdict, contentSha);
  if (!decision.ok) return 'block';
  if (decision.passed) return 'go';
  // Short-circuit a foregone conclusion before it costs 3 rounds x 4 fixer plans.
  if (classifyFindings(kind, verdict, { changedFiles }).allUnrepairable) return 'unrepairable';
  return attempts < maxRepairs && canRepair(attempts) ? 'repair' : 'block';
}
