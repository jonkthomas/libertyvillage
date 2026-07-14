import type { Metadata } from "next";
import type { Building, Service, Neighborhood, Business, Topic, BlogPost } from "./types";

const SITE_URL = "https://libertyvillage.co";
const SITE_NAME = "LibertyVillage.co";

function buildMeta(
  title: string,
  description: string,
  path: string,
  ogImage?: string
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
      ...(ogImage ? { images: [{ url: `${SITE_URL}${ogImage}`, width: 1200, height: 630 }] } : {}),
    },
    alternates: {
      canonical: url,
      languages: { "en-CA": url },
    },
  };
}

export function generateHomePageMeta(): Metadata {
  return buildMeta(
    "Liberty Village, Toronto — Insider Guide by Residents (2026)",
    "The insider's guide to Liberty Village, Toronto — 200+ restaurants, bars, gyms, parking tips & condo reviews. Written by residents, updated for 2026.",
    "/",
    "/images/og/og-home.jpg"
  );
}

export function generateServicePageMeta(service: Service): Metadata {
  const suffix = " | libertyvillage.co";
  const base = `Best ${service.pluralName} in Liberty Village Toronto (2026)`;
  const title = base.length + suffix.length <= 60 ? `${base}${suffix}` : base;
  return buildMeta(
    title,
    service.description.slice(0, 155),
    `/best/${service.slug}`,
    "/images/og/og-service.jpg"
  );
}

export function generateComparisonPageMeta(neighborhood: Neighborhood): Metadata {
  return buildMeta(
    `Liberty Village vs ${neighborhood.name}: Where to Live? | libertyvillage.co`,
    `Comparing Liberty Village and ${neighborhood.name} — rent, transit, nightlife, and community. Find out which Toronto neighbourhood is right for you.`,
    `/vs/${neighborhood.slug}`,
    "/images/og/og-comparison.jpg"
  );
}

export function generateBusinessPageMeta(business: Business): Metadata {
  const descParts = [business.name];
  if (business.rating) descParts.push(`${business.rating}★ (${business.reviewCount} reviews)`);
  if (business.hours) descParts.push(business.hours);
  if (business.address) descParts.push(business.address);
  const richDesc = descParts.join(" · ").slice(0, 155);

  // Keep the <title> <= 60 chars. The full suffix is long, so step down to a
  // shorter suffix for longer names, then truncate the name itself only as a
  // last resort so the tag never overflows in SERPs.
  const fullTitle = `${business.name} — Reviews, Hours & Location | libertyvillage.co`;
  const shortSuffix = " — Liberty Village";
  let title: string;
  if (fullTitle.length <= 60) {
    title = fullTitle;
  } else if (business.name.length + shortSuffix.length <= 60) {
    title = `${business.name}${shortSuffix}`;
  } else {
    const maxName = 60 - shortSuffix.length - 1; // room for the ellipsis
    title = `${business.name.slice(0, maxName).trimEnd()}…${shortSuffix}`;
  }

  return buildMeta(
    title,
    richDesc,
    `/directory/${business.slug}`,
    business.image || "/images/og/og-directory.jpg"
  );
}

export function generateGuidePageMeta(topic: Topic): Metadata {
  const titleHasLV = topic.title.toLowerCase().includes("liberty village");
  const suffix = " | libertyvillage.co";
  const base = titleHasLV ? topic.title : `${topic.title} — Liberty Village`;
  const title = base.length + suffix.length <= 60 ? `${base}${suffix}` : base;
  return buildMeta(
    title,
    topic.description.slice(0, 155),
    `/guide/${topic.slug}`,
    "/images/og/og-guide.jpg"
  );
}

export function generateBlogPostPageMeta(post: BlogPost): Metadata {
  const suffix = " | libertyvillage.co";
  const title = post.title.length + suffix.length <= 60
    ? `${post.title}${suffix}`
    : post.title;
  const meta = buildMeta(
    title,
    post.description.slice(0, 155),
    `/blog/${post.slug}`,
    post.image
  );
  if (post.canonicalUrl) {
    meta.alternates = {
      ...meta.alternates,
      canonical: post.canonicalUrl,
    };
  }
  return meta;
}

export function generateBlogIndexPageMeta(): Metadata {
  return buildMeta(
    "Liberty Village Blog — Local News & Updates | libertyvillage.co",
    "Stay updated on Liberty Village with local news, development updates, restaurant openings, transit changes, and community stories.",
    "/blog"
  );
}

export function generateTermsPageMeta(): Metadata {
  return buildMeta(
    "Terms of Service | libertyvillage.co",
    "Terms of Service for libertyvillage.co, a local directory and neighbourhood guide for Liberty Village, Toronto, Canada.",
    "/terms"
  );
}

export function generatePrivacyPageMeta(): Metadata {
  return buildMeta(
    "Privacy Policy | libertyvillage.co",
    "Privacy Policy for libertyvillage.co. Learn how we handle your data, our use of Google Analytics, and your privacy rights under Canadian law.",
    "/privacy"
  );
}

export function generateBuildingPageMeta(building: Building): Metadata {
  const autoTitle = `${building.name} — Liberty Village Condos, Reviews & Rent 2026`;
  const title = building.metaTitle
    ? building.metaTitle.slice(0, 60)
    : autoTitle.length <= 60
    ? autoTitle
    : autoTitle.slice(0, 60);

  const autoDesc = building.metaDescription
    ? building.metaDescription
    : `${building.name} at ${building.address}. ${building.buildingType} building, ${building.units} units, built ${building.yearBuilt}. 1BR from $${building.avgRent1BR.toLocaleString()}/mo. Reviews, amenities & rent guide.`;
  const description = autoDesc.slice(0, 155);

  return buildMeta(title, description, `/buildings/${building.slug}`, "/images/og/og-buildings.jpg");
}

export function generateBuildingsHubMeta(): Metadata {
  return buildMeta(
    "Liberty Village Condo Buildings & Lofts — Complete Guide 2026",
    "Every Liberty Village condo and loft building profiled: rents, amenities, reviews, and walk scores. 20+ buildings from Toy Factory Lofts to Reina.",
    "/buildings",
    "/images/og/og-buildings.jpg"
  );
}
