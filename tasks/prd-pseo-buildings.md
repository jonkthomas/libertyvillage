# PRD: Programmatic SEO — Liberty Village Condo Buildings Pages

**Feature:** `/buildings/[slug]` programmatic pages + `/buildings` hub  
**Date:** 2026-04-20  
**Priority:** P0 — closes 22× keyword-breadth gap with libertyvillagetoronto.com  
**Playbooks applied:** Profiles × Locations (layered)

---

## Background & Opportunity

DataForSEO diagnostic (2026-04-20) confirmed `libertyvillagetoronto.com` ranks for **2,161 Canadian keywords** vs **96 for libertyvillage.co**. The gap is not technical — our schema, metadata, and Core Web Vitals match or exceed theirs. The gap is **entity coverage**: they have a page for every condo building in Liberty Village; we have none.

Liberty Village has ~50 named residential buildings. Each captures 5–15 distinct search queries:
- `[building name] reviews` — commercial, high intent
- `[building name] rent` — commercial, high intent  
- `[building name] address` — navigational
- `[building name] amenities` — informational
- `[building name] maintenance fees` — research intent
- `[building name] parking` — practical
- `living at [building name]` — research

At 50 buildings × ~10 queries per building = **500+ rankable long-tail queries** with low competition (small local site currently wins). Average: 50–200 monthly searches per query. Estimated total new monthly traffic at maturity: **2,000–5,000 additional clicks**.

---

## Goals

1. Ship 20+ building pages by week 1 (proof of concept), expandable to 50+
2. Each page targets 6+ building-specific queries
3. Zero thin-content flags — unique editorial voice, real data, conditional content by building type
4. Internal cross-links to existing businesses.json listings (nearest gym, coffee, dentist)
5. ApartmentComplex schema on every page
6. Sitemap includes all building URLs

---

## Non-Goals

- Real-time rental listings (no MLS integration)
- User-submitted reviews
- Map embeds (future enhancement)

---

## Data Model: `data/buildings.json`

Each entry is a `Building` object with the following fields:

```typescript
interface Building {
  // Identity
  slug: string;                    // URL-safe, e.g. "toy-factory-lofts"
  name: string;                    // Display name, e.g. "Toy Factory Lofts"
  alternateNames: string[];        // e.g. ["TFL", "Toy Factory"]
  
  // Location
  address: string;                 // Full street address
  postalCode: string;              // e.g. "M6K 2Z8"
  latitude: number;                // For geo schema
  longitude: number;               // For geo schema
  
  // Physical facts
  yearBuilt: number;               // e.g. 2004
  units: number;                   // Approximate unit count
  floors: number;                  // Number of floors
  buildingType: "loft" | "condo" | "rental" | "townhouse" | "mixed";
  developer?: string;              // e.g. "Freed Developments"
  
  // Market data (sourced from Realtor.ca / Zolo / editorial)
  avgRent1BR: number;              // CAD per month
  avgRent2BR: number;              // CAD per month
  avgPricePerSqft: number;        // CAD, resale
  maintenanceFeePerSqft?: number; // CAD/sqft/month
  
  // Walkability (from Walk Score or editorial estimate)
  walkScore: number;               // 0-100
  transitScore: number;            // 0-100
  bikeScore: number;               // 0-100
  nearestTTC: string;              // e.g. "504 King at Dufferin (3 min walk)"
  
  // Amenities (array of strings — used for conditional display + schema)
  amenities: string[];             // e.g. ["Gym", "Rooftop Terrace", "Concierge"]
  hasParking: boolean;
  hasLockers: boolean;
  petFriendly: boolean;
  
  // Cross-references (slugs from businesses.json for nearest services)
  nearestBusinessSlugs: string[];  // e.g. ["goodlife-liberty-village", "balzacs-coffee"]
  
  // Content (editorial, unique per building)
  description: string;             // 2-3 sentence overview
  answerBlock: string;             // 40-80w, factual, leads with name+address+rent+type
  keyTakeaways: string[];          // 4-5 bullets
  proTips: string[];               // 3-4 resident tips
  pros: string[];                  // 3-5 pros
  cons: string[];                  // 2-4 cons
  specificFaqs: FAQ[];             // 6+ FAQs
  
  // Tags (for filtering on hub)
  tags: string[];                  // e.g. ["loft", "pet-friendly", "luxury"]
  
  // Media
  image?: string;                  // Optional hero image path
  
  // SEO metadata overrides (optional)
  metaTitle?: string;              // Auto-generated if absent
  metaDescription?: string;        // Auto-generated if absent
}
```

