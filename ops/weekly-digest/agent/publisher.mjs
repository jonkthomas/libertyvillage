#!/usr/bin/env node
// Deterministic publisher, separate Unix user. No model, shell, repository
// scripts, hooks, or model-supplied commands execute in this process.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redact } from '../lib/agent-input.mjs';

const REPO = 'jonkthomas/libertyvillage';
const GH = '/usr/local/bin/gh';
const MAX_BYTES = 1024 * 1024;
const MAX_PATCH_BYTES = 30 * 1024;
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
  if (outbox.actions.length > 3) throw new Error('issue cap exceeded');
  for (const action of outbox.actions) {
    if (action?.type !== 'issue') throw new Error('only issue creation is allowed');
    onlyKeys(action, ['type', 'title', 'body', 'patch']);
    text(action.title, 200);
    text(action.body, 20_000);
    if (Object.hasOwn(action, 'patch')) {
      text(action.patch, MAX_BYTES);
      // Inspect the entire patch BEFORE truncation. Refuse secret-shaped or
      // binary content rather than rewriting a proposed code change.
      if (redact(action.patch) !== action.patch || /GIT binary patch|Binary files [^\n]* differ/.test(action.patch)) throw new Error('unsafe patch');
    }
  }
  // Snapshot once: do not re-read agent-owned data while holding the token.
  return structuredClone(outbox.actions);
}
function patchBody(patch) {
  const bytes = Buffer.from(patch);
  let end = Math.min(bytes.length, MAX_PATCH_BYTES);
  // Keep the last UTF-8 character whole.
  while (end < bytes.length && end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  const clipped = bytes.subarray(0, end).toString('utf8');
  // A model-proposed Markdown fence must remain literal text inside the diff.
  const fence = '`'.repeat(Math.max(3, ...Array.from(clipped.matchAll(/`+/g), (m) => m[0].length + 1)));
  return `\n\nSuggested patch (a human must review and apply):\n\n${fence}diff\n${clipped}${clipped.endsWith('\n') ? '' : '\n'}${fence}\n` +
    (bytes.length > end ? '\nPatch truncated at 30 KiB; incomplete diff. Ask the author for the full patch before applying.\n' : '');
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
  const safeActions = actions.map((a) => ({ type: a.type, title: redact(a.title, [token]),
    body: redact(a.body, [token]) + (a.patch ? patchBody(a.patch) : '') }));
  if (dryRun) return safeActions;
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const work = fs.mkdtempSync(path.join(stateDir, 'publish-'));
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: stateDir,
    GH_TOKEN: token, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_CONFIG_DIR: path.join(work, 'gh') };
  const run = (args) => {
    const result = execute(GH, args, { cwd: work, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    // Never echo tool stderr: it can include a token or rejected proposal text.
    if (result.status !== 0) throw new Error('publisher operation failed; no further actions attempted');
    return result.stdout?.trim();
  };
  const urls = [];
  try {
    for (const [i, action] of safeActions.entries()) {
      // Bodies go through a private file (no shell interpolation / flag parsing).
      const body = path.join(work, `body-${i}.md`);
      fs.writeFileSync(body, action.body, { mode: 0o600 });
      urls.push(run(['issue', 'create', '--repo', REPO, '--label', 'lv-digest-agent', '--title', action.title, '--body-file', body]));
    }
    return urls;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
function main() {
  const args = process.argv.slice(2);
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!['--publish', '--outbox', '--state-dir'].includes(name) || options.has(name)) throw new Error('unsupported publisher option');
    if (name === '--publish') options.set(name, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('missing publisher option value');
      options.set(name, value);
    }
  }
  const file = options.get('--outbox') ?? '/var/lib/lv-digest/outbox/proposals.json';
  if (!fs.existsSync(file)) { console.log('no outbox; nothing to publish'); return; }
  const outbox = readOutbox(file);
  validateOutbox(outbox);
  const credential = process.env.CREDENTIALS_DIRECTORY && path.join(process.env.CREDENTIALS_DIRECTORY, 'github-token');
  const dryRun = !options.has('--publish');
  const token = !dryRun && credential ? fs.readFileSync(credential, 'utf8').trim() : undefined;
  const result = publish(outbox, { token, dryRun, stateDir: options.get('--state-dir') ?? '/var/lib/lv-digest-publisher' });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch { console.error('publisher refused or failed; no further actions attempted'); process.exitCode = 1; }
}
