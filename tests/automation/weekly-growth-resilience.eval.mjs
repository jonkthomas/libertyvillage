#!/usr/bin/env node
// =============================================================================
// EVALUATOR-OWNED LOCKED JOURNEY EVAL — weekly growth PostHog retry + GSC aggregate.
//
// Authored by the independent eval/spec author. The builder MUST NOT edit,
// weaken, delete, re-scope, or skip any assertion in this file. Any change to
// this file by the builder is an automatic FAIL. Maker != checker.
//
// Lock: evals/weekly-growth-resilience.sha256
//
// Run (offline, deterministic, no secrets, no network, no real sleeps):
//   node --import tsx --test tests/automation/weekly-growth-resilience.eval.mjs
//
// Builder contract (scripts/generate-weekly-growth-report.mjs):
//   Binding: MAX_ATTEMPTS=3, BASE_DELAY_MS=1000, MAX_DELAY_MS=8000,
//   fresh AbortSignal.timeout(30000) per attempt. Retry transport/timeout
//   plus 408/429/5xx. Permanent: other HTTP, invalid JSON, schema. Parse
//   the body outside the retry loop.
//   E1  503 → timeout → success uses exactly 3 PostHog calls.
//       collectPosthogTop(token, window, { sleep }) MUST honor the injected
//       no-wait sleeper between attempts (default sleep is production-only).
//       Exact sleeps [1000, 2000]. 500/599 and generic transport retry.
//   E2  3xx/400/401/403/404 and invalid JSON/results: exactly 1 call, never retry.
//   E3  three retryable failures: exactly 3 calls, posthog_request_failed.
//       Honor Retry-After (delta-seconds and HTTP-date) but cap delay at
//       POSTHOG_MAX_RETRY_AFTER_MS. Exhaustion sleeps [8000, 2000].
//   E4  collectGscWeek requires exactly one aggregate row. Empty/missing rows
//       are gsc_schema_error. An explicit all-zero row succeeds.
//   E5  finalized Sunday windows, schema, sanitized paths, and CLI fixture
//       output/fail-closed behavior must keep working.
//
// Tests tagged [RED] fail on current SHA until production retry/GSC-aggregate
// behavior lands. [GREEN] is already-working behavior that must not regress.
// =============================================================================
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertSafeReport,
  buildGrowthReport,
  buildWeeklyWindows,
} from '../../scripts/lib/growth-report.mjs';
import {
  collectGscWeek,
  collectPosthogTop,
} from '../../scripts/generate-weekly-growth-report.mjs';

const fixture = JSON.parse(fs.readFileSync('tests/fixtures/weekly-growth-input.json', 'utf8'));
const windows = buildWeeklyWindows({ endDate: fixture.endDate });
const CURRENT_WINDOW = windows[3];
const POSTHOG_MAX_ATTEMPTS = 3;
const POSTHOG_BASE_DELAY_MS = 1_000;
export const POSTHOG_MAX_RETRY_AFTER_MS = 8_000;
const POSTHOG_ATTEMPT_TIMEOUT_MS = 30_000;
const SUCCESS_LANDING_ROWS = Object.freeze([['/guide/parking-guide', 30]]);

function noWaitSleeper() {
  const calls = [];
  return {
    calls,
    sleep: async (ms) => {
      calls.push(ms);
    },
  };
}

function assertExactSleeps(calls, expected) {
  assert.deepEqual(calls, expected);
}

function installAttemptTimeoutCapture() {
  const originalTimeout = AbortSignal.timeout;
  const calls = [];
  AbortSignal.timeout = (ms) => {
    const signal = originalTimeout.call(AbortSignal, ms);
    calls.push({ ms, signal });
    return signal;
  };
  return {
    calls,
    restore() {
      AbortSignal.timeout = originalTimeout;
    },
  };
}

function assertAttemptTimeouts(capture, expectedCount) {
  assert.equal(capture.calls.length, expectedCount);
  const unique = new Set();
  for (const call of capture.calls) {
    assert.equal(call.ms, POSTHOG_ATTEMPT_TIMEOUT_MS);
    assert.equal(typeof call.signal?.aborted, 'boolean');
    unique.add(call.signal);
  }
  assert.equal(
    unique.size,
    expectedCount,
    'each attempt must use a distinct AbortSignal.timeout signal',
  );
}

