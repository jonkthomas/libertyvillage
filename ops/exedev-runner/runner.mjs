import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const JOBS = Object.freeze({
  'topic-discovery': { calendar: 'Mon *-*-* 10:00:00 UTC', kind: 'topic-discovery' },
  'seo-improvements': { calendar: 'Mon *-*-* 10:11:00 UTC', kind: 'seo' },
  'discover-businesses': { calendar: 'Mon *-*-* 13:00:00 UTC', kind: 'business' },
  news: { calendar: '*-*-* 12:17:00 UTC', kind: 'news' },
  'weekly-growth-report': { calendar: 'Thu *-*-* 10:37:00 UTC', kind: null },
  'weekly-blog': { calendar: 'Sun,Wed *-*-* 11:00:00 UTC', kind: 'blog' },
  // On-demand only (no timer): staging until John authorizes production.
  'weekly-roundup': { calendar: null, kind: 'roundup', stagingOnly: true },
});
export const PUBLIC_REMOTE = 'https://github.com/jonkthomas/libertyvillage.git';
const BASE_ENV = ['PATH', 'HOME', 'LANG', 'TZ', 'NODE_ENV'];
const DB_ENV = ['CONTENT_DATABASE_URL', 'CONTENT_DATABASE_URL_UNPOOLED', 'CONTENT_DB_NAME', 'CONTENT_TARGET', 'CONTENT_SITE_URL', 'CONTENT_SITE_BYPASS', 'CONTENT_DEPLOY_HOOK_URL', 'SLACK_WEBHOOK_URL'];
const SOURCE_ENV = {
  'topic-discovery': ['GOOGLE_APPLICATION_CREDENTIALS', 'POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE', 'SERPAPI_API_KEY'],
  'discover-businesses': ['SERPAPI_API_KEY', 'PEXELS_API_KEY'],
  news: ['SERPAPI_API_KEY', 'SERPER_API_KEY', 'ANTHROPIC_API_KEY', 'BYTEPLUS_API_KEY', 'ARK_API_KEY', 'DEEPSEEK_API_KEY', 'GOOGLE_API_KEY'],
  'weekly-growth-report': ['GOOGLE_APPLICATION_CREDENTIALS', 'POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE'],
  // APIFY_API_TOKEN (Instagram provider) is scoped to this source process only:
  // never trustedEnv, the generator, the gate or any other job (spec §4.4).
  'weekly-roundup': ['SERPER_API_KEY', 'APIFY_API_TOKEN', 'ANTHROPIC_API_KEY', 'BYTEPLUS_API_KEY', 'ARK_API_KEY',
    'DEEPSEEK_API_KEY', 'GOOGLE_API_KEY', 'ROUNDUP_REASON_PROVIDER', 'ROUNDUP_REVIEW_PROVIDER'],
};

export function childEnv(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined && source[key] !== '').map((key) => [key, source[key]]));
}

export function assertTarget(env, target) {
  if (!['staging', 'production'].includes(target) || env.CONTENT_TARGET !== target) throw new Error('target mismatch');
  const wanted = target === 'staging' ? 'lv_staging' : 'neondb';
  if (env.CONTENT_DB_NAME !== wanted) throw new Error('database name mismatch');
  for (const key of ['CONTENT_DATABASE_URL', 'CONTENT_DATABASE_URL_UNPOOLED']) {
    if (!env[key] || new URL(env[key]).pathname.slice(1) !== wanted) throw new Error(`${key} database mismatch`);
  }
  if (!env.CONTENT_DEPLOY_HOOK_URL || !/^https:\/\//.test(env.CONTENT_DEPLOY_HOOK_URL)) throw new Error('deploy hook required');
  if (target === 'production') {
    if (env.CONTENT_SITE_URL !== 'https://libertyvillage.co' || env.CONTENT_SITE_BYPASS) throw new Error('production site/bypass mismatch');
    if (!env.LV_RUNNER_PRODUCTION_ENABLED || env.LV_RUNNER_PRODUCTION_ENABLED !== '1') throw new Error('production disabled');
  } else if (!env.CONTENT_SITE_URL || !/^https:\/\//.test(env.CONTENT_SITE_URL) || env.CONTENT_SITE_URL === 'https://libertyvillage.co' || !env.CONTENT_SITE_BYPASS) {
    throw new Error('staging site/bypass mismatch');
  }
  if (env.GH_TOKEN || env.GITHUB_TOKEN || env.GITHUB_API_TOKEN || env.GITHUB_ACTIONS) throw new Error('GitHub write binding refused');
}

export function slotKey(job, target, slot) {
  if (!JOBS[job] || !['staging', 'production'].includes(target) || !/^[a-zA-Z0-9_-]{8,80}$/.test(slot)) throw new Error('invalid run identity');
  return `runner:${job}:${target}:${slot}`;
}

export function freshSlot(date = new Date()) {
  return `${date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

export function allowedGeneratedPath(rel, job) {
  if (rel.includes('\\') || rel.startsWith('/') || rel.split('/').includes('..')) return false;
  if (/^data\/[^/]+\.json$/.test(rel)) return true;
  if (job === 'weekly-blog' && /^public\/images\/blog\/[a-z0-9][a-z0-9-]*\.jpg$/.test(rel)) return true;
  return /^tasks\/(?:auto-blog-runs|seo-improve-runs)\/[a-zA-Z0-9_./-]+$/.test(rel) || /^tasks\/(?:seo-improve-summary\.md|seo-scores\.json|auto-blog-dry-run\.json)$/.test(rel);
}

export function changedPaths(root, trusted) {
  // The SDK owns scratch/.git: never load its config, hooks, fsmonitor or index
  // in a trusted process. Compare scratch files against the pinned trusted index.
  const args = ['--git-dir', path.join(trusted, '.git'), '--work-tree', root,
    '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all'];
  const env = { ...childEnv(process.env, BASE_ENV), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const result = spawnSync('git', args, { cwd: trusted, encoding: 'utf8', env });
  if (result.status !== 0) throw new Error('git status failed');
  const fields = result.stdout.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i].slice(0, 2);
    paths.push(fields[i].slice(3));
    if (status.includes('R') || status.includes('C')) i++;
  }
  return paths;
}

// The blog SDK writes analytics for its own prompting. It is neither a trusted
// content output nor a reason to reject an otherwise valid generated post.
export function generatedPathsForTransfer(paths, job) {
  // Scratch is disposable: only declared transfer artifacts cross into trusted
  // code. Never inspect or copy any other generator-created file contents.
  return paths.filter((rel) => allowedGeneratedPath(rel, job));
}

export function seoCodeSuggestionPath(rel) {
  // Data backups and task notes are scratch-only, not proposals to change code.
  // Every other off-lane path (including root config/public/CI) needs a human PR.
  return !rel.startsWith('data/') && (!rel.startsWith('tasks/') || /\.(?:[mc]?js|jsx|tsx?|py|sh|ya?ml)$/.test(rel));
}

// Compare with the freshly exported DB snapshot, never Git HEAD: exported
// posts can differ from Git even when an SDK agent produced nothing new.
export function hasOneNewBlogPost(exported, generated) {
  if (!Array.isArray(exported) || !Array.isArray(generated) || generated.length !== exported.length + 1) return false;
  const existing = new Set(exported.map((post) => post?.slug));
  return generated.filter((post) => typeof post?.slug === 'string' && post.slug && !existing.has(post.slug)).length === 1;
}

export function copyGenerated(scratch, trusted, job, paths = changedPaths(scratch, trusted)) {
  if (paths.length > 100 || paths.some((rel) => !allowedGeneratedPath(rel, job))) throw new Error('scratch output outside allowlist');
  let bytes = 0;
  for (const rel of paths) {
    const source = path.join(scratch, rel);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('scratch output is not a regular file');
    bytes += stat.size;
    if (bytes > 20 * 1024 * 1024) throw new Error('scratch output too large');
    if (rel.endsWith('.json')) JSON.parse(fs.readFileSync(source, 'utf8'));
  }
  for (const rel of paths) {
    const dest = path.join(trusted, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(scratch, rel), dest);
  }
  return paths;
}

export function acceptGeneratedOutput(scratch, trusted, job, paths, exportedPosts) {
  // Validate type, symlinks and aggregate bytes before any untrusted JSON read.
  const changed = copyGenerated(scratch, trusted, job, paths);
  if (job === 'weekly-blog' && !hasOneNewBlogPost(exportedPosts, readJson(path.join(trusted, 'data', 'posts.json')))) throw new Error('blog generated no post');
  return changed;
}

// The trusted content CLI emits a JSON error envelope on stdout. Preserve only
// stable classes and bounded operator guidance; never log its raw message,
// conflicts, target, candidate bytes or URLs (they may carry private data).
export function classifyCliFailure(binary, args, result) {
  if (path.basename(binary) !== 'node' || args[0] !== 'scripts/content/cli.mjs') return null;
  const classes = new Map([
    ['ValidationError', ['cli-validation', 'fix-source']], ['ConflictError', ['cli-conflict', 'reload-snapshot']],
    ['TargetError', ['cli-target', 'check-binding']], ['StateError', ['cli-state', 'inspect-submission']],
    ['ClaimError', ['cli-claim', 'retry-original-slot']], ['ECONNRESET', ['cli-network', 'retry-original-slot']],
    ['ETIMEDOUT', ['cli-network', 'retry-original-slot']], ['ENOTFOUND', ['cli-network', 'retry-original-slot']],
    ['EAI_AGAIN', ['cli-network', 'retry-original-slot']], ['57P01', ['cli-database', 'retry-original-slot']],
    ['CadenceSchemaError', ['cli-schema', 'check-cadence-migrations']],
    ['42P01', ['cli-schema', 'check-cadence-migrations']],
    ['3D000', ['cli-database-target', 'check-binding']],
    ['42501', ['cli-permission', 'check-database-role']],
  ]);
  let payload;
  const stdout = result.stdout;
  if (typeof stdout === 'string' && Buffer.byteLength(stdout) <= 8192) {
    try { payload = JSON.parse(stdout.trim()); } catch { /* no safe envelope */ }
  }
  let classification = typeof payload?.error === 'string' ? classes.get(payload.error) : null;
  if (!classification && payload?.error === 'Error' && typeof payload.message === 'string' && payload.message.length <= 2048) {
    if (/\b(?:HTTP|status)\s*5\d\d\b/i.test(payload.message)) classification = ['cli-server', 'retry-original-slot'];
    else if (/^(?:fetch failed|network error|connect ECONNRESET|socket hang up)$/i.test(payload.message)) classification = ['cli-network', 'retry-original-slot'];
  }
  if (!classification && result.error?.code === 'ETIMEDOUT') classification = ['cli-timeout', 'retry-original-slot'];
  classification ??= ['cli-operation', 'inspect-run-slot'];
  return { reason: classification[0], action: classification[1], exit: Number.isInteger(result.status) ? result.status : null };
}

export function command(binary, args, { cwd, env, allowExit = [] } = {}) {
  const result = spawnSync(binary, args, { cwd, env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 45 * 60_000 });
  if (result.error || (result.status !== 0 && !allowExit.includes(result.status))) {
    const failure = new Error(`${path.basename(binary)} ${args[0] ?? ''} exit ${result.status ?? 'signal'}`);
    failure.cliFailure = classifyCliFailure(binary, args, result);
    throw failure;
  }
  return { code: result.status, stdout: result.stdout ?? '' };
}

export function parseJson(text) { return JSON.parse(text.trim()); }
export const trustedEnv = (env) => childEnv(env, [...BASE_ENV, ...DB_ENV, 'ANTHROPIC_API_KEY']);
export const sourceEnv = (env, job) => childEnv(env, [...BASE_ENV, ...(SOURCE_ENV[job] ?? [])]);
// The root-owned generator helper's environment (it adds nothing secret itself).
export const generatorEnv = (env) => childEnv(env, ['PATH', 'HOME', 'LANG', 'TZ']);

export async function alertFailure({ webhook, job, target, slot, codeSuggestion = false, holdCensus = null, holdWeek = null, stuckSubmissionId = null }, fetchImpl = fetch) {
  if (!webhook) return false;
  try {
    const week = typeof holdWeek === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(holdWeek) ? ` week ${holdWeek};` : '';
    const text = holdCensus ? `⚠ ${job} publication held (${target});${week} lv-runner ${slot}; census ${JSON.stringify(censusCounts(holdCensus))}` :
      Number.isSafeInteger(stuckSubmissionId) && stuckSubmissionId > 0 ? `⚠ ${job} held (${target}); submission #${stuckSubmissionId} smoked but not current-live; lv-runner ${slot}; inspect original slot` :
        codeSuggestion ? `⚠ ${job} proposed code outside the data lane (${target}); human PR required; lv-runner ${slot}` :
          `⚠ ${job} DB content job failed (${target}); lv-runner ${slot}`;
    const response = await fetchImpl(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) });
    return response.ok;
  } catch { return false; }
}

