# Ralph Loop Iteration — Business Image Replacement

You are an autonomous coding agent replacing 76 fake business images on libertyvillage.so. Each iteration you complete one user story.

## CRITICAL RULES — READ FIRST

1. **NEVER pass image data inline into conversation.** This will corrupt the context and freeze Claude Code. Always save images to files with explicit filenames. Never use the Read tool on image files.
2. **Use agent swarming** for download stories (US-003 through US-011). Launch multiple `web-research-specialist` Task agents in parallel to search for image URLs. Collect the URLs, then batch download with curl.
3. **Track progress** in `tasks/prd-business-image-replacement.md` Image Tracking Log. Update the Source and Status columns for each image you complete.
4. **Validate every download** — run `file <path>` to confirm it's JPEG image data, not HTML. Many websites return HTML error pages.

## Your Workflow

1. **Read Context**
   - Read `prd.json` for user stories and their status
   - Read `progress.txt` for learnings from previous iterations
   - Check which stories have `passes: false`

2. **Select Story**
   - Pick the highest-priority incomplete story (first with `passes: false`)
   - Focus on THIS STORY ONLY — do not work on multiple stories

3. **Implement**

   **For setup stories (US-001, US-002):**
   - Write the scripts as described in acceptance criteria
   - Test them on a sample image

   **For download stories (US-003 through US-011):**
   - Launch multiple Task agents (subagent_type: `web-research-specialist`) in PARALLEL
   - Each agent searches for image URLs for a subset of businesses in the story
   - Agent prompt: "Search the web for [business name] [location]. Find a direct image URL (JPEG/PNG/WebP) of their storefront, interior, or hero image. Check their official website og:image first. Return ONLY the direct image URL, nothing else."
   - Collect all URLs from agents
   - Download each image with curl: `curl -L -o <path> "<url>"`
   - Run `file <path>` to validate each is a real image (not HTML)
   - If invalid: re-search with a different query and retry
   - Run optimization script (`node scripts/optimize-business-images.js`) if available
   - Update the tracking log in tasks/prd-business-image-replacement.md

   **For validation/audit stories (US-012, US-013):**
   - Create/run validation scripts as described
   - Fix any issues found

   **For code review loop (US-014):**
   - Launch code-reviewer Task agent to scan for remaining image gaps
   - Fix any issues found, re-run review until clean

4. **Quality Checks**
   - Run `file public/images/businesses/*.jpg | grep -c "JPEG"` to count valid images
   - Run `file public/images/businesses/*.jpg | grep "HTML"` to find remaining fakes
   - Typecheck: `cd /workspace/libertyvillage && npx tsc --noEmit` (if applicable)

5. **Commit**
   - Stage relevant files (images + scripts + tracking log)
   - Commit with format: `[US-XXX] Title of story`
   - Include Co-Authored-By line

6. **Update PRD**
   - Set the story's `passes` to `true` in prd.json
   - Commit: `chore: mark US-XXX complete`

7. **Document Learnings**
   - Append to `progress.txt` (NEVER replace, only append):
     ```
     ## [Date] - US-XXX: Story Title

     **What I did:**
     - List of changes made

     **Images downloaded:**
     - slug1.jpg from <source>
     - slug2.jpg from <source>

     **Failed/retried:**
     - slug3.jpg — first attempt was HTML, retried with different URL

     **Learnings:**
     - Patterns discovered, gotchas, useful context
     ```

## Image Download Strategy

For each business, try sources in this order:
1. **Official website og:image** — fetch the business website, look for og:image meta tag
2. **WebSearch** — search for "{business name} Liberty Village Toronto" and find direct image URL
3. **Pexels/Unsplash** — search for category-appropriate stock (e.g., "modern coffee shop interior toronto")

For Airbnb rentals specifically:
1. **WebFetch on Airbnb URL** — extract listing image
2. **WebSearch** — search for listing name + "Airbnb Liberty Village"
3. **Fallback** — search for "liberty village toronto condo interior" or similar

## Agent Swarming Pattern

```
// Launch 3-5 agents in parallel for a batch of businesses:
Task(web-research-specialist, "Find image URL for Mildred's Temple Kitchen, Liberty Village Toronto. Check mildreds.ca og:image first. Return direct image URL only.")
Task(web-research-specialist, "Find image URL for NODO restaurant, Liberty Village Toronto. Check nodorestaurant.com og:image first. Return direct image URL only.")
Task(web-research-specialist, "Find image URL for Chiang Mai Thai, Liberty Village Toronto. Return direct image URL only.")
// ... collect URLs, then download all with curl
```

## Important Rules

- **One story per iteration** — Do not implement multiple stories
- **Never read image files with Read tool** — only use `file` command to check type
- **Always validate downloads** — many sites return HTML 403/404 pages
- **Append-only progress** — Never delete from progress.txt
- **Minimal changes** — Only change what's necessary for the story

## Completion Signal

When ALL user stories have `passes: true`, reply with:

```
<promise>COMPLETE</promise>
```

Only output this when every story is complete. Not before.

## Now Begin

Read prd.json and progress.txt, then implement the next incomplete story.
