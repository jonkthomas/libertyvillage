// Pre-A1 storage validator for DB-free tests: the identity rules of §4.1 only.
// Replaced by scripts/content/validate.mjs validateRecord once A1 is integrated.
export function identityValidateRecord(dataset, key, record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, errors: ['record must be an object'] };
  if (dataset === 'guide-hub') {
    if (key !== 'guide-hub') errors.push('guide-hub key must be guide-hub');
    if (Object.hasOwn(record, 'slug')) errors.push('guide-hub must have no slug');
  } else if (dataset === 'topic-queue') {
    if (record.key !== key) errors.push('record.key must equal key');
  } else if (record.slug !== key) errors.push('record.slug must equal key');
  return { ok: errors.length === 0, errors };
}
