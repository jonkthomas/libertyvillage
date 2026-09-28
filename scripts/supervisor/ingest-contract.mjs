import { isExactSha, validatePaths } from '../automation/policy.mjs';

export const DATA_BRANCH_PREFIX = 'supervisor/blog-data-';
export const INGEST_EVENT = 'supervisor-ingest-blog';

export function validateIngestPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, errors: ['payload must be an object'] };
  const allowedKeys = ['kind', 'data_sha', 'data_branch', 'topic_key', 'regenerations', 'store', 'target'];
  for (const key of Object.keys(payload)) if (!allowedKeys.includes(key)) errors.push(`unexpected payload field: ${key}`);
  if (payload.kind !== 'blog') errors.push('kind must be blog');
  if (!isExactSha(payload.data_sha)) errors.push('data_sha must be an exact 40-character SHA');
  if (typeof payload.data_branch !== 'string' || !payload.data_branch.startsWith(DATA_BRANCH_PREFIX)
    || !/^[A-Za-z0-9._/-]+$/.test(payload.data_branch)) errors.push('data_branch is invalid');
  if (typeof payload.topic_key !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(payload.topic_key)) errors.push('topic_key is invalid');
  if (!Number.isInteger(payload.regenerations) || payload.regenerations < 0 || payload.regenerations > 2) errors.push('regenerations is outside the canonical budget');
  if (payload.store !== undefined && !['git', 'db'].includes(payload.store)) errors.push('store must be git or db');
  if (payload.store === 'db' && !['production', 'staging'].includes(payload.target)) errors.push('DB target must be production or staging');
  if (payload.store !== 'db' && payload.target !== undefined) errors.push('target requires db store');
  return { ok: errors.length === 0, errors };
}

export function validateIngestDiff(files) {
  return validatePaths('blog', files);
}

export function validateDbIngestDiff(files) {
  const ok = Array.isArray(files) && files.length === 1 && files[0] === 'candidate/post.json';
  return { ok, errors: ok ? [] : ['DB candidate diff must contain exactly candidate/post.json'] };
}

export function validateIngestRoute(payload, { eventName, ref, hold = false } = {}) {
  const result = validateIngestPayload(payload);
  if (!result.ok) throw new Error(`invalid ingest payload: ${result.errors.join('; ')}`);
  if (eventName === 'repository_dispatch') {
    if (ref !== 'refs/heads/main' || (payload.store === 'db' && payload.target !== 'production')) {
      throw new Error('repository dispatch requires main and production DB target');
    }
  } else if (eventName === 'workflow_dispatch') {
    if (ref !== 'refs/heads/staging' || payload.store !== 'db' || payload.target !== 'staging') {
      throw new Error('workflow dispatch requires staging DB target');
    }
  } else throw new Error('unsupported ingest event');
  if (hold && eventName !== 'workflow_dispatch') throw new Error('LV_CONTENT_CUTOVER_HOLD blocks non-staging events');
  return { store: payload.store || 'git', target: payload.target || '' };
}

export function repositoryDispatchBody(payload) {
  const result = validateIngestPayload(payload);
  if (!result.ok) throw new Error(`invalid ingest payload: ${result.errors.join('; ')}`);
  if (payload.target === 'staging') throw new Error('staging DB ingest requires workflow_dispatch');
  return { event_type: INGEST_EVENT, client_payload: payload };
}

export function workflowDispatchBody(payload) {
  const result = validateIngestPayload(payload);
  if (!result.ok) throw new Error(`invalid ingest payload: ${result.errors.join('; ')}`);
  if (payload.store !== 'db' || payload.target !== 'staging') throw new Error('workflow_dispatch requires staging DB ingest');
  return { ref: 'staging', inputs: { payload: JSON.stringify(payload) } };
}
