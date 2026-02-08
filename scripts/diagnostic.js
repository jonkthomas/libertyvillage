#!/usr/bin/env node
/**
 * Site Diagnostic — Comprehensive broken link and data consistency checker
 * Checks all cross-references across services, topics, neighborhoods, businesses, and posts.
 */
const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const load = (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));

const services = load("services.json");
const topics = load("topics.json");
const neighborhoods = load("neighborhoods.json");
const businesses = load("businesses.json");

let postsExist = false;
let posts = [];
try {
  posts = load("posts.json");
  postsExist = true;
} catch {
  // posts.json may not exist
}

const serviceSlugs = new Set(services.map((s) => s.slug));
const topicSlugs = new Set(topics.map((t) => t.slug));
const neighborhoodSlugs = new Set(neighborhoods.map((n) => n.slug));
const businessSlugs = new Set(businesses.map((b) => b.slug));
const postSlugs = new Set(posts.map((p) => p.slug));

const errors = [];
const warnings = [];

function error(file, item, field, msg) {
  errors.push({ file, item, field, msg });
}
function warn(file, item, field, msg) {
  warnings.push({ file, item, field, msg });
}

// ============================================================
// 1. SERVICES: relatedServices must reference valid service slugs
// ============================================================
for (const svc of services) {
  if (svc.relatedServices) {
    for (const ref of svc.relatedServices) {
      if (!serviceSlugs.has(ref)) {
        error("services.json", svc.slug, "relatedServices", `References non-existent service "${ref}"`);
      }
      if (ref === svc.slug) {
        warn("services.json", svc.slug, "relatedServices", `Self-references itself`);
      }
    }
  }
}

// ============================================================
// 2. TOPICS: relatedServices + relatedTopics must be valid
// ============================================================
for (const topic of topics) {
  if (topic.relatedServices) {
    for (const ref of topic.relatedServices) {
      if (!serviceSlugs.has(ref)) {
        error("topics.json", topic.slug, "relatedServices", `References non-existent service "${ref}"`);
      }
    }
  }
  if (topic.relatedTopics) {
    for (const ref of topic.relatedTopics) {
      if (!topicSlugs.has(ref)) {
        error("topics.json", topic.slug, "relatedTopics", `References non-existent topic "${ref}"`);
      }
      if (ref === topic.slug) {
        warn("topics.json", topic.slug, "relatedTopics", `Self-references itself`);
      }
    }
  }
}

// ============================================================
// 3. NEIGHBORHOODS: relatedServices must be valid
// ============================================================
for (const nb of neighborhoods) {
  if (nb.relatedServices) {
    for (const ref of nb.relatedServices) {
      if (!serviceSlugs.has(ref)) {
        error("neighborhoods.json", nb.slug, "relatedServices", `References non-existent service "${ref}"`);
      }
    }
  }
}

// ============================================================
// 4. BUSINESSES: category must match a service slug
// ============================================================
for (const biz of businesses) {
  if (!serviceSlugs.has(biz.category)) {
    error("businesses.json", biz.slug, "category", `Category "${biz.category}" has no matching service page`);
  }
  if (biz.categories) {
    for (const cat of biz.categories) {
      if (!serviceSlugs.has(cat)) {
        error("businesses.json", biz.slug, "categories", `Category "${cat}" has no matching service page`);
      }
    }
  }
}

// ============================================================
// 5. POSTS: relatedServices, relatedTopics, relatedPosts must be valid
// ============================================================
if (postsExist) {
  for (const post of posts) {
    if (post.relatedServices) {
      for (const ref of post.relatedServices) {
        if (!serviceSlugs.has(ref)) {
          error("posts.json", post.slug, "relatedServices", `References non-existent service "${ref}"`);
        }
      }
    }
    if (post.relatedTopics) {
      for (const ref of post.relatedTopics) {
        if (!topicSlugs.has(ref)) {
          error("posts.json", post.slug, "relatedTopics", `References non-existent topic "${ref}"`);
        }
      }
    }
    if (post.relatedPosts) {
      for (const ref of post.relatedPosts) {
        if (!postSlugs.has(ref)) {
          error("posts.json", post.slug, "relatedPosts", `References non-existent post "${ref}"`);
        }
      }
    }
  }
}