const stateRoot = process.env.LV_RUNNER_STATE_ROOT || '/var/lib/lv-runner';
const repo = process.env.LV_RUNNER_REPO || '/srv/lv-runner/repo';
const logRoot = process.env.LV_RUNNER_LOG_ROOT || '/var/log/lv-runner';
const node = process.execPath;
const gitEnv = childEnv(process.env, ['PATH', 'HOME', 'LANG', 'TZ']);
const logLine = (file, event, details = {}) => fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`, { mode: 0o600 });

function cli(args, root = repo, allowed = []) {
  return command(node, ['scripts/content/cli.mjs', ...args], { cwd: root, env: trustedEnv(process.env), allowExit: allowed });
}

function checkout(target, log) {
  if (!fs.existsSync(path.join(repo, '.git'))) {
    fs.mkdirSync(path.dirname(repo), { recursive: true });
    command('git', ['clone', '--no-checkout', PUBLIC_REMOTE, repo], { env: gitEnv });
  }
  const remote = command('git', ['remote', 'get-url', 'origin'], { cwd: repo, env: gitEnv }).stdout.trim();
  if (remote !== PUBLIC_REMOTE) throw new Error('untrusted origin');
  const ref = target === 'staging' ? 'staging' : 'main';
  command('git', ['fetch', '--no-tags', 'origin', ref], { cwd: repo, env: gitEnv });
  const sha = command('git', ['rev-parse', 'FETCH_HEAD'], { cwd: repo, env: gitEnv }).stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('invalid code SHA');
  command('git', ['checkout', '--detach', '--force', sha], { cwd: repo, env: gitEnv });
  command('git', ['clean', '-fdx'], { cwd: repo, env: gitEnv });
  command('npm', ['ci', '--ignore-scripts'], { cwd: repo, env: gitEnv });
  logLine(log, 'code-pinned', { sha, ref });
  return sha;
}

function source(script, args, job, log) {
  const result = command(node, [script, ...args], { cwd: repo, env: sourceEnv(process.env, job) });
  logLine(log, 'source-complete', { script, exit: result.code });
  return result;
}

export function parseDiscoveryOutcome(stdout, category) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 512 || !stdout.endsWith('\n')) throw new Error('invalid discovery outcome');
  let value;
  try { value = JSON.parse(stdout.trim()); } catch { throw new Error('invalid discovery outcome'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'category,mapsRequests,outcome'
    || value.category !== category || !['added','empty'].includes(value.outcome)
    || !Number.isSafeInteger(value.mapsRequests) || value.mapsRequests < 0 || value.mapsRequests > 1) throw new Error('invalid discovery outcome');
  return value;
}

export function runScopedEvidenceSource(category, log, execute = command) {
  if (!DISCOVERY_CATEGORIES.has(category)) throw new Error('invalid evidence category');
  const result = execute(node, ['scripts/discover-businesses.mjs', `--category=${category}`, '--max=3'],
    { cwd: repo, env: sourceEnv(process.env, 'discover-businesses'), allowExit: [1, 2, 3] });
  if (log) logLine(log, 'source-complete', { script: 'scripts/discover-businesses.mjs', exit: result.code });
  if (result.code === 3) throw new Error('Maps discovery unavailable');
  if (result.code !== 0) throw new Error('evidence discovery failed');
  return parseDiscoveryOutcome(result.stdout, category);
}

function discoverEvidence(evidence, category, target, log, allowSource = true) {
  const key = evidence.discovery_key;
  const find = () => parseJson(cli(['lookup', '--idempotency-key', key, '--target', target]).stdout);
  let found = find();
  if (found.submissionId == null) {
    if (evidence.state !== 'claimed' || !allowSource) return { state: 'empty' };
    const outcome = runScopedEvidenceSource(category, log);
    if (outcome.outcome === 'empty') return { state: 'empty' };
    try { cli(['submit', '--dir', '.', '--kind', 'business', '--idempotency-key', key, '--actor', `runner:weekly-blog-evidence#${evidence.original_key.slice(-16)}`]); }
    catch (error) {
      found = find();
      if (found.submissionId == null) throw error;
    }
    found = find();
  }
  if (found.submissionId == null || found.kind !== 'business') throw new Error('discovery submission missing');
  const gateResult = gateEvidenceSubmission(found.submissionId, target,
    `runner:weekly-blog-evidence#${evidence.original_key.slice(-16)}`,
    (args, allowExit) => cli(args, repo, allowExit), (event, details) => logLine(log, event, details));
  if (gateResult.state !== 'smoked') return gateResult;
  const verifiedSlugs = liveBusinessSlugs(found.submissionId, target);
  return verifiedSlugs.length ? { state: 'smoked', submissionId: found.submissionId, verifiedSlugs } : { state: 'empty' };
}
function liveBusinessSlugs(submissionId, target) {
  const value = parseJson(cli(['cadence', 'evidence-live', '--submission-id', String(submissionId), '--target', target]).stdout);
  return Array.isArray(value?.verifiedSlugs) && value.verifiedSlugs.every((slug) => typeof slug === 'string') ? value.verifiedSlugs : [];
}

// npm's relative .bin links must stay relative inside scratch. Without this,
// fs.cpSync rewrites them to the trusted repo, loading two Next.js instances
// during scratch builds and breaking its AsyncLocalStorage prerender context.
export function copyScratchTree(from, to) {
  fs.cpSync(from, to, { recursive: true, force: true, verbatimSymlinks: true });
}

// Scratch Git metadata is untrusted after the SDK runs. Inspect only a small,
// regular detached HEAD; never block on a FIFO or read an unbounded device/file.
export function readScratchHead(scratch) {
  const file = path.join(scratch, '.git', 'HEAD');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 40 || stat.size > 128) throw new Error('generator changed pinned commit');
    const bytes = Buffer.alloc(129);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== stat.size) throw new Error('generator changed pinned commit');
    const head = bytes.subarray(0, count).toString('utf8').trim();
    if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('generator changed pinned commit');
    return head;
  } finally { fs.closeSync(fd); }
}

function generator(job, slot, topic, dryRun, log, notifications = {}) {
  const scratch = path.join(stateRoot, 'scratch', slot);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
  copyScratchTree(repo, scratch);
  const exportedPosts = job === 'weekly-blog' ? readJson(path.join(repo, 'data', 'posts.json')) : null;
  const requestDir = path.join(stateRoot, 'generator-requests');
  fs.mkdirSync(requestDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(requestDir, `${slot}.json`), `${JSON.stringify({ topic: topic?.title ?? '', dryRun })}\n`, { mode: 0o600 });
  // The root-owned helper validates this path, changes ownership, and starts a
  // transient service as lv-generator with strict filesystem protection.
  const helper = '/usr/local/libexec/lv-runner-generator';
  const helperResult = command('sudo', ['-n', helper, job, slot], { cwd: repo, env: generatorEnv(process.env), allowExit: job === 'weekly-blog' ? [1] : [] });
  const diagnostic = job === 'weekly-blog' ? readGeneratorRelay(helperResult) : null;
  const head = command('git', ['rev-parse', 'HEAD'], { cwd: repo, env: gitEnv }).stdout.trim();
  if (readScratchHead(scratch) !== head) throw new Error('generator changed pinned commit');
  const allPaths = changedPaths(scratch, repo);
  const paths = generatedPathsForTransfer(allPaths, job);
  const discarded = allPaths.filter((rel) => !allowedGeneratedPath(rel, job));
  if (discarded.length) logLine(log, 'generator-output-discarded', { paths: discarded.slice(0, 20).map((rel) => rel.slice(0, 160)), omitted: Math.max(0, discarded.length - 20) });
  if (job === 'weekly-blog' && !paths.includes('data/posts.json')) throw noPostError(diagnostic);
  if (job === 'seo-improvements' && discarded.some(seoCodeSuggestionPath)) {
    notifications.codeSuggestion = true;
    logLine(log, 'seo-code-suggestion', { paths: discarded.filter(seoCodeSuggestionPath).slice(0, 20).map((rel) => rel.slice(0, 160)) });
  }
  let changed;
  try { changed = acceptGeneratedOutput(scratch, repo, job, paths, exportedPosts); }
  catch (error) { if (job === 'weekly-blog' && error.message === 'blog generated no post') throw noPostError(diagnostic); throw error; }
  if (job === 'weekly-blog' && diagnostic?.postWritten === false) throw new Error('generator diagnostic contradicted post');
  logLine(log, 'generator-output-accepted', { paths: changed.length });
  fs.rmSync(scratch, { recursive: true, force: true });
  return changed;
}

const GENERATOR_REASONS = new Set(['post-written','unsupported-grounding','insufficient-sources','sdk-error','generator-error','no-post-unspecified','duplicate','absent']);
export function parseGeneratorDiagnostic(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 128) return null;
  const match = /^\{"postWritten":(true|false),"stopReason":"([a-z-]+)"\}\n$/.exec(stdout);
  if (!match || !GENERATOR_REASONS.has(match[2])) return null;
  return { postWritten: match[1] === 'true', stopReason: match[2] };
}
export function readGeneratorRelay({ code, stdout }) {
  const diagnostic = parseGeneratorDiagnostic(stdout);
  if (!diagnostic || (code === 0) !== diagnostic.postWritten || (diagnostic.stopReason === 'post-written') !== diagnostic.postWritten
    || ![0, 1].includes(code) || diagnostic.stopReason === 'absent') throw new Error('generator outcome unavailable');
  if (['sdk-error','generator-error'].includes(diagnostic.stopReason)) throw new Error('generator technical failure');
  return diagnostic;
}
function noPostError(diagnostic) {
  if (diagnostic?.postWritten === true) return new Error('generator diagnostic contradicted post');
  const error = new Error('blog generated no post');
  if (diagnostic?.postWritten === false && ['unsupported-grounding','insufficient-sources'].includes(diagnostic.stopReason)) error.groundedRefusal = diagnostic.stopReason;
  return error;
}

function submitAndGate(job, target, slot, log, extra = [], onSubmission = null) {
  const kind = JOBS[job].kind;
  const identity = slotKey(job, target, slot);
  const actor = `runner:${job}#${slot}`;
  const submitted = parseJson(cli(['submit', '--dir', '.', '--kind', kind, '--idempotency-key', identity, '--actor', actor, ...extra]).stdout);
  const id = submitted.submissionId;
  logLine(log, 'submission', { id });
  if (id == null) return { id: null, success: true };
  onSubmission?.(id);
  return gate(id, target, actor, log);
}

function gate(id, target, actor, log) {
  const result = cli(['gate', '--submission', String(id), '--target', target, '--actor', actor], repo, [2, 3]);
  logLine(log, 'gate', { id, exit: result.code });
  if (result.code === 2) throw new Error('gate blocked or rejected');
  if (result.code === 3) {
    const resume = cli(['deploy', '--target', target], repo, [3]);
    logLine(log, 'deploy-resume', { id, exit: resume.code });
    if (resume.code === 3) throw new Error('publish or propagation pending');
  }
  const shown = parseJson(cli(['show', '--submission', String(id), '--target', target]).stdout);
  const submission = shown.submission;
  if (submission.state !== 'published' || !submission.smoke_passed_at) throw new Error('submission lacks smoke success');
  return { id, success: true };
}

