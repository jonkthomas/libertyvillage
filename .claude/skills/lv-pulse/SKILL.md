# LV Pulse — Autonomous Blog Post Generator

Research trending Liberty Village topics and publish an AEO-optimized blog post to libertyvillage.co. Pulls from GSC, GA4, Reddit, X, and Google to find the highest-value topic, then generates and publishes a complete post autonomously.

## Configuration

- **GSC Site URL**: `sc-domain:libertyvillage.co`
- **GA4 Property ID**: `523614078`
- **Data File**: `data/posts.json`
- **Post Route**: `/blog/[slug]`
- **Working Directory**: `/workspace/libertyvillage`

## Instructions

### Step 1: Load Existing Content Inventory

Read all existing content to avoid duplication:

1. Read `data/posts.json` — existing blog post slugs and titles
2. Read `data/topics.json` — 30 existing guide topics
3. Read `data/services.json` — 59 existing service categories
4. Read `data/businesses.json` — business names for cross-linking and fact-checking

Build an internal list of all covered topics. You will check against this before choosing a topic.

### Step 2: Research Phase — GSC & GA4 Content Gaps

Use MCP tools to identify what people are searching for but the site doesn't cover:

**GSC Search Analytics (last 28 days):**
```
Tool: mcp__gsc__search_analytics
siteUrl: sc-domain:libertyvillage.co
startDate: [28 days ago in YYYY-MM-DD]
endDate: [yesterday in YYYY-MM-DD]
dimensions: query,page
rowLimit: 100
```

Look for:
- High-impression queries with no matching page (content gaps)
- Queries where position > 15 (opportunity for dedicated content)
- Query clusters around an uncovered topic

**GSC Quick Wins:**
```
Tool: mcp__gsc__enhanced_search_analytics
siteUrl: sc-domain:libertyvillage.co
startDate: [28 days ago]
endDate: [yesterday]
enableQuickWins: true
dimensions: query
```

**GA4 Traffic Data:**
```
Tool: mcp__google-analytics__run_report
property_id: 523614078
date_ranges: [{"start_date": "28daysAgo", "end_date": "yesterday"}]
dimensions: ["pagePath"]
metrics: ["sessions", "totalUsers"]
order_bys: [{"metric": {"metric_name": "sessions"}, "desc": true}]
limit: 30
```

Identify which existing pages get the most traffic — these indicate high-interest topic areas.

**If GSC/GA4 returns no data** (site is new or has minimal traffic): Skip to Step 3 and rely on social/web research only.

### Step 3: Research Phase — Social & Web Signals

Search for recent Liberty Village discussions and news. Run **at least 7 searches**:

**Reddit Research (at least 3 queries):**
```
Tool: WebSearch
Queries:
1. "Liberty Village" site:reddit.com 2026
2. "Liberty Village Toronto" r/askTO OR r/toronto 2026
3. "Liberty Village" new restaurant OR opening OR closing 2026
```

**X/Twitter Research (at least 2 queries):**
```
Tool: WebSearch
Queries:
4. "Liberty Village" site:x.com OR site:twitter.com 2026
5. "#LibertyVillage" Toronto news 2026
```

**Google News/Web (at least 2 queries):**
```
Tool: WebSearch
Queries:
6. "Liberty Village" Toronto news development 2026
7. "Liberty Village" Toronto restaurant opening event 2026
```

For each result, note: the topic, how recent it is, engagement signals (upvotes, likes), and whether it represents new information not on the site.

### Step 4: Topic Selection

Cross-reference all research findings:

1. List all potential topics found from GSC gaps + social + news
2. **Remove any topic already covered** by:
   - An existing guide in topics.json
   - A service category in services.json
   - A previous blog post in posts.json
3. Score remaining topics by:
   - **Search demand** — GSC impressions or search volume signals (weight: 3x)
   - **Recency/timeliness** — breaking news or recent events (weight: 2x)
   - **Local specificity** — Liberty Village-specific beats generic Toronto (weight: 2x)
   - **Content gap severity** — no existing page beats weak existing page (weight: 1x)
4. Select the highest-scoring topic

**Output the chosen topic and a one-sentence justification** before proceeding.

**Fallback**: If no trending topics found, pick an evergreen Liberty Village topic with a seasonal or timely angle. Examples:
- "Best patios in Liberty Village for summer 2026"
- "Liberty Village holiday gift guide from local shops"
- "Weekend brunch guide: Liberty Village locals' picks for [current month]"

