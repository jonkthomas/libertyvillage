import {
  getAllServices,
  getServiceBySlug,
  getAllBusinesses,
  getAllTopics,
  getTopicBySlug,
  getAllNeighborhoods,
} from "./data";

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

type PageType = "service" | "neighborhood" | "business" | "guide";

export function getBreadcrumbs(
  pageType: PageType,
  label: string
): { label: string; href: string }[] {
  const home = { label: "Home", href: "/" };

  switch (pageType) {
    case "service":
      return [home, { label: "Best Services", href: "/best/restaurants" }, { label, href: "#" }];
    case "neighborhood":
      return [home, { label: "Compare Neighborhoods", href: "/vs/king-west" }, { label, href: "#" }];
    case "business":
      return [home, { label: "Directory", href: "/directory" }, { label, href: "#" }];
    case "guide":
      return [home, { label: "Guides", href: "/guide/parking-guide" }, { label, href: "#" }];
  }
}