function lookup(job, target, slot, log) {
  const found = parseJson(cli(['lookup', '--idempotency-key', slotKey(job, target, slot), '--target', target]).stdout);
  if (found.submissionId == null) return null;
  if (found.kind !== JOBS[job].kind) throw new Error('idempotency kind mismatch');
  logLine(log, 'resume', { id: found.submissionId });
  return gate(found.submissionId, target, `runner:${job}#${slot}`, log);
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// ---------------------------------------------------------------------------
// Durable cadence wiring (docs/specs/content-cadence-2026.md). The DB cadence
// tables are the only truth for slots, attempts, idempotency keys and consumed
// intents; /var/lib/lv-runner/topic-state.json is no longer read. Every step
// below takes injected deps so tests drive it with a fake CLI and generator.
// ---------------------------------------------------------------------------
export const CADENCE = Object.freeze({
  contentGoal: 2, maxContentSlot: 4, normalPerSlot: 3, reservePerWeek: 2, generationsPerRun: 4,
  leaseSeconds: 3600, reserveCategories: 20, catchUpWeeks: 4, sidecarMaxBytes: 128 * 1024, postsMaxBytes: 32 * 1024 * 1024,
  artifactMaxBytes: 2 * 1024 * 1024,
});
const OPEN_OUTCOMES = new Set([null, 'published', 'smoked']);
const isOpen = (attempt) => OPEN_OUTCOMES.has(attempt?.outcome ?? null);
const byOrdinal = (a, b) => Number(a.ordinal) - Number(b.ordinal);
const SIDECAR = /^tasks\/auto-blog-runs\/\d{4}-\d{2}-\d{2}-([a-z0-9-]+)-source-pack\.json$/;

// Wed primary, Fri recovery, Sun final catch-up (reserve intents only on Sunday).
export function dayPolicy(date) {
  const day = date.getUTCDay();
  return { phase: day === 3 ? 'primary' : day === 5 ? 'recovery' : day === 0 ? 'final' : 'on-demand', reserveAllowed: day === 0 };
}

// Untrusted generator/writer output: regular file, no symlink/FIFO, bounded bytes.
export function readBoundedJson(file, maxBytes) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('artifact is not a bounded regular file');
    const bytes = Buffer.alloc(stat.size);
    if (fs.readSync(fd, bytes, 0, stat.size, 0) !== stat.size) throw new Error('artifact changed while reading');
    return JSON.parse(bytes.toString('utf8'));
  } finally { fs.closeSync(fd); }
}

function cadenceCaller(deps, target, week) {
  return (sub, extra = []) => parseJson(deps.cli(['cadence', sub, '--week-start', week, '--target', target, ...extra.map(String)]).stdout);
}

function gateState(deps, target, id, actor) {
  // Gate exits 1 both after a durably notified terminal fixer error AND on
  // operational failures (e.g. a failed notification). Never let a later
  // `show` of the terminal state hide the original transport failure.
  const result = deps.cli(['gate', '--submission', String(id), '--target', target, '--actor', actor], [1, 2, 3]);
  deps.log('gate', { id, exit: result.code });
  if (result.code === 1) {
    let receipt;
    if (typeof result.stdout === 'string' && Buffer.byteLength(result.stdout) <= 8192) {
      try { receipt = parseJson(result.stdout); } catch { /* not a terminal receipt */ }
    }
    if (Number(receipt?.submissionId) !== Number(id) || receipt?.state !== 'error'
      || receipt?.decision !== 'error' || receipt?.notified !== true || receipt?.error) {
      const failure = new Error('content gate failed');
      failure.cliFailure = classifyCliFailure(node, ['scripts/content/cli.mjs', 'gate'], { stdout: result.stdout, status: 1 });
      throw failure;
    }
  }
  if (result.code === 3) {
    const resume = deps.cli(['deploy', '--target', target], [3]);
    deps.log('deploy-resume', { id, exit: resume.code });
    if (resume.code === 3) return { state: 'published' };
  }
  // Only the trusted DB decides smoke; scratch receipts are never read.
  const submission = parseJson(deps.cli(['show', '--submission', String(id), '--target', target]).stdout).submission;
  if (submission?.state === 'published') return submission.smoke_passed_at ? { state: 'smoked', smokedAt: submission.smoke_passed_at } : { state: 'published' };
  if (['rejected', 'blocked', 'error'].includes(submission?.state)) return { state: submission.state };
  if (result.code === 2) return { state: 'rejected' };
  throw new Error('submission lacks smoke success');
}

// Business discovery shares the cadence gate's bounded terminal-error receipt.
// A durable, notified `error` closes this evidence attempt so another topic can
// proceed; an operational exit 1 remains an error, never fabricated evidence.
export function gateEvidenceSubmission(id, target, actor, cliCall, log = () => {}) {
  const result = gateState({ cli: cliCall, log }, target, id, actor);
  if (result.state === 'smoked') return { state: 'smoked' };
  if (result.state === 'published') return { state: 'pending' };
  if (['rejected', 'blocked', 'error'].includes(result.state)) return { state: 'empty' };
  throw new Error('submission lacks smoke success');
}

// Persist a gate result on the attempt. Smoke alone is never success: the item
// must be consumed (the CLI observes the hosted alias) AND appear in `cadence
// count` for the attempt's week; otherwise it is 'late-smoke' (smoke landed in a
// later week) or 'uncounted' (not current-live / alias not showing it).
// Publish/propagation pending keeps the attempt open; terminal reject/block/error
// frees the slot for the next DISTINCT intent.
function settleAttempt(deps, ctx, key, token, id, gate) {
  const outcome = (value) => ctx.call('outcome', ['--idempotency-key', key, '--token', token, '--outcome', value]);
  if (gate.state === 'smoked') {
    outcome('smoked');
    const late = typeof gate.smokedAt === 'string' && deps.modules.weekStartUtc(new Date(gate.smokedAt)) !== ctx.week;
    if (late) {
      // The trusted CLI verifies current-live alias proof in the actual smoke
      // week before making this original-week attempt terminal. If it refuses
      // because the post is not live, hold the original key and name its ID for
      // the operator; never silently free the slot or invent a smoke receipt.
      try { outcome('late-smoked'); }
      catch (error) {
        if (error?.cliFailure?.reason !== 'cli-state') throw error;
        const actualWeek = deps.modules.weekStartUtc(new Date(gate.smokedAt));
        // Roundup: the old week's own slug, proven by current-live (never by a
        // later week's count, which cannot include an old-week roundup slug).
        const live = ctx.lane === 'roundup'
          ? cadenceCaller(deps, ctx.target, ctx.week)('current-live', ['--submission-id', id]).live === true
          : cadenceCaller(deps, ctx.target, actualWeek)('count').content.some((item) => Number(item.submissionId) === Number(id));
        if (live) throw error;
        deps.log('cadence-prior-smoke-hold', { id, lane: ctx.lane, week: ctx.week, actualWeek, reason: 'not-current-live' });
        const hold = new Error(ctx.lane === 'roundup' ? 'prior roundup smoke not current-live' : 'prior content smoke not current-live');
        hold.stuckSubmissionId = Number(id);
        throw hold;
      }
      deps.log('cadence-smoked-uncounted', { id, late: true, consumed: false, counted: false });
      return 'late-smoke';
    }
    let consumed = false;
    let counted = false;
    try { outcome('consumed'); consumed = true; }
    catch (error) { deps.log('cadence-consume-refused', { id, reason: error?.cliFailure?.reason ?? 'operational-error' }); }
    try {
      const count = ctx.call('count');
      counted = (ctx.lane === 'roundup' ? count.roundup : count.content).some((item) => Number(item.submissionId) === Number(id));
    } catch (error) { deps.log('cadence-count-failed', { id, reason: error?.cliFailure?.reason ?? 'operational-error' }); }
    if (consumed && counted) { deps.log('cadence-consumed', { id }); return 'counted'; }
    deps.log('cadence-smoked-uncounted', { id, late, consumed, counted });
    return late ? 'late-smoke' : 'uncounted';
  }
  if (gate.state === 'published') { outcome('published'); return 'pending'; }
  outcome(gate.state);
  deps.log('cadence-attempt-closed', { id, outcome: gate.state });
  return 'closed';
}

// Deadline alerts are durable DB intents: every weekly-blog/roundup run first
// evaluates ended prior ISO weeks, oldest first: the immediate prior week,
// plus older weeks with a slot or attempt within CADENCE.catchUpWeeks, but only
// if their Monday is on/after the target's configured first missed-alert week.
// A missing config defaults to THIS run's week: no retroactive missed alerts,
// and no missed alerts at all until the operator sets a fixed start week.
// Deadline intents remain idempotent per target/week/type; per-week failures
// are logged and do not abort the run. Malformed configuration fails BEFORE it.
function missedAlertStartWeek(deps, target, week) {
  const value = deps.cadenceStartWeek;
  if (value === undefined || value === null || value === '') {
    deps.log('cadence-start-week-defaulted', { target, week });
    return week;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value
    || deps.modules.weekStartUtc(date) !== value) throw new Error('invalid cadence start week');
  return value;
}
function evaluatePriorWeek(deps, target, week, now) {
  const firstWeek = missedAlertStartWeek(deps, target, week);
  const weekAt = (back) => deps.modules.weekStartUtc(new Date(Date.parse(`${week}T00:00:00Z`) - back * 7 * 86400000));
  for (let back = CADENCE.catchUpWeeks; back >= 1; back--) {
    const prior = weekAt(back);
    if (prior < firstWeek) continue;
    const call = cadenceCaller(deps, target, prior);
    try {
      if (back > 1) {
        const status = call('status');
        if (!(status?.slots?.length || status?.attempts?.length)) continue;
      }
      const deadline = call('deadline', ['--now', now.toISOString()]);
      const alerts = Array.isArray(deadline?.alerts) ? deadline.alerts : [];
      deps.log('cadence-prior-week', { week: prior, due: Boolean(deadline?.due), alerts: alerts.length, created: alerts.filter((alert) => alert?.created).length });
    } catch (error) {
      deps.log('cadence-deadline-failed', { week: prior, reason: failureReason(error) });
    }
  }
  if (!deps.alertsEnabled) { deps.log('cadence-alert-delivery-skipped', { reason: 'no-webhook' }); return; }
  try {
    const delivered = cadenceCaller(deps, target, weekAt(1))('deliver-alerts');
    deps.log('cadence-alerts-delivered', { delivered: Number(delivered?.delivered) || 0, failed: Number(delivered?.failed) || 0, pending: Number(delivered?.pending) || 0 });
  } catch (error) { deps.log('cadence-alert-delivery-failed', { reason: failureReason(error) }); }
}

function resumeOpenAttempt(deps, ctx, attempt, token) {
  const key = attempt.idempotency_key;
  const found = parseJson(deps.cli(['lookup', '--idempotency-key', key, '--target', ctx.target]).stdout);
  if (found.submissionId == null) return { state: 'no-submission' };
  if (found.kind !== ctx.kind) throw new Error('idempotency kind mismatch');
  if (attempt.submission_id == null) ctx.call('attach', ['--idempotency-key', key, '--token', token, '--submission-id', found.submissionId]);
  else if (Number(attempt.submission_id) !== Number(found.submissionId)) throw new Error('idempotency kind mismatch');
  deps.log('resume', { id: found.submissionId, ordinal: attempt.ordinal });
  ctx.call('renew', ['--lane', ctx.lane, '--slot-number', attempt.slot_number, '--token', token, '--lease-seconds', CADENCE.leaseSeconds]);
  const gate = gateState(deps, ctx.target, found.submissionId, ctx.actor);
  return { state: settleAttempt(deps, ctx, key, token, found.submissionId, gate), id: found.submissionId };
}

function blogCandidate(run, entry, snapshot, { reserve = false, consumed = run.consumed } = {}) {
  const { checkTopicGroundability, buildSourcePack } = run.deps.modules;
  if (typeof entry?.title !== 'string' || !entry.title.trim() || typeof entry.key !== 'string' || !entry.key) return { skip: 'invalid-entry' };
  const ground = checkTopicGroundability({ title: entry.title, kind: 'blog', businesses: snapshot.businesses, livePosts: snapshot.posts, consumedFingerprints: [...consumed] });
  if (!ground.ok) return { skip: ground.reason };
  if (!ground.fingerprint) return { skip: 'empty-fingerprint' };
  let built;
  if (reserve) {
    const reserved = reservePack(run.deps.modules, { title: ground.editorialTitle, category: entry.category, snapshot, now: run.deps.now() });
    if (reserved.skip) return { skip: reserved.skip };
    built = reserved;
  } else {
    built = buildSourcePack({ topic: ground.editorialTitle, businesses: snapshot.businesses, posts: snapshot.posts, services: snapshot.services, topics: snapshot.topics, now: run.deps.now() });
    if (!built.ok) return { skip: built.reason };
  }
  return { title: ground.editorialTitle, fingerprint: ground.fingerprint, topicKey: `${reserve ? 'reserve:' : ''}${entry.key}`, pack: built.pack, reserve };
}

function queueEntries(run, snapshot) {
  if (run.request.topic) return [{ title: run.request.topic, key: `manual:${createHash('sha256').update(run.request.topic).digest('hex').slice(0, 32)}` }];
  return (Array.isArray(snapshot.queue?.topics) ? snapshot.queue.topics : []).filter((entry) => entry?.kind === 'blog');
}

