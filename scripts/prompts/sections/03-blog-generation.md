# Step 3: Blog Post Generation

Generate a complete BlogPost JSON object matching the TypeScript interface.

## 3.1 BlogPost Interface

```typescript
export interface FAQ {
  question: string;
  answer: string;
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
```

## 3.2 Field Requirements

| Field | Type | Constraints |
|-------|------|-------------|
| `slug` | string | Kebab-case, unique, matches the proposed slug from Step 2 |
| `title` | string | 50-70 characters, includes primary keyword |
| `description` | string | 120-160 characters, compelling for search results |
| `content` | string | 800-1200 words, markdown format |
| `publishedAt` | string | Today's date in ISO format (YYYY-MM-DD) |
| `updatedAt` | string | Same as publishedAt for new posts |
| `category` | enum | One of: news, development, food-drink, events, transit, real-estate, lifestyle, community |
| `tags` | string[] | 4-6 relevant tags, lowercase |
| `answerBlock` | string | 40-60 words, AEO-optimized direct answer |
| `faqs` | FAQ[] | 4-5 questions with substantive answers (>20 words each) |
| `image` | string | `/images/blog/{slug}.jpg` |
| `relatedServices` | string[] | 2-4 real slugs from data/services.json |
| `relatedTopics` | string[] | 2-4 real slugs from data/topics.json |
| `relatedPosts` | string[] | 1-3 real slugs from data/posts.json |
| `keyTakeaways` | string[] | 4-6 concise bullet points |
| `author` | string | Always `"LibertyVillage.co"` |

## 3.3 Content Guidelines

### Markdown Content (`content` field)

Write 800-1200 words in markdown format:

- Use `##` for section headers (NOT `#` — that's reserved for the page title)
- Include **at least 3 internal links** using `[link text](/best/slug)` or `[link text](/guide/slug)` syntax
- Mention **at least 2 real businesses** by bold name (e.g., **Mildred's Temple Kitchen**)
  - Business names MUST exist in `data/businesses.json` — do NOT fabricate
  - Bold business names are auto-linked by the site's rendering system
- Natural paragraph flow with subheadings every 150-200 words
- Include a brief intro paragraph and conclusion

### Answer Block (`answerBlock` field)

Write a 40-60 word direct answer to the post's core question:
- Should work as a standalone answer in search results
- Front-load the most important information
- No filler words or preamble
- Optimized for AI answer engines (AEO)

### FAQs (`faqs` field)

Generate 4-5 FAQs:
- Each question should be a real question a Liberty Village resident would ask
- Each answer must be >20 words and substantive (not generic)
- Include specific local details (business names, street names, prices)
- Format: `[{"question": "...", "answer": "..."}]`

### Key Takeaways (`keyTakeaways` field)

4-6 concise bullet points summarizing the post:
- Each should be 1 sentence, actionable or informative
- Include specific details (numbers, names, addresses)

## 3.4 Cross-Reference Rules

All cross-reference slugs MUST exist in their respective data files:

- `relatedServices`: Read `data/services.json`, use only existing slugs (e.g., "restaurants", "coffee-shops", "gyms")
- `relatedTopics`: Read `data/topics.json`, use only existing slugs (e.g., "parking-guide", "dog-parks")
- `relatedPosts`: Read `data/posts.json`, use only existing slugs

If fewer than the minimum exist (e.g., posts.json is empty), use as many as available (0 is OK for relatedPosts).

## 3.5 Tone & Style

- **Informative and locally-focused** — written for Liberty Village residents
- **Conversational but authoritative** — like a knowledgeable neighbor, not a corporate blog
- **Specific to Liberty Village** — mention specific streets, parks, landmarks, businesses
- **No AI self-references** — never say "As an AI" or "I'm a language model"
- **No fabricated details** — only reference real businesses from businesses.json
- **Canadian English** — use Canadian spellings (neighbourhood, colour, centre)

## 3.6 Output

Output the complete BlogPost JSON object. Example structure:

```json
{
  "slug": "best-patios-liberty-village-summer-2026",
  "title": "Best Patios in Liberty Village for Summer 2026",
  "description": "Discover the top outdoor dining spots in Liberty Village...",
  "content": "## Introduction\n\nAs summer approaches...",
  "publishedAt": "2026-02-08",
  "updatedAt": "2026-02-08",
  "category": "food-drink",
  "tags": ["patios", "outdoor-dining", "summer", "restaurants", "liberty-village"],
  "answerBlock": "Liberty Village offers over a dozen great patios...",
  "faqs": [{"question": "...", "answer": "..."}],
  "image": "/images/blog/best-patios-liberty-village-summer-2026.jpg",
  "relatedServices": ["restaurants", "bars", "coffee-shops"],
  "relatedTopics": ["parking-guide", "dog-parks"],
  "relatedPosts": ["best-restaurants-liberty-village-locals-guide"],
  "keyTakeaways": ["..."],
  "author": "LibertyVillage.co"
}
```
