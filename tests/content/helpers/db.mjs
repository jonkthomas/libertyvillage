import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../../scripts/content/db.mjs';
const migration = fileURLToPath(new URL('../../../scripts/content/migrations/0001_content.sql', import.meta.url));
export async function testDb() {
  const source = process.env.CONTENT_TEST_DATABASE_URL;
  if (!source) throw new Error('CONTENT_TEST_DATABASE_URL required');
  const url = new URL(source);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('test database must be local');
  const name = `lv_test_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: source });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const prior = process.env.CONTENT_DATABASE_URL;
  url.pathname = `/${name}`;
  process.env.CONTENT_DATABASE_URL = url.href;
  const db = await openDb({ expectDb: name });
  await db.query(await readFile(migration, 'utf8'));
  await db.query("insert into content.schema_migrations(version) values('0001')");
  return { db, name, url: url.href, close: async () => { await db.close(); process.env.CONTENT_DATABASE_URL = prior; await admin.query(`drop database ${name} with (force)`); await admin.end(); } };
}