const humanize = (category) => category.split('-').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
const categoryOf = (record) => (typeof record?.category === 'string' ? record.category.trim().toLowerCase() : '');
const DISCOVERY_CATEGORIES = new Set(['restaurants','coffee-shops','bars','wine-bars','breweries','gyms','pilates','yoga-studios','hair-salons','barbers','nail-salons','spas','dentists','physiotherapy','chiropractors','massage-therapy','optometrists','bakeries','pizza','sushi','brunch-spots','pet-stores','dog-groomers','florists','tattoo-parlors']);
export function evidenceCategory(pack, snapshot) {
  const categories = new Set();
  for (const source of pack?.sources ?? []) {
    if (source?.kind !== 'business' || typeof source.id !== 'string') return null;
    const record = snapshot.businesses.find((item) => item.slug === source.id);
    const category = categoryOf(record);
    if (!DISCOVERY_CATEGORIES.has(category)) return null;
    categories.add(category);
  }
  return categories.size === 1 ? [...categories][0] : null;
}

// A reserve guide pack is built ONLY from its category's live records, so every
// source is in-category (categories partition the directory, so two reserve
// packs never share a record). The generator builds its sidecar from the full
// directory (scripts/weekly-blog-agent.js), so the guide runs only when that
// selection is the same category-pure pack; otherwise it is skipped before spend.
export function reservePack(modules, { title, category, snapshot, now }) {
  const records = (Array.isArray(snapshot.businesses) ? snapshot.businesses : []).filter((record) => categoryOf(record) === category);
  const input = { topic: title, posts: snapshot.posts, services: snapshot.services, topics: snapshot.topics, now, reserve: true };
  const built = modules.buildSourcePack({ ...input, businesses: records });
  if (!built.ok) return { skip: built.reason };
  const ids = new Set(built.pack.sources.map((source) => source.id));
  if (!modules.reserveGuideEligibility({ businesses: records.filter((record) => ids.has(record.slug)) }).ok) return { skip: 'reserve-ineligible' };
  const full = modules.buildSourcePack({ ...input, businesses: snapshot.businesses });
  if (!full.ok || full.pack.fingerprint !== built.pack.fingerprint) return { skip: 'reserve-generator-off-category', pack: built.pack };
  return { ok: true, pack: built.pack };
}

// Sunday reserve intents are derived from the directory, not the queue: one guide
// per business category whose live records alone pass reserveGuideEligibility
// (>=3 records, >=6 verbatim facts). Pack sources must also pass it, and two
// reserves in one run never share a record.
function reserveEntries(run, snapshot, { retryKey = null } = {}) {
  const byCategory = new Map();
  for (const record of Array.isArray(snapshot.businesses) ? snapshot.businesses : []) {
    const category = categoryOf(record);
    // Durable disjointness: a category already attempted as a reserve this week
    // (DB attempt topic key reserve:dir:<category>) is never reused.
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(category) || (run.reservedCategories.has(category) && retryKey !== `dir:${category}`)) continue;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(record);
  }
  return [...byCategory]
    .filter(([, records]) => records.length >= 3 && run.deps.modules.reserveGuideEligibility({ businesses: records }).ok)
    .sort(([a, left], [b, right]) => right.length - left.length || a.localeCompare(b))
    .slice(0, CADENCE.reserveCategories)
    .map(([category]) => ({ key: `dir:${category}`, category, title: `${humanize(category)} in Liberty Village`, reserve: true }));
}

// Next distinct eligible intent, chosen BEFORE any generator spend.
function eligibleInventory(run, snapshot) {
  const reserves = [];
  const used = new Set();
  for (const entry of reserveEntries(run, snapshot)) {
    const candidate = blogCandidate(run, entry, snapshot, { reserve: true });
    if (candidate.skip || run.weekFingerprints.has(candidate.fingerprint)
      || candidate.pack.sources.some((source) => used.has(source.id))) continue;
    reserves.push(candidate);
    for (const source of candidate.pack.sources) used.add(source.id);
    if (reserves.length >= 2) break;
  }
  // Normal and reserve floors describe distinct eligible intents. A queued
  // bakery/salon guide cannot also fill a directory reserve slot on Sunday.
  const reserveFingerprints = new Set(reserves.map((candidate) => candidate.fingerprint));
  const normal = new Set();
  for (const entry of queueEntries(run, snapshot).slice(0, 100)) {
    const candidate = blogCandidate(run, entry, snapshot);
    if (!candidate.skip && !run.weekFingerprints.has(candidate.fingerprint) && !reserveFingerprints.has(candidate.fingerprint)) normal.add(candidate.fingerprint);
    if (normal.size >= 6) break;
  }
  return { normal: normal.size, reserve: reserves.length };
}

function nextCandidate(run, snapshot, { normal, reserve }) {
  const passes = [...(normal ? [false] : []), ...(reserve ? [true] : [])];
  for (const asReserve of passes) {
    for (const entry of asReserve ? reserveEntries(run, snapshot) : queueEntries(run, snapshot)) {
      const candidate = blogCandidate(run, entry, snapshot, { reserve: asReserve });
      if (candidate.skip) {
        if (!run.skipped.has(entry.key) && run.skipped.size < 50) { run.skipped.add(entry.key); run.deps.log('intent-skipped', { reason: String(candidate.skip).slice(0, 80), reserve: asReserve }); }
        continue;
      }
      if (run.weekFingerprints.has(candidate.fingerprint)) continue;
      if (asReserve && candidate.pack.sources.some((source) => run.reserveSourceIds.has(source.id))) continue;
      return candidate;
    }
  }
  return null;
}

function checkSidecar(run, changed, pack, snapshot) {
  const matches = changed.filter((rel) => SIDECAR.exec(rel)?.[1] === pack.intentKey);
  if (matches.length !== 1) return 'missing';
  const file = path.join(run.deps.repo, matches[0]);
  let sidecar;
  try { sidecar = readBoundedJson(file, CADENCE.sidecarMaxBytes); }
  catch { return 'unreadable'; }
  finally { fs.rmSync(file, { force: true }); }
  if (typeof sidecar?.fingerprint !== 'string' || sidecar.fingerprint !== pack.fingerprint) return 'fingerprint-mismatch';
  const verified = run.deps.modules.verifySourcePack(sidecar, { businesses: snapshot.businesses, posts: snapshot.posts, services: snapshot.services, topics: snapshot.topics, now: run.deps.now() });
  return verified.ok ? null : 'unverified';
}

// The generated post itself must be the draft this pack grounds (same checks the
// generator ran, re-run here in the trusted process against the fresh export).
function checkDraftBinding(run, pack, snapshot) {
  let posts;
  try { posts = readBoundedJson(path.join(run.deps.repo, 'data', 'posts.json'), CADENCE.postsMaxBytes); }
  catch { return 'posts-unreadable'; }
  const existing = new Set(snapshot.posts.map((post) => post?.slug));
  const added = Array.isArray(posts) ? posts.filter((post) => typeof post?.slug === 'string' && !existing.has(post.slug)) : [];
  if (added.length !== 1) return 'no-single-post';
  let imagePaths = [];
  try { imagePaths = fs.readdirSync(path.join(run.deps.repo, 'public', 'images', 'blog')).filter((name) => /^[a-z0-9-]+\.jpg$/.test(name)).slice(0, 5000).map((name) => `/images/blog/${name}`); }
  catch { /* no blog images */ }
  const checked = run.deps.modules.checkDraftAgainstPack(added[0], pack, { businesses: snapshot.businesses, posts: snapshot.posts, services: snapshot.services, topics: snapshot.topics, imagePaths, now: run.deps.now() });
  if (checked.ok) return null;
  run.deps.log('draft-unbound', { errors: [...new Set(checked.errors.map((error) => String(error).split(':')[0].slice(0, 40)))].slice(0, 10) });
  return 'unbound';
}

function writeTrustedPack(run, key, pack) {
  const dir = path.join(run.deps.stateRoot, 'source-packs');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  fs.writeFileSync(file, `${run.deps.modules.canonicalJson(pack)}\n`, { mode: 0o600 });
  return file;
}

// One intent in a reserved content slot: attempt -> generator -> sidecar check ->
// submit (trusted pack) -> attach -> gate. `existing` retries the SAME key/intent.
function attemptBlogIntent(run, slotNumber, token, candidate, snapshot, existing = null, evidence = null) {
  const { deps, call } = run;
  let key = existing?.idempotency_key;
  if (!key) {
    const recorded = evidence
      ? call('evidence-retry', ['--lane', 'content', '--slot-number', slotNumber, '--token', token, '--intent-fingerprint', candidate.fingerprint, '--topic-key', candidate.topicKey, '--source-pack-digest', candidate.pack.fingerprint, '--evidence-token', evidence.claim_token])
      : call('attempt', ['--lane', 'content', '--slot-number', slotNumber, '--token', token, '--intent-fingerprint', candidate.fingerprint, '--topic-key', candidate.topicKey, '--source-pack-digest', candidate.pack.fingerprint]);
    if (recorded.existing) throw new Error('cadence attempt already open');
    key = recorded.idempotencyKey;
  }
  run.weekFingerprints.add(candidate.fingerprint);
  deps.log('cadence-attempt', { slot: slotNumber, reserve: candidate.reserve, retry: Boolean(existing) });
  const fail = (reason) => {
    call('outcome', ['--idempotency-key', key, '--token', token, '--outcome', 'failed-before-submit']);
    deps.log('cadence-attempt-failed', { slot: slotNumber, reason });
    return { state: 'closed' };
  };
  const packPath = writeTrustedPack(run, key, candidate.pack);
  let changed;
  try { changed = deps.generate(candidate.title); }
  catch (error) {
    if (error?.message === 'blog generated no post') {
      const result = fail('no-post');
      if (error.groundedRefusal && !candidate.reserve && !existing && !evidence) return { ...result, refusal: { candidate, snapshot, key, reason: error.groundedRefusal } };
      return result;
    }
    fail('generator-error');
    throw error;
  }
  const refused = checkSidecar(run, changed, candidate.pack, snapshot);
  if (refused) return fail(`sidecar-${refused}`);
  const unbound = checkDraftBinding(run, candidate.pack, snapshot);
  if (unbound) return fail(`draft-${unbound}`);
  let submitted;
  try { submitted = parseJson(deps.cli(['submit', '--dir', '.', '--kind', 'blog', '--idempotency-key', key, '--actor', run.actor, '--source-pack', packPath]).stdout); }
  catch (error) {
    if (['cli-validation', 'cli-conflict'].includes(error?.cliFailure?.reason)) return fail('submit-refused');
    throw error;
  }
  if (submitted.submissionId == null) return fail('no-submission');
  deps.log('submission', { id: submitted.submissionId });
  call('attach', ['--idempotency-key', key, '--token', token, '--submission-id', submitted.submissionId]);
  call('renew', ['--lane', 'content', '--slot-number', slotNumber, '--token', token, '--lease-seconds', CADENCE.leaseSeconds]);
  const gate = gateState(deps, run.target, submitted.submissionId, run.actor);
  return { state: settleAttempt(deps, run, key, token, submitted.submissionId, gate), id: submitted.submissionId };
}

// Crash-before-submit: retry the same intent with the same key only if the
// fresh trusted pack is identical; otherwise close it before any next ordinal.
function retryBlogAttempt(run, slotNumber, token, attempt) {
  const snapshot = run.deps.exportSnapshot();
  const reserve = attempt.topic_key.startsWith('reserve:');
  const baseKey = reserve ? attempt.topic_key.slice('reserve:'.length) : attempt.topic_key;
  // A same-key retry may re-admit exactly its own reserve category.
  const entry = (reserve ? reserveEntries(run, snapshot, { retryKey: baseKey }) : queueEntries(run, snapshot)).find((item) => item.key === baseKey);
  const consumed = new Set([...run.consumed].filter((fingerprint) => fingerprint !== attempt.intent_fingerprint));
  const candidate = entry ? blogCandidate(run, entry, snapshot, { reserve, consumed }) : { skip: 'intent-missing' };
  if (candidate.skip || candidate.pack.fingerprint !== attempt.source_pack_digest || candidate.fingerprint !== attempt.intent_fingerprint) {
    run.call('outcome', ['--idempotency-key', attempt.idempotency_key, '--token', token, '--outcome', 'failed-before-submit']);
    run.deps.log('cadence-attempt-failed', { slot: slotNumber, reason: 'retry-intent-changed' });
    return { state: 'closed' };
  }
  if (run.budget < 1) return { state: 'deferred' };
  run.budget -= 1;
  return attemptBlogIntent(run, slotNumber, token, candidate, snapshot, attempt);
}

