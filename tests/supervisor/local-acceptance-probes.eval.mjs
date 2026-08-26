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
//
// SIXTH eval-owner correction: PS1–PS5 are the deterministic regression for
// SELECTOR AMBIGUITY over the SHARED spawn log. They replay the exact
// baseline-noise shapes a real run produced (fifteen fixture
// record-candidate-outcome children ahead of the run's own record; fixture
// blog-lint children, one with absolute data paths) and prove, in both
// directions, that the naive first/last selectors pick fixture noise while the
// exact selectors pick the run's own child or fail by name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Checks, assertEqual, assertLintShape, assertTrue, lintInvocation, pathContains, samePath,
} from './helpers/acceptance-evidence.mjs';
import { runExternal } from './helpers/acceptance-exec.mjs';
import { candidateOutcomeRecord, coordinatorFlags, supervisorLintInvocation } from './helpers/acceptance-selectors.mjs';
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

export async function parserProbePhase() {
  const ch = new Checks('parser-and-path-probes');
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
    // PC1-PC3 reproduce the SECOND live-run checker defect deterministically on
    // any POSIX platform: a symlinked parent gives the evaluator's lexical
    // spelling and the child's canonical `process.cwd()` exactly the divergence
    // macOS creates between /var/... and /private/var/... .
    const real = path.join(dir, 'real', 'work', 'run-1');
    fs.mkdirSync(real, { recursive: true });
    fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
    const lexicalWork = path.join(dir, 'link', 'work');
    const lexicalRun = path.join(lexicalWork, 'run-1');
    let reportedCwd = null;
    await ch.checkAsync('PC1', 'cross-process containment: a child launched in a symlinked work dir reports the CANONICAL cwd, which lexical startsWith misses and canonical containment catches', async () => {
      const probe = await runExternal(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: lexicalRun, timeoutMs: 15_000, label: 'PC1-cwd' });
      assertTrue(probe.code === 0 && !probe.timedOut, `cwd probe child did not complete: exit ${probe.code} timedOut=${probe.timedOut}`);
      reportedCwd = probe.stdout.trim();
      assertTrue(!reportedCwd.startsWith(lexicalWork),
        'control broken: the child reported the lexical spelling, so this probe cannot discriminate the defect');
      assertTrue(pathContains(lexicalWork, reportedCwd), `canonical containment failed for the child cwd ${reportedCwd}`);
      return { lexicalWork, reportedCwd };
    });
    ch.check('PC2', 'containment is TIGHTENED, not weakened: a sibling that shares the prefix as a substring is refused, and an outside path is refused', () => {
      const sibling = path.join(dir, 'real', 'work-evil');
      fs.mkdirSync(sibling, { recursive: true });
      assertTrue(sibling.startsWith(path.join(dir, 'real', 'work')), 'control broken: the sibling does not share the lexical prefix');
      assertTrue(!pathContains(path.join(dir, 'real', 'work'), sibling), 'a sibling directory satisfied containment');
      assertTrue(!pathContains(lexicalWork, dir), 'an ancestor satisfied containment');
      assertTrue(pathContains(lexicalWork, lexicalWork), 'a directory does not contain itself');
      return null;
    });
    ch.check('PC3', 'the lint invocation is located by canonical cwd and still asserted EXACTLY: repoRoot script identity plus relative data paths', () => {
      const script = path.join(dir, 'real', 'scripts', 'blog-lint.mjs');
      fs.mkdirSync(path.dirname(script), { recursive: true });
      fs.writeFileSync(script, '// probe fixture linter\n');
      const linked = path.join(dir, 'link', 'scripts', 'blog-lint.mjs');
      const entries = [{ cwd: reportedCwd, argv: [process.execPath, linked, '--posts', 'data/posts.json', '--businesses', 'data/businesses.json'] }];
      const lint = lintInvocation(entries, lexicalWork);
      assertTrue(lint, 'canonical containment failed to locate the lint invocation');
      assertTrue(samePath(linked, script) && linked !== script, 'control broken: the two script spellings are not divergent aliases of one file');
      assertLintShape(lint, script);
      let refusedScript = false;
      try { assertLintShape(lint, path.join(dir, 'real', 'scripts', 'other-lint.mjs')); } catch { refusedScript = true; }
      assertTrue(refusedScript, 'a DIFFERENT script path was accepted as the trusted linter');
      let refusedAbsolute = false;
      const absolute = [{ cwd: reportedCwd, argv: [process.execPath, linked, '--posts', path.join(real, 'data/posts.json'), '--businesses', 'data/businesses.json'] }];
      try { assertLintShape(lintInvocation(absolute, lexicalWork), script); } catch { refusedAbsolute = true; }
      assertTrue(refusedAbsolute, 'an ABSOLUTE --posts path was accepted');
      return null;
    });
    // ---- PS1-PS5: exact spawn-log selection under baseline noise ----------
    // The decoys are the shapes actually observed in a real N3 run: fixture
    // records carrying `--repo owner/repo` BEFORE the subcommand flags, short
    // reasons, and (mostly) no --topic-key at all. RUN_ID/TOPIC_KEY/REASON are
    // the exact values that run produced, including the 511-character reason
    // ending in the literal truncation marker.
    const RUN_ID = 'blog-2026-08-26T19-44-43-337Z';
    const TOPIC_KEY = '663d872e95aa4c5ae474ff63a4b9dc72521218b21b59c99a7dde3b0be0096422';
    const REASON = `${'d'.repeat(498)} …[truncated]`;
    const coordinatorEntry = (script, tail) => ({ cwd: '/probe/cwd', argv: [process.execPath, script, 'record-candidate-outcome', ...tail] });
    const FIXTURE_COORDINATOR = '/probe/state/work/blog-2026-08-26T19-44-43-337Z/scripts/automation/coordinator.mjs';
    const HOST_COORDINATOR = '/probe/clone/scripts/automation/coordinator.mjs';
    const decoys = [
      ['--repo', 'owner/repo', '--kind', 'blog', '--outcome', 'generation-failed', '--key', 'blog-isolated-run', '--reason', 'fixture candidate failed'],
      ['--repo', 'owner/repo', '--kind', 'seo', '--outcome', 'generation-failed', '--key', 'seo-isolated-run', '--reason', 'fixture candidate failed'],
      ['--repo', 'owner/repo', '--kind', 'blog', '--outcome', 'MONITOR_TIMEOUT', '--key', 'cn13-run', '--topic-key', 'acceptance-control-topic', '--reason', 'fixture monitor timeout'],
      ['--repo', 'owner/repo', '--kind', 'blog', '--outcome', 'lint-discarded', '--key', 'run-1-attempt-1', '--reason', 'ungrounded claim'],
      ['--repo', 'owner/repo', '--kind', 'blog', '--outcome', 'lint-discarded', '--key', RUN_ID, '--topic-key', 'a-different-topic', '--reason', 'same run key, other topic'],
      ['--repo', 'owner/repo', '--kind', 'blog', '--outcome', 'lint-discarded', '--key', 'another-run', '--topic-key', TOPIC_KEY, '--reason', 'same topic key, other run'],
    ].map((tail) => coordinatorEntry(FIXTURE_COORDINATOR, tail));
    const exact = coordinatorEntry(HOST_COORDINATOR, [
      '--kind', 'blog', '--outcome', 'DISCARDED_PRE_PR', '--key', RUN_ID, '--topic-key', TOPIC_KEY,
      '--reason', REASON, '--repo', 'acceptance/libertyvillage',
    ]);
    const select = (entries, overrides = {}) => candidateOutcomeRecord(entries, {
      runId: RUN_ID, topicKey: TOPIC_KEY, outcome: 'DISCARDED_PRE_PR', label: 'PS', ...overrides,
    });
    ch.check('PS1', 'baseline noise: the naive first-match selector takes a FIXTURE record; the exact (key, topic-key, outcome) selector takes the run\'s own record', () => {
      const entries = [...decoys, exact];
      const naive = entries.find((entry) => entry.argv.includes('record-candidate-outcome'));
      assertTrue(naive.argv[naive.argv.indexOf('--reason') + 1] === 'fixture candidate failed',
        'control broken: the naive selector did not select a fixture decoy, so this probe cannot discriminate the defect');
      const record = select(entries);
      assertTrue(record.entry === exact, 'the exact selector did not select the run\'s own record');
      assertTrue(record.reason === REASON && [...record.reason].length === 511 && record.reason.endsWith('…[truncated]'),
        `selected reason drifted: ${[...String(record.reason)].length} chars`);
      assertEqual({ key: record.flags.key, topic: record.flags['topic-key'], outcome: record.flags.outcome },
        { key: RUN_ID, topic: TOPIC_KEY, outcome: 'DISCARDED_PRE_PR' }, 'selected flags');
      assertTrue(record.flags.repo === 'acceptance/libertyvillage', 'the appended --repo was not parsed');
      return { candidates: decoys.length + 1, reasonChars: [...record.reason].length };
    });
    ch.check('PS2', 'no-match fails by name: a wrong run key, a wrong topic key, a wrong outcome, and an absent topic key are each refused, never silently substituted', () => {
      for (const [label, overrides] of [
        ['run key', { runId: 'some-other-run' }],
        ['topic key', { topicKey: 'f'.repeat(64) }],
        ['outcome', { outcome: 'PUBLISHED_MAIN' }],
        ['absent topic key', { topicKey: null }],
      ]) {
        let refused = null;
        try { select([...decoys, exact], overrides); } catch (error) { refused = error.message; }
        assertTrue(refused, `a mismatched ${label} still selected a record`);
        assertTrue(/no record-candidate-outcome child|no topic_key to select on/.test(refused), `refusal for ${label} is not the named one: ${refused}`);
      }
      let noneRefused = null;
      try { select(decoys); } catch (error) { noneRefused = error.message; }
      assertTrue(noneRefused && noneRefused.includes('observed 6 candidate(s)'), `a log of pure fixture noise was not refused with its inventory: ${noneRefused}`);
      return null;
    });
    ch.check('PS3', 'duplicate match fails by name: two children sharing the run/topic/outcome key are ambiguous, not "the first one"', () => {
      let refused = null;
      try { select([...decoys, exact, { ...exact, argv: [...exact.argv] }]); } catch (error) { refused = error.message; }
      assertTrue(refused && refused.includes('ambiguous'), `a duplicated record was not refused: ${refused}`);
      return null;
    });
    ch.check('PS4', 'argv parse is positional and pairwise: a --reason VALUE spelled like a flag is consumed, and an entry that only MENTIONS the subcommand is not a candidate', () => {
      const tricky = coordinatorEntry(HOST_COORDINATOR, [
        '--kind', 'blog', '--outcome', 'DISCARDED_PRE_PR', '--key', RUN_ID, '--topic-key', TOPIC_KEY,
        '--reason', '--key', 'decoy-run-id', '--repo', 'acceptance/libertyvillage',
      ]);
      assertTrue(tricky.argv.lastIndexOf('--key') > tricky.argv.indexOf(RUN_ID),
        'control broken: the flag-shaped reason value does not sit AFTER the real --key, so a re-reading parse would not be caught');
      const flags = coordinatorFlags(tricky.argv);
      assertTrue(flags.reason === '--key', `the flag-shaped reason value was not consumed as a value: ${JSON.stringify(flags.reason)}`);
      assertTrue(flags.key === RUN_ID, `a value spelled like a flag was re-read as a flag and overwrote the run key: ${JSON.stringify(flags.key)}`);
      assertTrue(flags.repo === 'acceptance/libertyvillage', `the trailing --repo was lost: ${JSON.stringify(flags.repo)}`);
      assertTrue(select([tricky]).entry === tricky, 'the record was not selectable once a flag-shaped reason value was present');
      const mention = { cwd: '/probe/cwd', argv: [process.execPath, HOST_COORDINATOR, 'heal-generator-base', '--key', RUN_ID, '--topic-key', TOPIC_KEY, '--outcome', 'DISCARDED_PRE_PR', '--reason', 'record-candidate-outcome'] };
      assertTrue(mention.argv.includes('record-candidate-outcome') && mention.argv[2] !== 'record-candidate-outcome',
        'control broken: the decoy does not carry the subcommand as a non-positional argv element');
      let refused = null;
      try { select([mention]); } catch (error) { refused = error.message; }
      assertTrue(refused && refused.includes('observed 0 candidate(s)'), `a --reason spelled exactly like the subcommand was treated as a record: ${refused}`);
      return null;
    });
    ch.check('PS5', 'the run\'s own trusted lint is selected by exact script identity; a log of FIXTURE linters only (absolute --posts) is refused instead of passing as the pre-#138 shape', () => {
      const cloneScript = path.join(dir, 'clone-scripts', 'blog-lint.mjs');
      const worktreeScript = path.join(dir, 'worktree-scripts', 'blog-lint.mjs');
      for (const file of [cloneScript, worktreeScript]) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '// probe fixture linter\n');
      }
      const fixtureLints = [
        { cwd: path.join(dir, 'home-tmp'), argv: [process.execPath, worktreeScript, '--posts', 'data/posts.json', '--businesses', 'data/businesses.json'] },
        { cwd: path.join(dir, 'home-tmp'), argv: [process.execPath, worktreeScript, '--posts', path.join(dir, 'home-tmp', 'data/posts.json'), '--businesses', path.join(dir, 'home-tmp', 'data/businesses.json')] },
      ];
      const naive = fixtureLints.at(-1);
      assertTrue(path.isAbsolute(String(naive.argv[naive.argv.indexOf('--posts') + 1])),
        'control broken: the last fixture linter does not carry an absolute --posts, so it cannot masquerade as the pre-#138 shape');
      let refused = null;
      try { supervisorLintInvocation(fixtureLints, { script: cloneScript, label: 'PS5' }); } catch (error) { refused = error.message; }
      assertTrue(refused && refused.includes('no blog-lint child ran the trusted script'), `fixture-only lint noise was not refused: ${refused}`);
      const own = { cwd: path.join(dir, 'clone'), argv: [process.execPath, cloneScript, '--posts', path.join(dir, 'work/run-1', 'data/posts.json'), '--businesses', 'data/businesses.json'] };
      const selected = supervisorLintInvocation([...fixtureLints, own], { script: cloneScript, label: 'PS5' });
      assertTrue(selected === own, 'the trusted-script selector did not select the run\'s own lint');
      let ambiguous = null;
      try { supervisorLintInvocation([own, { ...own, argv: [...own.argv] }], { script: cloneScript, label: 'PS5' }); } catch (error) { ambiguous = error.message; }
      assertTrue(ambiguous && ambiguous.includes('ambiguous'), `two trusted-script linters were not refused as ambiguous: ${ambiguous}`);
      return null;
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return ch;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ch = await parserProbePhase();
  for (const result of ch.results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} [${ch.scope}] ${result.id}: ${result.description}${result.ok ? '' : ` — ${result.error}`}`);
  }
  process.exitCode = ch.ok ? 0 : 1;
}
