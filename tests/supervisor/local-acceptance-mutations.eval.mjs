// Revert-based mutation controls (replaces "RED empty") + proxy-parity GREEN.
// Eval-owned; FROZEN by evals/local-supervisor-acceptance.sha256.
//
// Each control reverts one shipped defect fix on a COPY of the tree under test
// and proves the frozen gate catches the original serial defect:
//   M134 — revert 9f24eec (proxy-auth isolation in baseline tests). The full
//          revert conflicts with #138 in host-run.mjs, so the control uses the
//          spec-sanctioned equivalent tree: tests/automation restored to the
//          pre-#134 state (subprocesses inherit LV_EXE_GITHUB_PROXY_AUTH=true).
//   M136 — revert 5234731 (session routing): a version-correct stub SDK makes
//          the single-argument SessionManager.create derive storage under a
//          read-only ~/.pi, exactly like VM run 3. No live model call.
//   M138 — revert 710ea82 (lint baseline): absolute data paths + repoRoot cwd
//          lose the staging HEAD baseline and lint the planted dirty sentinel.
//   P134 — the operator-true proxy condition on the UNREVERTED tree stays green
//          through baseline (the condition #134 exists to survive).
import fs from 'node:fs';
import path from 'node:path';
import {
  Checks, assertTrue, readSpawnLog, spawnEntriesFor,
} from './helpers/acceptance-evidence.mjs';
import { prepareScenario, writeGenerateShim, shimPost, firstBlogImage } from './local-acceptance-happy.eval.mjs';

const FIX_134 = '9f24eeca64aac1cfc2b671ab57865164995cff3d';
const FIX_136 = '5234731bee9d13dc045903ecd876e62afb217920';
const FIX_138 = '710ea82668a423896cb601fcef685362bf60147d';

function baselineSteps(entries) {
  const observed = [];
  for (const entry of entries) {
    const argv = (entry.argv || []).map(String);
    const npmIndex = argv.findIndex((part) => /npm-cli\.js$/.test(part));
    if (npmIndex < 0) continue;
    const rest = argv.slice(npmIndex + 1).filter((part) => !part.startsWith('-'));
    if (rest[0] === 'ci') observed.push('ci');
    else if (rest[0] === 'run') observed.push(rest[1]);
  }
  return observed;
}