function processContentSlot(run, slotNumber, { resumeOnly = false } = {}) {
  const { deps, call } = run;
  const reservation = call('reserve', ['--lane', 'content', '--slot-number', slotNumber, '--owner', run.owner, '--lease-seconds', CADENCE.leaseSeconds]);
  if (!reservation.reserved) {
    deps.log('cadence-slot-held', { slot: slotNumber, holder: reservation.holder === 'self' ? 'self' : 'other' });
    return { state: 'held' };
  }
  const token = reservation.token;
  try {
    const attemptsOf = () => call('status').attempts.filter((a) => a.lane === 'content' && Number(a.slot_number) === slotNumber).sort(byOrdinal);
    let attempts = attemptsOf();
    const latest = attempts.at(-1);
    if (reservation.slot?.state === 'consumed' || latest?.outcome === 'consumed') return { state: 'consumed', consumedId: Number(reservation.slot?.submission_id ?? latest?.submission_id) };
    if (latest && isOpen(latest)) {
      let resumed = resumeOpenAttempt(deps, run, latest, token);
      if (resumed.state === 'no-submission') resumed = retryBlogAttempt(run, slotNumber, token, latest);
      if (resumed.state !== 'closed') return resumed;
      attempts = attemptsOf();
    }
    if (resumeOnly) return { state: 'closed' };
    let normalLeft = CADENCE.normalPerSlot - attempts.filter((a) => !String(a.topic_key).startsWith('reserve:')).length;
    while (run.budget > 0) {
      const snapshot = deps.exportSnapshot();
      const candidate = nextCandidate(run, snapshot, { normal: normalLeft > 0, reserve: run.policy.reserveAllowed && run.reserveLeft > 0 });
      if (!candidate) break;
      if (candidate.reserve) {
        run.reserveLeft -= 1;
        run.reservedCategories.add(candidate.topicKey.slice('reserve:dir:'.length));
        for (const source of candidate.pack.sources) run.reserveSourceIds.add(source.id);
      } else normalLeft -= 1;
      run.budget -= 1;
      const result = attemptBlogIntent(run, slotNumber, token, candidate, snapshot);
      if (result.refusal || result.state !== 'closed') return result;
    }
    deps.log('cadence-slot-exhausted', { slot: slotNumber, budget: run.budget, normalLeft: Math.max(0, normalLeft), reserveLeft: run.reserveLeft });
    return { state: 'exhausted' };
  } finally {
    // The lease is always released. A pending publication keeps its DB attempt
    // open (outcome null/published), which fences the slot: the next run resumes
    // that same idempotency key instead of drafting a new candidate.
    try { call('release', ['--lane', 'content', '--slot-number', slotNumber, '--token', token]); }
    catch (error) { deps.log('cadence-release-failed', { slot: slotNumber, reason: error?.cliFailure?.reason ?? 'operational-error' }); }
  }
}

// Unresolved work has no age cutoff: a VM may be down for more than the alert
// lookback. Inspect a bounded oldest-first page and never start new work while
// an older publication is pending, held by another owner or beyond the cap.
function recoverPriorContent(deps, target, slot, week) {
  const attempts = cadenceCaller(deps, target, week)('unresolved', ['--limit', 21, '--lane', 'content']);
  const prior = attempts.filter((a) => a.week_start_utc < week);
  let budget = CADENCE.generationsPerRun;
  for (const attempt of prior.slice(0, CADENCE.maxContentSlot)) {
    const call = cadenceCaller(deps, target, attempt.week_start_utc);
    const owner = `runner:weekly-blog:${target}:${slot}`;
    const reserved = call('reserve', ['--lane', 'content', '--slot-number', attempt.slot_number,
      '--owner', owner, '--lease-seconds', CADENCE.leaseSeconds]);
    if (!reserved.reserved) throw new Error('prior content slot held');
    const run = { deps, call, target, slot, week: attempt.week_start_utc, request: {}, kind: 'blog', lane: 'content',
      actor: `runner:weekly-blog#${slot}`, owner, budget,
      consumed: new Set(cadenceCaller(deps, target, week)('consumed')),
      weekFingerprints: new Set(), reservedCategories: new Set(), reserveSourceIds: new Set(), skipped: new Set() };
    let result;
    try {
      result = resumeOpenAttempt(deps, run, attempt, reserved.token);
      if (result.state === 'no-submission') result = retryBlogAttempt(run, Number(attempt.slot_number), reserved.token, attempt);
      budget = run.budget;
    } finally {
      try { call('release', ['--lane', 'content', '--slot-number', attempt.slot_number, '--token', reserved.token]); }
      catch (error) { deps.log('cadence-release-failed', { slot: attempt.slot_number, reason: error?.cliFailure?.reason ?? 'operational-error' }); }
    }
    if (!['closed','counted','late-smoke'].includes(result.state)) throw new Error('prior content publication pending');
  }
  if (prior.length > CADENCE.maxContentSlot) throw new Error('prior content backlog exceeds recovery budget');
  return budget;
}

function recoverPriorEvidence(deps, target, week) {
  const old = cadenceCaller(deps, target, week)('evidence-unresolved').filter((item) => item.week_start_utc < week);
  if (old.length >= 21) throw new Error('prior evidence backlog');
  for (const evidence of old) {
    const call = cadenceCaller(deps, target, evidence.week_start_utc);
    const result = evidence.category && typeof deps.discoverEvidence === 'function'
      ? deps.discoverEvidence(evidence, evidence.category, false) : { state: 'empty' };
    if (result.state === 'pending') throw new Error('prior evidence publication pending');
    call('evidence-state', ['--intent-fingerprint', evidence.intent_fingerprint, '--token', evidence.claim_token, '--state', 'closed']);
  }
}

function continueEvidence(run, evidence, allowSource) {
  const { deps, call } = run;
  const fingerprint = evidence.intent_fingerprint;
  const setState = (state) => call('evidence-state', ['--intent-fingerprint', fingerprint, '--token', evidence.claim_token, '--state', state]);
  if (!evidence.category || typeof deps.discoverEvidence !== 'function') { setState('closed'); return { state: 'closed' }; }
  let discovery;
  try { discovery = deps.discoverEvidence(evidence, evidence.category, allowSource); }
  catch (error) { if (evidence.state === 'claimed') setState('pending'); throw error; }
  if (discovery?.state === 'pending') { if (evidence.state === 'claimed') setState('pending'); return { state: 'pending' }; }
  if (discovery?.state !== 'smoked' || !Array.isArray(discovery.verifiedSlugs) || !discovery.verifiedSlugs.length) {
    setState('closed'); return { state: 'closed' };
  }
  const fresh = deps.exportSnapshot();
  const liveSlugs = discovery.submissionId != null && typeof deps.evidenceLive === 'function'
    ? deps.evidenceLive(discovery.submissionId) : discovery.verifiedSlugs;
  const original = call('status').attempts.find((item) => item.idempotency_key === evidence.original_key);
  const entry = queueEntries(run, fresh).find((item) => item.key === original?.topic_key);
  const consumed = new Set([...run.consumed].filter((item) => item !== fingerprint));
  const rebuilt = entry ? blogCandidate(run, entry, fresh, { consumed }) : { skip: 'intent-missing' };
  if (rebuilt.skip || rebuilt.title !== evidence.original_title || rebuilt.fingerprint !== fingerprint
    || rebuilt.pack.fingerprint === evidence.original_digest
    || !deps.modules.verifySourcePack(rebuilt.pack, { businesses: fresh.businesses, posts: fresh.posts, services: fresh.services, topics: fresh.topics, now: deps.now() }).ok
    || !rebuilt.pack.sources.some((source) => discovery.verifiedSlugs.includes(source.id) && liveSlugs.includes(source.id))) {
    setState('closed'); return { state: 'closed' };
  }
  if (call('count').contentCount >= CADENCE.contentGoal || run.budget < 1) { setState('closed'); return { state: 'closed' }; }
  const status = call('status');
  const used = new Set(status.attempts.filter((attempt) => attempt.lane === 'content').map((attempt) => Number(attempt.slot_number)));
  const retrySlot = [1, 2, 3, 4].find((number) => !used.has(number));
  if (!retrySlot) { setState('closed'); return { state: 'closed' }; }
  if (evidence.state !== 'verified') setState('verified');
  const reserved = call('reserve', ['--lane', 'content', '--slot-number', retrySlot, '--owner', run.owner, '--lease-seconds', CADENCE.leaseSeconds]);
  if (!reserved.reserved) return { state: 'held' };
  try {
    run.budget -= 1;
    const result = attemptBlogIntent(run, retrySlot, reserved.token, rebuilt, fresh, null, evidence);
    if (result.state === 'closed') setState('closed');
    return result;
  } finally {
    call('release', ['--lane', 'content', '--slot-number', retrySlot, '--token', reserved.token]);
  }
}

function handleEvidenceRefusal(run, refusal) {
  if (run.evidencePassUsed || run.call('count').contentCount >= CADENCE.contentGoal) return { state: 'closed' };
  run.evidencePassUsed = true;
  const { candidate, snapshot, key } = refusal;
  if (!run.deps.modules.verifySourcePack(candidate.pack, { businesses: snapshot.businesses, posts: snapshot.posts,
    services: snapshot.services, topics: snapshot.topics, now: run.deps.now() }).ok) return { state: 'closed' };
  const category = evidenceCategory(candidate.pack, snapshot);
  const claim = run.call('evidence-claim', ['--intent-fingerprint', candidate.fingerprint, '--original-key', key,
    '--original-title', candidate.title, ...(category ? ['--category', category] : [])]);
  if (!claim.claimed) return { state: 'closed' };
  return continueEvidence(run, claim.evidence, true);
}

