#!/usr/bin/env node
// Refresh-loop source step: 28 days of Search Console rows for blog pages, by
// page and by page+query, written to --out for `content refresh plan --gsc`.
// Read-only GSC scope; credentials come from GOOGLE_APPLICATION_CREDENTIALS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GSC_SITE } from '../lib/growth-report.mjs';

export const WINDOW_DAYS = 28;
const DAY_MS = 86_400_000;

export function refreshWindow(now = new Date()) {
  // GSC "final" data lags ~3 days; end there so the window is complete.
  const end = new Date(now.getTime() - 3 * DAY_MS);
  return { startDate: new Date(end.getTime() - (WINDOW_DAYS - 1) * DAY_MS).toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

const toRow = (row, dims) => ({
  ...Object.fromEntries(dims.map((dim, i) => [dim, row.keys?.[i] ?? null])),
  clicks: Number(row.clicks) || 0, impressions: Number(row.impressions) || 0, ctr: Number(row.ctr) || 0, position: Number(row.position) || 0,
});

export async function fetchRefreshRows({ client, now = new Date() }) {
  const window = refreshWindow(now);
  const query = async (dims, rowLimit) => {
    const response = await client.searchanalytics.query({
      siteUrl: GSC_SITE,
      requestBody: {
        ...window, dimensions: dims, rowLimit, dataState: 'final',
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: '/blog/' }] }],
      },
    });
    return (Array.isArray(response?.data?.rows) ? response.data.rows : []).map((row) => toRow(row, dims));
  };
  return { site: GSC_SITE, ...window, pages: await query(['page'], 1000), queries: await query(['page', 'query'], 5000) };
}

async function main(argv) {
  const out = argv[argv.indexOf('--out') + 1];
  if (!argv.includes('--out') || !out) throw new Error('usage: refresh-gsc.mjs --out FILE');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('GOOGLE_APPLICATION_CREDENTIALS required');
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] });
  const rows = await fetchRefreshRows({ client: google.searchconsole({ version: 'v1', auth }) });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(rows)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ pages: rows.pages.length, queries: rows.queries.length, startDate: rows.startDate, endDate: rows.endDate }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
