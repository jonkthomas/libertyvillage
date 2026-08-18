// Auto-heal for generator PR bases that conflict with staging.
//
// Observed stuck mode (PR #75): staging advances into the same region of a
// monolithic slug-keyed data file as an open generator PR, the branch conflicts,
// GitHub freezes refs/pull/N/merge, generator-ci fails its HEAD^2 assertion, and
// block-generator fires with decision "error" before the reviewer or fixer ever
// run. The only conflict shape this heals is the one that actually happens: both
// sides appended new records to the same monolithic array.
//
// The rule is deliberately narrow and fails closed. Our side must be append-only
// against the merge base (every base record byte-identical), so nothing the PR
// authored can be dropped by adopting staging. The healed file is staging's file
// verbatim plus the records this PR appended; anything else — a modification on
// our side, a slug both sides added, a conflict in a non-record file, a file
// outside the kind's allowedPaths — refuses and falls through to block-generator.
import { isRecordFile, readRecordFile, serializeRecords } from './record-repair.mjs';
import { validatePaths } from './policy.mjs';

// Every conflicted path must be a monolithic record file that this kind is
// allowed to touch at all; one stray conflict refuses the whole heal.
export function planBaseHeal(kind, conflictedFiles) {
  const files = Array.isArray(conflictedFiles) ? conflictedFiles : [];
  if (files.length === 0) return { ok: false, errors: ['no merge conflict to heal'], files };
  const errors = [...validatePaths(kind, files).errors];
  for (const file of files) {
    if (!isRecordFile(file)) errors.push(`conflict is not an auto-resolvable record file: ${file}`);
  }
  return { ok: errors.length === 0, errors, files };
}

// Both-appended union: staging's file verbatim, then the records this PR appended.
export function resolveAppendUnion(file, { baseText, oursText, theirsText }) {
  if (!isRecordFile(file)) return { ok: false, errors: [`conflict is not an auto-resolvable record file: ${file}`] };
  const base = readRecordFile(baseText, file, 'base');
  const ours = readRecordFile(oursText, file, 'ours');
  const theirs = readRecordFile(theirsText, file, 'staging');
  if (!base.ok || !ours.ok || !theirs.ok) {
    return { ok: false, errors: [...base.errors, ...ours.errors, ...theirs.errors] };
  }
  const errors = [];
  if (ours.trailingNewline !== theirs.trailingNewline) errors.push(`${file}: sides disagree on the trailing newline`);
  const baseBySlug = new Map(base.records.map((record) => [record.slug, JSON.stringify(record)]));
  const oursBySlug = new Map(ours.records.map((record) => [record.slug, JSON.stringify(record)]));
  const theirsBySlug = new Map(theirs.records.map((record) => [record.slug, JSON.stringify(record)]));
  for (const [slug, text] of baseBySlug) {
    if (oursBySlug.get(slug) !== text) errors.push(`${file}: this PR changed or dropped base record: ${slug}`);
  }
  const appended = ours.records.filter((record) => !baseBySlug.has(record.slug));
  if (appended.length === 0) errors.push(`${file}: this PR appended no new records`);
  for (const record of appended) {
    if (theirsBySlug.has(record.slug)) errors.push(`${file}: staging already added this slug: ${record.slug}`);
  }
  if (errors.length) return { ok: false, errors };

  const merged = [...theirs.records, ...appended];
  const text = serializeRecords(merged, ours.trailingNewline);
  const healed = readRecordFile(text, file, 'healed');
  if (!healed.ok) return { ok: false, errors: healed.errors };
  if (healed.records.length !== merged.length) return { ok: false, errors: [`${file}: healed record count changed`] };
  for (const [index, record] of healed.records.entries()) {
    if (JSON.stringify(record) !== JSON.stringify(merged[index])) {
      return { ok: false, errors: [`${file}: healed record is not byte-identical: ${record.slug}`] };
    }
  }
  return {
    ok: true,
    errors: [],
    text,
    file,
    appendedSlugs: appended.map((record) => record.slug),
    stagingSlugs: theirs.records.filter((record) => !baseBySlug.has(record.slug)).map((record) => record.slug),
  };
}
