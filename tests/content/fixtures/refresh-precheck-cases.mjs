// Fixed candidates for comparing pre-extraction refresh record policy.
const original = {
  slug: 'fitness-review', title: 'Fitness Honest Review Prices Hours 2026',
  description: 'A local fitness review.', content: 'Local intro.\n\n## Details\nOriginal body.',
  publishedAt: '2026-05-01', updatedAt: '2026-05-01', category: 'lifestyle',
  tags: [], answerBlock: 'Local fitness guide.', faqs: [], image: '',
  relatedServices: [], relatedTopics: [], relatedPosts: [], keyTakeaways: [], author: 'LibertyVillage.co',
};
const record = { ...original, description: 'Clearer local fitness review.' };
export const refreshPrecheckCases = [
  ['valid', record],
  ['title-binding', { ...record, title: 'Yoga guide' }],
  ['storage-fields', { ...record, unexpected: 'field', title: 42 }],
  ['storage-size', { ...record, description: 'x'.repeat(200001) }],
  ['link-binding', { ...record, content: '[Guide](/blog/missing)\n\n## Details\nOriginal body.' }],
  ['snippet-body', { ...record, content: record.content + '\nExtra body.' }],
  ['snippet-field', { ...record, faqs: [{ question: 'New?', answer: 'New.' }] }],
  ['coverage', { ...record, roundupCoverage: { version: 1 } }],
  ['missing-binding', record, { refresh: null }],
  ['full', record, { refresh: { mode: 'full', original } }],
  ['business-binding', { ...record, content: 'New Gym is at 500 Test St.\n\n## Details\nOriginal body.' }],
  ['lint', { ...record, content: 'Local Gym is at 999 Wrong St.\n\n## Details\nOriginal body.' }],
  ['warn-lint', { ...record, content: 'Local Gym is at 999 Wrong St.\n\n## Details\nOriginal body.' }, undefined, { lintMode: 'warn' }],
  ['image', record, undefined, { checkImages: () => ['image-missing: fixture'] }],
].map(([name, payload, ctx, deps]) => ({ name,
  item: { dataset: 'posts', key: original.slug, op: 'update', payload },
  ctx: ctx ?? { now: '2026-10-27T12:00:00.000Z', refresh: { mode: 'snippet', original } },
  live: { posts: [original], services: [], topics: [], businesses: [
    { slug: 'local-gym', name: 'Local Gym', address: '100 Test St' },
    { slug: 'new-gym', name: 'New Gym', address: '500 Test St' },
  ] }, deps: { lintMode: 'fail', ...deps },
}));
