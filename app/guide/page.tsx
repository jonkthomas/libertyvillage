import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getAllTopics } from "@/lib/data";
import { generateCollectionPageSchema, generateBreadcrumbSchema } from "@/lib/schema";
import Breadcrumbs from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: "Liberty Village Guides — Neighbourhood Tips & How-Tos | libertyvillage.co",
  description: "Practical guides for living in Liberty Village: parking, transit, moving, fitness, nightlife, remote work, and more. Written by locals for locals.",
  openGraph: {
    title: "Liberty Village Guides",
    description: "Practical neighbourhood guides for Liberty Village, Toronto.",
    type: "website",
    url: "https://libertyvillage.co/guide",
    siteName: "LibertyVillage.co",
    locale: "en_CA",
  },
  alternates: {
    canonical: "https://libertyvillage.co/guide",
    languages: { "en-CA": "https://libertyvillage.co/guide" },
  },
};

const categoryLabels: Record<string, string> = {
  living: "Living",
  food: "Food & Drink",
  lifestyle: "Lifestyle",
  community: "Community",
  transit: "Getting Around",
};

export default function GuideIndexPage() {
  const topics = getAllTopics();
  const categories = [...new Set(topics.map((t) => t.category))];

  const collectionSchema = generateCollectionPageSchema(
    "Liberty Village Guides",
    "Practical neighbourhood guides for Liberty Village, Toronto.",
    "/guide",
    topics.map((t) => ({ name: t.title, url: `/guide/${t.slug}` }))
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumbs items={[
        { label: "Home", href: "/" },
        { label: "Guides", href: "/guide" },
      ]} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Liberty Village Guides
      </h1>
      <p className="mt-2 text-warm-500">
        Practical tips and how-tos for living, eating, and getting around Liberty Village.
      </p>

      {categories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {categories.map((cat) => (
            <span key={cat} className="rounded-full border border-warm-200 bg-white px-4 py-2 text-sm text-warm-700">
              {categoryLabels[cat] || cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
          ))}
        </div>
      )}

      {topics.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((topic) => (
            <Link
              key={topic.slug}
              href={`/guide/${topic.slug}`}
              className="group overflow-hidden rounded-xl border border-warm-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {topic.image && (
                <div className="relative aspect-video overflow-hidden">
                  <Image
                    src={topic.image}
                    alt={topic.title}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                </div>
              )}
              <div className="p-5">
                <div className="text-xs text-warm-400">
                  {categoryLabels[topic.category] || topic.category.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </div>
                <h2 className="mt-2 font-semibold text-warm-900 group-hover:text-amber-600 transition-colors">
                  {topic.title}
                </h2>
                <p className="mt-1 text-sm text-warm-500 line-clamp-2">{topic.description}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-12 text-center text-warm-400">No guides yet. Check back soon.</p>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateBreadcrumbSchema([
            { label: "Home", href: "/" },
            { label: "Guides", href: "/guide" },
          ])),
        }}
      />
    </div>
  );
}
