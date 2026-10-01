// Test-only child-process seam for a synthetic roundup v2 submit. The real
// submitContent policy/DB path runs; only the v2 verifier is the contract stub
// (tests/content/fixtures/roundup-v2.mjs), so this local E2E never fetches.
import { openDb } from '../../scripts/content/db.mjs';
import { submitContent } from '../../scripts/content/submit.mjs';
import { stubApi } from '../content/fixtures/roundup-v2.mjs';

const opts = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--') || !process.argv[index + 1]) throw new Error('fixture requires valued options');
  opts[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = process.argv[++index];
}
if (opts.kind !== 'roundup') throw new Error('fixture only handles roundup');
const db = await openDb({ expectDb: process.env.CONTENT_DB_NAME });
try {
  if (db.target !== 'test') throw new Error('fixture refuses non-local test database');
  const result = await submitContent(db, opts, { checkout: process.cwd(), roundup: { api: stubApi() } });
  process.stdout.write(`${JSON.stringify(result.result)}\n`);
  process.exitCode = result.exitCode;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: error.code ?? error.name, message: error.message })}\n`);
  process.exitCode = 2;
} finally {
  await db.close();
}
