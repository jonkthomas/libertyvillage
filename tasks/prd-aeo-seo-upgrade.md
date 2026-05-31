# PRD: AEO + SEO Upgrade for libertyvillage.co

## Overview

Transform libertyvillage.co from a traditional SEO site into an **AEO-ready (Answer Engine Optimization)** hyperlocal authority that ranks in both Google blue links AND gets cited by AI systems (ChatGPT, Perplexity, Google AI Overviews). Additionally, build a **weekly SEO monitoring skill** that can be triggered locally to track rankings, detect content decay, and surface optimization opportunities.

**Domain:** libertyvillage.co
**Stack:** Next.js 16.1.6 + React 19 + Tailwind CSS v4
**Current pages:** 179 (59 services, 76 businesses, 24 guides, 15 comparisons, 5 static)
**Branch:** `ralph/aeo-seo-upgrade`

## Problem Statement

1. **Zero AEO readiness** — No answer blocks, no definitions sections, no structured answer-first content. AI systems cannot easily extract and cite our content.
2. **Generic FAQs on 55/59 service pages** — Only 4 categories (restaurants, dentists, gyms, short-term-rentals) have specific FAQs. The other 55 use boilerplate templates.
3. **Missing schema markup** — No CollectionPage schema on service pages, no FAQPage on comparison pages, hardcoded Article dates, no DefinedTerm schema.
4. **No inline cross-linking** — Related links only appear at page bottom. No contextual links within prose content.
5. **No monitoring system** — No automated way to track rankings, detect content decay, or identify quick wins.
6. **Data model gaps** — Businesses lack `answerBlock`, `bestFor`, services lack `definition`, topics lack `answerSummary` and `definitions`.

## Success Criteria

- Every page has a 40-60 word answer block near the top
- All 59 service pages have specific, localized FAQs (not generic)
- Schema.org coverage: FAQPage on all pages with FAQs, CollectionPage on service pages, DefinedTerm on guide pages
- Weekly SEO monitoring skill (`/seo-weekly`) generates actionable report using GSC + GA4 MCP data
- Code review passes on every user story before merge
- Site builds successfully with zero TypeScript errors

## Architecture Decisions

- **Answer blocks** go into JSON data files (not hardcoded in templates) — keeps content editable
- **FAQ generation** moves from hardcoded switch statement to data-driven approach — all FAQs in JSON
- **Definitions** stored as arrays in topics.json — rendered as styled aside boxes
- **Weekly skill** built as Claude Code skill at `.claude/skills/seo-weekly/`
- **Schema changes** in lib/schema.ts — new generators for CollectionPage, DefinedTerm, Speakable

## Constraints

- Do NOT change URL structure (existing pages may already be indexed)
- Do NOT remove any existing content — only add/enhance
- Keep page content unique (>80% unique per page for pSEO safety)
- Answer blocks must be 40-60 words (optimal for featured snippets)
- All schema must validate against Google Rich Results Test
- Never pass image data inline into conversation context

## Agent Instructions

- Use **agent swarming** (3+ parallel agents) for data generation tasks (FAQs, answer blocks)
- Run **code-reviewer** agent after every user story completion
- Use **web-research-specialist** agents to validate FAQ questions against real "People Also Ask" data
- Track progress in this PRD file (mark stories as they complete)

---

## User Stories

### US-001: Expand TypeScript Types for AEO Fields
**Priority:** P0 (blocks other stories)
**Files:** `lib/types.ts`

Update all TypeScript interfaces to include AEO fields:

```typescript
// Service additions
answerBlock?: string;      // 40-60 word answer for "What are the best [service] in LV?"
definition?: string;       // 1-2 sentence definition of service category
specificFaqs?: FAQ[];      // Service-specific FAQs (replaces hardcoded switch)

// Business additions
answerBlock?: string;      // 40-60 word "why this business" answer
bestFor?: string[];        // Use cases ["first dates", "casual weeknight", "work meetings"]
dietaryOptions?: string[]; // For restaurants: ["vegan", "gluten-free", "halal"]

// Topic additions
answerSummary?: string;    // 1-paragraph TL;DR at top
keyTakeaways?: string[];   // 3-5 bullet points for skimmers
definitions?: Array<{term: string; definition: string}>;  // Glossary terms

// Neighborhood additions (already good, minor additions)
answerBlock?: string;      // Quick "LV vs X in one sentence" answer
```

All fields optional to maintain backward compatibility.

**Acceptance:** TypeScript compiles with zero errors. No runtime changes.

---

### US-002: Generate Answer Blocks for All 59 Services
**Priority:** P0
**Files:** `data/services.json`
**Depends on:** US-001