export function runWeeklyBlog({ target, slot, request = {}, deps }) {
  const now = deps.now();
  const week = deps.modules.weekStartUtc(now);
  evaluatePriorWeek(deps, target, week, now);
  const remainingBudget = recoverPriorContent(deps, target, slot, week);
  recoverPriorEvidence(deps, target, week);
  const call = cadenceCaller(deps, target, week);
  const count = call('count');
  deps.log('cadence-count', { week, contentCount: count.contentCount });
  const content = call('status').attempts.filter((attempt) => attempt.lane === 'content');
  // All-time, target-scoped consumed intents from the DB (plus live-post duplicates
  // inside checkTopicGroundability); never local state.
  const consumed = new Set(call('consumed'));
  const run = {
    deps, call, target, slot, week, request, kind: 'blog', lane: 'content', policy: dayPolicy(now),
    actor: `runner:weekly-blog#${slot}`, owner: `runner:weekly-blog:${target}:${slot}`,
    consumed, weekFingerprints: new Set(content.map((attempt) => attempt.intent_fingerprint)),
    budget: remainingBudget, reserveLeft: Math.max(0, CADENCE.reservePerWeek - content.filter((a) => String(a.topic_key).startsWith('reserve:')).length),
    reserveSourceIds: new Set(), skipped: new Set(),
    reservedCategories: new Set(content.map((a) => String(a.topic_key)).filter((key) => key.startsWith('reserve:dir:')).map((key) => key.slice('reserve:dir:'.length))),
    evidencePassUsed: false,
  };
  for (const evidence of call('evidence-list')) {
    if (evidence.state === 'retry') continue;
    run.evidencePassUsed = true;
    const resumed = continueEvidence(run, evidence, false);
    if (['pending','held','uncounted','deferred'].includes(resumed.state)) throw new Error('evidence publication pending');
  }
  // Inventory is eligibility, not queue length. Discover once per ISO week
  // when either floor is short; export again only after the trusted discovery
  // submission has passed its own gate/smoke. Empty discovery remains a deficit.
  if (!request.topic) {
    const before = eligibleInventory(run, deps.exportSnapshot());
    const low = before.normal < 6 || before.reserve < 2;
    deps.log('cadence-inventory', { week, ...before, low });
    if (low && typeof deps.replenish === 'function') {
      try { deps.replenish(week); }
      catch (error) { deps.log('cadence-inventory-replenish-failed', { week, reason: failureReason(error) }); }
      // Discovery may have written a queue file without passing its trusted
      // gate. Export restores the DB snapshot before any blog generator spend.
      const after = eligibleInventory(run, deps.exportSnapshot());
      deps.log('cadence-inventory-recheck', { week, ...after, low: after.normal < 6 || after.reserve < 2 });
    }
  }
  if (count.contentCount >= CADENCE.contentGoal) return { cadenceMet: true, noChanges: true, contentCount: count.contentCount };
  deps.log('cadence-plan', { week, phase: run.policy.phase, reserveAllowed: run.policy.reserveAllowed });
  const live = new Set(count.content.map((item) => Number(item.submissionId)));
  let have = count.contentCount;
  let pending = false;
  let uncounted = false;
  let late = false;
  let lastId = null;
  // Evidence retries can occupy slots beyond the goal-driven loop. Reconcile
  // them first under their original key, including after a week rollover.
  for (const attempt of content.filter((item) => Number(item.slot_number) > 2 && isOpen(item))) {
    const result = processContentSlot(run, Number(attempt.slot_number), { resumeOnly: true });
    if (result.state === 'pending' || result.state === 'deferred' || result.state === 'uncounted') pending = true;
    if (result.state === 'late-smoke') late = true;
  }
  // Slots 1..2; a consumed slot whose post left the live count (unpublish,
  // supersede) is final, so catch-up opens the next slot number instead.
  let consumedSlots = 0;
  for (let slotNumber = 1; slotNumber <= Math.min(CADENCE.maxContentSlot, CADENCE.contentGoal + consumedSlots) && have < CADENCE.contentGoal; slotNumber++) {
    let result = processContentSlot(run, slotNumber);
    if (result.refusal) result = handleEvidenceRefusal(run, result.refusal);
    if (result.id != null) lastId = result.id;
    if (result.state === 'consumed' && !live.has(result.consumedId)) consumedSlots += 1;
    if (result.state === 'counted') {
      if (!live.has(Number(result.id))) have += 1;
    } else if (result.state === 'late-smoke') {
      late = true;
      break;
    } else if (['uncounted', 'pending', 'held', 'deferred'].includes(result.state)) {
      // In flight elsewhere, awaiting propagation or alias: never open a replacement.
      if (!live.has(Number(result.id))) have += 1;
      if (result.state === 'uncounted') uncounted = true;
      if (result.state === 'pending' || result.state === 'deferred') pending = true;
    }
  }
  // Only the DB count for this week decides success; local smoke state never does.
  const final = call('count');
  deps.log('cadence-count', { week, contentCount: final.contentCount });
  if (final.contentCount >= CADENCE.contentGoal) return { cadenceMet: true, id: lastId, contentCount: final.contentCount };
  if (late) throw new Error('late smoke; old week missed');
  if (uncounted) throw new Error('smoked but not counted for week');
  if (pending) throw new Error('publish or propagation pending');
  if (run.policy.phase === 'final') {
    deps.log('weekly-content-miss', { week, contentCount: final.contentCount, dbOnlyContentCount: final.dbOnly?.contentCount ?? null });
    throw new Error('weekly content missed');
  }
  deps.log('cadence-deficit', { week, contentCount: final.contentCount, phase: run.policy.phase });
  throw new Error('cadence content deficit');
}

// ---------------------------------------------------------------------------
// weekly-roundup (on-demand, staging-only; docs/specs/weekly-roundup-v2.md §10).
// The per-target mode comes from the pinned tree's scripts/content/roundup-mode.mjs.
// Writer contract: roundup-v2-run.mjs --collect --out --now, then
// --run <collect> --out <out> --root <repo> --now [--dry-run], always writing
// <out>/result.json {pipeline:'structured-v2', isoWeek, slug, now, packDigest,
// verifyDigest, decision, units, coreUnits, coreAnchorUnits, published, census}
// and <out>/pack.json {isoWeek, now, units, stillInEffect, signals, forms}; it
// appends one data/posts.json post only for a `publish` decision without
// --dry-run. The runner enforces post identity and the §7 floor; the trusted
// submit re-verifies everything at T_submit.
// ---------------------------------------------------------------------------
const HEX64 = /^[0-9a-f]{64}$/;
const isIsoInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const ROUNDUP_V2_RUN = 'scripts/news-pilot/roundup-v2-run.mjs';
const ROUNDUP_IG_REFETCH = 'scripts/news-pilot/ig-refetch.mjs';
const ROUNDUP_MIN_UNITS = 3;

function censusCounts(census) {
  if (!census || typeof census !== 'object' || Array.isArray(census)) return {};
  const counts = Object.fromEntries(Object.entries(census).filter(([key, value]) => /^[a-zA-Z0-9_]{1,40}$/.test(key) && Number.isInteger(value) && value >= 0).slice(0, 20));
  const reasons = census.byReason && typeof census.byReason === 'object' && !Array.isArray(census.byReason)
    ? Object.fromEntries(Object.entries(census.byReason).filter(([key, value]) => /^[a-z0-9-]{1,40}$/.test(key) && Number.isInteger(value) && value >= 0).slice(0, 20)) : {};
  return Object.keys(reasons).length ? { ...counts, byReason: reasons } : counts;
}

// Bounded hold census: counts and top reasons only; never URLs or evidence text.
function holdCensus(result) {
  const counts = censusCounts(result?.census);
  for (const key of ['units', 'coreUnits', 'coreAnchorUnits']) if (Number.isInteger(result?.[key]) && result[key] >= 0) counts[key] = result[key];
  const reasons = (Array.isArray(result?.reasons) ? result.reasons : []).filter((reason) => typeof reason === 'string' && /^[a-z0-9-]{1,40}$/.test(reason)).slice(0, 5);
  if (reasons.length) counts.byReason = { ...(counts.byReason ?? {}), ...Object.fromEntries(reasons.map((reason) => [reason, counts.byReason?.[reason] ?? 1])) };
  return counts;
}

// Returns {hold:true, census} for a consistent structured-v2 hold, {post, result,
// pack} for a submit-ready v2 roundup, or throws a safe refusal. No DB writes.
export function validateRoundupOutput({ out, exportedPosts, generatedPosts, week, slotSlug, modules }) {
  let result;
  let pack;
  try {
    result = readBoundedJson(path.join(out, 'result.json'), CADENCE.artifactMaxBytes);
    pack = readBoundedJson(path.join(out, 'pack.json'), CADENCE.artifactMaxBytes);
  } catch { throw new Error('roundup artifact invalid'); }
  if (result?.decision === 'technical-failure') throw new Error('roundup model technical failure');
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.pipeline !== 'structured-v2'
    || typeof result.published !== 'boolean' || !['publish', 'hold'].includes(result.decision)
    || !pack || typeof pack !== 'object' || Array.isArray(pack) || !Array.isArray(pack.units)
    || !Array.isArray(generatedPosts)) throw new Error('roundup artifact invalid');
  const existing = new Set(exportedPosts.map((post) => post?.slug));
  const kept = generatedPosts.filter((post) => existing.has(post?.slug)).length;
  const added = generatedPosts.filter((post) => typeof post?.slug === 'string' && post.slug && !existing.has(post.slug));
  if (kept !== exportedPosts.length || generatedPosts.length !== exportedPosts.length + added.length) throw new Error('roundup artifact inconsistent');
  if (result.decision === 'hold') {
    if (result.published !== false || added.length !== 0) throw new Error('roundup artifact inconsistent');
    return { hold: true, census: holdCensus(result) };
  }
  if (result.published !== true || added.length !== 1 || !Number.isInteger(result.units) || result.units < ROUNDUP_MIN_UNITS
    || !Number.isInteger(result.coreAnchorUnits) || result.coreAnchorUnits < 1 || pack.units.length !== result.units
    || !HEX64.test(result.verifyDigest ?? '')) throw new Error('roundup artifact inconsistent');
  const [post] = added;
  let expectedWeek;
  let expectedSlug;
  try { expectedWeek = modules.isoWeekOf(`${week}T00:00:00.000Z`).isoWeek; expectedSlug = modules.roundupSlug(expectedWeek); }
  catch { throw new Error('roundup artifact inconsistent'); }
  if (result.isoWeek !== expectedWeek || !isIsoInstant(result.now) || modules.isoWeekOf(result.now).isoWeek !== expectedWeek
    || result.slug !== expectedSlug || result.slug !== slotSlug || post.slug !== result.slug || post.category !== 'news') throw new Error('roundup artifact inconsistent');
  if (!post.roundupCoverage || modules.roundupCoverageErrors(post).length) throw new Error('roundup artifact inconsistent');
  if (!HEX64.test(result.packDigest ?? '') || modules.roundupPackDigest(pack) !== result.packDigest) throw new Error('roundup artifact inconsistent');
  return { hold: false, result, pack, post, census: holdCensus(result) };
}

function roundupArtifactDir(deps, target, week, digest) {
  return path.join(deps.stateRoot, 'roundup-attempts', `${target}-${week}-${digest.slice(0, 32)}`);
}

// Keep the exact validated artifacts per pack digest so a crash-before-submit
// can resubmit the SAME key/intent instead of burning a new ordinal. Snapshots
// the pack cites (by content address) are retained with it (§8).
function persistRoundupArtifacts(dir, out, snapshotId, deps, snapshotsDir = null) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of ['result.json', 'pack.json']) fs.copyFileSync(path.join(out, name), path.join(dir, name));
  fs.copyFileSync(path.join(deps.repo, 'data', 'posts.json'), path.join(dir, 'posts.json'));
  fs.writeFileSync(path.join(dir, 'snapshot.json'), `${JSON.stringify({ snapshotId })}\n`, { mode: 0o600 });
  if (!snapshotsDir || !fs.existsSync(snapshotsDir)) return;
  const cited = new Set(fs.readFileSync(path.join(out, 'pack.json'), 'utf8').match(/[0-9a-f]{64}/g) ?? []);
  for (const source of fs.readdirSync(snapshotsDir, { withFileTypes: true })) {
    if (!source.isDirectory() || !/^[a-z0-9:_-]{1,80}$/i.test(source.name)) continue;
    for (const file of fs.readdirSync(path.join(snapshotsDir, source.name), { withFileTypes: true })) {
      const match = /^([0-9a-f]{64})\.(json|html)$/.exec(file.name);
      if (!file.isFile() || !match || !cited.has(match[1])) continue;
      const target = path.join(dir, 'snapshots', source.name);
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.join(snapshotsDir, source.name, file.name), path.join(target, file.name));
      fs.chmodSync(path.join(target, file.name), 0o600);
    }
  }
}

// Instagram units are re-verified at submit only from a runner-owned re-fetch
// file written by the source-only helper under sourceEnv('weekly-roundup'); the
// provider token never reaches the trusted submit, the generator or the gate.
const isInstagramSignal = (signal) => typeof signal?.sourceId === 'string' && (signal.sourceId === 'rv2-instagram' || signal.sourceId.startsWith('ig:'));
function packCitesInstagram(dir) {
  try { return (readBoundedJson(path.join(dir, 'pack.json'), CADENCE.artifactMaxBytes).signals ?? []).some(isInstagramSignal); }
  catch { return false; }
}
function refreshInstagram(deps, dir) {
  if (!packCitesInstagram(dir)) return [];
  const file = path.join(dir, 'ig-refetch.json');
  fs.rmSync(file, { force: true });
  try {
    deps.source(ROUNDUP_IG_REFETCH, ['--pack', path.join(dir, 'pack.json'), '--out', file]);
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
    deps.log('roundup-ig-refetch', { ok: fs.existsSync(file) });
  } catch (error) {
    // Submit still runs and refuses the Instagram units (§10.3 step 5).
    deps.log('roundup-ig-refetch-failed', { reason: failureReason(error) });
  }
  return ['--ig-refetch', file];
}

function submitRoundup(run, token, key, dir) {
  const { deps, call } = run;
  const fail = (reason) => {
    call('outcome', ['--idempotency-key', key, '--token', token, '--outcome', 'failed-before-submit']);
    deps.log('cadence-attempt-failed', { lane: 'roundup', reason });
    throw new Error('roundup submit refused');
  };
  const igArgs = refreshInstagram(deps, dir);
  let submitted;
  try { submitted = parseJson(deps.cli(['submit', '--dir', '.', '--kind', 'roundup', '--roundup-out', dir, ...igArgs, '--idempotency-key', key, '--actor', run.actor]).stdout); }
  catch (error) {
    if (['cli-validation', 'cli-conflict'].includes(error?.cliFailure?.reason)) fail('submit-refused');
    throw error;
  }
  if (submitted.submissionId == null) fail('no-submission');
  deps.log('submission', { id: submitted.submissionId });
  call('attach', ['--idempotency-key', key, '--token', token, '--submission-id', submitted.submissionId]);
  call('renew', ['--lane', 'roundup', '--slot-number', 1, '--token', token, '--lease-seconds', CADENCE.leaseSeconds]);
  const gate = gateState(deps, run.target, submitted.submissionId, run.actor);
  return { state: settleAttempt(deps, run, key, token, submitted.submissionId, gate), id: submitted.submissionId };
}

