#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { google } from 'googleapis';
import {
  GSC_SITE,
  POSTHOG_PROJECT_ID,
  PRODUCTION_HOSTNAME,
  REPORT_TIMEZONE,
  TOP_LIMIT,
  assertSafeReport,
  buildGrowthReport,
  buildWeeklyWindows,
  normalizeGscDetails,
  normalizeGscTotals,
  normalizeLandingPaths,
  normalizePosthogTotals,
  renderGrowthMarkdown,
} from './lib/growth-report.mjs';

const POSTHOG_API_HOST = 'https://us.posthog.com';
const OUTPUT_JSON = 'weekly-growth.json';
const OUTPUT_MARKDOWN = 'weekly-growth.md';

function parseArguments(argv) {
  const options = { outDir: 'artifacts/growth' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--end-date') options.endDate = argv[++index];
    else if (argument === '--out-dir') options.outDir = argv[++index];
    else if (argument === '--fixture') options.fixture = argv[++index];
    else throw new Error('invalid_arguments');
    if (!argv[index]) throw new Error('invalid_arguments');
  }
  return options;
}

function safeValidationErrorCode(error) {
  const code = error instanceof Error ? error.message : '';
  return /^(?:invalid_[a-z0-9_]+|unsafe_report_(?:field|value)|weekly_window_mismatch)$/.test(code)
    ? code
    : null;
}

function safeErrorCode(error) {
  const code = error instanceof Error ? error.message : '';
  const allowed = new Set([
    'invalid_arguments', 'invalid_date', 'invalid_now', 'end_date_must_be_sunday',
    'end_date_not_finalized', 'configuration_error', 'fixture_error', 'gsc_request_failed', 'gsc_schema_error',
    'posthog_request_failed', 'posthog_schema_error', 'report_generation_failed',
  ]);
  return allowed.has(code) ? code : safeValidationErrorCode(error) ?? 'report_generation_failed';
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('configuration_error');
  return value;
}

function gscRequestBody(window, dimensions) {
  return {
    startDate: window.start,
    endDate: window.end,
    type: 'web',
    dataState: 'final',
    ...(dimensions ? { dimensions, rowLimit: TOP_LIMIT, startRow: 0 } : {}),
  };
}

async function createSearchConsoleClient(credentialsPath) {
  try {
    await fs.access(credentialsPath);
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    return google.searchconsole({ version: 'v1', auth });
  } catch {
    throw new Error('configuration_error');
  }
}

async function queryGsc(client, window, dimensions) {
  try {
    const response = await client.searchanalytics.query({
      siteUrl: GSC_SITE,
      requestBody: gscRequestBody(window, dimensions),
    });
    if (!response || typeof response.data !== 'object' || response.data == null) {
      throw new Error('gsc_schema_error');
    }
    const rows = response.data.rows ?? [];
    if (!Array.isArray(rows)) throw new Error('gsc_schema_error');
    return rows;
  } catch (error) {
    if (error instanceof Error && error.message === 'gsc_schema_error') throw error;
    throw new Error('gsc_request_failed');
  }
}

async function collectGscWeek(client, window) {
  const rows = await queryGsc(client, window);
  if (rows.length > 1) throw new Error('gsc_schema_error');
  try {
    return normalizeGscTotals(rows[0] ?? null);
  } catch {
    throw new Error('gsc_schema_error');
  }
}

export async function collectGscTop(client, window) {
  const [queryRows, pageRows] = await Promise.all([
    queryGsc(client, window, ['query']),
    queryGsc(client, window, ['page']),
  ]);
  try {
    normalizeGscDetails(queryRows, 'query');
    normalizeGscDetails(pageRows, 'page');
    return { gscQueries: queryRows, gscPages: pageRows };
  } catch {
    throw new Error('gsc_schema_error');
  }
}

export function buildPosthogTotalsQuery(window) {
  return `
SELECT
  countIf(event = '$pageview') AS pageviews,
  countIf(event = 'site_landing') AS landing_sessions,
  countIf(event = 'site_landing' AND properties.channel = 'organic_search') AS organic_landings,
  countIf(event = 'business_contact_clicked') AS business_contacts,
  countIf(event = 'business_contact_clicked' AND properties.contact_type = 'website') AS website_contacts,
  countIf(event = 'business_contact_clicked' AND properties.contact_type = 'phone') AS phone_contacts,
  countIf(event = 'newsletter_signup_succeeded') AS newsletter_succeeded,
  countIf(event = 'newsletter_signup_failed') AS newsletter_failed
FROM events
WHERE toDate(toTimeZone(timestamp, '${REPORT_TIMEZONE}')) >= toDate('${window.start}')
  AND toDate(toTimeZone(timestamp, '${REPORT_TIMEZONE}')) <= toDate('${window.end}')
  AND properties.deployment_environment = 'production'
  AND properties.site_hostname = '${PRODUCTION_HOSTNAME}'`.trim();
}

