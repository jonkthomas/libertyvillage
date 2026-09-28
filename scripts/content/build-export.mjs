import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb, TargetError } from './db.mjs';
import { exportContent } from './export.mjs';
const root = path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
export function buildIdentity(env = process.env) {
  return { deployment_url:env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null,
    git_sha:env.VERCEL_GIT_COMMIT_SHA ?? null, git_ref:env.VERCEL_GIT_COMMIT_REF ?? null,
    vercel_env:env.VERCEL_ENV ?? null, content_source:env.CONTENT_SOURCE === 'db' ? 'db' : 'json' };
}
export function expectedBuildDb(env = process.env) {
  if (env.CONTENT_SOURCE !== 'db') return null;
  if (env.VERCEL === '1') {
    if (env.CONTENT_BUILD_TARGET) throw new TargetError('CONTENT_BUILD_TARGET forbidden on Vercel');
    if (env.VERCEL_ENV === 'production') return 'neondb';
    if (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'staging') return 'lv_staging';
    throw new TargetError('db build target refused');
  }
  if (env.CONTENT_BUILD_TARGET === 'test') {
    const url = new URL(env.CONTENT_DATABASE_URL ?? '');
    const db = decodeURIComponent(url.pathname.slice(1));
    if (!['127.0.0.1','localhost'].includes(url.hostname) || !/^lv_test_[a-z0-9_]+$/.test(db)) throw new TargetError('test build target refused');
    return db;
  }
  throw new TargetError('db build target missing');
}
export async function buildExport({ env = process.env, rootDir = root } = {}) {
  const build = buildIdentity(env);
  const dest = path.join(rootDir,'public','content-snapshot');
  await rm(dest,{recursive:true,force:true});
  await mkdir(dest,{recursive:true});
  await writeFile(path.join(dest,'build.json'),`${JSON.stringify(build,null,2)}\n`);
  if (build.content_source !== 'db') return { build };
  const expectDb = expectedBuildDb(env);
  let last;
  for (let attempt=0;attempt<3;attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt===1 ? 2000 : 5000));
    let db;
    try {
      db = await openDb({ expectDb });
      const result = await exportContent(db,{root:rootDir,withAssets:true,publicSnapshot:true,build});
      return { build, ...result };
    } catch (error) { if (error instanceof TargetError) throw error; last = error; }
    finally { await db?.close(); }
  }
  throw last;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildExport().catch((error) => { console.error(error.message); process.exitCode=1; });
}
