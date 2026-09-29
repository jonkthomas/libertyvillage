import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb, TargetError } from './db.mjs';
import * as store from './store.mjs';
import { seed } from './seed.mjs';
import { verifyParity } from './parity.mjs';
import { exportContent } from './export.mjs';
import { restoreSnapshot } from './restore-snapshot.mjs';
import { registry } from './canonical.mjs';
import * as cadence from './cadence.mjs';
const migrationsDir = path.dirname(fileURLToPath(new URL('./migrations/0001_content.sql',import.meta.url)));
function parse(argv) {
  const [command,...rest] = argv;
  if (command === 'cadence' && rest[0] && !rest[0].startsWith('--')) rest.shift();
  const opts = {};
  for (let i=0;i<rest.length;i++) {
    if (!rest[i].startsWith('--')) throw new store.ValidationError(`unexpected argument: ${rest[i]}`);
    const key = rest[i].slice(2).replace(/-([a-z])/g,(_,c) => c.toUpperCase());
    opts[key] = rest[i+1] && !rest[i+1].startsWith('--') ? rest[++i] : true;
  }
  return { command,opts };
}
const required = (value,name) => { if (!value || value === true) throw new store.ValidationError(`${name} required`); return value; };
function actorFor(opts) {
  return opts.actor ?? (process.env.GITHUB_ACTIONS === 'true' ? `gha:${process.env.GITHUB_WORKFLOW}#${process.env.GITHUB_RUN_ID}` : null);
}
async function migrate(db) {
  const exists = (await db.query("select to_regclass('content.schema_migrations') as table_name")).rows[0].table_name;
  const done = exists ? new Set((await db.query('select version from content.schema_migrations')).rows.map((r) => r.version)) : new Set();
  const applied = [];
  for (const file of (await readdir(migrationsDir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    const version = file.slice(0, 4);
    if (done.has(version)) continue;
    const sql = await readFile(path.join(migrationsDir, file),'utf8');
    await db.tx(async (c) => { await c.query(sql); await c.query("insert into content.schema_migrations(version) values($1)",[version]); });
    applied.push(version);
  }
  return {applied};
}
async function reset(db, name) {
  if (name !== db.dbName || !(name === 'lv_staging' || /^lv_test_[a-z0-9_]+$/.test(name))) throw new TargetError('reset target refused');
  const prior = (await db.query("select to_regclass('content.meta') as table_name")).rows[0].table_name;
  const liveSeq = prior ? Number((await db.query('select live_seq from content.meta')).rows[0].live_seq) : 0;
  await db.query('drop schema if exists content cascade');
  const result = await migrate(db);
  await db.query('update content.meta set live_seq=$1',[liveSeq]);
  return { ...result, liveSeq };
}
async function gcAssets(db,{apply}) {
  const candidates = await store.reclaimableAssets(db);
  if (apply) for (const a of candidates) await db.query('delete from content.assets where sha256=$1',[a.sha256]);
  return {deleted:apply ? candidates.length : 0,bytes:apply ? candidates.reduce((sum,a) => sum+a.byte_size,0) : 0};
}
export async function runCli(argv = process.argv.slice(2), { delegates = {} } = {}) {
  const {command,opts} = parse(argv);
  if (command === 'restore-snapshot') {
    console.error(JSON.stringify({target:{db:null,host:null}}));
    return { result:await restoreSnapshot({from:required(opts.from,'--from'),root:required(opts.root,'--root')}),exitCode:0 };
  }
  const mutators = new Set(['migrate','seed','submit','gate','deploy','unpublish','rollback','gc-assets','reset']);
  const cadenceMutators = new Set(['reserve','renew','release','attempt','attach','outcome','deadline','deliver-alerts']);
  if (command === 'cadence' && cadenceMutators.has(argv[1])) mutators.add('cadence');
  const expectDb = opts.expectDb ?? process.env.CONTENT_DB_NAME;
  const url = process.env[command === 'migrate' || command === 'reset' ? 'CONTENT_DATABASE_URL_UNPOOLED' : 'CONTENT_DATABASE_URL'];
  const host = url ? new URL(url).hostname : null;
  console.error(JSON.stringify({target:{db:expectDb ?? null,host}}));
  if (mutators.has(command) && !expectDb) throw new TargetError('--expect-db or CONTENT_DB_NAME required');
  const db = await openDb({unpooled:command === 'migrate' || command === 'reset',expectDb});
  try {
    const target = opts.target ?? process.env.CONTENT_TARGET ?? db.target;
    if (target !== db.target) throw new TargetError('target mismatch');
    if ((target === 'production') !== (process.env.CONTENT_SITE_URL === 'https://libertyvillage.co')) throw new TargetError('site URL target mismatch');
    let result,exitCode=0;
    switch(command) {
      case 'cadence': {
        const sub = required(argv[1], 'cadence subcommand');
        if (opts.observations) throw new store.ValidationError('cadence observations must come from hosted alias');
        const weekStart = opts.weekStart ?? cadence.weekStartUtc(new Date());
        const slotRef = { target, weekStart, lane: opts.lane, slotNumber: Number(opts.slotNumber) };
        const aliasObserver = () => cadence.createAliasObserver({ siteUrl: process.env.CONTENT_SITE_URL,
          bypass: process.env.CONTENT_SITE_BYPASS, fetchImpl: delegates.fetchImpl });
        switch (sub) {
          case 'reserve': result = await cadence.reserveSlot(db, { ...slotRef, owner: required(opts.owner, '--owner'), leaseSeconds: opts.leaseSeconds ? Number(opts.leaseSeconds) : undefined }); break;
          case 'renew': result = await cadence.renewSlot(db, slotRef, required(opts.token, '--token'), { leaseSeconds: opts.leaseSeconds ? Number(opts.leaseSeconds) : undefined }); break;
          case 'release': result = await cadence.releaseSlot(db, slotRef, required(opts.token, '--token')); break;
          case 'attempt': result = await cadence.recordAttempt(db, { slotRef, token: required(opts.token, '--token'), intentFingerprint: required(opts.intentFingerprint, '--intent-fingerprint'), topicKey: required(opts.topicKey, '--topic-key'), sourcePackDigest: required(opts.sourcePackDigest, '--source-pack-digest') }); break;
          case 'attach': result = await cadence.attachSubmission(db, { idempotencyKey: required(opts.idempotencyKey, '--idempotency-key'), token: required(opts.token, '--token'), submissionId: Number(required(opts.submissionId, '--submission-id')) }); break;
          case 'outcome': result = await cadence.recordAttemptOutcome(db, { idempotencyKey: required(opts.idempotencyKey, '--idempotency-key'), token: required(opts.token, '--token'), outcome: required(opts.outcome, '--outcome'), observe: opts.outcome === 'consumed' ? await aliasObserver() : undefined }); break;
          case 'count': result = await cadence.countCurrentWeek(db, { target, weekStart, observe: await aliasObserver() }); break;
          case 'deadline': result = await cadence.evaluateDeadline(db, { target, weekStart, now: opts.now ?? new Date(), observe: await aliasObserver() }); break;
          case 'deliver-alerts': {
            const webhook = required(process.env.SLACK_WEBHOOK_URL, 'SLACK_WEBHOOK_URL');
            result = await cadence.deliverPendingAlerts(db, { target, maxAttempts: opts.maxAttempts ? Number(opts.maxAttempts) : undefined, send: async (payload) => {
              const response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: JSON.stringify(payload) }), signal: AbortSignal.timeout(10000) });
              if (!response.ok) throw new Error('delivery-failed');
            } });
            break;
          }
          case 'status': {
            const [slots, attempts, alerts] = await Promise.all([
              db.query('select *,week_start_utc::text as week_start_utc from content.cadence_slots where target=$1 and week_start_utc=$2 order by lane,slot_number', [target, weekStart]),
              db.query('select *,week_start_utc::text as week_start_utc from content.cadence_attempts where target=$1 and week_start_utc=$2 order by lane,slot_number,ordinal', [target, weekStart]),
              db.query('select *,week_start_utc::text as week_start_utc from content.cadence_alerts where target=$1 and week_start_utc=$2 order by alert_kind', [target, weekStart]),
            ]);
            result = { slots: slots.rows.map((value) => { const slot = { ...value }; delete slot.claim_token; return slot; }), attempts: attempts.rows, alerts: alerts.rows };
            break;
          }
          default: throw new store.ValidationError(`unknown cadence subcommand: ${sub}`);
        }
        break;
      }
      case 'migrate': result=await migrate(db); break;
      case 'reset': result=await reset(db,required(opts.confirmReset,'--confirm-reset')); break;
      case 'seed': result=await seed(db,{fromRef:opts.fromRef,from:opts.from},{apply:!!opts.apply,prune:!!opts.prune,actor:required(actorFor(opts),'--actor')}); if (result.refused.length) exitCode=2; break;
      case 'verify-parity': result=await verifyParity(db,{fromRef:opts.fromRef,from:opts.from}); if (!result.match) exitCode=1; break;
      case 'export': result=await exportContent(db,{root:required(opts.root,'--root'),withAssets:!!opts.withAssets}); delete result.manifest; break;
      case 'history': { const dataset=required(opts.dataset,'--dataset'),key=required(opts.key,'--key'); result=await store.history(db,{dataset,key}); result.url=registry[dataset]?.route?.replace(':key',key)??null; break; }
      case 'show': { result=await store.getSubmission(db,Number(required(opts.submission,'--submission'))); delete result.submission.context; for (const item of result.items) item.url=registry[item.dataset]?.route?.replace(':key',item.key)??null; for (const round of result.rounds) for (const item of round.items) delete item.payload; break; }
      case 'lookup': result=await store.findSubmissionByIdempotencyKey(db,required(opts.idempotencyKey,'--idempotency-key')); break;
      case 'list': result=opts.submissions ? await store.listSubmissions(db,{state:opts.state,kind:opts.kind,target:opts.target,dataset:opts.dataset,key:opts.key,since:opts.since}) : await store.listEntries(db,{dataset:opts.dataset,visibility:opts.visibility}); break;
      case 'pending': {
        const kind = required(opts.kind,'--kind');
        const limit = opts.limit === undefined ? undefined : Number(opts.limit);
        const afterId = opts.after === undefined ? undefined : Number(opts.after);
        if (opts.limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new store.ValidationError('--limit must be a positive integer');
        if (opts.after !== undefined && (!Number.isInteger(afterId) || afterId < 1)) throw new store.ValidationError('--after must be a positive integer');
        if (limit !== undefined || afterId !== undefined) {
          // Explicit single page: the caller owns paging and knows the page may be partial.
          result = await store.listPendingByKind(db,{target,kind,...(limit !== undefined ? {limit} : {}),...(afterId !== undefined ? {afterId} : {})});
        } else {
          // Default: enumerate pages under an explicit finite cap, probing one
          // extra row for overflow so a stuck propagation lane fails closed
          // with an error instead of an unbounded list or a silent truncation.
          result = [];
          for (;;) {
            const page = await store.listPendingByKind(db,{target,kind,afterId: result.length ? result[result.length-1] : null});
            result.push(...page);
            if (page.length < store.PENDING_NEWS_PAGE) break;
            if (result.length >= store.PENDING_NEWS_BACKLOG_CAP) {
              const overflow = await store.listPendingByKind(db,{target,kind,afterId: result[result.length-1],limit:1});
              if (overflow.length) throw new store.StateError(`pending backlog exceeds ${store.PENDING_NEWS_BACKLOG_CAP} ids for kind ${kind}; propagation is stuck, investigate instead of truncating`);
              break;
            }
          }
        }
        break;
      }
      case 'stats': { result=await store.stats(db); result.warn=result.projectBytes>350*1024*1024; if (opts.alert && result.warn && process.env.SLACK_WEBHOOK_URL) await fetch(process.env.SLACK_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:`⚠ Neon content storage ${Math.round(result.projectBytes/1048576)} MB > 350 MB of 512 MB`})}); break; }
      case 'gc-assets': result=await gcAssets(db,opts); break;
      case 'submit': { const submitContent=delegates.submitContent ?? (await import('./submit.mjs')).submitContent; ({result,exitCode}=await submitContent(db,opts)); break; }
      case 'gate': { const gateContent=delegates.gateContent ?? (await import('./gate.mjs')).gateContent; ({result,exitCode}=await gateContent(db,opts)); break; }
      case 'deploy': { const deployContent=delegates.deployContent ?? (await import('./deploy.mjs')).deployContent; ({result,exitCode}=await deployContent(db,opts)); break; }
      case 'unpublish': case 'rollback': {
        const admin=await store.adminAction(db,{op:command,dataset:required(opts.dataset,'--dataset'),key:required(opts.key,'--key'),toRev:opts.toRev&&Number(opts.toRev),actor:required(actorFor(opts),'--actor'),reason:required(opts.reason,'--reason'),idempotencyKey:required(opts.idempotencyKey,'--idempotency-key'),owner:actorFor(opts)});
        const deployContent=delegates.deployContent ?? (await import('./deploy.mjs')).deployContent;
        const propagation=await deployContent(db,{...opts,submission:admin.submissionId,token:admin.token});
        const publicAdmin={...admin}; delete publicAdmin.token;
        result={...publicAdmin,...propagation.result}; exitCode=propagation.exitCode; break;
      }
      default: throw new store.ValidationError(`unknown command: ${command}`);
    }
    return {result,exitCode};
  } finally { await db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then(({result,exitCode}) => { console.log(JSON.stringify(result)); process.exitCode=exitCode; }).catch((error) => {
    console.log(JSON.stringify({error:error.code ?? 'Error',message:error.message,conflicts:error.conflicts}));
    process.exitCode=['ConflictError','ValidationError'].includes(error.code) ? 2 : 1;
  });
}
