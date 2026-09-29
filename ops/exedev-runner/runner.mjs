import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const JOBS = Object.freeze({
  'topic-discovery': { calendar: 'Mon *-*-* 10:00:00 UTC', kind: 'topic-discovery' },
  'seo-improvements': { calendar: 'Mon *-*-* 10:11:00 UTC', kind: 'seo' },
  'discover-businesses': { calendar: 'Mon *-*-* 13:00:00 UTC', kind: 'business' },
  news: { calendar: '*-*-* 12:17:00 UTC', kind: 'news' },
  'weekly-growth-report': { calendar: 'Thu *-*-* 10:37:00 UTC', kind: null },
  'weekly-blog': { calendar: 'Sun,Wed *-*-* 11:00:00 UTC', kind: 'blog' },
});
export const PUBLIC_REMOTE = 'https://github.com/jonkthomas/libertyvillage.git';
const BASE_ENV = ['PATH', 'HOME', 'LANG', 'TZ', 'NODE_ENV'];
const DB_ENV = ['CONTENT_DATABASE_URL', 'CONTENT_DATABASE_URL_UNPOOLED', 'CONTENT_DB_NAME', 'CONTENT_TARGET', 'CONTENT_SITE_URL', 'CONTENT_SITE_BYPASS', 'CONTENT_DEPLOY_HOOK_URL', 'SLACK_WEBHOOK_URL'];
const SOURCE_ENV = {
  'topic-discovery': ['GOOGLE_APPLICATION_CREDENTIALS', 'POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE', 'SERPAPI_API_KEY'],
  'discover-businesses': ['SERPAPI_API_KEY', 'PEXELS_API_KEY'],
  news: ['SERPAPI_API_KEY', 'SERPER_API_KEY', 'ANTHROPIC_API_KEY', 'BYTEPLUS_API_KEY', 'ARK_API_KEY'],
  'weekly-growth-report': ['GOOGLE_APPLICATION_CREDENTIALS', 'POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE'],
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

export function selectTopic(queue, state, target) {
  const entries = Array.isArray(queue?.topics) ? queue.topics : [];
  return entries.find((topic) => topic.kind === 'blog' && typeof topic.title === 'string' && typeof topic.key === 'string' && topic.title.trim() && (state[target]?.[topic.key]?.attempts ?? 0) < 3 && !state[target]?.[topic.key]?.consumed && !state[target]?.[topic.key]?.pendingSlot) ?? null;
}

function writeTopicState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temp = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temp, statePath);
}

export function recordTopic(statePath, target, topic, consumed = false) {
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  state[target] ??= {};
  const prior = state[target][topic.key] ?? { attempts: 0, consumed: false };
  state[target][topic.key] = { attempts: prior.attempts + (consumed ? 0 : 1), consumed: consumed || prior.consumed };
  writeTopicState(statePath, state);
}

// A generator that produced no post must not burn the next two calendar slots
// on the same unsupported topic. This is local eligibility state, not a Neon
// queue update or a claim that the topic was published.
export function exhaustTopicOnNoPost(statePath, target, topic) {
  if (!topic?.key) return;
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  state[target] ??= {};
  const prior = state[target][topic.key] ?? { attempts: 0, consumed: false };
  state[target][topic.key] = { ...prior, attempts: Math.max(3, prior.attempts), consumed: prior.consumed };
  writeTopicState(statePath, state);
}

// Reserve a real submitted topic while publication/smoke is pending. A new
// calendar slot must not draft it again, but it is not consumed until smoke.
export function reserveTopicSubmission(statePath, target, topic, slot, id) {
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  state[target] ??= {};
  const prior = state[target][topic.key] ?? { attempts: 0, consumed: false };
  state[target][topic.key] = { ...prior, pendingSlot: slot, pendingSubmissionId: id };
  writeTopicState(statePath, state);
}

