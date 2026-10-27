// Four-week refresh decisions. GSC reads only; content writes use refresh rollback.
import { rollbackRefresh } from './refresh.mjs';
import { refreshWindow } from './refresh-gsc.mjs';
import { GSC_SITE } from '../lib/growth-report.mjs';

const DAY = 86_400_000;
const date = (value) => new Date(value).toISOString().slice(0, 10);
const addDays = (value, days) => date(new Date(value).getTime() + days * DAY);
const validMetric = (r) => r && ['clicks', 'impressions', 'position'].every((k) =>
  typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] >= 0)
  && r.clicks <= r.impressions && r.position > 0;
const ctr = (r) => r.clicks / r.impressions;

export function evaluationWindows(snapshot) {
  // closed_at is confirmed publication, never the reservation time. Exclude
  // the publication day and the following six days; measure days +7 through +27.
  const baseline = snapshot.baseline ?? {};
  return {
    before: baseline.startDate && baseline.endDate
      ? { startDate: baseline.startDate, endDate: baseline.endDate } : refreshWindow(new Date(snapshot.created_at)),
    after: { startDate: addDays(snapshot.closed_at, 7), endDate: addDays(snapshot.closed_at, 27) },
  };
}

export function decideRefresh({ baseline, page, siteBefore, siteAfter }) {
  if (![baseline, page, siteBefore, siteAfter].every(validMetric)
    || !baseline.impressions || !siteBefore.impressions || !siteAfter.impressions
    || !siteBefore.clicks || !siteAfter.clicks) return null; // unavailable: retry, never act
  const positionDelta = page.position - baseline.position;
  const ctrDelta = baseline.clicks ? ctr(page) / ctr(baseline) - 1 : null;
  const siteCtrDelta = ctr(siteAfter) / ctr(siteBefore) - 1;
  const adjustedCtrDelta = ctrDelta == null ? null : (1 + ctrDelta) / (1 + siteCtrDelta) - 1;
  const measured = { baseline, page, siteBefore, siteAfter, positionDelta, ctrDelta, siteCtrDelta, adjustedCtrDelta };
  let verdict = 'inconclusive', reasonCode = 'refresh-eval-steady';
  if (page.impressions < 200) reasonCode = 'refresh-eval-low-impressions';
  else if (Math.abs(positionDelta) > 2) reasonCode = 'refresh-eval-position-moved';
  else if (adjustedCtrDelta == null) reasonCode = 'refresh-eval-zero-baseline';
  else if (adjustedCtrDelta < -0.1 - 1e-12) { verdict = 'lost'; reasonCode = 'refresh-eval-lost'; }
  else if (adjustedCtrDelta > 1e-12) { verdict = 'won'; reasonCode = 'refresh-eval-won'; }
  return { verdict, reasonCode, ...measured };
}

export async function gscEvaluationClient(env = process.env) {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('GSC credentials unavailable');
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({ keyFile: env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] });
  return google.searchconsole({ version: 'v1', auth });
}

export async function fetchEvaluationRows(client, snapshot) {
  const windows = evaluationWindows(snapshot);
  const query = async (window, page) => {
    const response = await client.searchanalytics.query({ siteUrl: GSC_SITE, requestBody: {
      ...window, dataState: 'final', rowLimit: 1,
      ...(page ? { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: page }] }] } : {}),
    } });
    const data = response?.data;
    if (data?.metadata?.first_incomplete_date || data?.rows?.length !== 1) return null;
    const row = data.rows[0];
    return validMetric(row) ? { clicks: row.clicks, impressions: row.impressions, position: row.position } : null;
  };
  const [page, siteBefore, siteAfter] = await Promise.all([
    query(windows.after, snapshot.url), query(windows.before), query(windows.after),
  ]);
  return { page, siteBefore, siteAfter, windows };
}

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
async function stillCurrent(db, snapshot) {
  return Boolean(await one(db, `select 1 from content.refresh_snapshots s
    join content.submission_items i on i.submission_id=s.submission_id and i.dataset=s.dataset and i.key=s.key
    join content.entries e on e.dataset=s.dataset and e.key=s.key
    where s.id=$1 and s.state='published' and e.live_rev=i.published_rev`, [snapshot.id]));
}

