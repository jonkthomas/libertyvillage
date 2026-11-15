// Fail-closed guard for the shared OpenRouter SDK mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOpenRouterSdkEnv, assertOpenRouterSdkEnv, OPENROUTER_BASE_URL, OPENROUTER_SMALL_MODEL, WRITER_BUDGET_SCALE, writerBudget }
  from '../../scripts/lib/agent-sdk-openrouter.mjs';

const freshEnv = (extra = {}) => ({ OPENROUTER_API_KEY: 'fixture-openrouter-key', ...extra });

test('a missing OPENROUTER_API_KEY throws before any query() can run', () => {
  const env = { ANTHROPIC_API_KEY: 'stray-legacy-key', ANTHROPIC_BASE_URL: 'https://elsewhere.example' };
  assert.throws(() => assertOpenRouterSdkEnv(env), /OPENROUTER_API_KEY is not set/);
  // The stray Anthropic routing must not have been touched by the failed apply.
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://elsewhere.example');
});

test('a present key maps the SDK onto OpenRouter and overwrites stale small-model pins', () => {
  const env = freshEnv({
    ANTHROPIC_API_KEY: 'stray-legacy-key',
    ANTHROPIC_BASE_URL: 'https://elsewhere.example',
    ANTHROPIC_AUTH_TOKEN: 'stray-token',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
    ANTHROPIC_SMALL_FAST_MODEL: 'claude-3-5-haiku-latest',
  });
  assert.equal(applyOpenRouterSdkEnv(env), true);
  assert.equal(env.ANTHROPIC_BASE_URL, OPENROUTER_BASE_URL);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, env.OPENROUTER_API_KEY);
  assert.equal(env.ANTHROPIC_API_KEY, '');
  // Plain assignment: stale values must not survive via ??=.
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, OPENROUTER_SMALL_MODEL);
  assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL, OPENROUTER_SMALL_MODEL);
  assert.doesNotThrow(() => assertOpenRouterSdkEnv(env));
});

test('writer budget scale keeps the sonnet-era token allowance under fallback pricing', () => {
  // Claude Code's $5/$25 fallback is exactly 5/3 of sonnet-4-5's $3/$15 on both
  // axes, so USD caps scale by that ratio to preserve the old token allowance.
  assert.equal(WRITER_BUDGET_SCALE, 5 / 3);
  assert.equal(writerBudget(3.5), 3.5 * (5 / 3));
  assert.ok(writerBudget(1) > 1, 'scaled cap must grant at least the old allowance');
});
