// Eval-owned structural live-generation proof parsers for the local
// live-model supervisor acceptance gate. FROZEN by
// evals/local-supervisor-acceptance.sha256. Split from
// acceptance-evidence.mjs per the spec file budgets.
//
// Everything here parses the Pi session JSONL STRUCTURALLY: tool calls and
// results are correlated by call ID, the accepted candidate is recovered from
// the call's recorded arguments, and route metadata comes from parsed JSON
// fields — a substring can never satisfy any of it.
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

const postFromArgs = (args) => {
  let value = args;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
  if (!value || typeof value !== 'object') return null;
  const post = value.post && typeof value.post === 'object' ? value.post : value;
  return typeof post.slug === 'string' ? post : null;
};

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
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const type = String(node.type ?? '').toLowerCase();
    const name = node.toolName ?? node.tool_name ?? (type.includes('tool') ? node.name : undefined);
    if (typeof name === 'string' && /^[a-z][a-z0-9_]*$/.test(name)) {
      if (type.includes('call') || type.includes('use')) {
        invoked.add(name);
        const id = idOf(node);
        if (id !== undefined) calls.set(String(id), { name, args: node.arguments ?? node.input ?? node.args ?? null });
      } else if (type.includes('result')) invoked.add(name);
    }
    if (type.includes('result')) {
      const id = idOf(node);
      if (id !== undefined && !results.has(String(id))) results.set(String(id), collectText(node));
    }
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
    const result = results.get(id);
    if (typeof result === 'string' && /accepted/i.test(result)) {
      accepted = true;
      acceptedPost = acceptedPost ?? postFromArgs(call.args);
    }
  }
  const extras = [...invoked].filter((name) => !known.has(name));
  return { active: active.size ? [...active] : null, invoked: [...invoked], extras, accepted, acceptedPost, callCount: calls.size };
}

// Structural session-metadata extraction (first coherent occurrence wins):
// provider / model id / api / baseUrl as parsed JSON fields, never substrings.
export function sessionModelMetadata(file) {
  const meta = { provider: null, id: null, api: null, baseUrl: null };
  const claim = (key, value) => { if (meta[key] === null && typeof value === 'string' && value) meta[key] = value; };
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    claim('provider', node.provider);
    claim('api', node.api);
    claim('baseUrl', node.baseUrl ?? node.base_url);
    claim('id', node.modelId ?? node.model_id);
    if (typeof node.model === 'string') claim('id', node.model);
    else if (node.model && typeof node.model === 'object') {
      claim('id', node.model.id); claim('provider', node.model.provider);
      claim('api', node.model.api); claim('baseUrl', node.model.baseUrl);
    }
    Object.values(node).forEach(walk);
  };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { walk(JSON.parse(line)); } catch { /* non-JSON line */ }
  }
  return meta;
}

