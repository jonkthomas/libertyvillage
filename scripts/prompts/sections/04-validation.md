# Step 5: Validation & Error Handling

Validate everything before committing. Never publish broken content.

## 5.1 Pre-Write Validation (Before updating posts.json)

Before appending the new post to `data/posts.json`, verify ALL of these:

### Required Fields Check
- [ ] `slug` — non-empty string, kebab-case, no spaces
- [ ] `title` — non-empty string, 30-80 characters
- [ ] `description` — non-empty string, 80-200 characters
- [ ] `content` — non-empty string, 800-1200 words (count by splitting on whitespace)
- [ ] `publishedAt` — valid ISO date (YYYY-MM-DD)
- [ ] `updatedAt` — valid ISO date (YYYY-MM-DD)
- [ ] `category` — one of: `news`, `development`, `food-drink`, `events`, `transit`, `real-estate`, `lifestyle`, `community`
- [ ] `tags` — array of 4-6 strings
- [ ] `answerBlock` — 40-60 words
- [ ] `faqs` — array of 4-5 objects, each with `question` and `answer` strings, answers >20 words
- [ ] `keyTakeaways` — array of 4-6 strings
- [ ] `author` — must be `"LibertyVillage.co"`
- [ ] `image` — must match pattern `/images/blog/{slug}.jpg`

### Cross-Reference Validation
- [ ] Every slug in `relatedServices` exists in `data/services.json` (check the `slug` field of each entry)
- [ ] Every slug in `relatedTopics` exists in `data/topics.json` (check the `slug` field of each entry)
- [ ] Every slug in `relatedPosts` exists in `data/posts.json` (check the `slug` field of each entry)
- [ ] No self-reference: the new post's slug is NOT in its own `relatedPosts`

### Duplicate Check
- [ ] No existing post in `data/posts.json` has the same `slug`

If ANY validation fails:
1. Log which validation failed and why
2. Attempt to fix (e.g., adjust word count, remove invalid cross-reference)
3. Re-validate
4. If still failing after 2 fix attempts, abort and exit with error

## 5.2 Write to posts.json

Once validation passes:
1. Read current `data/posts.json` with the Read tool
2. Parse as JSON array
3. Append the new post object
4. Write back with the Write tool (pretty-printed with 2-space indent)
5. Verify the file is valid JSON by reading it back

## 5.3 Post-Write Validation

### Diagnostic Check
Run: `node scripts/diagnostic.js`

- **Exit code 0** = PASS (warnings are acceptable, errors are not)
- **Exit code non-0** = FAIL
- If diagnostic fails:
  1. Read the error output
  2. Fix the issue (usually a bad cross-reference)
  3. Re-run diagnostic
  4. If still failing after 2 attempts, revert posts.json to its original state and abort

### Build Check
Run: `npm run build`

- Must complete without errors
- Expected: page count should be previous count + 1 (new blog post page)
- If build fails:
  1. Read the error output
  2. Attempt to fix (if it's a data issue)
  3. Re-run build
  4. If still failing, revert posts.json and abort

## 5.4 Image Validation

Verify the hero image exists and is valid:
- File exists at `public/images/blog/{slug}.jpg`
- File size is >10KB (reject tiny/broken downloads)
- If image is missing or invalid, generate a branded hero card (Tier 3 fallback)

## 5.5 Git Commit Whitelist

Only add these specific files to the git commit:
- `data/posts.json`
- `public/images/blog/{slug}.jpg`
- `tasks/seo-data-latest.json`
- `tasks/auto-blog-runs/{date}.json`

Do NOT add any other files. Use `git add` with explicit file paths, never `git add .` or `git add -A`.

## 5.6 Failure Recovery

On any unrecoverable failure:
1. Revert `data/posts.json` to its state before this run (re-read from git: `git checkout -- data/posts.json`)
2. Delete any partially downloaded image
3. Save error details to the run log (`tasks/auto-blog-runs/{date}.json`)
4. Exit with code 1 (triggers GitHub Actions failure notification)

## 5.7 DRY_RUN Mode

If `DRY_RUN` is `true`:
- Run ALL validations normally (diagnostic, build)
- Save the generated post to `tasks/auto-blog-dry-run.json` instead of committing
- Do NOT modify `data/posts.json` permanently (revert after validation)
- Do NOT git commit or push
- Log: "DRY RUN complete — output saved to tasks/auto-blog-dry-run.json"
