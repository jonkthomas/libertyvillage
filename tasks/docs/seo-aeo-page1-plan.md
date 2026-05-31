# SEO & AEO Page 1 Push — Implementation Tasks

**Feature:** Transform thin service pages into guide-depth content, add navigation exposure, cross-linking, AEO optimizations, and guide hub upgrade to push core queries from page 2 to page 1.

**Design references:** `tasks/seo-aeo-strategy-2026-q2.md` (strategy), `tasks/prd-aeo-seo-upgrade.md` (original PRD)

**Tech stack:** Next.js 15 app router, TypeScript, Tailwind CSS, JSON data files, SSG

---

## Phase 1: Foundation — Types & Data Model Extensions

- [ ] 1.1 Extend `Service` interface in `lib/types.ts` with guide-depth fields
  - Add `comparisonTable?: Array<{ label: string; values: Record<string, string> }>` for structured comparison data
  - Add `proTips?: string[]` for insider tips section
  - Add `keyTakeaways?: string[]` for scannable bullet points (service pages currently lack this)
  - Add `neighbourhoodContext?: string` for 2-3 paragraph local perspective prose
  - Add `sections?: Array<{ heading: string; content: string }>` for "Best for Brunch," "Best for Date Night" etc.
  - Existing fields (`answerBlock`, `definition`, `specificFaqs`) are already present — no changes needed there
  - All new fields must be optional to maintain backward compatibility with existing service pages
  - Verify `next build` compiles with zero TypeScript errors after changes
  - **Ref:** Strategy Pillar 1 (service page content depth), PRD US-001

- [ ] 1.2 Extend `BlogPost` interface in `lib/types.ts` with cross-link CTA fields
  - Add `exploreCta?: { label: string; href: string; description: string }` for "Explore Liberty Village" CTA blocks within blog posts
  - Add `crossLinks?: Array<{ text: string; href: string; context: string }>` for inline service page cross-links
  - Verify `next build` compiles with zero errors
  - **Ref:** Strategy Pillar 2 Fix 2 (World Cup cross-links)

- [ ] 1.3 Add guide hub data fields to support neighbourhood facts on `/guide` page
  - Create `data/guide-hub.json` with structure: `{ population, medianRent1BR, medianRent2BR, walkScore, transitScore, bikeScore, boundaries, history: string, prosConsLiving: { pros: string[], cons: string[] }, quickFacts: Array<{ label: string; value: string }> }`
  - Add a `GuideHub` interface to `lib/types.ts`
  - Add `getGuideHubData()` loader function to `lib/data.ts`
  - **Ref:** Strategy Pillar 3B (guide hub upgrade), PRD US-011

---

## Phase 2: Data Population (parallelizable after Phase 1)

- [ ] 2.1 Populate comparison table data for restaurants in `data/services.json`
  - Add `comparisonTable` array to the `restaurants` service entry with columns: Restaurant, Cuisine, Price Range, Rating, Best For
  - Include all businesses from `getBusinessesByCategory("restaurants")` with actual data from `businesses.json`
  - Add `keyTakeaways` (5 items with specific prices, names, and facts)
  - Add `proTips` (3-5 insider tips like "Saturday brunch line at Mildred's: 30-45 min by 10:30am")
  - Add `neighbourhoodContext` (2-3 paragraphs about the restaurant scene in LV)
  - Add `sections` for "Best for Brunch," "Best for Date Night," "Best for Quick Lunch"
  - Expand `specificFaqs` from 4 to 6-8 FAQs covering delivery, reservations, dietary restrictions
  - Target: page word count from ~200 to ~1,500+
  - **Ref:** Strategy Pillar 1 (restaurants page overhaul, week 2)

- [ ] 2.2 Populate guide-depth data for gyms in `data/services.json`
  - Same structure as 2.1: `comparisonTable` (Gym, Monthly Cost, Classes, Hours, Best For), `keyTakeaways`, `proTips`, `neighbourhoodContext`, expanded `specificFaqs` (6-8)
  - Include pricing data, class schedules, amenity comparisons
  - **Ref:** Strategy Pillar 1 (gyms page, week 3)

