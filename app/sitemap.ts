import type { MetadataRoute } from "next";
import { getAllServices, getAllNeighborhoods, getAllBusinesses, getAllTopics } from "@/lib/data";

const BASE_URL = "https://libertyvillage.so";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date().toISOString();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/directory`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];

  const servicePages: MetadataRoute.Sitemap = getAllServices().map((s) => ({
    url: `${BASE_URL}/best/${s.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const neighborhoodPages: MetadataRoute.Sitemap = getAllNeighborhoods().map((n) => ({
    url: `${BASE_URL}/vs/${n.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const businessPages: MetadataRoute.Sitemap = getAllBusinesses().map((b) => ({
    url: `${BASE_URL}/directory/${b.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const guidePages: MetadataRoute.Sitemap = getAllTopics().map((t) => ({
    url: `${BASE_URL}/guide/${t.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [
    ...staticPages,
    ...servicePages,
    ...neighborhoodPages,
    ...businessPages,
    ...guidePages,
  ];
}
