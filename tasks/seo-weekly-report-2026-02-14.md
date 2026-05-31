# SEO & AEO Weekly Report — libertyvillage.co

**Period**: Feb 7 - Feb 14, 2026
**Generated**: Feb 14, 2026

---

## 1. Executive Summary

- **First organic traffic arrived!** 9 sessions from Google organic, 2 from ChatGPT, and 1 from Perplexity — the site is now being discovered through both traditional search and AI answer engines.
- **Total sessions up 64%** — 36 sessions this week vs 22 last week, with non-direct traffic appearing for the first time.
- **35 unique search queries** generating ~65 impressions across Google Search — still 0 clicks, but strong positioning signals emerging.
- **"liberty village parking"** is the top query with 10 impressions at avg position 18 — the parking guide is the strongest page and closest to earning clicks.
- **Duplicate FAQPage schema still showing on `/best/restaurants`** — the fix was deployed but Google hasn't re-crawled yet (last crawl: Feb 8). Will resolve on next crawl.
- **Blog posts still not indexed** — both the transit guide and dog owners guide are "unknown to Google." Internal linking remains the top blocker.
- **Jukebox Print directory page earning Review Snippets** — first rich result beyond breadcrumbs/FAQ, a strong signal for directory pages.

---

## 2. Indexing Status

### Sitemap

| Metric | Value |
|--------|-------|
| Sitemap URL | https://libertyvillage.co/sitemap.xml |
| URLs Submitted | **177** |
| URLs Indexed (GSC report) | **0** (reporting lag — still catching up) |
| Last Downloaded | Feb 8, 2026 |
| Errors | 0 |
| Warnings | 0 |

### URL Inspection Results

| Page | Status | Last Crawled | Rich Results |
|------|--------|-------------|-------------|
| `/guide/parking-guide` | **Indexed** | Feb 8, 05:17 | FAQ + Breadcrumbs PASS |
| `/best/restaurants` | **Indexed** | Feb 8, 19:07 | **Duplicate FAQPage ERROR** (pre-fix) |
| `/directory/jukebox-print` | **Indexed** | Feb 8, 11:36 | Breadcrumbs + FAQ + **Review Snippets** PASS |
| `/blog/liberty-village-car-free-transit-guide-2026` | **Unknown** | Never | N/A |
| `/blog/dog-owners-guide-liberty-village` | **Unknown** | Never | N/A |

**Key observations:**
- Google hasn't re-crawled any pages since Feb 8 — the duplicate FAQPage fix (deployed ~Feb 10) hasn't been picked up yet. Should resolve on next crawl.
- **Jukebox Print** is the first directory page with Review Snippets rich results — this validates the LocalBusiness + AggregateRating schema.
- Blog posts remain completely undiscovered. Need stronger internal linking and/or manual indexing requests.

---

## 3. Search Performance (GSC)

### Query Summary

| Metric | This Week | Last Week | Change |
|--------|-----------|-----------|--------|
| Total Queries | **35** | 0 | **NEW** |
| Total Impressions | **~65** | 0 | **NEW** |
| Total Clicks | 0 | 0 | — |
| Avg CTR | 0% | — | — |

### Top Queries by Impressions

| Query | Impressions | Avg Position | Target Page |
|-------|------------|-------------|-------------|
| liberty village parking | **10** | 18.0 | `/guide/parking-guide` |
| jukebox print | 3 | 31.0 | `/directory/jukebox-print` |
| liberty village restaurants | 3 | 32.7 | `/best/restaurants` + `/directory` |
| parking liberty village toronto | 3 | 13.3 | `/guide/parking-guide` |
| restaurants near liberty village | 3 | 52.3 | `/best/restaurants` + `/directory` |
| best restaurants liberty village | 2 | 21.5 | `/best/restaurants` |
| free parking liberty village | 2 | 9.5 | `/guide/parking-guide` |
| impact liberty village | 2 | 16.5 | `/best/restaurants` |
| jukebox printing | 2 | 7.0 | `/directory/jukebox-print` |
| liberty village | 2 | 70.5 | `/` (homepage) |
| liberty village stores | 2 | 66.0 | `/` |
| parking in liberty village | 2 | 13.0 | `/guide/parking-guide` |
| parking near liberty village | 2 | 17.5 | `/guide/parking-guide` |

### Quick Wins (GSC Auto-Detected)

| Query | Impressions | Position | Opportunity |
|-------|------------|----------|-------------|
| **liberty village parking** | 10 | 18.0 | **High** — move into top 10 for clicks |
| parking liberty village toronto | 3 | 13.3 | Low — needs more impressions first |

### Keyword Clusters

**Parking cluster** (strongest — 5 query variants, ~21 total impressions):
- "liberty village parking" (10 imp, pos 18)
- "parking liberty village toronto" (3 imp, pos 13.3)
- "free parking liberty village" (2 imp, pos 9.5)
- "parking in liberty village" (2 imp, pos 13)
- "parking near liberty village" (2 imp, pos 17.5)
- All pointing to `/guide/parking-guide` — **best-performing page by far**