function retryRoundupAttempt(run, token, attempt, slotSlug) {
  const { deps } = run;
  const snapshot = deps.exportSnapshot();
  const dir = roundupArtifactDir(deps, run.target, run.week, attempt.source_pack_digest);
  let saved = null;
  try { saved = readBoundedJson(path.join(dir, 'snapshot.json'), 4096); } catch { /* no retained artifacts */ }
  if (saved?.snapshotId && saved.snapshotId === snapshot.snapshotId) {
    let reusable = false;
    try {
      fs.copyFileSync(path.join(dir, 'posts.json'), path.join(deps.repo, 'data', 'posts.json'));
      const checked = validateRoundupOutput({ out: dir, exportedPosts: snapshot.posts, generatedPosts: readBoundedJson(path.join(deps.repo, 'data', 'posts.json'), CADENCE.postsMaxBytes), week: run.week, slotSlug, modules: deps.modules });
      reusable = !checked.hold && checked.result.packDigest === attempt.source_pack_digest;
    } catch { /* retained artifacts are missing or invalid */ }
    if (reusable) return submitRoundup(run, token, attempt.idempotency_key, dir);
  }
  run.call('outcome', ['--idempotency-key', attempt.idempotency_key, '--token', token, '--outcome', 'failed-before-submit']);
  deps.log('cadence-attempt-failed', { lane: 'roundup', reason: 'retry-artifacts-changed' });
  return { state: 'closed' };
}

// One v2 pipeline pass for this slot. Collection is reused only within the same
// slot (crash resume); a later slot re-collects fresh signals.
function runRoundupPipeline({ deps, slot, now, dryRun }) {
  const runDir = path.join(deps.stateRoot, 'roundup', slot);
  const collect = path.join(runDir, 'collect');
  const out = path.join(runDir, 'out');
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  fs.rmSync(out, { recursive: true, force: true });
  if (!fs.existsSync(path.join(collect, 'signals.jsonl')))
    deps.source(ROUNDUP_V2_RUN, ['--collect', '--out', collect, '--now', now.toISOString()]);
  deps.source(ROUNDUP_V2_RUN, ['--run', collect, '--out', out, '--root', deps.repo, '--now', now.toISOString(), ...(dryRun ? ['--dry-run'] : [])]);
  return { out, snapshots: path.join(collect, 'snapshots') };
}

function censusOnlyRoundup({ slot, deps, now, week, mode }) {
  // No reservation, attempt or submit. Even if the writer mistakenly accepts an
  // item, its dry run cannot append a post; independently verify the exported
  // posts stayed byte-identical.
  deps.exportSnapshot();
  const postsFile = path.join(deps.repo, 'data', 'posts.json');
  const before = fs.readFileSync(postsFile, 'utf8');
  const { out } = runRoundupPipeline({ deps, slot, now, dryRun: true });
  let result;
  let pack;
  try {
    result = readBoundedJson(path.join(out, 'result.json'), CADENCE.artifactMaxBytes);
    pack = readBoundedJson(path.join(out, 'pack.json'), CADENCE.artifactMaxBytes);
  } catch { throw new Error('roundup census invalid'); }
  if (result?.decision === 'technical-failure') throw new Error('roundup model technical failure');
  if (result?.pipeline !== 'structured-v2' || result.published !== false || !result.census || typeof result.census !== 'object' || Array.isArray(result.census)
    || !pack || !Array.isArray(pack.units) || fs.readFileSync(postsFile, 'utf8') !== before)
    throw new Error('roundup census invalid');
  const census = holdCensus(result);
  deps.log('roundup-publication-held', { week, mode, census });
  return { noChanges: true, reason: 'roundup-publication-disabled', census, week };
}

// Prior-week roundup reconciliation (§10.3.1): settle up to two unresolved
// attempts from ended weeks with their ORIGINAL idempotency keys, before the
// current week is counted. Never drafts or submits an old-week edition. Resume
// reads only the DB and the idempotency lookup, so VM state loss changes nothing.
function recoverPriorRoundup(deps, target, slot, week) {
  const attempts = cadenceCaller(deps, target, week)('unresolved', ['--lane', 'roundup']);
  const prior = attempts.filter((a) => a.lane === 'roundup' && a.week_start_utc < week);
  for (const attempt of prior.slice(0, 2)) {
    const call = cadenceCaller(deps, target, attempt.week_start_utc);
    const owner = `runner:weekly-roundup:${target}:${slot}`;
    const reserved = call('reserve', ['--lane', 'roundup', '--slot-number', 1, '--owner', owner, '--lease-seconds', CADENCE.leaseSeconds]);
    if (!reserved.reserved) throw new Error('prior roundup slot held');
    const run = { deps, call, target, week: attempt.week_start_utc, kind: 'roundup', lane: 'roundup', actor: `runner:weekly-roundup#${slot}` };
    let result;
    try {
      result = resumeOpenAttempt(deps, run, attempt, reserved.token);
      if (result.state === 'no-submission') {
        call('outcome', ['--idempotency-key', attempt.idempotency_key, '--token', reserved.token, '--outcome', 'failed-before-submit']);
        deps.log('cadence-attempt-failed', { lane: 'roundup', week: attempt.week_start_utc, reason: 'prior-no-submission' });
        result = { state: 'closed' };
      }
    } finally {
      try { call('release', ['--lane', 'roundup', '--slot-number', 1, '--token', reserved.token]); }
      catch (error) { deps.log('cadence-release-failed', { lane: 'roundup', reason: error?.cliFailure?.reason ?? 'operational-error' }); }
    }
    deps.log('cadence-prior-roundup', { week: attempt.week_start_utc, state: result.state });
    if (!['closed', 'counted', 'late-smoke'].includes(result.state)) throw new Error('prior roundup publication pending');
  }
  if (prior.length > 2) throw new Error('prior roundup backlog exceeds recovery budget');
}

export function runWeeklyRoundup({ target, slot, request = {}, deps }) {
  // Refused for production here as well as in main() and the launcher.
  if (target === 'production') throw new Error('weekly-roundup is staging-only');
  if (request.dryRun || request.topic) throw new Error('weekly-roundup options unsupported');
  const mode = deps.roundupPublicationMode ?? deps.modules.roundupPublication?.[target];
  if (!['census-only', 'structured-v2'].includes(mode)) throw new Error('roundup publication disabled');
  const now = deps.now();
  const week = deps.modules.weekStartUtc(now);
  evaluatePriorWeek(deps, target, week, now);
  // census-only never reserves, attempts or submits, so it has nothing to settle.
  if (mode === 'structured-v2') recoverPriorRoundup(deps, target, slot, week);
  const call = cadenceCaller(deps, target, week);
  const count = call('count');
  deps.log('cadence-count', { week, roundupCount: count.roundupCount });
  if (count.roundupCount >= 1) return { cadenceMet: true, noChanges: true };
  if (mode === 'census-only') return censusOnlyRoundup({ slot, deps, now, week, mode });
  const run = { deps, call, target, week, kind: 'roundup', lane: 'roundup', actor: `runner:weekly-roundup#${slot}` };
  const reservation = call('reserve', ['--lane', 'roundup', '--slot-number', 1, '--owner', `runner:weekly-roundup:${target}:${slot}`, '--lease-seconds', CADENCE.leaseSeconds]);
  // Losers of the one-per-week roundup slot never draft a second candidate.
  if (!reservation.reserved) { deps.log('cadence-slot-held', { lane: 'roundup', holder: reservation.holder === 'self' ? 'self' : 'other' }); return { noChanges: true, reason: 'roundup-slot-held' }; }
  const token = reservation.token;
  const slotSlug = reservation.slot?.roundup_slug;
  const finish = (result) => {
    if (result.state === 'pending') throw new Error('publish or propagation pending');
    if (result.state === 'closed') throw new Error('gate blocked or rejected');
    if (result.state === 'late-smoke') throw new Error('late smoke; old week missed');
    if (result.state !== 'counted') throw new Error('smoked but not counted for week');
    return { id: result.id, success: true, cadenceMet: true };
  };
  try {
    const attempts = call('status').attempts.filter((a) => a.lane === 'roundup').sort(byOrdinal);
    const latest = attempts.at(-1);
    // count found no current-live roundup, so a consumed slot means its item was
    // unpublished/superseded. cadence.mjs cannot reopen a consumed slot: operator review.
    if (reservation.slot?.state === 'consumed' || latest?.outcome === 'consumed') {
      deps.log('roundup-consumed-not-live', { week });
      throw new Error('roundup consumed but no longer live');
    }
    if (latest && isOpen(latest)) {
      let resumed = resumeOpenAttempt(deps, run, latest, token);
      if (resumed.state === 'no-submission') resumed = retryRoundupAttempt(run, token, latest, slotSlug);
      if (resumed.state !== 'closed') return finish(resumed);
    }
    const snapshot = deps.exportSnapshot();
    const { out, snapshots } = runRoundupPipeline({ deps, slot, now, dryRun: false });
    let generatedPosts;
    try { generatedPosts = readBoundedJson(path.join(deps.repo, 'data', 'posts.json'), CADENCE.postsMaxBytes); }
    catch { throw new Error('roundup artifact invalid'); }
    const checked = validateRoundupOutput({ out, exportedPosts: snapshot.posts, generatedPosts, week, slotSlug, modules: deps.modules });
    if (checked.hold) {
      // Non-terminal hold under the §7 rule: no attempt; the slot is released so a
      // later slot this week re-collects. Only `cadence deadline` emits a missed alert.
      deps.log('roundup-hold', { week, census: checked.census });
      return { noChanges: true, reason: 'roundup-hold', census: checked.census, week };
    }
    const digest = checked.result.packDigest;
    const dir = roundupArtifactDir(deps, target, week, digest);
    persistRoundupArtifacts(dir, out, snapshot.snapshotId, deps, snapshots);
    let recorded;
    try { recorded = call('attempt', ['--lane', 'roundup', '--slot-number', 1, '--token', token, '--intent-fingerprint', digest, '--topic-key', checked.result.slug, '--source-pack-digest', digest]); }
    catch (error) {
      if (error?.cliFailure?.reason === 'cli-validation') throw new Error('roundup intent already attempted');
      throw error;
    }
    if (recorded.existing) throw new Error('cadence attempt already open');
    deps.log('cadence-attempt', { lane: 'roundup', units: checked.pack.units.length, census: checked.census });
    return finish(submitRoundup(run, token, recorded.idempotencyKey, dir));
  } finally {
    try { call('release', ['--lane', 'roundup', '--slot-number', 1, '--token', token]); }
    catch (error) { deps.log('cadence-release-failed', { lane: 'roundup', reason: error?.cliFailure?.reason ?? 'operational-error' }); }
  }
}

// The runner is installed standalone (/usr/local/libexec), so trusted helpers are
// loaded from the pinned, freshly checked-out repo, never from scratch.
async function trustedModules(root) {
  const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  const [cadence, queue, pack, evidence, roundup, roundupMode, validate] = await Promise.all([
    load('scripts/content/cadence.mjs'), load('scripts/automation/topic-queue.mjs'), load('scripts/automation/blog-source-pack.mjs'),
    load('scripts/news-pilot/roundup-evidence.mjs'), load('scripts/news-pilot/roundup.mjs'),
    load('scripts/content/roundup-mode.mjs'), load('scripts/content/validate.mjs'),
  ]);
  return {
    weekStartUtc: cadence.weekStartUtc, checkTopicGroundability: queue.checkTopicGroundability, reserveGuideEligibility: queue.reserveGuideEligibility,
    buildSourcePack: pack.buildSourcePack, verifySourcePack: pack.verifySourcePack, canonicalJson: pack.canonicalJson, checkDraftAgainstPack: pack.checkDraftAgainstPack,
    roundupPackDigest: evidence.roundupPackDigest, isoWeekOf: roundup.isoWeekOf, roundupSlug: roundup.roundupSlug,
    roundupPublication: roundupMode.ROUNDUP_PUBLICATION, roundupCoverageErrors: validate.roundupCoverageErrors,
  };
}

