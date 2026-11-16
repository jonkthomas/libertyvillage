// Route every Claude Agent SDK (Claude Code child) call through OpenRouter.
// One shared mapping for all SDK consumers; import and call applyOpenRouterSdkEnv()
// (or assertOpenRouterSdkEnv before a real query()) from each SDK entry point.
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
  if (!env.OPENROUTER_API_KEY) return false; // no key configured: leave env untouched
  env.ANTHROPIC_BASE_URL = OPENROUTER_BASE_URL;
  env.ANTHROPIC_AUTH_TOKEN = env.OPENROUTER_API_KEY;
  env.ANTHROPIC_API_KEY = '';
  // Plain assignment, not ??=: a stale haiku/small-model value must not leak
  // through when the rest of the mapping is being forced onto OpenRouter.
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = OPENROUTER_SMALL_MODEL;
  env.ANTHROPIC_SMALL_FAST_MODEL = OPENROUTER_SMALL_MODEL;
  return true;
}

// Fail closed: without an OpenRouter key the SDK child would fall back to any
// stray ANTHROPIC_BASE_URL/AUTH_TOKEN/API_KEY in the environment and silently
// route the gate elsewhere. Call immediately before any real query().
export function assertOpenRouterSdkEnv(env = process.env) {
  if (!applyOpenRouterSdkEnv(env)) {
    throw new Error(
      'OPENROUTER_API_KEY is not set: refusing to run the Claude Agent SDK (a stray ANTHROPIC_* environment could route it to an unreviewed provider)',
    );
  }
}

// ---- Claude-equivalent budget accounting ----
// The bundled Claude Code CLI prices unknown models (any OpenRouter slug) with
// its fallback table, $5/$25 per M tokens, and this build exposes no per-model
// cost override (ANTHROPIC_CUSTOM_MODEL_OPTION carries only name/description/
// capabilities). So maxBudgetUsd and every reported cost_usd are
// CLAUDE-EQUIVALENT estimates, not OpenRouter spend — the real OpenRouter bill
// for the writer model is roughly a hundredth of the estimate.
// The writer caps below were sized for sonnet-4-5 at $3/$15 per M; the fallback
// table's $5/$25 is exactly 5/3 of that on both axes, so USD caps scale by the
// same ratio to keep at least the old token allowance.
export const CLAUDE_FALLBACK_PRICE_PER_M = 5;
export const LEGACY_SONNET_PRICE_PER_M = 3;
export const WRITER_BUDGET_SCALE = CLAUDE_FALLBACK_PRICE_PER_M / LEGACY_SONNET_PRICE_PER_M;
// legacyUsd: the cap as sized under sonnet-4-5 pricing.
export const writerBudget = (legacyUsd) => legacyUsd * WRITER_BUDGET_SCALE;
