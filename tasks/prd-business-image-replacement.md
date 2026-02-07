# PRD: Replace 76 Fake Business Images with Real Photos

## Introduction

All 76 business images in `/public/images/businesses/` are broken — they are HTML error pages (567 bytes each) saved as `.jpg` files, not actual images. Every business listing on libertyvillage.so currently renders without a photo because the `HeroImage` and `BusinessCard` components gracefully hide missing/broken images.

This PRD covers sourcing, downloading, processing, and replacing all 76 business images with real photos from official websites, Google, or Airbnb listings. Additionally, any other missing images found across the site should be addressed.

## Current State

- **76 business `.jpg` files** exist in `/public/images/businesses/` but are all HTML documents
- **Components affected:** `BusinessCard.tsx`, `HeroImage.tsx`, business detail pages (`/directory/[slug]`), home page rental cards
- **All other image directories are healthy:** services (64 real JPEGs), guides (32), neighborhoods (15), neighborhood hero (13)
- **Existing image specs vary:** services ~1880x1253 (~190KB), neighborhoods 800x450 (~10KB), guides ~1880x1253 (~247KB)

## Goals

- Replace all 76 fake business images with real, representative photos
- Source from official business websites where possible; use category-representative stock otherwise
- Pull Airbnb listing photos for the 8 short-term rental entries
- Target 800x600 JPEG, optimized to 50-100KB per image
- Ensure every business detail page and card renders a visible image
- Verify no other broken images exist anywhere on the site

## User Stories

### US-001: Build Image Sourcing & Download Script

**Description:** As a developer, I need an automated script that searches for and downloads real photos for each business so the process is repeatable and auditable.

**Acceptance Criteria:**
- [ ] Create `scripts/download-business-images.js` (Node.js)
- [ ] Script reads `data/businesses.json` for the full list of 76 businesses
- [ ] For each business, attempt to download image from:
  1. The business's `website` field (fetch homepage, extract og:image or main hero image)
  2. Fallback: web search for `"{business name}" Liberty Village Toronto` and download top image result
  3. Final fallback: use a category-appropriate stock/representative image
- [ ] Save downloaded images to `public/images/businesses/{slug}.jpg`
- [ ] Log success/failure for each business to stdout
- [ ] Script is idempotent — skips businesses that already have a valid JPEG
- [ ] **Unit Tests:** Test URL extraction logic, fallback behavior, skip-if-exists logic
- [ ] **Code Review:** Run code-reviewer agent to verify no security issues in download logic

---

### US-002: Download Restaurant & Dining Images (18 businesses)

**Description:** As a site visitor, I want to see real photos of Liberty Village restaurants so listings feel trustworthy and useful.

**Businesses:**
| # | Slug | Name | Category |
|---|------|------|----------|
| 1 | mildreds-temple-kitchen | Mildred's Temple Kitchen | restaurants / brunch |
| 2 | nodo-liberty-village | NODO | italian-restaurants |
| 3 | chiang-mai-thai | Chiang Mai Thai Restaurant | thai-restaurants |
| 4 | burger-drops | Burger Drops | burger-joints |
| 5 | impact-kitchen | Impact Kitchen | restaurants / healthy |
| 6 | local-public-eatery | LOCAL Public Eatery | restaurants / pub |
| 7 | school-restaurant | School Restaurant | restaurants / canadian |
| 8 | oeb-breakfast-co | OEB Breakfast Co. | brunch-spots |
| 9 | brazen-head-irish-pub | Brazen Head Irish Pub | bars / irish-pub |
| 10 | moxies-liberty-village | Moxie's Grill & Bar | restaurants / casual-dining |
| 11 | the-rec-room-liberty-village | The Rec Room | bars / entertainment |
| 12 | liberty-commons-big-rock-brewery | Liberty Commons at Big Rock Brewery | breweries |
| 13 | craft-beer-market-liberty-village | Craft Beer Market | bars / craft-beer |
| 14 | pizza-libretto-liberty-village | Pizza Libretto | pizza |
| 15 | pai-northern-thai | Pai Northern Thai Kitchen | thai-restaurants |
| 16 | cibo-liberty-village | Cibo Wine Bar | italian-restaurants / wine-bar |
| 17 | left-field-brewery | Left Field Brewery | breweries |
| 18 | sushi-liberty-village | Miku Toronto | sushi / japanese |

