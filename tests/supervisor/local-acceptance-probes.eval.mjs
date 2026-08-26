#!/usr/bin/env node
// Deterministic structural parser probes for the eval-owned live-proof
// parsers. Eval-owned; FROZEN by evals/local-supervisor-acceptance.sha256.
// These probes exercise parsePiSessionTools / sessionModelMetadata against
// fixtures written in the SDK's DOCUMENTED v3 session format (session-format.md
// of the pinned 0.84.2 SDK): {type:"message", message:<AgentMessage>} entries,
// assistant toolCall content blocks, and role:"toolResult" host results
// correlated by toolCallId with arguments {topic_key, post_json}. They spend
// no model token, touch no network, and run in the orchestrator BEFORE any
// credential use — so a parser that cannot read the real SDK shape (or that
// accepts a bare substring) fails the gate even on a baseline RED run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Checks, assertEqual, assertTrue } from './helpers/acceptance-evidence.mjs';
import { parsePiSessionTools, sessionModelMetadata, stableStringify } from './helpers/acceptance-live-proof.mjs';

const ALLOWLIST = Object.freeze(['context_read', 'context_grep', 'context_find', 'submit_candidate']);
const ROUTE = Object.freeze({
  provider: 'lv-vercel-acceptance', id: 'openai/gpt-5.6-sol',
  api: 'openai-responses', baseUrl: 'https://ai-gateway.vercel.sh/v1',
});
const POST = Object.freeze({
  slug: 'probe-fixture-candidate', title: 'Probe Fixture Candidate',
  publishedAt: '2026-08-26', updatedAt: '2026-08-26', category: 'community',
  tags: ['liberty-village', 'probe'], author: 'LibertyVillage.co',
});

const USAGE = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const header = () => ({ type: 'session', version: 3, id: 'probe-session-uuid', timestamp: '2026-08-26T00:00:00.000Z', cwd: '/probe/work' });
const entry = (id, parentId, message) => ({ type: 'message', id, parentId, timestamp: '2026-08-26T00:00:01.000Z', message });
const assistant = (content, overrides = {}) => ({
  role: 'assistant', content, api: ROUTE.api, provider: ROUTE.provider, model: ROUTE.id,
  usage: USAGE, stopReason: 'toolUse', timestamp: 1, ...overrides,
});
const toolResult = (toolCallId, toolName, text, isError = false) => ({
  role: 'toolResult', toolCallId, toolName, content: [{ type: 'text', text }], details: {}, isError, timestamp: 2,
});
const submitCall = (id, postJson) => ({ type: 'toolCall', id, name: 'submit_candidate', arguments: { topic_key: 'probe-topic', post_json: postJson } });
const routeRecord = (overrides = {}) => ({
  type: 'custom', id: 'r0uterec', parentId: 'e4e4e4e4', timestamp: '2026-08-26T00:00:02.000Z',
  customType: 'lv-supervisor-live-route', data: { ...ROUTE, ...overrides },
});

// The documented-positive transcript: model_change, context tool round-trip,
// ID-correlated accepted submit_candidate, and a coherent route record.
function positiveLines() {
  return [
    { ...header(), tools: [...ALLOWLIST] },
    { type: 'model_change', id: 'm0m0m0m0', parentId: null, timestamp: '2026-08-26T00:00:00.500Z', provider: ROUTE.provider, modelId: ROUTE.id },
    entry('e1e1e1e1', 'm0m0m0m0', { role: 'user', content: 'Generate the post.', timestamp: 0 }),
    entry('e2e2e2e2', 'e1e1e1e1', assistant([
      { type: 'text', text: 'Reading context.' },
      { type: 'toolCall', id: 'call_ctx_1', name: 'context_read', arguments: { path: 'data/posts.json' } },
    ])),
    entry('e3e3e3e3', 'e2e2e2e2', toolResult('call_ctx_1', 'context_read', '[]')),
    entry('e4e4e4e4', 'e3e3e3e3', assistant([submitCall('call_sub_1', JSON.stringify(POST))])),
    entry('e5e5e5e5', 'e4e4e4e4', toolResult('call_sub_1', 'submit_candidate', 'Accepted. End the session.')),
    routeRecord(),
  ];
}

function writeSession(dir, name, lines) {
  const file = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return file;
}

