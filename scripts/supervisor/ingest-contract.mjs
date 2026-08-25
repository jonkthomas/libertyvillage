import { isExactSha, validatePaths } from '../automation/policy.mjs';

export const DATA_BRANCH_PREFIX = 'supervisor/blog-data-';
export const INGEST_EVENT = 'supervisor-ingest-blog';

export function validateIngestPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, errors: ['payload must be an object'] };
  const allowedKeys = ['kind', 'data_sha', 'data_branch', 'topic_key', 'regenerations'];
  for (const key of Object.keys(payload)) if (!allowedKeys.includes(key)) errors.push(`unexpected payload field: ${key}`);
  if (payload.kind !== 'blog') errors.push('kind must be blog');
  if (!isExactSha(payload.data_sha)) errors.push('data_sha must be an exact 40-character SHA');
  if (typeof payload.data_branch !== 'string' || !payload.data_branch.startsWith(DATA_BRANCH_PREFIX)
    || !/^[A-Za-z0-9._/-]+$/.test(payload.data_branch)) errors.push('data_branch is invalid');
  if (typeof payload.topic_key !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(payload.topic_key)) errors.push('topic_key is invalid');
  if (!Number.isInteger(payload.regenerations) || payload.regenerations < 0 || payload.regenerations > 2) errors.push('regenerations is outside the canonical budget');
  return { ok: errors.length === 0, errors };
}

export function validateIngestDiff(files) {
  return validatePaths('blog', files);
}

export function repositoryDispatchBody(payload) {
  const result = validateIngestPayload(payload);
  if (!result.ok) throw new Error(`invalid ingest payload: ${result.errors.join('; ')}`);
  return { event_type: INGEST_EVENT, client_payload: payload };
}
