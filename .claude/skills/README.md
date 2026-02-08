# libertyvillage.co — Claude Code Skills

Weekly skills for monitoring SEO performance and generating fresh content. Run these inside Claude Code from the `/workspace/libertyvillage` directory.

## Weekly Workflow

Run these two skills every week in this order:

### 1. `/seo-weekly` — SEO Monitoring Report

**When**: Monday morning (or any consistent day)

**What it does**: Pulls live data from Google Search Console and GA4, then generates a report covering:
- Quick wins (pages ranking 4-20 with low CTR)
- Position movers (week-over-week ranking changes)
- Content decay alerts (declining pages)
- Engagement issues (high bounce rate pages)
- Keyword cannibalization
- Recommended actions for the week

**How to run**:
```
/seo-weekly
```

**Output**: Saves report to `tasks/seo-weekly-report-YYYY-MM-DD.md`

**What to do with it**: Read the recommended actions section. If quick wins are identified, update the title tags and meta descriptions on those pages. If content decay is flagged, refresh those pages.

---

### 2. `/lv-pulse` — Autonomous Blog Post Generator

**When**: After reviewing the SEO report (same day or mid-week)

**What it does**: Researches trending Liberty Village topics across Reddit, X, Google News, and your own GSC/GA4 data, then automatically:
1. Picks the highest-value topic not already covered
2. Generates an AEO-optimized blog post (800-1200 words, answer block, 5 FAQs, schema markup)
3. Adds it to `data/posts.json`
4. Verifies the build succeeds
5. Outputs a report of what was published and why

**How to run**:
```
/lv-pulse
```

**Output**: New blog post added to `data/posts.json`, build verified, summary report printed.

**What to do with it**: Review the generated post for accuracy, then commit and push to deploy:
```
git add data/posts.json && git commit -m "Add blog post: [title]" && git push
```

---

## Prerequisites

Both skills require these MCP servers to be configured (already set up in `.mcp.json`):

| MCP Server | Used By | Purpose |
|------------|---------|---------|
| `gsc` | Both | Google Search Console data |
| `google-analytics` | Both | GA4 traffic and engagement data |

Credentials: `gcp-credentials.json` in the project root (already configured).

## Skill Files

| Skill | File | Description |
|-------|------|-------------|
| `/seo-weekly` | `.claude/skills/seo-weekly/SKILL.md` | Weekly SEO monitoring report |
| `/lv-pulse` | `.claude/skills/lv-pulse/SKILL.md` | Autonomous blog post generator |

## Site Configuration

- **Domain**: libertyvillage.co
- **GSC Property**: sc-domain:libertyvillage.co
- **GA4 Property ID**: 523614078
- **Tech Stack**: Next.js 16 + React 19 + Tailwind CSS v4
- **Pages**: 183 (59 services, 76 businesses, 24 topics, 15 comparisons, 7 static, 1 blog index, 1 blog post)
