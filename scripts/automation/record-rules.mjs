// Leaf module: the per-file record contracts, with no dependency on policy.mjs.
//
// It lives apart from preflight.mjs so the merge-time guard in policy.mjs can read
// record files without policy -> record-repair -> preflight -> policy becoming an
// import cycle that evaluates these tables before they exist.
import { DRAFT_VALIDATION_CONFIG } from '../news-pilot/draft-validate.mjs';

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
