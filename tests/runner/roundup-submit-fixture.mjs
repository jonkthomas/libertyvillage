// Test-only child-process seam for a synthetic, unreachable example.org roundup
// source. The real submitContent policy/DB path runs; only the final network
// refetch is injected so this local E2E cannot accidentally contact a live site.
import { openDb } from '../../scripts/content/db.mjs';
import { submitContent } from '../../scripts/content/submit.mjs';

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
  const result = await submitContent(db, opts, {
    checkout: process.cwd(),
    roundupRefetch: async (url, source) => {
      if (!url.startsWith('https://example.org/weekly/')) throw new Error('unexpected fixture source');
      return { ...source };
    },
  });
  process.stdout.write(`${JSON.stringify(result.result)}\n`);
  process.exitCode = result.exitCode;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: error.name, message: error.message })}\n`);
  process.exitCode = 2;
} finally {
  await db.close();
}