**Acceptance Criteria:**
- [ ] All 18 images downloaded as valid JPEG files at 800x600, 50-100KB
- [ ] Prefer: storefront exterior, signature dish, or interior ambiance shot
- [ ] Source from official website og:image or hero photo where available
- [ ] Fallback to web search result for businesses without usable website images
- [ ] `file` command confirms each is `JPEG image data`, not HTML
- [ ] Verify in browser — each restaurant's `/directory/[slug]` page shows the image

---

### US-003: Download Coffee Shop Images (5 businesses)

**Description:** As a site visitor, I want to see real photos of Liberty Village coffee shops.

**Businesses:**
| # | Slug | Name |
|---|------|------|
| 1 | balzacs-coffee-liberty-village | Balzac's Coffee Roasters |
| 2 | louie-coffee-bar | Louie Coffee Bar |
| 3 | arvo-coffee | Arvo Coffee |
| 4 | dark-horse-espresso-liberty-village | Dark Horse Espresso Bar |
| 5 | jimmys-coffee-liberty-village | Jimmy's Coffee |

**Acceptance Criteria:**
- [ ] All 5 images downloaded as valid JPEG at 800x600, 50-100KB
- [ ] Prefer: storefront or interior with coffee bar visible
- [ ] `file` command confirms each is JPEG, not HTML
- [ ] Verify in browser — each coffee shop's detail page shows the image

---

### US-004: Download Fitness & Wellness Images (10 businesses)

**Description:** As a site visitor, I want to see real photos of Liberty Village gyms, yoga studios, and fitness centers.

**Businesses:**
| # | Slug | Name | Category |
|---|------|------|----------|
| 1 | goodlife-fitness-liberty-village | GoodLife Fitness | gyms |
| 2 | f45-training-liberty-village | F45 Training | gyms / group-fitness |
| 3 | altea-active | Altea Active | gyms / premium |
| 4 | orangetheory-fitness-liberty-village | Orangetheory Fitness | gyms / group-fitness |
| 5 | movati-athletic-liberty-village | Movati Athletic | gyms / athletic-club |
| 6 | studio-lagree-liberty-village | Studio Lagree | pilates / lagree |
| 7 | pure-barre-liberty-village | Pure Barre | pilates / barre |
| 8 | yoga-tree-liberty-village | Yoga Tree | yoga-studios |
| 9 | studio-spin-liberty-village | SpinCo | gyms / spin-studio |
| 10 | personal-training-liberty-village | Precision Athletics | personal-trainers |

**Acceptance Criteria:**
- [ ] All 10 images downloaded as valid JPEG at 800x600, 50-100KB
- [ ] Prefer: exterior signage, gym floor, or class in session
- [ ] `file` command confirms each is JPEG, not HTML
- [ ] Verify in browser — each fitness listing's detail page shows the image

---

### US-005: Download Health & Medical Images (10 businesses)

**Description:** As a site visitor, I want to see real photos of Liberty Village clinics, dentists, and healthcare providers.

**Businesses:**
| # | Slug | Name | Category |
|---|------|------|----------|
| 1 | liberty-village-dental | Liberty Village Dental | dentists |
| 2 | edition-dental | Edition Dental | dentists / cosmetic |
| 3 | liberty-village-physio | Liberty Village Physiotherapy & Rehab | physiotherapy |
| 4 | liberty-village-chiropractic | Liberty Village Chiropractic | chiropractors |
| 5 | liberty-village-massage-therapy | Myodetox Liberty Village | massage-therapy |
| 6 | liberty-village-optometry | Liberty Village Optometry | optometrists |
| 7 | benchmark-optometry | BenchMark Optometry | optometrists |
| 8 | liberty-village-family-medicine | Liberty Village Family Health Team | doctors |
| 9 | liberty-village-animal-hospital | Liberty Village Animal Hospital | veterinarians |
| 10 | sweet-flour-bake-shop | Sweet Flour Bake Shop | bakeries |

**Acceptance Criteria:**
- [ ] All 10 images downloaded as valid JPEG at 800x600, 50-100KB
- [ ] Prefer: storefront or clean reception/interior shot
- [ ] `file` command confirms each is JPEG, not HTML
- [ ] Verify in browser — each listing's detail page shows the image

