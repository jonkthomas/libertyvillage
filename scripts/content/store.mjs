import { randomUUID } from 'node:crypto';
import { ALL, SITE_DATASETS, registry, candidateDigest, datasetDigest, hash, recordSha } from './canonical.mjs';
import { validateRecord } from './validate.mjs';
export { openDb, TargetError } from './db.mjs';

export class ConflictError extends Error { constructor(conflicts) { super('live revision conflict'); this.code = 'ConflictError'; this.conflicts = conflicts; } }
export class StateError extends Error { constructor(message) { super(message); this.code = 'StateError'; } }
export class ClaimError extends Error { constructor(message = 'lease-lost') { super(message); this.code = 'ClaimError'; } }
export class ValidationError extends Error { constructor(message) { super(message); this.code = 'ValidationError'; } }
const rows = (q) => q.rows;
const one = (q) => q.rows[0];
const n = (value) => value == null ? null : Number(value);
async function lockedClaim(c, id, token, states) {
  const s = one(await c.query('select * from content.submissions where id=$1 for update', [id]));
  if (!s || s.claim_token !== token || !s.claimed_until || new Date(s.claimed_until) <= new Date()) throw new ClaimError();
  if (states && !states.includes(s.state)) throw new StateError(`invalid state: ${s.state}`);
  return s;
}
async function lockDatasets(c, datasets) {
  for (const d of [...new Set(datasets)].sort()) await c.query("select pg_advisory_xact_lock(hashtext('content:' || $1))", [d]);
}
async function bump(c) { return n(one(await c.query('update content.meta set live_seq=live_seq+1 returning live_seq')).live_seq); }
function checkItems(items) {
  if (!Array.isArray(items) || !items.length) throw new ValidationError('items required');
  const seen = new Set();
  for (const i of items) {
    const id = `${i.dataset}\0${i.key}`;
    if (seen.has(id)) throw new ValidationError('duplicate item');
    seen.add(id);
    if (!SITE_DATASETS.includes(i.dataset) || i.op && !['insert', 'update'].includes(i.op)) throw new ValidationError('invalid item');
    const result = validateRecord(i.dataset, i.key, i.payload);
    if (!result.ok) throw new ValidationError(result.errors.join('; '));
  }
}
export async function readLive(db, { datasets = ALL } = {}) {
  return db.tx(async (c) => {
    const liveSeq = n(one(await c.query('select live_seq from content.meta')).live_seq);
    const out = {};
    for (const d of datasets) {
      if (!ALL.includes(d)) throw new ValidationError(`unknown dataset ${d}`);
      let found;
      if (d === 'discovery-seen') found = rows(await c.query('select name_key,first_seen::text from content.discovery_seen order by name_key')).map((r) => ({ key: r.name_key, rev: 1, payload: { nameKey: r.name_key, firstSeen: r.first_seen.slice(0, 10) } }));
      else found = rows(await c.query('select e.key,e.live_rev as rev,r.payload,r.payload_sha256 from content.entries e join content.revisions r on (r.dataset=e.dataset and r.key=e.key and r.rev=e.live_rev) where e.dataset=$1 order by e.position', [d]));
      const records = found.map((r) => r.payload);
      out[d] = { count: records.length, digest: datasetDigest(d, records), entries: Object.fromEntries(found.map((r) => [r.key, { rev: n(r.rev), sha: r.payload_sha256 ?? recordSha(r.payload) }])), records };
    }
    const livePaths = [...new Set(Object.entries(out).flatMap(([dataset, value]) =>
      value.records.flatMap((record) => registry[dataset].imageFields.map((field) => record[field]).filter((path) => typeof path === 'string' && path.startsWith('/media/')))))];
    const media = livePaths.length ? rows(await c.query('select path,sha256,byte_size from content.assets where path=any($1::text[]) order by path', [livePaths])).map((a) => ({ path: a.path, sha256: a.sha256, byte_size: a.byte_size })) : [];
    if (media.length !== livePaths.length) throw new ValidationError('live media missing from asset store');
    const snapshotId = hash('sha1', `${liveSeq}\n${Object.entries(out).map(([d, v]) => `${d}:${v.digest}`).join('\n')}`);
    return { schema: 1, db: db.dbName, target: db.target, live_seq: liveSeq, snapshot_id: snapshotId, generated_at: new Date().toISOString(), datasets: out, media };
  }, { isolation: 'repeatable read read only' });
}
export async function resolveAssets(db, assets) {
  return Promise.all(assets.map(async ({ sha256 }) => ({ sha256, path: one(await db.query('select path from content.assets where sha256=$1', [sha256]))?.path ?? null })));
}
export async function createSubmission(db, input) {
  const { kind, target, actor, idempotencyKey, baseSnapshotId = null, context = null, items, assets = [], discoverySeen = [] } = input;
  if (target !== db.target) throw new ValidationError('target mismatch');
  if (!idempotencyKey || !actor) throw new ValidationError('actor and idempotency key required');
  if (!['seed', 'business', 'blog', 'blog-live', 'news', 'seo', 'topic-discovery', 'manual'].includes(kind)) throw new ValidationError('invalid kind');
  checkItems(items);
  const requestSha = hash('sha256', JSON.stringify({ kind, target, actor, baseSnapshotId, context, items, assets: assets.map((a) => ({ sha256: a.sha256, path: a.path })), discoverySeen }));
  return db.tx(async (c) => {
    const inserted = one(await c.query(`insert into content.submissions(kind,target,actor,idempotency_key,request_sha256,base_snapshot_id,context,state)
      values($1,$2,$3,$4,$5,$6,$7::json,'open') on conflict(idempotency_key) do nothing returning id`, [kind, target, actor, idempotencyKey, requestSha, baseSnapshotId, context && JSON.stringify(context)]));
    if (!inserted) {
      const old = one(await c.query('select id,request_sha256 from content.submissions where idempotency_key=$1', [idempotencyKey]));
      if (old.request_sha256 !== requestSha) throw new StateError('idempotency-mismatch');
      const oldItems = rows(await c.query(`select i.dataset,i.key,i.op,r.rev,i.expected_live_rev as "expectedLiveRev"
        from content.submission_items i join content.round_items r on r.submission_id=i.submission_id and r.dataset=i.dataset and r.key=i.key and r.round=0
        where i.submission_id=$1 order by i.dataset,i.key`, [old.id]));
      return { submissionId: n(old.id), existing: true, items: oldItems, discoverySeenAdded: 0 };
    }
    const id = n(inserted.id);
    const sorted = [...items].sort((a, b) => `${a.dataset}\t${a.key}`.localeCompare(`${b.dataset}\t${b.key}`));
    for (const i of sorted) await c.query('insert into content.entries(dataset,key) values($1,$2) on conflict(dataset,key) do nothing', [i.dataset, i.key]);
    const created = [];
    for (const i of sorted) {
      const e = one(await c.query('select * from content.entries where dataset=$1 and key=$2 for update', [i.dataset, i.key]));
      if (n(e.live_rev) !== n(i.expectedLiveRev)) throw new ConflictError([{ dataset: i.dataset, key: i.key, expected: i.expectedLiveRev ?? null, actual: n(e.live_rev) }]);
      const rev = e.head_rev + 1;
      await c.query('update content.entries set head_rev=$3,updated_at=now() where dataset=$1 and key=$2', [i.dataset, i.key, rev]);
      const sha = recordSha(i.payload);
      await c.query(`insert into content.revisions(dataset,key,rev,payload,payload_sha256,source,actor,submission_id,parent_rev)
        values($1,$2,$3,$4::json,$5,$6,$7,$8,$9)`, [i.dataset, i.key, rev, JSON.stringify(i.payload), sha, kind === 'manual' ? 'manual' : 'writer', actor, id, i.expectedLiveRev ?? null]);
      await c.query('insert into content.submission_items(submission_id,dataset,key,op,expected_live_rev) values($1,$2,$3,$4,$5)', [id, i.dataset, i.key, i.op ?? (i.expectedLiveRev == null ? 'insert' : 'update'), i.expectedLiveRev ?? null]);
      await c.query('insert into content.round_items(submission_id,round,dataset,key,rev,payload_sha256) values($1,0,$2,$3,$4,$5)', [id, i.dataset, i.key, rev, sha]);
      created.push({ dataset: i.dataset, key: i.key, op: i.op ?? (i.expectedLiveRev == null ? 'insert' : 'update'), rev, expectedLiveRev: i.expectedLiveRev ?? null });
    }
    for (const a of assets) {
      if (hash('sha256', a.bytes) !== a.sha256) throw new ValidationError('asset hash mismatch');
      await c.query('insert into content.assets(sha256,path,content_type,bytes,byte_size,submission_id) values($1,$2,$3,$4,$5,$6) on conflict(sha256) do nothing', [a.sha256, a.path, a.contentType, a.bytes, a.bytes.length, id]);
    }
    let added = 0;
    for (const s of discoverySeen) added += (await c.query('insert into content.discovery_seen(name_key,first_seen,outcome_submission_id) values($1,$2,$3) on conflict(name_key) do nothing', [s.nameKey, s.firstSeen, id])).rowCount;
    return { submissionId: id, existing: false, items: created, discoverySeenAdded: added };
  });
}
export async function claimSubmission(db, id, { owner, leaseSeconds = 900 } = {}) {
  if (!owner || leaseSeconds <= 0) throw new ValidationError('invalid claim');
  return db.tx(async (c) => {
    const s = one(await c.query('select * from content.submissions where id=$1 for update', [id]));
    if (!s) throw new StateError('submission missing');
    if (s.claim_token && s.claimed_until > new Date()) throw new ClaimError('claim-held');
    const token = randomUUID();
    await c.query("update content.submissions set claim_token=$2,claimed_until=now()+($3 * interval '1 second') where id=$1", [id, token, leaseSeconds]);
    return { token };
  });
}
export async function renewClaim(db, id, token, { leaseSeconds = 900 } = {}) {
  return db.tx(async (c) => { await lockedClaim(c, id, token); await c.query("update content.submissions set claimed_until=now()+($3 * interval '1 second') where id=$1 and claim_token=$2", [id, token, leaseSeconds]); return { token }; });
}
export async function releaseClaim(db, id, token) {
  return db.tx(async (c) => { await lockedClaim(c, id, token); await c.query('update content.submissions set claim_token=null,claimed_until=null where id=$1', [id]); });
}
export async function getSubmission(db, id) {
  const submission = one(await db.query('select * from content.submissions where id=$1', [id]));
  if (!submission) throw new StateError('submission missing');
  const items = rows(await db.query('select * from content.submission_items where submission_id=$1 order by dataset,key', [id]));
  const rounds = rows(await db.query(`select distinct on (i.round) i.round,g.candidate_digest,g.content_sha,g.verdict,g.overall,g.passed,g.blocking_count,g.lint,g.decision,g.scripted,g.created_at
    from content.round_items i left join content.gate_rounds g on g.submission_id=i.submission_id and g.round=i.round
    where i.submission_id=$1 order by i.round`, [id]));
  for (const round of rounds) round.items = rows(await db.query(`select i.dataset,i.key,i.rev,i.payload_sha256,r.payload from content.round_items i join content.revisions r using(dataset,key,rev) where i.submission_id=$1 and i.round=$2 order by i.dataset,i.key`, [id, round.round]));
  return { submission, items, rounds };
}
export async function recordRound(db, id, token, input) {
  return db.tx(async (c) => {
    const s = await lockedClaim(c, id, token, ['open', 'gating']);
    if (s.round !== input.round) throw new StateError('round-mismatch');
    if (one(await c.query('select 1 from content.gate_rounds where submission_id=$1 and round=$2', [id, input.round]))) throw new StateError('round-recorded');
    const vector = rows(await c.query('select * from content.round_items where submission_id=$1 and round=$2', [id, input.round]));
    if (!vector.length || candidateDigest(vector) !== input.candidateDigest) throw new StateError('candidate-digest-mismatch');
    await c.query(`insert into content.gate_rounds(submission_id,round,candidate_digest,content_sha,verdict,overall,passed,blocking_count,lint,decision,scripted)
      values($1,$2,$3,$4,$5::json,$6,$7,$8,$9::json,$10,$11)`, [id, input.round, input.candidateDigest, input.contentSha, input.verdict == null ? null : JSON.stringify(input.verdict), input.overall ?? null, input.passed, input.blockingCount ?? 0, input.lint == null ? null : JSON.stringify(input.lint), input.decision, input.scripted ?? false]);
    const terminal = ['validation', 'lint'].includes(input.decision) ? 'rejected' : ['unrepairable', 'exhausted', 'not-converging', 'block'].includes(input.decision) ? 'blocked' : null;
    await c.query('update content.submissions set state=$2,decision=$3,closed_at=case when $4 then now() else closed_at end where id=$1', [id, terminal ?? 'gating', input.decision, !!terminal]);
    if (terminal) await c.query("update content.discovery_seen set outcome='rejected',outcome_submission_id=$1 where outcome='seen' and name_key in (select name_key from content.discovery_seen where outcome_submission_id=$1)", [id]);
    return { state: terminal ?? 'gating', decision: input.decision };
  });
}
export async function addRepairRound(db, id, token, { fromRound, repairs }) {
  return db.tx(async (c) => {
    const s = await lockedClaim(c, id, token, ['gating']);
    if (s.round !== fromRound || one(await c.query('select decision from content.gate_rounds where submission_id=$1 and round=$2', [id, fromRound]))?.decision !== 'repair') throw new StateError('repair not allowed');
    if (one(await c.query('select 1 from content.round_items where submission_id=$1 and round=$2', [id, fromRound + 1]))) throw new StateError('round-exists');
    const prev = rows(await c.query('select * from content.round_items where submission_id=$1 and round=$2 order by dataset,key', [id, fromRound]));
    const replacements = new Map(repairs.map((r) => [`${r.dataset}\0${r.key}`, r]));
    if (replacements.size !== repairs.length) throw new ValidationError('duplicate repair');
    const next = [];
    for (const i of prev) {
      const replacement = replacements.get(`${i.dataset}\0${i.key}`);
      if (!replacement) { next.push(i); continue; }
      const valid = validateRecord(i.dataset, i.key, replacement.payload);
      if (!valid.ok) throw new ValidationError(valid.errors.join('; '));
      const entry = one(await c.query('select head_rev from content.entries where dataset=$1 and key=$2 for update', [i.dataset, i.key]));
      const rev = entry.head_rev + 1;
      const sha = recordSha(replacement.payload);
      await c.query('update content.entries set head_rev=$3,updated_at=now() where dataset=$1 and key=$2', [i.dataset, i.key, rev]);
      await c.query(`insert into content.revisions(dataset,key,rev,payload,payload_sha256,source,actor,submission_id,parent_rev) values($1,$2,$3,$4::json,$5,'fixer',$6,$7,$8)`, [i.dataset, i.key, rev, JSON.stringify(replacement.payload), sha, s.actor, id, i.rev]);
      next.push({ ...i, rev, payload_sha256: sha }); replacements.delete(`${i.dataset}\0${i.key}`);
    }
    if (replacements.size) throw new ValidationError('repair item missing');
    for (const i of next) await c.query('insert into content.round_items(submission_id,round,dataset,key,rev,payload_sha256) values($1,$2,$3,$4,$5,$6)', [id, fromRound + 1, i.dataset, i.key, i.rev, i.payload_sha256]);
    await c.query('update content.submissions set round=round+1,repairs=repairs+1 where id=$1', [id]);
    return { round: fromRound + 1, items: next };
  });
}
export async function publishSubmission(db, id, token) {
  return db.tx(async (c) => {
    const s = await lockedClaim(c, id, token, ['gating', 'published']);
    if (s.state === 'published') return { liveSeq: n(s.live_seq), published: [], existing: true };
    const gate = one(await c.query('select * from content.gate_rounds where submission_id=$1 and round=$2', [id, s.round]));
    const vector = rows(await c.query('select * from content.round_items where submission_id=$1 and round=$2', [id, s.round]));
    if (!gate?.passed || gate.decision !== 'go' || gate.candidate_digest !== candidateDigest(vector)) throw new StateError('gate-not-current');
    await lockDatasets(c, vector.map((v) => v.dataset));
    const published = [];
    for (const v of vector.sort((a,b) => `${a.dataset}\t${a.key}`.localeCompare(`${b.dataset}\t${b.key}`))) {
      const e = one(await c.query('select * from content.entries where dataset=$1 and key=$2 for update', [v.dataset, v.key]));
      const item = one(await c.query('select * from content.submission_items where submission_id=$1 and dataset=$2 and key=$3', [id, v.dataset, v.key]));
      if (n(e.live_rev) !== n(item.expected_live_rev)) throw new ConflictError([{ dataset: v.dataset, key: v.key, expected: n(item.expected_live_rev), actual: n(e.live_rev) }]);
      const actual = one(await c.query('select payload_sha256 from content.revisions where dataset=$1 and key=$2 and rev=$3', [v.dataset, v.key, v.rev]));
      if (actual?.payload_sha256 !== v.payload_sha256) throw new StateError('candidate-revision-mismatch');
      published.push({ dataset: v.dataset, key: v.key, op: item.op, rev: v.rev });
    }
    await c.query("set local content.publishing = 'on'");
    for (const v of published) {
      await c.query('update content.revisions set published_at=now() where dataset=$1 and key=$2 and rev=$3 and published_at is null', [v.dataset, v.key, v.rev]);
      await c.query(`update content.entries set live_rev=$3,position=coalesce(position,(select coalesce(max(position),-1)+1 from content.entries where dataset=$1)),first_published_at=coalesce(first_published_at,now()),updated_at=now() where dataset=$1 and key=$2`, [v.dataset, v.key, v.rev]);
      await c.query('update content.submission_items set published_rev=$4 where submission_id=$1 and dataset=$2 and key=$3', [id, v.dataset, v.key, v.rev]);
    }
    const liveSeq = await bump(c);
    await c.query("update content.submissions set state='published',decision='go',live_seq=$2,closed_at=now() where id=$1", [id, liveSeq]);
    await c.query("update content.discovery_seen set outcome='added' where outcome='seen' and outcome_submission_id=$1", [id]);
    return { liveSeq, published, existing: false };
  });
}
export async function rejectSubmission(db, id, token, { state, decision }) {
  if (!['rejected', 'error'].includes(state)) throw new ValidationError('invalid rejection state');
  return db.tx(async (c) => { await lockedClaim(c, id, token, ['open', 'gating']); await c.query('update content.submissions set state=$2,decision=$3,closed_at=now() where id=$1', [id, state, decision]); await c.query("update content.discovery_seen set outcome='rejected' where outcome='seen' and outcome_submission_id=$1", [id]); return { state, decision }; });
}
export async function markPhase(db, id, token, phase) {
  const col = { deploy_requested: 'deploy_requested_at', smoke_passed: 'smoke_passed_at', notified: 'notified_at' }[phase];
  if (!col) throw new ValidationError('invalid phase');
  const states = phase === 'notified' ? ['published', 'compensated', 'rejected', 'blocked', 'error'] : ['published', 'compensated'];
  return db.tx(async (c) => { await lockedClaim(c, id, token, states); await c.query(`update content.submissions set ${col}=coalesce(${col},now()) where id=$1`, [id]); });
}
export async function markItemSmoke(db, id, token, items) {
  return db.tx(async (c) => { await lockedClaim(c, id, token, ['published', 'compensated']); for (const i of items) { if (!['passed', 'superseded'].includes(i.smoke)) throw new ValidationError('invalid smoke'); const r = await c.query('update content.submission_items set smoke=$4 where submission_id=$1 and dataset=$2 and key=$3', [id, i.dataset, i.key, i.smoke]); if (!r.rowCount) throw new ValidationError('item missing'); } });
}
export async function compensateSubmission(db, id, token, { actor, reason }) {
  if (!actor || !reason) throw new ValidationError('actor and reason required');
  return db.tx(async (c) => {
    await lockedClaim(c, id, token, ['published']);
    const items = rows(await c.query('select * from content.submission_items where submission_id=$1 order by dataset,key', [id]));
    await lockDatasets(c, items.map((i) => i.dataset));
    const conflicts = [];
    for (const i of items) {
      const e = one(await c.query('select live_rev from content.entries where dataset=$1 and key=$2 for update', [i.dataset, i.key]));
      if (n(e.live_rev) !== n(i.published_rev)) conflicts.push({ dataset: i.dataset, key: i.key, expected: n(i.published_rev), actual: n(e.live_rev) });
    }
    if (conflicts.length) throw new ConflictError(conflicts);
    const liveSeq = await bump(c);
    const key = `compensate:${id}`;
    const admin = one(await c.query(`insert into content.submissions(kind,target,actor,idempotency_key,request_sha256,state,decision,live_seq,claim_token,claimed_until,closed_at)
      values('admin',$1,$2,$3,$4,'published','admin',$5,$6,now()+interval '15 minutes',now()) returning id`, [db.target, actor, key, hash('sha256', `${id}:${reason}`), liveSeq, randomUUID()]));
    const reverted = [];
    for (const i of items) {
      await c.query('update content.entries set live_rev=$3,updated_at=now() where dataset=$1 and key=$2', [i.dataset, i.key, i.expected_live_rev]);
      await c.query('insert into content.actions(actor,action,dataset,key,from_rev,to_rev,submission_id,reason,live_seq) values($1,\'compensate\',$2,$3,$4,$5,$6,$7,$8)', [actor, i.dataset, i.key, i.published_rev, i.expected_live_rev, n(admin.id), reason, liveSeq]);
      await c.query("insert into content.submission_items(submission_id,dataset,key,op,expected_live_rev,published_rev) values($1,$2,$3,'compensate',$4,$5)", [admin.id, i.dataset, i.key, i.published_rev, i.expected_live_rev]);
      reverted.push({ dataset: i.dataset, key: i.key, fromRev: n(i.published_rev), toRev: n(i.expected_live_rev) });
    }
    await c.query("update content.submissions set state='compensated',decision='smoke-failed' where id=$1", [id]);
    return { adminSubmissionId: n(admin.id), adminToken: one(await c.query('select claim_token from content.submissions where id=$1', [admin.id])).claim_token, liveSeq, reverted };
  });
}
export async function adminAction(db, { op, dataset, key, toRev, actor, reason, idempotencyKey, owner }) {
  if (!['unpublish', 'rollback'].includes(op) || !SITE_DATASETS.includes(dataset) || !actor || !reason || !idempotencyKey || !owner) throw new ValidationError('invalid admin action');
  if (dataset === 'topic-queue' || (op === 'unpublish' && dataset === 'guide-hub')) throw new ValidationError('admin action forbidden for dataset');
  const requestSha = hash('sha256', JSON.stringify({ op, dataset, key, toRev, actor, reason }));
  return db.tx(async (c) => {
    const old = one(await c.query('select * from content.submissions where idempotency_key=$1', [idempotencyKey]));
    if (old) {
      if (old.request_sha256 !== requestSha) throw new StateError('idempotency-mismatch');
      const item = one(await c.query('select * from content.submission_items where submission_id=$1', [old.id]));
      return { submissionId: n(old.id), token: old.claim_token, existing: true, liveSeq: n(old.live_seq), fromRev: n(item.expected_live_rev), rev: n(item.published_rev) };
    }
    await lockDatasets(c, [dataset]);
    const e = one(await c.query('select * from content.entries where dataset=$1 and key=$2 for update', [dataset, key]));
    if (!e) throw new ValidationError('entry missing');
    const fromRev = n(e.live_rev);
    let rev = null;
    if (op === 'unpublish') {
      if (fromRev == null) throw new ValidationError('entry not live');
      const count = n(one(await c.query('select count(*) as count from content.entries where dataset=$1 and live_rev is not null', [dataset])).count);
      if (count <= 1) throw new ValidationError('dataset-would-be-empty');
    } else {
      const source = one(await c.query('select * from content.revisions where dataset=$1 and key=$2 and rev=$3', [dataset, key, toRev]));
      if (!source?.published_at) throw new ValidationError('rollback target never published');
      rev = e.head_rev + 1;
      await c.query(`insert into content.revisions(dataset,key,rev,payload,payload_sha256,source,actor,parent_rev,published_at)
        values($1,$2,$3,$4::json,$5,'rollback',$6,$7,now())`, [dataset, key, rev, JSON.stringify(source.payload), source.payload_sha256, actor, fromRev]);
      await c.query('update content.entries set head_rev=$3 where dataset=$1 and key=$2', [dataset, key, rev]);
    }
    const liveSeq = await bump(c);
    const token = randomUUID();
    const admin = one(await c.query(`insert into content.submissions(kind,target,actor,idempotency_key,request_sha256,state,decision,live_seq,claim_token,claimed_until,closed_at)
      values('admin',$1,$2,$3,$4,'published','admin',$5,$6,now()+interval '15 minutes',now()) returning id`, [db.target, actor, idempotencyKey, requestSha, liveSeq, token]));
    await c.query('update content.entries set live_rev=$3,updated_at=now() where dataset=$1 and key=$2', [dataset, key, rev]);
    await c.query('insert into content.actions(actor,action,dataset,key,from_rev,to_rev,submission_id,reason,live_seq) values($1,$2,$3,$4,$5,$6,$7,$8,$9)', [actor, op, dataset, key, fromRev, rev, admin.id, reason, liveSeq]);
    await c.query('insert into content.submission_items(submission_id,dataset,key,op,expected_live_rev,published_rev) values($1,$2,$3,$4,$5,$6)', [admin.id, dataset, key, op, fromRev, rev]);
    return { submissionId: n(admin.id), token, existing: false, liveSeq, fromRev, rev };
  });
}
export async function history(db, { dataset, key }) {
  const entry = one(await db.query('select * from content.entries where dataset=$1 and key=$2', [dataset, key]));
  if (!entry) throw new ValidationError('entry missing');
  const revisions = rows(await db.query('select rev,source,actor,submission_id as "submissionId",payload_sha256 as "payloadSha256",published_at as "publishedAt",created_at as "createdAt",rev=$3 as live from content.revisions where dataset=$1 and key=$2 order by rev', [dataset, key, entry.live_rev]));
  const actions = rows(await db.query('select * from content.actions where dataset=$1 and key=$2 order by id', [dataset, key]));
  return { entry, revisions, actions };
}
export async function listSubmissions(db, { state, kind, target, dataset, key, since } = {}) {
  const result = rows(await db.query(`select * from content.submissions where ($1::text[] is null or state=any($1)) and ($2::text is null or kind=$2) and ($3::text is null or target=$3) and ($4::timestamptz is null or created_at >= $4) order by id desc`, [state ? (Array.isArray(state) ? state : state.split(',')) : null, kind ?? null, target ?? null, since ?? null]));
  const out = [];
  for (const s of result) {
    const items = rows(await db.query('select dataset,key,op from content.submission_items where submission_id=$1', [s.id]));
    if (dataset && !items.some((i) => i.dataset === dataset && (!key || i.key === key))) continue;
    out.push({ id: n(s.id), kind: s.kind, state: s.state, decision: s.decision, round: s.round, repairs: s.repairs, createdAt: s.created_at, closedAt: s.closed_at, items });
  }
  return out;
}
export async function listPending(db, { target } = {}) {
  return rows(await db.query("select id from content.submissions where state='published' and ($1::text is null or target=$1) and (smoke_passed_at is null or notified_at is null) order by id", [target ?? null])).map((r) => n(r.id));
}
export async function listEntries(db, { dataset, visibility = 'all' } = {}) {
  const results = rows(await db.query(`select e.dataset,e.key,e.live_rev as "liveRev",e.head_rev as "headRev",e.position,
    exists(select 1 from content.revisions r where r.dataset=e.dataset and r.key=e.key and r.published_at is not null) as ever
    from content.entries e where ($1::text is null or e.dataset=$1) order by e.dataset,e.position nulls last,e.key`, [dataset ?? null]));
  return results.filter((r) => visibility === 'all' || visibility === 'live' && r.liveRev != null || visibility === 'unpublished' && r.liveRev == null && r.ever || visibility === 'never' && r.liveRev == null && !r.ever)
    .map((r) => ({ dataset:r.dataset,key:r.key,liveRev:r.liveRev,headRev:r.headRev,position:r.position }));
}
export async function markDiscoverySeen(db, nameKeys, { outcome, submissionId }) {
  if (!['added', 'rejected'].includes(outcome)) throw new ValidationError('invalid outcome');
  return db.tx(async (c) => { const result = await c.query("update content.discovery_seen set outcome=$2,outcome_submission_id=$3 where name_key=any($1) and outcome='seen'", [nameKeys, outcome, submissionId]); return result.rowCount; });
}
export async function stats(db) {
  const sizeRows = rows(await db.query("select datname,pg_database_size(oid) as bytes from pg_database where datname in ('neondb','lv_staging') or datname=current_database()"));
  const databases = Object.fromEntries(sizeRows.map((r) => [r.datname,n(r.bytes)]));
  const assets = one(await db.query('select count(*) as count,coalesce(sum(byte_size),0) as bytes from content.assets'));
  const reclaimable = await reclaimableAssets(db);
  return { databases, projectBytes:Object.values(databases).reduce((a,b) => a+b,0), assets: { count: n(assets.count), bytes: n(assets.bytes), reclaimable: reclaimable.reduce((a,b) => a+b.byte_size,0) } };
}
export async function reclaimableAssets(db) {
  return rows(await db.query(`select a.sha256,a.path,a.byte_size from content.assets a
    where exists (select 1 from content.revisions r where r.payload::text like '%' || a.path || '%')
      and not exists (select 1 from content.revisions r left join content.submissions s on s.id=r.submission_id
        where r.payload::text like '%' || a.path || '%'
          and (r.published_at is not null or s.id is null or s.state not in ('rejected','blocked','error')
               or s.closed_at is null or s.closed_at >= now()-interval '14 days'))
      and not exists (select 1 from content.revisions r join content.entries e
        on e.dataset=r.dataset and e.key=r.key and e.live_rev=r.rev where r.payload::text like '%' || a.path || '%')`));
}
