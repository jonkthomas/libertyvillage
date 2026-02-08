# Quality Guard

Automated checks to prevent duplicate or low-quality content.

## Pre-Generation Checks (Before writing content)

Run these checks BEFORE generating the blog post content:

### Duplicate Prevention
1. **Slug uniqueness**: The proposed slug does NOT exist in `data/posts.json`
2. **Title similarity**: No existing post title shares >60% of the same words (case-insensitive)
3. **Recent topic check**: The selected category has NOT been used in the last 4 posts (by publishedAt date)
4. **Keyword overlap**: The primary target keyword is not the primary keyword of any existing post (check titles and first tag)

If any check fails:
- Log which check failed
- Select the next-best topic from the scoring in Step 2
- Re-run pre-generation checks
- If 3 topics fail in a row, use an evergreen topic from the fallback list

## Post-Generation Checks (After generating content)

After generating the BlogPost JSON, validate quality:

### Content Length
- Word count MUST be 800-1200 words
- Count by splitting `content` field on whitespace
- If under 800: expand sections with more detail
- If over 1200: trim less essential paragraphs

### Internal Links
- Content MUST contain at least 3 internal links
- Links use format: `[text](/best/slug)` or `[text](/guide/slug)` or `[text](/blog/slug)`
- Count by regex: `/\[.*?\]\(\/(?:best|guide|blog|vs|biz)\/.*?\)/g`
- If under 3: add links to relevant service or guide pages

### Business Mentions
- Content MUST mention at least 2 real businesses by bold name
- Business names MUST exist in `data/businesses.json` (check the `name` field)
- Bold format: `**Business Name**`
- Count by regex: `/\*\*[^*]+\*\*/g` then verify each against businesses.json
- If under 2: add relevant business mentions naturally into the content

### FAQ Quality
- Each FAQ answer MUST be >20 words
- Answers should include specific local details (not generic)
- Questions should be ones a Liberty Village resident would actually ask
- Count words by splitting on whitespace

### Answer Block Quality
- Must be 40-60 words
- Must directly answer the post's core question
- Must NOT start with "This article" or "In this post"
- Should front-load the most important information

### Key Takeaways Quality
- 4-6 bullet points
- Each should be actionable or informative
- Each should be 1 sentence (not a fragment, not a paragraph)

## Retry Logic

If quality checks fail:
1. Identify which checks failed
2. Provide specific feedback to guide regeneration:
   - "Content is only 650 words — expand the section about [topic]"
   - "Only 1 internal link found — add links to /best/restaurants and /guide/parking-guide"
   - "No business mentions — mention **Mildred's Temple Kitchen** and **Sweet Olenka's**"
3. Regenerate the content with adjusted instructions
4. Re-run quality checks
5. Maximum 2 retries — if still failing after 2 retries, proceed with best attempt and log warnings
