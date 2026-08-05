import type { Building, Business, FAQ } from "./types";

const SITE_URL = "https://libertyvillage.co";
// Collective byline used on /about. Used as the fallback author when a piece of
// content has no explicit author of its own.
const SITE_AUTHOR = "LibertyVillage.co Editorial";

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
    ...(business.priceRange ? { priceRange: business.priceRange } : {}),
    ...(business.image ? { image: `${SITE_URL}${business.image}` } : {}),
    // Only emit aggregateRating when we actually have real aggregate review
    // data (a rating value AND a non-zero review count). The dataset holds no
    // individual review records, so we cannot emit standalone Review objects;
    // emitting aggregateRating with a 0/undefined value would be an unsupported,
    // potentially spam-flagged rich result, so we gate it off instead. The
    // LocalBusiness node is itself the item being reviewed (itemReviewed).
    ...(business.rating && business.reviewCount
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: business.rating,
            reviewCount: business.reviewCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
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
  datePublished: string,
  author: string = SITE_AUTHOR
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
      "@type": "Person",
      name: author,
    },
  };
}

export function generateBreadcrumbSchema(
  breadcrumbs: { label: string; href?: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((crumb, index) => {
      const isLast = index === breadcrumbs.length - 1;
      const entry: Record<string, unknown> = {
        "@type": "ListItem",
        position: index + 1,
        name: crumb.label,
      };
      // The final crumb is the current page itself. Per Google's guidance,
      // omit `item` on it rather than pointing at a placeholder ("#") URL,
      // which would resolve to "https://libertyvillage.co#".
      if (!isLast && crumb.href && crumb.href !== "#") {
        entry.item = `${SITE_URL}${crumb.href}`;
      }
      return entry;
    }),
  };
}

export function generateCollectionPageSchema(
  name: string,
  description: string,
  url: string,
  items: { name: string; url?: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: `${SITE_URL}${url}`,
    mainEntity: {
      "@type": "ItemList",
      name,
      itemListElement: items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: item.url ? `${SITE_URL}${item.url}` : undefined,
      })),
    },
  };
}

export function generateDefinedTermSetSchema(
  definitions: { term: string; definition: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    hasDefinedTerm: definitions.map((d) => ({
      "@type": "DefinedTerm",
      name: d.term,
      description: d.definition,
    })),
  };
}

export function generateSpeakableSchema(url: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: `${SITE_URL}${url}`,
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: [".answer-block", "h1", ".key-takeaways", ".pro-tips"],
    },
  };
}

export function generateBlogPostSchema(
  post: { title: string; description: string; publishedAt: string; updatedAt: string; slug: string; image?: string; author?: string }
) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    url: `${SITE_URL}/blog/${post.slug}`,
    ...(post.image ? { image: `${SITE_URL}${post.image}` } : {}),
    publisher: {
      "@type": "Organization",
      name: "LibertyVillage.co",
      url: SITE_URL,
    },
    author: {
      "@type": "Person",
      name: post.author || SITE_AUTHOR,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${post.slug}`,
    },
  };
}

export function generateOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "LibertyVillage.co",
    alternateName: "Liberty Village Toronto Guide",
    url: SITE_URL,
    logo: `${SITE_URL}/apple-touch-icon.png`,
    description:
      "The definitive neighbourhood guide to Liberty Village, Toronto. Local restaurant reviews, service directories, transit guides, real estate data, and community news.",
    foundingDate: "2024",
    areaServed: {
      "@type": "Place",
      name: "Liberty Village, Toronto, Ontario, Canada",
      geo: {
        "@type": "GeoCoordinates",
        latitude: 43.6384,
        longitude: -79.4200,
      },
    },
    knowsAbout: [
      "Liberty Village Toronto",
      "Toronto neighbourhood guides",
      "Liberty Village restaurants",
      "Liberty Village real estate",
      "Liberty Village transit",
      "FIFA World Cup 2026 Toronto",
      "BMO Field",
    ],
  };
}

export function generateApartmentComplexSchema(building: Building) {
  return {
    "@context": "https://schema.org",
    "@type": "ApartmentComplex",
    name: building.name,
    description: building.description,
    address: {
      "@type": "PostalAddress",
      streetAddress: building.address.split(",")[0].trim(),
      addressLocality: "Toronto",
      addressRegion: "ON",
      postalCode: building.postalCode,
      addressCountry: "CA",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: building.latitude,
      longitude: building.longitude,
    },
    amenityFeature: building.amenities.map((amenity) => ({
      "@type": "LocationFeatureSpecification",
      name: amenity,
      value: true,
    })),
    priceRange: `From $${building.avgRent1BR.toLocaleString()}/month`,
    numberOfRooms: building.units,
    url: `${SITE_URL}/buildings/${building.slug}`,
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
