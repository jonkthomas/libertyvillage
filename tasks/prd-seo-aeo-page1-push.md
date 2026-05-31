# PRD: SEO & AEO Page 1 Push — libertyvillage.co

## Introduction

Transform libertyvillage.co's thin service pages into guide-depth content, add navigation exposure for "Best Of" pages, cross-link high-traffic World Cup posts to service pages, enhance semantic markup for AI citability, and upgrade the guide hub page into a substantial neighbourhood resource. The goal is to push core queries from page 2 to page 1 and increase AI citation rate from 43% to 71%.

**Problem:** Service pages (restaurants, gyms, bars) have ~200 words of content vs the parking guide's 2,000+ words — and the parking guide ranks #1 while service pages don't rank at all. The "Best Of" pages also have zero top-level navigation links, starving them of internal authority.

**Tech Stack:** Next.js 16.1.6 app router, TypeScript, Tailwind CSS. Data in JSON files under `/data/`. Testing via Playwright (no Vitest — Playwright E2E only).

## Goals

- Push "liberty village restaurants" from position 18 to top 10
- Push "gyms in liberty village" from position 14.3 to top 10
- Push "bars in liberty village" from position 8.75 to top 3
- Maintain parking guide at #1
- Increase AI citation rate from 43% (3/7 queries) to 71% (5/7)
- Increase weekly GSC clicks from 1 to 20+
- Reduce /best/bars bounce rate from 75% to under 50%

---

## Canonical Data Models

**These are the AUTHORITATIVE type definitions. All supporting docs should be updated to match.**

### Service extensions (all optional):
```typescript
comparisonTable?: { columns: string[]; rows: Array<Record<string, string>> };
keyTakeaways?: string[];
proTips?: string[];
neighbourhoodContext?: string;
sections?: Array<{ heading: string; content: string }>;
```

### BlogPost extensions (all optional):
```typescript
crossLinks?: Array<{ type: 'service' | 'guide'; slug: string; label?: string }>;
exploreCta?: { label: string; href: string; description: string };
```

### GuideHub (new interface):
```typescript
interface GuideHub {
  population: string;
  medianRent: string;
  walkScore: number;
  transitScore: number;
  boundaries: string;
  history: string;
  prosCons: { pros: string[]; cons: string[] };
  quickFacts: Array<{ label: string; value: string }>;
  answerSummary: string;
}
```

### Canonical Factual Constants (from llms.txt / site content):
- Walk Score: 88 | Transit Score: 96
- Population: ~7,500 residents
- Median rent (1BR): $2,608/month
- Boundaries: King St W (north), Dufferin St (west), GO rail corridor (south), Strachan Ave (east)

