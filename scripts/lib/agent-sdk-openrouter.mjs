// Route every Claude Agent SDK (Claude Code child) call through OpenRouter.
// One shared mapping for all SDK consumers; import and call applyOpenRouterSdkEnv()
// before the first query() call.
//
// OpenRouter's Anthropic-compatible endpoint: the child appends /v1/messages to
// ANTHROPIC_BASE_URL, so the base URL is the parent path (https://openrouter.ai/api).
// ANTHROPIC_AUTH_TOKEN carries the OpenRouter key as a bearer token and
// ANTHROPIC_API_KEY must be emptied to avoid conflicting auth resolution.
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

// Claude Code's internal small/background model must not fall back to an
// Anthropic haiku slug that does not exist on OpenRouter.
export const OPENROUTER_SMALL_MODEL = 'z-ai/glm-5.3-flash';

export function applyOpenRouterSdkEnv(env = process.env) {
  if (!env.OPENROUTER_API_KEY) return false; // no key configured: leave env untouched, SDK fails closed
  env.ANTHROPIC_BASE_URL = OPENROUTER_BASE_URL;
  env.ANTHROPIC_AUTH_TOKEN = env.OPENROUTER_API_KEY;
  env.ANTHROPIC_API_KEY = '';
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL ??= OPENROUTER_SMALL_MODEL;
  env.ANTHROPIC_SMALL_FAST_MODEL ??= OPENROUTER_SMALL_MODEL;
  return true;
}
