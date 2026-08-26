import { STATUS_CONTEXTS } from './constants.mjs';
import { github as defaultGithub } from './github.mjs';
import { isExactSha } from './policy.mjs';

export function statusForExactSha(payload, sha) {
  if (!isExactSha(sha)) throw new Error('status lookup refused a non-exact SHA');
  if (!payload || payload.sha !== sha) {
    throw new Error(`status payload SHA drifted: expected ${sha}, received ${String(payload?.sha ?? 'missing')}`);
  }
  const latest = new Map();
  for (const [index, item] of (payload.statuses || []).entries()) {
    const timestamp = Date.parse(item.updated_at ?? item.created_at ?? '');
    const candidate = { state: item.state, timestamp: Number.isFinite(timestamp) ? timestamp : -Infinity, index };
    const current = latest.get(item.context);
    if (!current || candidate.timestamp > current.timestamp
      || (candidate.timestamp === current.timestamp && candidate.index < current.index)) latest.set(item.context, candidate);
  }
  return {
    ci: latest.get(STATUS_CONTEXTS.publish.ci)?.state ?? 'missing',
    gate: latest.get(STATUS_CONTEXTS.publish.gate)?.state ?? 'missing',
    vercel: latest.get(STATUS_CONTEXTS.wait.vercel)?.state ?? 'missing',
  };
}

export async function publishStatus(options, githubClient = defaultGithub) {
  for (const name of ['repo', 'sha', 'context', 'state', 'description']) {
    if (!options[name]) throw new Error(`missing --${name}`);
  }
  if (!isExactSha(options.sha)) throw new Error('status SHA is invalid');
  if (!Object.values(STATUS_CONTEXTS.publish).includes(options.context)) throw new Error('status context is not controlled');
  if (!['pending', 'success', 'failure', 'error'].includes(options.state)) throw new Error('invalid status state');
  await githubClient(`/repos/${options.repo}/statuses/${options.sha}`, {
    method: 'POST', body: { state: options.state, context: options.context, description: options.description.slice(0, 140) },
  });
  console.log(`Published ${options.context}=${options.state} on ${options.sha}.`);
}
