# Step 1: SEO Data Collection

Collect search performance and analytics data to inform topic selection.

## 1.1 Google Search Console Data

Use the GSC MCP tools to pull data for **sc-domain:libertyvillage.co**:

### Search Analytics (last 7 days)
Call `mcp__gsc__search_analytics` with:
- `siteUrl`: `sc-domain:libertyvillage.co`
- `startDate`: 7 days ago (YYYY-MM-DD format)
- `endDate`: today (YYYY-MM-DD format)
- `dimensions`: `["query", "page"]`
- `rowLimit`: 100

This returns: queries, pages, impressions, clicks, CTR, position.

### Quick Wins (position 4-20, high impressions)
Call `mcp__gsc__detect_quick_wins` with:
- `siteUrl`: `sc-domain:libertyvillage.co`

This identifies pages ranking in positions 4-20 with high impressions but low CTR — prime targets for new content.

### Sitemap Status
Call `mcp__gsc__list_sitemaps` with:
- `siteUrl`: `sc-domain:libertyvillage.co`

Check how many URLs are submitted vs indexed.

## 1.2 Google Analytics 4 Data

Use the GA4 MCP tools for property **523614078**:

### Traffic Overview (last 7 days)
Call `mcp__google-analytics__run_report` with:
- `propertyId`: `523614078`
- `dateRanges`: `[{"startDate": "7daysAgo", "endDate": "today"}]`
- `dimensions`: `[{"name": "pagePath"}]`
- `metrics`: `[{"name": "sessions"}, {"name": "bounceRate"}, {"name": "screenPageViews"}]`
- `limit`: 50

## 1.3 Save Raw Data

Save the collected data to `tasks/seo-data-latest.json`:
```json
{
  "collectedAt": "ISO timestamp",
  "gsc": {
    "searchAnalytics": [...],
    "quickWins": [...],
    "sitemapStatus": {...}
  },
  "ga4": {
    "trafficByPage": [...]
  }
}
```

Use the Write tool to save this file.

## 1.4 Analysis Summary

Generate a brief analysis identifying:
- **Top performing queries**: Highest impressions/clicks
- **Content gaps**: Queries with impressions but no dedicated page on the site
- **Trending topics**: New queries appearing this week vs previous
- **Underperforming pages**: Pages with high impressions but low CTR (< 2%)

## 1.5 Fallback: No Data Available

If the site is new and GSC/GA4 returns no data (0 impressions, 0 sessions):
- Log: "No SEO data available — site is in early indexing phase"
- Skip the analysis summary
- Proceed to topic selection using evergreen topics (Step 2 will handle this)
- Do NOT fail the pipeline — no data is expected for new sites
