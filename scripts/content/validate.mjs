import { topicKey } from '../automation/topic-queue.mjs';
import { registry } from './canonical.mjs';

export const SECRET_FINGERPRINT = /(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----)/i;
const fields = {
  businesses: 'slug name category subcategory address description rating reviewCount priceRange hours phone website tags categories featured proTip image answerBlock bestFor reviewExcerpt reviewFaqs _discoveredAt _needsEnrichment',
  posts: 'slug title description content publishedAt updatedAt category tags answerBlock faqs image relatedServices relatedTopics relatedPosts keyTakeaways author crossLinks exploreCta canonicalUrl roundupCoverage',
  buildings: 'slug name alternateNames address postalCode latitude longitude yearBuilt units floors buildingType developer avgRent1BR avgRent2BR avgPricePerSqft maintenanceFeePerSqft walkScore transitScore bikeScore nearestTTC amenities hasParking hasLockers petFriendly nearestBusinessSlugs description answerBlock keyTakeaways proTips pros cons specificFaqs tags image metaTitle metaDescription',
  neighborhoods: 'slug name avgRent1BR avgRent2BR transitScore walkScore bikeScore population medianAge medianIncome vibe bestFor pros cons distanceFromLV keyDifference verdict detailedComparison faqs image answerBlock',
  services: 'slug name pluralName description icon relatedServices searchVolume competitiveness image answerBlock definition specificFaqs comparisonTable keyTakeaways proTips neighbourhoodContext sections',
  topics: 'slug title description category content quickTips faqs relatedTopics relatedServices image answerSummary keyTakeaways definitions publishedAt updatedAt lastUpdated',
  'guide-hub': 'population medianRent walkScore transitScore boundaries history prosCons quickFacts answerSummary',
  'topic-queue': 'key kind title source rationale addedAt attempts branchPrefix',
};
const required = {
  businesses: 'slug name category address description rating reviewCount hours phone website tags featured proTip',
  posts: 'slug title description content publishedAt updatedAt category tags answerBlock faqs relatedServices relatedTopics relatedPosts keyTakeaways author',
  buildings: 'slug name alternateNames address postalCode latitude longitude yearBuilt units floors buildingType avgRent1BR avgRent2BR avgPricePerSqft walkScore transitScore bikeScore nearestTTC amenities hasParking hasLockers petFriendly nearestBusinessSlugs description answerBlock keyTakeaways proTips pros cons specificFaqs tags',
  neighborhoods: 'slug name avgRent1BR avgRent2BR transitScore walkScore bikeScore population medianAge medianIncome vibe bestFor pros cons distanceFromLV keyDifference verdict detailedComparison faqs',
  services: 'slug name pluralName description icon relatedServices searchVolume competitiveness',
  topics: 'slug title description category content quickTips faqs relatedTopics relatedServices',
  'guide-hub': 'population medianRent walkScore transitScore boundaries history prosCons quickFacts answerSummary',
  'topic-queue': 'key kind title source rationale addedAt attempts branchPrefix',
};
const numberFields = new Set('rating reviewCount avgRent1BR avgRent2BR transitScore walkScore bikeScore population medianAge medianIncome distanceFromLV latitude longitude yearBuilt units floors avgPricePerSqft maintenanceFeePerSqft attempts'.split(' '));
const booleanFields = new Set('featured hasParking hasLockers petFriendly _needsEnrichment'.split(' '));
const arrayFields = new Set('tags categories bestFor reviewFaqs faqs relatedServices relatedTopics relatedPosts keyTakeaways crossLinks alternateNames amenities nearestBusinessSlugs proTips pros cons specificFaqs quickTips definitions sections quickFacts'.split(' '));
const objectFields = new Set('exploreCta verdict detailedComparison comparisonTable prosCons roundupCoverage'.split(' '));
const stringArrays = new Set('tags categories bestFor relatedServices relatedTopics keyTakeaways alternateNames amenities nearestBusinessSlugs proTips pros cons quickTips'.split(' '));
const faqArrays = new Set('faqs reviewFaqs specificFaqs'.split(' '));
const enums = {
  services: {searchVolume:['high','medium','low'],competitiveness:['easy','medium','hard','low']},
  topics: {category:['living','transit','lifestyle','safety','real-estate','pets','food']},
  posts: {category:['news','development','food-drink','events','transit','real-estate','lifestyle','community']},
  buildings: {buildingType:['loft','condo','rental','townhouse','mixed']},
  businesses: {priceRange:['$','$$','$$$','$$$$']},
  'topic-queue': {kind:['blog','seo']},
};
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function objectShape(value, spec) {
  return plainObject(value) && Object.keys(value).every((field) => field in spec && spec[field](value[field]))
    && Object.keys(spec).every((field) => field in value);
}
const str = (value) => typeof value === 'string' && value.isWellFormed();
const strArray = (value) => Array.isArray(value) && value.every(str);
const faq = (value) => objectShape(value,{question:str,answer:str});
function checkWellFormed(value, path, errors) {
  if (typeof value === 'string') {
    if (!value.isWellFormed()) errors.push(`non-well-formed string: ${path}`);
  } else if (Array.isArray(value)) value.forEach((item, index) => checkWellFormed(item, `${path}[${index}]`, errors));
  else if (plainObject(value)) for (const [field, item] of Object.entries(value)) checkWellFormed(item, `${path}.${field}`, errors);
}
// Roundup-only trusted coverage metadata (docs/specs/weekly-roundup-v2.md §6.6).
// Allowed, never required, and valid only on a category:'news' post whose slug is
// the weekly roundup slug. Keys are never truncated: more than 64 is invalid.
export const ROUNDUP_SLUG = /^liberty-village-news-week-(\d{4})-w(\d{2})$/;
export const ROUNDUP_COVERAGE_MAX_KEYS = 64;
export const ROUNDUP_COVERAGE_MAX_KEY_CHARS = 200;
export function roundupCoverageErrors(post) {
  const coverage = post?.roundupCoverage;
  const slug = ROUNDUP_SLUG.exec(typeof post?.slug === 'string' ? post.slug : '');
  if (!slug || post?.category !== 'news') return ['roundupCoverage is only valid on a weekly roundup news post'];
  if (!plainObject(coverage) || Object.keys(coverage).some((field) => !['version', 'isoWeek', 'planningCutoff', 'keys'].includes(field)))
    return ['invalid roundupCoverage'];
  const errors = [];
  if (coverage.version !== 1) errors.push('roundupCoverage version must be 1');
  if (coverage.isoWeek !== `${slug[1]}-W${slug[2]}`) errors.push('roundupCoverage isoWeek must match the slug');
  const cutoff = typeof coverage.planningCutoff === 'string' ? Date.parse(coverage.planningCutoff) : NaN;
  if (!Number.isFinite(cutoff) || new Date(cutoff).toISOString() !== coverage.planningCutoff) errors.push('roundupCoverage planningCutoff must be an ISO instant');
  if (!Array.isArray(coverage.keys) || coverage.keys.some((entry) => !str(entry) || !entry || entry.length > ROUNDUP_COVERAGE_MAX_KEY_CHARS))
    errors.push(`roundupCoverage keys must be non-empty strings of at most ${ROUNDUP_COVERAGE_MAX_KEY_CHARS} chars`);
  else if (coverage.keys.length > ROUNDUP_COVERAGE_MAX_KEYS) errors.push(`roundupCoverage has more than ${ROUNDUP_COVERAGE_MAX_KEYS} keys`);
  return errors;
}
export function validateRecord(dataset, key, record) {
  const errors = [];
  if (!registry[dataset] || dataset === 'discovery-seen') return { ok: false, errors: ['unknown dataset'] };
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, errors: ['record must be an object'] };
  checkWellFormed(record, 'record', errors);
  const marker = registry[dataset].marker;
  if (marker && (typeof record[marker] !== 'string' || !record[marker].trim())) errors.push(`empty smoke marker: ${marker}`);
  if (Buffer.byteLength(JSON.stringify(record)) > 200_000) errors.push('record exceeds 200 KB');
  if (SECRET_FINGERPRINT.test(JSON.stringify(record))) errors.push('credential fingerprint');
  if (dataset === 'guide-hub' ? key !== 'guide-hub' || 'slug' in record : dataset === 'topic-queue'
    ? record.key !== key || !['blog', 'seo'].includes(record.kind) || topicKey(record.kind, record.title, record.branchPrefix) !== key
    : record.slug !== key) errors.push('identity mismatch');
  if (dataset === 'topic-queue' ? !/^[0-9a-f]{64}$/.test(key) : dataset !== 'guide-hub' && !/^[a-z0-9][a-z0-9-]{0,127}$/.test(key)) errors.push('invalid key shape');
  const allowed = new Set(fields[dataset].split(' '));
  for (const field of Object.keys(record)) if (!allowed.has(field)) errors.push(`unknown field: ${field}`);
  for (const field of required[dataset].split(' ')) if (record[field] === undefined || record[field] === null) errors.push(`required: ${field}`);
  for (const [field, value] of Object.entries(record)) {
    const type = field === 'population' && dataset === 'guide-hub' ? 'string' : numberFields.has(field) ? 'number' : booleanFields.has(field) ? 'boolean' : arrayFields.has(field) ? 'array' : objectFields.has(field) ? 'object' : 'string';
    if (type === 'array' ? !Array.isArray(value) : type === 'object' ? !value || typeof value !== 'object' || Array.isArray(value) : typeof value !== type) errors.push(`invalid type: ${field}`);
    if (enums[dataset]?.[field] && !(field === 'priceRange' && value === '') && !enums[dataset][field].includes(value)) errors.push(`invalid enum: ${field}`);
    if (stringArrays.has(field) && !strArray(value)) errors.push(`invalid string array: ${field}`);
    if (faqArrays.has(field) && (!Array.isArray(value) || !value.every(faq))) errors.push(`invalid FAQ array: ${field}`);
  }
  if (record.crossLinks && (!Array.isArray(record.crossLinks) || !record.crossLinks.every((link) => plainObject(link)
    && ['service','guide','post','topic'].includes(link.type) && str(link.slug) && (link.label === undefined || str(link.label))
    && Object.keys(link).every((field) => ['type','slug','label'].includes(field))))) errors.push('invalid crossLinks');
  if (record.relatedPosts && (!Array.isArray(record.relatedPosts) || !record.relatedPosts.every((item) => str(item) || objectShape(item,{href:str,description:str})))) errors.push('invalid relatedPosts');
  if (record.exploreCta && !objectShape(record.exploreCta,{label:str,href:str,description:str})) errors.push('invalid exploreCta');
  if (record.verdict && !objectShape(record.verdict,{summary:str,lvWinsAt:strArray,theyWinAt:strArray})) errors.push('invalid verdict');
  if (record.detailedComparison && !objectShape(record.detailedComparison,{costOfLiving:str,transitAndCommute:str,foodAndNightlife:str,safetyAndCommunity:str,bestFor:str})) errors.push('invalid detailedComparison');
  if (record.prosCons && !objectShape(record.prosCons,{pros:strArray,cons:strArray})) errors.push('invalid prosCons');
  if (record.quickFacts && (!Array.isArray(record.quickFacts) || !record.quickFacts.every((fact) => objectShape(fact,{label:str,value:str})))) errors.push('invalid quickFacts');
  if (record.sections && (!Array.isArray(record.sections) || !record.sections.every((section) => objectShape(section,{heading:str,content:str})))) errors.push('invalid sections');
  if (record.definitions && (!Array.isArray(record.definitions) || !record.definitions.every((definition) => objectShape(definition,{term:str,definition:str})))) errors.push('invalid definitions');
  if (record.comparisonTable && (!plainObject(record.comparisonTable) || !strArray(record.comparisonTable.columns)
    || !Array.isArray(record.comparisonTable.rows) || !record.comparisonTable.rows.every((row) => plainObject(row) && Object.values(row).every(str))
    || Object.keys(record.comparisonTable).some((field) => !['columns','rows'].includes(field)))) errors.push('invalid comparisonTable');
  if (dataset === 'posts' && Object.hasOwn(record, 'roundupCoverage')) errors.push(...roundupCoverageErrors(record));
  if (dataset === 'topic-queue' && (!Number.isInteger(record.attempts) || record.attempts < 0)) errors.push('invalid attempts');
  return { ok: errors.length === 0, errors };
}
