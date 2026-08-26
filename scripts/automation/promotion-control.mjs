import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWeeklyOwner } from './weekly-owner.mjs';

export function promotionEnabled(env = process.env, options) {
  const owner = resolveWeeklyOwner(env, options);
  const explicit = String(env.LV_PROMOTION_ENABLED ?? '').trim().toLowerCase();
  return owner !== 'exedev' && explicit !== 'false';
}

export function runPromotionControl(env = process.env, options, logger = console) {
  const owner = resolveWeeklyOwner(env, options);
  const explicit = String(env.LV_PROMOTION_ENABLED ?? '').trim().toLowerCase();
  if (explicit === 'false') {
    throw new Error('promotion is disabled by the LV_PROMOTION_ENABLED=false emergency override');
  }
  if (owner === 'exedev') {
    logger.log('promotion skipped: canonical weekly owner is exedev');
    return 'skipped';
  }
  logger.log('promotion enabled');
  return 'enabled';
}

export function runPromotionControlCli({
  args = process.argv.slice(2), env = process.env, options, logger = console, fsImpl = fs,
} = {}) {
  const githubOutput = args.includes('--github-output');
  if (githubOutput && !env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required with --github-output');
  const result = runPromotionControl(env, options, logger);
  if (githubOutput) fsImpl.appendFileSync(env.GITHUB_OUTPUT, `enabled=${result === 'enabled'}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runPromotionControlCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