export function clearTopicReservation(statePath, target, topic, slot) {
  if (!fs.existsSync(statePath)) return;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const prior = state[target]?.[topic.key];
  if (!prior || prior.pendingSlot !== slot) return;
  delete prior.pendingSlot;
  delete prior.pendingSubmissionId;
  writeTopicState(statePath, state);
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

export async function alertFailure({ webhook, job, target, slot, codeSuggestion = false }, fetchImpl = fetch) {
  if (!webhook) return false;
  try {
    const response = await fetchImpl(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: codeSuggestion ? `⚠ ${job} proposed code outside the data lane (${target}); human PR required; lv-runner ${slot}` : `⚠ ${job} DB content job failed (${target}); lv-runner ${slot}` }), signal: AbortSignal.timeout(10_000) });
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
  command('sudo', ['-n', helper, job, slot], { cwd: repo, env: childEnv(process.env, ['PATH', 'HOME', 'LANG', 'TZ']) });
  const head = command('git', ['rev-parse', 'HEAD'], { cwd: repo, env: gitEnv }).stdout.trim();
  if (readScratchHead(scratch) !== head) throw new Error('generator changed pinned commit');
  const allPaths = changedPaths(scratch, repo);
  const paths = generatedPathsForTransfer(allPaths, job);
  const discarded = allPaths.filter((rel) => !allowedGeneratedPath(rel, job));
  if (discarded.length) logLine(log, 'generator-output-discarded', { paths: discarded.slice(0, 20).map((rel) => rel.slice(0, 160)), omitted: Math.max(0, discarded.length - 20) });
  if (job === 'weekly-blog' && !paths.includes('data/posts.json')) throw new Error('blog generated no post');
  if (job === 'seo-improvements' && discarded.some(seoCodeSuggestionPath)) {
    notifications.codeSuggestion = true;
    logLine(log, 'seo-code-suggestion', { paths: discarded.filter(seoCodeSuggestionPath).slice(0, 20).map((rel) => rel.slice(0, 160)) });
  }
  const changed = acceptGeneratedOutput(scratch, repo, job, paths, exportedPosts);
  logLine(log, 'generator-output-accepted', { paths: changed.length });
  fs.rmSync(scratch, { recursive: true, force: true });
  return changed;
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

// A resumed gate may finish publication after the original process died before
// persisting local topic consumption. Only a confirmed smoke success can consume.
export function consumeResumedBlogTopic(root, target, slot, request, result) {
  if (!result?.success || result.id == null || request?.topic) return false;
  const selectedPath = path.join(root, 'topics', `${slot}.json`);
  if (!fs.existsSync(selectedPath)) return false;
  const topic = readJson(selectedPath);
  if (!topic?.key) return false;
  recordTopic(path.join(root, 'topic-state.json'), target, topic, true);
  return true;
}

