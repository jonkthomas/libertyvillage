import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALL } from '../../scripts/content/canonical.mjs';
import { seed } from '../../scripts/content/seed.mjs';
import { exportContent } from '../../scripts/content/export.mjs';
import { testDb } from './helpers/db.mjs';
const repo=path.resolve(new URL('../../',import.meta.url).pathname);
test('export writes nine canonical byte-equal datasets and no draft data',async()=>{
  const {db,close}=await testDb(); const root=await mkdtemp(path.join(tmpdir(),'lv-export-'));
  try{
    await seed(db,{from:repo},{apply:true,prune:true});
    const result=await exportContent(db,{root,publicSnapshot:true});
    assert.equal(result.files.length,9);
    for(const d of ALL){const file=`${d}.json`;assert.deepEqual(await readFile(path.join(root,'data',file)),await readFile(path.join(repo,'data',file)));assert.deepEqual(await readFile(path.join(root,'public','content-snapshot',file)),await readFile(path.join(repo,'data',file)));}
    const manifest=JSON.parse(await readFile(path.join(root,'public','content-snapshot','manifest.json')));
    assert.equal(manifest.snapshot_id,result.snapshotId);
    assert.equal(manifest.datasets.businesses.records,undefined);
    assert.deepEqual(manifest.media,[]);
  }finally{await rm(root,{recursive:true,force:true});await close();}
});