- [ ] 2.3 Populate guide-depth data for bars in `data/services.json`
  - Same structure: `comparisonTable`, `keyTakeaways`, `proTips`, `neighbourhoodContext`, expanded `specificFaqs`
  - Include patio availability, happy hour info, best nights
  - Current page has 75% bounce rate — content depth is the fix
  - **Ref:** Strategy Pillar 1 (bars fix, week 3)

- [ ] 2.4 Populate guide-depth data for coffee-shops in `data/services.json`
  - Same structure: `comparisonTable` (Shop, WiFi Speed, Laptop-Friendly, Hours, Best For), `keyTakeaways`, `proTips`, `neighbourhoodContext`, expanded `specificFaqs`
  - **Ref:** Strategy Pillar 1 (coffee-shops, week 4)

- [ ] 2.5 Populate guide-depth data for coworking-spaces in `data/services.json`
  - Same structure: `comparisonTable` (Space, Day Pass, Monthly, Meeting Rooms, Best For), `keyTakeaways`, `proTips`, `neighbourhoodContext`, expanded `specificFaqs`
  - **Ref:** Strategy Pillar 1 (coworking-spaces, week 4)

- [ ] 2.6 Add cross-link data to World Cup blog posts in `data/posts.json`
  - Update `fifa-world-cup-2026-liberty-village-survival-guide` with `crossLinks` entries pointing to `/best/restaurants`, `/best/bars`, `/guide/parking-guide`, `/guide/transit-guide`
  - Update `liberty-village-world-cup-road-closures-resident-access` with `crossLinks` to `/guide/parking-guide`, `/best/restaurants`
  - Update `best-bars-restaurants-near-bmo-field-world-cup-2026` with `crossLinks` to `/best/restaurants`, `/best/bars`, `/best/patios`
  - Update `watch-world-cup-liberty-village-without-tickets` with `crossLinks` to `/best/bars`, `/best/coffee-shops`
  - Add `exploreCta` to each World Cup post: `{ label: "Explore Liberty Village", href: "/directory", description: "Find restaurants, bars, and more near BMO Field" }`
  - **Ref:** Strategy Pillar 2 Fix 2 (World Cup blog cross-links)

- [ ] 2.7 Create `data/guide-hub.json` with neighbourhood facts
  - Population: ~12,000, median rent 1BR: ~$2,200, 2BR: ~$2,800
  - Walk Score: 83, Transit Score: 78, Bike Score: 89
  - Boundaries: "King Street West (north), Gardiner Expressway (south), Dufferin Street (west), Strachan Avenue (east)"
  - History paragraph covering prison era, industrial warehouses, condo conversion boom (2000s-present)
  - Pros/cons of living in LV (honest, data-backed)
  - Quick facts array for at-a-glance rendering
  - **Ref:** Strategy Pillar 3B (guide hub with neighbourhood facts)

---

## Phase 3: Components (parallelizable after Phase 1)

- [ ] 3.1 Build `ServiceComparisonTable` component at `components/ServiceComparisonTable.tsx`
  - Accept `rows: Array<{ label: string; values: Record<string, string> }>` and `columns: string[]` props
  - Render responsive table (desktop) / stacked cards (mobile) similar to existing `ComparisonTable.tsx` pattern
  - Use Tailwind styling consistent with site design (warm-* palette, amber accents)
  - Add `role="table"` and proper `<th>` / `<td>` semantics for accessibility and AI parsing
  - Write unit test verifying correct rendering of table rows and mobile fallback
  - **Ref:** Strategy Pillar 1 (comparison tables), Pillar 4B (structured tabular data)

- [ ] 3.2 Build `ProTips` component at `components/ProTips.tsx`
  - Accept `tips: string[]` prop
  - Render as a styled aside with numbered tips in a sage/green callout box
  - Return null if tips array is empty
  - **Ref:** Strategy Pillar 1 (pro tips differentiator)

- [ ] 3.3 Build `ExploreCta` component at `components/ExploreCta.tsx`
  - Accept `{ label: string; href: string; description: string }` props
  - Render as a prominent call-to-action card with an arrow icon, using lv-brick accent colour
  - Designed to sit within blog post content to drive traffic to service/directory pages
  - **Ref:** Strategy Pillar 2 Fix 2 (funnel World Cup traffic)

