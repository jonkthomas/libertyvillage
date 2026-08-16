import { DRAFT_VALIDATION_CONFIG } from '../news-pilot/draft-validate.mjs';
import { MAX_REPAIRS } from './constants.mjs';
import { canRepair, evaluateVerdict } from './policy.mjs';

export const IMMUTABLE_POST_FIELDS = Object.freeze([
  'slug', 'publishedAt', 'updatedAt', 'category', 'image', 'author',
]);

export const REPAIRABLE_POST_FIELDS = Object.freeze([
  'title', 'description', 'content', 'answerBlock', 'faqs', 'keyTakeaways',
  'tags', 'relatedServices', 'relatedTopics', 'relatedPosts',
]);

export const POSTS_FILE = 'data/posts.json';

// Single source of truth for what an autonomous repair may touch inside each
// monolithic slug-keyed data file. validateRecordRepair enforces it and the
// fixer prompt is rendered from it, so the model is told exactly what the
// validation will reject instead of discovering it through a failed plan.
export const RECORD_REPAIR_RULES = Object.freeze({
  [POSTS_FILE]: Object.freeze({
    label: 'post',
    immutable: IMMUTABLE_POST_FIELDS,
    repairable: REPAIRABLE_POST_FIELDS,
    requiredFields: Object.freeze([...DRAFT_VALIDATION_CONFIG.requiredPostFields]),
  }),
  'data/businesses.json': Object.freeze({
    label: 'business',
    immutable: Object.freeze([
      'slug', 'name', 'address', 'phone', 'website', 'image', 'rating', 'reviewCount',
      'hours', 'priceRange', 'category', 'subcategory', 'categories', 'featured', '_discoveredAt',
    ]),
    repairable: Object.freeze(['description', 'answerBlock', 'proTip', 'tags', 'bestFor']),
    requiredFields: Object.freeze([]),
  }),
  'data/topics.json': Object.freeze({
    label: 'topic',
    immutable: Object.freeze(['slug', 'category', 'image', 'publishedAt', 'updatedAt', 'lastUpdated']),
    repairable: Object.freeze([
      'title', 'description', 'content', 'quickTips', 'faqs', 'relatedTopics',
      'relatedServices', 'answerSummary', 'keyTakeaways', 'definitions',
    ]),
    requiredFields: Object.freeze([]),
  }),
});

// Files without an explicit contract still fail closed: the slug is immutable,
// the top-level key set is frozen, and only appended/modified records may change.
const DEFAULT_RECORD_RULES = Object.freeze({
  label: 'record', immutable: Object.freeze(['slug']), repairable: null, requiredFields: Object.freeze([]),
});

export function recordRepairRules(file) {
  return RECORD_REPAIR_RULES[file] || DEFAULT_RECORD_RULES;
}

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

export function preflightDecision({ verdict, contentSha, attempts, maxRepairs = MAX_REPAIRS }) {
  const decision = evaluateVerdict(verdict, contentSha);
  if (!decision.ok) return 'block';
  if (decision.passed) return 'go';
  return attempts < maxRepairs && canRepair(attempts) ? 'repair' : 'block';
}
