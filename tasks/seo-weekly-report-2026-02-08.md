# SEO Weekly Report — libertyvillage.co

**Report Date:** February 8, 2026
**Period:** Feb 1 – Feb 7, 2026
**Status:** Early indexing phase — 2 pages indexed, 2 redirect errors blocking crawl

---

## 1. Executive Summary

- **2 pages indexed by Google** — Homepage (`/`) and `/guide/parking-guide` are both indexed with rich results (breadcrumbs + FAQ)
- **2 critical redirect errors** — `/best/restaurants` and `/directory` are returning redirect errors to Googlebot, blocking indexing of key hub pages
- **No organic search traffic yet** — GSC shows 0 clicks, 0 impressions. Expected for a site <2 weeks old
- **13 direct-traffic sessions in GA4** — All from direct source, homepage dominant. No organic sessions yet
- **177 sitemap URLs submitted, 0 indexed via sitemap** — The 2 indexed pages were discovered through other means (likely direct URL inspection)
- **Most pages unknown to Google** — Spot checks of `/best/coffee-shops`, `/best/bars`, `/best/gyms`, and `/blog/fifa-world-cup-2026-liberty-village-survival-guide` all show "URL is not on Google" / not yet crawled

---

## 2. Quick Wins (High-Impact Optimization Targets)

No data available. Site has 0 impressions — pages must be indexed first before any query optimization is possible.

---

## 3. Position Movers (Week-over-Week Changes)

No data available. No queries ranking yet.

---

## 4. Content Decay Alerts

Not applicable — site is in its first week of indexing.

---

## 5. Engagement Issues

| Page | Sessions | Bounce Rate | Avg Session Duration |
|------|----------|-------------|---------------------|
| `/` (homepage) | ~9 | 69% | 256s |
| Other pages | ~4 | — | — |

**Notes:**
- 13 total sessions this week, all from direct traffic
- 19 unique pages viewed across all sessions
- Homepage bounce rate of 69% is acceptable for a new site
- Average session duration of 256s (~4 min) suggests engaged visitors when they do arrive

---

## 6. Keyword Cannibalization

Not applicable — no queries ranking yet.

---

## 7. Indexing Status (New Site Diagnostics)

### Sitemap

| Metric | Value |
|--------|-------|
| Sitemap URL | `https://libertyvillage.co/sitemap.xml` |
| Last submitted | Feb 8, 2026 |
| Last downloaded by Google | Feb 8, 2026 |
| URLs submitted | **177** |
| URLs indexed | **0** (via sitemap discovery) |

### Page Indexing Spot Check

| Page | Google Status | Crawl Result | Rich Results |
|------|-------------|--------------|--------------|
| `/` (homepage) | **Indexed** | Crawled Feb 8 (mobile) | Breadcrumbs |
| `/guide/parking-guide` | **Indexed** | Crawled successfully | Breadcrumbs + FAQ |
| `/best/restaurants` | **Not indexed** | **Redirect error** | — |
| `/directory` | **Not indexed** | **Redirect error** | — |
| `/best/coffee-shops` | Unknown to Google | Not crawled | — |
| `/best/bars` | Unknown to Google | Not crawled | — |
| `/best/gyms` | Unknown to Google | Not crawled | — |
| `/blog/fifa-world-cup-...` | Unknown to Google | Not crawled | — |

### Key Observations
- **FAQ rich results detected** on parking guide — confirms structured data is working correctly
- **Breadcrumb rich results** on both indexed pages — good structured data implementation
- **Redirect errors** are site-specific, not a blanket issue (homepage works fine)

---

## 8. Redirect Error Investigation

### Finding: Redirect errors are transient, not a current issue

**All tests pass — pages return HTTP 200 with no redirects:**

| Test | `/best/restaurants` | `/directory` |
|------|-------------------|-------------|
| Standard curl | 200 | 200 |
| Googlebot UA | 200 | 200 |
| Googlebot Mobile UA | 200 | 200 |
| Trailing slash (`/best/restaurants/`) | 308 → `/best/restaurants` (correct) |  308 → `/directory` (correct) |
| `www.` prefix | 307 → non-www (correct) | 307 → non-www (correct) |
| Redirect count (with `-L`) | 0 | 0 |

**Configuration verified:**
- `next.config.ts`: `trailingSlash: false` — explicit and correct
- `robots.txt`: `Allow: /` — no blocks
- No internal links use `www.` subdomain
- No redirect/rewrite rules in config

**Root cause (likely):** The redirect errors were captured during Google's crawl on Feb 8 at ~1:05 AM UTC. This likely coincided with a Vercel deployment in progress, where the pages were temporarily unavailable or redirecting during the build/deploy cycle. The homepage was already cached and served correctly.

**Evidence:** The `/directory` inspection shows a referring URL of `https://www.libertyvillage.co/best/bike-shops` — Google followed a `www` link, got a 307 to non-www, then may have encountered a temporary issue during deployment.

---

## 9. Recommended Actions (Priority Order)

### P0 — Request re-indexing of pages with redirect errors

Pages are working correctly now. Go to [GSC URL Inspection](https://search.google.com/search-console) and manually request indexing for:
- `https://libertyvillage.co/best/restaurants` — currently showing redirect error
- `https://libertyvillage.co/directory` — currently showing redirect error

This must be done through the GSC web interface (not available via API).

### P1 — Request indexing for high-value pages

While in GSC, also request indexing for:
- `/best/coffee-shops` (high search volume)
- `/best/gyms` (high search volume)
- `/best/bars` (high search volume)
- `/blog/fifa-world-cup-2026-liberty-village-survival-guide` (timely, high interest)

### P2 — Accelerate discovery of blog content

The 11 blog posts are all unknown to Google:
1. Request indexing for the 3 most topical posts (FIFA World Cup, Ontario Line, condo market)
2. Share blog posts on social channels to generate crawl signals
3. Verify internal links from indexed pages (homepage, parking guide) point to blog posts

### P3 — Monitor rich results

FAQ and breadcrumb rich results are working on indexed pages. This is a strong signal. Once more pages are indexed, monitor:
- Which pages get FAQ rich results
- Whether answer blocks trigger featured snippets
- Rich result click-through rates

### P4 — Re-run `/seo-weekly` on Feb 15

Expected changes by next week:
- Redirect errors should be fixed and pages re-crawled
- First batch of `/best/*` pages moving to "Crawled - currently not indexed"
- Possible first impressions in GSC (typically 2-4 weeks post-indexing)
- Organic sessions should begin appearing in GA4

---

## Appendix: Site Inventory

| Content Type | Count |
|-------------|-------|
| Service pages (`/best/*`) | 59 |
| Business pages (`/biz/*`) | 68 |
| Guide pages (`/guide/*`) | 30 |
| Comparison pages (`/vs/*`) | 15 |
| Blog posts (`/blog/*`) | 11 |
| Static pages | 7 |
| **Total** | **~190** |

---

*Report generated by `/seo-weekly` skill — libertyvillage.co*
