import type { Metadata } from "next";
import type { Service, Neighborhood, Business, Topic, BlogPost } from "./types";

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
    "Liberty Village, Toronto — Your Neighborhood Guide | libertyvillage.co",
    "Liberty Village is a walkable Toronto neighborhood of 9,000+ residents with 600+ businesses, known for converted industrial lofts, dog-friendly culture, and a thriving food scene along King Street West.",
    "/",
    "/images/og/og-home.jpg"
  );
}

export function generateServicePageMeta(service: Service): Metadata {
  return buildMeta(
    `Best ${service.pluralName} in Liberty Village (2026) | libertyvillage.co`,
    service.description.slice(0, 155),
    `/best/${service.slug}`,
    "/images/og/og-service.jpg"
  );
}

export function generateComparisonPageMeta(neighborhood: Neighborhood): Metadata {
  return buildMeta(
    `Liberty Village vs ${neighborhood.name}: Where to Live? | libertyvillage.co`,
    `Comparing Liberty Village and ${neighborhood.name} — rent, transit, nightlife, and community. Find out which Toronto neighborhood is right for you.`,
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

  return buildMeta(
    `${business.name} — Reviews, Hours & Location | Liberty Village | libertyvillage.co`,
    richDesc,
    `/directory/${business.slug}`,
    business.image || "/images/og/og-directory.jpg"
  );
}

export function generateGuidePageMeta(topic: Topic): Metadata {
  return buildMeta(
    `${topic.title} — Liberty Village Guide | libertyvillage.co`,
    topic.description.slice(0, 155),
    `/guide/${topic.slug}`,
    "/images/og/og-guide.jpg"
  );
}

export function generateBlogPostPageMeta(post: BlogPost): Metadata {
  return buildMeta(
    `${post.title} — Liberty Village Blog | libertyvillage.co`,
    post.description.slice(0, 155),
    `/blog/${post.slug}`,
    post.image
  );
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
    "Terms of Service for libertyvillage.co, a local directory and neighborhood guide for Liberty Village, Toronto, Canada.",
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