export function buildPosthogLandingQuery(window) {
  return `
SELECT properties.landing_path AS path, count() AS organic_landings
FROM events
WHERE event = 'site_landing'
  AND properties.channel = 'organic_search'
  AND toDate(toTimeZone(timestamp, '${REPORT_TIMEZONE}')) >= toDate('${window.start}')
  AND toDate(toTimeZone(timestamp, '${REPORT_TIMEZONE}')) <= toDate('${window.end}')
  AND properties.deployment_environment = 'production'
  AND properties.site_hostname = '${PRODUCTION_HOSTNAME}'
GROUP BY path
ORDER BY organic_landings DESC, path ASC
LIMIT ${TOP_LIMIT}`.trim();
}

async function posthogQuery(personalToken, query) {
  let response;
  try {
    response = await fetch(`${POSTHOG_API_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${personalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('posthog_request_failed');
  }
  if (!response.ok) throw new Error('posthog_request_failed');
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('posthog_schema_error');
  }
  if (!payload || !Array.isArray(payload.results)) throw new Error('posthog_schema_error');
  return payload.results;
}

async function collectPosthogWeek(personalToken, window) {
  const rows = await posthogQuery(personalToken, buildPosthogTotalsQuery(window));
  if (rows.length !== 1) throw new Error('posthog_schema_error');
  try {
    return normalizePosthogTotals(rows[0]);
  } catch {
    throw new Error('posthog_schema_error');
  }
}

export async function collectPosthogTop(personalToken, window) {
  const rows = await posthogQuery(personalToken, buildPosthogLandingQuery(window));
  try {
    normalizeLandingPaths(rows);
  } catch {
    throw new Error('posthog_schema_error');
  }
  return rows;
}

async function collectLiveInputs(windows) {
  const credentialsPath = requireEnvironment('GOOGLE_APPLICATION_CREDENTIALS');
  const personalToken = requireEnvironment('POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE');
  const gsc = await createSearchConsoleClient(credentialsPath);

  const weekly = [];
  for (const window of windows) {
    const [gscTotals, posthogTotals] = await Promise.all([
      collectGscWeek(gsc, window),
      collectPosthogWeek(personalToken, window),
    ]);
    weekly.push({ ...window, gsc: gscTotals, posthog: posthogTotals });
  }

  const priorWindow = windows[2];
  const currentWindow = windows[3];
  const [currentGsc, priorGsc, currentLandingPaths, priorLandingPaths] = await Promise.all([
    collectGscTop(gsc, currentWindow),
    collectGscTop(gsc, priorWindow),
    collectPosthogTop(personalToken, currentWindow),
    collectPosthogTop(personalToken, priorWindow),
  ]);

  return {
    weekly,
    top: {
      current: { ...currentGsc, organicLandingPaths: currentLandingPaths },
      prior: { ...priorGsc, organicLandingPaths: priorLandingPaths },
    },
  };
}

async function collectFixtureInputs(fixturePath, windows) {
  let fixture;
  try {
    fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  } catch {
    throw new Error('fixture_error');
  }
  if (!fixture || !Array.isArray(fixture.weekly) || !fixture.top) {
    throw new Error('fixture_error');
  }
  if (fixture.endDate && fixture.endDate !== windows[3].end) throw new Error('fixture_error');
  return { weekly: fixture.weekly, top: fixture.top, generatedAt: fixture.generatedAt };
}

async function writeReport(report, outDir) {
  assertSafeReport(report);
  const markdown = renderGrowthMarkdown(report);
  if (/\b(?:phc|phx)_[A-Za-z0-9]+\b/.test(markdown)) throw new Error('report_generation_failed');
  await fs.mkdir(outDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outDir, OUTPUT_JSON), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(outDir, OUTPUT_MARKDOWN), markdown, 'utf8'),
  ]);
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const windows = buildWeeklyWindows({ endDate: options.endDate });
  const inputs = options.fixture
    ? await collectFixtureInputs(options.fixture, windows)
    : await collectLiveInputs(windows);
  let report;
  try {
    report = buildGrowthReport({
      generatedAt: inputs.generatedAt ?? new Date().toISOString(),
      windows,
      weekly: inputs.weekly,
      top: inputs.top,
    });
    await writeReport(report, options.outDir);
  } catch (error) {
    if (error instanceof Error && error.message === 'fixture_error') throw error;
    const safeValidationCode = safeValidationErrorCode(error);
    if (safeValidationCode) throw new Error(safeValidationCode);
    throw new Error('report_generation_failed');
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((report) => {
      console.log(`weekly growth report written for ${report.current.start} through ${report.current.end}`);
    })
    .catch((error) => {
      console.error(`weekly growth report failed: ${safeErrorCode(error)}`);
      process.exitCode = 1;
    });
}
