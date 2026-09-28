import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALL } from '../../scripts/content/canonical.mjs';
import { seed } from '../../scripts/content/seed.mjs';
import { deployContent } from '../../scripts/content/deploy.mjs';
import { adminAction, listPending, readLive, releaseClaim } from '../../scripts/content/store.mjs';
import { verifyParity } from '../../scripts/content/parity.mjs';
import { testDb } from './helpers/db.mjs';
import { FAST_SMOKE, localSite, publishDirect, seedRecords } from './fixtures/content-db.mjs';
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

test('real seed is complete for deployment recovery; one failed notice does not starve later submissions', async () => {
  const { db, close } = await testDb();
  const site = await localSite(db);
  try {
    const seeded = await seed(db, { from: repo }, { apply: true, actor: 'test:seed' });
    assert.equal(seeded.liveSeq, 1);
    await site.build();
    const firstDeploy = await deployContent(db, { actor: 'test:deploy' }, { env: site.env });
    assert.equal(firstDeploy.exitCode, 0);
    assert.deepEqual(firstDeploy.result.submissions, []);
    assert.deepEqual(await listPending(db), []);

    const original = seedRecords().businesses[0];
    const first = await publishDirect(db, { kind: 'manual', idempotencyKey: 'after-seed:first',
      items: [{ dataset: 'businesses', key: 'after-seed-first', payload: { ...original, slug: 'after-seed-first' }, expectedLiveRev: null }] });
    assert.equal(first.submissionId, 2);
    const second = await publishDirect(db, { kind: 'manual', idempotencyKey: 'after-seed:second',
      items: [{ dataset: 'businesses', key: 'after-seed-second', payload: { ...original, slug: 'after-seed-second' }, expectedLiveRev: null }] });
    await releaseClaim(db, first.submissionId, first.token);
    await releaseClaim(db, second.submissionId, second.token);
    let notices = 0;
    const fetchImpl = (url, options) => {
      if (url === site.env.SLACK_WEBHOOK_URL && ++notices === 1) return Promise.resolve(new Response('bad notice', { status: 400 }));
      return fetch(url, options);
    };
    const recovered = await deployContent(db, { actor: 'test:deploy' }, { env: site.env, deps: { fetchImpl, smoke: FAST_SMOKE } });
    assert.equal(recovered.exitCode, 1, JSON.stringify(recovered.result));
    assert.deepEqual(recovered.result.submissions.map(({ id }) => id), [first.submissionId, second.submissionId]);
    assert.deepEqual(await listPending(db), [first.submissionId]);
    assert.equal(notices, 2);
  } finally { await site.close(); await close(); }
});

test('reconcile clears an unpublished extra entry position before reusing the source range', async () => {
  const { db, close } = await testDb();
  const root = await mkdtemp(path.join(tmpdir(), 'lv-seed-position-'));
  try {
    await mkdir(path.join(root, 'data'));
    for (const dataset of ALL) await copyFile(path.join(repo, 'data', `${dataset}.json`), path.join(root, 'data', `${dataset}.json`));
    const file = path.join(root, 'data/businesses.json');
    const businesses = JSON.parse(await readFile(file));
    const extra = { ...businesses[0], slug: 'seed-position-extra', name: 'Seed position extra' };
    businesses.splice(1, 0, extra);
    await writeFile(file, JSON.stringify(businesses));
    await seed(db, { from: root }, { apply: true, actor: 'test:seed' });
    const unpublished = await adminAction(db, { op: 'unpublish', dataset: 'businesses', key: extra.slug,
      actor: 'test:admin', owner: 'test:admin', reason: 'remove extra', idempotencyKey: 'seed-position-unpublish' });
    await releaseClaim(db, unpublished.submissionId, unpublished.token);
    const replay = await seed(db, { from: repo }, { apply: true, actor: 'test:seed' });
    assert.equal(replay.refused.length, 0);
    assert.equal((await readLive(db, { datasets: ['businesses'] })).datasets.businesses.count, businesses.length - 1);
    assert.equal((await db.query('select live_rev,position from content.entries where dataset=$1 and key=$2', ['businesses', extra.slug])).rows[0].position, null);
  } finally { await rm(root, { recursive: true, force: true }); await close(); }
});
