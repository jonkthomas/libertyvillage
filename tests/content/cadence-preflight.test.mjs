import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCli, safeCliError } from '../../scripts/content/cli.mjs';
import { testDb } from './helpers/db.mjs';

test('cadence preflight refuses a disposable 0001-only database before mutation', async () => {
  const source = process.env.CONTENT_TEST_DATABASE_URL;
  if (!source) throw new Error('CONTENT_TEST_DATABASE_URL required');
  const url = new URL(source);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('test database must be local');
  const name = `lv_test_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: source });
  await admin.connect();
  await admin.query(`create database ${name}`);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  const priorUrl = process.env.CONTENT_DATABASE_URL;
  const priorSite = process.env.CONTENT_SITE_URL;
  try {
    await client.connect();
    await client.query(await readFile(fileURLToPath(new URL('../../scripts/content/migrations/0001_content.sql', import.meta.url)), 'utf8'));
    await client.query("insert into content.schema_migrations(version) values('0001')");
    process.env.CONTENT_DATABASE_URL = url.href;
    process.env.CONTENT_SITE_URL = 'https://example.test';
    for (const args of [['preflight'], ['reserve', '--lane', 'content', '--slot-number', '1', '--owner', 'fixture'], ['count'], ['status']]) {
      await assert.rejects(runCli(['cadence', ...args, '--expect-db', name]), { code: 'CadenceSchemaError' });
    }
    const child = spawnSync(process.execPath, ['scripts/content/cli.mjs', 'cadence', 'reserve', '--lane', 'content', '--slot-number', '1', '--owner', 'fixture', '--expect-db', name],
      { cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, CONTENT_DATABASE_URL: url.href, CONTENT_SITE_URL: 'https://example.test' }, encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.deepEqual(JSON.parse(child.stdout), { error: 'CadenceSchemaError', message: 'cadence schema unavailable; apply content migrations 0002 through 0004 before installing the new runner' });
    assert.doesNotMatch(child.stdout + child.stderr, /select |relation |postgresql:\/\//i);
    assert.equal((await client.query('select count(*)::int as n from content.submissions')).rows[0].n, 0);
    assert.equal((await client.query("select to_regclass('content.cadence_slots') as table_name")).rows[0].table_name, null);
    assert.deepEqual((await runCli(['pending', '--kind', 'news', '--expect-db', name])).result, []);
  } finally {
    process.env.CONTENT_DATABASE_URL = priorUrl;
    process.env.CONTENT_SITE_URL = priorSite;
    await client.end();
    await admin.query(`drop database ${name}`);
    await admin.end();
  }
});

test('SQLSTATE envelopes are bounded and contain no database details', () => {
  for (const code of ['42P01', '3D000', '42501']) {
    const envelope = safeCliError({ code, message: 'postgres://user:secret@db/private select * from hidden' });
    assert.equal(envelope.error, code);
    assert.doesNotMatch(JSON.stringify(envelope), /secret|hidden|private|select/);
  }
});

test('complete schema passes; missing cadence table fails despite a complete ledger', async () => {
  const { db, name, close } = await testDb();
  const priorSite = process.env.CONTENT_SITE_URL;
  try {
    process.env.CONTENT_SITE_URL = 'https://example.test';
    assert.deepEqual((await runCli(['cadence', 'preflight', '--expect-db', name])).result, { ready: true });
    await db.query("delete from content.schema_migrations where version='0002'");
    await assert.rejects(runCli(['cadence', 'preflight', '--expect-db', name]), { code: 'CadenceSchemaError' });
    await db.query("insert into content.schema_migrations(version) values('0002')");
    await db.query("delete from content.schema_migrations where version='0004'");
    await assert.rejects(runCli(['cadence', 'preflight', '--expect-db', name]), { code: 'CadenceSchemaError' });
    await db.query("insert into content.schema_migrations(version) values('0004')");
    await db.query('drop table content.cadence_alerts');
    await assert.rejects(runCli(['cadence', 'preflight', '--expect-db', name]), { code: 'CadenceSchemaError' });
    await db.query('drop table content.schema_migrations');
    await assert.rejects(runCli(['cadence', 'preflight', '--expect-db', name]), { code: 'CadenceSchemaError' });
  } finally {
    process.env.CONTENT_SITE_URL = priorSite;
    await close();
  }
});
