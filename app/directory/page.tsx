import type { Metadata } from "next";
import { getAllBusinesses, getAllServices } from "@/lib/data";
import { generateItemListSchema } from "@/lib/schema";
import DirectoryFilter from "@/components/DirectoryFilter";

export const metadata: Metadata = {
  title: "Liberty Village Business Directory — Find Local Services | libertyvillage.co",
  description:
    "Browse the complete Liberty Village business directory. Search and filter restaurants, services, shops, and more in your neighborhood.",
  openGraph: {
    title: "Liberty Village Business Directory",
    description: "Browse the complete Liberty Village business directory.",
    type: "website",
    url: "https://libertyvillage.co/directory",
    siteName: "LibertyVillage.co",
    locale: "en_CA",
  },
  alternates: {
    canonical: "https://libertyvillage.co/directory",
    languages: { "en-CA": "https://libertyvillage.co/directory" },
  },
};

export default function DirectoryPage() {
  const businesses = getAllBusinesses();
  const services = getAllServices();

  const itemListSchema = generateItemListSchema(
    businesses.map((b) => ({ name: b.name, url: `/directory/${b.slug}` })),
    "Liberty Village Business Directory"
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Liberty Village Business Directory
      </h1>
      <p className="mt-2 text-warm-500">
        Find restaurants, services, and local businesses in your neighborhood.
      </p>

      <div className="mt-6">
        <DirectoryFilter businesses={businesses} categories={services} />
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
      />
    </div>
  );
}
