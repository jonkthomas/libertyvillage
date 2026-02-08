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
}
