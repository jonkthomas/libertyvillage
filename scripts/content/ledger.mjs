import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const GSC_LAG = 3 * DAY;
const day = (value) => new Date(value).toISOString().slice(0, 10);
const metrics = (row = {}) => Object.fromEntries(['clicks', 'impressions', 'ctr', 'position'].map((key) => [key, row?.[key] ?? null]));

export async function recordAction(client, { actionKind, actionType, slug, url, pageType, targetQuery, queryType, actedAt = new Date(), baseline, details = {} }) {
  const result = await client.query(`insert into content.content_action_ledger
    (action_kind,slug,url,page_type,target_query,query_type,acted_at,baseline,details,action_type)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    on conflict (action_kind,slug,((acted_at at time zone 'UTC')::date))
    do update set slug=excluded.slug returning id`,
  [actionKind, slug, url, pageType, targetQuery, queryType, actedAt, metrics(baseline), details, actionType ?? (actionKind === 'new_post' ? 'new' : 'refresh')]);
  return { id: result.rows[0].id };
}

export async function listActions(client, { since = '1970-01-01' } = {}) {
  return (await client.query(`select * from content.content_action_ledger where acted_at >= $1 order by acted_at desc,id desc`, [since])).rows
    .map((row) => ({ ...row, action_type: row.action_type ?? (row.action_kind === 'new_post' ? 'new' : 'refresh') }));
}

// Use the latest mature observation ONCE per action, never count +2w and +4w as two actions.
// Shrink toward neutral for small samples; cap the multiplier so exploration continues.
export async function actionWeights(client) {
  return (await client.query(`with measured as (
    select *,coalesce(action_type,case when action_kind='new_post' then 'new' else 'refresh' end) as effective_action_type
    from content.content_action_ledger
  ) select action_kind as "actionKind",effective_action_type as "actionType",page_type as "pageType",query_type as "queryType",
    count(*)::int as samples, avg(((coalesce(outcome_4w,outcome_2w)->>'clicks')::float8)-(baseline->>'clicks')::float8) as "averageClickDelta"
    from measured
    where baseline->>'clicks' is not null and coalesce(outcome_4w,outcome_2w)->>'clicks' is not null
    group by action_kind,effective_action_type,page_type,query_type`)).rows.map((row) => ({ ...row,
    weight: Math.max(0.5, Math.min(2, 1 + Number(row.averageClickDelta) / (10 + Math.abs(Number(row.averageClickDelta))) * row.samples / (row.samples + 3))),
  }));
}

export function lastFullWeek(now = new Date()) {
  // Like growth-report's finalized-week cutoff: a Sunday must be at least
  // three days old before its complete Mon–Sun window can teach the planner.
  const end = new Date(new Date(`${day(now)}T00:00:00Z`).getTime() - GSC_LAG);
  end.setUTCDate(end.getUTCDate() - end.getUTCDay());
  return { start: day(end.getTime() - 6 * DAY), end: day(end) };
}

// Same free googleapis searchanalytics path/runner GSA as the digest's VM fallback.
export async function fetchGscRows({ start, end, dimensions = ['page', 'query'], page, query }) {
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] });
  const api = google.searchconsole({ version: 'v1', auth });
  const filters = [page && { dimension: 'page', operator: 'equals', expression: page }, query && { dimension: 'query', operator: 'equals', expression: query }].filter(Boolean);
  const rows = [];
  for (let startRow = 0; ; startRow += 25000) {
    const response = await api.searchanalytics.query({ siteUrl: 'sc-domain:libertyvillage.co', requestBody: {
      startDate: start, endDate: end, type: 'web', dataState: 'final', dimensions,
      rowLimit: 25000, startRow, ...(filters.length ? { dimensionFilterGroups: [{ filters }] } : {}),
    } });
    const batch = response.data.rows ?? [];
    rows.push(...batch);
    if (batch.length < 25000) break;
  }
  return rows;
}