- [ ] 3.4 Enhance `AnswerBlock` component in `components/AnswerBlock.tsx` for AEO citability
  - Current: simple `<div className="answer-block">` wrapping a `<p>`
  - Change to `<section>` with a visually subtle heading (e.g., `<h2 className="sr-only">Quick Answer</h2>` or visible small heading)
  - Add `data-answer="true"` attribute to the section element
  - Add `itemScope itemType="https://schema.org/Answer"` and `itemProp="text"` on the paragraph
  - Keep existing `.answer-block` CSS class for Speakable schema selector compatibility
  - Verify the component still renders correctly on all existing pages (service, guide, blog, comparison)
  - Write a test asserting the new attributes are present in rendered output
  - **Ref:** Strategy Pillar 4A (AnswerBlock semantic enhancement)

- [ ] 3.5 Build `NeighbourhoodFacts` component at `components/NeighbourhoodFacts.tsx`
  - Accept the `GuideHub` data as props
  - Render a quick facts grid (population, rent, scores) with icons
  - Render history paragraph
  - Render pros/cons in a two-column layout
  - Intended for use on the `/guide` hub page
  - **Ref:** Strategy Pillar 3B (guide hub neighbourhood facts)

- [ ] 3.6 Build `BestOfDropdown` client component at `components/BestOfDropdown.tsx`
  - Accept `items: Array<{ href: string; label: string; icon: string }>` props
  - Render a dropdown trigger ("Best Of") that expands on hover (desktop) and click (mobile)
  - Use a simple `useState` toggle with `onMouseEnter`/`onMouseLeave` for desktop, `onClick` for mobile
  - List the top 5-6 service categories: Restaurants, Coffee Shops, Bars, Gyms, Brunch Spots, Coworking Spaces
  - Close dropdown when a link is clicked
  - Add proper `aria-expanded`, `aria-haspopup`, `role="menu"` attributes
  - Style consistent with existing nav (text-sm, font-medium, warm-600, amber-600 hover)
  - **Ref:** Strategy Pillar 2 Fix 1 (Best Of dropdown)

---

## Phase 4: Header Navigation Integration

- [ ] 4.1 Integrate `BestOfDropdown` into `components/Header.tsx`
  - Import `BestOfDropdown` component
  - Insert "Best Of" dropdown between "Home" and "Directory" in the desktop nav
  - Pass the top 6 service categories as items with their `/best/{slug}` hrefs
  - Verify dropdown appears correctly and all links navigate to the correct service pages
  - **Ref:** Strategy Pillar 2 Fix 1

- [ ] 4.2 Add "Best Of" section to `components/MobileNav.tsx`
  - Add an expandable "Best Of" section within the mobile drawer
  - Show the same 6 service category links nested under a collapsible heading
  - Close the mobile nav when a link is tapped (existing `setOpen(false)` pattern)
  - **Ref:** Strategy Pillar 2 Fix 1

- [ ] 4.3 Write integration test for header navigation
  - Test that the "Best Of" dropdown renders in the DOM
  - Test that clicking/hovering reveals the service category links
  - Test that mobile nav includes the Best Of section
  - Test that all 6 links have correct hrefs
  - **Ref:** Strategy Pillar 2 Fix 1

---

## Phase 5: Service Page Template Upgrade

- [ ] 5.1 Update `app/best/[service]/page.tsx` to render guide-depth content
  - Import `ServiceComparisonTable`, `ProTips`, `KeyTakeaways` components
  - After existing `AnswerBlock`, render `KeyTakeaways` if `service.keyTakeaways` exists
  - After description, render `ServiceComparisonTable` if `service.comparisonTable` exists
  - After comparison table, render `service.sections` as H2 + prose blocks if they exist
  - After sections, render `ProTips` if `service.proTips` exists
  - Render `neighbourhoodContext` as a paragraph section before the methodology box
  - All new sections conditional on data existence — existing pages without guide-depth data remain unchanged
  - Verify that the 5 upgraded service pages render all new sections and the remaining 54 pages still render correctly
  - **Ref:** Strategy Pillar 1 (all content elements table)

