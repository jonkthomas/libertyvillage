#!/usr/bin/env node
// Deterministic publisher, separate Unix user. No model, shell, repository
// scripts, hooks, or model-supplied commands execute in this process.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redact } from '../lib/agent-input.mjs';

const REPO = 'jonkthomas/libertyvillage';
const REPO_URL = `https://github.com/${REPO}.git`;
const GH = '/usr/local/bin/gh';
const MAX_BYTES = 1024 * 1024;
function onlyKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !keys.includes(k))) {
    throw new Error('unsupported proposal fields');
  }
}
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error('invalid proposal text');
  return value;
}
export function validateOutbox(outbox) {
  onlyKeys(outbox, ['version', 'actions']);
  if (outbox.version !== 1 || !Array.isArray(outbox.actions)) throw new Error('invalid outbox');
  let issues = 0, prs = 0;
  const heads = new Set();
  for (const action of outbox.actions) {
    if (action?.type === 'issue') {
      onlyKeys(action, ['type', 'title', 'body']);
      if (++issues > 3) throw new Error('issue cap exceeded');
    } else if (action?.type === 'pr') {
      onlyKeys(action, ['type', 'title', 'body', 'base', 'head', 'draft', 'patch']);
      if (++prs > 3 || action.base !== 'staging' || action.draft !== true ||
          !/^lv-agent\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(action.head) || action.head.length > 100 || heads.has(action.head)) {
        throw new Error('only unique lv-agent/* draft PRs targeting staging are allowed');
      }
      heads.add(action.head);
      text(action.patch, 250_000);
      // Patches cannot be safely rewritten without changing code. Refuse them
      // if secret-shaped text is present; a human can prepare that fix instead.
      if (redact(action.patch) !== action.patch || action.patch.includes('GIT binary patch')) throw new Error('unsafe patch');
    } else { throw new Error('only issue and draft PR creation are allowed'); }
    text(action.title, 200);
    text(action.body, 20_000);
  }
  // Snapshot once: do not re-read agent-owned data while holding the token.
  return structuredClone(outbox.actions);
}
export function readOutbox(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES || Date.now() - stat.mtimeMs > 3600_000) throw new Error('invalid or stale outbox file');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
export function publish(outbox, { token, stateDir, execute = spawnSync, dryRun = false } = {}) {
  const actions = validateOutbox(outbox); // Validate ALL actions before ANY write.
  if (!dryRun && !token) throw new Error('publisher credential missing');
  if (token && actions.some((a) => a.patch?.includes(token))) throw new Error('credential in patch');
  const safeActions = actions.map((a) => ({ ...a, title: redact(a.title, [token]), body: redact(a.body, [token]) }));
  if (dryRun) return safeActions.map(({ patch, ...a }) => ({ ...a, ...(patch ? { patch: '[validated text patch]' } : {}) }));
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const work = fs.mkdtempSync(path.join(stateDir, 'publish-'));
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: stateDir,
    GH_TOKEN: token, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_CONFIG_DIR: path.join(work, 'gh'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1' };
  const run = (bin, args, cwd = work, input) => {
    const result = execute(bin, args, { cwd, env, input, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    // Never echo tool stderr: it can include a token or rejected proposal text.
    if (result.status !== 0) throw new Error('publisher operation failed; no further actions attempted');
    return result.stdout?.trim();
  };
  const git = (args, cwd, input) => run('/usr/bin/git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
    '-c', 'credential.helper=', '-c', `credential.helper=!${GH} auth git-credential`,
    '-c', 'user.name=LV digest publisher', '-c', 'user.email=lv-digest@users.noreply.github.com',
    ...args,
  ], cwd, input);
  const urls = [];
  try {
    for (const [i, action] of safeActions.entries()) {
      // Bodies go through a private file (no shell interpolation / flag parsing).
      const body = path.join(work, `body-${i}.md`);
      fs.writeFileSync(body, action.body, { mode: 0o600 });
      if (action.type === 'issue') {
        urls.push(run(GH, ['issue', 'create', '--repo', REPO, '--label', 'lv-digest-agent', '--title', action.title, '--body-file', body]));
      } else {
        const repoDir = path.join(work, `repo-${i}`);
        git(['clone', '--depth', '1', '--single-branch', '--branch', 'staging', '--', REPO_URL, repoDir]);
        git(['checkout', '-b', action.head], repoDir);
        git(['apply', '--check', '-'], repoDir, action.patch);
        git(['apply', '--index', '-'], repoDir, action.patch);
        git(['commit', '--no-gpg-sign', '-m', 'Apply weekly digest proposal for human review'], repoDir);
        // Exact, non-forced refspec. Never interpret outbox text as a refspec.
        git(['push', 'origin', `HEAD:refs/heads/${action.head}`], repoDir);
        urls.push(run(GH, ['pr', 'create', '--repo', REPO, '--base', 'staging', '--head', action.head,
          '--draft', '--title', action.title, '--body-file', body], repoDir));
      }
    }
    return urls;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const file = opt('--outbox', '/var/lib/lv-digest/outbox/proposals.json');
  if (!fs.existsSync(file)) { console.log('no outbox; nothing to publish'); return; }
  const outbox = readOutbox(file);
  validateOutbox(outbox);
  const credential = process.env.CREDENTIALS_DIRECTORY && path.join(process.env.CREDENTIALS_DIRECTORY, 'github-token');
  const dryRun = !args.includes('--publish');
  const token = !dryRun && credential ? fs.readFileSync(credential, 'utf8').trim() : undefined;
  const result = publish(outbox, { token, dryRun, stateDir: opt('--state-dir', '/var/lib/lv-digest-publisher') });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch { console.error('publisher refused or failed; no further actions attempted'); process.exitCode = 1; }
}
