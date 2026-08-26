// Eval-owned evidence machinery for the local live-model supervisor acceptance
// gate. FROZEN by evals/local-supervisor-acceptance.sha256 (maker != checker).
//
// Owns: the scrubbed child environment allowlist, the parent-owned spawn log
// (argv/cwd of every node child, which is how the trusted-linter invocation
// shape is OBSERVED rather than inferred), per-scenario deadline kill, secret
// shred + literal-credential scan, Pi JSONL tool-allowlist derivation, and the
// redacted report renderer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const APPROVED_LIVE_ROUTE = Object.freeze({
  provider: 'lv-vercel-acceptance',
  model: 'openai/gpt-5.6-sol',
  baseUrl: 'https://ai-gateway.vercel.sh/v1',
  api: 'openai-responses',
});
export const PRODUCTION_ROUTE = Object.freeze({
  provider: 'openai', model: 'gpt-5.6-sol', baseUrl: 'https://llm.int.exe.xyz/v1',
});
export const REPORT_LANGUAGE = Object.freeze({
  doubled: 'the coordinator validate → status → merge decision is doubled, not exercised, and the Vercel status was evaluator-owned',
  dialect: 'the run proves live generation on the production API dialect via the approved local gateway; it does not prove the production endpoint https://llm.int.exe.xyz/v1 is reachable; endpoint/dialect equivalence at that URL is not covered by Agent UAT',
  dialectDrift: 'the run proves live generation but not the production API surface',
});

export function assertLiveRoute({ provider, model, baseUrl }) {
  const anthropicish = /claude|anthropic/i;
  if (provider === 'vercel' || anthropicish.test(String(model)) || anthropicish.test(String(baseUrl))) {
    throw new Error(`FORBIDDEN_VERCEL_ANTHROPIC_ROUTE: ${provider}/${model} @ ${baseUrl}`);
  }
  if (provider !== APPROVED_LIVE_ROUTE.provider || model !== APPROVED_LIVE_ROUTE.model
    || baseUrl !== APPROVED_LIVE_ROUTE.baseUrl) {
    throw new Error(`LIVE_MODEL_ROUTE_REFUSED: ${provider}/${model} @ ${baseUrl} is not the approved local live route`);
  }
}

export function writeModelsJson(agentDir, { baseUrl = APPROVED_LIVE_ROUTE.baseUrl, api = APPROVED_LIVE_ROUTE.api, provider = APPROVED_LIVE_ROUTE.provider, model = APPROVED_LIVE_ROUTE.model } = {}) {
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const models = { providers: { [provider]: { baseUrl, api, models: [{ id: model, name: model }] } } };
  fs.writeFileSync(path.join(agentDir, 'models.json'), `${JSON.stringify(models, null, 2)}\n`, { mode: 0o600 });
}

// Scrubbed-by-construction child environment: an allowlist, never a filtered
// copy. Real GitHub tokens, GH_HOST, and enterprise variants can never reach
// the child because they are never copied.
export function childEnv({ apiUrl, stateDir, ledger, repo, home, spawnLog, loggerPath, proxyAuth = 'false', ownerEnv = 'exedev', npmCache, contentShip, pi = {} }) {
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: path.join(home, 'tmp'),
    LANG: process.env.LANG || 'en_US.UTF-8',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    npm_config_cache: npmCache,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    LV_STATE_DIR: stateDir,
    LV_LEDGER: ledger,
    LV_GITHUB_REPOSITORY: repo,
    GITHUB_API_URL: apiUrl,
    GH_TOKEN: 'test-token',
    LV_EXE_GITHUB_PROXY_AUTH: proxyAuth,
    NODE_OPTIONS: `--import ${pathToFileURL(loggerPath).href}`,
    LV_ACCEPT_SPAWN_LOG: spawnLog,
  };
  fs.mkdirSync(env.TMPDIR, { recursive: true, mode: 0o700 });
  if (ownerEnv !== null) env.LV_WEEKLY_OWNER = ownerEnv;
  if (contentShip !== undefined) env.LV_CONTENT_SHIP_ENABLED = contentShip;
  if (pi.provider) env.PI_PROVIDER = pi.provider;
  if (pi.model) env.PI_MODEL = pi.model;
  if (pi.baseUrl) env.PI_BASE_URL = pi.baseUrl;
  if (pi.apiKey) env.PI_API_KEY = pi.apiKey;
  if (pi.sdkPath) env.PI_SDK_PATH = pi.sdkPath;
  return env;
}

export function writeSpawnLogger(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const loggerPath = path.join(dir, 'spawn-logger.mjs');
  fs.writeFileSync(loggerPath, [
    '// Parent-owned spawn observer: records argv+cwd of every node process the',
    '// child tree starts. Read-only evidence; never alters behavior.',
    "import fs from 'node:fs';",
    'try {',
    '  const file = process.env.LV_ACCEPT_SPAWN_LOG;',
    '  if (file) fs.appendFileSync(file, `${JSON.stringify({ pid: process.pid, ppid: process.ppid, cwd: process.cwd(), argv: process.argv, at: new Date().toISOString() })}\\n`);',
    '} catch { /* evidence only */ }',
    '',
  ].join('\n'));
  return { loggerPath, spawnLog: path.join(dir, 'spawn.log.jsonl') };
}