function assertFetchUsesAttemptSignals(fetchCalls, timeoutCapture) {
  assert.equal(fetchCalls.length, timeoutCapture.calls.length);
  for (let index = 0; index < fetchCalls.length; index += 1) {
    assert.equal(fetchCalls[index].init?.signal, timeoutCapture.calls[index].signal);
  }
}

function jsonResponse(status, payload, retryAfter = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'retry-after' ? retryAfter : null;
      },
    },
    async json() {
      return payload;
    },
  };
}

function timeoutError() {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

function transportError() {
  return new TypeError('fetch failed');
}

function futureHttpDateRetryAfter() {
  return new Date(Date.now() + 3_600_000).toUTCString();
}

function installFetchScript(script) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const index = calls.length;
    calls.push({ url: String(url), init });
    assert.match(String(url), /\/api\/projects\/[^/]+\/query\/$/);
    if (index >= script.length) {
      throw new Error(`unexpected_extra_posthog_call:${index}`);
    }
    const step = script[index];
    if (typeof step === 'function') return step(url, init);
    if (step instanceof Error) throw step;
    return step;
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function collectWithSleep(sleeper) {
  return collectPosthogTop('token', CURRENT_WINDOW, { sleep: sleeper.sleep });
}

function fakeGscClient(rowsOrFactory) {
  return {
    searchanalytics: {
      query: async ({ requestBody }) => {
        assert.equal(requestBody.dataState, 'final');
        assert.equal(requestBody.dimensions, undefined);
        const rows = typeof rowsOrFactory === 'function' ? rowsOrFactory(requestBody) : rowsOrFactory;
        return { data: rows === undefined ? {} : { rows } };
      },
    },
  };
}

function fixtureReport() {
  return buildGrowthReport({
    generatedAt: fixture.generatedAt,
    windows,
    weekly: fixture.weekly,
    top: fixture.top,
  });
}

test('[RED] E1 503 then timeout then success uses exactly 3 PostHog calls and the injected sleeper', async (t) => {
  const sleeper = noWaitSleeper();
  const timeouts = installAttemptTimeoutCapture();
  const fetch = installFetchScript([
    jsonResponse(503, { ignored: true }, '1'),
    timeoutError(),
    jsonResponse(200, { results: SUCCESS_LANDING_ROWS }),
  ]);
  t.after(() => {
    timeouts.restore();
    fetch.restore();
  });

  const collected = await collectWithSleep(sleeper);
  assert.deepEqual(collected, SUCCESS_LANDING_ROWS);
  assert.equal(fetch.calls.length, POSTHOG_MAX_ATTEMPTS);
  assertExactSleeps(sleeper.calls, [POSTHOG_BASE_DELAY_MS, POSTHOG_BASE_DELAY_MS * 2]);
  assertAttemptTimeouts(timeouts, POSTHOG_MAX_ATTEMPTS);
  assertFetchUsesAttemptSignals(fetch.calls, timeouts);
});

test('[RED] E1 500 and 599 retry then succeed with base delay and distinct 30s signals', async (t) => {
  for (const status of [500, 599]) {
    const sleeper = noWaitSleeper();
    const timeouts = installAttemptTimeoutCapture();
    const fetch = installFetchScript([
      jsonResponse(status, { ignored: true }),
      jsonResponse(200, { results: SUCCESS_LANDING_ROWS }),
    ]);
    t.after(() => {
      timeouts.restore();
      fetch.restore();
    });
    const collected = await collectWithSleep(sleeper);
    assert.deepEqual(collected, SUCCESS_LANDING_ROWS, `status ${status} must eventually succeed`);
    assert.equal(fetch.calls.length, 2, `status ${status} must retry once`);
    assertExactSleeps(sleeper.calls, [POSTHOG_BASE_DELAY_MS]);
    assertAttemptTimeouts(timeouts, 2);
    assertFetchUsesAttemptSignals(fetch.calls, timeouts);
    fetch.restore();
    timeouts.restore();
  }
});

test('[RED] E1 generic transport rejection retries then succeeds', async (t) => {
  const sleeper = noWaitSleeper();
  const timeouts = installAttemptTimeoutCapture();
  const fetch = installFetchScript([
    transportError(),
    jsonResponse(200, { results: SUCCESS_LANDING_ROWS }),
  ]);
  t.after(() => {
    timeouts.restore();
    fetch.restore();
  });

  const collected = await collectWithSleep(sleeper);
  assert.deepEqual(collected, SUCCESS_LANDING_ROWS);
  assert.equal(fetch.calls.length, 2);
  assertExactSleeps(sleeper.calls, [POSTHOG_BASE_DELAY_MS]);
  assertAttemptTimeouts(timeouts, 2);
  assertFetchUsesAttemptSignals(fetch.calls, timeouts);
});

test('[GREEN] E2 permanent HTTP statuses are not retried and fail closed after 1 call', async (t) => {
  for (const status of [301, 400, 401, 403, 404]) {
    const sleeper = noWaitSleeper();
    const timeouts = installAttemptTimeoutCapture();
    const fetch = installFetchScript([jsonResponse(status, { ignored: true })]);
    t.after(() => {
      timeouts.restore();
      fetch.restore();
    });
    await assert.rejects(
      () => collectWithSleep(sleeper),
      (error) => {
        assert.equal(error?.message, 'posthog_request_failed');
        return true;
      },
    );
    assert.equal(fetch.calls.length, 1, `status ${status} must not retry`);
    assert.equal(sleeper.calls.length, 0, `status ${status} must not sleep`);
    assertAttemptTimeouts(timeouts, 1);
    assertFetchUsesAttemptSignals(fetch.calls, timeouts);
    fetch.restore();
    timeouts.restore();
  }
});

test('[GREEN] E2 invalid JSON and invalid results fail as schema errors after 1 call', async (t) => {
  const cases = [
    {
      name: 'invalid JSON',
      response: {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() {
          throw new SyntaxError('Unexpected token');
        },
      },
    },
    {
      name: 'missing results',
      response: jsonResponse(200, { rows: [] }),
    },
    {
      name: 'non-array results',
      response: jsonResponse(200, { results: { path: '/guide/parking-guide' } }),
    },
  ];

  for (const { name, response } of cases) {
    const sleeper = noWaitSleeper();
    const timeouts = installAttemptTimeoutCapture();
    const fetch = installFetchScript([response]);
    t.after(() => {
      timeouts.restore();
      fetch.restore();
    });
    await assert.rejects(
      () => collectWithSleep(sleeper),
      (error) => {
        assert.equal(error?.message, 'posthog_schema_error', name);
        return true;
      },
    );
    assert.equal(fetch.calls.length, 1, `${name} must not retry`);
    assert.equal(sleeper.calls.length, 0, `${name} must not sleep`);
    assertAttemptTimeouts(timeouts, 1);
    assertFetchUsesAttemptSignals(fetch.calls, timeouts);
    fetch.restore();
    timeouts.restore();
  }
});

test('[RED] E3 retryable exhaustion uses exactly 3 calls and capped Retry-After', async (t) => {
  const sleeper = noWaitSleeper();
  const timeouts = installAttemptTimeoutCapture();
  const fetch = installFetchScript([
    jsonResponse(429, { ignored: true }, '120'),
    jsonResponse(408, { ignored: true }),
    jsonResponse(503, { ignored: true }),
  ]);
  t.after(() => {
    timeouts.restore();
    fetch.restore();
  });

  await assert.rejects(
    () => collectWithSleep(sleeper),
    (error) => {
      assert.equal(error?.message, 'posthog_request_failed');
      return true;
    },
  );
  assert.equal(fetch.calls.length, POSTHOG_MAX_ATTEMPTS);
  assertExactSleeps(sleeper.calls, [POSTHOG_MAX_RETRY_AFTER_MS, POSTHOG_BASE_DELAY_MS * 2]);
  assertAttemptTimeouts(timeouts, POSTHOG_MAX_ATTEMPTS);
  assertFetchUsesAttemptSignals(fetch.calls, timeouts);
});

test('[RED] E3 future HTTP-date Retry-After is clamped to 8000', async (t) => {
  const retryAfter = futureHttpDateRetryAfter();
  assert.match(retryAfter, /GMT$/i);
  assert.equal(Number.isFinite(Number(retryAfter)), false);

  const sleeper = noWaitSleeper();
  const timeouts = installAttemptTimeoutCapture();
  const fetch = installFetchScript([
    jsonResponse(429, { ignored: true }, retryAfter),
    jsonResponse(200, { results: SUCCESS_LANDING_ROWS }),
  ]);
  t.after(() => {
    timeouts.restore();
    fetch.restore();
  });

  const collected = await collectWithSleep(sleeper);
  assert.deepEqual(collected, SUCCESS_LANDING_ROWS);
  assert.equal(fetch.calls.length, 2);
  assertExactSleeps(sleeper.calls, [POSTHOG_MAX_RETRY_AFTER_MS]);
  assertAttemptTimeouts(timeouts, 2);
  assertFetchUsesAttemptSignals(fetch.calls, timeouts);
});

test('[RED] E4 empty or missing GSC aggregate rows are gsc_schema_error', async () => {
  await assert.rejects(
    () => collectGscWeek(fakeGscClient([]), CURRENT_WINDOW),
    (error) => {
      assert.equal(error?.message, 'gsc_schema_error');
      return true;
    },
  );
  await assert.rejects(
    () => collectGscWeek(fakeGscClient(undefined), CURRENT_WINDOW),
    (error) => {
      assert.equal(error?.message, 'gsc_schema_error');
      return true;
    },
  );
});

test('[GREEN] E4 explicit all-zero GSC aggregate row succeeds and extra rows stay schema errors', async () => {
  const zero = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  assert.deepEqual(await collectGscWeek(fakeGscClient([zero]), CURRENT_WINDOW), zero);
  await assert.rejects(
    () => collectGscWeek(fakeGscClient([zero, { ...zero, clicks: 1 }]), CURRENT_WINDOW),
    (error) => {
      assert.equal(error?.message, 'gsc_schema_error');
      return true;
    },
  );
});

test('[GREEN] E5 finalized Sunday windows, schema, sanitized paths, and CLI output stay covered', () => {
  assert.deepEqual(windows, [
    { start: '2026-07-06', end: '2026-07-12' },
    { start: '2026-07-13', end: '2026-07-19' },
    { start: '2026-07-20', end: '2026-07-26' },
    { start: '2026-07-27', end: '2026-08-02' },
  ]);
  assert.throws(() => buildWeeklyWindows({ endDate: '2026-08-01' }), /end_date_must_be_sunday/);
  assert.throws(
    () => buildWeeklyWindows({ now: new Date('2026-08-06T18:00:00.000Z'), endDate: '2026-08-09' }),
    /end_date_not_finalized/,
  );

  const report = fixtureReport();
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.current.start, '2026-07-27');
  assert.equal(report.current.end, '2026-08-02');
  assert.equal(report.top.current.gscPages[0].page, '/guide/parking-guide');
  assert.equal(report.top.current.organicLandingPaths[0].path, '/guide/parking-guide');
  assertSafeReport(report);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'liberty-growth-e5-'));
  try {
    const fixtureOutput = path.join(root, 'fixture');
    const fixtureRun = spawnSync(
      process.execPath,
      [
        'scripts/generate-weekly-growth-report.mjs',
        '--fixture', 'tests/fixtures/weekly-growth-input.json',
        '--end-date', '2026-08-02',
        '--out-dir', fixtureOutput,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(fixtureRun.status, 0, fixtureRun.stderr);
    const json = fs.readFileSync(path.join(fixtureOutput, 'weekly-growth.json'), 'utf8');
    const markdown = fs.readFileSync(path.join(fixtureOutput, 'weekly-growth.md'), 'utf8');
    assert.equal(JSON.parse(json).trend.length, 4);
    assert.match(markdown, /Current finalized week: 2026-07-27 through 2026-08-02/);
    assert.doesNotMatch(`${json}${markdown}`, /private@example|distinct_id|\$session_id|ph[ctx]_/i);

    const environment = { ...process.env };
    delete environment.GOOGLE_APPLICATION_CREDENTIALS;
    delete environment.POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE;
    const failedOutput = path.join(root, 'failed');
    const failedRun = spawnSync(
      process.execPath,
      [
        'scripts/generate-weekly-growth-report.mjs',
        '--end-date', '2026-08-02',
        '--out-dir', failedOutput,
      ],
      { encoding: 'utf8', env: environment },
    );
    assert.notEqual(failedRun.status, 0);
    assert.match(failedRun.stderr, /^weekly growth report failed: configuration_error\n$/);
    assert.equal(fs.existsSync(path.join(failedOutput, 'weekly-growth.json')), false);
    assert.equal(fs.existsSync(path.join(failedOutput, 'weekly-growth.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('[GREEN] evaluator lock pins this journey eval', () => {
  const relative = 'tests/automation/weekly-growth-resilience.eval.mjs';
  const digest = createHash('sha256').update(fs.readFileSync(relative)).digest('hex');
  const lock = fs.readFileSync('evals/weekly-growth-resilience.sha256', 'utf8');
  assert.match(
    lock,
    new RegExp(`^${digest}  ${relative.replaceAll('.', '\\.')}$`, 'm'),
  );
});
