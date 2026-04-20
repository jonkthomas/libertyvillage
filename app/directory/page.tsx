import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { getAllBusinesses, getAllServices, getBusinessesByCategory } from "@/lib/data";
import {
  generateItemListSchema,
  generateBreadcrumbSchema,
  generateCollectionPageSchema,
} from "@/lib/schema";
import Breadcrumbs from "@/components/Breadcrumbs";
import BusinessCard from "@/components/BusinessCard";
import CategoryCard from "@/components/CategoryCard";
import DirectoryFilter from "@/components/DirectoryFilter";

const SITE_URL = "https://libertyvillage.co";

export const metadata: Metadata = {
  title: "Liberty Village Business Directory — 200+ Local Shops & Services",
  description:
    "Browse 200+ Liberty Village shops, restaurants, services, and local businesses. Ranked by rating, filterable by category, and searchable by name or tag.",
  openGraph: {
    title: "Liberty Village Business Directory — Browse All",
    description: "Browse and search the complete Liberty Village business directory.",
    type: "website",
    url: `${SITE_URL}/directory`,
    siteName: "LibertyVillage.co",
    locale: "en_CA",
  },
  alternates: {
    canonical: `${SITE_URL}/directory`,
    languages: { "en-CA": `${SITE_URL}/directory` },
  },
};

/* Category icons reused from homepage pattern */
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

export default function DirectoryPage() {
  const businesses = getAllBusinesses();
  const services = getAllServices();

  // Top-rated businesses for featured section
  const featuredBusinesses = [...businesses]
    .sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount)
    .slice(0, 6);

  // Category tiles with real counts
  const categoriesWithCounts = topCategoryOrder
    .map((slug) => {
      const service = services.find((s) => s.slug === slug);
      if (!service) return null;
      const count = getBusinessesByCategory(slug).length;
      return { slug, name: service.pluralName, count };
    })
    .filter(Boolean) as { slug: string; name: string; count: number }[];

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Business Directory", href: "/directory" },
  ];

  const itemListSchema = generateItemListSchema(
    businesses.map((b) => ({ name: b.name, url: `/directory/${b.slug}` })),
    "Liberty Village Business Directory"
  );
  const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbs);
  const collectionPageSchema = generateCollectionPageSchema(
    "Liberty Village Business Directory",
    "200+ local shops, restaurants, services, and businesses in Liberty Village, Toronto, ranked by rating.",
    "/directory",
    businesses.map((b) => ({ name: b.name, url: `/directory/${b.slug}` }))
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Liberty Village Business Directory
      </h1>
      <p className="mt-2 max-w-2xl text-warm-500">
        {businesses.length}+ local shops, restaurants, services, and businesses in
        Liberty Village, Toronto &mdash; ranked by rating, filterable by category,
        and searchable by name, description, or tag.
      </p>

      {/* Category tiles — server-rendered, visible to crawlers */}
      <section aria-labelledby="directory-categories" className="mt-8">
        <h2 id="directory-categories" className="text-lg font-semibold text-warm-800">
          Browse by category
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
        <div className="mt-3">
          <Link
            href="/best"
            className="text-sm font-semibold text-amber-600 hover:text-amber-700"
          >
            See all service categories &rarr;
          </Link>
        </div>
      </section>

      {/* Featured businesses — server-rendered top 6 */}
      <section aria-labelledby="directory-featured" className="mt-12">
        <h2 id="directory-featured" className="text-lg font-semibold text-warm-800">
          Top-rated this week
        </h2>
        <p className="mt-1 text-sm text-warm-500">
          The six highest-rated businesses across every Liberty Village category.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {featuredBusinesses.map((business) => (
            <BusinessCard key={business.slug} business={business} />
          ))}
        </div>
      </section>

      {/* Searchable filter — hydrates client-side; server fallback shows remaining businesses */}
      <section aria-labelledby="directory-search" className="mt-12">
        <h2 id="directory-search" className="text-lg font-semibold text-warm-800">
          Search all {businesses.length} businesses
        </h2>
        <p className="mt-1 text-sm text-warm-500">
          Filter by category or search by name, tag, or keyword.
        </p>
        <div className="mt-4">
          <Suspense
            fallback={
              <div className="grid gap-4 sm:grid-cols-2">
                {businesses.slice(0, 20).map((business) => (
                  <BusinessCard key={business.slug} business={business} />
                ))}
                <p className="col-span-full text-center text-sm text-warm-400">
                  Loading search…
                </p>
              </div>
            }
          >
            <DirectoryFilter businesses={businesses} categories={services} />
          </Suspense>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionPageSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
    </div>
  );
}
