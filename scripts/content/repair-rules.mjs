// Per-dataset fixer contracts for the content-store gate (§4.7).
//
// Re-checked against lib/types.ts (and the live data key sets) at 9b23de5:
// - posts/businesses/topics: exactly the legacy RECORD_REPAIR_RULES objects (not copied, not weakened).
// - services: Service has slug, name, pluralName, icon, image, searchVolume, competitiveness
//   (all immutable); description, relatedServices, answerBlock, definition, specificFaqs,
//   comparisonTable, keyTakeaways, proTips, neighbourhoodContext, sections are the rest.
// - buildings: Building has slug, name, alternateNames, address, postalCode, latitude, longitude,
//   yearBuilt, units, image (all immutable); every other field is repairable, per the spec table.
// - neighborhoods: Neighborhood has slug, name, image and the nine numeric stats listed below
//   (all immutable); vibe, bestFor, pros, cons, keyDifference, verdict, detailedComparison,
//   faqs, answerBlock are the rest.
// - guide-hub: GuideHub has population, medianRent, walkScore, transitScore (immutable) and
//   boundaries, history, prosCons, quickFacts, answerSummary (repairable); it has no slug, its
//   identity is the singleton key.
// - topic-queue: no fixer.
import { describeRepairContract, RECORD_REPAIR_MAX_BYTES } from '../automation/record-repair.mjs';
import { RECORD_REPAIR_RULES } from '../automation/record-rules.mjs';
import { validateRecordRepair } from '../automation/preflight.mjs';

export const LEGACY_REPAIR_DATASETS = Object.freeze(['posts', 'businesses', 'topics']);

const rules = (label, immutable, repairable = null) => Object.freeze({
  label, immutable: Object.freeze(immutable), repairable: repairable && Object.freeze(repairable),
  requiredFields: Object.freeze([]),
});

export const CONTENT_REPAIR_RULES = Object.freeze({
  'data/posts.json': RECORD_REPAIR_RULES['data/posts.json'],
  'data/businesses.json': RECORD_REPAIR_RULES['data/businesses.json'],
  'data/topics.json': RECORD_REPAIR_RULES['data/topics.json'],
  'data/services.json': rules('service', [
    'slug', 'name', 'pluralName', 'icon', 'image', 'searchVolume', 'competitiveness',
  ]),
  'data/buildings.json': rules('building', [
    'slug', 'name', 'alternateNames', 'address', 'postalCode', 'latitude', 'longitude', 'yearBuilt', 'units', 'image',
  ]),
  'data/neighborhoods.json': rules('neighbourhood', [
    'slug', 'name', 'image',
    'avgRent1BR', 'avgRent2BR', 'transitScore', 'walkScore', 'bikeScore', 'population', 'medianAge', 'medianIncome', 'distanceFromLV',
  ]),
  'data/guide-hub.json': rules('guide hub', ['population', 'medianRent', 'walkScore', 'transitScore'], [
    'boundaries', 'history', 'prosCons', 'quickFacts', 'answerSummary',
  ]),
});

// topic-queue (and discovery-seen) have no fixer: nothing may repair them.
export const NO_FIXER_DATASETS = Object.freeze(['topic-queue', 'discovery-seen']);

export const fileOf = (dataset) => `data/${dataset}.json`;

export function datasetOfFile(file) {
  const match = /^data\/([a-z-]+)\.json$/.exec(typeof file === 'string' ? file : '');
  return match ? match[1] : null;
}

export function contentRepairRules(dataset) {
  return CONTENT_REPAIR_RULES[fileOf(dataset)] || null;
}

// Mirrors describeRepairContract for the row-keyed plan; the legacy three render
// their contract through the legacy describer so the rules text cannot drift.
export function describeRowContract(file) {
  const dataset = datasetOfFile(file);
  const key = dataset === 'guide-hub' ? 'the key "guide-hub"' : 'its unchanged slug as key';
  if (LEGACY_REPAIR_DATASETS.includes(dataset)) return `${describeRepairContract(file)} Entries carry ${key}.`;
  const contract = contentRepairRules(dataset);
  if (!contract) return `- ${file}: no repair is permitted.`;
  const repairable = contract.repairable ? contract.repairable.join(', ') : 'any field that is not immutable';
  return `- ${file} (${contract.label} records): immutable, never change: ${contract.immutable.join(', ')}.`
    + ` Only these fields may be edited: ${repairable}. At least one of them must change. Entries carry ${key}.`;
}

// validateRecordRepair's algorithm over CONTENT_REPAIR_RULES. The legacy three
// delegate to validateRecordRepair itself, which keeps the posts premise check.
export function validateRowRepair(dataset, original, repaired, { maxBytes = RECORD_REPAIR_MAX_BYTES } = {}) {
  if (LEGACY_REPAIR_DATASETS.includes(dataset)) {
    return validateRecordRepair(fileOf(dataset), original, repaired, { maxBytes });
  }
  const contract = contentRepairRules(dataset);
  if (!contract) return { ok: false, errors: [`${dataset} has no fixer`], changedFields: [] };
  const errors = [];
  if (!original || typeof original !== 'object' || Array.isArray(original)
      || !repaired || typeof repaired !== 'object' || Array.isArray(repaired)) {
    return { ok: false, errors: [`original and repaired ${contract.label} must be objects`], changedFields: [] };
  }
  const originalKeys = Object.keys(original).sort();
  const repairedKeys = Object.keys(repaired).sort();
  if (originalKeys.join('\0') !== repairedKeys.join('\0')) errors.push('repair must preserve the exact top-level key set');
  for (const field of contract.immutable) {
    if (JSON.stringify(original[field]) !== JSON.stringify(repaired[field])) errors.push(`immutable field changed: ${field}`);
  }
  const changedFields = originalKeys.filter((field) => JSON.stringify(original[field]) !== JSON.stringify(repaired[field]));
  const isRepairable = (field) => (contract.repairable ? contract.repairable.includes(field) : !contract.immutable.includes(field));
  if (!changedFields.some(isRepairable)) errors.push('repair must change at least one repairable field');
  for (const field of changedFields) {
    if (!isRepairable(field)) errors.push(`non-repairable field changed: ${field}`);
  }
  if (Buffer.byteLength(JSON.stringify(repaired)) > maxBytes) errors.push(`repaired ${contract.label} byte budget exceeded`);
  return { ok: errors.length === 0, errors, changedFields };
}
