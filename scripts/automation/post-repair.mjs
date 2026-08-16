// Per-post repair path for data/posts.json.
//
// data/posts.json is ~820 KB, so the whole-file fixer path can never fit inside
// the fixer input budget. Everything here works on individual post objects that
// the PR appended or modified against its merge base: the model only ever sees
// and emits those posts, and the trusted splice below rebuilds the file while
// requiring every other post to stay byte-identical.
import { isTextRepairPath, validatePaths } from './policy.mjs';
import { validatePostRepair } from './preflight.mjs';

export const POSTS_FILE = 'data/posts.json';
export const POST_REPAIR_PLAN_TYPE = 'post-repair';
export const POST_REPAIR_MAX_BYTES = 60_000;
export const MAX_REPAIRED_POSTS = 10;

export function isPostsOnlyRepair(repairableFiles) {
  return Array.isArray(repairableFiles) && repairableFiles.length === 1 && repairableFiles[0] === POSTS_FILE;
}

export function serializePosts(posts, trailingNewline = true) {
  return `${JSON.stringify(posts, null, 2)}${trailingNewline ? '\n' : ''}`;
}

export function readPostsFile(text, label) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, errors: [`${label} ${POSTS_FILE} is empty`] };
  let posts = null;
  try { posts = JSON.parse(text); } catch { return { ok: false, errors: [`${label} ${POSTS_FILE} must be valid JSON`] }; }
  if (!Array.isArray(posts) || posts.length === 0) return { ok: false, errors: [`${label} ${POSTS_FILE} must be a non-empty JSON array`] };
  const errors = [];
  const slugs = new Set();
  for (const [index, post] of posts.entries()) {
    if (!post || typeof post !== 'object' || Array.isArray(post)) { errors.push(`${label} post ${index} must be an object`); continue; }
    if (typeof post.slug !== 'string' || post.slug.trim().length === 0) { errors.push(`${label} post ${index} has no slug`); continue; }
    if (slugs.has(post.slug)) errors.push(`${label} has a duplicate slug: ${post.slug}`);
    slugs.add(post.slug);
  }
  const trailingNewline = text.endsWith('\n');
  if (errors.length === 0 && serializePosts(posts, trailingNewline) !== text) {
    errors.push(`${label} ${POSTS_FILE} is not canonically formatted`);
  }
  return { ok: errors.length === 0, errors, posts, trailingNewline };
}

// Appended or modified posts, keyed by slug, between the PR merge base and head.
export function diffPostsBySlug(baseText, headText) {
  const base = readPostsFile(baseText, 'base');
  const head = readPostsFile(headText, 'head');
  if (!base.ok || !head.ok) return { ok: false, errors: [...base.errors, ...head.errors], slugs: [] };
  const baseBySlug = new Map(base.posts.map((post) => [post.slug, JSON.stringify(post)]));
  const headSlugs = new Set(head.posts.map((post) => post.slug));
  const errors = [];
  for (const slug of baseBySlug.keys()) if (!headSlugs.has(slug)) errors.push(`head ${POSTS_FILE} dropped base post: ${slug}`);
  const slugs = head.posts.filter((post) => baseBySlug.get(post.slug) !== JSON.stringify(post)).map((post) => post.slug);
  if (slugs.length === 0) errors.push('no appended or modified posts between base and head');
  if (slugs.length > MAX_REPAIRED_POSTS) errors.push(`changed post budget exceeded: ${slugs.length} > ${MAX_REPAIRED_POSTS}`);
  return {
    ok: errors.length === 0, errors, slugs,
    basePosts: base.posts, headPosts: head.posts, trailingNewline: head.trailingNewline,
  };
}

export function buildPostRepairPlan(plan) {
  return {
    plan_type: POST_REPAIR_PLAN_TYPE, file: POSTS_FILE,
    posts: plan.posts, reason: plan.reason,
  };
}

export function isPostRepairPlan(plan) {
  return Boolean(plan) && typeof plan === 'object' && plan.plan_type === POST_REPAIR_PLAN_TYPE;
}

