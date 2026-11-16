// Import this BEFORE dynamically importing review-agent.mjs: it redirects the
// agent SDK to fake-agent-sdk.mjs for this test process.
import { registerHooks } from 'node:module';

// The fail-closed guard (scripts/lib/agent-sdk-openrouter.mjs) must see an
// OpenRouter key before review-agent reaches query(); these tests fake the SDK
// transport itself and never call OpenRouter, so a fixture key satisfies it.
process.env.OPENROUTER_API_KEY ||= 'fixture-openrouter-key';

const FAKE_URL = new URL('./fake-agent-sdk.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@anthropic-ai/claude-agent-sdk') return { url: FAKE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

export const fakeAgent = globalThis.__lvFakeAgent ??= { calls: [], responses: [] };

export function queueAgent(...responses) {
  fakeAgent.calls.length = 0;
  fakeAgent.responses.length = 0;
  fakeAgent.responses.push(...responses);
  return fakeAgent;
}
