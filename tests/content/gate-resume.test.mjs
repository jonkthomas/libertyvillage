// B3 crash/resume: a real child gate process is SIGKILLed right after each phase;
// the rerun resumes from DB state without a second recordRound or review. Only a
// crash after Slack delivery (before markPhase('notified')) repeats the #id line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from '../../scripts/content/store.mjs';
import { submitContent } from '../../scripts/content/submit.mjs';
import { baselineFile, localSite, seededDb, seedRecords, tempJson } from './fixtures/content-db.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const DRIVER = fileURLToPath(new URL('./fixtures/gate-driver.mjs', import.meta.url));
const BIZ = seedRecords().businesses[3];
const finding = { severity: 'high', path: `data/businesses.json#${BIZ.slug}`, note: 'unsupported claim' };
const FIX = { files: [{ file: 'data/businesses.json', records: [{ key: BIZ.slug, record: { ...BIZ, description: 'A neutral description.' } }] }], reason: 'remove claim' };
const SCRIPTS = {
  pass: { reviews: [{ overall: 8.5, findings: [] }] },
  repairThenPass: { reviews: [{ overall: 6.5, findings: [finding] }, { overall: 8.6, findings: [] }], fixes: [FIX] },
  unrepairable: { reviews: [{ overall: 4, findings: [{ ...finding, note: 'slug duplicates another listing' }] }] },
};

function runDriver({ handle, site, id, script, crashAt, phaseLog }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DRIVER], {
      cwd: REPO,
      env: {
        ...process.env, ...site.env, CONTENT_DATABASE_URL: handle.url, CONTENT_DB_NAME: handle.name,
        SUBMISSION: String(id), SCRIPT: script, CRASH_AT: crashAt ?? '', PHASE_LOG: phaseLog, CHECKOUT: REPO,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr, pid: child.pid }));
  });
}

const phasesOf = (log, pid) => fs.readFileSync(log, 'utf8').trim().split('\n').filter((line) => line.startsWith(`${pid} `)).map((line) => line.split(' ')[1]);

async function crashAndResume({ crashAt, script, expectExit }) {
  const handle = await seededDb();
  const site = await localSite(handle.db);
  await site.build();
  try {
    const { result } = await submitContent(handle.db, {
      kind: 'manual', idempotencyKey: `crash:${crashAt}`, actor: 'uat:crash',
      recordFile: tempJson({ ...BIZ, description: `${BIZ.description} Crash probe.` }), dataset: 'businesses', baseline: await baselineFile(handle.db),
    }, { checkout: REPO });
    const id = result.submissionId;
    const scriptFile = tempJson(SCRIPTS[script], 'script.json');
    const phaseLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-phases-')), 'phases.log');
    fs.writeFileSync(phaseLog, '');
    const killed = await runDriver({ handle, site, id, script: scriptFile, crashAt, phaseLog });
    assert.equal(killed.signal, 'SIGKILL', `${crashAt}: child must die at the phase (${killed.stderr})`);
    const roundsBefore = (await store.getSubmission(handle.db, id)).rounds.length;
    // The dead process still holds its lease: a rerun is refused until it expires.
    const blocked = await runDriver({ handle, site, id, script: scriptFile, phaseLog });
    assert.equal(blocked.code, 1);
    assert.deepEqual(JSON.parse(blocked.stdout), { submissionId: id, error: 'claimed' });
    await handle.db.query("update content.submissions set claimed_until=now()-interval '1 second' where id=$1", [id]); // lease expiry
    const resumed = await runDriver({ handle, site, id, script: scriptFile, phaseLog });
    assert.equal(resumed.code, expectExit, `${crashAt}: ${resumed.stdout} ${resumed.stderr}`);
    return { handle, site, id, killed, resumed, roundsBefore, phaseLog, result: JSON.parse(resumed.stdout) };
  } catch (error) {
    await site.close(); await handle.close();
    throw error;
  }
}

async function finish(ctx) { await ctx.site.close(); await ctx.handle.close(); }
const slackFor = (ctx) => ctx.site.state.slack.filter((text) => text.includes(`#${ctx.id}`));

test('kill after recordRound(go): resume publishes without re-reviewing or re-recording', async () => {
  const ctx = await crashAndResume({ crashAt: 'recordRound:go', script: 'pass', expectExit: 0 });
  try {
    assert.deepEqual(phasesOf(ctx.phaseLog, ctx.killed.pid), ['review:0', 'recordRound:go']);
    const resumed = phasesOf(ctx.phaseLog, ctx.resumed.pid);
    assert.ok(!resumed.some((phase) => phase.startsWith('review:') || phase.startsWith('recordRound')), resumed.join());
    assert.deepEqual(resumed.slice(0, 2), ['publishSubmission', 'hook:posted']);
    assert.equal((await store.getSubmission(ctx.handle.db, ctx.id)).rounds.length, 1);
    assert.equal(ctx.result.state, 'published');
    assert.equal(slackFor(ctx).length, 1);
  } finally { await finish(ctx); }
});

