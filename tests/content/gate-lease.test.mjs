// #182: the gate's 900 s claim must survive review and fixer calls slower than the
// lease. withHeartbeat is exercised DB-free; the gate scenarios run against the real
// store (lv_test_*), where "time passing" is simulated by aging claimed_until.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { queueAgent } from './fixtures/agent-sdk-mock.mjs';
import { GATE_MODEL } from '../../scripts/automation/constants.mjs';
import { buildRecordRepairPlan } from '../../scripts/automation/record-repair.mjs';
import * as store from '../../scripts/content/store.mjs';
import { submitContent } from '../../scripts/content/submit.mjs';
import { baselineFile, FAST_SMOKE, localSite, seededDb, seedRecords, tempJson } from './fixtures/content-db.mjs';

// gate.mjs reaches review-agent -> the agent SDK: import after the SDK mock.
const { gateContent, HEARTBEAT_MS, isLeaseFailure, withHeartbeat } = await import('../../scripts/content/gate.mjs');
const { planRecordRepair } = await import('../../scripts/automation/review-agent.mjs');

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

// ---------------------------------------------------------------------------
// withHeartbeat (no DB)
// ---------------------------------------------------------------------------

test('heartbeat default interval stays well inside the unchanged 900 s lease', () => {
  assert.ok(HEARTBEAT_MS > 0 && HEARTBEAT_MS * 2 < 900_000);
});

test('heartbeat renews serially while work is pending, even when a renewal outlasts the interval', async () => {
  let active = 0;
  let maxActive = 0;
  let renewals = 0;
  const renew = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(15); // three intervals: a setInterval would overlap here
    renewals += 1;
    active -= 1;
  };
  const value = await withHeartbeat(async () => { await delay(120); return 'verdict'; }, { renew, intervalMs: 5 });
  assert.equal(value, 'verdict');
  assert.equal(maxActive, 1, 'renewals never overlap');
  assert.ok(renewals >= 3, `renewed ${renewals} times`);
  assert.equal(active, 0, 'returned only after the in-flight renewal drained');
  const settled = renewals;
  await delay(60);
  assert.equal(renewals, settled, 'no renewal after return');
});

test('heartbeat drains an in-flight renewal before returning the work result', async () => {
  const gate = deferred();
  let renewalDone = false;
  const renew = async () => { await gate.promise; renewalDone = true; };
  let returned = false;
  const run = withHeartbeat(async () => { await delay(20); return 1; }, { renew, intervalMs: 5 }).then((v) => { returned = true; return v; });
  await delay(50);
  assert.equal(returned, false, 'work finished but the pending renewal holds the return');
  gate.resolve();
  assert.equal(await run, 1);
  assert.equal(renewalDone, true);
});

test('heartbeat does not renew for work that finishes inside one interval', async () => {
  let renewals = 0;
  assert.equal(await withHeartbeat(async () => 'fast', { renew: async () => { renewals += 1; }, intervalMs: 1_000 }), 'fast');
  assert.equal(renewals, 0);
});

test('a failed renewal rejects at once, is marked, and wins over the work outcome', async () => {
  const lost = new store.ClaimError();
  const work = deferred();
  const started = Date.now();
  await assert.rejects(withHeartbeat(() => work.promise, { renew: async () => { throw lost; }, intervalMs: 5 }), (error) => error === lost);
  assert.ok(Date.now() - started < 1_000, 'did not wait for the still-pending work');
  assert.equal(isLeaseFailure(lost), true);
  work.resolve('late');

  const network = Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });
  await assert.rejects(withHeartbeat(async () => { await delay(30); throw new Error('fixer boom'); }, {
    renew: async () => { throw network; }, intervalMs: 5,
  }), (error) => error === network && isLeaseFailure(error));

  // A non-object rejection still surfaces as a marked Error.
  await assert.rejects(withHeartbeat(() => delay(50), { renew: () => Promise.reject(undefined), intervalMs: 5 }),
    (error) => error instanceof Error && isLeaseFailure(error));
});

