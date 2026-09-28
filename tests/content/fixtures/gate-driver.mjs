// Child-process gate for crash tests: runs gateContent against the test DB and
// SIGKILLs itself when the phase named by CRASH_AT is reached. Every phase is
// appended to PHASE_LOG so the parent can prove what a resumed run did not redo.
import fs from 'node:fs';
import './agent-sdk-mock.mjs';

const { openDb } = await import('../../../scripts/content/db.mjs');
const { gateContent } = await import('../../../scripts/content/gate.mjs');
const { FAST_SMOKE } = await import('./content-db.mjs');

const db = await openDb({ expectDb: process.env.CONTENT_DB_NAME });
const onPhase = (phase) => {
  fs.appendFileSync(process.env.PHASE_LOG, `${process.pid} ${phase}\n`);
  if (phase === process.env.CRASH_AT) process.kill(process.pid, 'SIGKILL');
};
try {
  const { result, exitCode } = await gateContent(db, { submission: process.env.SUBMISSION, script: process.env.SCRIPT, actor: 'uat:crash' }, {
    deps: { smoke: FAST_SMOKE, onPhase }, checkout: process.env.CHECKOUT,
  });
  console.log(JSON.stringify(result));
  process.exitCode = exitCode;
} finally {
  await db.close();
}
