import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb, TargetError } from './db.mjs';
import * as store from './store.mjs';
import { seed } from './seed.mjs';
import { verifyParity } from './parity.mjs';
import { exportContent } from './export.mjs';
import { restoreSnapshot } from './restore-snapshot.mjs';
import { registry } from './canonical.mjs';
const migrationPath = fileURLToPath(new URL('./migrations/0001_content.sql',import.meta.url));
function parse(argv) {
  const [command,...rest] = argv;
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
  if (exists && (await db.query("select 1 from content.schema_migrations where version='0001'")).rowCount) return {applied:[]};
  const sql = await readFile(migrationPath,'utf8');
  await db.tx(async (c) => { await c.query(sql); await c.query("insert into content.schema_migrations(version) values('0001')"); });
  return {applied:['0001']};
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
      case 'migrate': result=await migrate(db); break;
      case 'reset': result=await reset(db,required(opts.confirmReset,'--confirm-reset')); break;
      case 'seed': result=await seed(db,{fromRef:opts.fromRef,from:opts.from},{apply:!!opts.apply,prune:!!opts.prune,actor:required(actorFor(opts),'--actor')}); if (result.refused.length) exitCode=2; break;
      case 'verify-parity': result=await verifyParity(db,{fromRef:opts.fromRef,from:opts.from}); if (!result.match) exitCode=1; break;
      case 'export': result=await exportContent(db,{root:required(opts.root,'--root'),withAssets:!!opts.withAssets}); delete result.manifest; break;
      case 'history': { const dataset=required(opts.dataset,'--dataset'),key=required(opts.key,'--key'); result=await store.history(db,{dataset,key}); result.url=registry[dataset]?.route?.replace(':key',key)??null; break; }
      case 'show': { result=await store.getSubmission(db,Number(required(opts.submission,'--submission'))); delete result.submission.context; for (const item of result.items) item.url=registry[item.dataset]?.route?.replace(':key',item.key)??null; for (const round of result.rounds) for (const item of round.items) delete item.payload; break; }
      case 'lookup': result=await store.findSubmissionByIdempotencyKey(db,required(opts.idempotencyKey,'--idempotency-key')); break;
      case 'list': result=opts.submissions ? await store.listSubmissions(db,{state:opts.state,kind:opts.kind,target:opts.target,dataset:opts.dataset,key:opts.key,since:opts.since}) : await store.listEntries(db,{dataset:opts.dataset,visibility:opts.visibility}); break;
      case 'pending': result=await store.listPendingByKind(db,{target,kind:required(opts.kind,'--kind')}); break;
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
