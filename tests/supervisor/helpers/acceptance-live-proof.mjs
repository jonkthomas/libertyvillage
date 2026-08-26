// Eval-owned structural live-generation proof parsers for the local
// live-model supervisor acceptance gate. FROZEN by
// evals/local-supervisor-acceptance.sha256. Split from
// acceptance-evidence.mjs per the spec file budgets.
//
// Everything here parses the Pi session JSONL STRUCTURALLY against the SDK's
// documented v3 session format (docs/session-format.md of the pinned 0.84.2
// SDK): entries are {type:"message", message:<AgentMessage>}; assistant
// messages carry toolCall content blocks {type:"toolCall", id, name,
// arguments}; host tool results are AgentMessages with role "toolResult"
// correlated by toolCallId and carrying isError. Tool calls and results are
// correlated strictly by call ID, the accepted candidate is decoded from the
// call's recorded arguments (the real submit_candidate contract is
// {topic_key, post_json} with post_json a JSON-encoded string), and route
// metadata comes from parsed JSON fields — a substring can never satisfy any
// of it. Deterministic probes for these parsers live in
// tests/supervisor/local-acceptance-probes.eval.mjs.
import fs from 'node:fs';

// Deterministic key order so candidate-byte comparisons are not defeated by
// JSON serialization order.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const collectText = (node) => {
  const parts = [];
  const dig = (value) => {
    if (typeof value === 'string') { parts.push(value); return; }
    if (Array.isArray(value)) { value.forEach(dig); return; }
    if (value && typeof value === 'object') {
      for (const key of ['text', 'content', 'output', 'result', 'message', 'value']) if (key in value) dig(value[key]);
    }
  };
  dig(node);
  return parts.join('\n');
};

// Decodes the submitted candidate from a submit_candidate call's recorded
// arguments. The documented tool contract is {topic_key, post_json} where
// post_json is a JSON-encoded string of the post; a {post} wrapper or a direct
// post object is also decoded. Anything undecodable yields null, which the
// checks treat as MISSING proof (never as acceptance).
const postFromArgs = (args) => {
  let value = args;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
  if (!value || typeof value !== 'object') return null;
  if (typeof value.post_json === 'string') { try { value = JSON.parse(value.post_json); } catch { return null; } }
  else if (value.post && typeof value.post === 'object') value = value.post;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.slug === 'string' ? value : null;
};

// Host acceptance is anchored and structural: the ID-correlated tool RESULT
// must not be an error result and its own text content must BEGIN with the
// host acceptance word. A bare "accepted" substring anywhere else in the
// transcript — an assistant text block, a rejection message, a candidate body
// — can never satisfy this.
const isHostAcceptance = (result) => result != null
  && result.isError !== true && /^accepted\b/i.test(String(result.text ?? '').trim());

// Derives the tool contract STRUCTURALLY from the LIVE JSONL itself (never
// smokePiSession, never a substring scan): registered/active tool lists, the
// distinct invoked tool names, and — via call-ID correlation — whether a
// specific submit_candidate CALL has a host tool RESULT accepting it, along
// with the exact submitted candidate from that call's recorded arguments.
export function parsePiSessionTools(file, allowlist) {
  const known = new Set(allowlist);
  const active = new Set();
  const invoked = new Set();
  const calls = new Map();
  const results = new Map();
  const idOf = (node) => node.id ?? node.toolCallId ?? node.tool_call_id ?? node.callId ?? node.call_id;
  const recordResult = (node) => {
    const id = idOf(node);
    if (id !== undefined && !results.has(String(id))) {
      results.set(String(id), { text: collectText(node), isError: node.isError === true });
    }
  };
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const type = String(node.type ?? '').toLowerCase();
    // Documented v3 host results are AgentMessages with role "toolResult"
    // (no type field of their own); older shapes carry a *result* type.
    const isResult = type.includes('result') || String(node.role ?? '').toLowerCase() === 'toolresult';
    const name = node.toolName ?? node.tool_name ?? (type.includes('tool') ? node.name : undefined);
    if (typeof name === 'string' && /^[a-z][a-z0-9_]*$/.test(name)) {
      if (type.includes('call') || type.includes('use')) {
        invoked.add(name);
        const id = idOf(node);
        if (id !== undefined) calls.set(String(id), { name, args: node.arguments ?? node.input ?? node.args ?? null });
      } else if (isResult) invoked.add(name);
    }
    if (isResult) recordResult(node);
    if (Array.isArray(node.tools) && node.tools.every((tool) => typeof tool === 'string')) {
      node.tools.forEach((tool) => active.add(tool));
    }
    Object.values(node).forEach(walk);
  };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    walk(parsed);
  }
  let accepted = false;
  let acceptedPost = null;
  for (const [id, call] of calls) {
    if (call.name !== 'submit_candidate') continue;
    if (isHostAcceptance(results.get(id))) {
      accepted = true;
      acceptedPost = acceptedPost ?? postFromArgs(call.args);
    }
  }
  const extras = [...invoked].filter((name) => !known.has(name));
  return { active: active.size ? [...active] : null, invoked: [...invoked], extras, accepted, acceptedPost, callCount: calls.size };
}

// Structural session-route metadata, bound to the shapes the CHILD itself
// writes into the session file: assistant AgentMessages (provider/model/api on
// every live model response, per the documented v3 format), model_change
// entries (provider/modelId), resolved-model objects, and coherent route
// records that carry baseUrl TOGETHER WITH a provider. Values are parsed JSON
// fields, never substrings; the first coherent occurrence of each wins.
// `assistant` is non-null only when a single assistant message in the live
// stream carried provider AND model AND api together — the callers use it to
// bind the resolved identity to the actual model stream.
export function sessionModelMetadata(file) {
  const meta = { provider: null, id: null, api: null, baseUrl: null, assistant: null };
  const claim = (key, value) => { if (meta[key] === null && typeof value === 'string' && value) meta[key] = value; };
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (String(node.role ?? '').toLowerCase() === 'assistant') {
      claim('provider', node.provider);
      claim('api', node.api);
      if (typeof node.model === 'string') claim('id', node.model);
      if (meta.assistant === null && typeof node.provider === 'string'
        && typeof node.model === 'string' && typeof node.api === 'string') {
        meta.assistant = { provider: node.provider, id: node.model, api: node.api };
      }
    }
    if (String(node.type ?? '') === 'model_change') {
      claim('provider', node.provider);
      claim('id', node.modelId ?? node.model_id);
    }
    if (node.model && typeof node.model === 'object') {
      claim('id', node.model.id); claim('provider', node.model.provider);
      claim('api', node.model.api); claim('baseUrl', node.model.baseUrl ?? node.model.base_url);
    }
    const baseUrl = node.baseUrl ?? node.base_url;
    if (typeof baseUrl === 'string' && typeof node.provider === 'string') {
      claim('baseUrl', baseUrl);
      claim('provider', node.provider);
      claim('api', node.api);
      claim('id', node.id ?? node.modelId ?? (typeof node.model === 'string' ? node.model : undefined));
    }
    Object.values(node).forEach(walk);
  };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { walk(JSON.parse(line)); } catch { /* non-JSON line */ }
  }
  return meta;
}