export function readSpawnLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

export function spawnEntriesFor(entries, scriptSuffix) {
  return entries.filter((entry) => typeof entry?.argv?.[1] === 'string' && entry.argv[1].endsWith(scriptSuffix));
}

export function npmRunOrder(entries) {
  const order = [];
  for (const entry of entries) {
    const argv = entry?.argv || [];
    const npmIndex = argv.findIndex((part) => typeof part === 'string' && /npm-cli\.js$|\/npm$/.test(part));
    if (npmIndex < 0) continue;
    const rest = argv.slice(npmIndex + 1).filter((part) => !part.startsWith('-'));
    if (rest[0] === 'ci') order.push('ci');
    if (rest[0] === 'run' && rest[1]) order.push(rest[1]);
  }
  return order;
}

export async function runChildCli({ cloneDir, env, deadlineMs, maxOutput = 2 * 1024 * 1024, handle = null }) {
  const startedAt = Date.now();
  const child = spawn(process.execPath, ['scripts/supervisor/cli.mjs', 'run'], {
    cwd: cloneDir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const keep = (current, chunk) => (current.length >= maxOutput ? current : current + chunk.toString('utf8'));
  child.stdout.on('data', (chunk) => { stdout = keep(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = keep(stderr, chunk); });
  let deadlineHit = false;
  const killer = setTimeout(() => {
    deadlineHit = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
  }, deadlineMs);
  if (handle) {
    handle.pid = child.pid;
    handle.exited = false;
    handle.kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } };
  }
  const [code, signal] = await new Promise((resolve) => { child.on('close', (c, s) => resolve([c, s])); });
  clearTimeout(killer);
  if (handle) handle.exited = true;
  return { code, signal, stdout, stderr, deadlineHit, durationMs: Date.now() - startedAt };
}

export function shredFile(file) {
  if (!fs.existsSync(file)) return false;
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r+');
  try {
    fs.writeSync(fd, crypto.randomBytes(Math.max(size, 1)), 0, Math.max(size, 1), 0);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.unlinkSync(file);
  return true;
}

export function scanForLiteral({ files = [], strings = {}, literal }) {
  if (!literal) return [];
  const hits = [];
  for (const file of files) {
    try {
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(literal)) hits.push(`file:${file}`);
    } catch { hits.push(`unreadable:${file}`); }
  }
  for (const [name, value] of Object.entries(strings)) {
    if (typeof value === 'string' && value.includes(literal)) hits.push(`stream:${name}`);
  }
  return hits;
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Check collector: every acceptance observation is recorded as an id + pass/fail
// + evidence, and a single failure fails the run.
export class Checks {
  constructor(scope) { this.scope = scope; this.results = []; }
  check(id, description, fn) {
    try {
      const evidence = fn();
      this.results.push({ id, description, ok: true, evidence: evidence === undefined ? null : evidence });
      return true;
    } catch (error) {
      this.results.push({ id, description, ok: false, error: error?.message || String(error) });
      return false;
    }
  }
  async checkAsync(id, description, fn) {
    try {
      const evidence = await fn();
      this.results.push({ id, description, ok: true, evidence: evidence === undefined ? null : evidence });
      return true;
    } catch (error) {
      this.results.push({ id, description, ok: false, error: error?.message || String(error) });
      return false;
    }
  }
  note(id, description, evidence) { this.results.push({ id, description, ok: true, evidence }); }
  get failed() { return this.results.filter((result) => !result.ok); }
  get ok() { return this.failed.length === 0; }
}

export function assertEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}: expected ${right}, observed ${left}`);
}

export function assertTrue(value, label) {
  if (!value) throw new Error(label);
  return true;
}

export function renderReport({ outDir, sourceSha, resolvedRoute, liveRouteProof, phases, liveAttempts, redactions = [] }) {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  // The production-dialect sentence may be emitted ONLY after the exact live
  // proof: a VERIFIED child session whose resolved provider/id/api/baseUrl all
  // equal the approved route with api openai-responses (the same four-field
  // proof the B3/N5-live3 check enforces). An evaluator-side runtime probe or
  // anything less uses the drift wording.
  const proven = Boolean(liveRouteProof
    && liveRouteProof.provider === APPROVED_LIVE_ROUTE.provider
    && liveRouteProof.id === APPROVED_LIVE_ROUTE.model
    && liveRouteProof.baseUrl === APPROVED_LIVE_ROUTE.baseUrl
    && liveRouteProof.api === 'openai-responses');
  const dialectLine = proven ? REPORT_LANGUAGE.dialect : REPORT_LANGUAGE.dialectDrift;
  const report = {
    generated_at: new Date().toISOString(),
    source_sha: sourceSha,
    resolved_route: resolvedRoute ?? null,
    live_route_proof: liveRouteProof ?? null,
    language: { doubled: REPORT_LANGUAGE.doubled, dialect: dialectLine },
    live_attempts: liveAttempts,
    phases: phases.map((phase) => ({
      phase: phase.phase, ok: phase.ok,
      checks: phase.checks.map((check) => ({ ...check })),
    })),
  };
  let text = JSON.stringify(report, null, 2);
  for (const secret of redactions) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  const jsonPath = path.join(outDir, 'acceptance-report.json');
  fs.writeFileSync(jsonPath, `${text}\n`, { mode: 0o600 });
  const lines = [`# Local supervisor acceptance report`, '', `- source: ${sourceSha}`, `- generated: ${report.generated_at}`, ''];
  for (const phase of report.phases) {
    lines.push(`## ${phase.phase} — ${phase.ok ? 'PASS' : 'FAIL'}`);
    for (const check of phase.checks) {
      lines.push(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.description}${check.ok ? '' : ` — ${check.error}`}`);
    }
    lines.push('');
  }
  lines.push(`> ${REPORT_LANGUAGE.doubled}.`, '', `> ${dialectLine}.`, '');
  let md = lines.join('\n');
  for (const secret of redactions) {
    if (secret) md = md.split(secret).join('[REDACTED]');
  }
  const mdPath = path.join(outDir, 'acceptance-report.md');
  fs.writeFileSync(mdPath, md, { mode: 0o600 });
  return { jsonPath, mdPath };
}

// Defensive loader for the production exports the doubles and checkers reuse.
// A missing export (pre-Design-C tree) surfaces as a scenario failure, never a crash.
export async function loadProd(repoRoot) {
  const load = async (relative) => {
    try { return await import(pathToFileURL(path.join(repoRoot, relative)).href); } catch { return {}; }
  };
  const [policy, ingest, promotion, candidateState, ledger, piSession, recovery, shaMonitor, terminalPr, hostRun, monitor, blogLint, sentinel] = await Promise.all([
    load('scripts/automation/policy.mjs'), load('scripts/supervisor/ingest-contract.mjs'),
    load('scripts/automation/promotion-control.mjs'), load('scripts/automation/candidate-state.mjs'),
    load('scripts/supervisor/ledger.mjs'), load('scripts/supervisor/pi-session.mjs'),
    load('scripts/automation/recovery.mjs'), load('scripts/supervisor/sha-monitor.mjs'),
    load('scripts/supervisor/terminal-pr.mjs'), load('scripts/supervisor/host-run.mjs'),
    load('scripts/supervisor/github-monitor.mjs'), load('scripts/blog-lint.mjs'),
    load('scripts/supervisor/sentinel.mjs'),
  ]);
  return {
    validatePaths: policy.validatePaths, validatePullRequest: policy.validatePullRequest, isExactSha: policy.isExactSha,
    validateIngestPayload: ingest.validateIngestPayload, validateIngestDiff: ingest.validateIngestDiff,
    contentShipEnabled: promotion.contentShipEnabled, promotionEnabled: promotion.promotionEnabled,
    emptyCandidateState: candidateState.emptyCandidateState, renderCandidateState: candidateState.renderCandidateState,
    readLedger: ledger.readLedger, TERMINALS: ledger.TERMINALS,
    PI_TOOL_ALLOWLIST: piSession.PI_TOOL_ALLOWLIST, validateSubmittedPost: piSession.validateSubmittedPost,
    parseAuditRecord: recovery.parseAuditRecord, statusForExactSha: shaMonitor.statusForExactSha,
    terminalFromObservation: shaMonitor.terminalFromObservation, MONITOR_LIMIT_MS: shaMonitor.MONITOR_LIMIT_MS,
    finalizeOwnedPr: terminalPr.finalizeOwnedPr, terminalRequiresCandidateOutcome: terminalPr.terminalRequiresCandidateOutcome,
    boundedOutcomeReason: hostRun.boundedOutcomeReason, monitorOwnedPr: hostRun.monitorOwnedPr,
    recordSupervisorOutcome: hostRun.recordSupervisorOutcome,
    evaluateSentinel: sentinel.evaluateSentinel, activeOwnedRuns: sentinel.activeOwnedRuns,
    latestAuditForSha: monitor.latestAuditForSha, resolveLintMode: blogLint.resolveLintMode, lintPost: blogLint.lintPost,
  };
}

// Shared loopback GitHub client for evaluator-driven production-function calls
// (finalizeOwnedPr, monitor observations) against the double.
export function httpClient(apiUrl) {
  return async (apiPath, { method = 'GET', body } = {}) => {
    const response = await fetch(`${apiUrl}${apiPath}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`double ${method} ${apiPath} failed (${response.status}): ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}
