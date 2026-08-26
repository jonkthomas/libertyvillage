#!/usr/bin/env node
// Local live-model supervisor acceptance gate — serial orchestrator.
// Eval-owned; FROZEN by evals/local-supervisor-acceptance.sha256. Spec:
// /tmp/lv-supervisor-local-acceptance-spec.md (sha256 3ed29573…).
// Sixth eval-owner freeze: EXACT spawn-log selectors (the log is SHARED with the
// baseline suites, which drive fixture children of the very same shape) on top of
// the fifth freeze's bounded ASYNC children. Phase order: manifest → parser probes →
// deadlock probes → Design C static contracts → environment preflight →
// live/negative/mutation/hitchhiker/RED scenarios. Everything before the
// environment phase runs with no credential and no network, so on a pre-Design-C
// tree (710ea82) this evaluator is RED — missing PUBLISHED_MAIN terminal,
// blog-live kind (C-N1 lane), production Vercel wait (C-N13), PR-shaped sync
// (C-N14) — without spending a model token. Every phase must pass to be GREEN.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  APPROVED_LIVE_ROUTE, Checks, assertLiveRoute, assertTrue, renderReport,
  scanForLiteral, shredFile,
} from './helpers/acceptance-evidence.mjs';
import { parserProbePhase } from './local-acceptance-probes.eval.mjs';
import { deadlockProbePhase } from './local-acceptance-deadlock.eval.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(REPO_ROOT, 'evals/local-supervisor-acceptance.sha256');
export const EVAL_OWNED_PATHS = Object.freeze([
  'tests/supervisor/local-acceptance.eval.mjs',
  'tests/supervisor/local-acceptance-happy.eval.mjs',
  'tests/supervisor/local-acceptance-mutations.eval.mjs',
  'tests/supervisor/local-acceptance-negatives.eval.mjs',
  'tests/supervisor/local-acceptance-red.eval.mjs',
  'tests/supervisor/local-acceptance-live-ship.eval.mjs',
  'tests/supervisor/local-acceptance-probes.eval.mjs',
  'tests/supervisor/local-acceptance-deadlock.eval.mjs',
  'tests/supervisor/helpers/fake-supervisor-github.mjs',
  'tests/supervisor/helpers/fake-supervisor-protection.mjs',
  'tests/supervisor/helpers/local-git-fixture.mjs',
  'tests/supervisor/helpers/acceptance-evidence.mjs',
  'tests/supervisor/helpers/acceptance-scenario.mjs',
  'tests/supervisor/helpers/acceptance-live-proof.mjs', 'tests/supervisor/helpers/acceptance-exec.mjs',
  'tests/supervisor/helpers/acceptance-selectors.mjs',
]);

const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const sha256 = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, relative))).digest('hex');
const importProd = (relative) => import(pathToFileURL(path.join(REPO_ROOT, relative)).href);
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();

function manifestPhase() {
  const ch = new Checks('manifest');
  ch.check('M1', 'frozen manifest exists and lists exactly the eval-owned files', () => {
    const lines = read('evals/local-supervisor-acceptance.sha256').split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'));
    const listed = lines.map((line) => line.trim().split(/\s+/)[1]).sort();
    if (JSON.stringify(listed) !== JSON.stringify([...EVAL_OWNED_PATHS].sort())) {
      throw new Error(`manifest paths drifted: ${listed.join(', ')}`);
    }
    return { entries: lines.length };
  });
  ch.check('M2', 'every eval-owned file matches its frozen sha256 (builder cannot alter the checker)', () => {
    const expected = new Map(read('evals/local-supervisor-acceptance.sha256').split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => { const [hash, file] = line.trim().split(/\s+/); return [file, hash]; }));
    const drifted = [...expected].filter(([file, hash]) => sha256(file) !== hash).map(([file]) => file);
    if (drifted.length) throw new Error(`eval-owned files were modified after freeze: ${drifted.join(', ')}`);
    return { verified: expected.size, command: `shasum -a 256 -c ${path.relative(REPO_ROOT, MANIFEST)}` };
  });
  return ch;
}

