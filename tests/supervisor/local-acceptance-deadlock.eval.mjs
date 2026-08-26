#!/usr/bin/env node
// Deterministic, no-network DEADLOCK regression probes for the evaluator's own
// external-child machinery. Eval-owned; FROZEN by
// evals/local-supervisor-acceptance.sha256.
//
// A real full live run proved a CHECKER defect: the evaluator hosts the loopback
// GitHub double inside its own process, and two frozen paths launched an
// external coordinator with execFileSync. The blocked event loop could never
// answer the child's request, so the child sat at 0% CPU forever (N4
// record-candidate-outcome >3m, C-N5 heal-generator-base >2m) and the checker
// reported neither pass nor fail. These probes fail if that pattern returns.
//
// They spend no model token, open no socket beyond 127.0.0.1, and run in the
// orchestrator BEFORE any credential use, so they are exercised on every run
// including a baseline RED one. DL3 is the discriminating negative control: it
// reproduces the defect on purpose, under its own 3s bound, so a probe that
// stopped discriminating fails loudly instead of passing vacuously.
//
// FIFTH eval-owner correction — the SAME deadlock arrived INDIRECTLY. C-N13's
// outcome check called production `recordSupervisorOutcome(payload)` with no
// coordinatorFn, so production defaulted to `coordinator()`, which launches
// coordinator.mjs with execFileSync; the child connected to the double this
// process hosts and then waited forever (>3m at 0% CPU on
// `record-candidate-outcome --outcome MONITOR_TIMEOUT`). A frozen path therefore
// does not need to WRITE a sync spawn to deadlock — calling a production wrapper
// that defaults to one is the same defect. DL4 now scans for both shapes, DL4b
// proves the scan still discriminates in both directions on synthetic sources,
// and DL6 is a bounded DYNAMIC reproduction of the exact C-N13-outcome shape
// against the real production wrapper: the synchronous default is proven to be
// served nothing, and the injected async seam is proven to complete, to leave a
// durable MONITOR_TIMEOUT record, and to leave no orphan process behind.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Checks, assertTrue } from './helpers/acceptance-evidence.mjs';
import {
  ASYNC_SEAM_MARKERS, PRODUCTION_SYNC_SPAWN_WRAPPERS, assertSettled, asyncCoordinatorSeam, runExternal,
} from './helpers/acceptance-exec.mjs';

const MARKER = 'LV-DEADLOCK-PROBE-OK';
const MANIFEST = 'evals/local-supervisor-acceptance.sha256';
// Sync spawns are allowed for local git/CLI work; they must never carry the
// loopback double or launch a production coordinator/CLI that speaks to it.
const SYNC_SPAWNS = Object.freeze(['execFileSync', 'spawnSync']);
const LOOPBACK_MARKERS = Object.freeze([
  'scenario.env', 'GITHUB_API_URL', 'apiUrl', 'coordinator.mjs', 'supervisor/cli.mjs',
]);

// Extracts the full source of each `name(...)` CALL. Quoted literals are tracked
// on both sides: a parenthesis inside a string can never end the scan early, and
// a call SPELLED inside a string (documentation, a registry entry, a synthetic
// probe fixture) is prose, not a call, so it is never reported. A call whose
// parentheses never balance slices to EOF and therefore fails closed.
function callExpressions(text, name) {
  const found = [];
  const needle = `${name}(`;
  let outerQuote = null;
  for (let start = 0; start < text.length; start += 1) {
    const opener = text[start];
    if (outerQuote) {
      if (opener === '\\') { start += 1; continue; }
      if (opener === outerQuote) outerQuote = null;
      continue;
    }
    if (opener === "'" || opener === '"' || opener === '`') { outerQuote = opener; continue; }
    if (!text.startsWith(needle, start)) continue;
    if (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) continue;
    let depth = 0;
    let quote = null;
    let index = start + name.length;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === '\\') { index += 1; continue; }
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
      if (char === '(') depth += 1;
      else if (char === ')') { depth -= 1; if (depth === 0) { index += 1; break; } }
    }
    found.push(text.slice(start, index));
  }
  return found;
}

