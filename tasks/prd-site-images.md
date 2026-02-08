# PRD: Visual Assets for libertyvillage.co

## Introduction

libertyvillage.co currently has zero images — every page is text, emojis, and colored backgrounds. This PRD covers adding 100+ images across all 5 page types to create a warm, editorial visual identity. The approach mixes AI-generated images (via Glif Seedream v4.5) for hero banners, category illustrations, and branded assets, with real business photography sourced from Unsplash for authentic neighborhood and business visuals.

## Goals

- Add hero/banner images to every page type (homepage, service, comparison, directory, guide)
- Source or generate real-looking photos for all 76 business listings
- Create 10-15 neighborhood atmosphere shots reusable across multiple pages
- Add category-specific header images for all 60 service pages
- Generate OG (Open Graph) images for social sharing on key pages
- Maintain fast page load via Next.js `<Image>` component with automatic WebP/AVIF optimization
- Keep total image weight under 5MB for initial page loads (lazy load below-the-fold)

## User Stories

### US-001: Add `image` field to Business type and data
**Description:** As a developer, I need an `image` field on each business so pages can display business photos.

**Acceptance Criteria:**
- [ ] Add optional `image?: string` field to `Business` interface in `lib/types.ts`
- [ ] Field holds a path relative to `/public/images/businesses/` (e.g., `"mildreds-temple-kitchen.jpg"`)
- [ ] Update `data/businesses.json` — add `image` key to all 76 entries with a filename matching `{slug}.jpg`
- [ ] Typecheck passes
- [ ] **Unit Tests:** Verify all 76 business entries have valid image paths, no duplicates
- [ ] **Code Review:** Run code-reviewer agent to verify type safety

### US-002: Add `image` field to Service type and data
**Description:** As a developer, I need an `image` field on each service category for hero banners on `/best/*` pages.

**Acceptance Criteria:**
- [ ] Add optional `image?: string` field to `Service` interface in `lib/types.ts`
- [ ] Field holds a path relative to `/public/images/services/` (e.g., `"restaurants.jpg"`)
- [ ] Update `data/services.json` — add `image` key to all 60 entries
- [ ] Typecheck passes
- [ ] **Unit Tests:** Verify all 60 service entries have valid image paths
- [ ] **Code Review:** Run code-reviewer agent to verify type safety

### US-003: Add `image` field to Topic type and data
**Description:** As a developer, I need an `image` field on each guide topic for hero banners on `/guide/*` pages.

**Acceptance Criteria:**
- [ ] Add optional `image?: string` field to `Topic` interface in `lib/types.ts`
- [ ] Field holds a path relative to `/public/images/guides/` (e.g., `"parking-guide.jpg"`)
- [ ] Update `data/topics.json` — add `image` key to all 37 entries
- [ ] Typecheck passes
- [ ] **Unit Tests:** Verify all 37 topic entries have valid image paths
- [ ] **Code Review:** Run code-reviewer agent to verify type safety

### US-004: Add `image` field to Neighborhood type and data
**Description:** As a developer, I need an `image` field on each neighborhood comparison for hero banners on `/vs/*` pages.

**Acceptance Criteria:**
- [ ] Add optional `image?: string` field to `Neighborhood` interface in `lib/types.ts`
- [ ] Field holds a path relative to `/public/images/neighborhoods/` (e.g., `"king-west.jpg"`)
- [ ] Update `data/neighborhoods.json` — add `image` key to all 15 entries
- [ ] Typecheck passes
- [ ] **Unit Tests:** Verify all 15 neighborhood entries have valid image paths
- [ ] **Code Review:** Run code-reviewer agent to verify type safety

### US-005: Create reusable HeroImage component
**Description:** As a developer, I need a reusable hero image component that renders a full-width banner with overlay text, used across all page types.

