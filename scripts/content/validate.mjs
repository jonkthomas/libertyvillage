import { topicKey } from '../automation/topic-queue.mjs';
import { registry } from './canonical.mjs';

export const SECRET_FINGERPRINT = /(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----)/i;
const fields = {
  businesses: 'slug name category subcategory address description rating reviewCount priceRange hours phone website tags categories featured proTip image answerBlock bestFor reviewExcerpt reviewFaqs _discoveredAt _needsEnrichment',
  posts: 'slug title description content publishedAt updatedAt category tags answerBlock faqs image relatedServices relatedTopics relatedPosts keyTakeaways author crossLinks exploreCta canonicalUrl',
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
const objectFields = new Set('exploreCta verdict detailedComparison comparisonTable prosCons'.split(' '));
export function validateRecord(dataset, key, record) {
  const errors = [];
  if (!registry[dataset] || dataset === 'discovery-seen') return { ok: false, errors: ['unknown dataset'] };
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, errors: ['record must be an object'] };
  if (Buffer.byteLength(JSON.stringify(record)) > 200_000) errors.push('record exceeds 200 KB');
  if (SECRET_FINGERPRINT.test(JSON.stringify(record))) errors.push('credential fingerprint');
  if (dataset === 'guide-hub' ? key !== 'guide-hub' || 'slug' in record : dataset === 'topic-queue'
    ? record.key !== key || !['blog', 'seo'].includes(record.kind) || topicKey(record.kind, record.title, record.branchPrefix) !== key
    : record.slug !== key) errors.push('identity mismatch');
  const allowed = new Set(fields[dataset].split(' '));
  for (const field of Object.keys(record)) if (!allowed.has(field)) errors.push(`unknown field: ${field}`);
  for (const field of required[dataset].split(' ')) if (record[field] === undefined || record[field] === null) errors.push(`required: ${field}`);
  for (const [field, value] of Object.entries(record)) {
    const type = field === 'population' && dataset === 'guide-hub' ? 'string' : numberFields.has(field) ? 'number' : booleanFields.has(field) ? 'boolean' : arrayFields.has(field) ? 'array' : objectFields.has(field) ? 'object' : 'string';
    if (type === 'array' ? !Array.isArray(value) : type === 'object' ? !value || typeof value !== 'object' || Array.isArray(value) : typeof value !== type) errors.push(`invalid type: ${field}`);
  }
  return { ok: errors.length === 0, errors };
}