### Step 5: Generate Blog Post Content

Generate a complete `BlogPost` JSON object with ALL required fields.

**slug**: URL-safe, lowercase, hyphens. Example: `pilot-coffee-opens-liberty-village`

**title**: 50-70 characters, keyword-rich, include "Liberty Village" when natural.

**description**: 140-155 characters with primary keyword and value proposition.

**answerBlock** (40-60 words): A concise, factual summary that directly answers the implied question. This appears in the amber answer-block box and is targeted by speakable schema. Must be self-contained — a voice assistant should read it as a complete answer.

**keyTakeaways** (4-6 items): Single-sentence bullet points with specific local details (addresses, prices, dates).

**content** (800-1200 words, markdown):
- Structure with `## ` and `### ` headings
- Include specific Liberty Village addresses, business names, landmarks
- Reference businesses from businesses.json by their exact `name` field (linkify will auto-link them)
- Reference related services (links to /best/ pages)
- Practical, actionable advice
- Local context a resident would know
- Use `**bold**` for key terms and business names

**faqs** (4-5 items): Each FAQ must:
- Ask a question someone would naturally voice-search
- Include specific Liberty Village details (streets, businesses, prices)
- Be self-contained (answer makes sense without reading the article)
- Be 2-4 sentences long

**category**: One of: `news`, `development`, `food-drink`, `events`, `transit`, `real-estate`, `lifestyle`, `community`

**tags**: 3-6 lowercase tags. Example: `["coffee", "new-opening", "king-street-west"]`

**relatedServices**: 2-4 slugs from services.json. Verify they exist.

**relatedTopics**: 2-4 slugs from topics.json. Verify they exist.

**relatedPosts**: 1-3 slugs from posts.json of thematically related posts. Empty array if none.

**publishedAt** and **updatedAt**: Today's date in `YYYY-MM-DD` format.

**author**: `"LibertyVillage.co"`

### Step 6: Validate and Publish

1. Read the current `data/posts.json`
2. Parse it as a JSON array
3. Append the new BlogPost object to the array
4. Write the updated array back to `data/posts.json` using the **Write tool** (not Bash echo/redirect)
5. Format with 2-space JSON indentation
6. Verify by reading `data/posts.json` again and confirming the new post is present
7. Verify the slug is unique (not already in the array)

### Step 7: Build Verification

Run the Next.js build to verify the new post renders:

```bash
cd /workspace/libertyvillage && npm run build
```

Check the build output:
- The new `/blog/[slug]` page should appear in the route list
- Total page count should increase by 1 (or 2 if this is the first post, since /blog index also appears)

If the build fails:
1. Read the error message carefully
2. Fix the data in posts.json (usually a malformed field or missing required field)
3. Re-run the build
4. If it fails a second time, revert posts.json to its previous state and report the error

### Step 8: Output Report

After successful publication, output:

```markdown
## LV Pulse — Post Published

**Title**: [post title]
**URL**: /blog/[slug]
**Category**: [category]
**Published**: [date]

### Why This Topic
[1-2 sentence explanation citing the research source — e.g., "Found 3 Reddit threads in r/askTO discussing the new GO station proposal with 200+ upvotes"]

### Research Sources
- **GSC**: [findings or "no significant data yet"]
- **Reddit**: [key threads found or "no relevant discussions"]
- **X/Twitter**: [key posts found or "no relevant posts"]
- **Google News**: [articles found or "no recent news"]

### Content Summary
- Word count: ~[count]
- Answer block: [word count] words
- FAQs: [count]
- Key takeaways: [count]
- Cross-references: [business/service names mentioned]

### Build Status
[checkmark] Build successful — [total page count] pages generated
```

## Content Quality Standards

- **No fabricated businesses** — only reference businesses that exist in businesses.json or were confirmed in research
- **No fabricated addresses or prices** — verify against businesses.json data
- **Check for closures** — if research mentions a business closing, do not recommend it
- **Conversational tone** — write in second person ("you"), as a local talking to a neighbor
- **No AI self-references** — never say "As an AI", "I don't have personal experience", etc.
- **Specific over generic** — "Mildred's Temple Kitchen on Liberty Street" beats "local restaurants"
- **Answer block must stand alone** — it should make sense read aloud by a voice assistant without any surrounding context
