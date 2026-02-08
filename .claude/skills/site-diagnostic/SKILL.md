# /site-diagnostic — Comprehensive Site Health Check

Run a full diagnostic crawl of libertyvillage.co checking for broken links, data inconsistencies, empty pages, and missing content.

## When to Use
- After adding new data (businesses, services, topics)
- After modifying cross-references between pages
- Before pushing to production
- Weekly QA check

## Execution Steps

### Step 1: Run the diagnostic script
```bash
node scripts/diagnostic.js
```

This checks:
- All `relatedServices` references across services, topics, neighborhoods, and posts
- All `relatedTopics` references across topics and posts
- All `relatedPosts` references in posts
- Business categories match existing service pages
- No duplicate slugs in any data file
- No empty service pages (every /best/[service] has businesses)
- Required fields are present on all records
- AEO fields (answerBlock, bestFor) exist on all businesses

### Step 2: If errors found, deploy parallel fix agents

For **broken cross-references** (most common):
1. Identify the broken slug and the data file
2. Find the closest valid slug from the existing data
3. Update the reference or remove it if no valid match exists

For **empty service pages**:
1. Research real businesses in or near Liberty Village for the category
2. Add 3-4 verified businesses with full data (answerBlock, bestFor, proTip, etc.)
3. Re-run diagnostic to confirm fix

For **missing AEO fields**:
1. Generate answerBlock (40-60 words) and bestFor (3-4 items) for each business missing them
2. Update businesses.json

### Step 3: Verify build
```bash
npm run build
```
Confirm all pages generate without errors.

### Step 4: Re-run diagnostic
```bash
node scripts/diagnostic.js
```
Must show: `✅ ALL CHECKS PASSED`

### Step 5: Report

Output a summary with:
- Total data files scanned and record counts
- Errors found and fixed
- Warnings found and addressed
- Build status (page count)
- Any remaining issues requiring manual attention

## Diagnostic Checks Reference

| Check | Severity | Description |
|-------|----------|-------------|
| Broken relatedServices | ERROR | Cross-reference points to non-existent service slug |
| Broken relatedTopics | ERROR | Cross-reference points to non-existent topic slug |
| Broken relatedPosts | ERROR | Cross-reference points to non-existent post slug |
| Invalid business category | ERROR | Business category doesn't match any service page |
| Empty service page | ERROR | Service has zero businesses listed |
| Duplicate slug | ERROR | Two records share the same slug |
| Self-reference | WARNING | Item references itself in related list |
| Missing answerBlock | WARNING | Business lacks AEO answer block |
| Missing bestFor | WARNING | Business lacks bestFor scenarios |
| Missing required field | ERROR | Record missing slug, name, or other required field |
