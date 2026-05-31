# Requirements Document

## Introduction

libertyvillage.co is a Next.js 15 neighbourhood guide for Liberty Village, Toronto. The site currently ranks #1 for "liberty village parking guide" but does not rank on page 1 for high-value queries like "best restaurants liberty village," "gyms liberty village," or "liberty village neighbourhood guide." AI citation rate sits at 43% (3/7 key queries).

This feature set targets page 1 rankings for 5+ queries and a 71% AI citation rate (5/7 key queries) by June 2026 through six coordinated workstreams: header navigation improvements, service page content depth upgrades, World Cup cross-linking, AnswerBlock component enhancements, Organization schema addition, and guide hub page upgrade.

The site is built on Next.js 15 App Router with data stored in JSON files under `libertyvillage/data/` (services.json, posts.json, topics.json, businesses.json). Pages are server-rendered from this data. The existing component library includes Header, MobileNav, AnswerBlock, FAQSection, ComparisonTable, KeyTakeaways, BusinessCard, and RelatedLinks.

## Requirements

### Requirement 1: Header Navigation — "Best Of" Dropdown

**User Story:** As a site visitor, I want a "Best Of" dropdown in the header navigation, so that I can discover and reach service pages (restaurants, gyms, bars, etc.) directly from any page without relying on search or the directory.

#### Acceptance Criteria

1. WHEN a desktop user hovers over the "Best Of" nav item, THEN the system SHALL display a dropdown menu listing service page links within 100ms.
2. WHEN the dropdown is displayed, THEN the system SHALL show between 6 and 8 service links, each displaying the service icon and plural name (e.g. "🍽️ Restaurants"), linking to `/best/{slug}`.
3. WHEN the dropdown is displayed, THEN the system SHALL read service entries dynamically from services.json data (via the existing `getAllServices()` data function) rather than hardcoding the list.
4. WHEN services.json contains more than 8 services, THEN the system SHALL display only the top 6-8 services, prioritized by the `searchVolume` field (high > medium > low) and filtered to include at minimum: restaurants, coffee-shops, bars, gyms, brunch-spots, coworking-spaces, patios, hair-salons.
5. WHEN a desktop user moves the mouse away from both the "Best Of" nav item and the dropdown, THEN the system SHALL close the dropdown after a 150-300ms delay to prevent accidental closure during mouse travel.
6. WHEN a desktop user presses the Escape key while the dropdown is open, THEN the system SHALL close the dropdown and return focus to the "Best Of" nav item.
7. WHEN the dropdown is open, THEN the system SHALL support keyboard navigation with Tab/Shift+Tab through dropdown items and Enter to activate a link, conforming to WAI-ARIA menu pattern (role="menu", role="menuitem", aria-expanded, aria-haspopup).
8. WHEN a mobile user taps the hamburger menu, THEN the MobileNav component SHALL display a "Best Of" section as an expandable/collapsible group within the existing mobile navigation panel.
9. WHEN a mobile user taps the "Best Of" section header in the mobile nav, THEN the system SHALL toggle the visibility of the nested service links with a chevron rotation animation indicating open/closed state.
10. WHEN the mobile nav "Best Of" section is expanded, THEN the system SHALL display the same dynamically-loaded service links as the desktop dropdown.
11. WHEN a user clicks or taps any service link in the dropdown or mobile nav, THEN the system SHALL navigate to the corresponding `/best/{slug}` route and close the dropdown/mobile nav.
12. IF services.json returns an empty array or fails to load, THEN the system SHALL hide the "Best Of" nav item entirely rather than rendering an empty dropdown.
13. WHEN the Header component renders, THEN the existing nav items (Home, Directory, Blog, Guides, Compare) SHALL remain unchanged in position and styling, with "Best Of" inserted between "Home" and "Directory" in the nav order.

### Requirement 2: Service Page Content Depth Upgrade

**User Story:** As a site visitor researching Liberty Village services, I want rich comparison tables, key takeaways, and insider tips on service pages, so that I can make informed decisions without leaving the site.

#### Acceptance Criteria