---

### US-006: Download Beauty, Grooming & Pet Images (7 businesses)

**Description:** As a site visitor, I want to see real photos of Liberty Village salons, barbers, and pet services.

**Businesses:**
| # | Slug | Name | Category |
|---|------|------|----------|
| 1 | bsuite-hair-salon | b.suite | hair-salons |
| 2 | lavish-hair-studio | Lavish Hair Studio | hair-salons |
| 3 | baz-and-banks-barber | Baz & Banks Barber | barbers |
| 4 | tips-and-toes-nail-salon | Tips & Toes Nail Spa | nail-salons |
| 5 | liberty-pooch | Liberty Pooch | dog-walkers |
| 6 | woofstock-pet-supplies | Woof & Whiskers | pet-stores |
| 7 | the-dog-house-grooming | The Dog House Grooming | dog-groomers |

**Acceptance Criteria:**
- [ ] All 7 images downloaded as valid JPEG at 800x600, 50-100KB
- [ ] Prefer: storefront, interior, or action shot (grooming, styling)
- [ ] `file` command confirms each is JPEG, not HTML
- [ ] Verify in browser — each listing's detail page shows the image

---

### US-007: Download Professional Services & Retail Images (18 businesses)

**Description:** As a site visitor, I want to see real photos of Liberty Village coworking spaces, banks, shops, and service providers.

**Businesses:**
| # | Slug | Name | Category |
|---|------|------|----------|
| 1 | spaces-liberty-village | Spaces Liberty Village | coworking-spaces |
| 2 | the-fueling-station | The Fueling Station | coworking-spaces |
| 3 | wework-liberty-village | WeWork | coworking-spaces |
| 4 | freshco-liberty-village | FreshCo | grocery-stores |
| 5 | shoppers-drug-mart-liberty-village | Shoppers Drug Mart | pharmacies |
| 6 | rexall-liberty-village | Rexall Pharmacy | pharmacies |
| 7 | scotiabank-liberty-village | Scotiabank | banks |
| 8 | liberty-village-rbc | RBC Royal Bank | banks |
| 9 | king-west-dry-cleaners | King West Dry Cleaners | dry-cleaners |
| 10 | liberty-village-accounting | Blueprint Accounting | accountants |
| 11 | real-estate-liberty-village | Liberty Village Real Estate Team | real-estate-agents |
| 12 | bike-share-liberty-village | Sweet Pete's Bike Shop | bike-shops |
| 13 | florist-liberty-village | Tonic Blooms | florists |
| 14 | cleaning-liberty-village | Mopify | house-cleaning |
| 15 | liberty-village-daycare | Liberty Village Child Care Centre | daycares |
| 16 | caterers-liberty-village | Feast Catering Co. | caterers |
| 17 | event-space-liberty-village | Artscape Youngplace | event-spaces |
| 18 | music-lessons-liberty-village | Liberty Village Music School | music-lessons |

**Acceptance Criteria:**
- [ ] All 18 images downloaded as valid JPEG at 800x600, 50-100KB
- [ ] Prefer: storefront, signage, or representative interior shot
- [ ] `file` command confirms each is JPEG, not HTML
- [ ] Verify in browser — each listing's detail page shows the image

---

### US-008: Download Short-Term Rental Images from Airbnb (8 listings)

**Description:** As a site visitor, I want to see real photos of Liberty Village short-term rentals pulled from their actual Airbnb listings.

**Listings:**
| # | Slug | Name | Airbnb URL |
|---|------|------|-----------|
| 1 | modern-liberty-village-townhouse | Modern Liberty Village Townhouse | airbnb.com/rooms/1542736269971131768 |
| 2 | liberty-village-loft-free-parking | Liberty Village Loft with Free Parking | airbnb.com/rooms/871738166990458444 |
| 3 | chic-1br-loft-townhouse-liberty-village | Chic 1BR Loft Townhouse | airbnb.com/rooms/1576885939846485649 |
| 4 | liberty-village-bmo-field-roof-patio | Liberty Village Suite — Roof Patio & Parking | airbnb.com/rooms/1543495789538972595 |
| 5 | spacious-private-townhouse-loft-lv | Spacious Private Townhouse Loft | airbnb.com/rooms/1233529284737772574 |
| 6 | prime-location-stylish-lv-townhouse | Prime Location Stylish LV Townhouse | airbnb.com/rooms/1145912715955730597 |
| 7 | downtown-toronto-condo-liberty-village | Downtown Toronto Condo — Liberty Village | airbnb.com/rooms/889870893678449185 |
| 8 | apartment-in-liberty-village | Apartment in Liberty Village | airbnb.com/rooms/851453481116182275 |

