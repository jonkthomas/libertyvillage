# Image Sourcing Cascade

The agent uses a 3-tier cascade to source hero images for blog posts.

## Tier 1: Pexels API (Primary)

Deterministic, fast, high-quality stock photos with free license.

```bash
curl -s -H "Authorization: $PEXELS_API_KEY" \
  "https://api.pexels.com/v1/search?query={topic}&per_page=5&orientation=landscape" \
  | jq -r '.photos[0].src.landscape'
```

Then download:
```bash
curl -L -o public/images/blog/{slug}.jpg "{image_url}"
```

- **API Key:** Set as `PEXELS_API_KEY` env var
- **Rate limit:** 25,000 requests/month
- **Image size:** 100-500KB typically
- **License:** Free for commercial use, no attribution required

## Tier 2: Web Search + Download (Fallback)

If Pexels fails or returns irrelevant images:

1. Use `WebSearch` tool: search "{topic} free stock photo site:unsplash.com OR site:pixabay.com"
2. Try 2-3 different search queries with variations
3. Download using `curl -L -o public/images/blog/{slug}.jpg "{url}"`
4. Or use Playwright MCP to navigate to the image page and download

## Tier 3: Branded Hero Card (Final Fallback)

If all external sources fail, generate a branded card:

1. Open `scripts/templates/hero-card.html` in Playwright
2. Inject title, emoji, and gradient via URL params or JS
3. Screenshot at 1280x720
4. Save to `public/images/blog/{slug}.jpg`

See hero-card.html template for category-color mappings.

## Validation Rules

- Image must be **>10KB** (reject tiny/broken downloads)
- Image should be **landscape orientation** (width > height)
- Target width: **1280px+**
- Only use **free/CC0 sources** (Pexels, Pixabay, Unsplash)
- Save to: `public/images/blog/{slug}.jpg`

## Category → Color/Emoji Mappings

| Category | Gradient Start | Gradient End | Emoji |
|----------|---------------|-------------|-------|
| news | #1e40af | #3b82f6 | 📰 |
| food-drink | #c2410c | #f97316 | 🍽️ |
| events | #7e22ce | #a855f7 | 🎉 |
| transit | #0f766e | #14b8a6 | 🚇 |
| real-estate | #b91c1c | #ef4444 | 🏙️ |
| lifestyle | #4338ca | #818cf8 | ✨ |
| community | #15803d | #22c55e | 🤝 |
| development | #0369a1 | #0ea5e9 | 🏗️ |