// Design C static contracts: production modules are imported and CALLED, so a
// missing kind/terminal/switch fails at a real function boundary, not prose.
async function staticPhase() {
  const ch = new Checks('design-c-static');
  let constants = null; let promotion = null; let ledger = null; let piSession = null; let policy = null;
  await ch.checkAsync('S0', 'production automation/supervisor modules import', async () => {
    constants = await importProd('scripts/automation/constants.mjs');
    promotion = await importProd('scripts/automation/promotion-control.mjs');
    policy = await importProd('scripts/automation/policy.mjs');
    ledger = await importProd('scripts/supervisor/ledger.mjs');
    piSession = await importProd('scripts/supervisor/pi-session.mjs');
    return null;
  });
  ch.check('S1', 'KIND_POLICIES has the exact blog-live kind (base=main) and does not mutate blog/promotion [C-N1 lane]', () => {
    const live = constants?.KIND_POLICIES?.['blog-live'];
    assertTrue(live, 'KIND_POLICIES is missing blog-live — the content-only main lane does not exist');
    assertTrue(live.base === 'main', `blog-live base must be main, observed ${live.base}`);
    assertTrue(JSON.stringify(live.headPrefixes) === JSON.stringify(['blog/auto-']), 'blog-live headPrefixes drifted');
    assertTrue(JSON.stringify(live.allowedPaths) === JSON.stringify(['data/posts.json', 'public/images/blog/']), 'blog-live allowedPaths drifted');
    assertTrue(JSON.stringify(live.repairablePaths) === JSON.stringify(['data/posts.json']), 'blog-live repairablePaths drifted');
    assertTrue(live.maxFiles === 20 && live.maxRepairBytes === 300_000, 'blog-live budgets drifted');
    assertTrue(constants.KIND_POLICIES.blog.base === 'staging', 'blog kind base must remain staging');
    assertTrue(constants.KIND_POLICIES.promotion.exactHead === 'staging', 'promotion exactHead must remain staging');
    const paths = policy.validatePaths('blog-live', ['data/posts.json']);
    assertTrue(paths.ok === true, `validatePaths('blog-live') refused a blog path: ${paths.errors?.join('; ')}`);
    return null;
  });
  ch.check('S2', 'STATUS_CONTEXTS split publish vs wait; Vercel is wait-only [C-N8/P5]', () => {
    const contexts = constants?.STATUS_CONTEXTS;
    assertTrue(contexts?.publish, 'STATUS_CONTEXTS.publish is missing — coordinator may still forge any context');
    assertTrue(contexts.publish.ci === 'automation/ci' && contexts.publish.gate === 'automation/opus-gate', 'publish contexts drifted');
    assertTrue(!Object.values(contexts.publish).includes('Vercel'), 'Vercel must not be a coordinator publish context');
    assertTrue(contexts.wait?.vercel === 'Vercel', 'STATUS_CONTEXTS.wait must include the Vercel context');
    return null;
  });
  await ch.checkAsync('S3', 'promotion stays off under exedev; contentShipEnabled exists and fails closed [C-N4/C-N12]', async () => {
    const ownerFile = path.join(os.tmpdir(), `lv-accept-owner-${process.pid}.txt`);
    fs.writeFileSync(ownerFile, 'exedev\n');
    try {
      assertTrue(promotion.promotionEnabled({ LV_WEEKLY_OWNER: 'exedev', LV_PROMOTION_ENABLED: 'true' }, { ownerFile, owner: 'exedev' }) === false,
        'promotionEnabled must stay false while owner is exedev');
      assertTrue(typeof promotion.contentShipEnabled === 'function', 'contentShipEnabled is missing — the content-ship emergency lever does not exist');
      assertTrue(promotion.contentShipEnabled({ LV_WEEKLY_OWNER: 'exedev' }, { ownerFile, owner: 'exedev' }) === true,
        'contentShipEnabled must be true under exedev with no override');
      let emergency;
      try {
        emergency = promotion.contentShipEnabled({ LV_WEEKLY_OWNER: 'exedev', LV_CONTENT_SHIP_ENABLED: 'false' }, { ownerFile, owner: 'exedev' });
      } catch { emergency = false; }
      assertTrue(emergency === false, 'LV_CONTENT_SHIP_ENABLED=false must fail closed');
      fs.writeFileSync(ownerFile, 'gha\n');
      let ghaOwner;
      try { ghaOwner = promotion.contentShipEnabled({}, { ownerFile, owner: 'gha' }); } catch { ghaOwner = false; }
      assertTrue(ghaOwner === false, 'contentShipEnabled must be false when the owner is gha');
    } finally { fs.rmSync(ownerFile, { force: true }); }
    return null;
  });
  ch.check('S4', 'ledger terminal taxonomy gains PUBLISHED_MAIN (and only that success) [happy/C-N13]', () => {
    assertTrue(ledger.TERMINALS.includes('PUBLISHED_MAIN'), 'TERMINALS is missing PUBLISHED_MAIN — the program success token does not exist');
    assertTrue(ledger.TERMINALS.includes('MERGED_STAGING'), 'MERGED_STAGING must remain a legacy/recovery terminal');
    assertTrue(!ledger.TERMINALS.includes('SYNC_FAILED'), 'SYNC_FAILED must not exist as a success-adjacent terminal');
    const row = ledger.terminalizeRun({ run_id: 'x', pr_number: null }, 'PUBLISHED_MAIN', {});
    assertTrue(row.terminal === 'PUBLISHED_MAIN', 'terminalizeRun refused PUBLISHED_MAIN');
    return null;
  });
  ch.check('S5', 'cli/sha-monitor/terminal-pr reference PUBLISHED_MAIN; MERGED_STAGING is not the blog-live exit-0 print', () => {
    for (const file of ['scripts/supervisor/cli.mjs', 'scripts/supervisor/sha-monitor.mjs', 'scripts/supervisor/terminal-pr.mjs']) {
      assertTrue(read(file).includes('PUBLISHED_MAIN'), `${file} never mentions PUBLISHED_MAIN`);
    }
    return null;
  });
  ch.check('S6', 'generation prompt explicitly requires publishedAt AND updatedAt to equal ONE frozen exact UTC run date (not loose token presence)', () => {
    const before = new Date().toISOString().slice(0, 10);
    const prompt = piSession.buildGeneratorPrompt({ topic: { key: 'k', title: 't', source: 's', rationale: 'r' }, contextFiles: [] });
    const after = new Date().toISOString().slice(0, 10);
    const dates = [...new Set([before, after])];
    let bound = false;
    const re = /publishedAt/g;
    let match;
    while ((match = re.exec(prompt))) {
      const window = prompt.slice(Math.max(0, match.index - 240), match.index + 320);
      if (window.includes('updatedAt') && dates.some((date) => window.includes(date)) && /exact|equal|must be|must use|set .* to/i.test(window)) {
        bound = true;
        break;
      }
    }
    assertTrue(bound, `no single prompt passage requires publishedAt AND updatedAt to equal the exact UTC run date ${dates.join('/')}`);
    for (const window of prompt.match(/publishedAt[^]{0,320}/g) || []) {
      const found = window.match(/\d{4}-\d{2}-\d{2}/g) || [];
      assertTrue(found.every((date) => dates.includes(date)), `a different date (${found.join(', ')}) is bound to publishedAt/updatedAt`);
    }
    return { date: dates[0] };
  });
  ch.check('S7', 'production model defaults are unchanged and gateway values never leak into them', () => {
    const host = read('scripts/supervisor/host-run.mjs');
    assertTrue(host.includes("process.env.PI_PROVIDER || 'openai'"), 'provider default drifted');
    assertTrue(host.includes("process.env.PI_MODEL || 'gpt-5.6-sol'"), 'model default drifted');
    assertTrue(host.includes("process.env.PI_BASE_URL || 'https://llm.int.exe.xyz/v1'"), 'base URL default drifted');
    for (const file of ['scripts/supervisor/host-run.mjs', 'ops/exedev-supervisor/lv-supervisor.env.example']) {
      const text = read(file);
      assertTrue(!text.includes('ai-gateway.vercel.sh') && !text.includes('lv-vercel-acceptance'), `gateway route leaked into ${file}`);
    }
    return null;
  });
  ch.check('S8', 'PR-shaped sync exists and no automation path direct-pushes a protected branch [C-N14/P13]', () => {
    const coordinatorText = read('scripts/automation/coordinator.mjs');
    const workflowText = read('.github/workflows/autonomous-coordinator.yml');
    for (const [name, text] of [['coordinator.mjs', coordinatorText], ['autonomous-coordinator.yml', workflowText]]) {
      assertTrue(!/git push origin (staging|main)\b/.test(text) && !/git push .*HEAD:(staging|main)\b/.test(text),
        `${name} direct-pushes a protected branch`);
    }
    assertTrue(/observe-and-sync-staging/.test(coordinatorText + workflowText), 'observe-and-sync-staging path is missing');
    assertTrue(/sync\/main-/.test(coordinatorText + workflowText), 'sync/main-<sha> head naming is missing');
    const ingestText = read('.github/workflows/supervisor-ingest.yml');
    assertTrue(/blog-live/.test(ingestText), 'supervisor-ingest.yml never dispatches kind blog-live');
    assertTrue(/origin\/main/.test(ingestText) && /--base main|base:\s*main/.test(ingestText), 'supervisor-ingest.yml does not transplant onto main');
    assertTrue(/blog-live/.test(workflowText), 'autonomous-coordinator.yml has no blog-live lane');
    return null;
  });
  ch.check('S9', 'pass-promotion keeps gh pr merge --auto --merge and never squash/rebase (human infra path)', () => {
    const text = read('.github/workflows/autonomous-coordinator.yml');
    const start = text.indexOf('\n  pass-promotion:');
    assertTrue(start >= 0, 'missing pass-promotion job');
    const rest = text.slice(start + 1);
    const next = rest.search(/\n {2}[A-Za-z0-9_-]+:/);
    const job = next < 0 ? rest : rest.slice(0, next);
    assertTrue(/gh pr merge .*--auto --merge/.test(job), 'pass-promotion missing gh pr merge --auto --merge');
    assertTrue(!/gh pr merge .*--(squash|rebase)/.test(job), 'pass-promotion uses squash/rebase');
    assertTrue(!/gh pr merge .*--(squash|rebase)/.test(text), 'a coordinator merge uses squash/rebase');
    return null;
  });
  ch.check('S10', 'package script test:supervisor:acceptance invokes this frozen evaluator and stays out of unit CI', () => {
    const pkg = JSON.parse(read('package.json'));
    assertTrue(pkg.scripts?.['test:supervisor:acceptance'] === 'node tests/supervisor/local-acceptance.eval.mjs',
      'test:supervisor:acceptance script is missing or does not invoke the frozen evaluator');
    assertTrue(!String(pkg.scripts['test:supervisor']).includes('eval'), 'test:supervisor must not run the live evaluator');
    return null;
  });
  return ch;
}