### Schema Decisions (AUTHORITATIVE):
- **Organization schema:** Homepage `app/page.tsx` ONLY (not layout.tsx). Omit `sameAs` if no social URLs.
- **Guide hub schema:** CollectionPage + Speakable (NOT Article — it's a collection of guides)
- **ItemList schema:** Generated at PAGE level in `app/best/[service]/page.tsx` (NOT inside components)
- **Speakable selectors:** `.answer-block`, `h1`, `.key-takeaways`, `.pro-tips`

---

## User Stories

### US-001: Extend TypeScript types for guide-depth content
**Description:** As a developer, I need the Service, BlogPost, and GuideHub types updated so new data fields are available throughout the codebase.

**Reference docs:**
- Design: `tasks/docs/seo-aeo-page1-design.md` (sections: 2. Architecture)

**Acceptance Criteria:**
- [ ] Add to Service interface in `lib/types.ts`: `comparisonTable`, `keyTakeaways`, `proTips`, `neighbourhoodContext`, `sections` (exact types per Canonical Data Models above)
- [ ] Add to BlogPost interface: `crossLinks`, `exploreCta` (exact types per Canonical Data Models above)
- [ ] Create `GuideHub` interface in `lib/types.ts` (exact shape per Canonical Data Models above)
- [ ] Add `getGuideHubData(): GuideHub` function to `lib/data.ts` that loads `data/guide-hub.json`. Wrap in try/catch returning sensible defaults if file missing (follow pattern at `app/page.tsx` lines 87-91)
- [ ] IMPORTANT: Do NOT modify existing `BlogPost.keyTakeaways` field — it is already required (`string[]`). Only add `crossLinks` and `exploreCta` as new optional fields.
- [ ] All new fields are optional — `next build` passes with ZERO existing data changes
- [ ] Typecheck passes

**Recommended agents/skills:** `nextjs-expert`, `code-reviewer`

---

### US-002: Add buildComparisonTable and resolveCrossLinks helpers
**Description:** As a developer, I need data-layer functions that auto-generate comparison tables from businesses.json and resolve cross-link slugs to full link items.

**Reference docs:**
- Design: `tasks/docs/seo-aeo-page1-design.md` (sections: Data Flow, Auto-Generation)

**Acceptance Criteria:**
- [ ] Add `buildComparisonTable(serviceSlug: string): { columns: string[]; rows: Array<Record<string, string>> }` to `lib/data.ts`
- [ ] Function reads businesses from `getBusinessesByCategory(slug)` and maps to rows with human-friendly column names: "Name", "Rating", "Price Range", "Hours" (NOT raw field names)
- [ ] If service has manual `comparisonTable` in JSON, use that instead (manual overrides auto-generated). Note: auto-generated is a low-quality fallback — production services should always have manual tables.
- [ ] Add `resolveCrossLinks(crossLinks?: BlogPost['crossLinks']): LinkItem[]` to `lib/links.ts` — note the `?` param, function MUST handle `undefined` input (return empty array)
- [ ] Function resolves service slugs via `getServiceBySlug`, guide slugs via `getTopicBySlug`
- [ ] Invalid/missing slugs are filtered out silently (no error, no broken build). `undefined` input returns `[]`.
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `nextjs-expert`, `code-reviewer`

---

### US-003: Create guide-hub.json data file
**Description:** As a content author, I need neighbourhood facts, history, and pros/cons data for the guide hub page.

**Reference docs:**
- Requirements: `tasks/docs/seo-aeo-page1-requirements.md` (sections: REQ-6)

**Acceptance Criteria:**
- [ ] Create `data/guide-hub.json` matching GuideHub interface
- [ ] Uses canonical constants: population "~7,500", medianRent "$2,608/month", walkScore 88, transitScore 96
- [ ] History section: 3-4 paragraphs covering Toronto Central Prison origins (1870s), industrial era, condo transformation (2000s), present day
- [ ] prosCons: minimum 4 pros and 4 cons with specific details (not generic)
- [ ] quickFacts: minimum 8 entries (population, rent, walk score, transit score, area size, year established, notable landmarks, median condo price)
- [ ] answerSummary: 40-60 words, self-contained, includes at least 3 numeric data points
- [ ] `getGuideHubData()` successfully loads and returns the data
- [ ] Typecheck passes

**Recommended agents/skills:** `/seo-content`, `code-reviewer`

---

### US-004: Populate restaurants guide-depth data
**Description:** As a site visitor searching "best restaurants liberty village," I want a comprehensive guide with comparison table, prices, and insider tips.

**Reference docs:**
- Requirements: `tasks/docs/seo-aeo-page1-requirements.md` (sections: REQ-2)

**Acceptance Criteria:**
- [ ] Add `comparisonTable` to restaurants service in `data/services.json`: columns ["Restaurant", "Cuisine", "Price Range", "Rating", "Best For"], minimum 5 rows
- [ ] Add `keyTakeaways`: exactly 5 items, each containing at least one specific price or number
- [ ] Add `proTips`: exactly 5 items, each containing a specific name, time, or actionable detail
- [ ] Add `neighbourhoodContext`: 2-3 paragraphs, minimum 150 words
- [ ] Add `sections`: minimum 4 entries ("Best for Brunch", "Best for Date Night", "Best for Quick Lunch", "Best for Families")
- [ ] Expand `specificFaqs` to exactly 8 FAQs — each answer minimum 50 words with specific names/prices
- [ ] Enrich `answerBlock` to minimum 80 words with at least 3 restaurant names and 2 price points
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `/seo-content`, `code-reviewer`

---

### US-005: Populate gyms guide-depth data
**Description:** As a site visitor searching "gyms in liberty village," I want a comparison of gym options with monthly costs and class types.

**Acceptance Criteria:**
- [ ] Add `comparisonTable` to gyms service: columns ["Gym", "Monthly Cost", "Classes", "24hr?", "Best For"], minimum 5 rows
- [ ] Add `keyTakeaways`: exactly 5 items with specific prices (e.g., "GoodLife $50/mo, F45 $200/mo")
- [ ] Add `proTips`: exactly 5 items about peak hours, free trials, condo gym alternatives
- [ ] Add `neighbourhoodContext`: minimum 150 words
- [ ] Add `sections`: minimum 3 entries ("Best for Weightlifting", "Best for Classes", "Best Budget Option")
- [ ] Expand FAQs to exactly 8 covering pricing, free trials, class schedules, personal training
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `/seo-content`, `code-reviewer`

---

### US-006: Populate bars guide-depth data
**Description:** As a site visitor, I want rich bar content so the page stops bouncing users at 75%.

**Acceptance Criteria:**
- [ ] Add `comparisonTable` to bars: columns ["Bar", "Type", "Happy Hour", "Patio", "Best For"], minimum 5 rows
- [ ] Add `keyTakeaways`: exactly 5 items
- [ ] Add `proTips`: exactly 5 items with specific nights, times, or happy hour details
- [ ] Add `neighbourhoodContext`: minimum 150 words
- [ ] Expand FAQs to exactly 8
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `/seo-content`, `code-reviewer`

---

### US-007: Populate coffee-shops guide-depth data
**Description:** As a site visitor, I want coffee shop comparisons with WiFi and laptop-friendliness info.

**Acceptance Criteria:**
- [ ] Add `comparisonTable` to coffee-shops: columns ["Shop", "WiFi", "Laptop-Friendly", "Hours", "Best For"], minimum 5 rows
- [ ] Add `keyTakeaways`: exactly 5 items
- [ ] Add `proTips`: exactly 5 items
- [ ] Add `neighbourhoodContext`: minimum 150 words
- [ ] Expand FAQs to exactly 8
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `/seo-content`, `code-reviewer`

---

### US-008: Populate coworking-spaces guide-depth data
**Description:** As a site visitor, I want coworking space comparisons with pricing and amenities.

**Acceptance Criteria:**
- [ ] Add `comparisonTable` to coworking-spaces: columns ["Space", "Day Pass", "Monthly", "Meeting Rooms", "Best For"], minimum 4 rows
- [ ] Add `keyTakeaways`: exactly 5 items
- [ ] Add `proTips`: exactly 5 items
- [ ] Add `neighbourhoodContext`: minimum 150 words
- [ ] Expand FAQs to exactly 6
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `/seo-content`, `code-reviewer`

---

### US-009: Add World Cup cross-link data to posts.json
**Description:** As a site owner, I want high-traffic World Cup blog posts to funnel visitors to service pages.

**Reference docs:**
- Requirements: `tasks/docs/seo-aeo-page1-requirements.md` (sections: REQ-3)

**Acceptance Criteria:**
- [ ] Add `crossLinks` to `fifa-world-cup-2026-liberty-village-survival-guide`: `[{type:"service",slug:"restaurants"},{type:"service",slug:"bars"},{type:"guide",slug:"parking-guide"},{type:"guide",slug:"transit-guide"}]`
- [ ] Add `crossLinks` to `liberty-village-world-cup-road-closures-resident-access`: parking-guide, restaurants
- [ ] Add `crossLinks` to `best-bars-restaurants-near-bmo-field-world-cup-2026`: restaurants, bars, patios
- [ ] Add `crossLinks` to `watch-world-cup-liberty-village-without-tickets`: bars, coffee-shops
- [ ] Add `exploreCta` to each: `{label:"Explore Liberty Village",href:"/directory",description:"Find restaurants, bars, and services near BMO Field"}`
- [ ] All cross-link slugs resolve via `resolveCrossLinks` without errors
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `nextjs-expert`, `code-reviewer`

---

### US-010: Build ServiceComparisonTable component
**Description:** As a site visitor, I want a structured comparison table on service pages to quickly compare options.

**Reference docs:**
- Design: `tasks/docs/seo-aeo-page1-design.md` (sections: Component Hierarchy)

**Acceptance Criteria:**
- [ ] Create `components/ServiceComparisonTable.tsx` as a server component
- [ ] Props: `{ columns: string[]; rows: Array<Record<string, string>> }` — both required at the TypeScript level
- [ ] Desktop (>=768px): HTML `<table>` with `<thead>`, zebra-striped `<tbody>` rows
- [ ] Mobile (<768px): stacked card layout, each row rendered as a card with label:value pairs
- [ ] Returns `null` if `rows.length === 0` (empty array). The CALLER (`app/best/[service]/page.tsx`) is responsible for only rendering the component when `comparisonTable` data exists.
- [ ] Uses Tailwind classes from existing palette: `warm-*`, `sage-*`, `amber-*`
- [ ] Table headers use `<th scope="col">` for accessibility
- [ ] Typecheck passes

**Recommended agents/skills:** `frontend-expert`, `code-reviewer`

---

### US-011: Build ProTips component
**Description:** As a site visitor, I want insider tips displayed in a visually distinct section.

**Acceptance Criteria:**
- [ ] Create `components/ProTips.tsx` as a server component
- [ ] Props: `{ tips: string[] }`
- [ ] Renders numbered list with lightbulb icon prefix, inside a `sage-50` background with `sage-400` left border
- [ ] Wrapper has `className="pro-tips"` (for Speakable schema targeting)
- [ ] Returns `null` if `tips` is undefined or empty array
- [ ] Typecheck passes

**Recommended agents/skills:** `frontend-expert`, `code-reviewer`

---

### US-012: Build HeaderDropdown component
**Description:** As a site visitor, I want a "Best Of" dropdown in the header to navigate to service pages.

**Reference docs:**
- Requirements: `tasks/docs/seo-aeo-page1-requirements.md` (sections: REQ-1)

**Acceptance Criteria:**
- [ ] Create `components/HeaderDropdown.tsx` with `"use client"` directive
- [ ] IMPORTANT: HeaderDropdown CANNOT call `getAllServices()` directly (it uses `readFileSync`, incompatible with client components). Instead, `Header.tsx` (server component) must call `getAllServices()`, sort/slice to top 8, and pass the list as props to HeaderDropdown: `<HeaderDropdown services={topServices} />`
- [ ] Props: `{ services: Array<{ slug: string; pluralName: string }> }`
- [ ] Desktop: hover opens dropdown, mouse-leave closes after 150ms delay
- [ ] Sort by searchVolume priority: high=1, medium=2, low=3. Tiebreaker: alphabetical by `pluralName`
- [ ] Each item links to `/best/{slug}` with service `pluralName` as label
- [ ] Escape key closes dropdown. Tab navigates items. Enter/Space activates.
- [ ] ARIA: trigger has `aria-expanded`, `aria-haspopup="menu"`. Menu has `role="menu"`. Items have `role="menuitem"`.
- [ ] Update `Header.tsx` (server component): call `getAllServices()`, sort/filter top 8, pass to HeaderDropdown. Insert between "Home" and "Directory" nav links
- [ ] `next build` passes
- [ ] Typecheck passes
- [ ] Verify in browser using Playwright MCP: hover triggers dropdown, click navigates to /best/restaurants

**Recommended agents/skills:** `frontend-expert`, `code-reviewer`

---

### US-013: Update MobileNav with Best Of section
**Description:** As a mobile user, I need a "Best Of" expandable section in the mobile navigation.

**Acceptance Criteria:**
- [ ] Update `components/MobileNav.tsx` to include expandable "Best Of" section
- [ ] IMPORTANT: MobileNav is `"use client"` — it CANNOT call `getAllServices()`. `Header.tsx` must pass the same top-8 service list as props to MobileNav: `<MobileNav services={topServices} />`
- [ ] Tap to expand/collapse, shows same 8 services as desktop dropdown
- [ ] Each item links to `/best/{slug}` and closes mobile nav on click
- [ ] Consistent with existing MobileNav animation/transition patterns
- [ ] Typecheck passes
- [ ] Verify in browser at 375px viewport: expand Best Of, tap Restaurants, verify navigation

**Recommended agents/skills:** `frontend-expert`, `code-reviewer`

---

### US-014: Build ExploreCTA component
**Description:** As a blog reader, I want a prominent CTA to explore Liberty Village services.

**Acceptance Criteria:**
- [ ] Create `components/ExploreCTA.tsx` as a server component
- [ ] Props: `{ label: string; href: string; description: string }`
- [ ] Renders as a card with `amber-50` background, `amber-500` left border (4px), minimum height 80px
- [ ] Contains heading (label), description text, and arrow link
- [ ] Returns `null` if props are missing/empty
- [ ] Typecheck passes

**Recommended agents/skills:** `frontend-expert`, `code-reviewer`

---

### US-015: Enhance AnswerBlock for AI citability
**Description:** As an AI search system, I need semantic markup on the AnswerBlock to identify citable answer content.

**Reference docs:**
- Requirements: `tasks/docs/seo-aeo-page1-requirements.md` (sections: REQ-4)

**Acceptance Criteria:**
- [ ] Change AnswerBlock outer element from `<div>` to `<section data-answer="true" role="region" aria-label="Quick answer">`
- [ ] Add `<h2 className="sr-only">Quick Answer</h2>` as first child inside the section
- [ ] Preserve existing `className="answer-block ..."` (Speakable schema selector depends on it)
- [ ] Preserve existing visual styling (amber-50 background, amber-200 border)
- [ ] All existing usages of AnswerBlock across the site continue to render correctly
- [ ] `next build` passes with zero errors
- [ ] Typecheck passes

**Recommended agents/skills:** `frontend-expert`, `code-reviewer`

---

### US-016: Wire service page template with new components
**Description:** As a developer, I need the service page template updated to render all new content sections.

**Reference docs:**
- Design: `tasks/docs/seo-aeo-page1-design.md` (sections: Service Page Template)

**Acceptance Criteria:**
- [ ] Update `app/best/[service]/page.tsx` to import and render: ServiceComparisonTable, KeyTakeaways (existing component), ProTips
- [ ] IMPORTANT: Add `className="key-takeaways"` to the wrapper `<div>` in existing `components/KeyTakeaways.tsx` (currently missing — needed for Speakable schema targeting). Preserve all existing classes.
- [ ] Render `sections` as H2 headings + paragraph content blocks
- [ ] Render `neighbourhoodContext` as a paragraph section
- [ ] Page section order: H1 → AnswerBlock → ComparisonTable → KeyTakeaways → Description → Neighbourhood Context → Sections → Business Listings → ProTips → Methodology → FAQs → Related Links
- [ ] Each new section renders ONLY when its data field is present (returns null for missing data)
- [ ] Non-enriched service pages (e.g., /best/dentists) render exactly as before — no visual changes
- [ ] Update Speakable schema selectors in `lib/schema.ts` to include `.key-takeaways`, `.pro-tips`
- [ ] Verify no existing Playwright tests or CSS selectors target `div.answer-block` (AnswerBlock changed to `<section>` in US-015)
- [ ] `next build` passes for all 391 pages
- [ ] Typecheck passes
- [ ] Verify in browser: /best/restaurants shows comparison table, takeaways, tips. /best/dentists renders unchanged.

**Recommended agents/skills:** `nextjs-expert`, `frontend-expert`, `code-reviewer`

---

### US-017: Add ItemList schema for service comparison tables
**Description:** As a developer, I need ItemList schema.org JSON-LD generated for service pages with comparison data.

**Acceptance Criteria:**
- [ ] Add `generateItemListSchema(serviceName: string, items: Array<{name: string; url: string}>)` to `lib/schema.ts`
- [ ] Inject ItemList JSON-LD in `app/best/[service]/page.tsx` when `comparisonTable` data exists
- [ ] Schema includes `@type: "ItemList"`, `itemListElement` array with `ListItem` entries
- [ ] Only generates when comparison data exists (no empty schema)
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `nextjs-expert`, `code-reviewer`

---

### US-018: Wire blog post template with cross-links and ExploreCTA
**Description:** As a developer, I need blog post pages to render cross-link sections and the Explore CTA.

**Acceptance Criteria:**
- [ ] Update `app/blog/[slug]/page.tsx` to import and render ExploreCTA after article content, before FAQs
- [ ] Render cross-links as a "Related Services & Guides" section using existing RelatedLinks component
- [ ] Cross-links resolved via `resolveCrossLinks()` from `lib/links.ts`
- [ ] Posts without crossLinks or exploreCta render exactly as before
- [ ] `next build` passes — verify all 4 World Cup posts render cross-links
- [ ] Typecheck passes
- [ ] Verify in browser: /blog/fifa-world-cup-2026-liberty-village-survival-guide shows CTA and service links

**Recommended agents/skills:** `nextjs-expert`, `code-reviewer`

---

### US-019: Add Organization schema to homepage
**Description:** As an AI search system, I need Organization schema on the homepage for entity recognition.

**Acceptance Criteria:**
- [ ] Add `generateOrganizationSchema()` to `lib/schema.ts` returning `{ "@context": "https://schema.org", "@type": "Organization", name: "LibertyVillage.co", url: "https://libertyvillage.co", description: "...", areaServed: { "@type": "Place", name: "Liberty Village, Toronto, Ontario, Canada" } }`
- [ ] NO `sameAs` field (no social profiles to reference)
- [ ] Inject Organization schema JSON-LD in `app/page.tsx` (homepage) as a `<script type="application/ld+json">` tag
- [ ] Co-exists with WebSite schema in `app/layout.tsx` — no duplication, no conflict
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `nextjs-expert`, `code-reviewer`

---

### US-020: Upgrade guide hub page layout
**Description:** As a site visitor, I want the /guide page to show neighbourhood facts and history alongside guide links.

**Reference docs:**
- Requirements: `tasks/docs/seo-aeo-page1-requirements.md` (sections: REQ-6)
- Design: `tasks/docs/seo-aeo-page1-design.md` (sections: Guide Hub)

**Acceptance Criteria:**
- [ ] Create `components/NeighbourhoodFacts.tsx`: server component, renders key stats from GuideHub data (population, rent, walk/transit scores, boundaries) in a card
- [ ] Create `components/NeighbourhoodHistory.tsx`: server component, renders history text and pros/cons from GuideHub data
- [ ] Update `app/guide/page.tsx` layout: AnswerBlock at top → NeighbourhoodHistory → 2-column grid (guide topic links left, NeighbourhoodFacts sidebar right) → pros/cons
- [ ] Desktop (>=1024px): sidebar is `sticky top-24`. Mobile: sidebar stacks above guide links
- [ ] ALL existing guide topic links preserved — no content removed
- [ ] `next build` passes
- [ ] Typecheck passes
- [ ] Verify in browser: /guide shows facts sidebar, history section, and all existing guide links

**Recommended agents/skills:** `nextjs-expert`, `frontend-expert`, `code-reviewer`

---

### US-021: Update guide hub page metadata and schema
**Description:** As a developer, I need the guide hub page's SEO metadata and schema updated to target "liberty village neighbourhood guide."

**Acceptance Criteria:**
- [ ] Update guide hub page metadata: title "Liberty Village Neighbourhood Guide 2026 | libertyvillage.co", description includes "neighbourhood guide" + key facts
- [ ] Add CollectionPage schema to the guide hub page
- [ ] Add Speakable schema targeting `.answer-block`, `h1`, `.key-takeaways`, `.pro-tips` on the guide hub (matching canonical Speakable selectors from top of PRD)
- [ ] `next build` passes
- [ ] Typecheck passes

**Recommended agents/skills:** `nextjs-expert`, `code-reviewer`

---

### US-022: Playwright E2E Test — Service Page Content Depth
**Description:** As QA, I need E2E tests verifying enriched service pages render all new content sections.

**Acceptance Criteria:**
- [ ] Create `tests/e2e/service-page-content.spec.ts`
- [ ] Test navigates to /best/restaurants and asserts:
  - `h1` contains "Best Restaurants in Liberty Village"
  - `section[data-answer="true"]` exists
  - `table` or `.comparison-table` exists with >=5 rows
  - `.key-takeaways` element exists with >=5 `li` items
  - `.pro-tips` element exists with >=5 `li` items
  - FAQ section has >=8 question elements
- [ ] Repeat core assertions for /best/gyms and /best/bars
- [ ] Test /best/dentists does NOT show comparison table (backward compat)
- [ ] Test at 375px viewport: comparison table renders as stacked cards
- [ ] Typecheck passes

**Recommended agents/skills:** Playwright MCP, `code-reviewer`

---

### US-023: Playwright E2E Test — Navigation & Cross-Links
**Description:** As QA, I need E2E tests verifying header dropdown and blog cross-links.

**Acceptance Criteria:**
- [ ] Create `tests/e2e/navigation-crosslinks.spec.ts`
- [ ] Test desktop: hover "Best Of" → dropdown appears → contains "Restaurants" link → click navigates to /best/restaurants
- [ ] Test keyboard: Tab to "Best Of" → Enter opens → Tab to item → Enter navigates
- [ ] Test /blog/fifa-world-cup-2026-liberty-village-survival-guide: ExploreCTA visible, cross-links section has >=3 links
- [ ] Test mobile (375px): open mobile nav → "Best Of" section expandable → tap navigates
- [ ] Typecheck passes

**Recommended agents/skills:** Playwright MCP, `code-reviewer`

---

### US-024: Playwright MCP UAT — Desktop Flows
**Description:** As QA, I need full user acceptance testing via Playwright MCP at desktop viewport.

**Acceptance Criteria:**
- [ ] Start local dev server (`npm run dev`)
- [ ] Navigate to homepage → verify page source contains `"@type":"Organization"` JSON-LD
- [ ] Hover "Best Of" → dropdown appears → click "Restaurants" → page loads with comparison table, 5+ takeaways, 5+ tips, 8+ FAQs
- [ ] Navigate to /best/gyms → verify comparison table with monthly costs
- [ ] Navigate to /best/bars → verify content depth (no thin page causing bounces)
- [ ] Navigate to /guide → verify facts sidebar with Walk Score 88, history section, pros/cons, all guide links present
- [ ] Navigate to /blog/fifa-world-cup-2026-liberty-village-survival-guide → verify ExploreCTA banner and cross-links
- [ ] Take screenshot at each page for visual verification
- [ ] All pages render without browser console errors
- [ ] Run `next build` to verify SSG output succeeds for all 391 pages

**Recommended agents/skills:** Playwright MCP (`mcp__playwright`), `code-reviewer`

---

### US-025: Playwright MCP UAT — Mobile Flows
**Description:** As QA, I need UAT at mobile viewport (375px) for all changed pages.

**Acceptance Criteria:**
- [ ] Set viewport to 375x812 (iPhone SE)
- [ ] Navigate to homepage → open mobile nav → verify "Best Of" expandable section → tap "Restaurants" → navigates correctly
- [ ] /best/restaurants at 375px: comparison table renders as stacked cards (not horizontal table), all sections readable
- [ ] /guide at 375px: NeighbourhoodFacts stacks above guide links (not sidebar), history section readable
- [ ] /blog/fifa-world-cup-2026-liberty-village-survival-guide at 375px: ExploreCTA visible, cross-links tappable
- [ ] Take screenshots at each viewport for visual verification
- [ ] No horizontal scrolling on any page

**Recommended agents/skills:** Playwright MCP (`mcp__playwright`), `code-reviewer`

---

## Supporting Documentation

| Document | Generated By | Contents |
|----------|-------------|----------|
| `tasks/docs/seo-aeo-page1-requirements.md` | `kiro-requirement` | 65 acceptance criteria, edge cases, validation rules, EARS format |
| `tasks/docs/seo-aeo-page1-design.md` | `kiro-design` | Data models, component hierarchy, schema changes, Mermaid diagrams |
| `tasks/docs/seo-aeo-page1-plan.md` | `kiro-plan` | 10 phases, 30 tasks, parallelization map, risk areas |

**NOTE:** Where supporting docs conflict with this PRD's Canonical Data Models section, this PRD is authoritative.

## Functional Requirements

- FR-1: Add `comparisonTable`, `keyTakeaways`, `proTips`, `neighbourhoodContext`, `sections` to Service type (all optional)
- FR-2: Add `crossLinks` and `exploreCta` to BlogPost type (all optional)
- FR-3: Create `data/guide-hub.json` with neighbourhood facts, history, pros/cons
- FR-4: Add `buildComparisonTable()` auto-generation from businesses.json with manual override
- FR-5: Add `resolveCrossLinks()` for slug-to-LinkItem resolution with silent invalid-slug filtering
- FR-6: Service pages render comparison table, key takeaways, pro tips, sections when data present
- FR-7: Service pages render existing layout unchanged when new fields absent
- FR-8: Header shows "Best Of" dropdown with top 8 services, keyboard + ARIA accessible
- FR-9: Mobile nav shows expandable "Best Of" section
- FR-10: World Cup blog posts show cross-links and Explore CTA banner
- FR-11: AnswerBlock uses `<section data-answer="true">` with visually-hidden heading
- FR-12: Homepage includes Organization schema JSON-LD (page.tsx, not layout.tsx)
- FR-13: Guide hub shows neighbourhood facts sidebar, history, pros/cons, preserving all guide links
- FR-14: Guide hub has CollectionPage + Speakable schema
- FR-15: ItemList schema generated at page level for service comparison data
- FR-16: Speakable selectors include `.answer-block`, `h1`, `.key-takeaways`, `.pro-tips`

## Non-Goals (Out of Scope)

- No new page routes
- No database — data remains in JSON files
- No Vitest setup — testing is Playwright E2E only
- No paid advertising or external link building
- No blog post content creation (only data enrichment)
- No changes to non-priority service pages (only restaurants, gyms, bars, coffee-shops, coworking-spaces)
- No embedded map on guide hub page

## Technical Considerations

- All new Service/BlogPost fields MUST be optional for backward compatibility
- SSG build must pass for all 391 pages after changes
- All NEW components are server components EXCEPT HeaderDropdown (needs hover/click state → "use client"). Note: existing MobileNav.tsx is already "use client" and receives data via props from server-component Header.
- Existing ComparisonTable.tsx is for neighbourhood vs comparisons — ServiceComparisonTable is separate
- KeyTakeaways.tsx already exists and is shared between blog/guide pages — reuse, do not duplicate
- Next.js version is 16.1.6 (NOT 15)

## Success Metrics

| Metric | Current | Target | Timeline |
|---|---|---|---|
| GSC Clicks/week | 1 | 20+ | 8 weeks |
| "liberty village restaurants" position | 18 | Top 10 | 8 weeks |
| "bars in liberty village" position | 8.75 | Top 3 | 4 weeks |
| /best/bars bounce rate | 75% | <50% | 4 weeks |
| AI citation rate | 43% (3/7) | 71% (5/7) | 12 weeks |
| Guide hub word count | ~50 | 800+ | 2 weeks |
| Service page avg word count | ~200 | 1,500+ | 4 weeks |

## Quality Assurance Requirements

Each user story must include:
1. **Code Review** — Run code-reviewer agent after EACH story completion
2. **Type Safety** — `next build` must pass with zero TypeScript errors
3. **Backward Compatibility** — Non-enriched pages must render unchanged

### Execution Guidelines
- **Parallelize**: US-004/005/006/007/008 (data population) can run in parallel after US-001+002
- **Parallelize**: US-010/011/012/013/014/015 (components) can run in parallel after US-001
- **Sequential**: US-016/017/018 (page wiring) depend on both data + components being complete
- **Sequential**: US-022-025 (testing) run last after all implementation stories
- **Code review every story** before marking complete
- **Playwright MCP UAT** (US-024/025) is the final gate

## Dependency Graph

```
US-001 (types) ──┬──→ US-002 (helpers) ──→ US-009 (crosslink data)
                 │
                 ├──→ US-003 (guide-hub.json)
                 ├──→ US-004 (restaurants data)  ┐
                 ├──→ US-005 (gyms data)         │
                 ├──→ US-006 (bars data)         ├──→ US-016 (wire service page)
                 ├──→ US-007 (coffee data)       │         │
                 ├──→ US-008 (coworking data)    ┘         ├──→ US-017 (ItemList schema)
                 │                                         │
                 ├──→ US-010 (ComparisonTable) ──────────→─┘
                 ├──→ US-011 (ProTips) ──────────────────→─┘
                 ├──→ US-012 (HeaderDropdown) ──→ US-013 (MobileNav)
                 ├──→ US-014 (ExploreCTA) ──────→ US-018 (wire blog)
                 ├──→ US-015 (AnswerBlock) ─────→ US-016
                 │
                 └──→ US-019 (Org schema) [independent]

US-003 ──→ US-020 (guide hub layout) ──→ US-021 (guide hub meta/schema)

US-016..021 ──→ US-022 (E2E service) ──→ US-024 (UAT desktop)
US-002+009+014 ──→ US-018 (wire blog)
US-012..018 ──→ US-023 (E2E nav)     ──→ US-025 (UAT mobile)
```

## Open Questions

- Should we create a dedicated /best index page? (Deferred — breadcrumbs currently link to /best/restaurants as parent)