function runJob(job, target, slot, request, log, notifications = {}) {
  if (job === 'weekly-growth-report') {
    source('scripts/generate-weekly-growth-report.mjs', ['--out-dir', path.join(stateRoot, 'growth', slot)], job, log);
    return;
  }
  let previous;
  try { previous = job === 'news' && request.dryRun ? null : lookup(job, target, slot, log); }
  catch (error) {
    if (job === 'weekly-blog' && error.message === 'gate blocked or rejected') {
      const selectedPath = path.join(stateRoot, 'topics', `${slot}.json`);
      if (fs.existsSync(selectedPath)) clearTopicReservation(path.join(stateRoot, 'topic-state.json'), target, readJson(selectedPath), slot);
    }
    throw error;
  }
  if (previous) {
    if (job === 'weekly-blog') consumeResumedBlogTopic(stateRoot, target, slot, request, previous);
    return previous;
  }
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
  if (job === 'weekly-blog' || job === 'seo-improvements') {
    let baselinePath = null;
    if (job === 'seo-improvements') {
      const baseline = command(node, ['scripts/content/seo-guard.mjs', 'capture'], { cwd: repo, env: sourceEnv(process.env, job) }).stdout;
      baselinePath = path.join(stateRoot, 'seo-baseline', `${slot}.json`);
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, baseline, { mode: 0o600 });
    }
    let topic = null;
    if (job === 'weekly-blog' && !request.topic) {
      const selectedPath = path.join(stateRoot, 'topics', `${slot}.json`);
      if (fs.existsSync(selectedPath)) topic = readJson(selectedPath);
      else {
        const statePath = path.join(stateRoot, 'topic-state.json');
        const state = fs.existsSync(statePath) ? readJson(statePath) : {};
        const queue = readJson(path.join(repo, 'data', 'topic-queue.json'));
        topic = selectTopic(queue, state, target);
        const unused = (queue.topics ?? []).filter((entry) => entry.kind === 'blog' && !state[target]?.[entry.key]?.consumed);
        if (!topic && unused.length) {
          const reserved = unused.filter((entry) => state[target]?.[entry.key]?.pendingSlot).length;
          logLine(log, reserved ? 'topic-publication-pending' : 'topic-queue-exhausted', { unused: unused.length, reserved });
          throw new Error(reserved ? 'topic publication pending; retry original slot' : 'topic queue exhausted; human followup required');
        }
        if (topic) {
          fs.mkdirSync(path.dirname(selectedPath), { recursive: true });
          fs.writeFileSync(selectedPath, `${JSON.stringify(topic)}\n`, { mode: 0o600 });
          recordTopic(statePath, target, topic);
        }
      }
    } else if (request.topic) topic = { title: request.topic, key: null };
    let changed;
    try {
      changed = generator(job, slot, topic, !!request.dryRun, log, notifications);
      if (job === 'weekly-blog' && !request.dryRun && !changed.includes('data/posts.json')) throw new Error('blog generated no post');
    } catch (error) {
      if (job === 'weekly-blog' && !request.dryRun && error.message === 'blog generated no post' && topic?.key) {
        exhaustTopicOnNoPost(path.join(stateRoot, 'topic-state.json'), target, topic);
        logLine(log, 'topic-exhausted-no-post');
      }
      throw error;
    }
    if (request.dryRun) return { dryRun: true, paths: changed.length };
    if (job === 'seo-improvements') {
      if (!changed.some((rel) => /^data\/[^/]+\.json$/.test(rel))) return { noChanges: true };
      const guard = command(node, ['scripts/content/seo-guard.mjs', 'check', baselinePath], { cwd: repo, env: sourceEnv(process.env, job), allowExit: [2] });
      if (guard.code === 2) throw new Error('SEO data lane blocked');
      const decision = parseJson(guard.stdout).decision;
      if (decision !== 'submit') return { noChanges: true };
    }
    const topicStatePath = path.join(stateRoot, 'topic-state.json');
    let result;
    try {
      result = submitAndGate(job, target, slot, log, [], topic?.key ? (id) => reserveTopicSubmission(topicStatePath, target, topic, slot, id) : null);
    } catch (error) {
      if (topic?.key && error.message === 'gate blocked or rejected') clearTopicReservation(topicStatePath, target, topic, slot);
      throw error;
    }
    if (job === 'weekly-blog' && result.id === null) throw new Error('blog generated no submission');
    if (topic?.key && result.success && result.id !== null) recordTopic(topicStatePath, target, topic, true);
    return result;
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

export async function main(argv = process.argv.slice(2)) {
  const [job, target, slot] = argv;
  slotKey(job, target, slot);
  fs.mkdirSync(logRoot, { recursive: true, mode: 0o700 });
  const log = path.join(logRoot, `${job}-${target}-${slot}.jsonl`);
  logLine(log, 'start', { job, target, slot });
  const notifications = {};
  try {
    assertTarget(process.env, target);
    if (fs.existsSync('/etc/lv-runner.hold')) throw new Error('runner hold active');
    const requestPath = path.join(stateRoot, 'requests', `${slot}.json`);
    const request = fs.existsSync(requestPath) ? readJson(requestPath) : {};
    const sha = checkout(target, log);
    const result = runJob(job, target, slot, request, log, notifications);
    logLine(log, 'success', { sha, result: result && { id: result.id ?? null, dryRun: !!result.dryRun, noChanges: !!result.noChanges } });
  } catch (error) {
    const reason = error?.cliFailure?.reason ?? (error instanceof SyntaxError ? 'invalid-json' : /^(?:runner hold active|topic queue exhausted; human followup required|topic publication pending; retry original slot|news resume snapshot changed|news post artifact missing; manual recovery required|no healthy news source|SEO code suggestion; human PR required|blog generated no post|blog generated no submission|gate blocked or rejected|publish or propagation pending|scratch output outside allowlist|scratch output too large|generator changed pinned commit)$/.test(error?.message) ? error.message : 'operational-error');
    logLine(log, 'failure', { error: reason, ...(error?.cliFailure ? { action: error.cliFailure.action, exit: error.cliFailure.exit } : {}) });
    const alerted = await alertFailure({ webhook: process.env.SLACK_WEBHOOK_URL, job, target, slot, codeSuggestion: reason === 'SEO code suggestion; human PR required' });
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
