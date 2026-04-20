import Link from "next/link";
import Image from "next/image";
import { getAllServices, getAllTopics, getBusinessesByCategory, getRecentPosts } from "@/lib/data";
import { generateHomePageMeta } from "@/lib/meta";
import { generateBreadcrumbSchema, generateOrganizationSchema } from "@/lib/schema";
import HeroAnimation from "@/components/HeroAnimation";
import AnimatedStats from "@/components/AnimatedStats";
import SectionReveal from "@/components/SectionReveal";
import CategoryCard from "@/components/CategoryCard";
import DirectorySearchStrip from "@/components/DirectorySearchStrip";

export const metadata = generateHomePageMeta();

/* ─── Category icon SVGs ─── */
const categoryIcons: Record<string, React.ReactNode> = {
  restaurants: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v6a3 3 0 003 3h0a3 3 0 003-3V3M7.5 3v3M10.5 3v3M9 12v9M18 3v3a2 2 0 01-2 2h0a2 2 0 01-2-2V3M16 8v13" />
    </svg>
  ),
  "coffee-shops": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12l1 7h12l1-7M8 2v2M12 2v2M16 2v2" />
    </svg>
  ),
  gyms: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 6.5v11M17.5 6.5v11M6.5 12h11M2 8.5v7M22 8.5v7M4.25 8.5v7M19.75 8.5v7" />
    </svg>
  ),
  bars: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 2h8l-4 9V21M5 2h14M10 21h4" />
    </svg>
  ),
  "brunch-spots": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
      <ellipse cx="12" cy="14" rx="8" ry="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 14v1c0 2.21 3.58 4 8 4s8-1.79 8-4v-1" />
      <path strokeLinecap="round" d="M9 10c0-2 1-3 3-3s3 1 3 3" />
    </svg>
  ),
  "coworking-spaces": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V7l9-4 9 4v14M9 21V11h6v10M3 7l9 4 9-4" />
    </svg>
  ),
  "hair-salons": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v8M12 10l-6 6M12 10l6 6" />
    </svg>
  ),
  dentists: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8 2 5 5 5 8c0 2 .5 3 1.5 5s1.5 5 2.5 7c.5 1 1 1 1 1h4s.5 0 1-1c1-2 1.5-5 2.5-7S19 10 19 8c0-3-3-6-7-6z" />
      <path strokeLinecap="round" d="M10 8h4" />
    </svg>
  ),
};

const topCategoryOrder = [
  "restaurants",
  "coffee-shops",
  "gyms",
  "bars",
  "brunch-spots",
  "coworking-spaces",
  "hair-salons",
  "dentists",
];

const popularGuides = [
  { href: "/guide/things-to-do", label: "Things to Do", desc: "Restaurants, patios, parks, gyms, nightlife, and weekend activities" },
  { href: "/guide/parking-guide", label: "Parking Guide", desc: "Free and paid parking options throughout the neighbourhood" },
  { href: "/blog/weekend-brunch-guide-liberty-village", label: "Best Brunch Spots", desc: "Top-rated brunch spots ranked by locals" },
  { href: "/blog/liberty-village-fitness-guide-every-gym-compared", label: "Gym Comparison", desc: "Every gym compared with prices and amenities" },
  { href: "/blog/grocery-stores-liberty-village-complete-guide", label: "Grocery Guide", desc: "Every grocery option in and near the neighbourhood" },
  { href: "/world-cup", label: "FIFA World Cup 2026 Hub", desc: "Every match, closure, bar, and volunteer guide for Toronto's 6 BMO Field matches" },
  { href: "/blog/fifa-world-cup-2026-liberty-village-survival-guide", label: "World Cup Survival Guide", desc: "Your essential guide for the 2026 FIFA World Cup" },
  { href: "/blog/liberty-village-world-cup-road-closures-resident-access", label: "Road Closures", desc: "World Cup street closures and resident access routes" },
];