test('work errors pass through unmarked when renewals succeed', async () => {
  const boom = new Error('invalid repair plan');
  await assert.rejects(withHeartbeat(async () => { await delay(20); throw boom; }, { renew: async () => {}, intervalMs: 5 }), (error) => error === boom);
  assert.equal(isLeaseFailure(boom), false);
  assert.equal(isLeaseFailure(undefined), false);
});

// ---------------------------------------------------------------------------
// planRecordRepair diagnostics stay off stdout (the CLI's JSON envelope)
// ---------------------------------------------------------------------------

test('rejected fixer attempts log only a bounded count on stderr, never validator text on stdout', async () => {
  const secret = 'PRIVATE-candidate-bytes-9f2c';
  const badPlan = { files: [{ file: 'data/posts.json', records: [{ slug: 'p', record: { slug: 'p' } }] }], reason: 'r' };
  queueAgent(badPlan, badPlan, badPlan, badPlan);
  const out = [];
  const err = [];
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  const originalLog = console.log;
  // stdout also carries the test runner's own reporting: observe it, pass it through.
  process.stdout.write = function write(chunk, ...rest) { out.push(String(chunk)); return stdoutWrite.call(this, chunk, ...rest); };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  console.log = (...args) => { out.push(args.join(' ')); };
  let rejection;
  try {
    await planRecordRepair({
      kind: 'news', gateVerdict: {}, payload: [{ file: 'data/posts.json', records: [{ slug: 'p' }] }],
      validate: () => ({ ok: false, errors: [`data/posts.json: p: ${secret}`, 'second'] }),
    }).catch((error) => { rejection = error; });
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    console.log = originalLog;
  }
  assert.match(rejection?.message ?? '', /^invalid repair plan: /);
  const leaked = out.filter((chunk) => chunk.includes('Repair plan') || chunk.includes(secret) || chunk.includes('second'));
  assert.deepEqual(leaked, [], 'no fixer diagnostic on stdout');
  const attempts = err.filter((line) => line.startsWith('Repair plan attempt '));
  assert.equal(attempts.length, 4);
  for (const line of attempts) assert.match(line, /^Repair plan attempt \d rejected: 2 validation error\(s\)\n$/);
  assert.equal(err.join('').includes(secret), false, 'validator text stays private');
});

// ---------------------------------------------------------------------------
// gateContent against the real store
// ---------------------------------------------------------------------------

const BIZ = seedRecords().businesses[1];
const HIGH = (slug) => ({ severity: 'high', path: `data/businesses.json#${slug}`, note: 'unsupported award claim' });
const HEARTBEAT = 10;

async function withSite(fn) {
  const handle = await seededDb();
  const site = await localSite(handle.db);
  await site.build();
  try { return await fn(handle.db, site); } finally { await site.close(); await handle.close(); }
}

async function submitEdit(db, record, key) {
  const { result } = await submitContent(db, {
    kind: 'manual', idempotencyKey: `${key}:${Math.random()}`, actor: 'uat:test', recordFile: tempJson(record), dataset: 'businesses', baseline: await baselineFile(db),
  }, { checkout: REPO });
  return result.submissionId;
}

const claimOf = async (db, id) => (await db.query('select claim_token, claimed_until, claimed_until > now() + interval \'14 minutes 50 seconds\' as fresh from content.submissions where id=$1', [id])).rows[0];
// Five minutes of wall clock, as the lease sees it.
const ageFiveMinutes = (db, id) => db.query("update content.submissions set claimed_until = claimed_until - interval '5 minutes' where id=$1", [id]);

// A model call that spans 20 simulated minutes (> the 900 s lease): four 5-minute
// agings, each followed by waiting until the heartbeat has renewed the lease.
async function slowCall(db, id) {
  const token = (await claimOf(db, id)).claim_token;
  for (let i = 0; i < 4; i += 1) {
    await ageFiveMinutes(db, id);
    const deadline = Date.now() + 5_000;
    for (;;) {
      const claim = await claimOf(db, id);
      assert.equal(claim.claim_token, token, 'the same token is renewed');
      if (claim.fresh) break;
      if (Date.now() > deadline) throw new Error('heartbeat did not renew the lease');
      await delay(HEARTBEAT);
    }
  }
  return token;
}

