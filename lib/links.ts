import {
  getAllServices,
  getServiceBySlug,
  getAllBusinesses,
  getAllTopics,
  getTopicBySlug,
  getAllNeighborhoods,
  getAllPosts,
  getPostBySlug,
} from "./data";
import type { BlogPost } from "./types";

export interface LinkItem {
  title: string;
  href: string;
  description: string;
}

export function getRelatedServices(currentSlug: string): LinkItem[] {
  const service = getServiceBySlug(currentSlug);
  if (!service) return [];

  const all = getAllServices();
  return service.relatedServices
    .map((slug) => all.find((s) => s.slug === slug))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .slice(0, 5)
    .map((s) => ({
      title: `Best ${s.pluralName} in Liberty Village`,
      href: `/best/${s.slug}`,
      description: s.description,
    }));
}

export function getRelatedBusinesses(
  currentSlug: string,
  category: string
): LinkItem[] {
  const businesses = getAllBusinesses()
    .filter((b) => b.category === category && b.slug !== currentSlug)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 5);

  return businesses.map((b) => ({
    title: b.name,
    href: `/directory/${b.slug}`,
    description: b.description.slice(0, 120),
  }));
}

export function getRelatedGuides(currentSlug: string): LinkItem[] {
  const topic = getTopicBySlug(currentSlug);
  if (!topic) return [];

  const all = getAllTopics();
  return topic.relatedTopics
    .map((slug) => all.find((t) => t.slug === slug))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .slice(0, 5)
    .map((t) => ({
      title: t.title,
      href: `/guide/${t.slug}`,
      description: t.description,
    }));
}

export function getNearbyNeighborhoods(currentSlug: string): LinkItem[] {
  return getAllNeighborhoods()
    .filter((n) => n.slug !== currentSlug)
    .sort((a, b) => a.distanceFromLV - b.distanceFromLV)
    .slice(0, 5)
    .map((n) => ({
      title: `Liberty Village vs ${n.name}`,
      href: `/vs/${n.slug}`,
      description: n.keyDifference,
    }));
}

export function getRelatedPosts(currentSlug: string): LinkItem[] {
  const post = getPostBySlug(currentSlug);
  if (!post) return [];

  const all = getAllPosts();
  return post.relatedPosts
    .map((slug) => all.find((p) => p.slug === slug))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .slice(0, 5)
    .map((p) => ({
      title: p.title,
      href: `/blog/${p.slug}`,
      description: p.description,
    }));
}

export function getRelatedGuidesForPost(topicSlugs: string[]): LinkItem[] {
  const all = getAllTopics();
  return topicSlugs
    .map((slug) => all.find((t) => t.slug === slug))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({
      title: t.title,
      href: `/guide/${t.slug}`,
      description: t.description,
    }));
}

export function getRelatedServicesForPost(serviceSlugs: string[]): LinkItem[] {
  const all = getAllServices();
  return serviceSlugs
    .map((slug) => all.find((s) => s.slug === slug))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .map((s) => ({
      title: `Best ${s.pluralName} in Liberty Village`,
      href: `/best/${s.slug}`,
      description: s.description,
    }));
}

export function getRelatedPostsForService(serviceSlug: string): LinkItem[] {
  return getAllPosts()
    .filter((p) => p.relatedServices?.includes(serviceSlug))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 3)
    .map((p) => ({
      title: p.title,
      href: `/blog/${p.slug}`,
      description: p.description,
    }));
}

export function getRelatedPostsForTopic(topicSlug: string): LinkItem[] {
  return getAllPosts()
    .filter((p) => p.relatedTopics?.includes(topicSlug))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 3)
    .map((p) => ({
      title: p.title,
      href: `/blog/${p.slug}`,
      description: p.description,
    }));
}

export function resolveCrossLinks(crossLinks?: BlogPost["crossLinks"]): LinkItem[] {
  if (!crossLinks) return [];

  return crossLinks
    .map((link) => {
      if (link.type === "service") {
        const service = getServiceBySlug(link.slug);
        if (!service) return null;
        return {
          title: link.label || `Best ${service.pluralName} in Liberty Village`,
          href: `/best/${service.slug}`,
          description: service.description,
        };
      }
      if (link.type === "guide") {
        const topic = getTopicBySlug(link.slug);
        if (!topic) return null;
        return {
          title: link.label || topic.title,
          href: `/guide/${topic.slug}`,
          description: topic.description,
        };
      }
      return null;
    })
    .filter((item): item is LinkItem => item !== null);
}

type PageType = "service" | "neighborhood" | "business" | "guide" | "blog" | "terms" | "privacy";

export function getBreadcrumbs(
  pageType: PageType,
  label: string
): { label: string; href: string }[] {
  const home = { label: "Home", href: "/" };

  switch (pageType) {
    case "service":
      return [home, { label: "Directory", href: "/directory" }, { label, href: "#" }];
    case "neighborhood":
      return [home, { label: "Compare Neighbourhoods", href: "/vs" }, { label, href: "#" }];
    case "business":
      return [home, { label: "Directory", href: "/directory" }, { label, href: "#" }];
    case "guide":
      return [home, { label: "Guides", href: "/guide" }, { label, href: "#" }];
    case "blog":
      return [home, { label: "Blog", href: "/blog" }, { label, href: "#" }];
    case "terms":
      return [home, { label, href: "#" }];
    case "privacy":
      return [home, { label, href: "#" }];
  }
}