export async function writeWeeklySnapshot(client, { now = new Date(), gscFetch = fetchGscRows } = {}) {
  const week = lastFullWeek(now);
  const rows = await gscFetch({ ...week, dimensions: ['page', 'query'] });
  // An empty response is unavailable data, not proof of a zero-traffic week.
  if (!rows.length) return { weekStart: week.start, rows: 0, pending: true };
  // Fetch before deleting: a failed API request leaves the prior snapshot intact.
  const write = async (c) => {
    await c.query('delete from content.gsc_weekly_snapshot where week_start=$1', [week.start]);
    for (const row of rows) await c.query(`insert into content.gsc_weekly_snapshot
      (week_start,page,query,clicks,impressions,ctr,position) values($1,$2,$3,$4,$5,$6,$7)
      on conflict(week_start,page,query) do update set clicks=excluded.clicks,impressions=excluded.impressions,ctr=excluded.ctr,position=excluded.position`,
    [week.start, row.keys[0], row.keys[1], ...Object.values(metrics(row))]);
  };
  if (client.tx) await client.tx(write); else await write(client);
  return { weekStart: week.start, rows: rows.length };
}

export async function fillOutcomes(client, { now = new Date(), gscFetch = fetchGscRows } = {}) {
  const actions = (await client.query(`select * from content.content_action_ledger
    where acted_at <= $1::timestamptz - interval '14 days' and (outcome_2w is null or outcome_4w is null)`, [now])).rows;
  const siteAvailability = new Map();
  let filled = 0;
  for (const action of actions) for (const weeks of [2, 4]) {
    const field = `outcome_${weeks}w`;
    const due = new Date(action.acted_at).getTime() + weeks * 7 * DAY;
    const start = day(due - 7 * DAY), end = day(due - DAY);
    const nowMs = new Date(now).getTime();
    if (action[field] != null || due > nowMs || new Date(end).getTime() + GSC_LAG > nowMs) continue;
    // Check final site data once per window, including when it is unavailable.
    // GSC omits zero-impression page/query rows even for an available window.
    const windowKey = `${start}/${end}`;
    if (!siteAvailability.has(windowKey)) {
      const siteRows = await gscFetch({ start, end, dimensions: ['date'] });
      siteAvailability.set(windowKey, siteRows.length > 0);
    }
    if (!siteAvailability.get(windowKey)) continue;
    // Comparable seven-day windows: week ending just before the anniversary.
    const rows = await gscFetch({ start, end, dimensions: [], page: action.url, query: action.target_query });
    const result = await client.query(`update content.content_action_ledger set ${field}=$2 where id=$1 and ${field} is null`,
      [action.id, { ...metrics(rows[0] ?? { clicks: 0, impressions: 0 }), start, end }]);
    filled += result.rowCount;
  }
  return { filled };
}

// Read-only T0 from the latest weekly snapshot; missing data stays unknown.
export async function baselineFor(client, { url, targetQuery, now = new Date() }) {
  const latest = (await client.query(`select max(week_start)::text as week from content.gsc_weekly_snapshot
    where week_start <= $1::date and week_start + 6 >= $1::date - 14`, [day(now)])).rows[0]?.week;
  if (!latest) return metrics();
  const result = await client.query(`select clicks,impressions,ctr,position from content.gsc_weekly_snapshot
    where page=$1 and query=$2 and week_start=$3::date`, [url, targetQuery, latest]);
  return metrics(result.rows[0] ?? { clicks: 0, impressions: 0, ctr: 0 });
}

async function main() {
  const { openDb } = await import('./db.mjs');
  const db = await openDb();
  try {
    if (process.argv[2] === 'list') console.log(JSON.stringify(await listActions(db, { since: process.argv[3] })));
    else if (process.argv[2] === 'weekly') console.log(JSON.stringify({ snapshot: await writeWeeklySnapshot(db), outcomes: await fillOutcomes(db) }));
    else throw new Error('expected list or weekly');
  } finally { await db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('growth ledger failed'); process.exitCode = 1; });