function spyRenew() {
  const spy = { calls: 0, active: 0, maxActive: 0, tokens: new Set() };
  spy.renewClaim = async (db, id, token) => {
    spy.calls += 1;
    spy.active += 1;
    spy.maxActive = Math.max(spy.maxActive, spy.active);
    spy.tokens.add(token);
    try {
      await delay(HEARTBEAT * 2); // outlasts the interval: renewals must still be serial
      return await store.renewClaim(db, id, token);
    } finally { spy.active -= 1; }
  };
  return spy;
}

const gate = (db, site, id, deps) => gateContent(db, { submission: id, actor: 'uat:test' }, {
  env: site.env, deps: { smoke: FAST_SMOKE, heartbeatMs: HEARTBEAT, ...deps }, checkout: REPO,
});
const pass = (contentSha) => ({ overall: 8.6, findings: [], model: GATE_MODEL, commit_sha: contentSha });

test('control: a 20-minute review with no renewal loses the lease at recordRound', async () => {
  await withSite(async (db, site) => {
    const id = await submitEdit(db, { ...BIZ, description: `${BIZ.description} Open late.` }, 'lease-control');
    await assert.rejects(gate(db, site, id, {
      heartbeatMs: 3_600_000,
      review: async ({ contentSha }) => { for (let i = 0; i < 4; i += 1) await ageFiveMinutes(db, id); return pass(contentSha); },
    }), (error) => error instanceof store.ClaimError);
    assert.deepEqual((await store.getSubmission(db, id)).rounds.map((round) => round.decision), [null]);
  });
});

test('a review slower than the lease keeps the claim and publishes; renewals stop before release', async () => {
  await withSite(async (db, site) => {
    const id = await submitEdit(db, { ...BIZ, description: `${BIZ.description} Open late.` }, 'lease-slow-review');
    const spy = spyRenew();
    let reviewToken;
    const out = await gate(db, site, id, {
      renewClaim: spy.renewClaim,
      review: async ({ contentSha }) => { reviewToken = await slowCall(db, id); return pass(contentSha); },
    });
    assert.equal(out.exitCode, 0, JSON.stringify(out.result));
    assert.equal(out.result.state, 'published');
    assert.ok(spy.calls >= 4, `renewed ${spy.calls} times`);
    assert.equal(spy.maxActive, 1, 'renewals are serial');
    assert.deepEqual([...spy.tokens], [reviewToken], 'only the held token is renewed');
    assert.equal(spy.active, 0);
    const { submission } = await store.getSubmission(db, id);
    assert.equal(submission.claim_token, null, 'claim released');
    const settled = spy.calls;
    await delay(HEARTBEAT * 6);
    assert.equal(spy.calls, settled, 'no renewal after the gate returned');
  });
});

test('a fixer slower than the lease keeps the claim; the repair lands and publishes', async () => {
  await withSite(async (db, site) => {
    const fabricated = { ...BIZ, description: `${BIZ.description} Voted best tacos in Canada.` };
    const id = await submitEdit(db, fabricated, 'lease-slow-fixer');
    const spy = spyRenew();
    let reviews = 0;
    let fixes = 0;
    const out = await gate(db, site, id, {
      renewClaim: spy.renewClaim,
      review: async ({ contentSha }) => (reviews++ === 0
        ? { overall: 6.5, findings: [HIGH(BIZ.slug)], model: GATE_MODEL, commit_sha: contentSha }
        : pass(contentSha)),
      fix: async ({ validate }) => {
        fixes += 1;
        await slowCall(db, id);
        const check = validate(buildRecordRepairPlan({ files: [{ file: 'data/businesses.json', records: [{ key: BIZ.slug, record: { ...fabricated, description: BIZ.description } }] }], reason: 'remove claim' }));
        assert.equal(check.ok, true, check.errors?.join('; '));
        return { check };
      },
    });
    assert.equal(out.exitCode, 0, JSON.stringify(out.result));
    assert.deepEqual([out.result.state, out.result.repairs, fixes], ['published', 1, 1]);
    assert.equal(spy.maxActive, 1);
    assert.equal(spy.tokens.size, 1);
    assert.deepEqual((await store.getSubmission(db, id)).rounds.map((round) => round.decision), ['repair', 'go']);
  });
});

