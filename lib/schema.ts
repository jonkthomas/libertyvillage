import type { Business, FAQ } from "./types";

const SITE_URL = "https://libertyvillage.co";

export function generateLocalBusinessSchema(business: Business) {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    description: business.description,
    address: {
      "@type": "PostalAddress",
      streetAddress: business.address,
      addressLocality: "Toronto",
      addressRegion: "ON",
      addressCountry: "CA",
    },
    telephone: business.phone || undefined,
    url: business.website || undefined,
    priceRange: business.priceRange,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: business.rating,
      reviewCount: business.reviewCount,
    },
  };
}

export function generateFAQSchema(faqs: FAQ[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function generateItemListSchema(
  items: { name: string; url?: string }[],
  listName: string
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: item.url ? `${SITE_URL}${item.url}` : undefined,
    })),
  };
}

export function generateArticleSchema(
  title: string,
  description: string,
  datePublished: string
) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    datePublished,
    dateModified: datePublished,
    publisher: {
      "@type": "Organization",
      name: "LibertyVillage.co",
      url: SITE_URL,
    },
    author: {
      "@type": "Organization",
      name: "LibertyVillage.co",
    },
  };
}

export function generateBreadcrumbSchema(
  breadcrumbs: { label: string; href: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      item: `${SITE_URL}${crumb.href}`,
    })),
  };
}

export function generateWebsiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "LibertyVillage.co",
    url: SITE_URL,
    description:
      "Your complete guide to Liberty Village, Toronto. Find the best restaurants, services, and local businesses.",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/directory?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}
