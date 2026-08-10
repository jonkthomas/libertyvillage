import { readFileSync } from "fs";
import { join } from "path";
import type { BlogPost, Building, Business, Service, Neighborhood, Topic, GuideHub } from "./types";

const dataDir = join(process.cwd(), "data");

function loadJSON<T>(filename: string): T {
  const raw = readFileSync(join(dataDir, filename), "utf-8");
  return JSON.parse(raw) as T;
}

// Services
export function getAllServices(): Service[] {
  return loadJSON<Service[]>("services.json");
}

export function getServiceBySlug(slug: string): Service | undefined {
  return getAllServices().find((s) => s.slug === slug);
}

// Topics
export function getAllTopics(): Topic[] {
  return loadJSON<Topic[]>("topics.json");
}

export function getTopicBySlug(slug: string): Topic | undefined {
  return getAllTopics().find((t) => t.slug === slug);
}

export function getTopicsByCategory(category: string): Topic[] {
  return getAllTopics().filter((t) => t.category === category);
}

// Neighborhoods
export function getAllNeighborhoods(): Neighborhood[] {
  return loadJSON<Neighborhood[]>("neighborhoods.json");
}

export function getNeighborhoodBySlug(slug: string): Neighborhood | undefined {
  return getAllNeighborhoods().find((n) => n.slug === slug);
}

// Businesses
export function getAllBusinesses(): Business[] {
  return loadJSON<Business[]>("businesses.json");
}

export function getBusinessBySlug(slug: string): Business | undefined {
  return getAllBusinesses().find((b) => b.slug === slug);
}

export function getBusinessesByCategory(category: string): Business[] {
  return getAllBusinesses()
    .filter((b) => b.category === category || (b.categories && b.categories.includes(category)))
    .sort((a, b) => b.rating - a.rating);
}

export function getFeaturedBusinesses(): Business[] {
  return getAllBusinesses()
    .filter((b) => b.featured)
    .sort((a, b) => b.rating - a.rating);
}

// Blog Posts
export function getAllPosts(): BlogPost[] {
  return loadJSON<BlogPost[]>("posts.json");
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return getAllPosts().find((p) => p.slug === slug);
}

export function getPostsByCategory(category: string): BlogPost[] {
  return getAllPosts()
    .filter((p) => p.category === category)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function getRecentPosts(limit: number = 10): BlogPost[] {
  return getAllPosts()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}

/** Pure selector — newest news-category posts first. */
export function selectNewsPosts(posts: BlogPost[], limit: number = 10): BlogPost[] {
  const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
  return posts
    .filter((p) => p.category === "news")
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, n);
}

export function getNewsPosts(limit: number = 10): BlogPost[] {
  return selectNewsPosts(getAllPosts(), limit);
}

// Comparison Table
export function buildComparisonTable(serviceSlug: string): { columns: string[]; rows: Array<Record<string, string>> } {
  const service = getServiceBySlug(serviceSlug);
  if (service?.comparisonTable) {
    return service.comparisonTable;
  }

  const businesses = getBusinessesByCategory(serviceSlug);
  const columns = ["Name", "Rating", "Price Range", "Hours"];
  const rows = businesses.map((b) => ({
    Name: b.name,
    Rating: `${b.rating}/5`,
    "Price Range": b.priceRange ?? "Not listed",
    Hours: b.hours,
  }));

  return { columns, rows };
}

// Buildings
export function getAllBuildings(): Building[] {
  return loadJSON<Building[]>("buildings.json");
}

export function getBuildingBySlug(slug: string): Building | undefined {
  return getAllBuildings().find((b) => b.slug === slug);
}

export function getBuildingsByType(type: string): Building[] {
  return getAllBuildings().filter((b) => b.buildingType === type);
}

// Guide Hub
export function getGuideHubData(): GuideHub {
  try {
    return loadJSON<GuideHub>("guide-hub.json");
  } catch {
    return {
      population: "~7,500",
      medianRent: "$2,608/month",
      walkScore: 88,
      transitScore: 96,
      boundaries: "King St W, Dufferin St, GO rail corridor, Strachan Ave",
      history: "",
      prosCons: { pros: [], cons: [] },
      quickFacts: [],
      answerSummary: "",
    };
  }
}