- [ ] 5.2 Add ItemList schema markup for comparison tables on service pages
  - In `lib/schema.ts`, create `generateServiceComparisonSchema(serviceName, rows)` that outputs an `ItemList` with structured entries
  - Inject this schema into the service page template when `comparisonTable` data exists
  - Validate schema output against expected JSON-LD structure in a unit test
  - **Ref:** Strategy Pillar 4B (structured data for comparison tables)

---

## Phase 6: World Cup Blog Cross-Links & Explore CTA

- [ ] 6.1 Update `app/blog/[slug]/page.tsx` to render `ExploreCta` and cross-links
  - Import `ExploreCta` component
  - If `post.exploreCta` exists, render it after the `KeyTakeaways` section
  - If `post.crossLinks` exists, render a "Related in Liberty Village" section with styled link cards after the main article content but before FAQs
  - **Ref:** Strategy Pillar 2 Fix 2

- [ ] 6.2 Write test verifying World Cup posts render cross-links
  - Load the `fifa-world-cup-2026-liberty-village-survival-guide` post data
  - Assert that `crossLinks` and `exploreCta` fields are populated
  - Assert that the rendered page includes links to `/best/restaurants`, `/best/bars`, etc.
  - **Ref:** Strategy Pillar 2 Fix 2

---

## Phase 7: AnswerBlock Semantic Enhancement (AEO)

- [ ] 7.1 Update Speakable schema to point to enhanced AnswerBlock selector
  - In `lib/schema.ts`, verify `generateSpeakableSchema` uses `cssSelector: [".answer-block", "h1"]` — this already targets the `.answer-block` class which is preserved in the enhanced component
  - Add `[data-answer="true"]` as an additional selector for future-proofing
  - **Ref:** Strategy Pillar 4A

- [ ] 7.2 Verify all existing pages still render correctly with enhanced AnswerBlock
  - Run `next build` to confirm SSG succeeds for all pages
  - Spot-check 3 page types (service, guide, blog) to verify AnswerBlock renders with new semantic attributes
  - **Ref:** Strategy Pillar 4A

---

## Phase 8: Organization Schema on Homepage

- [ ] 8.1 Add `generateOrganizationSchema()` function to `lib/schema.ts`
  - Output: `{ "@context": "https://schema.org", "@type": "Organization", "name": "LibertyVillage.co", "url": "https://libertyvillage.co", "areaServed": { "@type": "Place", "name": "Liberty Village, Toronto, Ontario, Canada" }, "description": "Neighbourhood guide and local business directory for Liberty Village, Toronto" }`
  - Write unit test validating the schema structure
  - **Ref:** Strategy Pillar 4C

- [ ] 8.2 Inject Organization schema into `app/layout.tsx`
  - Import `generateOrganizationSchema` from `lib/schema.ts`
  - Add a `<script type="application/ld+json">` tag in the `<head>` alongside the existing WebSite schema
  - **Ref:** Strategy Pillar 4C

---

## Phase 9: Guide Hub Page Upgrade

- [ ] 9.1 Update `app/guide/page.tsx` with neighbourhood facts, history, and pros/cons
  - Import `getGuideHubData` from `lib/data.ts` and `NeighbourhoodFacts` component
  - Add a hero section with a neighbourhood overview paragraph
  - Render `NeighbourhoodFacts` above the existing topic grid
  - Add an AnswerBlock with a 40-60 word summary of what the guide hub offers
  - Keep the existing topic category grid below the new sections
  - Update page metadata: title to "Liberty Village Neighbourhood Guide 2026" and description to include population, key facts
  - **Ref:** Strategy Pillar 3B

- [ ] 9.2 Add `CollectionPage` + `BreadcrumbList` + `FAQPage` schemas to guide hub
  - Existing page already has `CollectionPage` and `BreadcrumbList` schemas — verify they're still correct
  - If `guide-hub.json` includes FAQs, add FAQPage schema
  - **Ref:** Strategy Pillar 3B, Pillar 4

---

## Phase 10: Build Verification & Integration Testing

