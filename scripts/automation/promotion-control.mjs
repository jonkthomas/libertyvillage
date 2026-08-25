import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWeeklyOwner } from './weekly-owner.mjs';

export function promotionEnabled(env = process.env, options) {
  const owner = resolveWeeklyOwner(env, options);
  const explicit = String(env.LV_PROMOTION_ENABLED ?? '').trim().toLowerCase();
  return owner !== 'exedev' && explicit !== 'false';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!promotionEnabled()) throw new Error('promotion is disabled by the canonical weekly owner or emergency override');
    console.log('promotion enabled');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
