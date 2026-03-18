import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getAllNeighborhoods } from "@/lib/data";
import { generateCollectionPageSchema, generateBreadcrumbSchema } from "@/lib/schema";
import Breadcrumbs from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: "Liberty Village vs Toronto Neighbourhoods: Compare Where to Live | libertyvillage.co",
  description:
    "Side-by-side comparisons of Liberty Village against Toronto neighbourhoods like King West, Queen West, Parkdale, and more. Compare rent, transit scores, walkability, and lifestyle to find your best fit.",
  openGraph: {
    title: "Liberty Village vs Toronto Neighbourhoods",
    description:
      "Compare Liberty Village to other Toronto neighbourhoods — rent, transit, walkability, and lifestyle side by side.",
    type: "website",
    url: "https://libertyvillage.co/vs",
    siteName: "LibertyVillage.co",
    locale: "en_CA",
  },
  alternates: {
    canonical: "https://libertyvillage.co/vs",
    languages: { "en-CA": "https://libertyvillage.co/vs" },
  },
};

const breadcrumbs = [
  { label: "Home", href: "/" },
  { label: "Compare Neighbourhoods", href: "/vs" },
];

export default function CompareIndexPage() {
  const neighbourhoods = getAllNeighborhoods();

  const collectionSchema = generateCollectionPageSchema(
    "Liberty Village Neighbourhood Comparisons",
    "Side-by-side comparisons of Liberty Village against other Toronto neighbourhoods.",
    "/vs",
    neighbourhoods.map((n) => ({
      name: `Liberty Village vs ${n.name}`,
      url: `/vs/${n.slug}`,
    }))
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Compare Liberty Village to Other Toronto Neighbourhoods
      </h1>
      <p className="mt-2 text-warm-500">
        Thinking about moving to Liberty Village — or wondering how it stacks up
        against the neighbourhood you're in now? Browse our side-by-side
        comparisons covering rent, transit, walkability, lifestyle, and more.
      </p>

      {neighbourhoods.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {neighbourhoods.map((n) => (
            <Link
              key={n.slug}
              href={`/vs/${n.slug}`}
              className="group overflow-hidden rounded-xl border border-warm-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {n.image && (
                <div className="relative aspect-video overflow-hidden">
                  <Image
                    src={n.image}
                    alt={`${n.name} neighbourhood, Toronto`}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                </div>
              )}
              <div className="p-5">
                <h2 className="font-semibold text-warm-900 group-hover:text-amber-600 transition-colors">
                  Liberty Village vs {n.name}
                </h2>
                <div className="mt-3 flex items-center gap-4 text-sm text-warm-500">
                  <span>
                    1BR from{" "}
                    <span className="font-medium text-warm-700">
                      ${n.avgRent1BR.toLocaleString()}
                    </span>
                  </span>
                  <span className="text-warm-300">|</span>
                  <span>
                    Transit{" "}
                    <span className="font-medium text-warm-700">
                      {n.transitScore}/100
                    </span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-12 text-center text-warm-400">
          No comparisons yet. Check back soon.
        </p>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateBreadcrumbSchema(breadcrumbs)),
        }}
      />
    </div>
  );
}
