import pg from 'pg';
import connectionConfig from './connection-config.cjs';

export class TargetError extends Error { constructor(message) { super(message); this.code = 'TargetError'; } }
const DB_VARS = ['CONTENT_DATABASE_URL', 'CONTENT_DATABASE_URL_UNPOOLED'];
export async function openDb({ unpooled = false, expectDb } = {}) {
  const url = process.env[DB_VARS[Number(unpooled)]];
  if (!url) throw new TargetError(`missing ${DB_VARS[Number(unpooled)]}`);
  let effective;
  try { effective = connectionConfig.inspectContentConnection(url); }
  catch (error) { throw new TargetError(error.message); }
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10000, statement_timeout: 30000, max: 10 });
  let dbName;
  try { dbName = (await pool.query('select current_database() as name')).rows[0].name; }
  catch (error) { await pool.end(); throw error; }
  const target = dbName === 'neondb' ? 'production' : dbName === 'lv_staging' ? 'staging'
    : /^lv_test_[a-z0-9_]+$/.test(dbName) && ['127.0.0.1', 'localhost'].includes(effective.host) ? 'test' : null;
  if (!target || (expectDb && expectDb !== dbName)) { await pool.end(); throw new TargetError(`database binding refused: ${dbName}`); }
  return {
    dbName, target,
    query: (sql, params) => pool.query(sql, params),
    tx: async (fn, { isolation } = {}) => {
      const client = await pool.connect();
      try {
        await client.query(`begin${isolation ? ` isolation level ${isolation}` : ''}`);
        const result = await fn(client);
        await client.query('commit'); return result;
      } catch (error) { await client.query('rollback'); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
