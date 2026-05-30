import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getAllServices } from "@/lib/data";
import { generateCollectionPageSchema, generateBreadcrumbSchema, generateSpeakableSchema } from "@/lib/schema";
import Breadcrumbs from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: "Best of Liberty Village 2026 — Local Guides to Every Service | libertyvillage.co",
  description: "The best restaurants, gyms, coffee shops, salons, dentists, and more in Liberty Village, Toronto — ranked by locals across 60+ categories.",
  openGraph: {
    title: "Best of Liberty Village 2026",
    description: "Locals' picks for the best restaurants, gyms, coffee shops, services, and more in Liberty Village, Toronto.",
    type: "website",
    url: "https://libertyvillage.co/best",
    siteName: "LibertyVillage.co",
    locale: "en_CA",
  },
  alternates: {
    canonical: "https://libertyvillage.co/best",
    languages: { "en-CA": "https://libertyvillage.co/best" },
  },
};

export default function BestIndexPage() {
  const services = [...getAllServices()].sort((a, b) =>
    a.pluralName.localeCompare(b.pluralName)
  );

  const collectionSchema = generateCollectionPageSchema(
    "Best of Liberty Village",
    "Locals' picks for the best businesses and services in Liberty Village, Toronto.",
    "/best",
    services.map((s) => ({ name: `Best ${s.pluralName}`, url: `/best/${s.slug}` }))
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumbs items={[
        { label: "Home", href: "/" },
        { label: "Best Of", href: "/best" },
      ]} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Best of Liberty Village
      </h1>
      <p className="mt-2 text-warm-500">
        Locals&apos; picks for the best businesses and services in Liberty Village, Toronto — ranked across {services.length} categories.
      </p>

      {services.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <Link
              key={service.slug}
              href={`/best/${service.slug}`}
              className="group overflow-hidden rounded-xl border border-warm-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {service.image && (
                <div className="relative aspect-video overflow-hidden">
                  <Image
                    src={service.image}
                    alt={`Best ${service.pluralName} in Liberty Village`}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                </div>
              )}
              <div className="p-5">
                <h2 className="font-semibold text-warm-900 group-hover:text-amber-600 transition-colors">
                  Best {service.pluralName}
                </h2>
                <p className="mt-1 text-sm text-warm-500 line-clamp-2">{service.description}</p>
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
            { label: "Best Of", href: "/best" },
          ])),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateSpeakableSchema("/best")),
        }}
      />
    </div>
  );
}