- [ ] 10.1 Run `next build` and verify all static pages generate successfully
  - Ensure zero TypeScript errors
  - Ensure all 5 upgraded service pages build with new content
  - Ensure all World Cup blog posts build with cross-link data
  - Ensure the guide hub page builds with neighbourhood facts
  - Ensure homepage builds with Organization schema
  - **Ref:** PRD US-013 (comprehensive build verification)

- [ ] 10.2 Write automated test suite for SEO/AEO elements
  - Test that each of the 5 priority service pages has: answerBlock, comparisonTable, keyTakeaways, proTips, 6+ FAQs
  - Test that the header nav includes "Best Of" dropdown with 6 links
  - Test that AnswerBlock component has `data-answer="true"` attribute
  - Test that Organization schema is present in root layout
  - Test that guide hub page renders neighbourhood facts
  - Test that World Cup blog posts include cross-link data
  - **Ref:** PRD US-013

- [ ] 10.3 Validate JSON-LD schemas across page types
  - Write a test that parses the JSON-LD output from each page template
  - Assert Organization schema on homepage
  - Assert CollectionPage + Speakable schemas on service pages
  - Assert ArticleSchema + DefinedTermSet on guide pages
  - Assert BlogPosting schema on blog posts
  - Assert FAQPage schema on pages with FAQs
  - **Ref:** Strategy Pillar 4, PRD US-008

---

## Dependency Graph

```
Phase 1 (types + data model)
    |
    ├──→ Phase 2 (data population) ──→ Phase 5 (service page template)
    |                                        |
    ├──→ Phase 3 (components) ──────→ Phase 4 (header nav)
    |         |                              |
    |         └──→ Phase 5, 6, 9             |
    |                                        |
    └──→ Phase 7 (AnswerBlock AEO) ──→ Phase 10 (build verification)
         Phase 8 (Org schema) ──────→ Phase 10
         Phase 6 (blog cross-links) → Phase 10
         Phase 9 (guide hub) ────────→ Phase 10
```

Parallelizable groups:
- After Phase 1: Phases 2, 3, 7, 8 can all run in parallel
- After Phase 2 + 3: Phases 4, 5, 6, 9 can run in parallel
- Phase 10 runs last after everything else is wired up

---

## Risk Areas

| Risk | Impact | Mitigation |
|---|---|---|
| Breaking existing 54 service pages that lack guide-depth data | High | All new fields are optional; template conditionally renders sections |
| Large JSON data changes causing merge conflicts | Medium | Work on one service at a time in data tasks; commit between each |
| Header dropdown breaking mobile layout | Medium | Test mobile nav separately; use existing MobileNav pattern |
| Comparison table overflow on small screens | Low | Follow existing ComparisonTable.tsx mobile card pattern |
| SSG build time increase from larger JSON files | Low | JSON files are loaded at build time only; negligible impact |
| Schema validation failures | Medium | Write unit tests for schema output; test before deploying |

---

## Complexity Estimates

| Task | Size | Notes |
|---|---|---|
| 1.1–1.3 Type extensions | S | Additive-only interface changes |
| 2.1–2.5 Service data population | L | Content authoring for 5 pages, ~1,500 words each |
| 2.6 World Cup cross-links | S | Adding fields to existing JSON entries |
| 2.7 Guide hub data | M | Research + data authoring |
| 3.1 ServiceComparisonTable | M | New component with responsive layout |
| 3.2–3.3 ProTips, ExploreCta | S | Simple presentational components |
| 3.4 AnswerBlock enhancement | S | Small semantic changes to existing component |
| 3.5 NeighbourhoodFacts | M | Multi-section layout component |
| 3.6 BestOfDropdown | M | Client component with hover/click state |
| 4.1–4.3 Header integration | S | Wiring existing components |
| 5.1 Service page template | M | Conditional rendering of multiple new sections |
| 5.2 Schema for comparison tables | S | New schema generator function |
| 6.1–6.2 Blog cross-links | S | Template update + data wiring |
| 7.1–7.2 Speakable schema update | S | Minor schema tweak |
| 8.1–8.2 Organization schema | S | New schema function + layout injection |
| 9.1–9.2 Guide hub upgrade | M | Page template expansion with new data |
| 10.1–10.3 Build + test | M | Comprehensive verification across all changes |
