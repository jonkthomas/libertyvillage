# Weekly SEO & AEO Monitoring Report

Generate a comprehensive weekly SEO and AEO monitoring report for libertyvillage.co using Google Search Console and Google Analytics 4 data.

## Configuration

- **GSC Site URL**: `sc-domain:libertyvillage.co`
- **GA4 Property ID**: `523614078`
- **Report Output**: `tasks/seo-weekly-report-YYYY-MM-DD.md`

## Instructions

### Step 1: Pull GSC Search Analytics (Last 7 Days vs Previous 7 Days)

Use the `mcp__gsc__search_analytics` tool to get performance data:

```
Site URL: sc-domain:libertyvillage.co
Date range: last 7 days
Dimensions: query, page
Metrics: clicks, impressions, ctr, position
```

Also pull the previous 7-day period for comparison.

### Step 2: Identify Quick Wins

Use `mcp__gsc__enhanced_search_analytics` with `enableQuickWins: true`:

```
Site URL: sc-domain:libertyvillage.co
```

Quick wins are queries where:
- Position is between 4 and 20 (page 1-2, not yet #1-3)
- Impressions > 50
- CTR < 5%

These represent the highest-ROI optimization targets.

### Step 3: Pull GA4 Traffic Data

Use `mcp__google-analytics__run_report`:

```
Property ID: 523614078
Metrics: sessions, totalUsers, bounceRate, averageSessionDuration, screenPageViews
Dimensions: pagePath, sessionSource
Date range: last 7 days
```

### Step 4: Pull GA4 Engagement Data

Use `mcp__google-analytics__run_report`:

```
Property ID: 523614078
Metrics: sessions, bounceRate, averageSessionDuration
Dimensions: pagePath
Date range: last 7 days
Order by: sessions DESC
```

### Step 5: Generate Report

Create the report file at `tasks/seo-weekly-report-YYYY-MM-DD.md` with these sections:

#### 1. Executive Summary
- 3-5 key findings from the week
- Overall traffic trend (up/down/flat)
- Most notable changes

#### 2. Quick Wins (High-Impact Optimization Targets)
Table with columns: Query | Current Position | Impressions | CTR | Page | Recommended Action

Focus on queries ranking 4-20 with high impressions and low CTR. These pages need:
- Better title tags matching the query
- Answer block optimization for the specific query
- Meta description improvements

#### 3. Position Movers (Week-over-Week Changes)
Table with columns: Query | Previous Position | Current Position | Change | Page

Highlight:
- Biggest gains (position improvements)
- Biggest drops (position declines)
- New queries appearing for the first time

#### 4. Content Decay Alerts
Flag pages where:
- Clicks dropped > 20% week-over-week
- Position dropped > 3 spots
- Impressions declining for 2+ consecutive weeks

For each decaying page, suggest a specific refresh action.

#### 5. Engagement Issues
From GA4 data, flag pages with:
- Bounce rate > 70%
- Average session duration < 30 seconds
- High traffic but low engagement

#### 6. Keyword Cannibalization
Identify queries where 2+ pages from the site appear. This means pages are competing with each other. For each case, recommend which page should be the primary target.

#### 7. Recommended Actions
Prioritized list of 5-10 specific actions for the coming week, ordered by expected impact:
- Title/meta optimizations for quick wins
- Content refreshes for decaying pages
- Internal linking improvements
- New content opportunities based on impression data
- Technical fixes if any

### Handling "No Data Yet" Scenario

If the site is new and GSC/GA4 returns minimal or no data:
1. Note that the site is in the indexing phase
2. Report on indexing status (pages indexed vs submitted)
3. Use `mcp__gsc__index_inspect` to check indexing status of key pages
4. Check sitemap status with `mcp__gsc__list_sitemaps`
5. Provide recommendations for accelerating indexing
6. Set baseline expectations (typically 2-4 weeks for initial indexing)

### Report Format

Use clean markdown with:
- Tables for data presentation
- Bold for important numbers
- Links to specific pages where relevant
- Date range clearly stated at the top
- Comparison percentages (e.g., "+15% vs last week")
