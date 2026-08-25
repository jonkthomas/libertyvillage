export function promotionEnabled(env = process.env) {
  const owner = String(env.LV_WEEKLY_OWNER ?? '').trim().toLowerCase();
  const explicit = String(env.LV_PROMOTION_ENABLED ?? '').trim().toLowerCase();
  return owner !== 'exedev' && explicit !== 'false';
}
