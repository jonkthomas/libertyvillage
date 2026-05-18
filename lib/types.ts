export interface FAQ {
  question: string;
  answer: string;
}

export interface Service {
  slug: string;
  name: string;
  pluralName: string;
  description: string;
  icon: string;
  relatedServices: string[];
  searchVolume: "high" | "medium" | "low";
  competitiveness: "easy" | "medium" | "hard";
  image?: string;
  answerBlock?: string;
  definition?: string;
  specificFaqs?: FAQ[];
  comparisonTable?: { columns: string[]; rows: Array<Record<string, string>> };
  keyTakeaways?: string[];
  proTips?: string[];
  neighbourhoodContext?: string;
  sections?: Array<{ heading: string; content: string }>;
}

export interface Topic {
  slug: string;
  title: string;
  description: string;
  category:
    | "living"
    | "transit"
    | "lifestyle"
    | "safety"
    | "real-estate"
    | "pets"
    | "food";
  content: string;
  quickTips: string[];
  faqs: FAQ[];
  relatedTopics: string[];
  relatedServices: string[];
  image?: string;
  answerSummary?: string;
  keyTakeaways?: string[];
  definitions?: Array<{ term: string; definition: string }>;
  publishedAt?: string;
  updatedAt?: string;
  lastUpdated?: string;
}

export interface DetailedComparison {
  costOfLiving: string;
  transitAndCommute: string;
  foodAndNightlife: string;
  safetyAndCommunity: string;
  bestFor: string;
}

export interface Verdict {
  summary: string;
  lvWinsAt: string[];
  theyWinAt: string[];
}

export interface Neighborhood {
  slug: string;
  name: string;
  avgRent1BR: number;
  avgRent2BR: number;
  transitScore: number;
  walkScore: number;
  bikeScore: number;
  population: number;
  medianAge: number;
  medianIncome: number;
  vibe: string;
  bestFor: string[];
  pros: string[];
  cons: string[];
  distanceFromLV: number;
  keyDifference: string;
  verdict: Verdict;
  detailedComparison: DetailedComparison;
  faqs: FAQ[];
  image?: string;
  answerBlock?: string;
}

export interface Business {
  slug: string;
  name: string;
  category: string;
  subcategory?: string;
  address: string;
  description: string;
  rating: number;
  reviewCount: number;
  priceRange: "$" | "$$" | "$$$" | "$$$$";
  hours: string;
  phone: string;
  website: string;
  tags: string[];
  categories?: string[];
  featured: boolean;
  proTip: string;
  image?: string;
  answerBlock?: string;
  bestFor?: string[];
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  content: string;
  publishedAt: string;
  updatedAt: string;
  category:
    | "news"
    | "development"
    | "food-drink"
    | "events"
    | "transit"
    | "real-estate"
    | "lifestyle"
    | "community";
  tags: string[];
  answerBlock: string;
  faqs: FAQ[];
  image?: string;
  relatedServices: string[];
  relatedTopics: string[];
  relatedPosts: string[];
  keyTakeaways: string[];
  author: string;
  crossLinks?: Array<{ type: "service" | "guide"; slug: string; label?: string }>;
  exploreCta?: { label: string; href: string; description: string };
  canonicalUrl?: string;
}

export interface GuideHub {
  population: string;
  medianRent: string;
  walkScore: number;
  transitScore: number;
  boundaries: string;
  history: string;
  prosCons: { pros: string[]; cons: string[] };
  quickFacts: Array<{ label: string; value: string }>;
  answerSummary: string;
}

export interface Building {
  // Identity
  slug: string;
  name: string;
  alternateNames: string[];

  // Location
  address: string;
  postalCode: string;
  latitude: number;
  longitude: number;

  // Physical facts
  yearBuilt: number;
  units: number;
  floors: number;
  buildingType: "loft" | "condo" | "rental" | "townhouse" | "mixed";
  developer?: string;

  // Market data
  avgRent1BR: number;
  avgRent2BR: number;
  avgPricePerSqft: number;
  maintenanceFeePerSqft?: number;

  // Walkability
  walkScore: number;
  transitScore: number;
  bikeScore: number;
  nearestTTC: string;

  // Amenities
  amenities: string[];
  hasParking: boolean;
  hasLockers: boolean;
  petFriendly: boolean;

  // Cross-references
  nearestBusinessSlugs: string[];

  // Content
  description: string;
  answerBlock: string;
  keyTakeaways: string[];
  proTips: string[];
  pros: string[];
  cons: string[];
  specificFaqs: FAQ[];

  // Tags
  tags: string[];

  // Media
  image?: string;

  // SEO overrides
  metaTitle?: string;
  metaDescription?: string;
}