Use agent swarming (3 parallel web-research-specialist agents) to generate a 40-60 word answer block for each service. Each answer block must:
- Directly answer "What are the best [service] in Liberty Village?"
- Include a specific count of businesses in that category (from businesses.json)
- Name 2-3 top-rated businesses
- Include a specific detail (street, price range, or unique fact)

Example for restaurants:
> "Liberty Village has 12 restaurants spanning Italian, Thai, Canadian, and pub fare. Top-rated spots include Mildred's Temple Kitchen for brunch (4.7 stars), Pai Northern Thai Kitchen for authentic curry, and NODO for wood-fired Neapolitan pizza. Most are clustered along King Street West and East Liberty."

Also add a `definition` field (1-2 sentences explaining the service category in LV context).

**Acceptance:** All 59 services have `answerBlock` (40-60 words each) and `definition`. Node.js script generates the data.

---

### US-003: Generate Specific FAQs for All 59 Services
**Priority:** P0
**Files:** `data/services.json`, `app/best/[service]/page.tsx`
**Depends on:** US-001

Replace the hardcoded FAQ switch statement in the service page template with data-driven FAQs from services.json.

For each of the 55 services that currently use generic FAQs:
- Research "People Also Ask" questions for "[service] Liberty Village Toronto"
- Generate 4-5 specific FAQs with localized answers
- Include real business names, price ranges, street names, and insider tips
- Each answer should be 40-60 words

Update the service page template to read FAQs from `service.specificFaqs` instead of the switch statement. Fall back to the existing hardcoded FAQs for the 4 categories that already have them.

**Acceptance:** All 59 service pages render specific FAQs. No generic "How do I find the best [service]?" questions remain.

---

### US-004: Generate Answer Blocks for All 76 Businesses
**Priority:** P1
**Files:** `data/businesses.json`
**Depends on:** US-001

Add `answerBlock` and `bestFor` fields to each business in businesses.json:
- `answerBlock`: 40-60 word "why visit this business" answer
- `bestFor`: Array of 3-5 use cases

Example for Mildred's Temple Kitchen:
```json
{
  "answerBlock": "Mildred's Temple Kitchen is Liberty Village's most iconic brunch destination, open since 2004 at 85 Hanna Ave. Known for blueberry buttermilk pancakes and a weekend lineup that starts by 10:30am. The industrial-chic space seats 120 with a seasonal patio. Dinner service features contemporary Canadian cuisine with locally sourced ingredients.",
  "bestFor": ["weekend brunch", "date night", "patio dining", "large groups", "special occasions"]
}
```

**Acceptance:** All 76 businesses have `answerBlock` and `bestFor` fields populated.

---

### US-005: Generate Answer Summaries and Definitions for All 24 Guides
**Priority:** P1
**Files:** `data/topics.json`
**Depends on:** US-001

Add to each topic in topics.json:
- `answerSummary`: 40-60 word TL;DR paragraph
- `keyTakeaways`: 3-5 bullet point takeaways
- `definitions`: Array of {term, definition} for jargon used in the guide

Example for parking-guide:
```json
{
  "answerSummary": "Parking in Liberty Village costs $3/hour at Green P meters, $150-250/month for private underground spots, or ~$200/year for a residential permit. Free street parking is available after 9 PM. The main lots are on Hanna Avenue, Jefferson Avenue, and beneath condo buildings along East Liberty Street.",
  "keyTakeaways": [
    "Green P meters: $3/hour, free after 9 PM",
    "Monthly spots: $150-250 via SpotHero or building management",
    "Residential permits: ~$200/year for Mowat/Hanna zones",
    "Avoid Hanna Ave on TFC game days — towing starts 2 hours before kickoff",
    "Condo parking purchase: $50,000-80,000 (often sold separately)"
  ],
  "definitions": [
    {"term": "Green P", "definition": "Toronto's municipal parking system operated by the Toronto Parking Authority, using green-branded meters and lots throughout the city."},
    {"term": "Transit Score", "definition": "A 0-100 rating measuring public transit accessibility based on proximity to bus, streetcar, and subway stops. Liberty Village scores 78."},
    {"term": "Residential Parking Permit", "definition": "A City of Toronto permit allowing residents to park on designated streets without feeding meters, applied for through the city website."}
  ]
}
```

**Acceptance:** All 24 topics have `answerSummary`, `keyTakeaways`, and `definitions` populated.

---

### US-006: Generate Answer Blocks for All 15 Neighborhood Comparisons
**Priority:** P1
**Files:** `data/neighborhoods.json`
**Depends on:** US-001

Add `answerBlock` to each neighborhood comparison. This should be a 40-60 word direct answer to "Should I live in Liberty Village or [Neighborhood]?"

Example for King West:
> "Choose Liberty Village over King West if you want $100-200/month cheaper rent, a stronger community feel, and quieter streets. Choose King West if nightlife is your priority — it has a transit score of 90 vs LV's 78 and better walkability to the subway. Both share King Street dining."

