#!/usr/bin/env node
/**
 * Pulls GSC and GA4 data for the weekly SEO report.
 * Uses service account credentials from gcp-credentials.json.
 */
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const CREDS_FILE = path.join(__dirname, "..", "gcp-credentials.json");
const GA_PROPERTY_ID = "523614078";
const GSC_SITE_URL = "sc-domain:libertyvillage.co";

async function getAuth(scopes) {
  const creds = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes,
  });
  return auth;
}

async function pullGSC(auth, startDate, endDate, label) {
  const searchconsole = google.searchconsole({ version: "v1", auth });
  try {
    const res = await searchconsole.searchanalytics.query({
      siteUrl: GSC_SITE_URL,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["query", "page"],
        rowLimit: 500,
        type: "web",
      },
    });
    console.log(`\n=== GSC ${label} (${startDate} to ${endDate}) ===`);
    console.log(`Rows: ${(res.data.rows || []).length}`);
    return res.data.rows || [];
  } catch (err) {
    console.error(`GSC ${label} error:`, err.message);
    return [];
  }
}

async function pullGA4(auth, startDate, endDate, label) {
  const analyticsdata = google.analyticsdata({ version: "v1beta", auth });
  try {
    const res = await analyticsdata.properties.runReport({
      property: `properties/${GA_PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
          { name: "screenPageViews" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 50,
      },
    });
    console.log(`\n=== GA4 ${label} (${startDate} to ${endDate}) ===`);
    const rows = (res.data.rows || []).map((r) => ({
      page: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value),
      users: parseInt(r.metricValues[1].value),
      bounceRate: parseFloat(r.metricValues[2].value),
      avgDuration: parseFloat(r.metricValues[3].value),
      pageViews: parseInt(r.metricValues[4].value),
    }));
    console.log(`Rows: ${rows.length}`);
    return rows;
  } catch (err) {
    console.error(`GA4 ${label} error:`, err.message);
    return [];
  }
}

async function pullGA4BySource(auth, startDate, endDate) {
  const analyticsdata = google.analyticsdata({ version: "v1beta", auth });
  try {
    const res = await analyticsdata.properties.runReport({
      property: `properties/${GA_PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "sessionSource" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 20,
      },
    });
    return (res.data.rows || []).map((r) => ({
      source: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value),
      users: parseInt(r.metricValues[1].value),
    }));
  } catch (err) {
    console.error("GA4 source error:", err.message);
    return [];
  }
}

