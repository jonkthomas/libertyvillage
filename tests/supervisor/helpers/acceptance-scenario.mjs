// Eval-owned scenario machinery for the local live-model supervisor acceptance
// gate. FROZEN by evals/local-supervisor-acceptance.sha256. Split from
// local-acceptance-happy.eval.mjs per the spec file budgets.
//
// Owns: per-scenario isolated fixture/simulator/state construction, forced
// cleanup registration (so the orchestrator's top-level finally can never leave
// roots, servers, or children behind), the secret shred+scan that covers the
// HTTP log and simulator events, the fail-closed retained-evidence scan, the
// evaluator-owned generateWithPi shim (never generation proof), and the shared
// structural live-generation verifier used by the happy path, serial N5, and
// RED mock 1b.
import fs from 'node:fs';
import path from 'node:path';
import { assertContainedOrigin, createFixture } from './local-git-fixture.mjs';
import { createSupervisorGithub } from './fake-supervisor-github.mjs';
import {
  APPROVED_LIVE_ROUTE, assertEqual, assertLintShape, assertTrue, childEnv, loadProd,
  lintInvocation, readSpawnLog, runChildCli, samePath, scanForLiteral, shredFile,
  writeModelsJson, writeSpawnLogger,
} from './acceptance-evidence.mjs';
import { parsePiSessionTools, sessionModelMetadata, stableStringify } from './acceptance-live-proof.mjs';
import { asyncCoordinatorSeam } from './acceptance-exec.mjs';

export const REPO = 'acceptance/libertyvillage';