test('kill after recordRound(repair): resume runs the fixer, reviews only round 1', async () => {
  const ctx = await crashAndResume({ crashAt: 'recordRound:repair', script: 'repairThenPass', expectExit: 0 });
  try {
    const resumed = phasesOf(ctx.phaseLog, ctx.resumed.pid);
    assert.ok(!resumed.includes('review:0'));
    assert.deepEqual(resumed.slice(0, 3), ['addRepairRound', 'review:1', 'recordRound:go']);
    const { rounds, submission } = await store.getSubmission(ctx.handle.db, ctx.id);
    assert.deepEqual(rounds.map((round) => round.decision), ['repair', 'go']);
    assert.equal(submission.repairs, 1);
    assert.equal(slackFor(ctx).length, 1);
  } finally { await finish(ctx); }
});

test('kill after a terminal recordRound: resume only notifies (exit 2), no review', async () => {
  const ctx = await crashAndResume({ crashAt: 'recordRound:terminal', script: 'unrepairable', expectExit: 2 });
  try {
    const resumed = phasesOf(ctx.phaseLog, ctx.resumed.pid);
    assert.deepEqual(resumed, ['slack:delivered']);
    assert.deepEqual([ctx.result.state, ctx.result.decision, ctx.result.notified], ['blocked', 'unrepairable', true]);
    assert.ok((await store.getSubmission(ctx.handle.db, ctx.id)).submission.notified_at, 'notice recorded on a blocked submission');
    assert.equal(slackFor(ctx).length, 1);
  } finally { await finish(ctx); }
});

test('kill after addRepairRound: resume reviews round 1 without repeating round 0 or the fixer', async () => {
  const ctx = await crashAndResume({ crashAt: 'addRepairRound', script: 'repairThenPass', expectExit: 0 });
  try {
    const resumed = phasesOf(ctx.phaseLog, ctx.resumed.pid);
    assert.deepEqual(resumed.slice(0, 2), ['review:1', 'recordRound:go']);
    assert.ok(!resumed.includes('addRepairRound'));
    const history = await store.history(ctx.handle.db, { dataset: 'businesses', key: BIZ.slug });
    assert.deepEqual(history.revisions.map((rev) => rev.source), ['writer', 'manual', 'fixer'], 'exactly one fixer revision');
  } finally { await finish(ctx); }
});

test('kill after publishSubmission: resume deploys, smokes and notifies once', async () => {
  const ctx = await crashAndResume({ crashAt: 'publishSubmission', script: 'pass', expectExit: 0 });
  try {
    const resumed = phasesOf(ctx.phaseLog, ctx.resumed.pid);
    assert.deepEqual(resumed, ['hook:posted', 'slack:delivered']);
    assert.equal(ctx.site.state.hookPosts, 1);
    assert.equal(slackFor(ctx).length, 1);
  } finally { await finish(ctx); }
});

test('kill after the hook POST, before markPhase(deploy_requested): resume re-POSTs (harmless), notifies once', async () => {
  const ctx = await crashAndResume({ crashAt: 'hook:posted', script: 'pass', expectExit: 0 });
  try {
    assert.equal(ctx.site.state.hookPosts, 2);
    assert.equal(slackFor(ctx).length, 1);
    assert.ok((await store.getSubmission(ctx.handle.db, ctx.id)).submission.deploy_requested_at);
  } finally { await finish(ctx); }
});

test('kill after Slack delivery, before markPhase(notified): the only case that repeats the #id line', async () => {
  const ctx = await crashAndResume({ crashAt: 'slack:delivered', script: 'pass', expectExit: 0 });
  try {
    const lines = slackFor(ctx);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], lines[1], 'same line, same stable #id');
    assert.match(lines[0], new RegExp(`\\(#${ctx.id}, manual, 8\\.5, 0\\)$`));
    assert.equal(ctx.site.state.hookPosts, 1);
    assert.deepEqual(phasesOf(ctx.phaseLog, ctx.resumed.pid), ['slack:delivered']);
    assert.ok((await store.getSubmission(ctx.handle.db, ctx.id)).submission.notified_at);
  } finally { await finish(ctx); }
});
