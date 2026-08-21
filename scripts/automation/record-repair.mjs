// Per-record repair path for the monolithic slug-keyed data files.
//
// data/posts.json (~810 KB), data/businesses.json (~210 KB) and data/topics.json
// (~220 KB) are single JSON arrays of records keyed by `slug`, so the whole-file
// fixer path cannot fit them inside the fixer input budget. Everything here works
// on individual record objects that the PR appended or modified against its merge
// base: the model only ever sees and emits those records, and the trusted splice
// below rebuilds each file while requiring every other record to stay
// byte-identical.
import { isTextRepairPath, validatePaths } from './policy.mjs';
import { RECORD_REPAIR_RULES, POSTS_FILE, recordRepairRules } from './record-rules.mjs';
import { validateRecordRepair } from './preflight.mjs';

export { POSTS_FILE };
export const RECORD_FILES = Object.freeze(Object.keys(RECORD_REPAIR_RULES));
export const RECORD_REPAIR_PLAN_TYPE = 'record-repair';
export const RECORD_REPAIR_MAX_BYTES = 200_000;
export const MAX_REPAIRED_RECORDS = 25;

export function isRecordFile(file) {
  return RECORD_FILES.includes(file);
}

// Any monolithic record file in the repairable set forces the per-record path;
// remaining repairable files are left untouched by that attempt (fail closed).
export function partitionRepairFiles(repairableFiles) {
  const files = Array.isArray(repairableFiles) ? repairableFiles : [];
  return { recordFiles: files.filter(isRecordFile), otherFiles: files.filter((file) => !isRecordFile(file)) };
}

export function describeRepairContract(file) {
  const rules = recordRepairRules(file);
  const repairable = rules.repairable ? rules.repairable.join(', ') : 'any field that is not immutable';
  return `- ${file} (${rules.label} records): immutable, never change: ${rules.immutable.join(', ')}.`
    + ` Only these fields may be edited: ${repairable}. At least one of them must change.`;
}

export function serializeRecords(records, trailingNewline = true) {
  return `${JSON.stringify(records, null, 2)}${trailingNewline ? '\n' : ''}`;
}

export function readRecordFile(text, file, label) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, errors: [`${label} ${file} is empty`] };
  let records = null;
  try { records = JSON.parse(text); } catch { return { ok: false, errors: [`${label} ${file} must be valid JSON`] }; }
  if (!Array.isArray(records) || records.length === 0) return { ok: false, errors: [`${label} ${file} must be a non-empty JSON array`] };
  const errors = [];
  const slugs = new Set();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) { errors.push(`${label} ${file} record ${index} must be an object`); continue; }
    if (typeof record.slug !== 'string' || record.slug.trim().length === 0) { errors.push(`${label} ${file} record ${index} has no slug`); continue; }
    if (slugs.has(record.slug)) errors.push(`${label} ${file} has a duplicate slug: ${record.slug}`);
    slugs.add(record.slug);
  }
  const trailingNewline = text.endsWith('\n');
  if (errors.length === 0 && serializeRecords(records, trailingNewline) !== text) {
    errors.push(`${label} ${file} is not canonically formatted`);
  }
  return { ok: errors.length === 0, errors, records, trailingNewline };
}

// Appended or modified records, keyed by slug, between the PR merge base and head.
export function diffRecordsBySlug(file, baseText, headText) {
  const base = readRecordFile(baseText, file, 'base');
  const head = readRecordFile(headText, file, 'head');
  if (!base.ok || !head.ok) return { ok: false, errors: [...base.errors, ...head.errors], slugs: [] };
  const baseBySlug = new Map(base.records.map((record) => [record.slug, JSON.stringify(record)]));
  const headSlugs = new Set(head.records.map((record) => record.slug));
  const errors = [];
  for (const slug of baseBySlug.keys()) if (!headSlugs.has(slug)) errors.push(`head ${file} dropped base record: ${slug}`);
  const slugs = head.records.filter((record) => baseBySlug.get(record.slug) !== JSON.stringify(record)).map((record) => record.slug);
  if (slugs.length === 0) errors.push(`no appended or modified records in ${file} between base and head`);
  if (slugs.length > MAX_REPAIRED_RECORDS) errors.push(`changed record budget exceeded for ${file}: ${slugs.length} > ${MAX_REPAIRED_RECORDS}`);
  return {
    ok: errors.length === 0, errors, slugs,
    baseRecords: base.records, headRecords: head.records, trailingNewline: head.trailingNewline,
  };
}

export function buildRecordRepairPlan(plan) {
  return { plan_type: RECORD_REPAIR_PLAN_TYPE, files: plan.files, reason: plan.reason };
}

export function isRecordRepairPlan(plan) {
  return Boolean(plan) && typeof plan === 'object' && plan.plan_type === RECORD_REPAIR_PLAN_TYPE;
}

export function planRecordEntries(plan, file) {
  if (!isRecordRepairPlan(plan) || !Array.isArray(plan.files)) return [];
  const entry = plan.files.find((candidate) => candidate?.file === file);
  return Array.isArray(entry?.records) ? entry.records : [];
}

