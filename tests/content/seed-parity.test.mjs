import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALL } from '../../scripts/content/canonical.mjs';
import { seed } from '../../scripts/content/seed.mjs';
import { verifyParity } from '../../scripts/content/parity.mjs';
import { testDb } from './helpers/db.mjs';
const repo = path.resolve(new URL('../../',import.meta.url).pathname);
test('all nine seed, idempotency, reorder/update/prune, parity detects mutation', async () => {
  const {db,close}=await testDb();
  const root=await mkdtemp(path.join(tmpdir(),'lv-seed-'));
  try {
    await mkdir(path.join(root,'data'));
    for(const d of ALL) await copyFile(path.join(repo,'data',`${d}.json`),path.join(root,'data',`${d}.json`));
    const initial=await seed(db,{from:root},{apply:true,prune:true});
    assert.equal(initial.refused.length,0);
    assert.equal((await verifyParity(db,{from:root})).match,true);
    assert.equal((await seed(db,{from:root},{apply:true,prune:true})).existing,true);
    const file=path.join(root,'data','businesses.json');
    const businesses=JSON.parse(await readFile(file));
    businesses[1].description+=' Updated for seed parity.';
    businesses.splice(0,1); businesses.reverse();
    await writeFile(file,`${JSON.stringify(businesses,null,2)}\n`);
    const changed=await seed(db,{from:root},{apply:true,prune:true});
    assert.ok(changed.updated>=1); assert.equal(changed.unpublished.length,1);
    assert.equal((await verifyParity(db,{from:root})).match,true);
    businesses[0].description+=' one byte';
    await writeFile(file,`${JSON.stringify(businesses,null,2)}\n`);
    assert.equal((await verifyParity(db,{from:root})).match,false);
  } finally {await rm(root,{recursive:true,force:true});await close();}
});