### Seed buildings (20 real Liberty Village addresses)

The PRD targets these 20 buildings for launch. Slugs and names confirmed — all data to be populated in `data/buildings.json`:

| Slug | Name | Address | Type | Year |
|---|---|---|---|---|
| toy-factory-lofts | Toy Factory Lofts | 43 Hanna Ave | loft | 2004 |
| liberty-central-by-the-green | Liberty Central by the Green | 85 East Liberty St | condo | 2012 |
| liberty-market-lofts | Liberty Market Lofts | 8 Fraser Ave | loft | 2009 |
| electra-lofts | Electra Lofts | 38 Niagara St | loft | 2007 |
| liberty-lofts | Liberty Lofts | 12 Hanna Ave | loft | 2002 |
| link-condos | Link Condos | 36 Lisgar St | condo | 2014 |
| icon-at-king-and-dufferin | Icon at King & Dufferin | 31 Brock Ave | condo | 2017 |
| liberty-village-townhomes | Liberty Village Townhomes | Mowat Ave | townhouse | 2006 |
| sixty-five-east-liberty | 65 East Liberty St | 65 East Liberty St | condo | 2010 |
| fifty-one-east-liberty | 51 East Liberty St | 51 East Liberty St | condo | 2008 |
| liberty-house | Liberty House | 170 East Liberty St | rental | 2019 |
| king-liberty-village | King Liberty Village | 1 Brock Ave | condo | 2016 |
| fly-condos | Fly Condos | 5 Hanna Ave | condo | 2013 |
| massey-tower-adjacent | Lynn Williams Condos | 150 Lynn Williams St | condo | 2011 |
| evolution-condos | Evolution Condos | 90 Niagara St | condo | 2018 |
| liberty-village-rentals-atlantic | Atlantic Rentals | 99 Atlantic Ave | rental | 2015 |
| carnaby-condos | Carnaby Condos | 51 Brock Ave | condo | 2020 |
| reina-at-liberty-village | Reina at Liberty Village | 17 Hanna Ave | condo | 2022 |
| west-condos | West Condos | 369 Sorauren Ave | condo | 2019 |
| festival-tower-adjacent | Mowat Lofts | 20 Mowat Ave | loft | 2003 |

---

## URL Structure

```
/buildings                          → Hub: all buildings
/buildings/toy-factory-lofts        → Profile: Toy Factory Lofts
/buildings/liberty-central-by-the-green → Profile: Liberty Central
```

---

## Anti-Thin-Content Rules

Each building page MUST have conditional content based on `buildingType`:

| Type | Conditional section |
|---|---|
| `loft` | "Industrial Heritage" block — dates, original factory use, conversion story |
| `condo` | "Condo Corporation" block — maintenance fee context, board, HVAC |
| `rental` | "Tenant Rights" block — Ontario tenants' rights, maintenance requests |
| `townhouse` | "Street-Level Living" block — private entrances, parking, yard |
| `mixed` | Both condo and rental sections |

This prevents thin-content across similar building types.

---

## Files to Create / Modify