**Restaurant cluster** (6 query variants, ~12 total impressions):
- "liberty village restaurants" (3 imp, pos 32.7)
- "restaurants near liberty village" (3 imp, pos 52.3)
- "best restaurants liberty village" (2 imp, pos 21.5)
- "best restaurants in liberty village" (1 imp, pos 17)
- **Cannibalization issue**: "liberty village restaurants" appears on both `/best/restaurants` (pos 17) AND `/directory` (pos 63.5)

**Jukebox Print cluster** (branded queries, ~8 total impressions):
- "jukebox printing" (2 imp, pos 7)
- "jukebox print" (3 imp, pos 31)
- "jukebox print toronto" (1 imp, pos 8)
- "jukebox print location" (1 imp, pos 9)
- These are branded queries for a local business — high-value validation that directory pages work

### Keyword Cannibalization Alert

| Query | Page 1 | Position | Page 2 | Position |
|-------|--------|----------|--------|----------|
| liberty village restaurants | `/best/restaurants` | 17 | `/directory` | 63.5 |
| restaurants near liberty village | `/best/restaurants` | 43 | `/directory` | 71 |
| local liberty village | `/best/restaurants` | 42 | `/directory` | 80 |

The `/directory` page is competing with `/best/restaurants` for restaurant queries. This is diluting ranking signals. Consider adding `<link rel="canonical">` hints or differentiating content more clearly.

---

## 4. Traffic Overview (GA4)

### Week-over-Week Comparison

| Metric | This Week | Last Week | Change |
|--------|-----------|-----------|--------|
| Total Sessions | **36** | 22 | **+64%** |
| Total Users | **~28** | 16 | **+75%** |
| Page Views | **~97** | ~55 | **+76%** |
| Bounce Rate | 52% | 66% | **-14pp** (improved) |

### Traffic Sources (MILESTONE)

| Source / Medium | Sessions | Users | Page Views | Bounce Rate | Avg Duration |
|----------------|----------|-------|------------|-------------|-------------|
| (direct) / (none) | 24 | 18 | 79 | 67% | 3m 23s |
| **google / organic** | **9** | **7** | **15** | **33%** | **28s** |
| **chatgpt.com** | **2** | **2** | **2** | 100% | 0s |
| **perplexity** | **1** | **1** | **1** | 100% | 0s |

**Milestones achieved this week:**
1. **First Google organic sessions** — 9 sessions, 7 unique users, 33% bounce rate
2. **First AI engine referrals** — ChatGPT (2 sessions) + Perplexity (1 session) = 3 AEO referrals
3. Google organic users have a significantly **lower bounce rate (33%)** than direct (67%), suggesting search visitors find the content relevant

### Top Pages by Sessions

| Page | Sessions | Page Views | Bounce Rate | Avg Duration |
|------|----------|------------|-------------|-------------|
| `/` (homepage) | 28 | 48 | 61% | 2m 15s |
| `/blog` | 7 | 10 | 14% | 11s |
| `/directory` | 4 | 4 | 25% | 17s |
| `/guide/parking-guide` | 3 | 3 | 67% | 33s |
| `/best/dentists` | 2 | 2 | 0% | 5s |
| `/best/gyms` | 2 | 2 | 0% | **6m 42s** |
| `/best/restaurants` | 2 | 2 | 50% | 0s |
| `/blog/...car-free-transit-guide-2026` | 2 | 2 | 0% | 9s |
| `/directory/...townhouse` | 2 | 2 | 50% | 24s |
| `/guide/moving-guide` | 2 | 2 | 0% | 2s |

**Notable:**
- Homepage bounce rate improved from 79% to 61% (week-over-week)
- `/blog` index page bounce rate dropped from 75% to **14%** — people are clicking through to posts
- `/best/gyms` continues strong engagement (6m 42s avg session)
- New blog post (transit guide) got 2 sessions — first auto-published post getting traffic
- 30 unique pages received at least 1 session (up from ~10 last week) — deeper site exploration

---

## 5. Structured Data Status

### Duplicate FAQPage — Update

**Status**: Fix deployed (~Feb 10), awaiting Google re-crawl.

The fix removed duplicate `generateFAQSchema()` script tags from `/best/[service]/page.tsx` and `/vs/[neighborhood]/page.tsx`. The FAQSection component now solely handles FAQ schema injection.

Last crawl of `/best/restaurants` was Feb 8 (pre-fix). Once Google re-crawls these pages, the duplicate error should clear. We'll verify next week.

### Review Snippets — NEW

`/directory/jukebox-print` is now showing **Review Snippets** rich results. This is the first directory page to earn this treatment, validating the LocalBusiness + AggregateRating structured data approach. As more directory pages get crawled, expect more Review Snippets to appear.

---

## 6. Blog Indexing Gap (PERSISTENT)