export async function prepareScenario(context, {
  name, mutateStaging = null, controls = {}, pi = null, proxyAuth = 'false',
  ownerEnv = 'exedev', contentShip, cloneSplit = true, stagingSentinel = true, seedIssue = true, mainAt = 'base',
} = {}) {
  const root = fs.mkdtempSync(path.join(context.tmpBase, `scn-${name}-`));
  fs.chmodSync(root, 0o700);
  const fixture = createFixture({ root, sourceRepo: context.repoRoot, sourceSha: context.sourceSha, mutateStaging, cloneSplit, stagingSentinel, mainAt });
  const prod = await loadProd(context.repoRoot);
  const childEnvLike = { LV_WEEKLY_OWNER: ownerEnv ?? undefined, LV_CONTENT_SHIP_ENABLED: contentShip };
  const sim = createSupervisorGithub({ repo: REPO, fixture, prod, controls, childEnvLike });
  const apiUrl = await sim.listen();
  let seededIssueBody = null;
  if (seedIssue && prod.renderCandidateState && prod.emptyCandidateState) seededIssueBody = sim.seedCandidateStateIssue().body;
  const stateDir = path.join(root, 'state');
  const home = path.join(root, 'home');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const { loggerPath, spawnLog } = writeSpawnLogger(path.join(root, 'observe'));
  const piEnv = pi === null ? {} : {
    provider: pi.provider ?? APPROVED_LIVE_ROUTE.provider,
    model: pi.model ?? APPROVED_LIVE_ROUTE.model,
    baseUrl: pi.baseUrl ?? APPROVED_LIVE_ROUTE.baseUrl,
    apiKey: pi.apiKey ?? process.env.PI_API_KEY,
    sdkPath: pi.sdkPath ?? process.env.PI_SDK_PATH,
  };
  if (pi && pi.models !== false) writeModelsJson(path.join(stateDir, 'pi-runtime'), pi.modelsOverride);
  assertContainedOrigin(fixture.clone, root);
  const scenario = {
    name, root, fixture, prod, sim, apiUrl, stateDir, home, seededIssueBody,
    ledgerFile: path.join(stateDir, 'ledger.json'),
    spawnLog, piEnv, handles: [],
    env: childEnv({
      apiUrl, stateDir, ledger: path.join(stateDir, 'ledger.json'), repo: REPO, home,
      spawnLog, loggerPath, proxyAuth, ownerEnv, contentShip, npmCache: context.npmCache, pi: piEnv,
    }),
    runChild(deadlineMs) {
      const handle = {};
      scenario.handles.push(handle);
      return runChildCli({ cloneDir: fixture.clone, env: scenario.env, deadlineMs, handle });
    },
    ledgerRows() {
      if (!fs.existsSync(scenario.ledgerFile)) return [];
      try { return prod.readLedger(scenario.ledgerFile).runs; }
      catch { return JSON.parse(fs.readFileSync(scenario.ledgerFile, 'utf8')).runs || []; }
    },
    sessionFiles() {
      const dir = path.join(stateDir, 'pi-sessions');
      return fs.existsSync(dir) ? fs.readdirSync(dir).map((file) => path.join(dir, file)) : [];
    },
    // The scan covers the durable ledger, every session JSONL, the spawn log,
    // the full in-memory HTTP request log, and the simulator event log, plus
    // any caller-provided streams (child stdout/stderr).
    shredAndScan(streams = {}) {
      const shredded = shredFile(path.join(stateDir, 'pi-runtime', 'auth.json'));
      const files = [scenario.ledgerFile, ...scenario.sessionFiles(), scenario.spawnLog];
      const hits = scanForLiteral({
        files,
        strings: { ...streams, 'http-requests': JSON.stringify(scenario.sim.requests), 'sim-events': JSON.stringify(scenario.sim.events) },
        literal: process.env.PI_API_KEY,
      });
      return { shredded, hits };
    },
    // Fail-closed retention: every retained evidence file is re-scanned for the
    // literal credential; a hit deletes the retained copy and throws.
    retain(reportDir, label, extra = {}) {
      const dir = path.join(reportDir, label);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const written = [];
      for (const file of [scenario.ledgerFile, ...scenario.sessionFiles()]) {
        if (!fs.existsSync(file)) continue;
        const target = path.join(dir, path.basename(file));
        fs.copyFileSync(file, target);
        written.push(target);
      }
      const writeText = (file, text) => {
        const target = path.join(dir, file);
        fs.writeFileSync(target, text ?? '');
        written.push(target);
      };
      writeText('http-requests.json', `${JSON.stringify(scenario.sim.requests, null, 2)}\n`);
      writeText('sim-events.json', `${JSON.stringify(scenario.sim.events, null, 2)}\n`);
      for (const [file, text] of Object.entries(extra)) writeText(file, text);
      const hits = scanForLiteral({ files: written, literal: process.env.PI_API_KEY });
      if (hits.length) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error(`SECRET_LEAKED into retained evidence (retention deleted): ${hits.join(', ')}`);
      }
      return dir;
    },
    // Synchronous last-resort cleanup for the orchestrator's top-level finally:
    // kill any child process group, close the simulator socket, remove the root.
    forceClean() {
      for (const handle of scenario.handles) { if (handle.pid && !handle.exited) handle.kill?.(); }
      try { sim.server.close(); } catch { /* already closed */ }
      fs.rmSync(root, { recursive: true, force: true });
    },
    async cleanup() {
      context.live?.delete(scenario);
      for (const handle of scenario.handles) { if (handle.pid && !handle.exited) handle.kill?.(); }
      await sim.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  context.live?.add(scenario);
  return scenario;
}

// Writes the evaluator-owned generateWithPi shim into a scenario CLONE only
// (serial N3/N4, mutation M138, deploy controls). Explicitly NOT generation
// proof; it never counts against the live budget and never claims a live route.
export function writeGenerateShim(scenario, { post }) {
  const dir = path.join(scenario.fixture.clone, 'scripts/supervisor');
  fs.renameSync(path.join(dir, 'pi-session.mjs'), path.join(dir, 'pi-session.real.mjs'));
  fs.writeFileSync(path.join(dir, 'acceptance-shim-post.json'), `${JSON.stringify(post, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'pi-session.mjs'), [
    '// EVALUATOR-OWNED clone-local shim (serial N3 boundary test; not generation proof).',
    "export * from './pi-session.real.mjs';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { validateSubmittedPost } from './pi-session.real.mjs';",
    'export async function generateWithPi({ sessionsDir, topic }) {',
    "  const post = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'acceptance-shim-post.json'), 'utf8'));",
    '  post.publishedAt = new Date().toISOString().slice(0, 10); post.updatedAt = post.publishedAt;',
    '  const checked = validateSubmittedPost(post, topic, topic.key);',
    "  if (!checked.ok) throw new Error(`shim post failed validateSubmittedPost: ${checked.errors.join('; ')}`);",
    '  fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });',
    '  const sessionFile = path.join(sessionsDir, `shim-${Date.now()}.jsonl`);',
    "  fs.writeFileSync(sessionFile, `${JSON.stringify({ type: 'acceptance-shim', note: 'not a live session' })}\\n`);",
    '  return { post, sessionFile };',
    '}',
    '',
  ].join('\n'));
}

export function shimPost({ dirty, image }) {
  const body = dirty
    ? 'Neighbourhood notes. **Acceptance Fictitious Cafe** pours espresso for $4.25 and stays open 7 am to 9 pm daily, per its own posted menu board and signage.'
    : 'Liberty Village keeps a steady weekly rhythm, and this overview simply links the reader to guides the site has already published without asserting any new venue details.';
  return {
    slug: dirty ? 'acceptance-serial-n3-candidate' : 'acceptance-clean-candidate',
    title: dirty ? 'Acceptance Serial N3 Candidate' : 'Acceptance Clean Candidate',
    description: body, content: `${body}\n\n${body}`, answerBlock: body,
    publishedAt: '2026-01-01', updatedAt: '2026-01-01', category: 'community',
    image, author: 'LibertyVillage.co',
    tags: ['liberty-village', 'community', 'weekly', 'notes'],
    faqs: [1, 2, 3, 4].map((n) => ({ question: `Question ${n} about the neighbourhood?`, answer: 'The site keeps grounded answers in its published guides.' })),
    relatedServices: [], relatedTopics: [], relatedPosts: [],
    keyTakeaways: ['One', 'Two', 'Three', 'Four'].map((n) => `${n} grounded takeaway with no venue specifics.`),
  };
}

// Shared refusal harness for evaluator-driven ingest controls: the ingest must
// throw (optionally with a named reason), main must not move, no main PR merges.
export function expectIngestRefusal(ch, id, description, scenario, payload, needle) {
  ch.check(id, description, () => {
    const mainBefore = scenario.fixture.rev('main');
    let error = null;
    try { scenario.sim.runIngest(payload); } catch (caught) { error = caught; }
    assertTrue(error, 'ingest was NOT refused');
    if (needle) assertTrue(error.message.includes(needle), `refusal reason drifted: ${error.message}`);
    assertTrue(scenario.fixture.rev('main') === mainBefore, 'main tip moved');
    assertTrue(scenario.sim.pulls().every((pr) => pr.baseRef !== 'main' || !pr.merged), 'a main PR merged');
    return { error: error.message.slice(0, 200) };
  });
}

// In-process production GitHub calls (github.mjs reads env at call time): swap
// the process env to the scenario's loopback double, restore afterwards.
export async function withSimEnv(scenario, fn) {
  const keys = ['GITHUB_API_URL', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'LV_EXE_GITHUB_PROXY_AUTH', 'LV_GITHUB_REPOSITORY'];
  const saved = keys.map((key) => [key, process.env[key]]);
  process.env.GITHUB_API_URL = scenario.apiUrl;
  process.env.GH_TOKEN = 'test-token';
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_HOST;
  process.env.LV_EXE_GITHUB_PROXY_AUTH = 'false';
  process.env.LV_GITHUB_REPOSITORY = REPO;
  try { return await fn(); } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

// FIFTH eval-owner correction — INDIRECT sync child through a production
// wrapper. `recordSupervisorOutcome(payload, coordinatorFn = coordinator)`
// defaults to a wrapper that launches coordinator.mjs with execFileSync. The
// evaluator HOSTS the loopback double in this process, so taking that default
// deadlocks the checker through production code (observed >3m at 0% CPU on
// C-N13's `record-candidate-outcome --outcome MONITOR_TIMEOUT`). We inject the
// bounded async seam production ALREADY accepts — no production change — and
// still assert production's own argument mapping, the terminal outcome it
// forwards, the durable ladder issue, and that no child survived.
export async function recordOutcomeThroughSeam(scenario, { runId, topicKey, terminal, reason, label = 'C-N13-outcome' }) {
  const { prod, fixture, sim } = scenario;
  const seam = asyncCoordinatorSeam({ env: scenario.env, label });
  const outputs = await withSimEnv(scenario, async () => prod.recordSupervisorOutcome({
    repoRoot: fixture.clone, repo: REPO, runId, topicKey, terminal, reason,
  }, seam.fn));
  assertTrue(seam.calls.length === 1, `production drove ${seam.calls.length} coordinator invocations, expected exactly 1`);
  const [call] = seam.calls;
  assertTrue(samePath(String(call.repoRoot), fixture.clone), `production passed repoRoot ${call.repoRoot}, not the scenario clone`);
  assertTrue(call.options?.repo === REPO, `production passed options.repo ${JSON.stringify(call.options?.repo)}, not ${REPO}`);
  assertTrue(call.argv[0] === 'record-candidate-outcome', `production drove subcommand ${call.argv[0]}`);
  const flags = {};
  for (let index = 1; index < call.argv.length; index += 1) {
    if (String(call.argv[index]).startsWith('--')) flags[call.argv[index]] = call.argv[index + 1];
  }
  for (const [flag, expected] of [
    ['--kind', 'blog'], ['--outcome', terminal], ['--key', runId], ['--topic-key', topicKey],
    ['--reason', prod.boundedOutcomeReason(reason || terminal)], ['--repo', REPO],
  ]) {
    assertTrue(flags[flag] === expected, `production mapped ${flag} to ${JSON.stringify(flags[flag] ?? null)}, expected ${JSON.stringify(expected)}`);
  }
  assertTrue(call.result.code === 0, `coordinator exited ${call.result.code}: ${(call.result.stderr || '').slice(-300)}`);
  assertTrue(outputs?.recorded === 'true', `coordinator did not record a durable outcome: ${JSON.stringify(outputs)}`);
  assertTrue(outputs?.topic_key === topicKey, `coordinator recorded topic_key ${JSON.stringify(outputs?.topic_key ?? null)}`);
  const issue = [...sim.issues.values()].find((entry) => entry.title === 'automation-state: blog candidate ladder');
  assertTrue(issue && issue.body.includes(terminal), `the durable candidate-state issue does not carry the ${terminal} outcome`);
  const orphans = seam.orphans();
  assertTrue(orphans.length === 0, `coordinator child processes survived the bounded seam: ${orphans.join(', ')}`);
  return {
    argv: call.argv.join(' '), exitCode: call.result.code, durationMs: call.result.durationMs,
    recorded: outputs.recorded, action: outputs.action ?? null,
  };
}

export function firstBlogImage(repoRoot) {
  const dir = path.join(repoRoot, 'public/images/blog');
  const file = fs.readdirSync(dir).filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name)).sort()[0];
  assertTrue(file, 'no committed blog image exists under public/images/blog');
  return `/images/blog/${file}`;
}

// Shared structural live-generation verifier (happy path and serial N5): the
// JSONL is parsed, the accepted submit_candidate is correlated by call ID to a
// host tool result, and the accepted candidate bytes must equal the shipped
// data-commit post. Substring evidence is never accepted. When `context` is
// supplied, a fully verified route proof is recorded on it so the report's
// production-dialect wording can be gated on this exact proof and nothing less.
export function liveGenerationChecks({ scenario, runRow, stagingBefore, ch, prefix, context = null }) {
  const { prod, fixture } = scenario;
  let parsed = null;
  ch.check(`${prefix}1`, 'live Pi session JSONL exists under the scenario state root and matches the ledger', () => {
    const sessions = scenario.sessionFiles();
    assertTrue(sessions.length >= 1, 'no session JSONL under <state>/pi-sessions');
    assertTrue(runRow?.pi_session_file && sessions.some((file) => samePath(file, runRow.pi_session_file)),
      'ledger session path is not under the scenario state root');
    return { sessionFile: runRow.pi_session_file, bytes: fs.statSync(runRow.pi_session_file).size };
  });
  ch.check(`${prefix}2`, 'structural JSONL tool proof: allowlist subset, ID-correlated accepted submit_candidate, context tool', () => {
    parsed = parsePiSessionTools(runRow.pi_session_file, prod.PI_TOOL_ALLOWLIST);
    assertTrue(parsed.extras.length === 0, `extra tools invoked: ${parsed.extras.join(', ')}`);
    assertTrue(parsed.invoked.includes('submit_candidate'), 'no submit_candidate call in the live transcript');
    assertTrue(parsed.invoked.some((name) => name.startsWith('context_')), 'no context_* tool call in the live transcript');
    assertTrue(parsed.accepted, 'no tool RESULT correlated by call ID to a submit_candidate call carries the host acceptance');
    assertTrue(parsed.acceptedPost, 'the accepted submit_candidate call did not record the submitted candidate arguments');
    if (parsed.active) assertEqual([...parsed.active].sort(), [...prod.PI_TOOL_ALLOWLIST].sort(), 'registered tool set');
    return { invoked: parsed.invoked, active: parsed.active, calls: parsed.callCount };
  });
  ch.check(`${prefix}3`, 'session evidence resolves ALL FOUR of provider/id/api/baseUrl, each exactly the approved route; a missing field fails, it is never skipped', () => {
    const meta = sessionModelMetadata(runRow.pi_session_file);
    for (const [key, expected] of [
      ['provider', APPROVED_LIVE_ROUTE.provider], ['id', APPROVED_LIVE_ROUTE.model],
      ['api', APPROVED_LIVE_ROUTE.api], ['baseUrl', APPROVED_LIVE_ROUTE.baseUrl],
    ]) {
      assertTrue(meta[key] !== null, `child session/runtime evidence never records the resolved ${key}`);
      assertTrue(meta[key] === expected, `session ${key} is ${meta[key]}, not ${expected}`);
    }
    assertTrue(meta.assistant, 'no assistant message in the live stream carries provider AND model AND api — the identity is not bound to the child model stream');
    assertEqual(meta.assistant, { provider: APPROVED_LIVE_ROUTE.provider, id: APPROVED_LIVE_ROUTE.model, api: APPROVED_LIVE_ROUTE.api },
      'assistant-stream model identity');
    assertTrue(!/https?:\/\/(127\.0\.0\.1|localhost)/i.test(String(meta.baseUrl)), 'session resolved a loopback model endpoint');
    if (context) context.liveRouteProof = { provider: meta.provider, id: meta.id, api: meta.api, baseUrl: meta.baseUrl };
    return meta;
  });
  ch.check(`${prefix}4`, 'accepted candidate bytes: JSONL submission equals the shipped data-commit post; new vs staging baseline', () => {
    const baseline = JSON.parse(fixture.show(stagingBefore, 'data/posts.json'));
    assertTrue(prod.isExactSha(runRow?.data_sha), 'ledger has no exact data_sha');
    const shipped = JSON.parse(fixture.show(runRow.data_sha, 'data/posts.json'));
    assertTrue(shipped.length === baseline.length + 1, 'data commit does not append exactly one post');
    const candidate = shipped.at(-1);
    assertTrue(!baseline.some((post) => post.slug === candidate.slug), 'candidate slug pre-existed in the baseline');
    assertTrue(parsed?.acceptedPost, 'no ID-correlated accepted submission exists to compare candidate bytes against');
    assertTrue(stableStringify(parsed.acceptedPost) === stableStringify(candidate),
      `accepted JSONL submission differs from the shipped candidate (${parsed.acceptedPost?.slug} vs ${candidate.slug})`);
    return { slug: candidate.slug };
  });
  ch.check(`${prefix}5`, 'real trusted lint ran with the fixed invocation shape from the staging worktree (canonical cwd containment, exact repoRoot script, relative data paths)', () => {
    const lint = lintInvocation(readSpawnLog(scenario.spawnLog), path.join(scenario.stateDir, 'work'));
    assertLintShape(lint, path.join(fixture.clone, 'scripts/blog-lint.mjs'));
    return { argv: lint.argv.slice(1), cwd: lint.cwd };
  });
  return () => parsed;
}
