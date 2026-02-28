#!/usr/bin/env node
/**
 * Process seo-data-latest.json and output a structured analysis to stdout.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'tasks', 'seo-data-latest.json'), 'utf-8')
);

const out = {};

// ─── GSC Analysis ───
function analyzeGSC() {
  const thisWeek = data.gsc.thisWeek?.rows || [];
  const lastWeek = data.gsc.lastWeek?.rows || [];

  // Aggregate by query (summing across pages)
  function aggregateByQuery(rows) {
    const map = {};
    for (const row of rows) {
      const query = row.keys[0];
      const page = row.keys[1];
      if (!map[query]) map[query] = { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, count: 0, pages: [] };
      map[query].clicks += row.clicks;
      map[query].impressions += row.impressions;
      map[query].posSum += row.position * row.impressions;
      map[query].count++;
      map[query].pages.push({ page, clicks: row.clicks, impressions: row.impressions, position: row.position });
    }
    for (const q of Object.keys(map)) {
      map[q].avgPosition = map[q].impressions > 0 ? map[q].posSum / map[q].impressions : 0;
    }
    return map;
  }

  const twByQuery = aggregateByQuery(thisWeek);
  const lwByQuery = aggregateByQuery(lastWeek);

  // Totals
  const twTotalClicks = thisWeek.reduce((s, r) => s + r.clicks, 0);
  const twTotalImpressions = thisWeek.reduce((s, r) => s + r.impressions, 0);
  const lwTotalClicks = lastWeek.reduce((s, r) => s + r.clicks, 0);
  const lwTotalImpressions = lastWeek.reduce((s, r) => s + r.impressions, 0);

  out.gscTotals = {
    thisWeek: { clicks: twTotalClicks, impressions: twTotalImpressions, queries: Object.keys(twByQuery).length, rows: thisWeek.length },
    lastWeek: { clicks: lwTotalClicks, impressions: lwTotalImpressions, queries: Object.keys(lwByQuery).length, rows: lastWeek.length },
  };

  // Top queries by impressions (this week)
  const topQueries = Object.entries(twByQuery)
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, 25)
    .map(([q, d]) => ({
      query: q,
      clicks: d.clicks,
      impressions: d.impressions,
      avgPosition: Math.round(d.avgPosition * 10) / 10,
      pages: d.pages.sort((a, b) => b.impressions - a.impressions).slice(0, 3),
    }));
  out.topQueries = topQueries;

  // Quick wins: position 4-20, impressions >= 3
  const quickWins = Object.entries(twByQuery)
    .filter(([, d]) => d.avgPosition >= 4 && d.avgPosition <= 20 && d.impressions >= 3)
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .map(([q, d]) => ({
      query: q,
      impressions: d.impressions,
      avgPosition: Math.round(d.avgPosition * 10) / 10,
      clicks: d.clicks,
      topPage: d.pages.sort((a, b) => b.impressions - a.impressions)[0]?.page,
    }));
  out.quickWins = quickWins;

  // Position movers (compare this week vs last week by query)
  const movers = [];
  for (const [q, tw] of Object.entries(twByQuery)) {
    const lw = lwByQuery[q];
    if (lw) {
      const change = lw.avgPosition - tw.avgPosition; // positive = improved
      movers.push({ query: q, prevPos: Math.round(lw.avgPosition * 10) / 10, currPos: Math.round(tw.avgPosition * 10) / 10, change: Math.round(change * 10) / 10, impressions: tw.impressions });
    }
  }
  const improvers = movers.filter(m => m.change > 1).sort((a, b) => b.change - a.change).slice(0, 10);
  const decliners = movers.filter(m => m.change < -1).sort((a, b) => a.change - b.change).slice(0, 10);
  out.positionMovers = { improvers, decliners };

  // New queries (in this week, not in last week)
  const newQueries = Object.entries(twByQuery)
    .filter(([q]) => !lwByQuery[q])
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, 15)
    .map(([q, d]) => ({ query: q, impressions: d.impressions, avgPosition: Math.round(d.avgPosition * 10) / 10 }));
  out.newQueries = newQueries;

  // Lost queries (in last week, not in this week)
  const lostQueries = Object.entries(lwByQuery)
    .filter(([q]) => !twByQuery[q])
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, 10)
    .map(([q, d]) => ({ query: q, impressions: d.impressions, avgPosition: Math.round(d.avgPosition * 10) / 10 }));
  out.lostQueries = lostQueries;

  // Keyword cannibalization: queries with 2+ pages
  const cannibalization = Object.entries(twByQuery)
    .filter(([, d]) => d.pages.length >= 2)
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, 10)
    .map(([q, d]) => ({
      query: q,
      totalImpressions: d.impressions,
      pages: d.pages.map(p => ({ page: p.page.replace('https://libertyvillage.co', ''), position: p.position, impressions: p.impressions })),
    }));
  out.cannibalization = cannibalization;

  // Content decay: pages where clicks/impressions dropped significantly
  function aggregateByPage(rows) {
    const map = {};
    for (const row of rows) {
      const page = row.keys[1];
      if (!map[page]) map[page] = { clicks: 0, impressions: 0, queries: 0 };
      map[page].clicks += row.clicks;
      map[page].impressions += row.impressions;
      map[page].queries++;
    }
    return map;
  }

  const twByPage = aggregateByPage(thisWeek);
  const lwByPage = aggregateByPage(lastWeek);

  const decay = [];
  for (const [page, lw] of Object.entries(lwByPage)) {
    const tw = twByPage[page] || { clicks: 0, impressions: 0 };
    if (lw.impressions > 5) {
      const impChange = ((tw.impressions - lw.impressions) / lw.impressions * 100);
      if (impChange < -20) {
        decay.push({
          page: page.replace('https://libertyvillage.co', ''),
          lastWeekImpressions: lw.impressions,
          thisWeekImpressions: tw.impressions,
          changePercent: Math.round(impChange),
        });
      }
    }
  }
  out.contentDecay = decay.sort((a, b) => a.changePercent - b.changePercent);
}

// ─── GA4 Analysis ───
function analyzeGA4() {
  // Parse totals
  const totals = data.ga4.totals;
  if (totals?.rows) {
    const metricHeaders = totals.metricHeaders.map(h => h.name);
    const dateRanges = totals.rows.map(row => {
      const values = {};
      row.metricValues.forEach((v, i) => {
        values[metricHeaders[i]] = parseFloat(v.value);
      });
      return values;
    });
    out.ga4Totals = {
      thisWeek: dateRanges[0] || {},
      lastWeek: dateRanges[1] || {},
    };
  }

  // Parse traffic by source
  const bySource = data.ga4.trafficBySource;
  if (bySource?.rows) {
    const dimHeaders = bySource.dimensionHeaders.map(h => h.name);
    const metHeaders = bySource.metricHeaders.map(h => h.name);
    const sources = {};
    for (const row of bySource.rows) {
      const dateRange = row.dimensionValues.length > dimHeaders.length
        ? row.dimensionValues[row.dimensionValues.length - 1]?.value
        : 'thisWeek';
      const source = row.dimensionValues[0]?.value || '(unknown)';
      const medium = row.dimensionValues[1]?.value || '(unknown)';
      const key = `${source} / ${medium}`;

      const values = {};
      row.metricValues.forEach((v, i) => {
        values[metHeaders[i]] = parseFloat(v.value);
      });

      if (!sources[key]) sources[key] = {};
      // Determine if thisWeek or lastWeek based on dateRangeIndex
      const rangeKey = row.dimensionValues.length > 2 ? 'multi' : 'thisWeek';
      sources[key] = { ...sources[key], ...values, sourceMedium: key };
    }
    out.ga4TrafficBySource = bySource.rows.map(row => {
      const dims = {};
      bySource.dimensionHeaders.forEach((h, i) => { dims[h.name] = row.dimensionValues[i]?.value; });
      const mets = {};
      bySource.metricHeaders.forEach((h, i) => { mets[h.name] = parseFloat(row.metricValues[i]?.value); });
      return { ...dims, ...mets };
    });
  }

  // Parse traffic by page
  const byPage = data.ga4.trafficByPage;
  if (byPage?.rows) {
    out.ga4TrafficByPage = byPage.rows.map(row => {
      const dims = {};
      byPage.dimensionHeaders.forEach((h, i) => { dims[h.name] = row.dimensionValues[i]?.value; });
      const mets = {};
      byPage.metricHeaders.forEach((h, i) => { mets[h.name] = parseFloat(row.metricValues[i]?.value); });
      return { ...dims, ...mets };
    });
  }
}

// ─── Inspections ───
function analyzeInspections() {
  const inspections = data.gsc.inspections || {};
  out.inspections = {};
  for (const [url, insp] of Object.entries(inspections)) {
    if (insp.error) {
      out.inspections[url] = { error: insp.error };
      continue;
    }
    const ir = insp.inspectionResult || {};
    const idx = ir.indexStatusResult || {};
    const rich = ir.richResultsResult || {};
    out.inspections[url.replace('https://libertyvillage.co', '')] = {
      verdict: idx.verdict,
      coverageState: idx.coverageState,
      robotsTxtState: idx.robotsTxtState,
      indexingState: idx.indexingState,
      lastCrawlTime: idx.lastCrawlTime,
      pageFetchState: idx.pageFetchState,
      crawledAs: idx.crawledAs,
      richResultsVerdict: rich.verdict,
      richResultsItems: (rich.detectedItems || []).map(item => ({
        type: item.richResultType,
        items: (item.items || []).map(i => ({ name: i.name, issues: i.issues })),
      })),
    };
  }
}

// ─── Sitemaps ───
function analyzeSitemaps() {
  const sitemaps = data.gsc.sitemaps?.sitemap || [];
  out.sitemaps = sitemaps.map(s => ({
    path: s.path,
    lastDownloaded: s.lastDownloaded,
    submitted: s.contents?.[0]?.submitted,
    indexed: s.contents?.[0]?.indexed,
    errors: s.errors,
    warnings: s.warnings,
  }));
}

analyzeGSC();
analyzeGA4();
analyzeInspections();
analyzeSitemaps();

console.log(JSON.stringify(out, null, 2));
