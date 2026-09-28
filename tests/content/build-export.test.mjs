import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildExport, expectedBuildDb } from '../../scripts/content/build-export.mjs';
import { seed } from '../../scripts/content/seed.mjs';
import { testDb } from './helpers/db.mjs';
import pg from 'pg';
test('json build writes identity only without touching DB',async()=>{const root=await mkdtemp(path.join(tmpdir(),'lv-build-'));try{const result=await buildExport({rootDir:root,env:{CONTENT_SOURCE:'json',CONTENT_DATABASE_URL:'invalid',VERCEL_URL:'example.vercel.app'}});assert.equal(result.build.content_source,'json');assert.deepEqual(await readdir(path.join(root,'public','content-snapshot')),['build.json']);}finally{await rm(root,{recursive:true,force:true});}});
test('target binding refuses unexpected build contexts',()=>{assert.throws(()=>expectedBuildDb({CONTENT_SOURCE:'db',VERCEL:'1',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature-x'}),/refused/);assert.throws(()=>expectedBuildDb({CONTENT_SOURCE:'db',VERCEL:'1',CONTENT_BUILD_TARGET:'test',VERCEL_ENV:'production'}),/forbidden/);assert.throws(()=>expectedBuildDb({CONTENT_SOURCE:'db'}),/missing/);assert.equal(expectedBuildDb({CONTENT_SOURCE:'db',VERCEL:'1',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'staging'}),'lv_staging');});
test('test DB build exports verified snapshot',async()=>{const {db,name,url,close}=await testDb();const root=await mkdtemp(path.join(tmpdir(),'lv-build-'));try{await seed(db,{from:process.cwd()},{apply:true,prune:true});const result=await buildExport({rootDir:root,env:{CONTENT_SOURCE:'db',CONTENT_BUILD_TARGET:'test',CONTENT_DATABASE_URL:url}});assert.equal(result.manifest.db,name);assert.equal(result.files.length,9);assert.equal(JSON.parse(await readFile(path.join(root,'public','content-snapshot','build.json'))).content_source,'db');}finally{await rm(root,{recursive:true,force:true});await close();}});
test('production Vercel binding refuses a staging database',async()=>{const admin=new pg.Client({connectionString:process.env.CONTENT_TEST_DATABASE_URL});await admin.connect();const root=await mkdtemp(path.join(tmpdir(),'lv-build-'));const prior=process.env.CONTENT_DATABASE_URL;try{await admin.query('create database lv_staging');const url=new URL(process.env.CONTENT_TEST_DATABASE_URL);url.pathname='/lv_staging';process.env.CONTENT_DATABASE_URL=url.href;await assert.rejects(buildExport({rootDir:root,env:{CONTENT_SOURCE:'db',VERCEL:'1',VERCEL_ENV:'production'}}),/database binding refused/);}finally{process.env.CONTENT_DATABASE_URL=prior;try{
  // Let openDb's pool close its backend before dropping this disposable DB.
  // FORCE could terminate a still-closing client and emit an unhandled 57P01.
  let active=0;
  for(let attempt=0;attempt<200;attempt++){
    active=Number((await admin.query("select count(*)::int as count from pg_stat_activity where datname='lv_staging'")).rows[0].count);
    if(active===0)break;
    await new Promise((resolve)=>setTimeout(resolve,50));
  }
  assert.equal(active,0,'staging fixture connection still active');
  await admin.query('drop database if exists lv_staging');
}finally{await admin.end();await rm(root,{recursive:true,force:true});}}});
