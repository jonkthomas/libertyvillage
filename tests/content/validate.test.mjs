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

test('roundupCoverage is allowed (never required) only on a weekly roundup news post, well-formed and at most 64 keys', async () => {
  const { validateRecord: validate } = await import('../../scripts/content/validate.mjs');
  const base = JSON.parse(await readFile(new URL('../../data/posts.json', import.meta.url), 'utf8'))[0];
  const slug = 'liberty-village-news-week-2026-w40';
  const coverage = { version: 1, isoWeek: '2026-W40', planningCutoff: '2026-09-30T12:00:00.000Z', keys: ['road:Tor-1', 'occ:addr:40-hanna-ave:2026-10-03:15:00'] };
  const roundup = { ...base, slug, category: 'news', roundupCoverage: coverage };
  assert.deepEqual(validate('posts', slug, roundup).errors, []);
  const withoutField = { ...roundup };
  delete withoutField.roundupCoverage;
  assert.deepEqual(validate('posts', slug, withoutField).errors, [], 'allowed, not required');
  const errs = (record, key = slug) => validate('posts', key, record).errors.join('; ');
  assert.match(errs({ ...roundup, slug: 'daily-news', roundupCoverage: coverage }, 'daily-news'), /only valid on a weekly roundup news post/);
  assert.match(errs({ ...roundup, category: 'events' }), /only valid on a weekly roundup news post/);
  assert.match(errs({ ...roundup, roundupCoverage: { ...coverage, version: 2 } }), /version must be 1/);
  assert.match(errs({ ...roundup, roundupCoverage: { ...coverage, isoWeek: '2026-W41' } }), /isoWeek must match the slug/);
  assert.match(errs({ ...roundup, roundupCoverage: { ...coverage, planningCutoff: '2026-09-30' } }), /planningCutoff must be an ISO instant/);
  assert.match(errs({ ...roundup, roundupCoverage: { ...coverage, keys: ['x'.repeat(201)] } }), /at most 200 chars/);
  assert.match(errs({ ...roundup, roundupCoverage: { ...coverage, keys: Array.from({ length: 65 }, (_, n) => `k${n}`) } }), /more than 64 keys/);
  assert.match(errs({ ...roundup, roundupCoverage: { ...coverage, extra: true } }), /invalid roundupCoverage/);
  assert.equal(validate('posts', slug, { ...roundup, roundupCoverage: { ...coverage, keys: Array.from({ length: 64 }, (_, n) => `k${n}`) } }).ok, true);
});