test('a lease taken over during a slow review ends the gate with ClaimError before any round is written', async () => {
  await withSite(async (db, site) => {
    const id = await submitEdit(db, { ...BIZ, description: `${BIZ.description} Open late.` }, 'lease-review-lost');
    const review = deferred();
    let reviewStarted = false;
    const run = gate(db, site, id, {
      review: async () => {
        reviewStarted = true;
        await db.query("update content.submissions set claim_token='00000000-0000-4000-8000-000000000000' where id=$1", [id]);
        return review.promise;
      },
    });
    await assert.rejects(run, (error) => error instanceof store.ClaimError);
    assert.equal(reviewStarted, true);
    const state = await store.getSubmission(db, id);
    assert.deepEqual(state.rounds.map((round) => round.decision), [null], 'no verdict persisted under a lost lease');
    assert.equal(state.submission.claim_token, '00000000-0000-4000-8000-000000000000', 'the new owner keeps the claim');
    assert.equal(site.state.slack.length, 0, 'lease loss sends no gate-error notice');
    review.resolve(pass('x'));
  });
});

test('a lease lost during a slow fixer escapes the fixer catch: no retry, no error close', async () => {
  await withSite(async (db, site) => {
    const fabricated = { ...BIZ, description: `${BIZ.description} Voted best tacos in Canada.` };
    const id = await submitEdit(db, fabricated, 'lease-fixer-lost');
    const fixer = deferred();
    let fixes = 0;
    const run = gate(db, site, id, {
      review: async ({ contentSha }) => ({ overall: 6.5, findings: [HIGH(BIZ.slug)], model: GATE_MODEL, commit_sha: contentSha }),
      fix: async () => {
        fixes += 1;
        // Expire the lease (simulated 16 minutes), then the fixer fails as well.
        await db.query("update content.submissions set claimed_until = now() - interval '1 minute' where id=$1", [id]);
        return fixer.promise;
      },
    });
    await assert.rejects(run, (error) => error instanceof store.ClaimError);
    fixer.reject(new Error('invalid repair plan: late'));
    assert.equal(fixes, 1, 'the fixer is not retried under a lost lease');
    const { submission, rounds } = await store.getSubmission(db, id);
    assert.equal(submission.state, 'gating', 'not closed as a fixer error');
    assert.equal(submission.repairs, 0);
    assert.deepEqual(rounds.map((round) => round.decision), ['repair']);
  });
});

test('a network error from the heartbeat wins over the fixer failure and releases the claim', async () => {
  await withSite(async (db, site) => {
    const fabricated = { ...BIZ, description: `${BIZ.description} Voted best tacos in Canada.` };
    const id = await submitEdit(db, fabricated, 'lease-fixer-network');
    let renewals = 0;
    let fixes = 0;
    const renewed = deferred();
    const network = Object.assign(new Error('connect ECONNRESET 127.0.0.1:5432'), { code: 'ECONNRESET' });
    const run = gate(db, site, id, {
      renewClaim: async () => { renewals += 1; renewed.resolve(); throw network; },
      review: async ({ contentSha }) => ({ overall: 6.5, findings: [HIGH(BIZ.slug)], model: GATE_MODEL, commit_sha: contentSha }),
      fix: async () => { fixes += 1; await renewed.promise; await delay(HEARTBEAT); throw new Error('invalid repair plan: rejected'); },
    });
    await assert.rejects(run, (error) => error === network);
    assert.equal(renewals, 1, 'no renewal after the failure');
    assert.equal(fixes, 1, 'the fixer failure was not counted and retried');
    const { submission } = await store.getSubmission(db, id);
    assert.equal(submission.state, 'gating', 'not closed as a fixer error');
    assert.equal(submission.claim_token, null, 'the still-valid claim is released for a retry');
    assert.equal(site.state.slack.length, 1);
    assert.match(site.state.slack[0], new RegExp(`#${id} gate error: operational-error — rerun: content gate --submission ${id}`));
  });
});