**Acceptance Criteria:**
- [ ] All 8 images downloaded as valid JPEG at 800x600, 50-100KB
- [ ] Source the hero/cover photo from each Airbnb listing page
- [ ] If Airbnb blocks scraping, use Playwright MCP to navigate and screenshot the listing
- [ ] Fallback: search web for the listing name + "Liberty Village Airbnb" and download result
- [ ] `file` command confirms each is JPEG, not HTML
- [ ] Verify in browser — home page rental cards and `/directory/[slug]` pages show images

---

### US-009: Image Processing & Optimization Pipeline

**Description:** As a developer, I need all downloaded images resized and optimized to consistent specs so the site loads fast.

**Acceptance Criteria:**
- [ ] Create `scripts/optimize-business-images.js` (using sharp)
- [ ] Resize all business images to 800x600 (cover/crop, not stretch)
- [ ] Output as progressive JPEG at quality 80 (target 50-100KB each)
- [ ] Strip EXIF metadata for privacy and file size
- [ ] Preserve original filename/slug mapping
- [ ] Script is idempotent — only processes images that need it
- [ ] **Unit Tests:** Test resize dimensions, output format, file size range
- [ ] **Code Review:** Verify sharp usage and error handling

---

### US-010: Validation & Verification Script

**Description:** As a developer, I need a script that validates every business image is a real JPEG at the correct dimensions, so we can catch any remaining broken files.

**Acceptance Criteria:**
- [ ] Create `scripts/validate-images.js`
- [ ] Check every file in `public/images/businesses/` is a valid JPEG (not HTML, not PNG, not corrupt)
- [ ] Verify dimensions are 800x600 (within 5% tolerance)
- [ ] Verify file size is between 10KB and 200KB
- [ ] Cross-reference against `data/businesses.json` — flag any businesses missing an image file
- [ ] Flag any image files that don't correspond to a business in the JSON
- [ ] Output pass/fail report with specific failures listed
- [ ] **Unit Tests:** Test validation logic for each check type
- [ ] **Code Review:** Verify edge case handling

---

### US-011: Full Site Image Audit

**Description:** As a developer, I need to verify no other broken or placeholder images exist anywhere on the site beyond the business directory.

**Acceptance Criteria:**
- [ ] Scan ALL image files in `public/images/` (all subdirectories)
- [ ] Run `file` command on every `.jpg` and `.png` — flag any that are HTML or corrupt
- [ ] Cross-reference `data/topics.json`, `data/services.json`, `data/neighborhoods.json` image references against filesystem
- [ ] Verify home page hero image (`/images/neighborhood/brick-loft-streetscape.jpg`) is valid
- [ ] Report: list of any non-business broken images found (expected: 0)
- [ ] Fix any broken images found in other directories
- [ ] **Unit Tests:** Test scanning logic
- [ ] **Code Review:** Verify completeness of audit

---

### US-012: Playwright E2E Test — Business Images Render

**Description:** As QA, I need an end-to-end test verifying business images actually render on the live site.

**Acceptance Criteria:**
- [ ] Create Playwright test file `tests/e2e/business-images.spec.ts`
- [ ] Test flow:
  1. Navigate to home page — verify rental card images load (not broken)
  2. Navigate to `/directory` — verify business cards show images
  3. Navigate to 3 sample business detail pages (one restaurant, one gym, one rental) — verify hero image loads
  4. Assert no images return 404 or have 0 natural dimensions
- [ ] Test includes assertions for `naturalWidth > 0` on rendered `<img>` elements
- [ ] Test runs successfully in CI environment
- [ ] Typecheck passes

---

## Functional Requirements

