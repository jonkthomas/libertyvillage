# Weekly Blog Pipeline — Usage Guide

## Automatic Runs

The pipeline runs automatically every Sunday at 11:00 UTC (6:00 AM ET) via GitHub Actions cron.

No action needed — it will:
1. Collect SEO data from GSC and GA4
2. Select the best topic based on data
3. Generate a complete blog post
4. Source a hero image
5. Validate and commit to main
6. Vercel auto-deploys

## Manual Trigger

### Via GitHub Actions UI

1. Go to **Actions** → **Weekly Blog Pipeline** → **Run workflow**
2. Optionally fill in:
   - **topic_override**: Force a specific topic (e.g., "Best patios in Liberty Village for summer 2026")
   - **dry_run**: Set to `true` to generate without committing

### Via GitHub CLI

```bash
# Normal run
gh workflow run weekly-blog.yml

# With topic override
gh workflow run weekly-blog.yml -f topic_override="Best coffee shops near the park"

# Dry run (generate but don't commit)
gh workflow run weekly-blog.yml -f dry_run=true

# Override + dry run
gh workflow run weekly-blog.yml -f topic_override="Liberty Village summer events" -f dry_run=true
```

### Local Development

```bash
# Set required env vars
export ANTHROPIC_API_KEY="your-key"
export GOOGLE_APPLICATION_CREDENTIALS="./gcp-credentials.json"
export GA_PROPERTY_ID="523614078"
export PEXELS_API_KEY="your-key"

# Extract GA4 credentials from service account
export GA4_CLIENT_EMAIL=$(jq -r '.client_email' gcp-credentials.json)
export GA4_PRIVATE_KEY=$(jq -r '.private_key' gcp-credentials.json)

# Normal run
node scripts/weekly-blog-agent.js

# With topic override
TOPIC_OVERRIDE="Best patios in Liberty Village" node scripts/weekly-blog-agent.js

# Dry run
DRY_RUN=true node scripts/weekly-blog-agent.js

# Override + dry run (recommended for testing)
TOPIC_OVERRIDE="Test topic" DRY_RUN=true node scripts/weekly-blog-agent.js
```

## Output Files

| File | Description |
|------|-------------|
| `tasks/auto-blog-runs/{date}.json` | Run log with cost, status, errors |
| `tasks/seo-data-latest.json` | Raw SEO data from last run |
| `tasks/auto-blog-dry-run.json` | Output from dry runs (not committed) |
| `data/posts.json` | Updated with new post (normal runs only) |
| `public/images/blog/{slug}.jpg` | Hero image for new post |

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for Agent SDK |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full GCP service account JSON |
| `GA_PROPERTY_ID` | Google Analytics 4 property ID (523614078) |
| `PEXELS_API_KEY` | Pexels stock photo API key |

## Monitoring

- Check GitHub Actions for run status and logs
- Run logs saved to `tasks/auto-blog-runs/` with cost and outcome data
- GitHub Actions step summary shows topic, cost, and status
- Failed runs trigger GitHub's built-in failure notifications

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Pipeline times out | Check if MCP servers are responding. Increase timeout in workflow. |
| Budget exceeded | Check `tasks/auto-blog-runs/` logs for cost trends. Adjust maxBudgetUsd. |
| Bad cross-references | Run `node scripts/diagnostic.js` locally to check data integrity. |
| Image sourcing fails | Check Pexels API key validity. Pipeline falls back to branded cards. |
| Build fails | Run `npm run build` locally to debug. Usually a data issue. |
