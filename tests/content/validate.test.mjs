import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALL, fromFile, keyOf } from '../../scripts/content/canonical.mjs';
import { SECRET_FINGERPRINT,validateRecord } from '../../scripts/content/validate.mjs';
import { createSubmission } from '../../scripts/content/store.mjs';
import { testDb } from './helpers/db.mjs';
test('all source records validate; unknown fields and credentials fail',async()=>{for(const d of ALL){if(d==='discovery-seen')continue;const records=fromFile(d,JSON.parse(await readFile(new URL(`../../data/${d}.json`,import.meta.url))));for(const r of records)assert.deepEqual(validateRecord(d,keyOf(d,r),r).errors,[],`${d}/${keyOf(d,r)}`);}const r=fromFile('businesses',JSON.parse(await readFile(new URL('../../data/businesses.json',import.meta.url))))[0];assert.equal(validateRecord('businesses',r.slug,{...r,unexpected:true}).ok,false);assert.equal(validateRecord('businesses',r.slug,{...r,description:'ghp_12345678901234567890'}).ok,false);});
test('credential fingerprint is byte-equivalent to pi-session source',async()=>{const source=await readFile(new URL('../../scripts/supervisor/pi-session.mjs',import.meta.url),'utf8');const match=source.match(/const SECRET_FINGERPRINT = (\/.*?\/[a-z]*);/);assert.ok(match);assert.equal(SECRET_FINGERPRINT.toString(),match[1]);});
test('nested shapes and enums are checked on storage writes',async()=>{const post=fromFile('posts',JSON.parse(await readFile(new URL('../../data/posts.json',import.meta.url))))[0];assert.equal(validateRecord('posts',post.slug,{...post,faqs:[{question:'valid',answer:4}]}).ok,false);assert.equal(validateRecord('posts',post.slug,{...post,category:'unknown'}).ok,false);const business=fromFile('businesses',JSON.parse(await readFile(new URL('../../data/businesses.json',import.meta.url))))[0];assert.equal(validateRecord('businesses',business.slug,{...business,rating:'five'}).ok,false);});

test('lone surrogates at any depth and blank smoke markers are refused before persistence',async()=>{
  const business=fromFile('businesses',JSON.parse(await readFile(new URL('../../data/businesses.json',import.meta.url))))[0];
  const post=fromFile('posts',JSON.parse(await readFile(new URL('../../data/posts.json',import.meta.url))))[0];
  for(const record of [
    {...business,name:''}, {...business,name:' \t '},
    {...business,description:'bad \udc00 glyph'},
    {...post,title:'  '}, {...post,faqs:[{question:'valid?',answer:'bad \ud800 glyph'}]},
  ]) {
    const dataset='faqs' in record?'posts':'businesses';
    const key=record.slug;
    assert.equal(validateRecord(dataset,key,record).ok,false,JSON.stringify(record));
  }
  const {db,close}=await testDb();
  try {
    await assert.rejects(createSubmission(db,{kind:'manual',target:'test',actor:'test',idempotencyKey:'bad-marker',
      items:[{dataset:'businesses',key:business.slug,payload:{...business,name:'  '},expectedLiveRev:null}]}),/smoke marker/);
    assert.equal((await db.query('select count(*)::int as count from content.submissions')).rows[0].count,0);
  }finally{await close();}
});
