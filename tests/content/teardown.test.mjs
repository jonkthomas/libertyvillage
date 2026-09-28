import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { testDb } from './helpers/db.mjs';

test('test DB teardown waits for a test-owned client to disconnect before dropping', async () => {
  const handle = await testDb();
  const client = new pg.Client({ connectionString: handle.url });
  client.on('error', () => {});
  await client.connect();
  let disconnected = false;
  const delayedClose = new Promise((resolve) => setTimeout(resolve, 200)).then(async () => {
    await client.end();
    disconnected = true;
  });
  try {
    await handle.close();
    assert.equal(disconnected, true);
  } finally {
    await delayedClose.catch(() => {});
  }
});