function writeStubSdk(root) {
  const sdkRoot = path.join(root, 'stub-sdk');
  fs.mkdirSync(path.join(sdkRoot, 'dist'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(sdkRoot, 'node_modules/typebox/build'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(sdkRoot, 'package.json'), '{"name":"acceptance-stub-sdk","type":"module"}\n');
  fs.writeFileSync(path.join(sdkRoot, 'node_modules/typebox/package.json'), '{"name":"typebox","type":"module"}\n');
  fs.writeFileSync(path.join(sdkRoot, 'node_modules/typebox/build/index.mjs'),
    'export const Type = { Object: (value) => ({ type: "object", value }), String: () => ({ type: "string" }) };\n');
  fs.writeFileSync(path.join(sdkRoot, 'dist/index.js'), [
    '// Evaluator-owned stub SDK for mutation M136 only: version-correct, but its',
    '// session manager reproduces the pre-#136 home-derived storage contract.',
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "export const VERSION = '0.84.2';",
    'export function defineTool(definition) { return definition; }',
    'export function createExtensionRuntime() { return {}; }',
    'export const SettingsManager = { inMemory: (value) => ({ settings: value }) };',
    'export const ModelRuntime = { create: async () => ({',
    '  registerProvider() {}, async setRuntimeApiKey() {},',
    "  getModel: (provider, id) => ({ provider, id, api: 'openai-responses', baseUrl: 'stub://local' }),",
    '}) };',
    'export const SessionManager = {',
    '  create(first, second) {',
    "    const dir = second === undefined ? path.join(process.env.HOME || os.homedir(), '.pi', 'agent', 'sessions') : path.resolve(second);",
    '    return { getSessionDir: () => dir };',
    '  },',
    "  inMemory() { return { getSessionDir: () => path.join(os.tmpdir(), 'stub-inmemory') }; },",
    '};',
    'export async function createAgentSession(options) {',
    '  const dir = options.sessionManager.getSessionDir();',
    '  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });',
    '  const sessionFile = path.join(dir, `stub-${Date.now()}.jsonl`);',
    '  fs.writeFileSync(sessionFile, \'{"type":"acceptance-stub-session"}\\n\');',
    '  return { session: {',
    '    sessionFile,',
    '    getActiveToolNames: () => [],',
    '    getToolDefinition: () => ({}),',
    "    prompt: async () => { throw new Error('acceptance stub SDK refuses live prompting'); },",
    '    dispose() {},',
    '  } };',
    '}',
    '',
  ].join('\n'));
  return sdkRoot;
}

async function runM134(context) {
  const ch = new Checks('M134-proxy-auth-revert');
  const scenario = await prepareScenario(context, {
    name: 'm134',
    proxyAuth: 'true',
    mutateStaging: (build, git) => {
      git(['checkout', `${FIX_134}^`, '--', 'tests/automation']);
      git(['add', '--all']);
      git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=a@b.c', 'commit', '-m', 'mutation: restore pre-#134 tests/automation (proxy-auth inheritance)']);
    },
  });
  try {
    const result = await scenario.runChild(20 * 60_000);
    const runRow = scenario.ledgerRows().at(-1);
    ch.check('M134-red', 'reverted tree fails BASELINE_FAILED at npm run test:automation under operator proxy-auth=true', () => {
      assertTrue(result.code !== 0 && !result.deadlineHit, `exit ${result.code} deadline=${result.deadlineHit}`);
      assertTrue(runRow?.terminal === 'BASELINE_FAILED', `terminal ${runRow?.terminal}`);
      assertTrue(String(runRow?.error || '').includes('test:automation'), 'failure is not the test:automation regression');
      const steps = baselineSteps(readSpawnLog(scenario.spawnLog));
      assertTrue(steps.includes('test:automation') && !steps.includes('test:supervisor'),
        `baseline progressed past the regression: ${steps.join(' → ')}`);
      return { steps };
    });
    ch.check('M134-clean', 'the caught mutation produced no session, dispatch, or PR', () => {
      assertTrue(scenario.sessionFiles().length === 0 && scenario.sim.pulls().length === 0
        && !scenario.sim.events.some((event) => event.type === 'dispatch'), 'artifacts escaped a baseline failure');
      return null;
    });
  } catch (error) {
    ch.check('M134', 'M134 executed', () => { throw error; });
  } finally { await scenario.cleanup(); }
  return ch;
}

async function runP134(context) {
  const ch = new Checks('P134-proxy-parity-green');
  const scenario = await prepareScenario(context, { name: 'p134', proxyAuth: 'true' });
  try {
    const result = await scenario.runChild(20 * 60_000);
    ch.check('P134-green', 'unreverted tree passes ALL five baseline gates with operator LV_EXE_GITHUB_PROXY_AUTH=true', () => {
      const steps = baselineSteps(readSpawnLog(scenario.spawnLog));
      for (const step of ['ci', 'lint:automation', 'lint:supervisor', 'test:automation', 'test:supervisor']) {
        assertTrue(steps.includes(step), `baseline step never ran: ${step}`);
      }
      const runRow = scenario.ledgerRows().at(-1);
      assertTrue(runRow?.terminal !== 'BASELINE_FAILED' || !String(runRow?.error || '').includes('npm'),
        `baseline itself failed under proxy parity: ${String(runRow?.error || '').slice(0, 300)}`);
      return { steps, exit: result.code };
    });
    ch.note('P134-note', 'the child\'s own later GitHub-to-loopback throw under proxy-auth=true is expected and is NOT a product defect in this scenario', null);
    ch.check('P134-subprocess', 'fake-GitHub subprocess parity assertion ran inside the passing test:automation', () => {
      const text = fs.readFileSync(path.join(context.repoRoot, 'tests/automation/github-auth.test.mjs'), 'utf8');
      assertTrue(text.includes('fakeGithubEnv') && text.includes("LV_EXE_GITHUB_PROXY_AUTH: 'true'"),
        'the #134 parity test is missing from the tree under test');
      return null;
    });
  } catch (error) {
    ch.check('P134', 'P134 executed', () => { throw error; });
  } finally { await scenario.cleanup(); }
  return ch;
}

async function runM136(context) {
  const ch = new Checks('M136-session-root-revert');
  const stubRoot = writeStubSdk(context.tmpBase);
  const scenario = await prepareScenario(context, {
    name: 'm136',
    pi: { apiKey: 'acceptance-m136-dummy', sdkPath: stubRoot },
    mutateStaging: (build, git) => { git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=a@b.c', 'revert', '--no-edit', FIX_136]); },
  });
  try {
    const readonlyPi = path.join(scenario.home, '.pi');
    fs.mkdirSync(readonlyPi, { recursive: true, mode: 0o500 });
    const result = await scenario.runChild(20 * 60_000);
    const runRow = scenario.ledgerRows().at(-1);
    ch.check('M136-red', 'reverted tree fails GENERATE because the session directory is home-derived, not the state root', () => {
      assertTrue(result.code !== 0 && !result.deadlineHit, `exit ${result.code} deadline=${result.deadlineHit}`);
      assertTrue(runRow?.terminal === 'GENERATION_FAILED_PRE_PR', `terminal ${runRow?.terminal}`);
      assertTrue(String(runRow?.error || '').includes('.pi'), 'failure does not name the refused home-derived session directory');
      assertTrue(scenario.sessionFiles().length === 0, 'a session landed under the supervisor state root anyway');
      return { error: String(runRow?.error || '').slice(0, 240) };
    });
    ch.check('M136-clean', 'no candidate commit, data branch, dispatch, or PR', () => {
      assertTrue(!scenario.fixture.remoteHeads().some(([name]) => name.startsWith('supervisor/blog-data-')), 'a data branch exists');
      assertTrue(scenario.sim.pulls().length === 0 && !scenario.sim.events.some((event) => event.type === 'dispatch'), 'ingest artifacts exist');
      return null;
    });
  } catch (error) {
    ch.check('M136', 'M136 executed', () => { throw error; });
  } finally {
    try { fs.chmodSync(path.join(scenario.home, '.pi'), 0o700); } catch { /* gone */ }
    await scenario.cleanup();
  }
  return ch;
}

async function runM138(context) {
  const ch = new Checks('M138-lint-baseline-revert');
  const scenario = await prepareScenario(context, {
    name: 'm138',
    mutateStaging: (build, git) => { git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=a@b.c', 'revert', '--no-edit', FIX_138]); },
  });
  try {
    writeGenerateShim(scenario, { post: shimPost({ dirty: false, image: firstBlogImage(context.repoRoot) }) });
    const result = await scenario.runChild(15 * 60_000);
    const runRow = scenario.ledgerRows().at(-1);
    ch.check('M138-red', 'reverted invocation loses the staging HEAD baseline and the lint result changes to a refusal', () => {
      assertTrue(result.code !== 0 && !result.deadlineHit, `exit ${result.code} deadline=${result.deadlineHit}`);
      assertTrue(['DISCARDED_PRE_PR', 'GENERATION_FAILED_PRE_PR'].includes(runRow?.terminal), `terminal ${runRow?.terminal}`);
      assertTrue(String(runRow?.error || '').includes('blog-lint refused') || String(runRow?.error || '').includes('unrecorded-business'),
        'the wrong-baseline lint did not refuse (mutation was not caught)');
      return { error: String(runRow?.error || '').slice(0, 240) };
    });
    ch.check('M138-shape', 'observed invocation is the pre-#138 shape (absolute data paths and/or clone cwd)', () => {
      const lint = spawnEntriesFor(readSpawnLog(scenario.spawnLog), 'scripts/blog-lint.mjs').at(-1);
      assertTrue(lint, 'no lint invocation observed');
      const postsArg = lint.argv[lint.argv.indexOf('--posts') + 1];
      const regressed = path.isAbsolute(String(postsArg)) || lint.cwd === scenario.fixture.clone;
      assertTrue(regressed, `invocation looks fixed, not reverted: cwd=${lint.cwd} posts=${postsArg}`);
      return { cwd: lint.cwd, postsArg };
    });
    ch.check('M138-nothing-shipped', 'no dispatch or PR followed the refused draft', () => {
      assertTrue(scenario.sim.pulls().length === 0 && !scenario.sim.events.some((event) => event.type === 'dispatch'), 'artifacts escaped the lint refusal');
      return null;
    });
  } catch (error) {
    ch.check('M138', 'M138 executed', () => { throw error; });
  } finally { await scenario.cleanup(); }
  return ch;
}

export async function run(context) {
  return [await runM134(context), await runP134(context), await runM136(context), await runM138(context)];
}
