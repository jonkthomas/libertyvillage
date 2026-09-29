// Hosts the tests/content localSite stand-in (deploy hook, Slack, hosted alias
// manifest) in a worker thread with its own DB connection. The runner drives the
// real CLI through synchronous spawnSync, which would block an in-process server.
import { parentPort, workerData } from 'node:worker_threads';

process.env.CONTENT_DATABASE_URL = workerData.url;
const { openDb } = await import('../../scripts/content/db.mjs');
const { localSite } = await import('../content/fixtures/content-db.mjs');
const db = await openDb({ expectDb: workerData.name });
const site = await localSite(db);
await site.build();
parentPort.on('message', async (message) => {
  if (message?.type === 'state') parentPort.postMessage({ type: 'state', hookPosts: site.state.hookPosts, slack: site.state.slack.length });
  if (message?.type === 'close') {
    await site.close();
    await db.close();
    parentPort.postMessage({ type: 'closed' });
    parentPort.close();
  }
});
parentPort.postMessage({ type: 'ready', origin: site.origin });