// Comments are prose, not behaviour: a passage that NAMES a production wrapper
// must not be reported as a call. Quotes/escapes are tracked so a `//` inside a
// string literal is never mistaken for a comment.
function stripComments(text) {
  let out = '';
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      out += char;
      if (char === '\\') { out += text[index + 1] ?? ''; index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; out += char; continue; }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      out += '\n';
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 1;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

// DIRECT shape: the frozen path itself launches a synchronous child that carries
// the loopback double or runs a production coordinator/CLI.
function directOffenders(code, relative) {
  const offenders = [];
  for (const spawnName of SYNC_SPAWNS) {
    for (const call of callExpressions(code, spawnName)) {
      const named = LOOPBACK_MARKERS.filter((marker) => call.includes(marker));
      if (named.length) offenders.push(`${relative}: ${spawnName}(...) carries ${named.join('+')}`);
    }
  }
  return offenders;
}

// INDIRECT shape: the frozen path calls an imported PRODUCTION wrapper whose
// default parameter/callback spawns the coordinator/CLI synchronously, without
// injecting the eval-owned async seam production already accepts.
function indirectOffenders(code, relative) {
  const offenders = [];
  for (const wrapper of PRODUCTION_SYNC_SPAWN_WRAPPERS) {
    for (const call of callExpressions(code, wrapper.name)) {
      if (wrapper.seam && ASYNC_SEAM_MARKERS.some((marker) => call.includes(marker))) continue;
      offenders.push(`${relative}: ${wrapper.name}(...) takes production's SYNCHRONOUS default (${wrapper.reaches})`
        + (wrapper.seam ? ` — inject ${wrapper.seam} = asyncCoordinatorSeam().fn` : ' — production exposes no async seam, so a frozen path must not call it'));
    }
  }
  return offenders;
}

function writeProbeChild(dir) {
  const file = path.join(dir, 'loopback-probe-child.mjs');
  fs.writeFileSync(file, [
    '// Evaluator-owned probe child: sleeps, then fetches the loopback double',
    '// hosted by the PARENT process. It can only complete while the parent',
    '// event loop is alive, which is exactly the property under test.',
    'const url = process.argv[2];',
    'await new Promise((resolve) => { setTimeout(resolve, 300); });',
    'const response = await fetch(url);',
    'const text = await response.text();',
    'process.stdout.write(text);',
    'process.exit(text.trim() === process.argv[3] ? 0 : 3);',
    '',
  ].join('\n'));
  const never = path.join(dir, 'never-exits-child.mjs');
  fs.writeFileSync(never, [
    '// Evaluator-owned probe child that never exits on its own: it proves the',
    '// per-call timeout and the process-group SIGKILL actually fire.',
    'setInterval(() => {}, 1000);',
    'process.stdout.write("started\\n");',
    '',
  ].join('\n'));
  return { file, never };
}

// Plants a stub coordinator at the EXACT production path
// (<repoRoot>/scripts/automation/coordinator.mjs) so DL6 drives the real
// production wrapper chain — production resolves that path and spawns it. The
// stub SELF-BOUNDS its loopback fetch, so the synchronous negative control
// terminates in seconds instead of hanging this probe forever.
function writeStubCoordinator(dir, base) {
  const repo = path.join(dir, 'repo');
  const script = path.join(repo, 'scripts/automation/coordinator.mjs');
  fs.mkdirSync(path.dirname(script), { recursive: true, mode: 0o700 });
  fs.writeFileSync(script, [
    "import fs from 'node:fs';",
    `const base = ${JSON.stringify(base)};`,
    'const argv = process.argv.slice(2);',
    'const flag = (name) => { const at = argv.indexOf(name); return at >= 0 ? String(argv[at + 1] ?? "") : ""; };',
    'const controller = new AbortController();',
    'const timer = setTimeout(() => controller.abort(), 2500);',
    'try {',
    '  const query = new URLSearchParams({',
    "    subcommand: argv[0] ?? '', outcome: flag('--outcome'), key: flag('--key'),",
    "    topic: flag('--topic-key'), kind: flag('--kind'), repo: flag('--repo'), reason: flag('--reason'),",
    '  });',
    '  const response = await fetch(`${base}/record?${query}`, { signal: controller.signal });',
    '  const body = await response.text();',
    "  if (!response.ok || !body.includes('durable-ok')) process.exit(5);",
    '  const output = process.env.GITHUB_OUTPUT;',
    '  if (!output) process.exit(6);',
    "  fs.appendFileSync(output, `recorded=true\\ntopic_key=${flag('--topic-key')}\\naction=cooldown\\n`);",
    '  clearTimeout(timer);',
    '  process.exit(0);',
    '} catch { clearTimeout(timer); process.exit(4); }',
    '',
  ].join('\n'));
  return repo;
}

export async function deadlockProbePhase() {
  const ch = new Checks('deadlock-probes');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-accept-deadlock-'));
  fs.chmodSync(dir, 0o700);
  const hits = [];
  // DL6's durable store: the stub coordinator can only append to it by being
  // SERVED by this in-process server, which is exactly the property under test.
  const durable = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url);
    if (request.url.startsWith('/record?')) {
      const query = new URL(request.url, 'http://127.0.0.1').searchParams;
      durable.push(Object.fromEntries(query));
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end(`durable-ok ${query.get('outcome')}`);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(MARKER);
  });
  try {
    const base = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
    const url = `${base}/probe`;
    const { file, never } = writeProbeChild(dir);
    const stubRepo = writeStubCoordinator(dir, base);
    let ticks = 0;
    const ticker = setInterval(() => { ticks += 1; }, 20);
    const async1 = await runExternal(process.execPath, [file, url, MARKER], { timeoutMs: 15_000, label: 'DL1-async-child' });
    clearInterval(ticker);
    await ch.checkAsync('DL1', 'a child that must be SERVED by the evaluator\'s own in-process loopback server completes: async launch keeps the event loop alive', async () => {
      assertSettled(async1, 'DL1 loopback child');
      assertTrue(async1.code === 0, `probe child exited ${async1.code} (${async1.stderr.slice(-300)})`);
      assertTrue(async1.stdout.trim() === MARKER, `probe child did not receive the served marker: ${async1.stdout.slice(0, 120)}`);
      return { durationMs: async1.durationMs, timeoutMs: async1.timeoutMs };
    });
    const hitsAfterAsync = hits.length;
    ch.check('DL2', 'the evaluator event loop kept running while the child ran, and the in-process server actually served it', () => {
      assertTrue(hitsAfterAsync >= 1, 'the in-process server never served the child (it was not reached)');
      assertTrue(ticks >= 5, `the evaluator event loop stalled during the child: only ${ticks} timer ticks in ${async1.durationMs}ms`);
      return { ticks, served: hitsAfterAsync };
    });
    ch.check('DL3', 'discriminating negative control: the FROZEN DEFECT pattern (execFileSync + same-process loopback) provably deadlocks and is killed by its own bound; the server serves nothing', () => {
      const before = hits.length;
      let failure = null;
      try {
        execFileSync(process.execPath, [file, url, MARKER], {
          timeout: 3_000, killSignal: 'SIGKILL', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) { failure = error; }
      assertTrue(failure, 'a synchronous child was served by the server it was blocking — this probe no longer discriminates, so the deadlock regression is undetectable');
      assertTrue(failure.signal === 'SIGKILL' || /ETIMEDOUT/.test(String(failure.errno ?? failure.code ?? failure.message)),
        `synchronous child failed for an unexpected reason (not the deadlock): ${failure.message.slice(0, 200)}`);
      assertTrue(hits.length === before, `the blocked event loop somehow served ${hits.length - before} request(s)`);
      return { killedBy: failure.signal ?? String(failure.errno ?? failure.code) };
    });
    await ch.checkAsync('DL4', 'no frozen eval-owned path launches a SYNCHRONOUS external child — DIRECTLY (execFileSync/spawnSync carrying the double or a production coordinator/CLI) or INDIRECTLY (an imported production wrapper whose default spawns the coordinator/CLI, with no injected async seam)', async () => {
      const files = fs.readFileSync(path.join(repoRoot, MANIFEST), 'utf8').split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .map((line) => line.trim().split(/\s+/)[1]);
      assertTrue(files.length > 0, 'the frozen manifest listed no eval-owned files to scan');
      const direct = [];
      const indirect = [];
      for (const relative of files) {
        const code = stripComments(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
        direct.push(...directOffenders(code, relative));
        indirect.push(...indirectOffenders(code, relative));
      }
      assertTrue(direct.length === 0, `same-process loopback + DIRECT synchronous external child reintroduced: ${direct.join('; ')}`);
      assertTrue(indirect.length === 0, `same-process loopback + INDIRECT synchronous child through a production wrapper: ${indirect.join('; ')}`);
      return { scanned: files.length, wrappers: PRODUCTION_SYNC_SPAWN_WRAPPERS.map((wrapper) => wrapper.name) };
    });
    ch.check('DL4b', 'the DL4 scan still DISCRIMINATES in both directions: a seamless production-wrapper call is flagged, the same call with the injected async seam is not, a direct sync child carrying the double is flagged, and a wrapper named only in prose or inside a string literal is not', () => {
      const wrapper = PRODUCTION_SYNC_SPAWN_WRAPPERS.find((entry) => entry.seam);
      assertTrue(wrapper, 'no production wrapper with an injectable async seam is registered — the indirect scan cannot discriminate');
      const payload = "{ repoRoot: clone, repo: REPO, runId: 'r', topicKey: 't', terminal: 'MONITOR_TIMEOUT' }";
      const seamless = `await prod.${wrapper.name}(${payload});`;
      const seamed = `await prod.${wrapper.name}(${payload}, seam.fn);`;
      const prose = `// the eval must never call ${wrapper.name}() without a seam\nconst x = 1;`;
      const sync = "execFileSync('node', [script], { env: scenario.env });";
      const quoted = 'const doc = "execFileSync(process.execPath, [s], { env: scenario.env })";';
      assertTrue(indirectOffenders(stripComments(seamless), 'synthetic').length === 1,
        'the indirect scan did NOT flag a production-wrapper call that takes the synchronous default — the fifth-correction regression is undetectable');
      assertTrue(indirectOffenders(stripComments(seamed), 'synthetic').length === 0,
        'the indirect scan flagged a call that DOES inject the async seam — it would fail every correct frozen path');
      assertTrue(indirectOffenders(stripComments(prose), 'synthetic').length === 0,
        'the indirect scan flagged a wrapper named only in a comment — prose is not a call');
      assertTrue(directOffenders(stripComments(sync), 'synthetic').length === 1,
        'the direct scan no longer flags a synchronous child carrying the double');
      assertTrue(directOffenders(stripComments(`// ${sync}`), 'synthetic').length === 0,
        'the direct scan flagged a synchronous child that appears only in a comment');
      assertTrue(directOffenders(stripComments(quoted), 'synthetic').length === 0,
        'the direct scan flagged a call SPELLED inside a string literal — documentation and registry prose are not calls');
      return { wrapper: wrapper.name, seam: wrapper.seam };
    });
    await ch.checkAsync('DL5', 'the bounded per-call timeout fires, the process group is reaped, and a non-settling child is REJECTED rather than reported as a pass', async () => {
      const stuck = await runExternal(process.execPath, [never], { timeoutMs: 1_500, label: 'DL5-never-exits' });
      assertTrue(stuck.timedOut === true, 'a child that never exits was not stopped by the per-call bound');
      assertTrue(stuck.durationMs < 15_000, `the bound did not fire promptly (${stuck.durationMs}ms)`);
      let rejected = false;
      try { assertSettled(stuck, 'DL5 never-exits child'); } catch (error) {
        rejected = /EVALUATOR_CHILD_DEADLINE/.test(error.message);
      }
      assertTrue(rejected, 'assertSettled accepted a timed-out child as evidence (nonhang would be treated as completion)');
      return { durationMs: stuck.durationMs, signal: stuck.signal };
    });
    // DL6 — bounded DYNAMIC reproduction of the exact C-N13-outcome shape against
    // the REAL production wrapper. A stub coordinator is planted at the exact path
    // production resolves, so the whole production chain runs; only the repo root
    // is synthetic. No credential, no network beyond 127.0.0.1, no model token.
    const RECORD = PRODUCTION_SYNC_SPAWN_WRAPPERS.find((entry) => entry.seam);
    const outcomePayload = {
      repoRoot: stubRepo, repo: 'acceptance/deadlock-probe', runId: 'dl6-run',
      topicKey: 'dl6-topic', terminal: 'MONITOR_TIMEOUT', reason: 'DL6 bounded dynamic C-N13-outcome probe',
    };
    let hostRun = null;
    await ch.checkAsync('DL6-import', 'the production host-run wrapper under test imports and exports the outcome recorder the C-N13-outcome check drives', async () => {
      hostRun = await import(pathToFileURL(path.join(repoRoot, 'scripts/supervisor/host-run.mjs')).href);
      assertTrue(typeof hostRun?.[RECORD.name] === 'function', `${RECORD.module} does not export ${RECORD.name}`);
      return { wrapper: RECORD.name, seam: RECORD.seam, reaches: RECORD.reaches };
    });
    await ch.checkAsync('DL6-negative', `discriminating negative control: calling production ${RECORD.name} WITHOUT its ${RECORD.seam} seam takes the synchronous default, and the in-process server is provably served nothing while it blocks`, async () => {
      const beforeHits = hits.length;
      const beforeDurable = durable.length;
      const startedAt = Date.now();
      let failure = null;
      // Synchronous window: nothing below runs the event loop, so these two
      // counters are read at the instant the blocked call gives up.
      try { hostRun[RECORD.name](outcomePayload); } catch (error) { failure = error; }
      const servedWhileBlocked = hits.length - beforeHits;
      const recordedWhileBlocked = durable.length - beforeDurable;
      const blockedMs = Date.now() - startedAt;
      assertTrue(failure, `the synchronous production default was SERVED by the server it was blocking after ${blockedMs}ms — this probe no longer discriminates, so the indirect deadlock is undetectable`);
      assertTrue(servedWhileBlocked === 0, `the blocked event loop somehow served ${servedWhileBlocked} request(s)`);
      assertTrue(recordedWhileBlocked === 0, 'a durable outcome was recorded while the checker was deadlocked');
      assertTrue(blockedMs >= 2_000, `the child did not actually wait on the blocked server (${blockedMs}ms) — the reproduction is not the deadlock`);
      return { blockedMs, servedWhileBlocked, failure: failure.message.split('\n')[0].slice(0, 160) };
    });
    // Let any request the aborted child left in the kernel queue drain, so DL6's
    // positive baseline counts only what the seam-driven child causes.
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    await ch.checkAsync('DL6', `bounded dynamic C-N13-outcome probe: production ${RECORD.name} driven through its EXISTING ${RECORD.seam} seam COMPLETES, is served by the in-process double, maps every argument, leaves a durable MONITOR_TIMEOUT record, and leaves no orphan process`, async () => {
      const beforeHits = hits.length;
      const seam = asyncCoordinatorSeam({ env: { ...process.env }, label: 'DL6' });
      const outputs = await hostRun[RECORD.name](outcomePayload, seam.fn);
      assertTrue(seam.calls.length === 1, `production drove ${seam.calls.length} coordinator invocations, expected exactly 1`);
      const [call] = seam.calls;
      assertSettled(call.result, 'DL6 coordinator');
      assertTrue(call.result.timedOut === false, 'the seam-driven child hit its bound instead of completing');
      assertTrue(call.result.code === 0, `coordinator exited ${call.result.code}: ${(call.result.stderr || '').slice(-300)}`);
      assertTrue(hits.length > beforeHits, 'the in-process server never served the seam-driven child');
      assertTrue(call.repoRoot === stubRepo, `production passed repoRoot ${call.repoRoot}`);
      assertTrue(call.argv[0] === 'record-candidate-outcome', `production drove subcommand ${call.argv[0]}`);
      const flags = {};
      for (let index = 1; index < call.argv.length; index += 1) {
        if (String(call.argv[index]).startsWith('--')) flags[call.argv[index]] = call.argv[index + 1];
      }
      for (const [flag, expected] of [
        ['--kind', 'blog'], ['--outcome', 'MONITOR_TIMEOUT'], ['--key', outcomePayload.runId],
        ['--topic-key', outcomePayload.topicKey], ['--repo', outcomePayload.repo],
        ['--reason', hostRun.boundedOutcomeReason(outcomePayload.reason)],
      ]) {
        assertTrue(flags[flag] === expected, `production mapped ${flag} to ${JSON.stringify(flags[flag] ?? null)}, expected ${JSON.stringify(expected)}`);
      }
      assertTrue(outputs?.recorded === 'true', `the wrapper returned no durable record: ${JSON.stringify(outputs)}`);
      const record = durable.find((entry) => entry.key === outcomePayload.runId);
      assertTrue(record && record.outcome === 'MONITOR_TIMEOUT' && record.topic === outcomePayload.topicKey,
        `no durable MONITOR_TIMEOUT record reached the double: ${JSON.stringify(durable)}`);
      const orphans = seam.orphans();
      assertTrue(orphans.length === 0, `coordinator child processes survived the bounded seam: ${orphans.join(', ')}`);
      return { durationMs: call.result.durationMs, exitCode: call.result.code, outcome: record.outcome, pid: call.result.pid };
    });
  } finally {
    await new Promise((resolve) => { server.close(resolve); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return ch;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ch = await deadlockProbePhase();
  for (const result of ch.results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} [deadlock-probes] ${result.id}: ${result.description}${result.ok ? '' : ` — ${result.error}`}`);
  }
  process.exitCode = ch.ok ? 0 : 1;
}