**Acceptance Criteria:**
- [ ] Create `components/HeroImage.tsx` component
- [ ] Props: `src: string`, `alt: string`, `children?: ReactNode` (for overlay text)
- [ ] Uses Next.js `<Image>` with `priority` for above-the-fold, `fill` + `object-cover` for responsive sizing
- [ ] Renders a full-width container (max-w-6xl) with rounded corners, aspect-ratio 16:9 on desktop, 4:3 on mobile
- [ ] Semi-transparent gradient overlay from bottom (for text readability)
- [ ] Graceful fallback: if image fails to load, show the existing colored background instead
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill
- [ ] **Unit Tests:** Test rendering with and without children, fallback behavior
- [ ] **Code Review:** Run code-reviewer agent to verify accessibility (alt tags, contrast)

### US-006: Generate neighborhood atmosphere photos via Glif
**Description:** As a content creator, I need 12-15 AI-generated editorial-style photos of Liberty Village streetscapes, lofts, parks, and local life.

**Acceptance Criteria:**
- [ ] Generate 12-15 images using Glif Seedream API (ID: `cmiqge0g60000lb04sm7ceb6u`)
- [ ] Warm editorial style: golden hour, soft light, muted warm tones, authentic Toronto vibe
- [ ] Subjects: streetscape with brick lofts, park scene, cafe patio, King St streetcar, condo lobby, rooftop view, dog park, mural/street art, farmers market, cyclist on trail, playground, sunset over condos
- [ ] Aspect ratio: 16:9 for hero banners
- [ ] Download all to `/public/images/neighborhood/` as optimized JPGs
- [ ] Each image under 200KB after optimization
- [ ] **Code Review:** Visually review each generated image for quality and realism

### US-007: Source business photos from Unsplash
**Description:** As a content creator, I need real photography for all 76 business listing pages.

**Acceptance Criteria:**
- [ ] For each of the 76 businesses, source a relevant photo from Unsplash (free license)
- [ ] Match photo to business category (restaurant interior → restaurant listing, gym equipment → gym listing, etc.)
- [ ] Group by category — businesses in the same category can share similar-style photos but should not be identical
- [ ] Download all to `/public/images/businesses/{slug}.jpg`
- [ ] Resize to max 800px wide, compress to under 100KB each via sharp or squoosh
- [ ] Total: 76 images (can reuse ~15-20 category-generic photos across similar businesses, plus unique photos for featured/top businesses)
- [ ] **Code Review:** Spot-check 10 random images for quality and category match

### US-008: Generate service category hero images via Glif
**Description:** As a content creator, I need hero banner images for each of the 60 service category pages.

**Acceptance Criteria:**
- [ ] Generate images for each unique service category using Glif Seedream API
- [ ] Warm editorial style matching neighborhood photos (golden hour, Toronto feel)
- [ ] Each image represents the service visually (e.g., "restaurants" = warm restaurant interior, "gyms" = modern gym space)
- [ ] Where categories are visually similar, reuse across related services (e.g., "brunch-spots" and "restaurants" can share)
- [ ] Unique images needed: ~25-30 (covering distinct categories, rest share)
- [ ] Aspect ratio: 16:9, download to `/public/images/services/{slug}.jpg`
- [ ] Each image under 150KB after optimization
- [ ] **Code Review:** Visually review all generated images

### US-009: Generate guide hero images via Glif
**Description:** As a content creator, I need hero banner images for each of the 37 guide pages.

**Acceptance Criteria:**
- [ ] Generate images for each guide topic using Glif Seedream API
- [ ] Style: warm editorial, informational feel — matches topic (parking → street with parked cars, safety → well-lit neighborhood at dusk)
- [ ] Where topics are similar, reuse across related guides
- [ ] Unique images needed: ~20 (covering distinct topics, rest share)
- [ ] Aspect ratio: 16:9, download to `/public/images/guides/{slug}.jpg`
- [ ] Each image under 150KB after optimization
- [ ] **Code Review:** Visually review all generated images

### US-010: Generate comparison page hero images via Glif
**Description:** As a content creator, I need split-view or skyline-style hero images for each of the 15 neighborhood comparison pages.

