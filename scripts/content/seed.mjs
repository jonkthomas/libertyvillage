import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ALL, SITE_DATASETS, fromFile, keyOf, recordSha, hash } from './canonical.mjs';
import { validateRecord } from './validate.mjs';
import { ValidationError } from './store.mjs';

export async function loadSource({ fromRef, from } = {}) {
  if (Boolean(fromRef) === Boolean(from)) throw new ValidationError('exactly one source required');
  const datasets = {};
  const texts = {};
  for (const dataset of ALL) {
    const filename = `${dataset}.json`;
    const text = fromRef ? execFileSync('git', ['show', `${fromRef}:data/${filename}`], { encoding:'utf8', maxBuffer: 10_000_000 }) : await readFile(path.join(from, 'data', filename), 'utf8').catch(() => readFile(path.join(from, filename), 'utf8'));
    const records = fromFile(dataset, JSON.parse(text));
    if (dataset !== 'discovery-seen') for (const r of records) {
      const valid = validateRecord(dataset, keyOf(dataset, r), r);
      if (!valid.ok) throw new ValidationError(`${dataset}: ${valid.errors.join('; ')}`);
    }
    datasets[dataset] = records;
    texts[filename] = text;
  }
  return { datasets, texts, sourceSha: fromRef ?? hash('sha256', Object.entries(texts).map(([file,text]) => `${file}:${hash('sha256',text)}`).join('\n')) };
}
function planFor(snapshot, source, { prune = false } = {}) {
  const plan = { inserted:0, updated:0, unchanged:0, unpublished:[], repositioned:0, refused:[] };
  for (const d of SITE_DATASETS) {
    const existing = snapshot.datasets[d];
    for (let pos = 0; pos < source[d].length; pos++) {
      const record = source[d][pos], key = keyOf(d,record), previous = existing.entries[key];
      if (!previous) plan.inserted++;
      else if (previous.sha === recordSha(record)) plan.unchanged++;
      else plan.updated++;
      const oldPos = existing.records.findIndex((r) => keyOf(d,r) === key);
      if (oldPos >= 0 && oldPos !== pos) plan.repositioned++;
    }
    if (prune) {
      const keys = new Set(source[d].map((r) => keyOf(d,r)));
      for (const key of Object.keys(existing.entries)) if (!keys.has(key)) plan.unpublished.push({ dataset:d,key });
    }
  }
  return plan;
}
export async function seed(db, sourceArgs, { apply = false, prune = false, actor = 'seed' } = {}) {
  const source = await loadSource(sourceArgs);
  const snapshot = await (await import('./store.mjs')).readLive(db);
  const plan = planFor(snapshot, source.datasets, { prune });
  if (!apply) return { ...plan, liveSeq:snapshot.live_seq, snapshotId:snapshot.snapshot_id };
  const idem = `seed:${db.target}:${source.sourceSha}`;
  const result = await db.tx(async (c) => {
    const prior = (await c.query('select live_seq from content.submissions where idempotency_key=$1', [idem])).rows[0];
    if (prior) return { existing:true, liveSeq:Number(prior.live_seq) };
    for (const d of [...SITE_DATASETS].sort()) await c.query("select pg_advisory_xact_lock(hashtext('content:' || $1))", [d]);
    const refused = [];
    let changed = false;
    const actionRows = [];
    for (const d of SITE_DATASETS) {
      const sourceRecords = source.datasets[d];
      const wanted = new Set(sourceRecords.map((r) => keyOf(d,r)));
      for (let position = 0; position < sourceRecords.length; position++) {
        const record = sourceRecords[position], key = keyOf(d,record), sha = recordSha(record);
        await c.query('insert into content.entries(dataset,key) values($1,$2) on conflict(dataset,key) do nothing', [d,key]);
        const entry = (await c.query('select * from content.entries where dataset=$1 and key=$2 for update', [d,key])).rows[0];
        const current = entry.live_rev == null ? null : (await c.query('select payload_sha256 from content.revisions where dataset=$1 and key=$2 and rev=$3', [d,key,entry.live_rev])).rows[0];
        if (current?.payload_sha256 !== sha) {
          const newer = (await c.query("select 1 from content.revisions where dataset=$1 and key=$2 and source <> 'seed' and rev > coalesce((select max(rev) from content.revisions where dataset=$1 and key=$2 and source='seed'),0) limit 1", [d,key])).rows[0];
          if (newer) { refused.push({ dataset:d,key }); continue; }
          const rev = entry.head_rev + 1;
          await c.query("insert into content.revisions(dataset,key,rev,payload,payload_sha256,source,actor,parent_rev,published_at) values($1,$2,$3,$4::json,$5,'seed',$6,$7,now())", [d,key,rev,JSON.stringify(record),sha,actor,entry.live_rev]);
          await c.query('update content.entries set head_rev=$3,live_rev=$3,position=$4,first_published_at=coalesce(first_published_at,now()),updated_at=now() where dataset=$1 and key=$2', [d,key,rev,position]);
          actionRows.push({ dataset:d,key,fromRev:entry.live_rev,toRev:rev }); changed = true;
        }
        if (entry.position !== position) {
          changed = true;
          if (current?.payload_sha256 === sha) actionRows.push({dataset:d,key,fromRev:entry.live_rev,toRev:entry.live_rev});
        }
        await c.query('update content.entries set position=$3 where dataset=$1 and key=$2', [d,key,position]);
      }
      if (prune) {
        const live = (await c.query('select * from content.entries where dataset=$1 and live_rev is not null for update', [d])).rows;
        for (const e of live) if (!wanted.has(e.key)) {
          const nonSeed = (await c.query("select 1 from content.revisions where dataset=$1 and key=$2 and source <> 'seed' limit 1", [d,e.key])).rows[0];
          if (nonSeed) { refused.push({dataset:d,key:e.key}); continue; }
          await c.query('update content.entries set live_rev=null,position=null where dataset=$1 and key=$2', [d,e.key]);
          actionRows.push({ dataset:d,key:e.key,fromRev:e.live_rev,toRev:null }); changed = true;
        }
      } else {
        const extras = (await c.query('select key,live_rev,position from content.entries where dataset=$1 and live_rev is not null order by position nulls last,key for update', [d])).rows.filter((e) => !wanted.has(e.key));
        for (let index=0;index<extras.length;index++) {
          const e=extras[index],position=sourceRecords.length+index;
          if (e.position !== position) { changed=true; actionRows.push({dataset:d,key:e.key,fromRev:e.live_rev,toRev:e.live_rev}); }
          await c.query('update content.entries set position=$3 where dataset=$1 and key=$2',[d,e.key,position]);
        }
      }
    }
    let seenAdded = 0;
    const businessNames = new Set(source.datasets.businesses.map((b) => String(b.name).toLowerCase().replace(/[^a-z0-9]/g,'')));
    for (const s of source.datasets['discovery-seen']) seenAdded += (await c.query("insert into content.discovery_seen(name_key,first_seen,outcome) values($1,$2,$3) on conflict(name_key) do nothing", [s.nameKey,s.firstSeen,businessNames.has(s.nameKey)?'added':'seen'])).rowCount;
    changed ||= seenAdded > 0;
    const liveSeq = changed ? Number((await c.query('update content.meta set live_seq=live_seq+1 returning live_seq')).rows[0].live_seq) : Number((await c.query('select live_seq from content.meta')).rows[0].live_seq);
    const submission = (await c.query("insert into content.submissions(kind,target,actor,idempotency_key,request_sha256,state,decision,live_seq,closed_at) values('seed',$1,$2,$3,$4,'published','admin',$5,now()) returning id", [db.target,actor,idem,hash('sha256',source.sourceSha),liveSeq])).rows[0];
    for (const a of actionRows) await c.query("insert into content.actions(actor,action,dataset,key,from_rev,to_rev,submission_id,reason,live_seq) values($1,'reconcile',$2,$3,$4,$5,$6,$7,$8)", [actor,a.dataset,a.key,a.fromRev,a.toRev,submission.id,`seed:${source.sourceSha}`,liveSeq]);
    return { existing:false, liveSeq, refused };
  });
  const after = await (await import('./store.mjs')).readLive(db);
  return { ...plan, refused:result.refused ?? [], liveSeq:result.liveSeq, snapshotId:after.snapshot_id, existing:result.existing };
}
