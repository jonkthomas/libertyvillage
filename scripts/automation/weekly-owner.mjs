#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEEKLY_OWNER_PATH = fileURLToPath(new URL('../../ops/exedev-supervisor/owner.txt', import.meta.url));

export function parseWeeklyOwnerFile(value, source = 'weekly owner file') {
  const match = /^(gha|exedev)\n$/.exec(value);
  if (!match) throw new Error(`${source} must contain exactly gha or exedev followed by one newline`);
  return match[1];
}

export function readWeeklyOwner(ownerFile = WEEKLY_OWNER_PATH) {
  let value;
  try {
    value = fs.readFileSync(ownerFile, 'utf8');
  } catch (error) {
    throw new Error(`cannot read canonical weekly owner file ${ownerFile}: ${error.message}`);
  }
  return parseWeeklyOwnerFile(value, ownerFile);
}

export function matchWeeklyOwnerEnv(committedOwner, env = process.env) {
  if (!Object.hasOwn(env, 'LV_WEEKLY_OWNER')) return committedOwner;
  const envOwner = String(env.LV_WEEKLY_OWNER);
  if (!['gha', 'exedev'].includes(envOwner)) throw new Error(`invalid LV_WEEKLY_OWNER: ${envOwner || '(empty)'}`);
  if (envOwner !== committedOwner) {
    throw new Error(`weekly owner mismatch: VM=${envOwner} committed=${committedOwner}`);
  }
  return envOwner;
}

export function resolveWeeklyOwner(env = process.env, { ownerFile = WEEKLY_OWNER_PATH } = {}) {
  return matchWeeklyOwnerEnv(readWeeklyOwner(ownerFile), env);
}

function writeGithubOutput(owner) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required with --github-output');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `owner=${owner}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const owner = process.argv.includes('--stdin')
      ? parseWeeklyOwnerFile(fs.readFileSync(0, 'utf8'), 'standard input')
      : resolveWeeklyOwner();
    if (process.argv.includes('--github-output')) writeGithubOutput(owner);
    else console.log(owner);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