**Acceptance:** All 15 neighborhoods have `answerBlock` field populated.

---

### US-007: Update Page Templates with Answer Blocks
**Priority:** P0
**Files:** `app/best/[service]/page.tsx`, `app/guide/[topic]/page.tsx`, `app/vs/[neighborhood]/page.tsx`, `app/directory/[slug]/page.tsx`
**Depends on:** US-002, US-004, US-005, US-006

Add answer block rendering to all 4 page templates:

**Service pages** (`/best/[service]`):
- After H1, before business list
- Render `service.answerBlock` in a styled box (warm background, slightly larger text)
- Below answer block, render `service.definition` as an inline aside

**Guide pages** (`/guide/[topic]`):
- After H1/subtitle, before quick tips
- Render `topic.answerSummary` in answer block box
- Render `topic.keyTakeaways` as a bullet list below
- Render `topic.definitions` as styled aside boxes within content (after first H2)

**Comparison pages** (`/vs/[neighborhood]`):
- Replace existing verdict box intro with `neighborhood.answerBlock`
- Keep verdict details below

**Business detail pages** (`/directory/[slug]`):
- After rating/meta section, before details grid
- Render `business.answerBlock` as intro paragraph
- Render `business.bestFor` as "Best For:" tag pills

Create a reusable `<AnswerBlock>` component:
```tsx
// components/AnswerBlock.tsx
interface AnswerBlockProps {
  children: React.ReactNode;
  className?: string;
}
```

And a reusable `<DefinitionBox>` component:
```tsx
// components/DefinitionBox.tsx
interface DefinitionBoxProps {
  term: string;
  definition: string;
}
```

**Acceptance:** All 4 page types render answer blocks when data exists. Components are reusable. Graceful fallback when fields are undefined.

---

### US-008: Upgrade Schema.org Markup
**Priority:** P1
**Files:** `lib/schema.ts`, all page templates
**Depends on:** US-007

Add new schema generators and update existing ones:

1. **CollectionPage schema** for service pages:
```typescript
generateCollectionPageSchema(service, businesses) → {
  @type: "CollectionPage",
  name: "Best [Service] in Liberty Village",
  description: service.answerBlock,
  mainEntity: { @type: "ItemList", ... }
}
```

2. **DefinedTerm schema** for guide definitions:
```typescript
generateDefinedTermSchema(definitions) → {
  @type: "DefinedTermSet",
  hasDefinedTerm: [{ @type: "DefinedTerm", name, description }]
}
```

3. **FAQPage schema on comparison pages** (currently missing):
- Add FAQSchema generation to `/vs/[neighborhood]` pages

4. **Fix ArticleSchema** — make datePublished dynamic (use topic data or file mod date instead of hardcoded "2026-01-15")

5. **Add Speakable schema** to answer blocks:
```typescript
generateSpeakableSchema(cssSelectors) → {
  @type: "WebPage",
  speakable: { @type: "SpeakableSpecification", cssSelector: [".answer-block"] }
}
```

**Acceptance:** All new schema validates against Google Rich Results Test. No console warnings.

---

### US-009: Add Inline Cross-Linking to Content
**Priority:** P2
**Files:** `app/best/[service]/page.tsx`, `app/guide/[topic]/page.tsx`, `app/vs/[neighborhood]/page.tsx`

Currently, related links only appear at the bottom of pages. Add contextual cross-links within content:

**Service pages:**
- In each BusinessCard, if the business description mentions another service category, link to that service page
- Add "See our [Guide Name]" links where relevant (e.g., restaurants → foodie-guide)

**Guide pages:**
- In the markdown content renderer, auto-link business names to their `/directory/[slug]` pages
- Auto-link service category mentions to `/best/[service]` pages
- Auto-link neighborhood names to `/vs/[neighborhood]` pages

**Comparison pages:**
- In detailed comparison sections, link mentioned businesses to their detail pages
- Link mentioned services to service pages

Implementation: Create a `linkify` utility function that takes raw text + lookup maps and returns React nodes with links.

**Acceptance:** At least 3 internal links per page within content (not just footer). No broken links.

---

### US-010: Build Weekly SEO Monitoring Skill
**Priority:** P0
**Files:** `.claude/skills/seo-weekly/` (new directory)

Create a Claude Code skill at `.claude/skills/seo-weekly/SKILL.md` that generates a weekly SEO/AEO monitoring report.

The skill should:

1. **Use existing GSC MCP tools** (`mcp__gsc__search_analytics`, `mcp__gsc__enhanced_search_analytics`, `mcp__gsc__list_sitemaps`) to pull:
   - Top 50 queries by impressions (last 7 days)
   - Quick wins: pages ranking positions 4-20 with 50+ impressions and CTR <5%
   - Position changes: compare last 7 days vs previous 7 days
   - New queries appearing this week but not in prior 30 days
   - Keyword cannibalization: queries with 2+ pages