- FR-1: All 76 files in `public/images/businesses/` must be replaced with valid JPEG images
- FR-2: Images must be sourced from official business websites (og:image, hero) when available
- FR-3: Fallback to web search results when official site images are unavailable
- FR-4: Short-term rental images must be sourced from their Airbnb listing pages
- FR-5: All images must be resized to 800x600 and optimized to 50-100KB as progressive JPEG
- FR-6: EXIF metadata must be stripped from all images
- FR-7: A validation script must confirm 76/76 images are valid post-replacement
- FR-8: No other broken images may exist anywhere in `public/images/`

## Non-Goals

- No changes to the business data model or JSON structure
- No changes to existing React components (they already handle images correctly)
- No CDN or external image hosting — all images stored locally in `public/`
- No image lazy-loading changes (Next.js Image component already handles this)
- No AI-generated images — all images must depict the real business or a real photo of a similar business type

## Technical Considerations

- **Sharp** (npm package) for image resizing/optimization — already available in Node.js ecosystem
- **Playwright MCP** available for scraping Airbnb listings if direct fetch is blocked
- **Rate limiting:** Add delays between web requests to avoid being blocked
- **Copyright:** Official business photos from their own websites are fair use for a directory listing; stock photos should be from permissive sources (Unsplash, Pexels)
- **Existing components** (`HeroImage.tsx`, `BusinessCard.tsx`) already conditionally render images — no component changes needed

## Success Metrics

- 76/76 business images are valid JPEG files (not HTML)
- All 76 business detail pages render a visible hero image
- Home page rental cards show real Airbnb photos
- Business cards in the directory show real photos
- Validation script passes with 0 failures
- No broken images anywhere on the site

## Quality Assurance Requirements

Each user story must include:
1. **Unit Tests (Vitest)** — Test core logic, validation, and edge cases
2. **Code Review** — Run code-reviewer agent after implementation to verify correctness
3. **Type Safety** — All code must pass TypeScript strict mode

End-to-end tests (Playwright) are defined in US-012 to verify complete user flows.

## Review Loop Process

After all user stories (US-001 through US-012) are complete, run this loop until clean:

1. **Run code-reviewer agent** to scan the entire site for image gaps — missing files, broken references, HTML-masquerading-as-JPEG, unreferenced images, wrong dimensions, etc.
2. **If issues found:** Create fix tasks, execute them, update the Image Tracking Log below, then go back to step 1.
3. **If clean:** Mark the PRD as complete.

This loop continues until the code-reviewer reports zero image issues across the entire site.

## Image Tracking Log

**IMPORTANT: Never pass downloaded image data inline into conversation context. Always save to file with a filename parameter. Track all progress here.**

Progress: 33/76 complete