const clean = (value, max = 220) => String(value ?? '').replace(/[\r\n\t]/g, ' ').slice(0, max);
const percent = (value) => value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
export function learningLine(snapshot, decision) {
  return `${clean(snapshot.url, 300)} | ${clean(snapshot.summary?.before?.title ?? snapshot.payload?.title)} → ${clean(snapshot.summary?.after?.title)} | CTR ${percent(decision.ctrDelta)}, adjusted ${percent(decision.adjustedCtrDelta)}, position ${decision.positionDelta.toFixed(1)} | ${decision.verdict}`;
}

export async function refreshLearnings(db, target) {
  const rows = (await db.query(`select s.*, e.measurement from content.refresh_evaluations e
    join content.refresh_snapshots s on s.id=e.snapshot_id where s.target=$1
    order by e.evaluated_at desc, e.snapshot_id desc limit 20`, [target])).rows;
  return rows.reverse().map((row) => learningLine(row, row.measurement)).join('\n');
}

export async function evaluateRefreshes(db, { target = db.target, now = new Date(), env = process.env, deps = {} } = {}) {
  const snapshots = (await db.query(`select s.* from content.refresh_snapshots s
    left join content.refresh_evaluations e on e.snapshot_id=s.id
    where s.target=$1 and s.state='published' and s.closed_at <= $2::timestamptz - interval '28 days'
    and e.snapshot_id is null order by s.id`, [target, now])).rows;
  const outcomes = [];
  let deferred = 0, skipped = 0, client;
  for (const snapshot of snapshots) {
    if (!await stillCurrent(db, snapshot)) { skipped++; continue; }
    // Wait for the entire fixed window to be final, including GSC's three-day lag.
    if (evaluationWindows(snapshot).after.endDate > addDays(now, -3)) { deferred++; continue; }
    let observations;
    try {
      if (deps.measure) observations = await deps.measure(snapshot);
      else {
        client ??= await gscEvaluationClient(env);
        observations = await fetchEvaluationRows(client, snapshot);
      }
    } catch { deferred++; continue; }
    const decision = decideRefresh({ baseline: snapshot.baseline, ...observations });
    if (!decision) { deferred++; continue; }
    // Claim once before any side effect. The weekly runner already holds its
    // flock; the unique key also prevents duplicate standalone evaluations.
    if (!await stillCurrent(db, snapshot)) { skipped++; continue; }
    const claimed = await one(db, `insert into content.refresh_evaluations
      (snapshot_id,evaluated_at,verdict,reason_code,measurement,rollback_state)
      values($1,$2,$3,$4,$5::json,$6) on conflict do nothing returning snapshot_id`,
    [snapshot.id, now, decision.verdict, decision.reasonCode, JSON.stringify({ ...decision, windows: observations.windows ?? evaluationWindows(snapshot) }), decision.verdict === 'lost' ? 'claimed' : null]);
    if (!claimed) continue;
    let rollbackState = null;
    if (decision.verdict === 'lost') {
      try {
        if (!await stillCurrent(db, snapshot)) rollbackState = 'superseded';
        else {
          const rollback = await (deps.rollback ?? rollbackRefresh)(db, { snapshotId: Number(snapshot.id),
            actor: 'auto-revert', reason: 'refresh CTR fell over 10% after site-wide adjustment', env, deps: deps.rollbackDeps ?? {} });
          rollbackState = rollback.exitCode === 0 ? 'reverted' : 'pending';
        }
      } catch { rollbackState = 'failed'; }
      await db.query('update content.refresh_evaluations set rollback_state=$2 where snapshot_id=$1', [snapshot.id, rollbackState]);
    }
    outcomes.push({ snapshotId: Number(snapshot.id), slug: snapshot.key, url: snapshot.url,
      verdict: decision.verdict, reasonCode: decision.reasonCode, rollbackState,
      ctrDelta: decision.ctrDelta, adjustedCtrDelta: decision.adjustedCtrDelta, positionDelta: decision.positionDelta });
  }
  return { evaluated: outcomes.length, reverted: outcomes.filter((r) => r.rollbackState === 'reverted').length,
    won: outcomes.filter((r) => r.verdict === 'won').length, deferred, skipped, outcomes,
    learnings: await refreshLearnings(db, target) };
}
