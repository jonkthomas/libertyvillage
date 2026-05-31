# PRD: Automated Weekly Blog Pipeline

**Project:** libertyvillage.co — Autonomous Content Engine
**Author:** Content Automation Team
**Date:** February 8, 2026
**Status:** Draft
**Technical Design:** [design-auto-blog-pipeline.md](./design-auto-blog-pipeline.md)

---

## 1. Problem Statement

libertyvillage.co currently requires manual intervention to create blog content. Each blog post requires:
- Running `/seo-weekly` to gather GSC + GA4 performance data
- Analyzing SEO data to identify the best topic opportunity
- Running `/lv-pulse` to generate the blog post with proper cross-references
- Sourcing and downloading a hero image
- Updating `posts.json`, validating the build, and deploying

This process takes 30-60 minutes of hands-on time per post and requires a human to initiate it. The site needs consistent weekly content to build SEO authority, but manual execution leads to inconsistent publishing cadence.

## 2. Solution

Build an automated pipeline that runs every Sunday via GitHub Actions, using the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) to orchestrate a multi-agent workflow that:

1. **Collects SEO data** from Google Search Console and Google Analytics 4 via MCP servers
2. **Analyzes opportunities** to select the highest-value blog topic for the week
3. **Generates a complete blog post** following the existing `BlogPost` TypeScript interface with full cross-references
4. **Sources a hero image** via web search + download agents (WebSearch to find images, Playwright to capture/download), with branded card fallback
5. **Validates and publishes** by updating `posts.json`, running diagnostics, building, and committing to `main`

Vercel auto-deploys on push to `main`, completing the publish cycle.

### How the Scheduler Works

**GitHub Actions cron** is the scheduler — no external service needed. The workflow file specifies `schedule: - cron: '0 11 * * 0'` which tells GitHub to automatically trigger the workflow every Sunday at 11:00 UTC (6am ET). After the agent generates content and pushes to `main`, **Vercel's git integration** detects the push and auto-rebuilds/deploys the site. The full chain:

```
GitHub cron (Sunday 6am) → Agent SDK runs → git push to main → Vercel auto-deploy → Live on libertyvillage.co
```

Manual runs are also supported via `workflow_dispatch` — you can trigger from the GitHub Actions UI anytime.

## 3. Goals & Non-Goals

### Goals
- Publish 1 high-quality, SEO-optimized blog post per week without human intervention
- Use real GSC/GA4 data to drive topic selection (data-driven content strategy)
- Maintain cross-referencing integrity with existing services, topics, businesses, and posts
- Keep per-run cost under $2.00 USD
- Run reliably in GitHub Actions CI environment
- Design for agent swarming — user stories are parallelizable where possible

