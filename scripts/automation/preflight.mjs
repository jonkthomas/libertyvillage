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

export function validatePostRepair(original, repaired, { maxBytes = 60_000 } = {}) {
  const errors = [];
  if (!original || typeof original !== 'object' || Array.isArray(original)
      || !repaired || typeof repaired !== 'object' || Array.isArray(repaired)) {
    return { ok: false, errors: ['original and repaired post must be objects'], changedFields: [] };
  }
  const originalKeys = Object.keys(original).sort();
  const repairedKeys = Object.keys(repaired).sort();
  if (originalKeys.join('\0') !== repairedKeys.join('\0')) errors.push('repair must preserve the exact top-level key set');
  for (const field of DRAFT_VALIDATION_CONFIG.requiredPostFields) {
    if (!Object.hasOwn(original, field)) errors.push(`original post is missing required field: ${field}`);
  }
  for (const field of IMMUTABLE_POST_FIELDS) {
    if (JSON.stringify(original[field]) !== JSON.stringify(repaired[field])) errors.push(`immutable field changed: ${field}`);
  }
  const changedFields = originalKeys.filter((field) => JSON.stringify(original[field]) !== JSON.stringify(repaired[field]));
  if (!changedFields.some((field) => REPAIRABLE_POST_FIELDS.includes(field))) errors.push('repair must change at least one repairable field');
  for (const field of changedFields) {
    if (!REPAIRABLE_POST_FIELDS.includes(field)) errors.push(`non-repairable field changed: ${field}`);
  }
  if (Buffer.byteLength(JSON.stringify(repaired)) > maxBytes) errors.push('repaired post byte budget exceeded');
  return { ok: errors.length === 0, errors, changedFields };
}

export function preflightDecision({ verdict, contentSha, attempts, maxRepairs = MAX_REPAIRS }) {
  const decision = evaluateVerdict(verdict, contentSha);
  if (!decision.ok) return 'block';
  if (decision.passed) return 'go';
  return attempts < maxRepairs && canRepair(attempts) ? 'repair' : 'block';
}
