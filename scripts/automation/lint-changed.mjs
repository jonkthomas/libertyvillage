#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const sourceExtension = /\.(?:[cm]?js|jsx|tsx?)$/;
const base = process.env.AUTOMATION_LINT_BASE || 'HEAD^1';
const head = process.env.AUTOMATION_LINT_HEAD || 'HEAD^2';
const changed = execFileSync(
  'git',
  ['diff', '--name-only', '--diff-filter=ACMR', '-z', base, head],
  { encoding: 'utf8' },
);
const files = changed.split('\0').filter((file) => sourceExtension.test(file));

if (files.length === 0) {
  console.log('No changed JavaScript or TypeScript files to lint.');
  process.exit(0);
}

console.log(`Linting ${files.length} changed JavaScript/TypeScript file(s).`);
execFileSync(path.join('node_modules', '.bin', 'eslint'), ['--', ...files], { stdio: 'inherit' });