1. WHEN a service entry in services.json includes a `comparisonTable` field, THEN the service page SHALL render a comparison table using structured column and row data from that field.
2. WHEN the `comparisonTable` field defines `columns` (array of column header strings) and `rows` (array of objects with values for each column), THEN the system SHALL render a responsive HTML table with those exact columns and rows.
3. WHEN a service page is rendered for one of the 5 target services (restaurants, gyms, bars, coffee-shops, coworking-spaces) AND the `comparisonTable` field is absent or empty, THEN the system SHALL auto-generate a comparison table by pulling matching businesses from businesses.json using fields: name, rating, reviewCount, priceRange, and hours.
4. WHEN both auto-generated rows and manually defined `comparisonTable.rows` exist, THEN manually defined rows SHALL take precedence, with auto-generated rows filling in only for businesses not already covered by manual entries.
5. WHEN a service entry in services.json includes a `keyTakeaways` field (array of strings), THEN the service page SHALL render these using the existing KeyTakeaways component above the business listings.
6. WHEN a service entry includes a `proTips` field (array of 3-5 strings), THEN the service page SHALL render an "Insider Tips" section with each tip as a styled card or list item, positioned after the comparison table and before the FAQ section.
7. WHEN a service entry has a `specificFaqs` array, THEN the system SHALL support 6-8 FAQ entries per service (expanded from the current 2-4).
8. WHEN a service FAQ `answer` field contains specific data points (prices, addresses, business names), THEN the system SHALL preserve and render that data verbatim without truncation.
9. WHEN the `answerBlock` field for a target service page is updated, THEN it SHALL contain at minimum: 2 specific business names, 1 price point or range, 1 address or street name, and 1 quantitative metric (rating, review count, or capacity).
10. IF a service entry lacks `comparisonTable`, `keyTakeaways`, and `proTips` fields, THEN the service page SHALL render identically to the current page layout with no visual regressions.
11. WHEN the comparison table renders on mobile (viewport < 640px), THEN the system SHALL display data in a stacked card format rather than a horizontal table, consistent with the existing ComparisonTable component's mobile pattern.
12. WHEN `comparisonTable.rows` references a business name, THEN the system SHALL validate that the business exists in businesses.json at build time and log a warning to the console if a referenced business is not found.

### Requirement 3: World Cup Cross-Links

**User Story:** As a reader of World Cup blog posts, I want contextual links to Liberty Village service pages, so that I can discover local restaurants, bars, and services related to the content I'm reading.

#### Acceptance Criteria

1. WHEN a blog post entry in posts.json includes a `crossLinks` field (array of objects with `service` slug and `ctaText`), THEN the blog post page SHALL render an "Explore Liberty Village" CTA component at the end of the post content.
2. WHEN the "Explore Liberty Village" CTA component renders, THEN it SHALL display a visually distinct banner with a heading, a short contextual sentence, and linked cards for each cross-linked service.
3. WHEN a `crossLinks` entry references a service slug, THEN the system SHALL resolve the service name, icon, and description from services.json and render a linked card pointing to `/best/{slug}`.
4. WHEN the `crossLinks` field is present, THEN the system SHALL also render inline contextual links within the blog post content at natural insertion points, using the service's plural name as anchor text (e.g. "best restaurants in Liberty Village" linking to `/best/restaurants`).
5. WHEN the target World Cup posts are updated, THEN each of these 4 posts SHALL include `crossLinks` data: `fifa-world-cup-2026-liberty-village-survival-guide`, `liberty-village-world-cup-road-closures-resident-access`, `best-bars-restaurants-near-bmo-field-world-cup-2026`, `watch-world-cup-liberty-village-without-tickets`.
6. IF a `crossLinks` entry references a service slug that does not exist in services.json, THEN the system SHALL skip that entry silently and log a warning at build time rather than rendering a broken link or crashing.
7. WHEN the "Explore Liberty Village" CTA component renders, THEN it SHALL be a reusable React component (`ExploreCTA`) that accepts `crossLinks` as a prop and can be used on any page, not just blog posts.
8. WHEN the CTA component renders on mobile, THEN the service cards SHALL stack vertically in a single column with the banner image (if any) scaled responsively.
9. IF a blog post has no `crossLinks` field or the array is empty, THEN the system SHALL not render the CTA component or any cross-link elements for that post.
10. WHEN a user clicks a cross-link card in the CTA, THEN the system SHALL navigate to the corresponding `/best/{slug}` page.

### Requirement 4: AnswerBlock Component Enhancement

**User Story:** As a search engine or AI assistant crawling the site, I want answer blocks to be semantically structured with machine-readable attributes, so that the content is more likely to be cited in AI-generated answers and featured snippets.

#### Acceptance Criteria

1. WHEN the AnswerBlock component renders, THEN it SHALL use a `<section>` element as the outermost wrapper instead of a `<div>`.
2. WHEN the AnswerBlock component renders, THEN it SHALL include a visually hidden or small-text `<h2>` heading (e.g. "Quick Answer" or a contextual heading passed as a prop) as the first child of the section, providing semantic structure.
3. WHEN the AnswerBlock component renders, THEN the section element SHALL include a `data-answer="true"` attribute to enable programmatic identification of answer content.
4. WHEN the AnswerBlock component renders, THEN the existing `.answer-block` CSS class SHALL remain on the element to preserve compatibility with the existing `generateSpeakableSchema()` function which uses `.answer-block` as a cssSelector.
5. WHEN the AnswerBlock component renders on a page with Speakable schema, THEN the Speakable schema's `cssSelector` array SHALL include both `.answer-block` and `[data-answer]` selectors for redundancy.
6. WHEN `answerBlock` text is authored for any service or blog post, THEN it SHALL be self-contained — readable and meaningful without requiring the surrounding page context — so that AI systems can cite it independently.
7. WHEN the AnswerBlock component renders, THEN the paragraph text SHALL remain in a `<p>` tag with the existing styling classes, and no visual changes SHALL be introduced that alter the current appearance.
8. IF the AnswerBlock component receives no children or empty children, THEN it SHALL return null and render nothing.

