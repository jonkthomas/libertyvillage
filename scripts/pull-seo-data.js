#!/usr/bin/env node
/**
 * Pull fresh GSC + GA4 data for the weekly SEO report.
 * Usage: node scripts/pull-seo-data.js
 * Outputs JSON to tasks/seo-data-latest.json
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDS_PATH = process.env.LV_GCP_CREDENTIALS_PATH || path.join(__dirname, '..', 'gcp-credentials.json');
const OUTPUT_PATH = process.env.LV_SEO_OUTPUT_PATH || path.join(__dirname, '..', 'tasks', 'seo-data-latest.json');
const GSC_SITE = 'sc-domain:libertyvillage.co';
const GA4_PROPERTY = 'properties/523614078';

// Date helpers
const today = new Date();
const fmt = (d) => d.toISOString().split('T')[0];
const daysAgo = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
};

const thisWeekStart = fmt(daysAgo(7));
const thisWeekEnd = fmt(daysAgo(1));
const lastWeekStart = fmt(daysAgo(14));
const lastWeekEnd = fmt(daysAgo(8));

async function main() {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/analytics.readonly',
    ],
  });

  const authClient = await auth.getClient();
  google.options({ auth: authClient });

  const result = {
    collectedAt: new Date().toISOString(),
    dateRanges: { thisWeek: { start: thisWeekStart, end: thisWeekEnd }, lastWeek: { start: lastWeekStart, end: lastWeekEnd } },
    gsc: {},
    ga4: {},
  };

  // ─── GSC: This week search analytics ───
  console.log('Pulling GSC data (this week)...');
  try {
    const searchconsole = google.searchconsole('v1');
    const gscThisWeek = await searchconsole.searchanalytics.query({
      siteUrl: GSC_SITE,
      requestBody: {
        startDate: thisWeekStart,
        endDate: thisWeekEnd,
        dimensions: ['query', 'page'],
        rowLimit: 1000,
      },
    });
    result.gsc.thisWeek = gscThisWeek.data;
    console.log(`  → ${(gscThisWeek.data.rows || []).length} rows`);
  } catch (e) {
    console.error('  GSC this week error:', e.message);
    result.gsc.thisWeek = { error: e.message };
  }

  // ─── GSC: Last week search analytics ───
  console.log('Pulling GSC data (last week)...');
  try {
    const searchconsole = google.searchconsole('v1');
    const gscLastWeek = await searchconsole.searchanalytics.query({
      siteUrl: GSC_SITE,
      requestBody: {
        startDate: lastWeekStart,
        endDate: lastWeekEnd,
        dimensions: ['query', 'page'],
        rowLimit: 1000,
      },
    });
    result.gsc.lastWeek = gscLastWeek.data;
    console.log(`  → ${(gscLastWeek.data.rows || []).length} rows`);
  } catch (e) {
    console.error('  GSC last week error:', e.message);
    result.gsc.lastWeek = { error: e.message };
  }

  // ─── GSC: Sitemaps ───
  console.log('Pulling GSC sitemaps...');
  try {
    const searchconsole = google.searchconsole('v1');
    const sitemaps = await searchconsole.sitemaps.list({ siteUrl: GSC_SITE });
    result.gsc.sitemaps = sitemaps.data;
    console.log(`  → ${(sitemaps.data.sitemap || []).length} sitemaps`);
  } catch (e) {
    console.error('  GSC sitemaps error:', e.message);
    result.gsc.sitemaps = { error: e.message };
  }

  // ─── GSC: URL Inspection for key pages ───
  console.log('Pulling GSC URL inspections...');
  const keyPages = [
    'https://libertyvillage.co/',
    'https://libertyvillage.co/guide/parking-guide',
    'https://libertyvillage.co/best/restaurants',
    'https://libertyvillage.co/blog',
    'https://libertyvillage.co/blog/liberty-village-car-free-transit-guide-2026',
    'https://libertyvillage.co/blog/dog-owners-guide-liberty-village',
    'https://libertyvillage.co/directory',
  ];
  result.gsc.inspections = {};
  for (const url of keyPages) {
    try {
      const searchconsole = google.searchconsole('v1');
      const inspection = await searchconsole.urlInspection.index.inspect({
        requestBody: {
          inspectionUrl: url,
          siteUrl: GSC_SITE,
        },
      });
      result.gsc.inspections[url] = inspection.data;
      const verdict = inspection.data?.inspectionResult?.indexStatusResult?.verdict || 'unknown';
      console.log(`  → ${url}: ${verdict}`);
    } catch (e) {
      console.error(`  URL inspection error for ${url}:`, e.message);
      result.gsc.inspections[url] = { error: e.message };
    }
  }

  // ─── GA4: Traffic by source (both weeks) ───
  console.log('Pulling GA4 traffic by source...');
  try {
    const analyticsdata = google.analyticsdata('v1beta');
    const trafficBySource = await analyticsdata.properties.runReport({
      property: GA4_PROPERTY,
      requestBody: {
        dateRanges: [
          { startDate: thisWeekStart, endDate: thisWeekEnd, name: 'thisWeek' },
          { startDate: lastWeekStart, endDate: lastWeekEnd, name: 'lastWeek' },
        ],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViews' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 50,
      },
    });
    result.ga4.trafficBySource = trafficBySource.data;
    console.log(`  → ${(trafficBySource.data.rows || []).length} rows`);
  } catch (e) {
    console.error('  GA4 traffic by source error:', e.message);
    result.ga4.trafficBySource = { error: e.message };
  }

  // ─── GA4: Traffic by page (both weeks) ───
  console.log('Pulling GA4 traffic by page...');
  try {
    const analyticsdata = google.analyticsdata('v1beta');
    const trafficByPage = await analyticsdata.properties.runReport({
      property: GA4_PROPERTY,
      requestBody: {
        dateRanges: [
          { startDate: thisWeekStart, endDate: thisWeekEnd, name: 'thisWeek' },
          { startDate: lastWeekStart, endDate: lastWeekEnd, name: 'lastWeek' },
        ],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViews' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 50,
      },
    });
    result.ga4.trafficByPage = trafficByPage.data;
    console.log(`  → ${(trafficByPage.data.rows || []).length} rows`);
  } catch (e) {
    console.error('  GA4 traffic by page error:', e.message);
    result.ga4.trafficByPage = { error: e.message };
  }

  // ─── GA4: Overall totals (both weeks) ───
  console.log('Pulling GA4 overall totals...');
  try {
    const analyticsdata = google.analyticsdata('v1beta');
    const totals = await analyticsdata.properties.runReport({
      property: GA4_PROPERTY,
      requestBody: {
        dateRanges: [
          { startDate: thisWeekStart, endDate: thisWeekEnd, name: 'thisWeek' },
          { startDate: lastWeekStart, endDate: lastWeekEnd, name: 'lastWeek' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViews' },
          { name: 'newUsers' },
          { name: 'engagedSessions' },
        ],
      },
    });
    result.ga4.totals = totals.data;
    console.log(`  → totals pulled`);
  } catch (e) {
    console.error('  GA4 totals error:', e.message);
    result.ga4.totals = { error: e.message };
  }

  // Write output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\nData written to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