| # | Slug | Filename | Filepath | Source | Status |
|---|------|----------|----------|--------|--------|
| 1 | mildreds-temple-kitchen | mildreds-temple-kitchen.jpg | /public/images/businesses/ | mildreds.ca (Shopify CDN) | done |
| 2 | nodo-liberty-village | nodo-liberty-village.jpg | /public/images/businesses/ | blogTO | done |
| 3 | chiang-mai-thai | chiang-mai-thai.jpg | /public/images/businesses/ | website-files CDN (official site) | done |
| 4 | burger-drops | burger-drops.jpg | /public/images/businesses/ | fcr.ca | done |
| 5 | impact-kitchen | impact-kitchen.jpg | /public/images/businesses/ | Google (lh3.googleusercontent.com) | done |
| 6 | local-public-eatery | local-public-eatery.jpg | /public/images/businesses/ | localpubliceatery.com | done |
| 7 | school-restaurant | school-restaurant.jpg | /public/images/businesses/ | schoolrestaurant.ca (Squarespace CDN) | done |
| 8 | oeb-breakfast-co | oeb-breakfast-co.jpg | /public/images/businesses/ | eatoeb.com | done |
| 9 | brazen-head-irish-pub | brazen-head-irish-pub.jpg | /public/images/businesses/ | simpleviewinc.com (Tourism Toronto) | done |
| 10 | moxies-liberty-village | moxies-liberty-village.jpg | /public/images/businesses/ | moxies.com (WordPress CDN) | done |
| 11 | the-rec-room-liberty-village | the-rec-room-liberty-village.jpg | /public/images/businesses/ | eventsource.ca | done |
| 12 | liberty-commons-big-rock-brewery | liberty-commons-big-rock-brewery.jpg | /public/images/businesses/ | oliverbonacininetwork.com CDN | done |
| 13 | craft-beer-market-liberty-village | craft-beer-market-liberty-village.jpg | /public/images/businesses/ | craftbeermarket.com (WordPress CDN) | done |
| 14 | pizza-libretto-liberty-village | pizza-libretto-liberty-village.jpg | /public/images/businesses/ | pizzerialibretto.agencydominion.net | done |
| 15 | pai-northern-thai | pai-northern-thai.jpg | /public/images/businesses/ | cloudimg.io (Google Maps photo) | done |
| 16 | cibo-liberty-village | cibo-liberty-village.jpg | /public/images/businesses/ | cibowinebar.com (Squarespace CDN) | done |
| 17 | left-field-brewery | left-field-brewery.jpg | /public/images/businesses/ | eventsource.ca | done |
| 18 | sushi-liberty-village | sushi-liberty-village.jpg | /public/images/businesses/ | mikutoronto.com (Squarespace CDN) | done |
| 19 | balzacs-coffee-liberty-village | balzacs-coffee-liberty-village.jpg | /public/images/businesses/ | balzacs.com (Shopify CDN - Liberty Village poster) | done |
| 20 | louie-coffee-bar | louie-coffee-bar.jpg | /public/images/businesses/ | louiecoffee.com (WordPress CDN) | done |
| 21 | arvo-coffee | arvo-coffee.jpg | /public/images/businesses/ | blogTO (CloudFront CDN) | done |
| 22 | dark-horse-espresso-liberty-village | dark-horse-espresso-liberty-village.jpg | /public/images/businesses/ | darkhorseespresso.com (Shopify CDN) | done |
| 23 | jimmys-coffee-liberty-village | jimmys-coffee-liberty-village.jpg | /public/images/businesses/ | jimmyscoffee.ca (Squarespace CDN) | done |
| 24 | goodlife-fitness-liberty-village | goodlife-fitness-liberty-village.jpg | /public/images/businesses/ | blogTO (CloudFront CDN - Liberty Village location) | done |
| 25 | f45-training-liberty-village | f45-training-liberty-village.jpg | /public/images/businesses/ | blogTO (CloudFront CDN) | done |
| 26 | altea-active | altea-active.jpg | /public/images/businesses/ | alteaactive.com (WordPress CDN - Toronto facility) | done |
| 27 | orangetheory-fitness-liberty-village | orangetheory-fitness-liberty-village.jpg | /public/images/businesses/ | orangetheory.com (website-files CDN) | done |
| 28 | movati-athletic-liberty-village | movati-athletic-liberty-village.jpg | /public/images/businesses/ | movatiathletic.com (WordPress CDN) | done |
| 29 | studio-lagree-liberty-village | studio-lagree-liberty-village.jpg | /public/images/businesses/ | urbaneer.com (WordPress CDN - King St W location) | done |
| 30 | pure-barre-liberty-village | pure-barre-liberty-village.jpg | /public/images/businesses/ | purebarre.com (HubSpot CDN) | done |
| 31 | yoga-tree-liberty-village | yoga-tree-liberty-village.jpg | /public/images/businesses/ | blogTO (CloudFront CDN) | done |
| 32 | studio-spin-liberty-village | studio-spin-liberty-village.jpg | /public/images/businesses/ | blogTO (CloudFront CDN - SpinCo studio) | done |
| 33 | personal-training-liberty-village | personal-training-liberty-village.jpg | /public/images/businesses/ | Unsplash (personal training stock) | done |
| 34 | liberty-village-dental | liberty-village-dental.jpg | /public/images/businesses/ | — | pending |
| 35 | edition-dental | edition-dental.jpg | /public/images/businesses/ | — | pending |
| 36 | liberty-village-physio | liberty-village-physio.jpg | /public/images/businesses/ | — | pending |
| 37 | liberty-village-chiropractic | liberty-village-chiropractic.jpg | /public/images/businesses/ | — | pending |
| 38 | liberty-village-massage-therapy | liberty-village-massage-therapy.jpg | /public/images/businesses/ | — | pending |
| 39 | liberty-village-optometry | liberty-village-optometry.jpg | /public/images/businesses/ | — | pending |
| 40 | benchmark-optometry | benchmark-optometry.jpg | /public/images/businesses/ | — | pending |
| 41 | liberty-village-family-medicine | liberty-village-family-medicine.jpg | /public/images/businesses/ | — | pending |
| 42 | liberty-village-animal-hospital | liberty-village-animal-hospital.jpg | /public/images/businesses/ | — | pending |
| 43 | sweet-flour-bake-shop | sweet-flour-bake-shop.jpg | /public/images/businesses/ | — | pending |
| 44 | bsuite-hair-salon | bsuite-hair-salon.jpg | /public/images/businesses/ | — | pending |
| 45 | lavish-hair-studio | lavish-hair-studio.jpg | /public/images/businesses/ | — | pending |
| 46 | baz-and-banks-barber | baz-and-banks-barber.jpg | /public/images/businesses/ | — | pending |
| 47 | tips-and-toes-nail-salon | tips-and-toes-nail-salon.jpg | /public/images/businesses/ | — | pending |
| 48 | liberty-pooch | liberty-pooch.jpg | /public/images/businesses/ | — | pending |
| 49 | woofstock-pet-supplies | woofstock-pet-supplies.jpg | /public/images/businesses/ | — | pending |
| 50 | the-dog-house-grooming | the-dog-house-grooming.jpg | /public/images/businesses/ | — | pending |
| 51 | spaces-liberty-village | spaces-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 52 | the-fueling-station | the-fueling-station.jpg | /public/images/businesses/ | — | pending |
| 53 | wework-liberty-village | wework-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 54 | freshco-liberty-village | freshco-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 55 | shoppers-drug-mart-liberty-village | shoppers-drug-mart-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 56 | rexall-liberty-village | rexall-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 57 | scotiabank-liberty-village | scotiabank-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 58 | liberty-village-rbc | liberty-village-rbc.jpg | /public/images/businesses/ | — | pending |
| 59 | king-west-dry-cleaners | king-west-dry-cleaners.jpg | /public/images/businesses/ | — | pending |
| 60 | liberty-village-accounting | liberty-village-accounting.jpg | /public/images/businesses/ | — | pending |
| 61 | real-estate-liberty-village | real-estate-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 62 | bike-share-liberty-village | bike-share-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 63 | florist-liberty-village | florist-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 64 | cleaning-liberty-village | cleaning-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 65 | liberty-village-daycare | liberty-village-daycare.jpg | /public/images/businesses/ | — | pending |
| 66 | caterers-liberty-village | caterers-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 67 | event-space-liberty-village | event-space-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 68 | music-lessons-liberty-village | music-lessons-liberty-village.jpg | /public/images/businesses/ | — | pending |
| 69 | modern-liberty-village-townhouse | modern-liberty-village-townhouse.jpg | /public/images/businesses/ | airbnb.com/rooms/1542736269971131768 | pending |
| 70 | liberty-village-loft-free-parking | liberty-village-loft-free-parking.jpg | /public/images/businesses/ | airbnb.com/rooms/871738166990458444 | pending |
| 71 | chic-1br-loft-townhouse-liberty-village | chic-1br-loft-townhouse-liberty-village.jpg | /public/images/businesses/ | airbnb.com/rooms/1576885939846485649 | pending |
| 72 | liberty-village-bmo-field-roof-patio | liberty-village-bmo-field-roof-patio.jpg | /public/images/businesses/ | airbnb.com/rooms/1543495789538972595 | pending |
| 73 | spacious-private-townhouse-loft-lv | spacious-private-townhouse-loft-lv.jpg | /public/images/businesses/ | airbnb.com/rooms/1233529284737772574 | pending |
| 74 | prime-location-stylish-lv-townhouse | prime-location-stylish-lv-townhouse.jpg | /public/images/businesses/ | airbnb.com/rooms/1145912715955730597 | pending |
| 75 | downtown-toronto-condo-liberty-village | downtown-toronto-condo-liberty-village.jpg | /public/images/businesses/ | airbnb.com/rooms/889870893678449185 | pending |
| 76 | apartment-in-liberty-village | apartment-in-liberty-village.jpg | /public/images/businesses/ | airbnb.com/rooms/851453481116182275 | pending |

## Open Questions

- Some businesses may have closed or rebranded since the data was compiled — should we flag these for review or just use the best available photo?
- For businesses with no web presence at all, should we use a category-generic photo (e.g., generic gym interior) or a Liberty Village street-level photo of that address?
