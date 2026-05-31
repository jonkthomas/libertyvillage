# SEO & AEO Weekly Report — libertyvillage.co

**Period**: Feb 2 - Feb 8, 2026
**Generated**: Feb 9, 2026

---

## 1. Executive Summary

- **Site is in early indexing phase** — Google has crawled and indexed key pages but organic search traffic has not started yet. All 22 sessions this week were direct traffic.
- **177 URLs submitted via sitemap**, but GSC sitemap report shows **0 indexed**. However, individual URL inspections confirm at least 5 key pages ARE indexed — this is a typical GSC reporting lag for new sites.
- **Duplicate FAQPage schema errors** detected on `/best/*` and `/vs/*` page templates — this is blocking FAQ rich results on ~75 pages and should be the top priority fix.
- **Blog posts not yet indexed** — the FIFA World Cup blog post is "unknown to Google", meaning blog content hasn't been discovered yet.
- **No organic search queries** recorded in GSC for either week — expected for a site less than 2 weeks old.

---

## 2. Indexing Status

### Sitemap

| Metric | Value |
|--------|-------|
| Sitemap URL | https://libertyvillage.co/sitemap.xml |
| URLs Submitted | **177** |
| URLs Indexed (GSC report) | **0** (reporting lag) |
| Last Downloaded | Feb 8, 2026 |
| Errors | 0 |
| Warnings | 0 |

### URL Inspection Results

| Page | Status | Last Crawled | Rich Results |
|------|--------|-------------|-------------|
| `/` (homepage) | **Indexed** | Feb 8, 10:53 | Breadcrumbs PASS |
| `/best/restaurants` | **Indexed** | Feb 8, 19:07 | **Duplicate FAQPage ERROR** |
| `/guide/parking-guide` | **Indexed** | Feb 8, 05:17 | FAQ + Breadcrumbs PASS |
| `/vs/king-west` | **Indexed** | Feb 8, 02:19 | **Duplicate FAQPage ERROR** |
| `/directory` | **Indexed** | Feb 8, 19:09 | Breadcrumbs PASS |
| `/blog/fifa-world-cup...` | **Unknown to Google** | Never | N/A |

All indexed pages were crawled as **mobile-first** (Googlebot smartphone).

---

## 3. Search Performance (GSC)

**No organic search query data available.** This is expected — the site was submitted to GSC approximately 1-2 weeks ago. Typical timeline:

- **Week 1-2**: Google discovers and crawls pages (current phase)
- **Week 2-4**: Pages start appearing in search results with low positions
- **Week 4-8**: Positions stabilize, impressions grow

### Quick Wins

No quick wins detected — the site hasn't accumulated enough impression data yet.

---

## 4. Traffic Overview (GA4)

### This Week Summary

| Metric | Value |
|--------|-------|
| Total Sessions | **22** |
| Total Users | **16** |
| Total Page Views | **~55** |
| Avg Session Duration | **varies (see below)** |

### Traffic Sources

| Source | Sessions | Users |
|--------|----------|-------|
| (direct) | 19 | 16 |
| (not set) | 3 | 2 |

**100% direct traffic** — no organic, social, or referral sources yet.

### Top Pages by Sessions

| Page | Sessions | Bounce Rate | Avg Duration |
|------|----------|-------------|-------------|
| `/` | 19 | 79% | 2m 55s |
| `/blog` | 4 | 75% | 14.5s |
| `/best/dentists` | 2 | 0% | 5.0s |
| `/directory` | 2 | 0% | 25.4s |
| `/best/gyms` | 1 | 0% | **13m 23s** |
| `/best/veterinarians` | 1 | 0% | 1m 34s |
| `/directory/modern-liberty-village-townhouse` | 1 | 0% | 38.9s |

Notable: `/best/gyms` had a 13+ minute session — likely someone thoroughly reading the page. Good content signal.

### Engagement Concerns

| Page | Issue |
|------|-------|
| `/` (homepage) | 79% bounce rate — high but normal for new sites with direct traffic |
| `/blog` | 75% bounce rate, only 14.5s avg duration |
| `/best/dog-groomers` | 100% bounce, 0s duration |
| `/guide/parking-guide` | 100% bounce, 0s duration |

These are low-volume so not actionable yet — need more data.

---

## 5. Structured Data Issues (CRITICAL)

### Duplicate FAQPage Schema

**Affected templates**: `/best/[service]` (~60 pages), `/vs/[neighborhood]` (~15 pages)

**Error**: "Duplicate field FAQPage" — Google is detecting two FAQPage JSON-LD blocks on the same page.

**Impact**: FAQ rich results are being **rejected** on these pages. This means no FAQ snippets in search results for ~75 pages that have FAQ content.

**Root cause**: Likely the FAQSection component injects its own FAQPage schema AND the page template also generates a FAQPage schema via `generateFAQSchema()`, resulting in duplicates.

**Fix**: Remove the schema from either the FAQSection component or the page template — only one FAQPage schema per page.

**Pages unaffected**: `/guide/*` pages have FAQPage schema working correctly (PASS).

---

## 6. Blog Indexing Gap

The blog section (`/blog/*`) has **11 published posts** but the inspected blog post (`/blog/fifa-world-cup-2026-liberty-village-survival-guide`) is **"unknown to Google"**.

Possible reasons:
- Blog pages may not have enough internal links pointing to them
- Blog index page (`/blog`) is indexed, but individual posts may not be linked from the sitemap effectively
- Posts are newer and haven't been crawled yet

---

## 7. Recommended Actions (Priority Order)

### P0 — Fix This Week

1. **Fix duplicate FAQPage schema** on `/best/*` and `/vs/*` templates
   - Check `components/FAQSection.tsx` and page templates for duplicate JSON-LD injection
   - Only one FAQPage schema should exist per page
   - Affects ~75 pages — biggest SEO impact fix available

### P1 — High Priority

2. **Improve blog internal linking**
   - Add "Latest from the Blog" section to homepage linking to recent posts
   - Add blog post links to related `/best/*` and `/guide/*` pages
   - This helps Google discover and index blog content faster

3. **Submit individual blog post URLs for indexing**
   - Use GSC URL Inspection > "Request Indexing" for each blog post
   - Or use the GSC API's `index_inspect` with indexing requests

### P2 — This Sprint

4. **Add www redirect**
   - GSC shows referring URLs from both `libertyvillage.co` and `www.libertyvillage.co`
   - Ensure www redirects to non-www (or vice versa) to consolidate link equity

5. **Monitor indexing progress**
   - Re-check sitemap indexed count next week
   - Target: 50+ pages indexed by week 3

6. **Build initial backlinks**
   - Submit to Toronto local directories
   - Share on Toronto subreddit / community forums
   - This will accelerate indexing and provide referral traffic signals

### P3 — Track & Revisit

7. **Set up baseline tracking** for when organic traffic begins
   - Create a GSC filter for brand queries ("liberty village")
   - Track first organic click milestone

8. **Content freshness signals**
   - Update `updatedAt` dates on key pages monthly
   - Prioritize guides (parking, moving, transit) that have evergreen search demand

---

## 8. Automated Blog Pipeline Status

The weekly blog pipeline ran successfully today (Feb 9):

| Metric | Value |
|--------|-------|
| Post Generated | "Getting Around Liberty Village Car-Free: 2026 Transit Guide" |
| Category | transit |
| Cost | $1.30 |
| Duration | 6m 19s |
| Image | Sourced successfully |
| Status | Published and pushed to main |

Next auto-run: **Sunday, Feb 15 at 6am ET**.

---

*Report generated from GSC (sc-domain:libertyvillage.co) and GA4 (property 523614078)*
