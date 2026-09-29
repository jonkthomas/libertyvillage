import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from '../../../scripts/content/db.mjs';
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/content/migrations');
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
  const files = (await readdir(migrationsDir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const versions = [];
  for (const file of files) {
    await db.query(await readFile(path.join(migrationsDir, file), 'utf8'));
    versions.push(file.slice(0, 4));
  }
  await db.query('insert into content.schema_migrations(version) select v from unnest($1::text[]) v', [versions]);
  return { db, name, url: url.href, close: async () => {
    try {
      await db.close();
      process.env.CONTENT_DATABASE_URL = prior;
      // CLI/child clients may still be closing. Never force-drop their database:
      // that sends 57P01 into a test still finishing an assertion.
      let active = 0;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        active = Number((await admin.query('select count(*)::int as count from pg_stat_activity where datname=$1', [name])).rows[0].count);
        if (active === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (active !== 0) throw new Error(`test database ${name} still has ${active} client(s)`);
      await admin.query(`drop database ${name}`);
    } finally { await admin.end(); }
  } };
}