async function environmentPhase(context) {
  const ch = new Checks('environment');
  ch.check('E1', 'source checkout is clean at the commit under test', () => {
    const status = run('git', ['status', '--short'], { cwd: REPO_ROOT });
    assertTrue(status === '', `working tree is dirty:\n${status}`);
    return { sourceSha: context.sourceSha };
  });
  ch.check('E2', 'pi CLI is the pinned 0.84.2', () => {
    const version = run('pi', ['--version']);
    assertTrue(version === '0.84.2', `pi --version is ${version}`);
    return null;
  });
  await ch.checkAsync('E3', 'importable Pi SDK is exactly 0.84.2', async () => {
    const { loadPiSdk } = await importProd('scripts/supervisor/pi-session.mjs');
    const { sdk } = await loadPiSdk();
    assertTrue(sdk.VERSION === '0.84.2', `SDK version ${sdk.VERSION}`);
    return null;
  });
  await ch.checkAsync('E4', 'npm registry reachable (NPM_REGISTRY_UNREACHABLE otherwise)', async () => {
    try { run('npm', ['ping'], { timeout: 30_000 }); } catch (error) {
      throw new Error(`NPM_REGISTRY_UNREACHABLE: ${error.message.split('\n')[0]}`);
    }
    return null;
  });
  ch.check('E5', 'operator armed the live gate: LV_LIVE_MODEL_ACCEPTANCE=1 and PI_API_KEY present', () => {
    assertTrue(process.env.LV_LIVE_MODEL_ACCEPTANCE === '1', 'LV_LIVE_MODEL_ACCEPTANCE=1 is required for the live run');
    assertTrue(Boolean(process.env.PI_API_KEY), 'LIVE_AUTH_UNAVAILABLE: PI_API_KEY (vaulted gateway credential) is not exported');
    return null;
  });
  ch.check('E6', 'approved local live route allowlist holds; Anthropic-on-Vercel and third routes refused', () => {
    assertLiveRoute(APPROVED_LIVE_ROUTE.baseUrl ? { provider: APPROVED_LIVE_ROUTE.provider, model: APPROVED_LIVE_ROUTE.model, baseUrl: APPROVED_LIVE_ROUTE.baseUrl } : {});
    for (const bad of [
      { provider: 'vercel', model: 'claude-opus-5', baseUrl: 'https://ai-gateway.vercel.sh/v1' },
      { provider: 'lv-vercel-acceptance', model: 'openai/gpt-5.6-sol', baseUrl: 'http://127.0.0.1:9/v1' },
      { provider: 'openai', model: 'gpt-5.6-sol', baseUrl: 'https://llm.int.exe.xyz/v1' },
    ]) {
      let refused = false;
      try { assertLiveRoute(bad); } catch { refused = true; }
      assertTrue(refused, `route was not refused: ${JSON.stringify(bad)}`);
    }
    return null;
  });
  await ch.checkAsync('E7', 'resolved live model identity is recorded and api === openai-responses is ASSERTED before any report language may claim the production dialect; runtime auth.json is shredded, never recursive-deleted', async () => {
    const { loadPiSdk } = await importProd('scripts/supervisor/pi-session.mjs');
    const { sdk } = await loadPiSdk();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-accept-model-'));
    const authPath = path.join(root, 'auth.json');
    try {
      const models = { providers: { [APPROVED_LIVE_ROUTE.provider]: { baseUrl: APPROVED_LIVE_ROUTE.baseUrl, api: APPROVED_LIVE_ROUTE.api, models: [{ id: APPROVED_LIVE_ROUTE.model, name: APPROVED_LIVE_ROUTE.model }] } } };
      fs.writeFileSync(path.join(root, 'models.json'), `${JSON.stringify(models, null, 2)}\n`);
      const runtime = await sdk.ModelRuntime.create({ authPath, modelsPath: path.join(root, 'models.json') });
      runtime.registerProvider(APPROVED_LIVE_ROUTE.provider, { baseUrl: APPROVED_LIVE_ROUTE.baseUrl });
      await runtime.setRuntimeApiKey(APPROVED_LIVE_ROUTE.provider, process.env.PI_API_KEY || 'implicit');
      const model = runtime.getModel(APPROVED_LIVE_ROUTE.provider, APPROVED_LIVE_ROUTE.model);
      assertTrue(model, 'approved local live model is unavailable in the runtime');
      context.resolvedRoute = { provider: model.provider, id: model.id, api: model.api, baseUrl: model.baseUrl };
      assertTrue(model.baseUrl === APPROVED_LIVE_ROUTE.baseUrl, `unexpected resolved base ${model.baseUrl}`);
      assertTrue(model.api === 'openai-responses',
        `resolved api is ${model.api}, not openai-responses — the report must not claim the production API dialect`);
      const shredded = shredFile(authPath);
      assertTrue(shredded === true, 'runtime auth.json was not present to shred (credential handling drifted)');
      return context.resolvedRoute;
    } finally {
      try { shredFile(authPath); } catch { /* already shredded */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  return ch;
}

export function createLiveBudget() {
  const total = Number.parseInt(process.env.LV_ACCEPTANCE_LIVE_ATTEMPT_BUDGET ?? '4', 10);
  const budget = { total: Number.isInteger(total) && total > 0 ? total : 4, used: 0, perScenario: 2, log: [] };
  budget.claim = (scenario, attempt) => {
    if (attempt > budget.perScenario) throw new Error(`LIVE_GENERATION_BUDGET_EXCEEDED: ${scenario} exhausted its ${budget.perScenario} attempts`);
    if (budget.used >= budget.total) throw new Error(`LIVE_GENERATION_BUDGET_EXCEEDED: total live session cap ${budget.total} reached`);
    budget.used += 1;
    budget.log.push({ scenario, attempt, at: new Date().toISOString() });
  };
  return budget;
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf('--scenario');
  const only = onlyIndex >= 0 ? new Set(String(args[onlyIndex + 1] || '').split(',').filter(Boolean)) : null;
  const sourceSha = run('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT });
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-supervisor-acceptance-'));
  fs.chmodSync(tmpBase, 0o700);
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-supervisor-acceptance-report-'));
  fs.chmodSync(reportDir, 0o700);
  const context = {
    repoRoot: REPO_ROOT, sourceSha, tmpBase, reportDir, only,
    npmCache: path.join(tmpBase, 'npm-cache'), resolvedRoute: null, liveRouteProof: null,
    budget: createLiveBudget(), phases: [], live: new Set(),
  };
  fs.mkdirSync(context.npmCache, { recursive: true, mode: 0o700 });
  const push = (checks) => {
    context.phases.push({ phase: checks.scope, ok: checks.ok, checks: checks.results });
    for (const result of checks.results) {
      console.log(`${result.ok ? 'PASS' : 'FAIL'} [${checks.scope}] ${result.id}: ${result.description}${result.ok ? '' : ` — ${result.error}`}`);
    }
    return checks.ok;
  };
  let ok = false;
  // Top-level fail-closed finally: crashes never leave roots/servers/children.
  try {
    ok = push(manifestPhase());
    ok = push(await parserProbePhase()) && ok;
    ok = push(await deadlockProbePhase()) && ok;
    const staticOk = push(await staticPhase());
    ok = ok && staticOk;
    if (!staticOk) {
      console.error('\nRED: Design C static contracts failed on this tree — the blog-live lane, PUBLISHED_MAIN terminal, production Vercel wait, or PR-shaped sync is missing (happy path, C-N1, C-N13, C-N14). No model token was spent.');
    } else {
      const envOk = push(await environmentPhase(context));
      ok = ok && envOk;
      if (envOk) {
        const suites = [
          ['happy', './local-acceptance-happy.eval.mjs'],
          ['negatives', './local-acceptance-negatives.eval.mjs'],
          ['mutations', './local-acceptance-mutations.eval.mjs'],
          ['live-ship', './local-acceptance-live-ship.eval.mjs'],
          ['red-mocks', './local-acceptance-red.eval.mjs'],
        ];
        for (const [name, file] of suites) {
          if (only && !only.has(name)) { console.log(`SKIP [${name}] (diagnostic --scenario filter; PARTIAL run, not acceptance)`); continue; }
          const suite = await import(file);
          for (const checks of await suite.run(context)) ok = push(checks) && ok;
        }
      } else {
        ok = false;
      }
    }
  } catch (error) {
    ok = false;
    context.phases.push({ phase: 'orchestrator', ok: false, checks: [{ id: 'FATAL', description: 'suite crashed before completing', ok: false, error: error.message }] });
    console.error(`FATAL [orchestrator]: ${error.stack || error.message}`);
  } finally {
    const cleanup = new Checks('cleanup');
    const leftovers = [];
    const pendingPids = [];
    for (const scenario of [...context.live]) {
      for (const handle of scenario.handles || []) { if (handle.pid && !handle.exited) pendingPids.push(handle.pid); }
      try { scenario.forceClean(); context.live.delete(scenario); } catch (cleanError) { leftovers.push(`${scenario.name}: ${cleanError.message}`); }
    }
    for (let wait = 0; wait < 30 && pendingPids.some((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }); wait += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
    cleanup.check('CLEAN1', 'no child supervisor process survived forced cleanup', () => {
      const alive = pendingPids.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
      assertTrue(alive.length === 0, `live child pids after forced cleanup: ${alive.join(', ')}`);
      return { killed: pendingPids.length };
    });
    cleanup.check('CLEAN2', 'every scenario root and simulator server was force-cleaned', () => {
      assertTrue(leftovers.length === 0, `force-clean failures: ${leftovers.join('; ')}`);
      return null;
    });
    cleanup.check('CLEAN3', 'the evaluator temporary root is removed', () => {
      fs.rmSync(tmpBase, { recursive: true, force: true });
      assertTrue(!fs.existsSync(tmpBase), `temporary root survived: ${tmpBase}`);
      return null;
    });
    ok = push(cleanup) && ok;
    const { jsonPath, mdPath } = renderReport({
      outDir: reportDir, sourceSha, resolvedRoute: context.resolvedRoute,
      liveRouteProof: context.liveRouteProof, phases: context.phases, liveAttempts: context.budget.log,
      redactions: [process.env.PI_API_KEY],
    });
    const reportHits = scanForLiteral({ files: [jsonPath, mdPath], literal: process.env.PI_API_KEY });
    if (reportHits.length) {
      fs.rmSync(jsonPath, { force: true });
      fs.rmSync(mdPath, { force: true });
      ok = false;
      console.error(`SECRET_LEAKED into the final report (deleted): ${reportHits.join(', ')}`);
    } else {
      console.log(`\nreport: ${jsonPath}\nreport: ${mdPath}`);
    }
    if (only) { console.log('PARTIAL run (--scenario): never acceptance evidence.'); ok = false; }
    console.log(ok ? '\nACCEPTANCE GREEN' : '\nACCEPTANCE RED');
    process.exitCode = ok ? 0 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}