### Requirement 5: Organization Schema

**User Story:** As the site owner, I want Organization schema markup on the homepage, so that search engines and AI assistants correctly identify the site as a neighbourhood guide for Liberty Village, Toronto.

#### Acceptance Criteria

1. WHEN the homepage (`app/layout.tsx` or `app/page.tsx`) renders, THEN the system SHALL include a `<script type="application/ld+json">` block containing valid Organization schema.
2. WHEN the Organization schema renders, THEN it SHALL include the following required fields: `@type: "Organization"`, `name: "LibertyVillage.co"`, `url: "https://libertyvillage.co"`, `description` (a concise description of the site as a Liberty Village neighbourhood guide), and `areaServed` with `name: "Liberty Village"` and `containedInPlace: "Toronto, Ontario, Canada"`.
3. WHEN the Organization schema renders, THEN it SHALL include a `logo` field referencing the site's logo image URL (absolute URL on the libertyvillage.co domain).
4. IF social media profile URLs exist for the site, THEN the Organization schema SHALL include a `sameAs` array with those profile URLs. IF no social profiles exist, THEN the `sameAs` field SHALL be omitted rather than included as an empty array.
5. WHEN the Organization schema is generated, THEN it SHALL be produced by a new `generateOrganizationSchema()` function in `lib/schema.ts`, consistent with the existing schema generation pattern used by `generateWebsiteSchema()`, `generateSpeakableSchema()`, etc.
6. WHEN both the WebSite schema and Organization schema render on the homepage, THEN they SHALL be in separate `<script type="application/ld+json">` blocks to avoid conflicts, and both SHALL validate against Google's Rich Results Test tool.
7. WHEN the Organization schema renders, THEN the `areaServed` field SHALL use the `@type: "Place"` schema with structured location data rather than a plain string.

### Requirement 6: Guide Hub Page Upgrade

**User Story:** As a visitor looking for a Liberty Village neighbourhood overview, I want the /guide page to function as a comprehensive neighbourhood guide with key facts and local knowledge, so that I get a complete picture of the neighbourhood before drilling into specific topics.

#### Acceptance Criteria

1. WHEN the /guide page renders, THEN it SHALL display a "Key Facts" sidebar (desktop) or top section (mobile) containing: population (~12,000), median 1BR rent (~$2,200), walk score (87), transit score (80), bike score (90), and neighbourhood boundaries (King St W, Dufferin St, Gardiner Expressway, Strachan Ave).
2. WHEN the /guide page renders, THEN it SHALL include a "History" section with content covering: the neighbourhood's origins as the Central Prison site (1874-1915), the industrial/manufacturing era, and the condo transformation from the early 2000s onward.
3. WHEN the /guide page renders, THEN it SHALL include a "What It's Like to Live Here" section with honest pros (walkability, restaurant density, community feel, transit access) and cons (noise from Gardiner/construction, limited green space, parking difficulties, condo density).
4. WHEN the /guide page renders, THEN it SHALL preserve and continue to display the existing grid of guide topic links below the new content sections.
5. WHEN the guide hub content data is structured, THEN it SHALL be stored in either a new `guide-hub.json` data file under `libertyvillage/data/` or as a static data object within the page component, keeping the pattern consistent with the rest of the site.
6. WHEN the "Key Facts" sidebar renders on desktop (viewport >= 1024px), THEN it SHALL appear as a sticky sidebar alongside the main content. WHEN on mobile or tablet, THEN it SHALL collapse into a horizontal scrollable card strip or a stacked section above the main content.
7. WHEN the /guide page renders, THEN it SHALL include an AnswerBlock at the top with a self-contained summary paragraph about Liberty Village as a neighbourhood, suitable for AI citation.
8. WHEN the /guide page metadata renders, THEN the page title SHALL be updated to target "Liberty Village neighbourhood guide" as a primary keyword (e.g. "Liberty Village Neighbourhood Guide — Toronto | libertyvillage.co").
9. WHEN the /guide page renders, THEN it SHALL include updated CollectionPage schema and a Speakable schema pointing to the new AnswerBlock content.
10. IF guide hub content data (key facts, history, pros/cons) is missing or fails to load, THEN the page SHALL fall back to the current layout showing only the guide topic grid without errors.
11. WHEN the history section renders, THEN dates and facts SHALL be cited or verifiable, and the content SHALL be stored as structured data (not raw HTML) to enable future reuse.
12. WHEN the "What It's Like to Live Here" section renders, THEN pros and cons SHALL each be rendered as a list with clear visual distinction (e.g. green checkmarks for pros, amber caution icons for cons).