function exportSnapshot(target, log) {
  cli(['export', '--root', '.', '--target', target]);
  logLine(log, 'export');
  const data = (name) => readJson(path.join(repo, 'data', name));
  return {
    businesses: data('businesses.json'), posts: data('posts.json'), services: data('services.json'), topics: data('topics.json'),
    queue: data('topic-queue.json'), snapshotId: readJson(path.join(repo, '.content-export', 'manifest.json')).snapshot_id,
  };
}

// The runner is single-instance under global.lock, but an empty/failed source
// produces no submission to find by idempotency key. Persist the *attempt* before
// discovery so a restart cannot spend the same weekly source call repeatedly.
export function claimWeeklyInventoryDiscovery(root, target, week) {
  if (!['staging', 'production'].includes(target) || !/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error('invalid inventory claim');
  const dir = path.join(root, 'inventory-discovery', target);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const marker = path.join(dir, `${week}.json`);
  let fd;
  try { fd = fs.openSync(marker, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  try { fs.writeSync(fd, JSON.stringify({ target, week, attempted: true }) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return true;
}

async function cadenceDeps(job, target, slot, log) {
  return {
    repo, stateRoot, modules: await trustedModules(repo), now: () => new Date(), alertsEnabled: Boolean(process.env.SLACK_WEBHOOK_URL),
    cadenceStartWeek: process.env.CADENCE_START_ISO_WEEK,
    cli: (args, allowExit = []) => cli(args, repo, allowExit),
    log: (event, details) => logLine(log, event, details),
    exportSnapshot: () => exportSnapshot(target, log),
    generate: (title) => generator('weekly-blog', slot, { title }, false, log),
    source: (script, args) => source(script, args, job, log),
    replenish: (week) => {
      const refillSlot = `${week.replaceAll('-', '')}-inventory`;
      const prior = lookup('topic-discovery', target, refillSlot, log);
      if (prior) return prior;
      if (!claimWeeklyInventoryDiscovery(stateRoot, target, week)) return { noChanges: true, reason: 'weekly-discovery-already-attempted' };
      source('scripts/automation/topic-queue.mjs', ['discover'], 'topic-discovery', log);
      return submitAndGate('topic-discovery', target, refillSlot, log);
    },
    discoverEvidence: (evidence, category, allowSource) => discoverEvidence(evidence, category, target, log, allowSource),
    evidenceLive: (submissionId) => liveBusinessSlugs(submissionId, target),
  };
}

async function runJob(job, target, slot, request, log, notifications = {}) {
  if (job === 'weekly-blog' || job === 'weekly-roundup') {
    cli(['cadence', 'preflight', '--target', target]);
    logLine(log, 'cadence-schema-ready');
  }
  if (job === 'weekly-growth-report') {
    source('scripts/generate-weekly-growth-report.mjs', ['--out-dir', path.join(stateRoot, 'growth', slot)], job, log);
    return;
  }
  if (job === 'weekly-roundup') return runWeeklyRoundup({ target, slot, request, deps: await cadenceDeps(job, target, slot, log) });
  if (job === 'weekly-blog') {
    if (!request.dryRun) return runWeeklyBlog({ target, slot, request, deps: await cadenceDeps(job, target, slot, log) });
    cli(['export', '--root', '.', '--target', target]);
    logLine(log, 'export');
    const changed = generator(job, slot, request.topic ? { title: request.topic } : null, true, log, notifications);
    return { dryRun: true, paths: changed.length };
  }
  const previous = job === 'news' && request.dryRun ? null : lookup(job, target, slot, log);
  if (previous) return previous;
  cli(['export', '--root', '.', '--target', target]);
  logLine(log, 'export');
  if (job === 'topic-discovery') {
    source('scripts/automation/topic-queue.mjs', ['discover'], job, log);
    return submitAndGate(job, target, slot, log);
  }
  if (job === 'discover-businesses') {
    source('scripts/discover-businesses.mjs', ['--max=15'], job, log);
    const result = submitAndGate(job, target, slot, log);
    cli(['stats', '--alert', '--target', target]);
    return result;
  }
  if (job === 'seo-improvements') {
    const baseline = command(node, ['scripts/content/seo-guard.mjs', 'capture'], { cwd: repo, env: sourceEnv(process.env, job) }).stdout;
    const baselinePath = path.join(stateRoot, 'seo-baseline', `${slot}.json`);
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, baseline, { mode: 0o600 });
    const topic = request.topic ? { title: request.topic, key: null } : null;
    const changed = generator(job, slot, topic, !!request.dryRun, log, notifications);
    if (request.dryRun) return { dryRun: true, paths: changed.length };
    if (!changed.some((rel) => /^data\/[^/]+\.json$/.test(rel))) return { noChanges: true };
    const guard = command(node, ['scripts/content/seo-guard.mjs', 'check', baselinePath], { cwd: repo, env: sourceEnv(process.env, job), allowExit: [2] });
    if (guard.code === 2) throw new Error('SEO data lane blocked');
    const decision = parseJson(guard.stdout).decision;
    if (decision !== 'submit') return { noChanges: true };
    return submitAndGate(job, target, slot, log);
  }
  if (job === 'news') {
    // Match the DB workflow: an unfinished news submission takes precedence
    // over a new draft. A dry run never resumes or publishes it.
    if (!request.dryRun) {
      const pending = parseJson(cli(['list', '--submissions', '--kind', 'news', '--state', 'open,gating', '--target', target]).stdout);
      if (pending.length) {
        for (const item of pending) gate(item.id, target, `runner:news#${slot}`, log);
        return { resumed: pending.length };
      }
      // Query only incomplete propagation, not every historical published row.
      // One filtered query avoids per-row CLI calls; the missing index/result cap is #181.
      const pendingPropagation = parseJson(cli(['pending', '--kind', 'news', '--target', target]).stdout);
      if (pendingPropagation.length) {
        const resumed = cli(['deploy', '--target', target], repo, [3]);
        logLine(log, 'news-deploy-resume', { exit: resumed.code });
        if (resumed.code === 3) throw new Error('news propagation pending');
        return { resumed: pendingPropagation.length };
      }
    }
    const run = path.join(stateRoot, 'news', slot);
    const discovery = path.join(run, 'discovery');
    const publish = path.join(run, 'publish');
    fs.mkdirSync(run, { recursive: true, mode: 0o700 });
    const baselinePath = path.join(run, 'manifest.json');
    const postsPath = path.join(run, 'posts.json');
    const currentManifest = readJson(path.join(repo, '.content-export', 'manifest.json'));
    if (fs.existsSync(baselinePath)) {
      if (readJson(baselinePath).snapshot_id !== currentManifest.snapshot_id) throw new Error('news resume snapshot changed');
    } else fs.copyFileSync(path.join(repo, '.content-export', 'manifest.json'), baselinePath);
    if (fs.existsSync(postsPath)) fs.copyFileSync(postsPath, path.join(repo, 'data', 'posts.json'));
    if (!fs.existsSync(path.join(discovery, 'candidates.json'))) source('scripts/news-pilot/run.mjs', [`--out=${discovery}`, request.dryRun ? '--dry-run' : '--no-dry-run', '--vault=/dev/null'], job, log);
    const discovered = readJson(path.join(discovery, 'candidates.json'));
    if ((discovered.meta?.sourcesOk ?? 0) < 1) throw new Error('no healthy news source');
    const generatedNow = !fs.existsSync(path.join(publish, 'result.json'));
    const publishStarted = path.join(run, 'publish-started.flag');
    if (generatedNow && fs.existsSync(publishStarted)) throw new Error('news publish interrupted; manual recovery required');
    if (generatedNow) fs.writeFileSync(publishStarted, '1', { mode: 0o600 });
    if (generatedNow) source('scripts/news-pilot/publish.mjs', [`--run=${discovery}`, `--out=${publish}`, '--vault=/dev/null', ...(request.dryRun ? ['--dry-run'] : [])], job, log);
    const published = readJson(path.join(publish, 'result.json'));
    if (request.dryRun) return { dryRun: true };
    if (published.published !== 1) return { noChanges: true };
    if (!fs.existsSync(postsPath)) {
      if (generatedNow && fs.existsSync(path.join(repo, 'data', 'posts.json'))) {
        fs.copyFileSync(path.join(repo, 'data', 'posts.json'), postsPath);
      } else throw new Error('news post artifact missing; manual recovery required');
    }
    return submitAndGate(job, target, slot, log, ['--news-out', publish]);
  }
  throw new Error('unknown job');
}

// Stable, non-secret failure classes that may appear in logs; anything else is
// reduced to operational-error.
export const SAFE_FAILURES = Object.freeze(new Set([
  'runner hold active', 'news resume snapshot changed', 'news post artifact missing; manual recovery required',
  'no healthy news source', 'SEO code suggestion; human PR required', 'blog generated no post', 'blog generated no submission',
  'gate blocked or rejected', 'publish or propagation pending', 'scratch output outside allowlist', 'scratch output too large',
  'generator changed pinned commit', 'weekly content missed', 'cadence content deficit', 'cadence attempt already open',
  'weekly-roundup is staging-only', 'weekly-roundup options unsupported', 'roundup artifact invalid', 'roundup artifact inconsistent',
  'roundup submit refused', 'roundup intent already attempted', 'idempotency kind mismatch', 'submission lacks smoke success',
  'smoked but not counted for week', 'late smoke; old week missed', 'roundup consumed but no longer live',
  'invalid cadence start week', 'roundup publication disabled', 'roundup census invalid', 'roundup model technical failure',
  'prior content slot held', 'prior content publication pending', 'prior content backlog exceeds recovery budget',
  'prior content smoke not current-live',
  'prior roundup slot held', 'prior roundup publication pending', 'prior roundup backlog exceeds recovery budget',
  'prior roundup smoke not current-live',
]));
export function failureReason(error) {
  return error?.cliFailure?.reason ?? (error instanceof SyntaxError ? 'invalid-json' : SAFE_FAILURES.has(error?.message) ? error.message : 'operational-error');
}

export async function main(argv = process.argv.slice(2)) {
  const [job, target, slot] = argv;
  slotKey(job, target, slot);
  fs.mkdirSync(logRoot, { recursive: true, mode: 0o700 });
  const log = path.join(logRoot, `${job}-${target}-${slot}.jsonl`);
  logLine(log, 'start', { job, target, slot });
  const notifications = {};
  try {
    if (JOBS[job].stagingOnly && target !== 'staging') throw new Error('weekly-roundup is staging-only');
    assertTarget(process.env, target);
    if (fs.existsSync('/etc/lv-runner.hold')) throw new Error('runner hold active');
    const requestPath = path.join(stateRoot, 'requests', `${slot}.json`);
    const request = fs.existsSync(requestPath) ? readJson(requestPath) : {};
    const sha = checkout(target, log);
    const result = await runJob(job, target, slot, request, log, notifications);
    if (job === 'weekly-roundup' && ['roundup-publication-disabled', 'roundup-hold'].includes(result?.reason)) {
      const alerted = await alertFailure({ webhook: process.env.SLACK_WEBHOOK_URL, job, target, slot, holdCensus: result.census, holdWeek: result.week });
      logLine(log, alerted ? 'roundup-hold-alerted' : 'roundup-hold-alert-skipped', { census: result.census });
    }
    logLine(log, 'success', { sha, result: result && { id: result.id ?? null, dryRun: !!result.dryRun, noChanges: !!result.noChanges, ...(result.cadenceMet !== undefined ? { cadenceMet: result.cadenceMet } : {}), ...(typeof result.reason === 'string' ? { reason: result.reason } : {}) } });
  } catch (error) {
    const reason = failureReason(error);
    const stuckSubmissionId = Number.isSafeInteger(error?.stuckSubmissionId) && error.stuckSubmissionId > 0 ? error.stuckSubmissionId : null;
    logLine(log, 'failure', { error: reason, ...(stuckSubmissionId ? { submissionId: stuckSubmissionId } : {}), ...(error?.cliFailure ? { action: error.cliFailure.action, exit: error.cliFailure.exit } : {}) });
    const alerted = await alertFailure({ webhook: process.env.SLACK_WEBHOOK_URL, job, target, slot, codeSuggestion: reason === 'SEO code suggestion; human PR required', stuckSubmissionId });
    if (!alerted) logLine(log, 'alert-failed');
    throw new Error(`runner failed: ${job}/${target}/${slot}`);
  } finally {
    if (notifications.codeSuggestion) {
      const alerted = await alertFailure({ webhook: process.env.SLACK_WEBHOOK_URL, job, target, slot, codeSuggestion: true });
      logLine(log, alerted ? 'seo-code-suggestion-notified' : 'seo-code-suggestion-alert-failed');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
