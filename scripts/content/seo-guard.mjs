#!/usr/bin/env node
// SEO lane guard for the Neon content store.
// capture writes {path: sha256} for every git status --porcelain -uall path.
// check compares a later tree to that baseline. code-only fails when data/ changed.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER_ARTIFACT = /^tasks\/seo-(?:improve-(?:summary\.md|runs\/)|scores\.json)/;
const DATA_JSON = /^data\/[^/]+\.json$/;
const DATA_PREFIX = /^data\//;

function unquote(filePath) {
  if (filePath.startsWith('"') && filePath.endsWith('"')) {
    try {
      return JSON.parse(filePath);
    } catch {
      return filePath;
    }
  }
  return filePath;
}

export function parsePorcelain(text) {
  const entries = [];
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    let filePath = line.slice(3);
    const arrow = filePath.lastIndexOf(' -> ');
    if (arrow !== -1) filePath = filePath.slice(arrow + 4);
    filePath = unquote(filePath);
    if (!filePath) continue;
    entries.push({ path: filePath, untracked: status === '??' });
  }
  return entries;
}

function gitPorcelain(cwd) {
  return execFileSync('git', ['status', '--porcelain', '-uall'], {
    cwd,
    encoding: 'utf8',
  });
}

function fileSha256(cwd, filePath) {
  const absolute = path.join(cwd, filePath);
  if (!fs.existsSync(absolute)) return null;
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) return null;
  return createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}

export function isIgnoredSeoPath(entry) {
  if (RUNNER_ARTIFACT.test(entry.path)) return true;
  if (entry.untracked && !entry.path.includes('/')) return true;
  return false;
}

export function changedPaths(baseline, current, hashes) {
  const changed = [];
  for (const entry of current) {
    if (isIgnoredSeoPath(entry)) continue;
    const hash = hashes.get(entry.path) ?? null;
    if (!Object.prototype.hasOwnProperty.call(baseline, entry.path) || baseline[entry.path] !== hash) {
      changed.push(entry.path);
    }
  }
  changed.sort((a, b) => a.localeCompare(b));
  return changed;
}

export function classifyDataLane(changed) {
  if (changed.length === 0) {
    return { code: 0, body: { mode: 'data', changed: [] } };
  }
  if (changed.every((filePath) => DATA_JSON.test(filePath))) {
    return { code: 0, body: { mode: 'data', changed, decision: 'submit' } };
  }
  return { code: 2, body: { mode: 'data', changed, decision: 'mixed-blocked' } };
}

export function classifyCodeLane(entries) {
  const changed = entries
    .filter((entry) => DATA_PREFIX.test(entry.path))
    .map((entry) => entry.path)
    .sort((a, b) => a.localeCompare(b));
  if (changed.length === 0) return { code: 0, body: { mode: 'code', changed: [] } };
  return { code: 1, body: { mode: 'code', changed, decision: 'data-blocked' } };
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result.body)}\n`);
  if (result.body.decision === 'mixed-blocked') process.stderr.write('mixed-blocked\n');
  process.exit(result.code);
}

function capture(cwd) {
  const entries = parsePorcelain(gitPorcelain(cwd));
  const body = {};
  for (const entry of entries) body[entry.path] = fileSha256(cwd, entry.path);
  const ordered = Object.fromEntries(Object.keys(body).sort((a, b) => a.localeCompare(b)).map((key) => [key, body[key]]));
  process.stdout.write(`${JSON.stringify(ordered)}\n`);
}

function check(cwd, baselinePath) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const entries = parsePorcelain(gitPorcelain(cwd));
  const hashes = new Map(entries.map((entry) => [entry.path, fileSha256(cwd, entry.path)]));
  writeResult(classifyDataLane(changedPaths(baseline, entries, hashes)));
}

function codeOnly(cwd) {
  writeResult(classifyCodeLane(parsePorcelain(gitPorcelain(cwd))));
}

function main() {
  const [command, arg] = process.argv.slice(2);
  const cwd = process.cwd();
  if (command === 'capture') capture(cwd);
  else if (command === 'check') {
    if (!arg) {
      process.stderr.write('usage: seo-guard.mjs check <baseline.json>\n');
      process.exit(1);
    }
    check(cwd, arg);
  } else if (command === 'code-only') codeOnly(cwd);
  else {
    process.stderr.write('usage: seo-guard.mjs capture|check <baseline.json>|code-only\n');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
