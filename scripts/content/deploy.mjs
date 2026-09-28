// g6 deploy (§4.6): POST the target's Vercel deploy hook. A crash between the POST
// and markPhase('deploy_requested') re-POSTs on resume; a duplicate build is harmless.
export const DEPLOY_HOOK_ATTEMPTS = 2;
export const DEPLOY_HOOK_TIMEOUT_MS = 10_000;

export class DeployHookError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeployHookError';
    this.code = 'hook-failed';
  }
}

// 2 attempts, 10 s timeout each, 2xx required. Throws DeployHookError otherwise,
// which the gate treats as a propagation failure (content stays published, exit 3).
export async function requestDeploy({
  hookUrl, fetchImpl = globalThis.fetch, attempts = DEPLOY_HOOK_ATTEMPTS, timeoutMs = DEPLOY_HOOK_TIMEOUT_MS,
}) {
  if (!hookUrl) throw new DeployHookError('CONTENT_DEPLOY_HOOK_URL is not set');
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(hookUrl, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
      if (response.status >= 200 && response.status < 300) return { status: response.status, attempts: attempt };
      failures.push(`HTTP ${response.status}`);
    } catch (error) {
      failures.push(error?.name === 'TimeoutError' ? 'timeout' : String(error?.message || error));
    }
  }
  throw new DeployHookError(`deploy hook failed after ${attempts} attempts: ${failures.join('; ')}`);
}