export function parserProbePhase() {
  const ch = new Checks('parser-probes');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-accept-parser-probes-'));
  try {
    ch.check('PP1', 'documented v3 positive: toolResult-role acceptance is ID-correlated and arguments.post_json decodes to the exact candidate bytes', () => {
      const parsed = parsePiSessionTools(writeSession(dir, 'pp1', positiveLines()), ALLOWLIST);
      assertTrue(parsed.accepted === true, 'the documented v3 accepted submit_candidate was not recognized');
      assertTrue(parsed.acceptedPost, 'arguments.post_json was not decoded into the accepted candidate');
      assertEqual(stableStringify(parsed.acceptedPost), stableStringify(POST), 'decoded candidate bytes');
      assertTrue(parsed.invoked.includes('submit_candidate') && parsed.invoked.includes('context_read'), `invoked drifted: ${parsed.invoked.join(', ')}`);
      assertTrue(parsed.extras.length === 0, `extras: ${parsed.extras.join(', ')}`);
      assertEqual([...parsed.active].sort(), [...ALLOWLIST].sort(), 'active tool list');
      return { calls: parsed.callCount, invoked: parsed.invoked };
    });
    ch.check('PP2', 'documented v3 positive: metadata resolves all four route fields and binds provider/model/api to the assistant stream', () => {
      const meta = sessionModelMetadata(writeSession(dir, 'pp2', positiveLines()));
      assertEqual({ provider: meta.provider, id: meta.id, api: meta.api, baseUrl: meta.baseUrl }, ROUTE, 'resolved route');
      assertEqual(meta.assistant, { provider: ROUTE.provider, id: ROUTE.id, api: ROUTE.api }, 'assistant-stream identity');
      return meta;
    });
    ch.check('PP3', 'negative: an isError toolResult is never acceptance, even with acceptance text', () => {
      const lines = positiveLines();
      lines[6] = entry('e5e5e5e5', 'e4e4e4e4', toolResult('call_sub_1', 'submit_candidate', 'Accepted. End the session.', true));
      const parsed = parsePiSessionTools(writeSession(dir, 'pp3', lines), ALLOWLIST);
      assertTrue(parsed.accepted === false && parsed.acceptedPost === null, 'an error result was treated as host acceptance');
      return null;
    });
    ch.check('PP4', 'negative: a rejection result, and a result merely CONTAINING "accepted" mid-text, are not acceptance', () => {
      for (const [name, text] of [
        ['reject', 'Rejected: publishedAt/updatedAt must equal the run date 2026-08-26'],
        ['midtext', 'The earlier candidate was accepted before this session started.'],
      ]) {
        const lines = positiveLines();
        lines[6] = entry('e5e5e5e5', 'e4e4e4e4', toolResult('call_sub_1', 'submit_candidate', text));
        const parsed = parsePiSessionTools(writeSession(dir, `pp4-${name}`, lines), ALLOWLIST);
        assertTrue(parsed.accepted === false, `a bare/unanchored acceptance substring passed (${name})`);
      }
      return null;
    });
    ch.check('PP5', 'negative: an acceptance result correlated to a DIFFERENT call ID never accepts the submit_candidate call', () => {
      const lines = positiveLines();
      lines[6] = entry('e5e5e5e5', 'e4e4e4e4', toolResult('call_other_9', 'submit_candidate', 'Accepted. End the session.'));
      const parsed = parsePiSessionTools(writeSession(dir, 'pp5', lines), ALLOWLIST);
      assertTrue(parsed.accepted === false && parsed.acceptedPost === null, 'call-ID correlation was not strict');
      return null;
    });
    ch.check('PP6', 'negative: acceptance wording in assistant/user text with NO correlated host toolResult is not acceptance', () => {
      const lines = positiveLines().slice(0, 6);
      lines.push(entry('e5e5e5e5', 'e4e4e4e4', assistant([{ type: 'text', text: 'Accepted. End the session.' }], { stopReason: 'stop' })));
      lines.push(entry('e6e6e6e6', 'e5e5e5e5', { role: 'user', content: 'accepted', timestamp: 3 }));
      const parsed = parsePiSessionTools(writeSession(dir, 'pp6', lines), ALLOWLIST);
      assertTrue(parsed.accepted === false, 'non-toolResult acceptance wording was treated as host acceptance');
      return null;
    });
    ch.check('PP7', 'negative: an accepted call whose post_json does not decode yields NO candidate proof (fail closed)', () => {
      const lines = positiveLines();
      lines[5] = entry('e4e4e4e4', 'e3e3e3e3', assistant([submitCall('call_sub_1', '{not-json')]));
      const parsed = parsePiSessionTools(writeSession(dir, 'pp7', lines), ALLOWLIST);
      assertTrue(parsed.acceptedPost === null, 'an undecodable post_json still produced a candidate');
      return null;
    });
    ch.check('PP8', 'negative metadata: a session with no baseUrl evidence resolves null (the gate then FAILS on presence, never skips)', () => {
      const lines = positiveLines().filter((line) => line.customType !== 'lv-supervisor-live-route');
      const meta = sessionModelMetadata(writeSession(dir, 'pp8', lines));
      assertTrue(meta.baseUrl === null, `baseUrl was invented: ${meta.baseUrl}`);
      assertEqual({ provider: meta.provider, id: meta.id, api: meta.api }, { provider: ROUTE.provider, id: ROUTE.id, api: ROUTE.api }, 'stream-bound fields');
      return null;
    });
    ch.check('PP9', 'negative metadata: a loopback route record resolves to the loopback URL, never the approved route', () => {
      const lines = positiveLines();
      lines[7] = routeRecord({ baseUrl: 'http://127.0.0.1:4242/v1' });
      const meta = sessionModelMetadata(writeSession(dir, 'pp9', lines));
      assertTrue(meta.baseUrl === 'http://127.0.0.1:4242/v1', `loopback record was not surfaced: ${meta.baseUrl}`);
      assertTrue(meta.baseUrl !== ROUTE.baseUrl, 'a loopback session claimed the approved route');
      return null;
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return ch;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ch = parserProbePhase();
  for (const result of ch.results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} [parser-probes] ${result.id}: ${result.description}${result.ok ? '' : ` — ${result.error}`}`);
  }
  process.exitCode = ch.ok ? 0 : 1;
}
