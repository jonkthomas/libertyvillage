import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../scripts/content/db.mjs';
import pg from 'pg';
import { testDb } from './helpers/db.mjs';
import { runCli } from '../../scripts/content/cli.mjs';
import { seed } from '../../scripts/content/seed.mjs';
test('DB guard ignores generic URL and enforces expected database',async()=>{const {url,close}=await testDb();const prior=process.env.CONTENT_DATABASE_URL;const generic=process.env.DATABASE_URL;try{process.env.DATABASE_URL=url;delete process.env.CONTENT_DATABASE_URL;await assert.rejects(openDb({}),/missing CONTENT_DATABASE_URL/);process.env.CONTENT_DATABASE_URL=url;await assert.rejects(openDb({expectDb:'lv_staging'}),/database binding refused/);}finally{process.env.CONTENT_DATABASE_URL=prior;if(generic===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=generic;await close();}});

test('DB target rejects query routing overrides before constructing a pool',async()=>{
  const {name,url,close}=await testDb();
  const prior=process.env.CONTENT_DATABASE_URL;
  const OriginalPool=pg.Pool;
  try {
    const local=await openDb({expectDb:name});
    assert.equal(local.target,'test');
    await local.close();
    let pools=0;
    pg.Pool=class {constructor(){pools+=1;throw new Error('pool was constructed');}};
    for(const query of ['host=remote.example.invalid','hostaddr=203.0.113.1','port=65535','service=remote','options=-c%20search_path%3Dremote']){
      process.env.CONTENT_DATABASE_URL=`${url}?${query}`;
      await assert.rejects(openDb({expectDb:name}),(error)=>error.code==='TargetError'&&/routing override/.test(error.message));
    }
    assert.equal(pools,0);
  }finally{pg.Pool=OriginalPool;process.env.CONTENT_DATABASE_URL=prior;await close();}
});

test('DB target refuses hostless, socket, multi-host and nonlocal test routes before constructing a pool',async()=>{
  const prior=process.env.CONTENT_DATABASE_URL;
  const priorHost=process.env.PGHOST;
  const OriginalPool=pg.Pool;
  let pools=0;
  pg.Pool=class {constructor(){pools+=1;throw new Error('pool was constructed');}};
  try {
    process.env.PGHOST='remote.example.invalid';
    for(const url of [
      'postgres:///lv_test_routing',
      'postgres://probe:dummy@%2Ftmp:55434/lv_test_routing',
      'postgres://probe:dummy@remote.example.invalid/lv_test_routing',
      'postgres://probe:dummy@127.0.0.1,remote.example.invalid/lv_test_routing',
      'postgres://probe:dummy@127.0.0.1:55432',
    ]){
      process.env.CONTENT_DATABASE_URL=url;
      await assert.rejects(openDb({expectDb:'lv_test_routing'}),(error)=>error.code==='TargetError',url);
    }
    assert.equal(pools,0);
  }finally{
    pg.Pool=OriginalPool;process.env.CONTENT_DATABASE_URL=prior;
    if(priorHost===undefined)delete process.env.PGHOST;else process.env.PGHOST=priorHost;
  }
});
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