| Blog Post | Indexed? | Sessions This Week |
|-----------|----------|-------------------|
| `/blog/liberty-village-car-free-transit-guide-2026` | **Unknown to Google** | 2 (direct) |
| `/blog/dog-owners-guide-liberty-village` | **Unknown to Google** | 1 (direct) |
| All other blog posts | Likely unknown | — |

The `/blog` index page is driving 7 sessions (14% bounce — users click through), but individual posts are still not being discovered by Googlebot. This is the biggest SEO gap on the site.

---

## 7. AEO (AI Engine Optimization) Performance

This week marks the site's **first AI engine referrals**:

| AI Engine | Sessions | Pages Visited |
|-----------|----------|--------------|
| ChatGPT | 2 | Unknown (likely guide/service pages) |
| Perplexity | 1 | Unknown |

This is significant — the AnswerBlock component and Speakable schema are designed to make the site cite-worthy for AI engines. These early referrals validate the approach. To grow AEO traffic:
- Ensure AnswerBlock content is concise, factual, and citable
- Monitor which pages AI engines reference (not yet available in GSC)
- The parking guide and restaurant pages are the most likely candidates being cited

---

## 8. Recommended Actions (Priority Order)

### P0 — Fix This Week

1. **Improve blog internal linking** (CARRYOVER — escalated to P0)
   - Add "Latest from the Blog" section to homepage
   - Add contextual blog post links to related `/best/*` and `/guide/*` pages
   - This is the **#1 blocker** for blog indexing — blog posts have essentially zero internal links pointing to them
   - Blog content is getting direct traffic (7+ sessions on `/blog`) but Google can't find individual posts

2. **Request indexing for blog posts**
   - Use GSC URL Inspection > "Request Indexing" for each of the 12 blog posts
   - Priority posts: transit guide, dog owners guide, FIFA World Cup guide

### P1 — High Priority

3. **Optimize parking guide for click-through**
   - "liberty village parking" cluster has 21+ impressions at positions 9.5-18
   - This is the closest page to earning first organic clicks
   - Consider: update title tag to include "Free Parking" variant, add more comprehensive parking options, update `updatedAt` date
   - Target: position 5-10 to start earning clicks

4. **Fix keyword cannibalization on restaurant queries**
   - `/directory` is competing with `/best/restaurants` for restaurant queries
   - `/directory` ranks poorly (pos 63-92) but splits signals
   - Fix: Ensure `/directory` doesn't target restaurant-specific keywords; consider `noindex` for `/directory` or making it clearly distinct from category pages

### P2 — This Sprint

5. **Verify FAQPage fix on next crawl**
   - Monitor `/best/restaurants` and `/vs/king-west` for re-crawl
   - Once re-crawled, verify "Duplicate FAQPage" error clears
   - If not cleared by Feb 21, investigate further

6. **Consolidate www vs non-www** (CARRYOVER)
   - GSC shows crawl data from `www.libertyvillage.co` URLs (parking guide, homepage)
   - Ensure 301 redirect from www to non-www to consolidate link equity

7. **Expand directory page Review Snippets**
   - Jukebox Print has Review Snippets — verify other high-traffic directory pages also trigger this
   - Focus on businesses with Google ratings already in the data

### P3 — Track & Revisit

8. **Track first organic click milestone**
   - At current trajectory, expect first clicks within 1-2 weeks
   - Parking guide at position 9.5 ("free parking liberty village") is the most likely candidate
   - Set alert for CTR > 0 on any query

9. **Monitor AI engine referrals growth**
   - Track ChatGPT + Perplexity sessions weekly
   - Consider adding more AnswerBlock content to high-value pages
   - AEO is a differentiator — most local sites don't optimize for this

---

## 9. Automated Blog Pipeline Status

No new pipeline run this week (next scheduled: **Sunday, Feb 15 at 6am ET**).

Previous run (Feb 9):

| Metric | Value |
|--------|-------|
| Post Generated | "Getting Around Liberty Village Car-Free: 2026 Transit Guide" |
| Category | transit |
| Cost | $1.30 |
| Duration | 6m 19s |
| Status | Published and pushed to main |

---

## 10. Week-over-Week Trend

| Metric | Week 1 (Feb 2-8) | Week 2 (Feb 7-14) | Trend |
|--------|-------------------|---------------------|-------|
| Sessions | 22 | 36 | +64% |
| Users | 16 | ~28 | +75% |
| Page Views | ~55 | ~97 | +76% |
| Google Organic Sessions | 0 | **9** | NEW |
| AI Engine Sessions | 0 | **3** | NEW |
| Search Impressions | 0 | ~65 | NEW |
| Search Clicks | 0 | 0 | — |
| Unique Queries | 0 | 35 | NEW |
| Pages with Sessions | ~10 | 30 | +200% |

The site is progressing through the typical new-site SEO timeline on schedule. First impressions appeared in week 2, and first clicks should follow in weeks 3-4 if the parking guide continues climbing.

---

*Report generated from GSC (sc-domain:libertyvillage.co) and GA4 (property 523614078)*