// Validates a post-level plan against the trusted base/head files and returns the
// spliced data/posts.json. Fails closed on anything unexpected; the caller keeps
// the whole-file guards (repairable path, text file, regular file, changed-files).
export function applyPostRepairPlan(kind, plan, { changedFiles, baseText, headText }) {
  const errors = [];
  if (!isPostRepairPlan(plan) || !Array.isArray(plan.posts)) {
    return { ok: false, errors: [`repair plan must be a ${POST_REPAIR_PLAN_TYPE} plan with a posts array`] };
  }
  if (Array.isArray(plan.edits)) errors.push('post repair plan must not carry whole-file edits');
  if (plan.file !== POSTS_FILE) errors.push(`post repair plan must target ${POSTS_FILE}`);
  if (typeof plan.reason !== 'string' || plan.reason.trim().length === 0) errors.push('post repair plan reason is required');
  if (plan.posts.length === 0 || plan.posts.length > MAX_REPAIRED_POSTS) errors.push(`post repair plan must contain 1-${MAX_REPAIRED_POSTS} posts`);
  errors.push(...validatePaths(kind, [POSTS_FILE], { repair: true }).errors);
  if (!isTextRepairPath(POSTS_FILE)) errors.push(`repair target must be a text file: ${POSTS_FILE}`);
  if (!Array.isArray(changedFiles) || !changedFiles.includes(POSTS_FILE)) errors.push(`repair may only touch an existing PR diff path: ${POSTS_FILE}`);

  const diff = diffPostsBySlug(baseText, headText);
  if (!diff.ok) return { ok: false, errors: [...errors, ...diff.errors] };
  const changedSlugs = new Set(diff.slugs);
  const headIndex = new Map(diff.headPosts.map((post, index) => [post.slug, index]));
  const posts = [...diff.headPosts];
  const repairedSlugs = new Set();
  for (const [index, entry] of plan.posts.entries()) {
    const slug = entry?.slug;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof slug !== 'string' || slug.length === 0) {
      errors.push(`repaired entry ${index} must be an object with a slug`);
      continue;
    }
    if (repairedSlugs.has(slug)) { errors.push(`duplicate repaired slug: ${slug}`); continue; }
    repairedSlugs.add(slug);
    if (!headIndex.has(slug)) { errors.push(`repaired slug is not in head ${POSTS_FILE}: ${slug}`); continue; }
    if (!changedSlugs.has(slug)) { errors.push(`repaired slug was not appended or modified by this PR: ${slug}`); continue; }
    const original = diff.headPosts[headIndex.get(slug)];
    const repaired = entry.post;
    if (!repaired || typeof repaired !== 'object' || Array.isArray(repaired) || repaired.slug !== slug) {
      errors.push(`repaired post ${slug} must be an object carrying the same slug`);
      continue;
    }
    const check = validatePostRepair(original, repaired, { maxBytes: POST_REPAIR_MAX_BYTES });
    if (!check.ok) { errors.push(...check.errors.map((error) => `${slug}: ${error}`)); continue; }
    posts[headIndex.get(slug)] = repaired;
  }
  if (errors.length) return { ok: errors.length === 0, errors };

  const text = serializePosts(posts, diff.trailingNewline);
  if (text === headText) return { ok: false, errors: ['post repair produced no change'] };
  const rebuilt = readPostsFile(text, 'repaired');
  if (!rebuilt.ok) return { ok: false, errors: rebuilt.errors };
  if (rebuilt.posts.length !== diff.headPosts.length) return { ok: false, errors: ['post repair changed the post count'] };
  for (const [index, post] of rebuilt.posts.entries()) {
    if (repairedSlugs.has(post.slug)) continue;
    if (JSON.stringify(post) !== JSON.stringify(diff.headPosts[index])) {
      return { ok: false, errors: [`post repair changed an unrelated post: ${post.slug}`] };
    }
  }
  return { ok: true, errors: [], text, slugs: [...repairedSlugs], bytes: Buffer.byteLength(text) };
}