async function main() {
  const auth = await getAuth([
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/analytics.readonly",
  ]);

  // This week: Feb 25 - Mar 3
  // Last week: Feb 18 - Feb 24
  const thisWeekStart = "2026-02-25";
  const thisWeekEnd = "2026-03-03";
  const lastWeekStart = "2026-02-18";
  const lastWeekEnd = "2026-02-24";

  // Pull all data
  const [gscThisWeek, gscLastWeek, gaThisWeek, gaLastWeek, gaSourcesThisWeek] = await Promise.all([
    pullGSC(auth, thisWeekStart, thisWeekEnd, "This Week"),
    pullGSC(auth, lastWeekStart, lastWeekEnd, "Last Week"),
    pullGA4(auth, thisWeekStart, thisWeekEnd, "This Week"),
    pullGA4(auth, lastWeekStart, lastWeekEnd, "Last Week"),
    pullGA4BySource(auth, thisWeekStart, thisWeekEnd),
  ]);

  // Output JSON for processing
  const output = {
    gscThisWeek,
    gscLastWeek,
    gaThisWeek,
    gaLastWeek,
    gaSourcesThisWeek,
    dateRange: { thisWeek: { start: thisWeekStart, end: thisWeekEnd }, lastWeek: { start: lastWeekStart, end: lastWeekEnd } },
  };

  const outFile = path.join(__dirname, "..", "tasks", "seo-data-latest.json");
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\nData saved to ${outFile}`);

  // Print summary stats
  console.log("\n=== SUMMARY ===");

  // GSC totals
  let twClicks = 0, twImpressions = 0, lwClicks = 0, lwImpressions = 0;
  gscThisWeek.forEach((r) => { twClicks += r.clicks; twImpressions += r.impressions; });
  gscLastWeek.forEach((r) => { lwClicks += r.clicks; lwImpressions += r.impressions; });
  console.log(`GSC This Week: ${twClicks} clicks, ${twImpressions} impressions`);
  console.log(`GSC Last Week: ${lwClicks} clicks, ${lwImpressions} impressions`);
  console.log(`Click change: ${twClicks - lwClicks} (${lwClicks > 0 ? ((twClicks - lwClicks) / lwClicks * 100).toFixed(1) : "N/A"}%)`);

  // GA totals
  let twSessions = 0, lwSessions = 0;
  gaThisWeek.forEach((r) => { twSessions += r.sessions; });
  gaLastWeek.forEach((r) => { lwSessions += r.sessions; });
  console.log(`GA4 This Week: ${twSessions} sessions`);
  console.log(`GA4 Last Week: ${lwSessions} sessions`);

  // Top queries by impressions
  console.log("\n=== TOP 20 QUERIES (This Week by Impressions) ===");
  const queryAgg = {};
  gscThisWeek.forEach((r) => {
    if (!queryAgg[r.keys[0]]) queryAgg[r.keys[0]] = { clicks: 0, impressions: 0, positions: [], pages: [] };
    queryAgg[r.keys[0]].clicks += r.clicks;
    queryAgg[r.keys[0]].impressions += r.impressions;
    queryAgg[r.keys[0]].positions.push(r.position);
    queryAgg[r.keys[0]].pages.push(r.keys[1]);
  });
  const topQueries = Object.entries(queryAgg)
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, 20);
  topQueries.forEach(([q, d]) => {
    const avgPos = (d.positions.reduce((a, b) => a + b, 0) / d.positions.length).toFixed(1);
    const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100).toFixed(1) : "0";
    console.log(`  ${q}: ${d.clicks}c / ${d.impressions}i / pos ${avgPos} / ctr ${ctr}% / pages: ${d.pages.length}`);
  });

  // Quick wins (position 4-20, impressions > 10, CTR < 5%)
  console.log("\n=== QUICK WINS ===");
  const quickWins = Object.entries(queryAgg).filter(([, d]) => {
    const avgPos = d.positions.reduce((a, b) => a + b, 0) / d.positions.length;
    const ctr = d.impressions > 0 ? d.clicks / d.impressions * 100 : 0;
    return avgPos >= 4 && avgPos <= 20 && d.impressions >= 10 && ctr < 5;
  }).sort((a, b) => b[1].impressions - a[1].impressions);
  quickWins.forEach(([q, d]) => {
    const avgPos = (d.positions.reduce((a, b) => a + b, 0) / d.positions.length).toFixed(1);
    const ctr = (d.clicks / d.impressions * 100).toFixed(1);
    console.log(`  ${q}: pos ${avgPos} / ${d.impressions}i / ${ctr}% CTR / ${d.pages[0]}`);
  });

  // Position movers
  console.log("\n=== POSITION MOVERS ===");
  const lwQueryAgg = {};
  gscLastWeek.forEach((r) => {
    if (!lwQueryAgg[r.keys[0]]) lwQueryAgg[r.keys[0]] = { positions: [] };
    lwQueryAgg[r.keys[0]].positions.push(r.position);
  });
  const movers = [];
  for (const [q, d] of Object.entries(queryAgg)) {
    const twAvgPos = d.positions.reduce((a, b) => a + b, 0) / d.positions.length;
    if (lwQueryAgg[q]) {
      const lwAvgPos = lwQueryAgg[q].positions.reduce((a, b) => a + b, 0) / lwQueryAgg[q].positions.length;
      const change = lwAvgPos - twAvgPos; // positive = improved
      if (Math.abs(change) >= 2) movers.push({ query: q, prev: lwAvgPos, curr: twAvgPos, change, impressions: d.impressions });
    } else {
      movers.push({ query: q, prev: null, curr: twAvgPos, change: null, impressions: d.impressions, isNew: true });
    }
  }
  movers.sort((a, b) => (b.change || 0) - (a.change || 0));
  console.log("Improvements:");
  movers.filter((m) => m.change > 0).slice(0, 10).forEach((m) => {
    console.log(`  ${m.query}: ${m.prev.toFixed(1)} -> ${m.curr.toFixed(1)} (+${m.change.toFixed(1)} spots) / ${m.impressions}i`);
  });
  console.log("Declines:");
  movers.filter((m) => m.change !== null && m.change < 0).slice(0, 10).forEach((m) => {
    console.log(`  ${m.query}: ${m.prev.toFixed(1)} -> ${m.curr.toFixed(1)} (${m.change.toFixed(1)} spots) / ${m.impressions}i`);
  });
  console.log("New queries:");
  movers.filter((m) => m.isNew).sort((a, b) => b.impressions - a.impressions).slice(0, 10).forEach((m) => {
    console.log(`  ${m.query}: pos ${m.curr.toFixed(1)} / ${m.impressions}i (NEW)`);
  });

  // Traffic by source
  console.log("\n=== TRAFFIC BY SOURCE ===");
  gaSourcesThisWeek.forEach((s) => console.log(`  ${s.source}: ${s.sessions} sessions / ${s.users} users`));

  // Top pages GA
  console.log("\n=== TOP 15 PAGES BY SESSIONS ===");
  gaThisWeek.slice(0, 15).forEach((p) => {
    const br = (p.bounceRate * 100).toFixed(0);
    const dur = p.avgDuration.toFixed(0);
    console.log(`  ${p.page}: ${p.sessions}s / ${p.pageViews}pv / ${br}% bounce / ${dur}s avg`);
  });

  // Cannibalization check
  console.log("\n=== POTENTIAL CANNIBALIZATION ===");
  for (const [q, d] of Object.entries(queryAgg)) {
    if (d.pages.length > 1) {
      console.log(`  "${q}" appears on ${d.pages.length} pages: ${d.pages.join(", ")}`);
    }
  }
}

main().catch(console.error);