export default function Home() {
  const services = getAllServices();

  let topics: { slug: string; title: string; description: string; image?: string }[] = [];
  try {
    topics = getAllTopics().slice(0, 6);
  } catch {
    // topics.json may not exist yet during build
  }

  let recentPosts: { slug: string; title: string; description: string; category: string; image?: string }[] = [];
  try {
    recentPosts = getRecentPosts(3);
  } catch {
    // posts.json may not exist yet during build
  }

  const accommodations = getBusinessesByCategory("short-term-rentals").slice(0, 3);

  /* Build category data with counts */
  const categoriesWithCounts = topCategoryOrder.map((slug) => {
    const service = services.find((s) => s.slug === slug);
    const count = getBusinessesByCategory(slug).length;
    return {
      slug,
      name: service?.pluralName ?? slug.replace(/-/g, " "),
      count,
    };
  });

  /* Featured editorial content */
  const featuredTopic = topics[0] ?? null;
  const editorialPosts = recentPosts.slice(0, 2);

  return (
    <div className="bg-lv-cream">
      {/* ═══════════════════════════════════════════
          1. HERO — Full-bleed photo, left-aligned
          ═══════════════════════════════════════════ */}
      <section className="relative min-h-[60vh] overflow-hidden flex items-center sm:min-h-[70vh]">
        {/* Background image */}
        <div className="absolute inset-0">
          <Image
            src="/images/neighborhood/brick-loft-streetscape.jpg"
            alt="Liberty Village brick loft streetscape"
            fill
            className="object-cover object-center"
            priority
            sizes="100vw"
          />
          {/* Left-to-right directional gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#1A1512]/80 via-[#1A1512]/40 to-transparent" />
          {/* Bottom fade for stats overlap */}
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-lv-cream to-transparent" />
        </div>

        {/* Hero content — left-aligned */}
        <div className="relative z-[1] mx-auto w-full max-w-7xl px-6 py-24 sm:px-10 lg:px-16">
          <HeroAnimation className="max-w-2xl">
            <h1
              data-hero-animate
              className="font-display text-[clamp(48px,7vw,100px)] font-bold leading-[1.05] tracking-tight text-white"
            >
              Discover<br />Liberty<br />Village
              <span className="sr-only">, Toronto — your neighbourhood guide</span>
            </h1>
            <p
              data-hero-animate
              className="mt-5 max-w-lg text-lg leading-relaxed text-white/85 sm:text-xl"
            >
              Find the best restaurants, parking, gyms, and bars
              in Liberty Village &mdash; rated by locals, updated for 2026.
            </p>
            <div data-hero-animate className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/directory"
                className="inline-flex items-center rounded-xl bg-lv-brick px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition-all hover:bg-lv-brick-dark hover:shadow-xl"
              >
                Explore the Neighbourhood
                <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <Link
                href="/blog/moving-to-liberty-village-2026-essential-guide"
                className="inline-flex items-center rounded-xl border border-white/30 bg-white/10 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20"
              >
                New here? Start with our guide
              </Link>
            </div>
            {/* Quick-nav pills — direct paths to top-searched content */}
            <div data-hero-animate className="mt-6 flex flex-wrap gap-2">
              {[
                { href: "/best/restaurants", label: "Restaurants" },
                { href: "/guide/parking-guide", label: "Parking" },
                { href: "/best/gyms", label: "Gyms" },
                { href: "/best/bars", label: "Bars & Pubs" },
                { href: "/best/coffee-shops", label: "Coffee" },
                { href: "/blog/weekend-brunch-guide-liberty-village", label: "Brunch" },
                { href: "/guide/things-to-do", label: "Things to Do" },
              ].map((pill) => (
                <Link
                  key={pill.href}
                  href={pill.href}
                  className="rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm transition-all hover:bg-white/25 hover:text-white"
                >
                  {pill.label}
                </Link>
              ))}
            </div>
          </HeroAnimation>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          2. STATS BAR — Floating, overlaps hero
          ═══════════════════════════════════════════ */}
      <AnimatedStats />

      {/* ═══════════════════════════════════════════
          3. CATEGORY QUICK LINKS
          ═══════════════════════════════════════════ */}
      <section className="mx-auto max-w-7xl px-6 pt-20 pb-8 sm:px-10 lg:px-16">
        <SectionReveal>
          <p className="text-sm font-semibold uppercase tracking-widest text-lv-brick">
            Browse by Category
          </p>
          <h2 className="mt-2 font-display text-[clamp(24px,3vw,36px)] font-bold text-lv-warm-black">
            Explore by Interest
          </h2>
        </SectionReveal>

        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {categoriesWithCounts.map((cat, idx) => (
            <CategoryCard
              key={cat.slug}
              href={`/best/${cat.slug}`}
              icon={categoryIcons[cat.slug]}
              name={cat.name}
              count={cat.count}
              index={idx}
            />
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          4. FEATURED EDITORIAL — Asymmetric layout
          ═══════════════════════════════════════════ */}
      {(featuredTopic || editorialPosts.length > 0) && (
        <section className="mx-auto max-w-7xl px-6 py-16 sm:px-10 lg:px-16">
          <SectionReveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-lv-brick">
              Guides &amp; Stories
            </p>
            <h2 className="mt-2 font-display text-[clamp(24px,3vw,36px)] font-bold text-lv-warm-black">
              Featured Editorial
            </h2>
          </SectionReveal>

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {/* Large featured guide — 2/3 width */}
            {featuredTopic && (
              <SectionReveal className="lg:col-span-2" delay={0.1}>
                <Link
                  href={`/guide/${featuredTopic.slug}`}
                  className="group block overflow-hidden rounded-2xl border border-lv-sand bg-lv-white shadow-sm transition-all hover:shadow-lg"
                >
                  {featuredTopic.image && (
                    <div className="relative aspect-[16/9] overflow-hidden">
                      <Image
                        src={featuredTopic.image}
                        alt={featuredTopic.title}
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                        sizes="(max-width: 1024px) 100vw, 66vw"
                      />
                    </div>
                  )}
                  <div className="p-6 sm:p-8">
                    <span className="text-xs font-semibold uppercase tracking-wider text-lv-sage">
                      Guide
                    </span>
                    <h3 className="mt-2 font-display text-xl font-bold text-lv-warm-black transition-colors group-hover:text-lv-brick sm:text-2xl">
                      {featuredTopic.title}
                    </h3>
                    <p className="mt-2 text-base leading-relaxed text-lv-warm-grey line-clamp-3">
                      {featuredTopic.description}
                    </p>
                    <span className="mt-4 inline-flex items-center text-sm font-semibold text-lv-brick transition-colors group-hover:text-lv-brick-dark">
                      Read Guide
                      <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </span>
                  </div>
                </Link>
              </SectionReveal>
            )}

            {/* Right column — 2 stacked blog cards */}
            {editorialPosts.length > 0 && (
              <div className="flex flex-col gap-6">
                {editorialPosts.map((post, idx) => (
                  <SectionReveal key={post.slug} delay={0.15 + idx * 0.1}>
                    <Link
                      href={`/blog/${post.slug}`}
                      className="group flex overflow-hidden rounded-2xl border border-lv-sand bg-lv-white shadow-sm transition-all hover:shadow-lg"
                    >
                      {post.image && (
                        <div className="relative hidden w-32 shrink-0 overflow-hidden sm:block lg:w-28">
                          <Image
                            src={post.image}
                            alt={post.title}
                            fill
                            className="object-cover transition-transform duration-500 group-hover:scale-105"
                            sizes="128px"
                          />
                        </div>
                      )}
                      <div className="flex flex-1 flex-col justify-center p-4 sm:p-5">
                        <span className="text-xs font-semibold uppercase tracking-wider text-lv-sage">
                          {post.category.replace(/-/g, " ")}
                        </span>
                        <h3 className="mt-1 text-base font-semibold text-lv-warm-black transition-colors group-hover:text-lv-brick line-clamp-2">
                          {post.title}
                        </h3>
                        <p className="mt-1 text-sm text-lv-warm-grey line-clamp-2">
                          {post.description}
                        </p>
                      </div>
                    </Link>
                  </SectionReveal>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════
          5. POPULAR GUIDES — Typographic cards
          ═══════════════════════════════════════════ */}
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-10 lg:px-16">
        <SectionReveal>
          <p className="text-sm font-semibold uppercase tracking-widest text-lv-brick">
            Local Knowledge
          </p>
          <h2 className="mt-2 font-display text-[clamp(24px,3vw,36px)] font-bold text-lv-warm-black">
            From the Neighbourhood
          </h2>
        </SectionReveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {popularGuides.map((item, idx) => (
            <SectionReveal key={item.href} delay={idx * 0.06}>
              <Link
                href={item.href}
                className="group relative block overflow-hidden rounded-xl border border-lv-sand bg-lv-white p-5 transition-all hover:shadow-md"
              >
                {/* Brick-red left border slide-in */}
                <span
                  className="absolute inset-y-0 left-0 w-1 origin-top scale-y-0 bg-lv-brick transition-transform duration-300 group-hover:scale-y-100"
                  aria-hidden="true"
                />
                <h3 className="font-semibold text-lv-warm-black transition-colors group-hover:text-lv-brick">
                  {item.label}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-lv-warm-grey">
                  {item.desc}
                </p>
              </Link>
            </SectionReveal>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          6. DIRECTORY SEARCH STRIP
          ═══════════════════════════════════════════ */}
      <section className="border-y border-lv-sand bg-lv-cream">
        <div className="mx-auto max-w-7xl px-6 py-14 sm:px-10 lg:px-16">
          <SectionReveal className="text-center">
            <h2 className="font-display text-[clamp(24px,3vw,36px)] font-bold text-lv-warm-black">
              Find exactly what you need
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-base text-lv-warm-grey">
              Search 600+ local businesses, from restaurants and cafes to gyms and salons.
            </p>
            <div className="mt-8">
              <DirectorySearchStrip />
            </div>
          </SectionReveal>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          7. WHERE TO STAY
          ═══════════════════════════════════════════ */}
      {accommodations.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 py-16 sm:px-10 lg:px-16">
          <SectionReveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-lv-brick">
              Accommodation
            </p>
            <h2 className="mt-2 font-display text-[clamp(24px,3vw,36px)] font-bold text-lv-warm-black">
              Where to Stay
            </h2>
            <p className="mt-2 max-w-lg text-base text-lv-warm-grey">
              Visiting Liberty Village? Top-rated short-term rentals in the neighbourhood.
            </p>
          </SectionReveal>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {accommodations.map((rental, idx) => (
              <SectionReveal key={rental.slug} delay={idx * 0.1}>
                <Link
                  href={`/directory/${rental.slug}`}
                  className="group block overflow-hidden rounded-2xl border border-lv-sand bg-lv-white shadow-sm transition-all hover:shadow-lg"
                >
                  {rental.image && (
                    <div className="relative aspect-[4/3] overflow-hidden">
                      <Image
                        src={rental.image}
                        alt={rental.name}
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      />
                    </div>
                  )}
                  <div className="p-5">
                    <h3 className="text-lg font-semibold text-lv-warm-black group-hover:text-lv-brick transition-colors">
                      {rental.name}
                    </h3>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-lv-brick" aria-label={`${rental.rating} stars`}>
                        {"★".repeat(Math.floor(rental.rating))}
                      </span>
                      <span className="text-sm font-medium text-lv-warm-black">{rental.rating}</span>
                      <span className="text-sm text-lv-warm-grey">{rental.priceRange}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-lv-warm-grey line-clamp-2">
                      {rental.description}
                    </p>
                  </div>
                </Link>
              </SectionReveal>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-4">
            <Link
              href="/best/short-term-rentals"
              className="text-sm font-semibold text-lv-brick hover:text-lv-brick-dark transition-colors"
            >
              See all rentals &rarr;
            </Link>
            <Link
              href="/guide/where-to-stay"
              className="text-sm font-semibold text-lv-sage hover:text-lv-sage-dark transition-colors"
            >
              Read the stay guide &rarr;
            </Link>
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════
          8. BOTTOM CTA
          ═══════════════════════════════════════════ */}
      <section className="bg-lv-warm-black">
        <div className="mx-auto max-w-7xl px-6 py-20 text-center sm:px-10 sm:py-24 lg:px-16">
          <SectionReveal>
            <h2 className="font-display text-[clamp(28px,4vw,44px)] font-bold text-lv-cream">
              New to Liberty Village?
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-lv-sand">
              Moving to the neighbourhood? Our comprehensive guide covers everything
              from parking to the best brunch spots.
            </p>
            <Link
              href="/blog/moving-to-liberty-village-2026-essential-guide"
              className="mt-8 inline-flex items-center rounded-xl bg-lv-brick px-8 py-4 text-base font-semibold text-white shadow-lg transition-all hover:bg-lv-brick-dark hover:shadow-xl"
            >
              Read the Moving Guide
              <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </SectionReveal>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          9. JSON-LD SCHEMAS
          ═══════════════════════════════════════════ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateBreadcrumbSchema([
            { label: "Home", href: "/" },
          ])),
        }}
      />
      {/* WebSite schema is in layout.tsx — only Organization schema here */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateOrganizationSchema()),
        }}
      />
    </div>
  );
}
