// SEO lane scripts that survive the r7 workflow retirement: the SEO_MODE prompt
// clause in scripts/seo-improve-agent.js and the data-lane guard in
// scripts/content/seo-guard.mjs. The GitHub Actions writer workflows that used to
// wrap them are deleted; the exe.dev runner drives these scripts directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDataLane, parsePorcelain } from '../../scripts/content/seo-guard.mjs';

const require = createRequire(import.meta.url);
const { seoModeClause } = require('../../scripts/seo-improve-agent.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function repo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-seo-guard-'));
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'guard@example.test']);
  git(cwd, ['config', 'user.name', 'Guard Test']);
  fs.mkdirSync(path.join(cwd, 'data'));
  fs.writeFileSync(path.join(cwd, 'data', 'posts.json'), '{"posts":[]}\n');
  fs.writeFileSync(path.join(cwd, 'README.md'), 'base\n');
  git(cwd, ['add', 'data/posts.json', 'README.md']);
  git(cwd, ['commit', '-m', 'base']);
  return cwd;
}

function runGuard(cwd, args) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(ROOT, 'scripts/content/seo-guard.mjs'), ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status ?? 1, stdout: `${error.stdout || ''}`, stderr: `${error.stderr || ''}` };
  }
}

test('SEO_MODE only adds a prompt restriction', () => {
  const previous = process.env.SEO_MODE;
  delete process.env.SEO_MODE;
  assert.equal(seoModeClause(), '');
  process.env.SEO_MODE = 'data';
  assert.match(seoModeClause(), /data\/\*\.json/);
  assert.match(seoModeClause(), /tasks\/seo-improve-summary\.md/);
  process.env.SEO_MODE = 'code';
  assert.match(seoModeClause(), /do not create or edit anything under data\//);
  process.env.SEO_MODE = 'other';
  assert.equal(seoModeClause(), '');
  if (previous === undefined) delete process.env.SEO_MODE;
  else process.env.SEO_MODE = previous;
  const source = fs.readFileSync(path.join(ROOT, 'scripts/seo-improve-agent.js'), 'utf8');
  assert.equal((source.match(/seoModeClause\(\)/g) || []).length, 3);
});

test('porcelain parsing drops rename sources and quotes', () => {
  const entries = parsePorcelain([
    ' M data/posts.json',
    '?? screenshot.png',
    'R  data/old.json -> data/new.json',
    '?? "tasks/seo-improve-runs/note.json"',
    '',
  ].join('\n'));
  assert.deepEqual(entries.map((entry) => entry.path), [
    'data/posts.json',
    'screenshot.png',
    'data/new.json',
    'tasks/seo-improve-runs/note.json',
  ]);
  assert.equal(entries[1].untracked, true);
  assert.deepEqual(classifyDataLane(['data/posts.json']), {
    code: 0,
    body: { mode: 'data', changed: ['data/posts.json'], decision: 'submit' },
  });
  assert.equal(classifyDataLane([]).body.changed.length, 0);
  assert.equal(classifyDataLane(['data/posts.json', 'app/page.tsx']).code, 2);
});

test('seo-guard submits data plus runner notes, no-ops, and blocks mixed or code-lane data edits', () => {
  const cwd = repo();
  const clean = runGuard(cwd, ['capture']);
  assert.equal(clean.code, 0);
  const baseline = path.join(cwd, 'baseline.json');
  fs.writeFileSync(baseline, clean.stdout);
  const noop = runGuard(cwd, ['check', baseline]);
  assert.equal(noop.code, 0);
  assert.equal(noop.stdout.trim(), '{"mode":"data","changed":[]}');
  assert.equal(runGuard(cwd, ['code-only']).code, 0);

  fs.mkdirSync(path.join(cwd, 'tasks/seo-improve-runs'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'data/posts.json'), '{"posts":[{"slug":"new"}]}\n');
  fs.writeFileSync(path.join(cwd, 'tasks/seo-improve-summary.md'), '# summary\n');
  fs.writeFileSync(path.join(cwd, 'tasks/seo-improve-runs/2026-09-27.json'), '{}\n');
  fs.writeFileSync(path.join(cwd, 'tasks/seo-scores.json'), '{}\n');
  fs.writeFileSync(path.join(cwd, 'screenshot.png'), 'png');
  const submit = runGuard(cwd, ['check', baseline]);
  assert.equal(submit.code, 0);
  const submitBody = JSON.parse(submit.stdout);
  assert.equal(submitBody.decision, 'submit');
  assert.deepEqual(submitBody.changed, ['data/posts.json']);

  fs.mkdirSync(path.join(cwd, 'app'));
  fs.writeFileSync(path.join(cwd, 'app/page.tsx'), 'export default function Page(){return null}\n');
  const mixed = runGuard(cwd, ['check', baseline]);
  assert.equal(mixed.code, 2);
  assert.match(mixed.stdout, /mixed-blocked/);
  assert.match(mixed.stderr, /mixed-blocked/);
  assert.equal(runGuard(cwd, ['code-only']).code, 1);
  assert.match(runGuard(cwd, ['code-only']).stdout, /data\/posts\.json/);
});