| File | Action | Notes |
|---|---|---|
| `data/buildings.json` | CREATE | 20 seed buildings |
| `lib/types.ts` | MODIFY | Add `Building` + `BuildingFAQ` interfaces |
| `lib/data.ts` | MODIFY | Add `getAllBuildings()`, `getBuildingBySlug()`, `getBuildingsByType()` |
| `lib/meta.ts` | MODIFY | Add `generateBuildingPageMeta()`, `generateBuildingsHubMeta()` |
| `lib/schema.ts` | MODIFY | Add `generateApartmentComplexSchema()` |
| `app/buildings/page.tsx` | CREATE | Hub: grouped by type, CollectionPage schema |
| `app/buildings/[slug]/page.tsx` | CREATE | Detail: full template with conditional sections |
| `app/sitemap.ts` | MODIFY | Add `getAllBuildings().map(...)` |
| `components/Header.tsx` | MODIFY | Add "Buildings" link under guides dropdown or standalone |
| `app/page.tsx` | MODIFY | Add `/buildings` to popularGuides |

---

## User Stories

### US-01: Building data model exists
**As a** developer,  
**I want** `data/buildings.json` with 20 valid Building objects,  
**So that** all downstream pages render without missing data.

**Acceptance criteria:**
- [ ] `data/buildings.json` parses without error
- [ ] All 20 buildings have: slug, name, address, yearBuilt, units, floors, buildingType, avgRent1BR, avgRent2BR, amenities (≥3), answerBlock (40-80 words), keyTakeaways (≥4), specificFaqs (≥6), pros (≥3), cons (≥2)
- [ ] answerBlock is unique per building (no copy-paste)
- [ ] nearestBusinessSlugs reference valid slugs from businesses.json
- [ ] TypeScript `Building` interface is in `lib/types.ts`

---

### US-02: Data accessors exist
**As a** Next.js page component,  
**I want** `getAllBuildings()`, `getBuildingBySlug(slug)`, `getBuildingsByType(type)`,  
**So that** I can query building data cleanly.

**Acceptance criteria:**
- [ ] `getAllBuildings()` returns array of 20 Building objects
- [ ] `getBuildingBySlug("toy-factory-lofts")` returns the Toy Factory Lofts building
- [ ] `getBuildingsByType("loft")` returns only loft buildings
- [ ] All functions are exported from `lib/data.ts`
- [ ] TypeScript compiles cleanly

---

### US-03: Meta generators exist
**As a** page route,  
**I want** `generateBuildingPageMeta(building)` and `generateBuildingsHubMeta()`,  
**So that** every page has a unique title (<60 chars), description (<155 chars), canonical URL, and OG tags.

**Acceptance criteria:**
- [ ] `generateBuildingPageMeta(toyFactoryLofts)` returns title: "Toy Factory Lofts — Liberty Village Condos, Reviews & Rent"
- [ ] All titles are ≤60 characters
- [ ] All descriptions are ≤155 characters
- [ ] Canonical URLs follow pattern: `https://libertyvillage.co/buildings/[slug]`
- [ ] OG image defaults to `/images/og/og-buildings.jpg`

---

### US-04: ApartmentComplex schema exists
**As a** search crawler,  
**I want** valid ApartmentComplex JSON-LD on every building detail page,  
**So that** Google can understand and display rich results for building queries.

**Acceptance criteria:**
- [ ] `generateApartmentComplexSchema(building)` emits:
  - `@type: "ApartmentComplex"`
  - `name` (building name)
  - `address` with `PostalAddress` sub-type (streetAddress, addressLocality, addressRegion, postalCode, addressCountry)
  - `geo` with `GeoCoordinates` (latitude, longitude)
  - `amenityFeature` array from `building.amenities`
  - `priceRange` derived from avgRent1BR
