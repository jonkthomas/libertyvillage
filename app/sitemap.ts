import type { MetadataRoute } from "next";
import { getAllServices, getAllNeighborhoods, getAllBusinesses, getAllTopics, getAllPosts, getAllBuildings } from "@/lib/data";

const BASE_URL = "https://libertyvillage.co";

export default function sitemap(): MetadataRoute.Sitemap {
  // Stable source-change dates from git at 84e2634. Change only with these pages.
  const staticDates: Record<string, string> = {
    "": "2026-08-10", directory: "2026-04-20", best: "2026-05-30",
    guide: "2026-03-30", vs: "2026-03-18", about: "2026-06-28",
    "world-cup": "2026-06-28", news: "2026-08-10", terms: "2026-03-18",
    privacy: "2026-08-06", blog: "2026-08-10", buildings: "2026-04-20",
  };
  // Legacy exports without a content date omit lastmod instead of inventing one.
  const modified = (record: object) => {
    const { updatedAt, publishedAt, lastUpdated } = record as { updatedAt?: string; publishedAt?: string; lastUpdated?: string };
    return updatedAt || lastUpdated || publishedAt || undefined;
  };

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: staticDates[""],
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/directory`,
      lastModified: staticDates["directory"],
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/best`,
      lastModified: staticDates["best"],
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/guide`,
      lastModified: staticDates["guide"],
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/vs`,
      lastModified: staticDates["vs"],
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: staticDates["about"],
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/world-cup`,
      lastModified: staticDates["world-cup"],
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/news`,
      lastModified: staticDates["news"],
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: staticDates["terms"],
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: staticDates["privacy"],
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const servicePages: MetadataRoute.Sitemap = getAllServices().map((s) => ({
    url: `${BASE_URL}/best/${s.slug}`,
    lastModified: modified(s),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const neighborhoodPages: MetadataRoute.Sitemap = getAllNeighborhoods().map((n) => ({
    url: `${BASE_URL}/vs/${n.slug}`,
    lastModified: modified(n),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  // Entity (business) pages carry brand-search demand (e.g. "edition dental reviews"),
  // so they are prioritized above generic listings to favor them over /best category pages.
  const businessPages: MetadataRoute.Sitemap = getAllBusinesses().map((b) => ({
    url: `${BASE_URL}/directory/${b.slug}`,
    lastModified: modified(b),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const guidePages: MetadataRoute.Sitemap = getAllTopics().map((t) => ({
    url: `${BASE_URL}/guide/${t.slug}`,
    lastModified: modified(t),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const blogPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/blog`,
      lastModified: staticDates["blog"],
      changeFrequency: "weekly" as const,
      priority: 0.8,
    },
    ...getAllPosts().map((p) => ({
      url: `${BASE_URL}/blog/${p.slug}`,
      lastModified: modified(p),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];

  const buildingPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/buildings`,
      lastModified: staticDates["buildings"],
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    ...getAllBuildings().map((b) => ({
      url: `${BASE_URL}/buildings/${b.slug}`,
      lastModified: modified(b),
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
