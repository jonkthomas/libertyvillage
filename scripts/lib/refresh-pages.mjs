// Dataset-backed refresh fields. Computed metadata never authorizes editing
// business identity/facts, taxonomy or application code.
import { splitIntro } from './refresh-lint.mjs';
export const REFRESH_PAGES = Object.freeze({
  posts: { kind: 'blog', title: 'title', fields: ['title', 'description', 'content', 'updatedAt'], intro: 'content' },
  topics: { kind: 'guide', title: 'title', fields: ['title', 'description', 'content', 'updatedAt'], intro: 'content' },
  services: { kind: 'best', title: 'pluralName', fields: ['description'], intro: 'description' },
  businesses: { kind: 'directory', title: 'name', fields: ['description'], intro: 'description' },
});
export function refreshPage(dataset = 'posts') {
  if (!Object.hasOwn(REFRESH_PAGES, dataset)) throw new Error(`unknown refresh dataset: ${dataset}`);
  return REFRESH_PAGES[dataset];
}
export const refreshKey = (dataset, slug) => `${dataset}:${slug}`;
// Binding uses the real dataset title, with the existing half-keyword ratio.
export function refreshBindingRecord(record, dataset = 'posts') {
  const page = refreshPage(dataset);
  if (!record || typeof record !== 'object') return record;
  return { ...record, title: record?.[page.title],
    ...(page.intro === 'description' ? { content: record?.description } : {}) };
}
export function refreshClaimRecord(record, mode, dataset = 'posts') {
  const bound = refreshBindingRecord(record, dataset);
  if (mode !== 'snippet') return bound;
  return { slug: record?.slug, publishedAt: record?.publishedAt, title: bound.title,
    description: pageDescription(record, dataset), content: splitIntro(bound.content).intro };
}
function pageDescription(record, dataset) {
  // Directory description is body copy, not its computed meta description.
  // Only its intro is writable; immutable paragraphs must not be re-linted.
  return ['businesses', 'services'].includes(dataset) ? splitIntro(record?.description).intro : record?.description;
}
