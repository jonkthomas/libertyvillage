// Shared synchronously by the DB CLI and the synchronous ingest entry point.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parse } = require('pg-connection-string');

const ROUTING_PARAMS = new Set(['host', 'hostaddr', 'port', 'service', 'options']);
const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

function inspectContentConnection(url) {
  if (typeof url !== 'string' || !url) throw new Error('content database URL required');
  let authority;
  try { authority = new URL(url); }
  catch { throw new Error('invalid content database URL'); }
  if (!['postgres:', 'postgresql:'].includes(authority.protocol)) throw new Error('invalid content database URL protocol');
  const override = [...authority.searchParams.keys()].find((key) => ROUTING_PARAMS.has(key.toLowerCase()));
  if (override) throw new Error(`connection routing override refused: ${override}`);
  let effective;
  try { effective = parse(url); }
  catch { throw new Error('invalid content database URL'); }
  return { host: effective.host, port: effective.port, database: effective.database };
}

function isLocalTestBinding(url, dbName) {
  if (!/^lv_test_[a-z0-9_]+$/.test(dbName || '')) return false;
  const effective = inspectContentConnection(url);
  return LOOPBACK.has(effective.host) && effective.database === dbName;
}

module.exports = { inspectContentConnection, isLocalTestBinding };
