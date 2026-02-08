import { readFileSync } from "fs";
import { join } from "path";
import type { BlogPost, Business, Service, Neighborhood, Topic } from "./types";

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
