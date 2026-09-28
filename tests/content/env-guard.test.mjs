import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../scripts/content/db.mjs';
import { testDb } from './helpers/db.mjs';
import { runCli } from '../../scripts/content/cli.mjs';
import { seed } from '../../scripts/content/seed.mjs';
test('DB guard ignores generic URL and enforces expected database',async()=>{const {url,close}=await testDb();const prior=process.env.CONTENT_DATABASE_URL;const generic=process.env.DATABASE_URL;try{process.env.DATABASE_URL=url;delete process.env.CONTENT_DATABASE_URL;await assert.rejects(openDb({}),/missing CONTENT_DATABASE_URL/);process.env.CONTENT_DATABASE_URL=url;await assert.rejects(openDb({expectDb:'lv_staging'}),/database binding refused/);}finally{process.env.CONTENT_DATABASE_URL=prior;if(generic===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=generic;await close();}});
test('CLI propagates delegated exit codes and holds admin claim through deployment',async()=>{const {db,name,close}=await testDb();try{
  const binding=['--expect-db',name,'--target','test'];
  for(const [command,runner,code] of [['submit','submitContent',2],['gate','gateContent',3],['deploy','deployContent',3]]){
    const response=await runCli([command,...binding],{delegates:{[runner]:async()=>({result:{command},exitCode:code})}});
    assert.deepEqual(response,{result:{command},exitCode:code});
  }
  await seed(db,{from:process.cwd()},{apply:true,prune:true});
  const key='mildreds-temple-kitchen';
  const response=await runCli(['unpublish','--dataset','businesses','--key',key,'--reason','test','--idempotency-key','admin-test','--actor','test',...binding],{
    delegates:{deployContent:async(deployDb,options)=>{
      assert.ok(options.submission);
      assert.match(options.token,/^[0-9a-f-]{36}$/);
      const stored=(await deployDb.query('select claim_token from content.submissions where id=$1',[options.submission])).rows[0].claim_token;
      assert.equal(options.token,stored);
      return {result:{smoke:'pending'},exitCode:3};
    }},
  });
  assert.equal(response.exitCode,3);
  assert.equal(response.result.smoke,'pending');
  assert.equal(Object.hasOwn(response.result,'token'),false);
}finally{await close();}});
