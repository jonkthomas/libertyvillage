# Step 2: Topic Selection

Select the best blog topic based on SEO data and existing content inventory.

## 2.1 Load Content Inventory

Read these files to understand existing content:

1. **`data/posts.json`** — All published blog posts (slugs, titles, categories, tags)
2. **`data/services.json`** — 59 service pages (slugs, titles) for cross-referencing
3. **`data/topics.json`** — 30 guide topics (slugs, titles) for cross-referencing
4. **`data/businesses.json`** — 68 business listings (names, slugs, categories) for mentions

Use the Read tool to load each file.

## 2.2 Check for Topic Override

If the `TOPIC_OVERRIDE` environment variable is set (non-empty):
- **Skip all analysis below**
- Use the override value as the topic
- Generate a title, slug, keywords, and category from the override
- Proceed directly to Step 3 (Blog Generation)

## 2.3 Topic Selection Criteria

Score potential topics on these factors (1-5 scale each):

| Factor | Description |
|--------|-------------|
| **Search demand** | Does GSC data show queries related to this topic? Higher impressions = higher score |
| **Content gap** | Is there a query with impressions but NO dedicated page? Big gap = high score |
| **Seasonal relevance** | Is this topic timely? (e.g., summer patios in June, holiday events in Dec) |
| **Topic diversity** | Does this category differ from recent posts? Avoid 3+ posts in same category |
| **Cross-reference potential** | Can this topic link to many existing service/business/guide pages? |
| **Local specificity** | Is this specific to Liberty Village, not generic Toronto content? |

Select the topic with the highest combined score.

## 2.4 Duplicate Prevention

Before finalizing a topic, verify:

1. **No slug collision**: The proposed slug does NOT exist in `data/posts.json`
2. **No title overlap**: No existing post title is substantially similar (>60% word overlap)
3. **Recent topic check**: The selected category has NOT been used in the last 4 posts
4. **Keyword check**: The primary keyword is not already targeted by an existing post

If any check fails, select the next-highest-scoring topic.

## 2.5 Fallback: Evergreen Topics

If no SEO data is available (Step 1 returned no data), select from this evergreen topic bank:

| Topic | Category | Keywords |
|-------|----------|----------|
| Best patios in Liberty Village | food-drink | patios, outdoor dining, summer |
| Liberty Village park guide | lifestyle | parks, green space, recreation |
| Getting around Liberty Village without a car | transit | transit, bike, walking |
| Liberty Village for young professionals | community | young professionals, networking |
| Pet services in Liberty Village | lifestyle | pets, dog walking, vet |
| Liberty Village weekend activities | events | weekend, things to do |
| Home renovation tips for LV condos | real-estate | renovation, condo, upgrades |
| Liberty Village coffee shop guide | food-drink | coffee, cafes, work |
| Nightlife in Liberty Village | food-drink | bars, nightlife, drinks |
| Liberty Village family guide | community | family, kids, family-friendly |

Select the first topic from this list that:
- Has NOT been covered in existing posts
- Has a different category from the most recent post

## 2.6 Output

After selecting a topic, output clearly:

```
TOPIC SELECTED:
- Topic: [selected topic]
- Title: [proposed blog post title]
- Slug: [kebab-case-slug]
- Category: [one of: news, development, food-drink, events, transit, real-estate, lifestyle, community]
- Target Keywords: [comma-separated keywords]
- Justification: [1-2 sentences on why this topic was selected]
```