function applyOneFile(kind, { file, records }, { changedFiles, sources }) {
  const errors = [];
  const fail = () => ({ errors, result: null });
  if (!isRecordFile(file)) { errors.push(`per-record repair does not cover: ${file}`); return fail(); }
  errors.push(...validatePaths(kind, [file], { repair: true }).errors);
  if (!isTextRepairPath(file)) errors.push(`repair target must be a text file: ${file}`);
  if (!Array.isArray(changedFiles) || !changedFiles.includes(file)) errors.push(`repair may only touch an existing PR diff path: ${file}`);
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_REPAIRED_RECORDS) {
    errors.push(`repair plan for ${file} must contain 1-${MAX_REPAIRED_RECORDS} records`);
  }
  const source = sources?.[file];
  if (!source) { errors.push(`missing trusted base/head content for ${file}`); return fail(); }

  const diff = diffRecordsBySlug(file, source.baseText, source.headText);
  if (!diff.ok) { errors.push(...diff.errors); return fail(); }
  const changedSlugs = new Set(diff.slugs);
  const headIndex = new Map(diff.headRecords.map((record, index) => [record.slug, index]));
  const spliced = [...diff.headRecords];
  const repairedSlugs = new Set();
  for (const [index, entry] of (Array.isArray(records) ? records : []).entries()) {
    const slug = entry?.slug;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof slug !== 'string' || slug.length === 0) {
      errors.push(`${file}: repaired entry ${index} must be an object with a slug`);
      continue;
    }
    if (repairedSlugs.has(slug)) { errors.push(`${file}: duplicate repaired slug: ${slug}`); continue; }
    repairedSlugs.add(slug);
    if (!headIndex.has(slug)) { errors.push(`repaired slug is not in head ${file}: ${slug}`); continue; }
    if (!changedSlugs.has(slug)) { errors.push(`${file}: repaired slug was not appended or modified by this PR: ${slug}`); continue; }
    const original = diff.headRecords[headIndex.get(slug)];
    const repaired = entry.record;
    if (!repaired || typeof repaired !== 'object' || Array.isArray(repaired) || repaired.slug !== slug) {
      errors.push(`${file}: repaired record ${slug} must be an object carrying the same slug`);
      continue;
    }
    const check = validateRecordRepair(file, original, repaired, { maxBytes: RECORD_REPAIR_MAX_BYTES });
    if (!check.ok) { errors.push(...check.errors.map((error) => `${file}: ${slug}: ${error}`)); continue; }
    spliced[headIndex.get(slug)] = repaired;
  }
  if (errors.length) return fail();

  const text = serializeRecords(spliced, diff.trailingNewline);
  if (text === source.headText) { errors.push(`repair of ${file} produced no change`); return fail(); }
  const rebuilt = readRecordFile(text, file, 'repaired');
  if (!rebuilt.ok) { errors.push(...rebuilt.errors); return fail(); }
  if (rebuilt.records.length !== diff.headRecords.length) { errors.push(`repair changed the record count in ${file}`); return fail(); }
  for (const [index, record] of rebuilt.records.entries()) {
    if (repairedSlugs.has(record.slug)) continue;
    if (JSON.stringify(record) !== JSON.stringify(diff.headRecords[index])) {
      errors.push(`repair changed an unrelated record in ${file}: ${record.slug}`);
      return fail();
    }
  }
  return { errors, result: { file, text, slugs: [...repairedSlugs], bytes: Buffer.byteLength(text) } };
}

// Validates a record-level plan against the trusted base/head files and returns
// the spliced text per file. Fails closed on anything unexpected; the caller keeps
// the whole-file guards (repairable path, text file, regular file, changed-files).
export function applyRecordRepairPlan(kind, plan, { changedFiles, sources }) {
  const errors = [];
  if (!isRecordRepairPlan(plan) || !Array.isArray(plan.files)) {
    return { ok: false, errors: [`repair plan must be a ${RECORD_REPAIR_PLAN_TYPE} plan with a files array`], results: [] };
  }
  if (Array.isArray(plan.edits)) errors.push('record repair plan must not carry whole-file edits');
  if (typeof plan.reason !== 'string' || plan.reason.trim().length === 0) errors.push('record repair plan reason is required');
  if (plan.files.length === 0 || plan.files.length > RECORD_FILES.length) {
    errors.push(`record repair plan must contain 1-${RECORD_FILES.length} files`);
  }
  const seen = new Set();
  for (const entry of plan.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.file !== 'string') {
      errors.push('each record repair plan entry must be an object with a file');
      continue;
    }
    if (seen.has(entry.file)) errors.push(`duplicate repair plan file: ${entry.file}`);
    seen.add(entry.file);
  }
  if (errors.length) return { ok: false, errors, results: [] };

  const results = [];
  for (const entry of plan.files) {
    const applied = applyOneFile(kind, entry, { changedFiles, sources });
    errors.push(...applied.errors);
    if (applied.result) results.push(applied.result);
  }
  if (errors.length) return { ok: false, errors, results: [] };
  return { ok: true, errors, results, files: results.map((result) => result.file) };
}
