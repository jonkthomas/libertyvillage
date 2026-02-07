import type { Metadata } from "next";
import type { Service, Neighborhood, Business, Topic } from "./types";

const SITE_URL = "https://libertyvillage.co";
const SITE_NAME = "LibertyVillage.co";

function buildMeta(
  title: string,
  description: string,
  path: string
): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url,
      siteName: SITE_NAME,
      locale: "en_CA",
    },
    alternates: {
      canonical: url,
      languages: { "en-CA": url },
    },
  };
}

export function generateHomePageMeta(): Metadata {
  return buildMeta(
    "Liberty Village, Toronto — Your Neighborhood Guide | libertyvillage.co",
    "Your complete guide to Liberty Village, Toronto. Find the best restaurants, services, local businesses, and neighborhood tips from a neighbor.",
    "/"
  );
}

export function generateServicePageMeta(service: Service): Metadata {
  return buildMeta(
    `Best ${service.pluralName} in Liberty Village (2026) | libertyvillage.co`,
    `Find the best ${service.pluralName.toLowerCase()} in Liberty Village, Toronto. Ranked by locals with reviews, tips, and insider recommendations.`,
    `/best/${service.slug}`
  );
}

export function generateComparisonPageMeta(neighborhood: Neighborhood): Metadata {
  return buildMeta(
    `Liberty Village vs ${neighborhood.name}: Where to Live? | libertyvillage.co`,
    `Comparing Liberty Village and ${neighborhood.name} — rent, transit, nightlife, and community. Find out which Toronto neighborhood is right for you.`,
    `/vs/${neighborhood.slug}`
  );
}

export function generateBusinessPageMeta(business: Business): Metadata {
  return buildMeta(
    `${business.name} in Liberty Village | libertyvillage.co`,
    `${business.name} — ${business.description.slice(0, 120)}`,
    `/directory/${business.slug}`
  );
}

export function generateGuidePageMeta(topic: Topic): Metadata {
  return buildMeta(
    `${topic.title} — Liberty Village Guide | libertyvillage.co`,
    topic.description.slice(0, 155),
    `/guide/${topic.slug}`
  );
}
