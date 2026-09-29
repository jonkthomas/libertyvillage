import { createHash, randomUUID } from 'node:crypto';
import { ClaimError, StateError, ValidationError } from './store.mjs';
import { createHttp, MANIFEST_PATH } from './smoke.mjs';
import { ALL } from './canonical.mjs';

const row = (result) => result.rows[0];
const number = (value) => Number(value);
const failed = new Set(['failed-before-submit', 'rejected', 'blocked', 'error']);
const outcomes = new Set([...failed, 'published', 'smoked', 'consumed']);
const slotColumns = 'target=$1 and week_start_utc=$2 and lane=$3 and slot_number=$4';
const dateText = '*, week_start_utc::text as week_start_utc';
const slotValues = ({ target, weekStart, lane, slotNumber }) => [target, weekStart, lane, slotNumber];
const publicSlot = (value) => { const slot = { ...value }; delete slot.claim_token; return slot; };

function dateValue(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ValidationError('invalid date');
  return date;
}
export function weekStartUtc(date) {
  const value = dateValue(date);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
}
export function isoWeek(date) {
  const value = dateValue(date);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + 3 - (value.getUTCDay() + 6) % 7);
  const year = value.getUTCFullYear();
  return { year, week: Math.round((value.getTime() - Date.UTC(year, 0, 4)) / 604800000) + 1 };
}
export function roundupSlug(weekStart) {
  const { year, week } = isoWeek(weekStart);
  return `liberty-village-news-week-${year}-w${String(week).padStart(2, '0')}`;
}
export async function createAliasObserver({ siteUrl, bypass, fetchImpl } = {}) {
  const http = createHttp({ siteUrl, bypass, fetchImpl });
  const response = await http.get(MANIFEST_PATH);
  if (response.status !== 200) throw new StateError('alias manifest unavailable');
  let manifest;
  try { manifest = JSON.parse(response.body.toString('utf8')); }
  catch { throw new StateError('invalid alias manifest'); }
  const entries = manifest?.datasets?.posts?.entries;
  if (manifest?.schema !== 1 || !/^[0-9a-f]{40}$/.test(manifest.snapshot_id ?? '')
    || typeof manifest.deployment_url !== 'string' || !manifest.deployment_url
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)
    || Object.keys(manifest.files).length !== ALL.length
    || ALL.some((dataset) => !/^[0-9a-f]{64}$/.test(manifest.files[`${dataset}.json`] ?? ''))
    || !Array.isArray(manifest.media) || !entries || typeof entries !== 'object' || Array.isArray(entries)
    || Object.values(entries).some((entry) => !Number.isInteger(entry?.rev) || entry.rev < 1
      || !/^[0-9a-f]{64}$/.test(entry.sha ?? ''))) throw new StateError('invalid alias manifest');
  return async (slug) => {
    const entry = entries[slug];
    return entry ? { rev: entry.rev, snapshotId: manifest.snapshot_id } : null;
  };
}
function checkTarget(db, target) {
  if (target !== db.target) throw new ValidationError('target mismatch');
}
function checkedSlot(db, ref) {
  if (!ref || !['content', 'roundup'].includes(ref.lane) || !Number.isInteger(Number(ref.slotNumber)) || Number(ref.slotNumber) < 1 || weekStartUtc(ref.weekStart) !== ref.weekStart) throw new ValidationError('invalid slot reference');
  checkTarget(db, ref.target);
  return slotValues(ref);
}
function checkLease(seconds) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) throw new ValidationError('invalid lease');
}
async function lockedSlot(client, db, ref, token) {
  const slot = row(await client.query(`select ${dateText} from content.cadence_slots where ${slotColumns} for update`, checkedSlot(db, ref)));
  if (!slot || !token || slot.claim_token !== token || !slot.claimed_until || new Date(slot.claimed_until) <= new Date()) throw new ClaimError();
  return slot;
}
export async function reserveSlot(db, { target, weekStart, lane, slotNumber, owner, leaseSeconds = 900 }) {
  const ref = { target, weekStart, lane, slotNumber };
  checkedSlot(db, ref);
  checkLease(leaseSeconds);
  if (typeof owner !== 'string' || !owner.trim()) throw new ValidationError('owner required');
  return db.tx(async (client) => {
    await client.query(`insert into content.cadence_slots(target,week_start_utc,lane,slot_number,roundup_slug)
      values($1,$2,$3,$4,$5) on conflict do nothing`, [...slotValues(ref), lane === 'roundup' ? roundupSlug(weekStart) : null]);
    const found = row(await client.query(`select ${dateText} from content.cadence_slots where target=$1 and week_start_utc=$2 and
      ${lane === 'roundup' ? "lane='roundup'" : 'lane=$3 and slot_number=$4'} for update`, lane === 'roundup' ? [target, weekStart] : slotValues(ref)));
    if (!found) throw new StateError('slot missing');
    if (found.claim_token && new Date(found.claimed_until) > new Date()) {
      return { slot: publicSlot(found), token: null, reserved: false, holder: found.claim_owner === owner ? 'self' : 'other' };
    }
    const token = randomUUID();
    const slot = row(await client.query(`update content.cadence_slots set claim_token=$5,claim_owner=$6,
      claimed_until=now()+($7 * interval '1 second') where ${slotColumns} returning ${dateText}`,
    [...slotValues({ target, weekStart, lane, slotNumber: found.slot_number }), token, owner, leaseSeconds]));
    return { slot: publicSlot(slot), token, reserved: true, holder: 'self' };
  });
}
export async function renewSlot(db, slotRef, token, { leaseSeconds = 900 } = {}) {
  checkLease(leaseSeconds);
  return db.tx(async (client) => {
    await lockedSlot(client, db, slotRef, token);
    return publicSlot(row(await client.query(`update content.cadence_slots set claimed_until=now()+($5 * interval '1 second')
      where ${slotColumns} returning ${dateText}`, [...slotValues(slotRef), leaseSeconds])));
  });
}
export async function releaseSlot(db, slotRef, token) {
  return db.tx(async (client) => {
    await lockedSlot(client, db, slotRef, token);
    return publicSlot(row(await client.query(`update content.cadence_slots set claim_token=null,claim_owner=null,claimed_until=null
      where ${slotColumns} returning ${dateText}`, slotValues(slotRef))));
  });
}
function keyFor(ref, ordinal) {
  return `cadence:${createHash('sha256').update(`${slotValues(ref).join('|')}|${ordinal}`).digest('hex')}`;
}
export async function recordAttempt(db, { slotRef, token, intentFingerprint, topicKey, sourcePackDigest }) {
  if (![intentFingerprint, topicKey, sourcePackDigest].every((v) => typeof v === 'string' && v.trim())) throw new ValidationError('attempt metadata required');
  return db.tx(async (client) => {
    const slot = await lockedSlot(client, db, slotRef, token);
    const prior = (await client.query(`select ${dateText} from content.cadence_attempts where ${slotColumns} order by ordinal desc`, slotValues(slotRef))).rows;
    const latest = prior[0];
    if (latest && (latest.outcome === null || latest.outcome === 'published' || latest.outcome === 'smoked')) {
      return { ordinal: latest.ordinal, idempotencyKey: latest.idempotency_key, existing: true };
    }
    if (latest?.outcome === 'consumed' || slot.state === 'consumed') throw new StateError('slot consumed');
    if (prior.some((attempt) => attempt.intent_fingerprint === intentFingerprint)) throw new ValidationError('intent already attempted');
    const ordinal = slot.attempt_ordinal + 1;
    const idempotencyKey = keyFor(slotRef, ordinal);
    await client.query(`insert into content.cadence_attempts(target,week_start_utc,lane,slot_number,ordinal,
      intent_fingerprint,topic_key,idempotency_key,source_pack_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [...slotValues(slotRef), ordinal, intentFingerprint, topicKey, idempotencyKey, sourcePackDigest]);
    await client.query(`update content.cadence_slots set attempt_ordinal=$5,state='attempting' where ${slotColumns}`,
      [...slotValues(slotRef), ordinal]);
    return { ordinal, idempotencyKey, existing: false };
  });
}
async function lockedAttempt(client, db, idempotencyKey, token) {
  const attempt = row(await client.query(`select ${dateText} from content.cadence_attempts where idempotency_key=$1`, [idempotencyKey]));
  if (!attempt) throw new StateError('attempt missing');
  const ref = { target: attempt.target, weekStart: attempt.week_start_utc, lane: attempt.lane, slotNumber: attempt.slot_number };
  await lockedSlot(client, db, ref, token);
  return { attempt, ref };
}
export async function attachSubmission(db, { idempotencyKey, token, submissionId }) {
  return db.tx(async (client) => {
    const { attempt, ref } = await lockedAttempt(client, db, idempotencyKey, token);
    if (attempt.submission_id && number(attempt.submission_id) !== number(submissionId)) throw new StateError('submission mismatch');
    if (attempt.outcome && failed.has(attempt.outcome)) throw new StateError('attempt closed');
    const submission = row(await client.query('select id,target,idempotency_key from content.submissions where id=$1', [submissionId]));
    if (!submission || submission.target !== ref.target || submission.idempotency_key !== idempotencyKey) throw new ValidationError('submission identity mismatch');
    await client.query('update content.cadence_attempts set submission_id=$2,updated_at=now() where idempotency_key=$1', [idempotencyKey, submissionId]);
    await client.query(`update content.cadence_slots set submission_id=$5,state='submitted' where ${slotColumns}`, [...slotValues(ref), submissionId]);
    return { ...attempt, submission_id: submissionId };
  });
}
export async function recordAttemptOutcome(db, { idempotencyKey, token, outcome, observe }) {
  if (!outcomes.has(outcome)) throw new ValidationError('invalid outcome');
  return db.tx(async (client) => {
    const { attempt, ref } = await lockedAttempt(client, db, idempotencyKey, token);
    if (attempt.outcome === outcome) return attempt;
    if (attempt.outcome && attempt.outcome !== 'published' && attempt.outcome !== 'smoked') throw new StateError('attempt closed');
    if (attempt.outcome === 'smoked' && outcome !== 'consumed') throw new StateError('invalid outcome transition');
    if (outcome === 'consumed') {
      if (!attempt.submission_id) throw new StateError('submission missing');
      if (attempt.outcome !== 'smoked' || typeof observe !== 'function') throw new StateError('consumed requires smoke and observation');
      const counted = await countCurrentWeek(db, { target: ref.target, weekStart: ref.weekStart, observe });
      const laneItems = ref.lane === 'roundup' ? counted.roundup : counted.content;
      if (!laneItems.some((item) => item.submissionId === number(attempt.submission_id))) throw new StateError('submission is not current-live');
    }
    const next = row(await client.query(`update content.cadence_attempts set outcome=$2,updated_at=now(),closed_at=now()
      where idempotency_key=$1 returning ${dateText}`, [idempotencyKey, outcome]));
    await client.query(`update content.cadence_slots set state=$5 where ${slotColumns}`,
      [...slotValues(ref), failed.has(outcome) ? 'ready' : outcome]);
    return next;
  });
}
export async function consumedFingerprints(db, { target }) {
  checkTarget(db, target);
  return (await db.query(`select distinct intent_fingerprint from content.cadence_attempts
    where target=$1 and outcome in ('smoked','consumed') order by intent_fingerprint`, [target])).rows.map((r) => r.intent_fingerprint);
}

export async function countCurrentWeek(db, { target, weekStart, observe }) {
  checkTarget(db, target);
  if (weekStartUtc(weekStart) !== weekStart) throw new ValidationError('invalid week start');
  const rows = (await db.query(`select distinct on (i.key,s.kind) i.key as slug,s.id as submission_id,
      i.published_rev,s.smoke_passed_at,s.kind,r.payload->>'category' as category
    from content.submissions s join content.submission_items i on i.submission_id=s.id
    join content.entries e on e.dataset=i.dataset and e.key=i.key and e.live_rev=i.published_rev
    join content.revisions r on r.dataset=i.dataset and r.key=i.key and r.rev=i.published_rev
    join lateral (select g.* from content.gate_rounds g where g.submission_id=s.id order by g.round desc limit 1) g on true
    where s.target=$1 and s.smoke_passed_at >= $2::date and s.smoke_passed_at < $2::date + interval '7 days'
      and s.state='published' and i.smoke='passed' and i.dataset='posts' and i.op='insert'
      and i.published_rev is not null and g.passed=true and g.overall>=8 and g.blocking_count=0
      and ((s.kind='blog' and r.payload->>'category' is distinct from 'news')
        or (s.kind='roundup' and r.payload->>'category'='news' and i.key=$3))
    order by i.key,s.kind,s.id desc`, [target, weekStart, roundupSlug(weekStart)])).rows;
  const mapped = rows.map((r) => ({ slug: r.slug, submissionId: number(r.submission_id), publishedRev: r.published_rev, smokePassedAt: r.smoke_passed_at }));
  const classify = (items) => ({ content: items.filter((_, index) => rows[index].kind === 'blog'), roundup: items.filter((_, index) => rows[index].kind === 'roundup') });
  const dbOnly = classify(mapped);
  const observed = [];
  if (typeof observe === 'function') {
    for (const item of mapped) {
      const receipt = await observe(item.slug);
      if (receipt?.snapshotId && number(receipt.rev) === number(item.publishedRev)) observed.push(item);
    }
  }
  const { content, roundup } = classify(mapped.map((item) => observed.includes(item) ? item : null));
  const liveContent = content.filter(Boolean);
  const liveRoundup = roundup.filter(Boolean);
  return { content: liveContent, roundup: liveRoundup, observer: typeof observe === 'function' ? 'available' : 'unavailable', contentCount: liveContent.length,
    roundupCount: liveRoundup.length, met: liveContent.length >= 2 && liveRoundup.length >= 1,
    dbOnly: { ...dbOnly, contentCount: dbOnly.content.length, roundupCount: dbOnly.roundup.length } };
}
export async function recordMissedAlert(db, { target, weekStart, alertKind, counts, failureClass }) {
  checkTarget(db, target);
  if (weekStartUtc(weekStart) !== weekStart || !['WEEKLY_CONTENT_MISSED', 'WEEKLY_NEWS_MISSED'].includes(alertKind)) throw new ValidationError('invalid alert');
  const safeCounts = { content: counts?.contentCount ?? counts?.content,
    roundup: counts?.roundupCount ?? counts?.roundup };
  if (![safeCounts.content, safeCounts.roundup].every((value) => Number.isInteger(value) && value >= 0)
    || typeof failureClass !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(failureClass)) throw new ValidationError('invalid alert counts or failure class');
  const notificationKey = `cadence-alert:${target}:${weekStart}:${alertKind}`;
  const inserted = row(await db.query(`insert into content.cadence_alerts(target,week_start_utc,alert_kind,notification_key,counts,failure_class)
    values($1,$2,$3,$4,$5::json,$6) on conflict do nothing returning ${dateText}`,
  [target, weekStart, alertKind, notificationKey, JSON.stringify(safeCounts), failureClass]));
  const alert = inserted ?? row(await db.query(`select ${dateText} from content.cadence_alerts where target=$1 and week_start_utc=$2 and alert_kind=$3`, [target, weekStart, alertKind]));
  return { alert, created: Boolean(inserted) };
}
export async function deliverPendingAlerts(db, { target, send, maxAttempts = 5 }) {
  checkTarget(db, target);
  if (typeof send !== 'function' || !Number.isInteger(maxAttempts) || maxAttempts < 1) throw new ValidationError('invalid alert delivery');
  const pending = (await db.query(`select target,week_start_utc::text as week_start_utc,alert_kind from content.cadence_alerts
    where target=$1 and delivered_at is null and delivery_attempts<$2 order by created_at`, [target, maxAttempts])).rows;
  const summary = { delivered: 0, failed: 0, pending: pending.length };
  for (const item of pending) {
    await db.tx(async (client) => {
      const alert = row(await client.query(`select ${dateText} from content.cadence_alerts where target=$1 and week_start_utc=$2
        and alert_kind=$3 for update`, [item.target, item.week_start_utc, item.alert_kind]));
      if (alert.delivered_at || alert.delivery_attempts >= maxAttempts) return;
      try {
        await send({ target: alert.target, weekStart: alert.week_start_utc,
          alertKind: alert.alert_kind, notificationKey: alert.notification_key, counts: alert.counts,
          failureClass: alert.failure_class });
        await client.query(`update content.cadence_alerts set delivered_at=now(),delivery_attempts=delivery_attempts+1,last_error=null
          where target=$1 and week_start_utc=$2 and alert_kind=$3`, [item.target, item.week_start_utc, item.alert_kind]);
        summary.delivered++;
      } catch (error) {
        await client.query(`update content.cadence_alerts set delivery_attempts=delivery_attempts+1,last_error=$4
          where target=$1 and week_start_utc=$2 and alert_kind=$3`,
        [item.target, item.week_start_utc, item.alert_kind, String(error?.code ?? 'delivery-failed').slice(0, 120)]);
        summary.failed++;
      }
    });
  }
  return summary;
}
export async function evaluateDeadline(db, { target, weekStart, now = new Date(), observe }) {
  checkTarget(db, target);
  if (typeof observe !== 'function') throw new StateError('observer required');
  if (dateValue(now) < new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86400000)) return { due: false, alerts: [] };
  const counts = await countCurrentWeek(db, { target, weekStart, observe });
  const alerts = [];
  for (const [missing, kind] of [[counts.contentCount < 2, 'WEEKLY_CONTENT_MISSED'], [counts.roundupCount < 1, 'WEEKLY_NEWS_MISSED']]) {
    if (missing) alerts.push(await recordMissedAlert(db, { target, weekStart, alertKind: kind,
      counts: { content: counts.contentCount, roundup: counts.roundupCount }, failureClass: 'deadline-missed' }));
  }
  return { due: true, counts, alerts };
}
