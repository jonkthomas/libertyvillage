export const REPORT_TIMEZONE = 'America/Los_Angeles';
export const REPORT_SCHEMA_VERSION = 1;
export const GSC_SITE = 'sc-domain:libertyvillage.co';
export const POSTHOG_PROJECT_ID = 545345;
export const PRODUCTION_HOSTNAME = 'libertyvillage.co';
export const TOP_LIMIT = 10;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GSC_METRICS = ['clicks', 'impressions', 'ctr', 'position'];
const POSTHOG_METRICS = [
  'pageviews',
  'landingSessions',
  'organicLandings',
  'businessContacts',
  'websiteContacts',
  'phoneContacts',
  'newsletterSucceeded',
  'newsletterFailed',
];

function dateFromLabel(label) {
  if (!DATE_PATTERN.test(label)) throw new Error('invalid_date');
  const date = new Date(`${label}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== label) {
    throw new Error('invalid_date');
  }
  return date;
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(label, days) {
  const date = dateFromLabel(label);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function dayOfWeek(label) {
  return dateFromLabel(label).getUTCDay();
}

export function localDateLabel(now = new Date(), timezone = REPORT_TIMEZONE) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('invalid_now');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function latestFinalizedSunday(now = new Date()) {
  const cutoff = addDays(localDateLabel(now), -3);
  return addDays(cutoff, -dayOfWeek(cutoff));
}

export function validateSundayEndDate(endDate) {
  dateFromLabel(endDate);
  if (dayOfWeek(endDate) !== 0) throw new Error('end_date_must_be_sunday');
  return endDate;
}

export function buildWeeklyWindows({ now = new Date(), endDate } = {}) {
  const latestFinalized = latestFinalizedSunday(now);
  const currentEnd = endDate ? validateSundayEndDate(endDate) : latestFinalized;
  if (currentEnd > latestFinalized) throw new Error('end_date_not_finalized');
  return Array.from({ length: 4 }, (_, index) => {
    const weeksBeforeCurrent = 3 - index;
    const end = addDays(currentEnd, -7 * weeksBeforeCurrent);
    return { start: addDays(end, -6), end };
  });
}

function assertFiniteNonNegative(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

export function normalizeGscTotals(row) {
  if (row == null) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  if (typeof row !== 'object' || Array.isArray(row)) throw new Error('invalid_gsc_totals');
  const totals = {
    clicks: assertFiniteNonNegative(row.clicks, 'gsc_clicks'),
    impressions: assertFiniteNonNegative(row.impressions, 'gsc_impressions'),
    ctr: assertFiniteNonNegative(row.ctr, 'gsc_ctr'),
    position: assertFiniteNonNegative(row.position, 'gsc_position'),
  };
  if (totals.ctr > 1) throw new Error('invalid_gsc_ctr');
  return totals;
}

export function normalizePosthogTotals(row) {
  if (!Array.isArray(row) || row.length !== POSTHOG_METRICS.length) {
    throw new Error('invalid_posthog_totals');
  }
  return Object.fromEntries(
    POSTHOG_METRICS.map((name, index) => [
      name,
      assertFiniteNonNegative(row[index], `posthog_${name}`),
    ]),
  );
}

export function metricDelta(current, prior) {
  assertFiniteNonNegative(current, 'current_metric');
  assertFiniteNonNegative(prior, 'prior_metric');
  return {
    absolute: current - prior,
    percent: prior === 0 ? null : ((current - prior) / prior) * 100,
  };
}

function buildMetricChanges(current, prior, metricNames) {
  return Object.fromEntries(
    metricNames.map((name) => [name, metricDelta(current[name], prior[name])]),
  );
}

function cleanText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function containsContactData(value) {
  const text = String(value ?? '');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) return true;
  if (/\b(?:phc|phx)_[^\s"']+/i.test(text)) return true;
  const phoneCandidates = text.match(/\+?\d[\d\s().-]{5,}\d/g) ?? [];
  return phoneCandidates.some((candidate) => {
    const trimmed = candidate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
    return trimmed.replace(/\D/g, '').length >= 7;
  });
}

function containsUrlLike(value) {
  return /(?:\bhttps?:\/\/|\bwww\.)/i.test(String(value ?? ''));
}

export function sanitizeQuery(value) {
  const text = cleanText(value, 200);
  return text && !containsContactData(text) && !containsUrlLike(text) ? text : null;
}

export function sanitizeSitePath(value) {
  try {
    const url = new URL(String(value), 'https://libertyvillage.co');
    if (url.hostname.replace(/^www\./, '') !== PRODUCTION_HOSTNAME) return null;
    const path = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
    return cleanText(path, 300) || '/';
  } catch {
    return null;
  }
}

function normalizeGscDetailRow(row, dimension) {
  if (!row || !Array.isArray(row.keys) || row.keys.length !== 1) {
    throw new Error(`invalid_gsc_${dimension}_row`);
  }
  const label = dimension === 'query' ? sanitizeQuery(row.keys[0]) : sanitizeSitePath(row.keys[0]);
  if (!label) return null;
  return {
    [dimension]: label,
    ...normalizeGscTotals(row),
  };
}

export function normalizeGscDetails(rows, dimension, limit = TOP_LIMIT) {
  if (!Array.isArray(rows)) throw new Error(`invalid_gsc_${dimension}_rows`);
  if (!['query', 'page'].includes(dimension)) throw new Error('invalid_gsc_dimension');
  return rows
    .slice(0, limit)
    .map((row) => normalizeGscDetailRow(row, dimension))
    .filter(Boolean);
}

export function normalizeLandingPaths(rows, limit = TOP_LIMIT) {
  if (!Array.isArray(rows)) throw new Error('invalid_posthog_landing_rows');
  return rows.slice(0, limit).map((row) => {
    if (!Array.isArray(row) || row.length !== 2) throw new Error('invalid_posthog_landing_row');
    const path = sanitizeSitePath(row[0]);
    if (!path) throw new Error('invalid_posthog_landing_path');
    return { path, organicLandings: assertFiniteNonNegative(row[1], 'organic_landings') };
  });
}

export function buildGrowthReport({ generatedAt, windows, weekly, top }) {
  if (!Array.isArray(windows) || windows.length !== 4 || !Array.isArray(weekly) || weekly.length !== 4) {
    throw new Error('invalid_weekly_input');
  }
  const normalizedWeeks = weekly.map((entry, index) => {
    const expected = windows[index];
    if (!entry || entry.start !== expected.start || entry.end !== expected.end) {
      throw new Error('weekly_window_mismatch');
    }
    return {
      start: entry.start,
      end: entry.end,
      gsc: normalizeGscTotals(entry.gsc),
      posthog: normalizePosthogTotals(POSTHOG_METRICS.map((name) => entry.posthog?.[name])),
    };
  });
  const current = normalizedWeeks[3];
  const prior = normalizedWeeks[2];
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    timezone: REPORT_TIMEZONE,
    site: GSC_SITE,
    posthogProjectId: POSTHOG_PROJECT_ID,
    sources: { gsc: 'ok', posthog: 'ok' },
    current,
    prior,
    changes: {
      gsc: buildMetricChanges(current.gsc, prior.gsc, GSC_METRICS),
      posthog: buildMetricChanges(current.posthog, prior.posthog, POSTHOG_METRICS),
    },
    trend: normalizedWeeks,
    top: {
      current: {
        gscQueries: normalizeGscDetails(top?.current?.gscQueries ?? [], 'query'),
        gscPages: normalizeGscDetails(top?.current?.gscPages ?? [], 'page'),
        organicLandingPaths: normalizeLandingPaths(top?.current?.organicLandingPaths ?? []),
      },
      prior: {
        gscQueries: normalizeGscDetails(top?.prior?.gscQueries ?? [], 'query'),
        gscPages: normalizeGscDetails(top?.prior?.gscPages ?? [], 'page'),
        organicLandingPaths: normalizeLandingPaths(top?.prior?.organicLandingPaths ?? []),
      },
    },
  };
}

function number(value, digits = 0) {
  return new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function percent(value, digits = 1) {
  return `${number(value * 100, digits)}%`;
}

function deltaLabel(delta, digits = 1) {
  if (delta.percent == null) return 'N/A';
  const sign = delta.percent > 0 ? '+' : '';
  return `${sign}${number(delta.percent, digits)}%`;
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function renderGrowthMarkdown(report) {
  if (report?.schemaVersion !== REPORT_SCHEMA_VERSION) throw new Error('invalid_report');
  const metricRows = [
    ['GSC clicks', number(report.current.gsc.clicks), number(report.prior.gsc.clicks), deltaLabel(report.changes.gsc.clicks)],
    ['GSC impressions', number(report.current.gsc.impressions), number(report.prior.gsc.impressions), deltaLabel(report.changes.gsc.impressions)],
    ['GSC CTR', percent(report.current.gsc.ctr), percent(report.prior.gsc.ctr), deltaLabel(report.changes.gsc.ctr)],
    ['GSC average position', number(report.current.gsc.position, 1), number(report.prior.gsc.position, 1), deltaLabel(report.changes.gsc.position)],
    ['PostHog landing sessions', number(report.current.posthog.landingSessions), number(report.prior.posthog.landingSessions), deltaLabel(report.changes.posthog.landingSessions)],
    ['Organic landings', number(report.current.posthog.organicLandings), number(report.prior.posthog.organicLandings), deltaLabel(report.changes.posthog.organicLandings)],
    ['Pageviews', number(report.current.posthog.pageviews), number(report.prior.posthog.pageviews), deltaLabel(report.changes.posthog.pageviews)],
    ['Business contacts', number(report.current.posthog.businessContacts), number(report.prior.posthog.businessContacts), deltaLabel(report.changes.posthog.businessContacts)],
    ['Newsletter successes', number(report.current.posthog.newsletterSucceeded), number(report.prior.posthog.newsletterSucceeded), deltaLabel(report.changes.posthog.newsletterSucceeded)],
    ['Newsletter failures', number(report.current.posthog.newsletterFailed), number(report.prior.posthog.newsletterFailed), deltaLabel(report.changes.posthog.newsletterFailed)],
  ];
  const trendRows = report.trend.map((week) => [
    `${week.start}–${week.end}`,
    number(week.gsc.clicks),
    number(week.gsc.impressions),
    percent(week.gsc.ctr),
    number(week.posthog.landingSessions),
    number(week.posthog.organicLandings),
    number(week.posthog.businessContacts),
  ]);
  const queryRows = report.top.current.gscQueries.map((row) => [
    row.query.replace(/\|/g, '\\|'),
    number(row.clicks),
    number(row.impressions),
    percent(row.ctr),
    number(row.position, 1),
  ]);
  const pageRows = report.top.current.gscPages.map((row) => [
    row.page.replace(/\|/g, '\\|'),
    number(row.clicks),
    number(row.impressions),
    percent(row.ctr),
    number(row.position, 1),
  ]);
  const landingRows = report.top.current.organicLandingPaths.map((row) => [
    row.path.replace(/\|/g, '\\|'),
    number(row.organicLandings),
  ]);

  return [
    '# Liberty Village Weekly Growth Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Timezone: ${report.timezone}`,
    `Current finalized week: ${report.current.start} through ${report.current.end}`,
    `Prior week: ${report.prior.start} through ${report.prior.end}`,
    '',
    '## Current vs prior',
    '',
    markdownTable(['Metric', 'Current', 'Prior', 'Change'], metricRows),
    '',
    '_For GSC average position, a lower value is better._',
    '',
    '## Four-week trend',
    '',
    markdownTable(['Week', 'GSC clicks', 'GSC impressions', 'CTR', 'Landing sessions', 'Organic landings', 'Business contacts'], trendRows),
    '',
    '## Top current queries',
    '',
    queryRows.length ? markdownTable(['Query', 'Clicks', 'Impressions', 'CTR', 'Position'], queryRows) : '_No query rows._',
    '',
    '## Top current pages',
    '',
    pageRows.length ? markdownTable(['Page', 'Clicks', 'Impressions', 'CTR', 'Position'], pageRows) : '_No page rows._',
    '',
    '## Top current organic landing paths',
    '',
    landingRows.length ? markdownTable(['Path', 'Organic landings'], landingRows) : '_No organic landing rows._',
    '',
    '> Changes are correlations between adjacent finalized weeks; this report does not claim causality.',
    '',
  ].join('\n');
}

export function assertSafeReport(report) {
  const forbiddenKeys = new Set([
    'distinct_id', '$session_id', 'person_id', 'email', 'email_address',
    'phone_number', 'token', '$current_url', '$referrer', 'referrer_url',
    'properties', 'raw_events',
  ]);
  const visit = (value) => {
    if (typeof value === 'string') {
      if (containsContactData(value) || containsUrlLike(value)) {
        throw new Error('unsafe_report_value');
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase())) throw new Error('unsafe_report_field');
      visit(child);
    }
  };
  visit(report);
  return report;
}

export { GSC_METRICS, POSTHOG_METRICS };