**Acceptance Criteria:**
- [ ] Generate images for each comparison using Glif Seedream API
- [ ] Style: editorial Toronto skyline/streetscape representing the compared neighborhood
- [ ] Each image should evoke the specific neighborhood's character (King West = nightlife strip, Parkdale = eclectic storefronts, etc.)
- [ ] Aspect ratio: 16:9, download to `/public/images/neighborhoods/{slug}.jpg`
- [ ] Each image under 150KB after optimization
- [ ] Total: 15 images
- [ ] **Code Review:** Visually review all generated images

### US-011: Add hero image to homepage
**Description:** As a visitor, I want to see a beautiful Liberty Village hero image on the homepage so the site feels warm and authentic.

**Acceptance Criteria:**
- [ ] Add a hero background image to the homepage hero section (`app/page.tsx`)
- [ ] Use one of the best neighborhood atmosphere photos from US-006
- [ ] Image renders behind the existing gradient, with text overlay remaining readable
- [ ] Uses Next.js `<Image>` with `priority` loading (above the fold)
- [ ] On mobile, image is cropped to 4:3 aspect ratio
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill
- [ ] **Unit Tests:** Test hero section renders with image
- [ ] **Code Review:** Run code-reviewer agent to verify performance (no layout shift)

### US-012: Add hero images to service pages (`/best/*`)
**Description:** As a visitor, I want to see a relevant hero image on each service page so the page feels more polished and trustworthy.

**Acceptance Criteria:**
- [ ] Add `HeroImage` component to `app/best/[service]/page.tsx` below breadcrumbs, above h1
- [ ] Renders the service's `image` field from `services.json`
- [ ] Falls back gracefully to no image (existing text-only layout) if image field is missing
- [ ] Uses `priority` loading for above-the-fold rendering
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill
- [ ] **Unit Tests:** Test rendering with and without image field
- [ ] **Code Review:** Run code-reviewer agent to verify accessibility

### US-013: Add business photos to BusinessCard and detail pages
**Description:** As a visitor, I want to see a photo of each business on its card and detail page so I can visualize the business before visiting.

**Acceptance Criteria:**
- [ ] Update `BusinessCard.tsx` — add thumbnail image (120x80 on desktop, full-width on mobile) to the left of the text content
- [ ] Update `app/directory/[slug]/page.tsx` — add hero image above the h1 using `HeroImage` component
- [ ] Uses business's `image` field from `businesses.json`
- [ ] Falls back to a category-default placeholder if no image
- [ ] Images lazy-loaded on BusinessCard (not `priority`), priority-loaded on detail page
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill
- [ ] **Unit Tests:** Test BusinessCard renders with/without image, test detail page renders with/without image
- [ ] **Code Review:** Run code-reviewer agent to verify responsive layout doesn't break

### US-014: Add hero images to comparison pages (`/vs/*`)
**Description:** As a visitor, I want to see a neighborhood photo on each comparison page for visual context.

**Acceptance Criteria:**
- [ ] Add `HeroImage` component to `app/vs/[neighborhood]/page.tsx` below breadcrumbs, above h1
- [ ] Renders the neighborhood's `image` field from `neighborhoods.json`
- [ ] Falls back gracefully if image is missing
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill
- [ ] **Unit Tests:** Test rendering with and without image
- [ ] **Code Review:** Run code-reviewer agent to verify accessibility

### US-015: Add hero images to guide pages (`/guide/*`)
**Description:** As a visitor, I want to see a relevant photo on each guide page so the content feels editorial and trustworthy.

**Acceptance Criteria:**
- [ ] Add `HeroImage` component to `app/guide/[topic]/page.tsx` below breadcrumbs, above h1
- [ ] Renders the topic's `image` field from `topics.json`
- [ ] Falls back gracefully if image is missing
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill
- [ ] **Unit Tests:** Test rendering with and without image
- [ ] **Code Review:** Run code-reviewer agent to verify accessibility

### US-016: Add images to homepage sections
**Description:** As a visitor, I want to see thumbnail images on the homepage guide cards, accommodation cards, and service cards for a richer browsing experience.