// ============================================================
// 6. DUPLICATE SLUGS within each data file
// ============================================================
function checkDupes(data, file) {
  const seen = new Set();
  for (const item of data) {
    if (seen.has(item.slug)) {
      error(file, item.slug, "slug", `Duplicate slug found`);
    }
    seen.add(item.slug);
  }
}
checkDupes(services, "services.json");
checkDupes(topics, "topics.json");
checkDupes(neighborhoods, "neighborhoods.json");
checkDupes(businesses, "businesses.json");
if (postsExist) checkDupes(posts, "posts.json");

// ============================================================
// 7. MISSING REQUIRED FIELDS
// ============================================================
for (const svc of services) {
  if (!svc.slug) error("services.json", "unknown", "slug", "Missing slug");
  if (!svc.name) error("services.json", svc.slug, "name", "Missing name");
  if (!svc.description) warn("services.json", svc.slug, "description", "Missing description");
}
for (const topic of topics) {
  if (!topic.slug) error("topics.json", "unknown", "slug", "Missing slug");
  if (!topic.title) error("topics.json", topic.slug, "title", "Missing title");
  if (!topic.content) warn("topics.json", topic.slug, "content", "Missing content");
}
for (const biz of businesses) {
  if (!biz.slug) error("businesses.json", "unknown", "slug", "Missing slug");
  if (!biz.name) error("businesses.json", biz.slug, "name", "Missing name");
  if (!biz.category) error("businesses.json", biz.slug, "category", "Missing category");
  if (!biz.answerBlock) warn("businesses.json", biz.slug, "answerBlock", "Missing answerBlock (AEO)");
  if (!biz.bestFor || biz.bestFor.length === 0)
    warn("businesses.json", biz.slug, "bestFor", "Missing bestFor (AEO)");
}

// ============================================================
// 8. SERVICE PAGES WITH NO BUSINESSES (empty pages)
// ============================================================
for (const svc of services) {
  const count = businesses.filter(
    (b) => b.category === svc.slug || (b.categories && b.categories.includes(svc.slug))
  ).length;
  if (count === 0) {
    error("services.json", svc.slug, "businesses", `Service page /best/${svc.slug} has ZERO businesses listed`);
  }
}

// ============================================================
// 9. ORPHANED BUSINESSES (category doesn't match any service)
// ============================================================
for (const biz of businesses) {
  const matchesAnyService =
    serviceSlugs.has(biz.category) ||
    (biz.categories && biz.categories.some((c) => serviceSlugs.has(c)));
  if (!matchesAnyService) {
    error("businesses.json", biz.slug, "category", `Business category "${biz.category}" has no service page`);
  }
}

// ============================================================
// REPORT
// ============================================================
console.log("=== SITE DIAGNOSTIC REPORT ===\n");
console.log(`Data files scanned:`);
console.log(`  services.json:      ${services.length} services`);
console.log(`  topics.json:        ${topics.length} topics`);
console.log(`  neighborhoods.json: ${neighborhoods.length} neighborhoods`);
console.log(`  businesses.json:    ${businesses.length} businesses`);
console.log(`  posts.json:         ${posts.length} posts`);
console.log();

if (errors.length === 0 && warnings.length === 0) {
  console.log("✅ ALL CHECKS PASSED — No broken links or inconsistencies found.\n");
} else {
  if (errors.length > 0) {
    console.log(`❌ ERRORS (${errors.length}):\n`);
    for (const e of errors) {
      console.log(`  [${e.file}] ${e.item} → ${e.field}: ${e.msg}`);
    }
    console.log();
  }
  if (warnings.length > 0) {
    console.log(`⚠️  WARNINGS (${warnings.length}):\n`);
    for (const w of warnings) {
      console.log(`  [${w.file}] ${w.item} → ${w.field}: ${w.msg}`);
    }
    console.log();
  }
}

console.log(`Summary: ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length > 0 ? 1 : 0);