2. **Use existing GA4 MCP tools** (`mcp__google-analytics__run_report`, `mcp__google-analytics__run_realtime_report`) to pull:
   - Top 20 organic landing pages by sessions (last 7 days)
   - Pages with engagement rate <30% and 50+ sessions
   - Week-over-week traffic changes

3. **Generate a structured markdown report** saved to `tasks/seo-weekly-report-YYYY-MM-DD.md` with sections:
   - Executive Summary (3-5 key findings)
   - Quick Wins table (page, query, position, impressions, CTR, opportunity)
   - Position Movers (biggest gainers and losers)
   - Content Decay Alerts (pages with declining metrics)
   - Engagement Issues (high bounce rate pages)
   - Keyword Cannibalization warnings
   - Recommended Actions (prioritized list)

4. **Site-specific configuration** hardcoded for libertyvillage.co:
   - GSC site URL: `sc-domain:libertyvillage.co`
   - GA4 property ID: `523614078`

**SKILL.md format:**
```markdown
---
name: seo-weekly
description: Generate weekly SEO monitoring report for libertyvillage.co
---

[Detailed instructions for the agent to follow]
```

**Acceptance:** Running `/seo-weekly` produces a complete markdown report. Report is saved to tasks/ directory. Skill handles API errors gracefully (e.g., no data yet for new site).

---

### US-011: Update Homepage with Answer-First Content
**Priority:** P2
**Files:** `app/page.tsx`

The homepage currently has a generic tagline. Update it to include:
- An answer block in the hero section: "Liberty Village is a walkable Toronto neighborhood of 9,000+ residents with 600+ businesses, known for its converted industrial lofts, dog-friendly culture, and thriving food scene along King Street West."
- A "Quick Facts" stat bar update with AEO-friendly labels (ensure screen readers and AI can parse them)
- Meta description update to be answer-block style

**Acceptance:** Homepage has answer-first content. Lighthouse SEO score remains 90+.

---

### US-012: Add Breadcrumbs to Homepage and Directory Index
**Priority:** P2
**Files:** `app/page.tsx`, `app/directory/page.tsx`

These two pages are missing breadcrumb navigation. Add:
- Homepage: just `Home` (BreadcrumbList with 1 item)
- Directory: `Home > Business Directory`

Include BreadcrumbSchema JSON-LD on both pages.

**Acceptance:** Breadcrumbs render and schema validates.

---

### US-013: Comprehensive Code Review + Site Audit
**Priority:** P0 (final)
**Depends on:** All other stories

Run code-reviewer agent on the entire codebase post-implementation:
1. Verify all TypeScript compiles with zero errors
2. Verify all 179 pages have answer blocks
3. Verify all schema validates (spot-check 5 pages with Rich Results Test URL)
4. Verify no broken internal links
5. Verify all FAQs are specific (no generic templates remaining)
6. Run `next build` to ensure static generation succeeds
7. Check for any accessibility regressions

If issues found, loop: fix → re-review until clean.

**Acceptance:** Clean code review with zero MAJOR findings. Site builds successfully.

---

## Implementation Order

```
Phase 1: Foundation (US-001)
  └→ Types updated

Phase 2: Data Generation (US-002, US-003, US-004, US-005, US-006) — PARALLEL with agent swarming
  └→ All JSON data enriched with AEO fields

Phase 3: Template Updates (US-007, US-008) — SEQUENTIAL
  └→ Answer blocks render, schema upgraded

Phase 4: Cross-linking + Homepage (US-009, US-011, US-012) — PARALLEL
  └→ Internal linking improved, homepage AEO-ready

Phase 5: Weekly Skill (US-010) — INDEPENDENT
  └→ /seo-weekly skill created

Phase 6: Final Review (US-013)
  └→ Code review loop until clean
```

## Code Review Requirements

After EVERY user story completion, run `code-reviewer` agent with:
- Check for TypeScript errors
- Check for broken imports/references
- Check for AEO compliance (answer blocks present, proper length)
- Check schema validity
- Check for security issues (no XSS in dangerouslySetInnerHTML)

## Progress Tracking

| Story | Status | Notes |
|-------|--------|-------|
| US-001 | Pending | |
| US-002 | Pending | |
| US-003 | Pending | |
| US-004 | Pending | |
| US-005 | Pending | |
| US-006 | Pending | |
| US-007 | Pending | |
| US-008 | Pending | |
| US-009 | Pending | |
| US-010 | Pending | |
| US-011 | Pending | |
| US-012 | Pending | |
| US-013 | Pending | |
