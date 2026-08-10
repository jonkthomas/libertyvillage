import type { MetadataRoute } from "next";
import { getAllServices, getAllNeighborhoods, getAllBusinesses, getAllTopics, getAllPosts, getAllBuildings } from "@/lib/data";

const BASE_URL = "https://libertyvillage.co";

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
    {
      url: `${BASE_URL}/best`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/guide`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/vs`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/world-cup`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/news`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
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

  // Entity (business) pages carry brand-search demand (e.g. "edition dental reviews"),
  // so they are prioritized above generic listings to favor them over /best category pages.
  const businessPages: MetadataRoute.Sitemap = getAllBusinesses().map((b) => ({
    url: `${BASE_URL}/directory/${b.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const guidePages: MetadataRoute.Sitemap = getAllTopics().map((t) => ({
    url: `${BASE_URL}/guide/${t.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const blogPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/blog`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    },
    ...getAllPosts().map((p) => ({
      url: `${BASE_URL}/blog/${p.slug}`,
      lastModified: p.updatedAt || p.publishedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];

  const buildingPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/buildings`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    ...getAllBuildings().map((b) => ({
      url: `${BASE_URL}/buildings/${b.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];

  return [
    ...staticPages,
    ...servicePages,
    ...neighborhoodPages,
    ...businessPages,
    ...guidePages,
    ...blogPages,
    ...buildingPages,
  ];
}