**Acceptance Criteria:**
- [ ] Update Neighborhood Guides section cards — add small thumbnail image (from topic's `image` field)
- [ ] Update Where to Stay section cards — add small thumbnail image (from business's `image` field)
- [ ] ServiceCard component remains emoji-based (emojis are intentional branding, do not replace with images)
- [ ] Images are lazy-loaded (below the fold)
- [ ] Card layout gracefully handles missing images (falls back to current no-image layout)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill
- [ ] **Unit Tests:** Test card components render thumbnails, test fallback without images
- [ ] **Code Review:** Run code-reviewer agent to verify layout consistency

### US-017: Generate OG images for key pages
**Description:** As an SEO specialist, I need Open Graph images for social sharing so links to libertyvillage.co look professional on Twitter, Facebook, and LinkedIn.

**Acceptance Criteria:**
- [ ] Generate 5 OG images (1200x630) via Glif for key page types:
  1. Homepage — Liberty Village branded banner
  2. Service pages — generic "Best [Service] in Liberty Village" template
  3. Comparison pages — generic "Liberty Village vs [Neighborhood]" template
  4. Directory — "Liberty Village Business Directory" branded
  5. Guide pages — generic "Liberty Village Guide" template
- [ ] Download to `/public/images/og/`
- [ ] Update `lib/meta.ts` — add `openGraph.images` to each `buildMeta` call
- [ ] Typecheck passes
- [ ] **Unit Tests:** Test that metadata includes OG image URLs
- [ ] **Code Review:** Run code-reviewer agent to verify OG tag correctness

### US-018: Optimize all images for performance
**Description:** As a developer, I need all images compressed and properly configured for fast page loads.

**Acceptance Criteria:**
- [ ] Configure `next.config.ts` — add `images.formats: ['image/avif', 'image/webp']` for automatic format optimization
- [ ] Set appropriate `sizes` attribute on all `<Image>` components to prevent oversized downloads
- [ ] All hero images: max 800px wide source, compressed to under 150KB
- [ ] All business thumbnails: max 400px wide source, compressed to under 80KB
- [ ] All OG images: 1200x630, under 200KB
- [ ] Run Lighthouse audit — no image-related warnings
- [ ] Total `/public/images/` directory under 15MB
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill — no layout shift (CLS < 0.1)
- [ ] **Unit Tests:** Test Next.js config includes image optimization settings
- [ ] **Code Review:** Run code-reviewer agent to verify no missing alt tags, proper sizes attributes

### US-019: Playwright E2E Test - Images Load Correctly
**Description:** As QA, I need an end-to-end test verifying that images render on all page types without broken links.

**Acceptance Criteria:**
- [ ] Create Playwright test file `tests/e2e/images-visual.spec.ts`
- [ ] Test flow:
  1. Homepage — hero image visible, at least 1 thumbnail in guides section
  2. Service page `/best/restaurants` — hero image visible, business cards have thumbnails
  3. Business detail `/directory/mildreds-temple-kitchen` — hero image visible
  4. Comparison page `/vs/king-west` — hero image visible
  5. Guide page `/guide/parking-guide` — hero image visible
  6. No broken images on any page (check all `<img>` elements have `naturalWidth > 0`)
- [ ] Test runs on both desktop and mobile viewports
- [ ] Test includes assertions for alt text presence on all images
- [ ] Typecheck passes

### US-020: Playwright E2E Test - Image Performance
**Description:** As QA, I need to verify images don't degrade page performance.

**Acceptance Criteria:**
- [ ] Create Playwright test file `tests/e2e/image-performance.spec.ts`
- [ ] Test flow:
  1. Navigate to homepage
  2. Verify hero image has `priority` loading attribute (not lazy)
  3. Verify below-fold images have `loading="lazy"` attribute
  4. Check no images wider than viewport (no horizontal overflow)
  5. Check OG meta tags contain image URLs on service, comparison, guide, and directory pages
- [ ] Test runs on both desktop and mobile viewports
- [ ] Typecheck passes

## Quality Assurance Requirements

Each user story must include:
1. **Unit Tests (Vitest)** - Test core logic, validation, and edge cases
2. **Code Review** - Run code-reviewer agent after implementation to verify correctness
3. **Type Safety** - All code must pass TypeScript strict mode

End-to-end tests (Playwright) are defined in US-019 and US-020 to verify complete visual and performance flows.

## Functional Requirements

- FR-1: Add optional `image` field to `Business`, `Service`, `Topic`, and `Neighborhood` TypeScript interfaces
- FR-2: All 76 businesses, 60 services, 37 topics, and 15 neighborhoods have image paths in their JSON data
- FR-3: Create reusable `HeroImage` component with gradient overlay, responsive sizing, and fallback behavior
- FR-4: Homepage hero section shows a background image of Liberty Village
- FR-5: All `/best/*` pages show a category-relevant hero image below breadcrumbs
- FR-6: All `/directory/*` detail pages show a business photo hero image
- FR-7: BusinessCard component shows a thumbnail photo alongside text content
- FR-8: All `/vs/*` pages show a neighborhood photo hero image
- FR-9: All `/guide/*` pages show a topic-relevant hero image
- FR-10: Homepage guide and accommodation cards show thumbnail images
- FR-11: OG images are set in meta tags for all page types
- FR-12: All images use Next.js `<Image>` component with automatic WebP/AVIF optimization
- FR-13: Above-fold images use `priority` loading; below-fold images use `lazy` loading
- FR-14: All `<Image>` components have descriptive `alt` text

## Non-Goals (Out of Scope)

- No user-uploaded images or CMS integration
- No image galleries or lightbox viewers
- No video content
- No dynamically generated OG images (using static pre-generated images instead)
- No image CDN beyond what Vercel/Next.js provides out of the box
- No replacing the emoji icons on ServiceCard components (those are intentional branding)

## Design Considerations

- **Visual style:** Warm & editorial — soft golden hour photography, muted warm tones, authentic Toronto neighborhood feel (think local magazine or neighborhood blog)
- **Consistent palette:** Images should complement the existing amber/sage/warm color scheme
- **Hero image dimensions:** 16:9 on desktop, 4:3 crop on mobile
- **Thumbnail dimensions:** 120x80 on business cards, 200x130 on homepage guide/accommodation cards
- **Gradient overlay:** Bottom-to-top gradient (transparent to rgba(0,0,0,0.5)) on hero images for text readability
- **Reuse existing components:** `HeroImage` is the only new component; all others are modifications to existing components

## Technical Considerations

- **Image source:** Mix of Glif AI-generated (hero banners, neighborhood shots, OG images) and Unsplash free photos (business listings)
- **Glif API:** Uses Seedream v4.5 (ID: `cmiqge0g60000lb04sm7ceb6u`) via Simple API at `https://simple-api.glif.app`
- **Glif cost:** ~4.5 credits per image generation. Budget: ~70 generations = ~315 credits
- **Next.js Image component:** Automatic WebP/AVIF conversion, responsive `srcset`, lazy loading
- **`next.config.ts`:** Must add `images.formats` and possibly `images.remotePatterns` if using external URLs
- **File organization:** `/public/images/{businesses,services,guides,neighborhoods,neighborhood,og}/`
- **Compression target:** `sharp` CLI or Node.js script to resize and compress all images before committing
- **Build impact:** Adding 100+ images to `/public/` increases build time; images are not processed by webpack (served as-is by Next.js)

## Success Metrics

- Every page type has at least one image visible above the fold
- No broken images across all 190 pages (verified by E2E test)
- Lighthouse Performance score remains above 90 on homepage
- CLS (Cumulative Layout Shift) below 0.1 on all pages
- Total image payload on homepage initial load under 500KB
- OG images render correctly in Twitter Card Validator and Facebook Debugger

## Open Questions

- Should we add image alt text to the JSON data files, or auto-generate it from business name + category?
- Should business images be stored locally in `/public/` or referenced via Unsplash CDN URLs directly? (Local is safer for reliability but increases repo size)
- What is the Glif credit budget? ~70 generations at ~4.5 credits each = ~315 credits needed
- Should we generate unique OG images per page or use 5 template images across all pages of the same type?
