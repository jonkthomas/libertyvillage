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
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Checks, assertTrue } from './helpers/acceptance-evidence.mjs';
import { assertSettled, runExternal } from './helpers/acceptance-exec.mjs';

const MARKER = 'LV-DEADLOCK-PROBE-OK';
const MANIFEST = 'evals/local-supervisor-acceptance.sha256';
// Sync spawns are allowed for local git/CLI work; they must never carry the
// loopback double or launch a production coordinator/CLI that speaks to it.
const SYNC_SPAWNS = Object.freeze(['execFileSync', 'spawnSync']);
const LOOPBACK_MARKERS = Object.freeze([
  'scenario.env', 'GITHUB_API_URL', 'apiUrl', 'coordinator.mjs', 'supervisor/cli.mjs',
]);

// Extracts the full source of each `name(...)` call, skipping quoted strings so
// a parenthesis inside a literal can never end the scan early. A call whose
// parentheses never balance slices to EOF and therefore fails closed.
function callExpressions(text, name) {
  const found = [];
  const needle = `${name}(`;
  for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + 1)) {
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

export async function deadlockProbePhase() {
  const ch = new Checks('deadlock-probes');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-accept-deadlock-'));
  fs.chmodSync(dir, 0o700);
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url);
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(MARKER);
  });
  try {
    const url = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/probe`));
    });
    const { file, never } = writeProbeChild(dir);
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
    await ch.checkAsync('DL4', 'no frozen eval-owned path launches a SYNCHRONOUS external child that carries the loopback double or runs a production coordinator/CLI', async () => {
      const files = fs.readFileSync(path.join(repoRoot, MANIFEST), 'utf8').split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .map((line) => line.trim().split(/\s+/)[1]);
      assertTrue(files.length > 0, 'the frozen manifest listed no eval-owned files to scan');
      const offenders = [];
      for (const relative of files) {
        const text = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
        for (const spawnName of SYNC_SPAWNS) {
          for (const call of callExpressions(text, spawnName)) {
            const named = LOOPBACK_MARKERS.filter((marker) => call.includes(marker));
            if (named.length) offenders.push(`${relative}: ${spawnName}(...) carries ${named.join('+')}`);
          }
        }
      }
      assertTrue(offenders.length === 0, `same-process loopback + synchronous external child reintroduced: ${offenders.join('; ')}`);
      return { scanned: files.length };
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
