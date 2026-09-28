import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../scripts/content/db.mjs';
import { testDb } from './helpers/db.mjs';
test('DB guard ignores generic URL and enforces expected database',async()=>{const {url,close}=await testDb();const prior=process.env.CONTENT_DATABASE_URL;const generic=process.env.DATABASE_URL;try{process.env.DATABASE_URL=url;delete process.env.CONTENT_DATABASE_URL;await assert.rejects(openDb({}),/missing CONTENT_DATABASE_URL/);process.env.CONTENT_DATABASE_URL=url;await assert.rejects(openDb({expectDb:'lv_staging'}),/database binding refused/);}finally{process.env.CONTENT_DATABASE_URL=prior;if(generic===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=generic;await close();}});
