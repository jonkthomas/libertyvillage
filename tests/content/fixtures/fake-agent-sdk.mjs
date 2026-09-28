// Stand-in for @anthropic-ai/claude-agent-sdk in tests: review-agent's real
// runStructured drives this query(), so only the model call itself is faked.
// Each queued response is a structured_output object, an Error to throw, or a
// function ({prompt, options}) => structured_output.
export function query({ prompt, options }) {
  const fake = globalThis.__lvFakeAgent;
  if (!fake) throw new Error('fake agent SDK used without agent-sdk-mock.mjs');
  fake.calls.push({ prompt, options });
  const next = fake.responses.shift();
  return (async function* stream() {
    if (next === undefined) throw new Error('fake agent SDK: no queued response');
    if (next instanceof Error) throw next;
    const output = typeof next === 'function' ? await next({ prompt, options }) : next;
    yield { type: 'result', subtype: 'success', structured_output: output };
  })();
}