- [ ] Schema validates without errors in Google Rich Results Test
- [ ] No duplicate schema blocks (Breadcrumbs + FAQPage components handle their own; page doesn't re-emit them)

---

### US-05: Hub page `/buildings` renders server-side
**As a** user searching "liberty village condos",  
**I want** a hub page at `/buildings` listing all buildings grouped by type,  
**So that** I can browse buildings by type and navigate to individual profiles.

**Acceptance criteria:**
- [ ] Route `/buildings` returns HTTP 200
- [ ] H1: "Liberty Village Condo Buildings & Lofts Guide (2026)"
- [ ] Answer block (40-80w) with quick summary of neighbourhood's building mix
- [ ] Buildings grouped into sections by type (Lofts, Condos, Rentals, Townhouses)
- [ ] Each building card shows: name, address, yearBuilt, avgRent1BR, buildingType badge, amenities count
- [ ] Cards link to `/buildings/[slug]`
- [ ] CollectionPage + BreadcrumbList schema emitted
- [ ] Title: "Liberty Village Condo Buildings & Lofts — Complete Guide 2026"
- [ ] Page is fully SSR (no "Loading..." placeholder in server HTML)
- [ ] `/buildings` appears in sitemap.xml
- [ ] `/buildings` linked from homepage `popularGuides` array
- [ ] Link added to Header nav (under Guides dropdown or similar)

---

### US-06: Detail page `/buildings/[slug]` renders with full content
**As a** user searching "toy factory lofts reviews",  
**I want** a dedicated page with accurate info about that building,  
**So that** I can learn about the building before renting/buying.

**Acceptance criteria:**
- [ ] Route `/buildings/toy-factory-lofts` returns HTTP 200
- [ ] H1: "Toy Factory Lofts — Liberty Village Condos (43 Hanna Ave)"
- [ ] AnswerBlock rendered (the 40-80w unique text from buildings.json)
- [ ] KeyTakeaways component (4-5 bullets)
- [ ] Quick-facts card: yearBuilt, units, floors, buildingType, avgRent1BR, avgRent2BR, walkScore, transitScore
- [ ] Amenities grid (icons + labels)
- [ ] **Conditional section** based on buildingType:
  - loft → "Industrial Heritage" section
  - condo → "Condo Corporation" section
  - rental → "Tenant Rights" section
  - townhouse → "Street-Level Living" section
- [ ] Nearest businesses section (cross-refs nearestBusinessSlugs → /directory/[slug] links with rating + category)
- [ ] Transit info section (nearestTTC string)
- [ ] ProTips component (3-4 tips)
- [ ] Pros/Cons section (inline, not a component — simple two-column list)
- [ ] FAQSection (6+ FAQs from specificFaqs)
- [ ] RelatedLinks to 3 nearby buildings of similar type
- [ ] ApartmentComplex + BreadcrumbList + FAQPage + Speakable schema
- [ ] Page is fully SSR (no dynamic client rendering for content)

---

### US-07: Static params generated for all buildings
**As a** Next.js build,  
**I want** `generateStaticParams()` in `app/buildings/[slug]/page.tsx`,  
**So that** all building pages are pre-rendered at build time.

**Acceptance criteria:**
- [ ] `npx next build` succeeds with 20 new static pages at `/buildings/[slug]`
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Sitemap returns 278 + 20 buildings + 1 hub = 299 URLs after commit

---

### US-08: Internal linking is complete
**As a** search crawler,  
**I want** building pages to be reachable and cross-linked,  
**So that** Google can crawl and index all 20+ pages efficiently.

**Acceptance criteria:**
- [ ] Homepage `popularGuides` includes `/buildings` card
- [ ] Header nav links to `/buildings`
- [ ] Each building detail page links to: parking guide (`/guide/parking-guide`), 3 related buildings, 2-4 nearest business directory pages
- [ ] Hub page links to all 20 building detail pages
- [ ] All 21 new URLs (hub + 20 detail) appear in `/sitemap.xml`
- [ ] Zero orphan pages (every building reachable from homepage within 3 clicks)

---

### US-09: UAT matrix — all pages verified against live running app
**As a** product owner,  
**I want** adversarial-qa verification of all 8 user stories against the dev server,  
**So that** I know the feature works before it reaches production.

**Acceptance criteria:**
- [ ] `/buildings` returns 200 with SSR content in Playwright
- [ ] `/buildings/toy-factory-lofts` returns 200 with H1, AnswerBlock, FAQSection visible
- [ ] `/buildings/liberty-central-by-the-green` renders as condo type with condo-specific section
- [ ] `/buildings/liberty-house` renders as rental type with Tenant Rights section
- [ ] Schema validates (ApartmentComplex + FAQPage present, no duplicates)
- [ ] All 20 building slugs return 200 (not 404)
- [ ] Sitemap includes hub + all 20 slugs
- [ ] Homepage shows Buildings in popularGuides
- [ ] Header links to /buildings
- [ ] TypeScript: zero errors
- [ ] Build: zero errors, 20 static pages generated

---

## Schema Strategy (No Duplication)

Building detail pages emit 5 JSON-LD blocks:
1. `WebSite` — from `layout.tsx` (always present)
2. `BreadcrumbList` — from `<Breadcrumbs />` component (emitted by component, NOT by page)
3. `FAQPage` — from `<FAQSection />` component (emitted by component, NOT by page)
4. `ApartmentComplex` — emitted explicitly by page via `generateApartmentComplexSchema()`
5. `WebPage` with Speakable — emitted explicitly by page via `generateSpeakableSchema()`

Hub page emits 3 JSON-LD blocks:
1. `WebSite` — from `layout.tsx`
2. `BreadcrumbList` — from `<Breadcrumbs />` component
3. `CollectionPage` — emitted explicitly by page

---

## Anti-Thin-Content Checklist (per building)

Before any building entry is considered valid:
- [ ] answerBlock uses the building's actual name, address, year built, and rent figure
- [ ] answerBlock does NOT contain placeholder text or template boilerplate
- [ ] specificFaqs include the exact building name in question text
- [ ] pros/cons reference building-specific attributes (not generic condo pros/cons)
- [ ] description is ≥2 sentences mentioning the building's distinctive feature

---

## Success Metrics (verify in next /seo-weekly)

| Metric | Baseline | 8-week target |
|---|---|---|
| DFS ranked keywords (CA) | 96 | 250+ |
| Building-related impressions (GSC) | 0 | 500+ |
| /buildings pages indexed | 0 | 20+ |
| Internal links to /buildings/* | 0 | 60+ |

---

## Technical Constraints

- All building pages must be **static** (SSG via `generateStaticParams`) — no dynamic server rendering
- `data/buildings.json` is the single source of truth — no DB, no CMS
- All existing utilities (`lib/schema.ts`, `lib/meta.ts`, `lib/links.ts`) must be used — no new schema patterns
- Building type conditional sections are rendered in the page TSX, not in the JSON data
- `npx next build` must produce zero warnings and zero errors

---

## QA Verification Checklist (for adversarial-qa)

```
CHECKLIST:
1. GET /buildings → 200, H1 present in SSR HTML, 20+ building links visible
2. GET /buildings/toy-factory-lofts → 200, AnswerBlock rendered, FAQSection (6+ Qs), ApartmentComplex JSON-LD
3. GET /buildings/liberty-house → rental-specific "Tenant Rights" section visible
4. GET /buildings/toy-factory-lofts → loft-specific "Industrial Heritage" section visible
5. GET /sitemap.xml → contains /buildings and /buildings/[all 20 slugs]
6. GET / → popularGuides includes /buildings
7. Playwright: navigate to /buildings, click first building card, land on detail page
8. Playwright: check zero 404s for all 20 building slugs
9. Schema: ApartmentComplex + FAQPage present on detail pages, NO duplicates
10. TypeScript: npx tsc --noEmit exits 0
11. Build: npx next build exits 0 with 20 new static pages
```