### Non-Goals
- Real-time content generation (webhook-triggered)
- Multi-post generation per run (keep it to 1 post/week for quality)
- Replacing the manual `/lv-pulse` skill (this automates it, doesn't replace it)
- Social media distribution (future phase)
- Content update/refresh automation (future phase)

## 4. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│  GitHub Actions (cron: Sunday 6am ET)                │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  weekly-blog-agent.js                          │  │
│  │  (Claude Agent SDK orchestrator)               │  │
│  │                                                │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────────┐  │  │
│  │  │ GSC MCP │  │ GA4 MCP  │  │ Playwright   │  │  │
│  │  │ Server  │  │ Server   │  │ MCP Server   │  │  │
│  │  └─────────┘  └──────────┘  └──────────────┘  │  │
│  │                                                │  │
│  │  Tools: Read, Write, Edit, Bash, Glob, Grep,   │  │
│  │         WebSearch, WebFetch                     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  git commit + push → Vercel auto-deploy              │
└──────────────────────────────────────────────────────┘
```

See **[Technical Design Document](./design-auto-blog-pipeline.md)** for detailed architecture, data models, sequence diagrams, and implementation specifications.

## 5. User Stories

User stories are structured for **parallel agent swarming**. Stories within the same phase can be executed concurrently by independent agents. Cross-phase dependencies are noted.

---

### Phase 0: SDK Verification Spike (Must Complete First)

This phase de-risks the entire project by verifying the Claude Agent SDK works as expected.

#### US-0: Claude Agent SDK Verification Spike
**As a** developer,
**I want** to install and test the Claude Agent SDK with a minimal agent that uses MCP servers,
**So that** we verify the API surface before building the full pipeline.

**Acceptance Criteria:**
- [ ] Install `@anthropic-ai/claude-agent-sdk` and verify the package exports
- [ ] Create `scripts/test-agent-sdk.js` — a minimal test script that:
  1. Initializes the SDK with `query()` (or whatever the actual entry point is)
  2. Configures the GSC MCP server with `gcp-credentials.json`
  3. Configures the GA4 MCP server with extracted credentials
  4. Uses `ANTHROPIC_API_KEY` for authentication
  5. Sends a simple prompt: "Read data/posts.json and tell me how many posts exist"
  6. Verifies the agent can use Read tool and return a result
  7. Verifies MCP server connections succeed (check init message)
  8. Reports cost and turns used
- [ ] Run the test script locally and confirm it works end-to-end
- [ ] Document the verified API surface: actual function names, option shapes, message types
- [ ] Update the technical design document if the API differs from assumptions
- [ ] Test with `permissionMode: "bypassPermissions"` to verify autonomous operation
- [ ] Verify `maxBudgetUsd` and `maxTurns` limits work as expected

**Credentials for testing:**
- Anthropic API Key: set as `ANTHROPIC_API_KEY` env var
- GCP credentials: `/workspace/libertyvillage/gcp-credentials.json`
- GA4 Property ID: `523614078`
- GSC Site URL: `sc-domain:libertyvillage.co`
- Pexels API Key: set as `PEXELS_API_KEY` env var (verified: 25,000 req/month, images download correctly)

**Agent Swarming:** Must complete before all other phases. Blocking dependency for US-2.

---

### Phase 1: Foundation (Parallel — Depends on Phase 0)

These stories set up infrastructure and can all be built simultaneously.

#### US-1: GitHub Actions Workflow File
**As a** site owner,
**I want** a GitHub Actions workflow that triggers every Sunday at 11:00 UTC (6am ET),
**So that** the blog pipeline runs automatically each week.

**Acceptance Criteria:**
- [ ] `.github/workflows/weekly-blog.yml` exists with `cron: '0 11 * * 0'` schedule
- [ ] `workflow_dispatch` trigger for manual runs
- [ ] Checkout repo, setup Node.js 20, install dependencies
- [ ] Install Playwright Chromium for image generation fallback
- [ ] Secrets configured: `ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GA_PROPERTY_ID`, `PEXELS_API_KEY`
- [ ] Concurrency group `weekly-blog` with `cancel-in-progress: false` to prevent overlapping runs
- [ ] Final step: `git pull --rebase origin main` then git add, commit, push to `main` (with bot identity)
- [ ] Job timeout set to 20 minutes (accounts for retries)

**Agent Swarming:** Independent — no dependencies on other stories.

---

#### US-2: Agent SDK Orchestrator Script
**As a** developer,
**I want** a `scripts/weekly-blog-agent.js` that initializes the Claude Agent SDK with MCP servers and tool permissions,
**So that** the agent can autonomously execute the full pipeline.

**Acceptance Criteria:**
- [ ] Imports from `@anthropic-ai/claude-agent-sdk`
- [ ] Configures GSC MCP server (`mcp-server-gsc`) with service account credentials
- [ ] Configures GA4 MCP server (`mcp-server-google-analytics`) with service account credentials
- [ ] Sets `permissionMode: "bypassPermissions"` with `allowDangerouslySkipPermissions: true`
- [ ] Sets `maxTurns: 50` and `maxBudgetUsd: 2.0`
- [ ] Uses `claude-sonnet-4-5` model
- [ ] Loads project CLAUDE.md via `settingSources: ['project']`
- [ ] Streams messages and logs progress to stdout
- [ ] Handles result types: success, error_max_turns, error_during_execution, error_max_budget_usd
- [ ] Reports cost breakdown on completion
- [ ] Exit code 0 on success, 1 on failure

**Agent Swarming:** Independent — no dependencies on other stories.

---

#### US-3: Google Service Account Credential Handler
**As a** developer,
**I want** the pipeline to securely handle Google service account credentials from GitHub Secrets,
**So that** MCP servers can authenticate with GSC and GA4 APIs.

**Acceptance Criteria:**
- [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` secret is written to a temp file (`/tmp/gsa-credentials.json`) at runtime
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` env var points to the temp file (for GSC MCP server)
- [ ] For GA4 MCP server: `client_email` and `private_key` are extracted from the JSON in a shell step and passed as separate env vars (`GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY`). The raw JSON is NOT passed to the orchestrator process
- [ ] `GA_PROPERTY_ID` is passed as a separate env var (from GitHub secret)
- [ ] Temp file is cleaned up after pipeline completes (even on failure) via `post-if: always` step
- [ ] Credentials are never logged or committed
- [ ] MCP servers receive only the specific credential vars they need — no raw JSON in process environment
- [ ] Document required Google Cloud setup: service account creation, GSC property access, GA4 property access, required scopes (`webmasters.readonly`, `analytics.readonly`)

**Agent Swarming:** Independent — no dependencies on other stories.

---

#### US-4: Image Sourcing (Pexels API + Web Search Fallback)
**As a** developer,
**I want** the agent to source hero images using a reliable cascade of methods,
**So that** blog posts always have real, relevant hero images.

**Image sourcing cascade (in order):**
1. **Pexels API** (primary) — deterministic, fast, high-quality, free license
2. **Web search + Playwright** (fallback) — same approach as manual blog image creation
3. **Branded hero card** (final fallback) — always works, no external dependency

**Acceptance Criteria:**
- [ ] **Pexels API (primary):**
  - Uses `PEXELS_API_KEY` env var for authentication
  - Endpoint: `https://api.pexels.com/v1/search?query={topic}&per_page=5&orientation=landscape`
  - Downloads `src.landscape` or `src.large2x` URL from the top result
  - Agent runs via Bash: `curl -H "Authorization: $PEXELS_API_KEY" ...`
  - Verified: API key works, 25,000 req/month limit, images download at 100-500KB
- [ ] **Web search fallback (if Pexels fails or image irrelevant):**
  - Agent uses `WebSearch` to find free stock photos (Pixabay, Unsplash pages)
  - Agent uses Playwright MCP or Bash `curl` to download
  - Try 2-3 different search queries if first attempt fails
- [ ] **Branded hero card (final fallback — US-9):**
  - If all external sources fail, generate branded card via Playwright HTML rendering
- [ ] Image saved to `public/images/blog/{slug}.jpg` at landscape orientation (1280px+ wide)
- [ ] Image must be >10KB to be considered valid
- [ ] Agent must only use free/CC0 sources (Pexels, Pixabay, Unsplash)

**Agent Swarming:** Independent — no dependencies on other stories.

---

### Phase 2: Agent Prompt Engineering (Parallel — Depends on Phase 1 completion)

These stories define the agent's intelligence and can be built in parallel.

#### US-5: SEO Data Collection Prompt
**As a** content strategist,
**I want** the agent to collect and analyze GSC + GA4 data each week,
**So that** topic selection is driven by real search performance data.

**Acceptance Criteria:**
- [ ] Agent prompt instructs Claude to:
  - Pull GSC search analytics for last 7 days (queries, pages, impressions, clicks, CTR, position)
  - Pull GSC quick wins (position 4-20, high impressions, low CTR)
  - Pull GA4 sessions, bounce rate, page views by path for last 7 days
  - Check sitemap indexing status
- [ ] Agent saves raw SEO data to `tasks/seo-data-latest.json`
- [ ] Agent generates a brief analysis summary identifying:
  - Top performing queries and pages
  - Content gaps (queries with impressions but no dedicated page)
  - Trending topics (new queries appearing)
  - Underperforming pages needing refresh

**Agent Swarming:** Can run in parallel with US-6 and US-7. Depends on US-2 and US-3.

---

#### US-6: Topic Selection Prompt
**As a** content strategist,
**I want** the agent to select the best blog topic based on SEO data and existing content,
**So that** each new post targets the highest-value opportunity.

**Acceptance Criteria:**
- [ ] Agent reads existing `posts.json` to get all published post slugs, titles, and topics
- [ ] Agent reads `services.json`, `topics.json`, `businesses.json` for cross-reference candidates
- [ ] Topic selection considers:
  - Content gaps from SEO data (queries without dedicated content)
  - Seasonal relevance (time of year, upcoming events)
  - Topic diversity (avoid clustering in one category)
  - Cross-reference potential (topics that can link to many existing pages)
- [ ] Agent outputs: selected topic, proposed title, target keywords, category, proposed slug
- [ ] Agent avoids duplicate topics (checks existing post slugs)

**Agent Swarming:** Can run in parallel with US-5 and US-7. Depends on US-2.

---

#### US-7: Blog Post Generation Prompt
**As a** content creator,
**I want** the agent to generate a complete BlogPost JSON object matching the TypeScript interface,
**So that** the generated post integrates seamlessly with the existing site.

**Acceptance Criteria:**
- [ ] Generated post matches `BlogPost` interface from `lib/types.ts`:
  - `slug`, `title`, `description`, `content` (800-1200 words markdown)
  - `publishedAt`, `updatedAt` (ISO date strings)
  - `category` (one of: news, development, food-drink, events, transit, real-estate, lifestyle, community)
  - `tags` (4-6 relevant tags)
  - `answerBlock` (40-60 words, AEO optimized)
  - `faqs` (4-5 questions with answers)
  - `keyTakeaways` (4-6 bullet points)
  - `relatedServices` (2-4 real service slugs from services.json)
  - `relatedTopics` (2-4 real topic slugs from topics.json)
  - `relatedPosts` (1-3 real post slugs from posts.json)
  - `author` string (value: `"LibertyVillage.co"`) — matches existing BlogPost interface
  - `image` path: `/images/blog/{slug}.jpg`
- [ ] Content includes internal links using `[text](/best/slug)` markdown syntax
- [ ] Content mentions real businesses by bold name (auto-linked by site)
- [ ] Tone: informative, locally-focused, written for Liberty Village residents

**Agent Swarming:** Can run in parallel with US-5 and US-6. Depends on US-2.

---

### Phase 3: Integration & Validation (Sequential — Depends on Phase 2)

#### US-8: Pipeline Assembly — System Prompt
**As a** developer,
**I want** a complete system prompt that chains SEO collection → topic selection → post generation → image sourcing → validation → commit,
**So that** the agent executes the full pipeline autonomously in a single session.

**Acceptance Criteria:**
- [ ] System prompt is stored in `scripts/prompts/weekly-blog-system.md`
- [ ] Prompt includes step-by-step instructions with validation checkpoints:
  1. Collect SEO data (US-5)
  2. Select topic (US-6) — must read existing posts first
  3. Generate blog post (US-7) — must validate cross-references exist
  4. Source hero image: try Pexels API first (`curl -H "Authorization: $PEXELS_API_KEY"` search + download), fall back to web search + Playwright, final fall back to branded hero card
  5. Update `posts.json` — append new post, set image path
  6. Run `node scripts/diagnostic.js` — must pass with 0 errors
  7. Run `npm run build` — must complete without errors
  8. Git add specific files, commit with descriptive message
- [ ] Prompt includes error recovery instructions:
  - If Pexels API fails → try web search + Playwright download
  - If web search also fails → generate branded hero card
  - If diagnostic fails → fix cross-references and retry
  - If build fails → revert posts.json and report error
- [ ] Prompt includes the BlogPost TypeScript interface inline for reference
- [ ] Prompt references data file paths: `data/posts.json`, `data/services.json`, `data/topics.json`, `data/businesses.json`

**Agent Swarming:** Depends on US-5, US-6, US-7. Sequential integration step.

---

#### US-9: Branded Hero Card Fallback
**As a** developer,
**I want** the agent to generate a branded hero card image when stock photo sourcing fails,
**So that** every blog post has a professional hero image regardless of external API availability.

**Acceptance Criteria:**
- [ ] Reuses pattern from existing `scripts/generate-blog-images.js`
- [ ] Hero card: 1280x720px JPEG, gradient background, emoji icon, title text, "libertyvillage.co" branding
- [ ] Color and icon are selected based on blog category
- [ ] Generated via Playwright HTML rendering (headless Chromium)
- [ ] Fallback HTML template is embedded in the system prompt or a reference file
- [ ] Image saved to `public/images/blog/{slug}.jpg`

**Agent Swarming:** Can be built in parallel with US-8. Depends on Phase 1.

---

#### US-10: Validation & Error Handling
**As a** site owner,
**I want** the pipeline to validate everything before committing,
**So that** broken content never gets published to production.

**Acceptance Criteria:**
- [ ] Post JSON schema validation before writing to posts.json:
  - All required fields present
  - `relatedServices` slugs exist in services.json
  - `relatedTopics` slugs exist in topics.json
  - `relatedPosts` slugs exist in posts.json
  - Category is a valid enum value
  - Content length is 800-1200 words
- [ ] `node scripts/diagnostic.js` passes with 0 errors (exit code 0) — warnings are acceptable
- [ ] `npm run build` succeeds with expected page count (current + 1)
- [ ] Git commit only includes: `data/posts.json`, `public/images/blog/{slug}.jpg`, `tasks/seo-data-latest.json`
- [ ] On any validation failure: revert changes, log error, exit with code 1
- [ ] GitHub Actions failure notification (built-in)

**Agent Swarming:** Can be built in parallel with US-8 and US-9. Depends on Phase 1.

---

### Phase 4: Observability & Guardrails (Parallel — Depends on Phase 3)

#### US-11: Run Logging & Cost Tracking
**As a** site owner,
**I want** each pipeline run to produce a structured log with cost and outcome data,
**So that** I can monitor the system's health and spending.

**Acceptance Criteria:**
- [ ] Each run saves a log to `tasks/auto-blog-runs/{date}.json` with:
  - `date`: ISO timestamp
  - `success`: boolean
  - `costUsd`: total API cost
  - `turnsUsed`: number of agent turns
  - `topicSelected`: the chosen topic
  - `postSlug`: the generated post slug (if successful)
  - `seoDataSummary`: brief summary of SEO findings
  - `errors`: array of error messages (if any)
  - `duration_ms`: total runtime
- [ ] GitHub Actions step summary shows: topic, cost, success/fail
- [ ] Failed runs preserve the log but don't commit content changes

**Agent Swarming:** Independent within Phase 4.

---

#### US-12: Duplicate & Quality Guard
**As a** content strategist,
**I want** automated checks to prevent duplicate or low-quality content,
**So that** the site maintains editorial standards.

**Acceptance Criteria:**
- [ ] Before generating content, agent checks:
  - No existing post with same slug
  - No existing post covering the same primary keyword (fuzzy match on title + tags)
  - Topic hasn't been covered in the last 4 posts
- [ ] After generating content, agent validates:
  - Content length 800-1200 words
  - At least 3 internal links present
  - At least 2 business mentions
  - FAQ answers are substantive (>20 words each)
  - Answer block is 40-60 words
- [ ] If quality checks fail, agent retries generation with adjusted prompt (max 2 retries)

**Agent Swarming:** Independent within Phase 4.

---

#### US-13: Manual Override & Configuration
**As a** site owner,
**I want** to be able to manually trigger the pipeline with a specific topic override,
**So that** I can force-publish timely content when needed.

**Acceptance Criteria:**
- [ ] `workflow_dispatch` accepts optional input: `topic_override` (string)
- [ ] If `topic_override` is provided, agent skips SEO analysis and topic selection, uses the override
- [ ] Manual trigger also accepts `dry_run` (boolean) — runs pipeline but doesn't commit
- [ ] Dry run outputs the generated post to `tasks/auto-blog-dry-run.json` for review

**Agent Swarming:** Independent within Phase 4.

---

## 6. Agent Swarming Map

```
Phase 0 (SDK Spike) — Sequential, blocking:
  ┌──────┐
  │ US-0 │  ← Must complete first. Verifies SDK API + MCP servers work.
  └──┬───┘
     │
     ▼
Phase 1 (Foundation) — All parallel:
  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
  │ US-1 │  │ US-2 │  │ US-3 │  │ US-4 │
  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘
     │         │         │         │
     ▼         ▼         ▼         ▼
Phase 2 (Prompt Engineering) — Parallel with interface contracts:
  ┌──────┐  ┌──────┐  ┌──────┐
  │ US-5 │  │ US-6 │  │ US-7 │
  └──┬───┘  └──┬───┘  └──┬───┘
  (Templates developed in parallel with agreed data flow:
   US-5 outputs SEO JSON → US-6 reads it → US-7 reads topic from US-6)
     │         │         │
     ▼         ▼         ▼
Phase 3 (Integration) — Parallel where noted:
  ┌──────┐  ┌──────┐  ┌───────┐
  │ US-8 │  │ US-9 │  │ US-10 │
  └──┬───┘  └──┬───┘  └──┬────┘
     │         │         │
     ▼         ▼         ▼
Phase 4 (Observability) — All parallel:
  ┌───────┐  ┌───────┐  ┌───────┐
  │ US-11 │  │ US-12 │  │ US-13 │
  └───────┘  └───────┘  └───────┘
```

**Maximum parallelism per phase:**
- Phase 0: 1 (blocking spike)
- Phase 1: 4 concurrent agents
- Phase 2: 3 concurrent agents (prompt templates in parallel, runtime is sequential)
- Phase 3: 3 concurrent agents (US-8 sequential, US-9 + US-10 parallel)
- Phase 4: 3 concurrent agents

**Note on Phase 2 parallelism:** US-5, US-6, US-7 are prompt templates that can be authored in parallel because they have agreed-upon interface contracts (US-5 writes SEO data to `tasks/seo-data-latest.json`, US-6 outputs topic/slug/keywords, US-7 consumes the topic). At runtime, they execute sequentially within the agent session.

## 7. Technical Constraints

- **Runtime:** GitHub Actions Ubuntu runner, 20-minute timeout
- **Budget:** $2.00 USD max per run (~$8/month)
- **Model:** Claude Sonnet 4.5 (default for Agent SDK)
- **Node.js:** 20.x LTS
- **MCP Servers:** `mcp-server-gsc`, `mcp-server-google-analytics`, `@playwright/mcp` (all stdio transport)
- **Image Sourcing:** Pexels API (primary, 25K req/month) → WebSearch + Playwright (fallback) → Branded card (final fallback)
- **Git:** Commits as "LV Content Bot" with `noreply@libertyvillage.co` email
- **Deploy:** Vercel auto-deploy on push to `main`
- **Concurrency:** Single run at a time via GitHub Actions concurrency group
- **Dependencies:** Add `@anthropic-ai/claude-agent-sdk`, `mcp-server-gsc`, `mcp-server-google-analytics` to `devDependencies`

## 8. Security Considerations

- Service account JSON stored as GitHub encrypted secret — written to temp file at runtime, cleaned up on exit
- GA4 credentials extracted from JSON as individual fields (`client_email`, `private_key`) — raw JSON never exposed in orchestrator process environment
- `bypassPermissions` mode required for autonomous operation — mitigated by:
  - `maxBudgetUsd: 2.0` cost cap
  - `maxTurns: 50` turn limit
  - Explicit `allowedTools` whitelist (includes `WebSearch` and `WebFetch` for image sourcing)
  - Running in ephemeral CI container (no persistent access)
- Anthropic API key stored as separate GitHub secret
- `gcp-credentials.json` exists in repo for local testing (must be in `.gitignore`)
- No credentials in committed code or logs

## 9. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Weekly publish rate | 100% (52 posts/year) | Count of auto-published posts |
| Pipeline success rate | >90% | Success vs failure runs |
| Cost per post | <$2.00 | Agent SDK cost tracking |
| Build validation pass rate | 100% | Diagnostic + build checks |
| Content quality | No manual fixes needed | Review first 4 posts manually |
| Indexing rate | >50% indexed within 2 weeks | GSC index inspection |

## 10. Rollout Plan

1. **Day 1:** Phase 0 — SDK verification spike (test Agent SDK + MCP servers locally)
2. **Week 1:** Build Phase 1 (foundation) + Phase 2 (prompts) in parallel
3. **Week 2:** Build Phase 3 (integration) + Phase 4 (guardrails)
4. **Week 3:** Dry-run testing — trigger manually with `dry_run: true`, review outputs
5. **Week 4:** Live run with manual review — auto-generate but review before merge
6. **Week 5+:** Full autopilot — auto-commit to main

## 11. Future Enhancements (Out of Scope)

- Multi-post generation (2-3 posts/week during high-opportunity periods)
- Content refresh pipeline (update posts >90 days old based on GSC decay signals)
- Social media auto-distribution (Twitter, LinkedIn)
- A/B testing titles via GSC CTR data
- AI-generated images via Replicate/DALL-E for unique visuals
- Slack/Discord notifications on publish

---

*PRD references [Technical Design Document](./design-auto-blog-pipeline.md) for implementation details.*
