// Runner-safe failure identifiers. Never carry claims, prose, URLs or errors.
const CODES = new Set([
  'unrecorded-business', 'unsupported-address', 'unsupported-price', 'unsupported-hours',
  'unsupported-date', 'unsupported-operational-premise', 'missing-draft',
  'no-attributed-business', 'business-outside-pack', 'draft-changed-topic',
  'draft-dropped-premise', 'invalid-relatedPosts', 'invalid-relatedServices',
  'invalid-relatedTopics', 'invalid-relatedBusinesses', 'invalid-internal-link',
]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/;
const FIELD = /^(?:slug|title|description|content|answerBlock|relatedPosts|relatedServices|relatedTopics|relatedBusinesses|faqs\[\d{1,3}\]\.(?:question|answer)|keyTakeaways\[\d{1,3}\]|relatedBusinesses\[\d{1,3}\])$/;
export function refreshFailureDetail(failures) {
  if (!Array.isArray(failures)) return null;
  const safe = failures.filter((f) => CODES.has(f?.code)).slice(0, 20).map((f) => ({
    code: f.code,
    field: typeof f.field === 'string' && FIELD.test(f.field) ? f.field : null,
    businessSlug: typeof f.businessSlug === 'string' && SLUG.test(f.businessSlug) ? f.businessSlug : null,
  }));
  return safe.length ? { kind: 'fact-check', failures: safe } : null;
}

export function refreshBindingDetail(errors) {
  return refreshFailureDetail(errors.map((error) => {
    const [code, value] = error.split(':');
    const field = code.startsWith('invalid-related') ? code.slice('invalid-'.length)
      : ['draft-changed-topic', 'draft-dropped-premise'].includes(code) ? 'title'
        : code === 'invalid-internal-link' ? 'content' : null;
    return { code, field, businessSlug: code === 'business-outside-pack' || code === 'invalid-relatedBusinesses' ? value : null };
  }))?.failures ?? [];
}
