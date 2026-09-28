import { createHash } from 'node:crypto';
import datasets from '../../lib/content/datasets.json' with { type: 'json' };

export const ALL = Object.freeze(Object.keys(datasets));
export const SITE_DATASETS = Object.freeze(ALL.filter((d) => d !== 'discovery-seen'));
export const registry = datasets;
export const hash = (algorithm, value) => createHash(algorithm).update(value).digest('hex');
export const recordSha = (record) => hash('sha256', JSON.stringify(record));
export const blobSha1 = (text) => hash('sha1', Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(text)}\0`), Buffer.from(text)]));
export function keyOf(dataset, record) {
  if (dataset === 'guide-hub') return 'guide-hub';
  if (dataset === 'discovery-seen') return record.nameKey;
  return record[dataset === 'topic-queue' ? 'key' : 'slug'];
}
export function fromFile(dataset, value) {
  if (dataset === 'guide-hub') return [value];
  if (dataset === 'topic-queue') return value.topics;
  if (dataset === 'discovery-seen') return Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([nameKey, firstSeen]) => ({ nameKey, firstSeen }));
  return value;
}
export function toFile(dataset, records) {
  if (dataset === 'guide-hub') return records[0] ?? null;
  if (dataset === 'topic-queue') return { version: 1, topics: records };
  if (dataset === 'discovery-seen') return Object.fromEntries([...records].sort((a, b) => a.nameKey.localeCompare(b.nameKey)).map((r) => [r.nameKey, r.firstSeen]));
  return records;
}
export const serialize = (dataset, records) => `${JSON.stringify(toFile(dataset, records), null, 2)}\n`;
export function datasetDigest(dataset, records) {
  return hash('sha256', dataset === 'discovery-seen'
    ? [...records].sort((a, b) => a.nameKey.localeCompare(b.nameKey)).map((r) => `${r.nameKey}:${r.firstSeen}`).join('\n')
    : records.map((r) => `${keyOf(dataset, r)}:${recordSha(r)}`).join('\n'));
}
export function candidateDigest(items) {
  return hash('sha256', [...items].sort((a, b) => `${a.dataset}\t${a.key}`.localeCompare(`${b.dataset}\t${b.key}`))
    .map((i) => `${i.dataset}\t${i.key}\t${i.rev}\t${i.payload_sha256}`).join('\n'));
}
