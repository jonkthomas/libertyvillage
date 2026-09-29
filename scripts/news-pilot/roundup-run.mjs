#!/usr/bin/env node
/** Verify discovery clusters, then append at most one weekly news post. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRunArtifact, buildSourceEvidence, extractMetaPublishDate } from './draft-evidence.mjs';
import { createRequestBudget, fetchWithRetry } from './fetch.mjs';
import { canonicalUrl, publisherDomain } from './normalize.mjs';
import { detectRiskFlags, isDevelopmentApplication } from './score.mjs';
import { isUnusableUrl } from './url-guard.mjs';
import { validateRoundupPack, revalidateRoundupItems, roundupPackDigest } from './roundup-evidence.mjs';
import { isoWeekOf, roundupSlug, planRoundup, buildRoundupPost } from './roundup.mjs';
import { appendPostToPostsJson } from './publish.mjs';
import { checkRoundupRecord } from '../content/submit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_IMAGE = '/images/og/og-home.jpg';
const ROUNDUP_SLUG = /^liberty-village-news-week-\d{4}-w\d{2}$/;
const MAX_CANDIDATES = 80;
const MAX_SOURCES_PER_ITEM = 4;
const MAX_REQUESTS = 80;
const RISK_CATEGORIES = new Set(['crime', 'safety', 'civic', 'civic-controversy', 'election', 'development-application']);

export function parseRoundupArgs(argv) {
  const args = { run: null, out: null, root: ROOT, now: null, vault: null, image: DEFAULT_IMAGE, dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else {
      const match = arg.match(/^--(run|out|root|now|vault|image)=(.*)$/);
      if (!match) throw new Error(`unknown_argument:${arg}`);
      args[match[1]] = match[2];
    }
  }
  return args;
}

/** Pending spec addendum: this is the sole writer-owned date-window policy. */
export function temporalWindow({ nowMs, item }) {
  const { weekStartUtc } = isoWeekOf(nowMs);
  if (!item?.announcedAtVerified || !Number.isFinite(Date.parse(item.announcedAt ?? ''))) return 'undated';
  const announced = Date.parse(item.announcedAt);
  if (announced < Date.parse(weekStartUtc) || announced > nowMs) return 'stale';
  if (item.eventEnd && Date.parse(item.eventEnd) <= nowMs) return 'concluded';
  return null;
}

function verifiedInstant(html) {
  const raw = String(html || '');
  const values = [];
  for (const tag of raw.match(/<(?:meta|time)\b[^>]*>/gi) || []) {
    if (!/(?:article:published_time|datePublished|\bdatetime\s*=)/i.test(tag) || /dateModified/i.test(tag)) continue;
    const match = tag.match(/(?:content|datetime)\s*=\s*["']([^"']+)["']/i);
    if (match) values.push(match[1]);
  }
  for (const match of raw.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (value) => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') {
          if (typeof value.datePublished === 'string') values.push(value.datePublished);
          Object.values(value).forEach(walk);
        }
      };
      walk(JSON.parse(match[1]));
    } catch { /* malformed structured data is not date evidence */ }
  }
  for (const value of values) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)$/i.test(value)) continue;
    const iso = extractMetaPublishDate(`<time datetime="${value}"></time>`);
    if (iso && Number.isFinite(Date.parse(iso))) return iso;
  }
  return null;
}

function verifiedEventWindow(html) {
  for (const match of String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const values = [];
      const walk = (value) => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') {
          if (String(value['@type'] || '').toLowerCase().includes('event')) values.push(value);
          Object.values(value).forEach(walk);
        }
      };
      walk(JSON.parse(match[1]));
      for (const value of values) {
        const valid = (date) => typeof date === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(date) && Number.isFinite(Date.parse(date));
        if (valid(value.startDate)) return { eventStart: new Date(value.startDate).toISOString(),
          ...(valid(value.endDate) ? { eventEnd: new Date(value.endDate).toISOString() } : {}) };
      }
    } catch { /* malformed structured data cannot prove an event window */ }
  }
  return null;
}

function safeUrl(candidate) {
  const url = canonicalUrl(candidate?.canonicalUrl || candidate?.url || '');
  return url && /^https:\/\//i.test(url) && !isUnusableUrl(url) ? url : null;
}

function splitPosts(posts, slug) {
  const others = posts.filter((post) => post?.slug !== slug);
  const dailyNews = others.filter((post) => post?.category === 'news' && !ROUNDUP_SLUG.test(post?.slug ?? ''));
  const livePosts = others.filter((post) => post?.category !== 'news' || ROUNDUP_SLUG.test(post?.slug ?? ''));
  return { livePosts, dailyNews };
}

function addReason(census, reason) {
  census.byReason[reason] = (census.byReason[reason] || 0) + 1;
}

function writtenJson(file, value, io) {
  io.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function runRoundup(args, deps = {}) {
  if (!args?.run || !args?.out || !args?.root) throw new Error('roundup requires --run, --out and --root');
  const io = deps.fs || fs;
  const root = path.resolve(args.root);
  const out = path.resolve(args.out);
  const dataDir = path.join(root, 'data');
  if (out === dataDir || out.startsWith(dataDir + path.sep)) throw new Error('roundup output may not be under data/');
  const nowMs = args.now ? Date.parse(args.now) : (deps.clock || Date.now)();
  if (!Number.isFinite(nowMs)) throw new Error('invalid --now');
  const now = new Date(nowMs).toISOString();
  const week = isoWeekOf(nowMs);
  const slug = roundupSlug(week.isoWeek);
  const postsFile = path.join(dataDir, 'posts.json');
  const posts = JSON.parse(io.readFileSync(postsFile, 'utf8'));
  if (!Array.isArray(posts)) throw new Error('posts_json_not_array');
  let { livePosts, dailyNews } = splitPosts(posts, slug);
  const discovery = (deps.loadRunArtifact || loadRunArtifact)(path.resolve(args.run));
  if (!Array.isArray(discovery.candidates)) throw new Error('candidates_json_invalid');
  const candidates = discovery.candidates.slice(0, MAX_CANDIDATES);
  const census = { candidatesSeen: discovery.candidates.length, clustersSeen: 0, sourcesSeen: 0, accepted: 0, byReason: {} };
  if (discovery.candidates.length > MAX_CANDIDATES) addReason(census, 'candidate-limit');
  const clusters = new Map();
  for (const candidate of candidates) {
    const id = String(candidate.clusterId || candidate.id || candidate.canonicalUrl || candidate.url || 'unknown');
    if (!clusters.has(id)) clusters.set(id, []);
    clusters.get(id).push(candidate);
  }
  census.clustersSeen = clusters.size;
  const budget = (deps.createRequestBudget || createRequestBudget)(MAX_REQUESTS);
  const fetchPage = async (url) => (deps.fetch || fetchWithRetry)(url, {
    budget, guardPublicHttp: true, sourceId: 'roundup-evidence', maxRetries: 1, timeoutMs: 12_000,
    dnsLookup: deps.dnsLookup,
  });
  const policy = deps.temporalWindow || temporalWindow;
  const proposed = [];
  const sourceDates = new Map();
  const sourceEvents = new Map();
  for (const members of clusters.values()) {
    const urls = new Set();
    const sources = [];
    const dated = [];
    const bodies = [];
    let eventWindow = null;
    for (const member of members.slice(0, MAX_SOURCES_PER_ITEM)) {
      const url = safeUrl(member);
      if (!url || urls.has(url)) continue;
      urls.add(url);
      census.sourcesSeen += 1;
      let fetched;
      try { fetched = await fetchPage(url); } catch { addReason(census, 'fetch-failed'); continue; }
      const evidence = buildSourceEvidence({ ...member, canonicalUrl: url }, fetched);
      if (!evidence.fetchOk || !evidence.extractionSubstantive || !evidence.bodyExcerpt) continue;
      const date = verifiedInstant(fetched.rawText);
      if (date) dated.push(date);
      sourceDates.set(url, date);
      const sourceEvent = verifiedEventWindow(fetched.rawText);
      sourceEvents.set(url, sourceEvent);
      eventWindow ||= sourceEvent;
      bodies.push(evidence.bodyExcerpt);
      sources.push({ canonicalUrl: url, publisher: evidence.publisher, publisherDomain: publisherDomain(url),
        sourceTier: member.sourceTier === 'official' ? 'official' : member.sourceTier === 'primary' ? 'primary' : member.sourceTier || 'lead',
        excerpt: evidence.bodyExcerpt, extractionSubstantive: true, extractedAt: now,
        fetchOk: true, urlUsable: true });
    }
    if (!sources.length) { addReason(census, 'weak-source'); continue; }
    const representative = members.find((member) => member.isClusterRepresentative) || members[0];
    if (members.some((member) => isDevelopmentApplication(member) || member.sourceId === 'ckan-dev-apps-lv' ||
      member.applicationNumber || RISK_CATEGORIES.has(member.category))) {
      addReason(census, 'risky');
      continue;
    }
    if (members.some((member) => member.eventStart || member.eventEnd) && !eventWindow) {
      addReason(census, 'invalid-event');
      continue;
    }
    const excerpt = sources[0].excerpt;
    const passage = excerpt.slice(0, 320).trim();
    const announcedAt = dated.length ? dated.sort()[0] : null;
    const title = String(representative.title || '').trim();
    const summary = passage;
    const item = { title, summary, location: /Liberty Village/i.test(bodies.join(' ')) ? 'Liberty Village' : '',
      actor: sources[0].publisher, category: representative.category || 'community',
      kind: representative.kind || 'update', fingerprint: String(representative.fingerprint || representative.clusterId || representative.id || sources[0].canonicalUrl),
      riskFlags: [...new Set([...detectRiskFlags({ title, snippet: [summary, ...bodies].join(' ') }),
        ...members.flatMap((member) => member.score?.riskFlags || member.riskFlags || [])])], announcedAt,
      announcedAtVerified: Boolean(announcedAt),
      claims: [{ text: passage, span: passage, sourceUrl: sources[0].canonicalUrl }], sources };
    if (eventWindow) Object.assign(item, eventWindow);
    if (RISK_CATEGORIES.has(item.category)) { addReason(census, 'risky'); continue; }
    const temporalReason = policy({ nowMs, item });
    if (temporalReason) { addReason(census, temporalReason); continue; }
    proposed.push(item);
  }
  let checked = validateRoundupPack({ items: proposed }, { weekStartUtc: week.weekStartUtc, nowMs, livePosts, dailyNews });
  for (const entry of [...checked.held, ...checked.refused, ...checked.excluded])
    for (const reason of entry.reasons) addReason(census, reason);
  const refetched = await revalidateRoundupItems(checked.accepted.map((entry) => entry.item), {
    refetch: async (url, old) => {
      const fetched = await fetchPage(url);
      if (!fetched.ok) throw new Error('refetch-failed');
      const evidence = buildSourceEvidence({ canonicalUrl: url }, fetched);
      const date = verifiedInstant(fetched.rawText);
      const event = verifiedEventWindow(fetched.rawText);
      return { ...old, excerpt: evidence.bodyExcerpt, extractionSubstantive: evidence.extractionSubstantive,
        fetchOk: evidence.fetchOk, urlUsable: evidence.urlUsable,
        riskFlags: detectRiskFlags({ snippet: evidence.bodyExcerpt }),
        ...(date !== sourceDates.get(url) ? { announcedAt: date } : {}),
        ...(JSON.stringify(event) !== JSON.stringify(sourceEvents.get(url)) ? { duplicateRelation: 'event-window-changed' } : {}) };
    },
  });
  for (const entry of refetched.excluded) addReason(census, entry.reason);
  // Re-read duplicate relationships after the second fetch, before planning.
  const currentPostsRaw = io.readFileSync(postsFile, 'utf8');
  const currentPosts = JSON.parse(currentPostsRaw);
  if (!Array.isArray(currentPosts)) throw new Error('posts_json_not_array');
  ({ livePosts, dailyNews } = splitPosts(currentPosts, slug));
  checked = validateRoundupPack({ items: refetched.accepted }, { weekStartUtc: week.weekStartUtc, nowMs, livePosts, dailyNews });
  for (const entry of [...checked.held, ...checked.refused, ...checked.excluded])
    for (const reason of entry.reasons) addReason(census, reason);
  const pack = { items: checked.accepted.map((entry) => entry.item) };
  const plan = (deps.planRoundup || planRoundup)({ ...pack, isoWeek: week.isoWeek, now }, { isoWeek: week.isoWeek,
    weekStartUtc: week.weekStartUtc, nowMs, livePosts, dailyNews });
  const zero = !plan.items?.length || plan.decision === 'missed' || plan.decision === 'hold';
  census.accepted = zero ? 0 : plan.items.length;
  const result = { isoWeek: week.isoWeek, slug, now, packDigest: roundupPackDigest(pack),
    decision: zero ? 'hold' : plan.decision, published: 0, census };
  if (zero) {
    result.hold = { terminal: false, reason: 'zero-eligible-now', census };
  }
  const image = args.image || DEFAULT_IMAGE;
  const imageExists = (asset) => /^\/images\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(asset) &&
    io.existsSync(path.join(root, 'public', asset.slice(1)));
  let post;
  if (!zero) {
    post = buildRoundupPost(plan, { image, root, imageExists });
    const errors = checkRoundupRecord({ item: { key: slug }, record: post,
      ctx: { isoWeek: week.isoWeek, weekStartUtc: week.weekStartUtc, now, items: pack.items },
      live: { posts: currentPosts }, news: { root, imageExists } });
    if (errors.length) { result.hold = { terminal: false, reason: 'submit-policy', errors }; result.published = 0; }
    else if (currentPosts.some((existing) => existing?.slug === slug)) result.hold = { terminal: true, reason: 'slug-exists' };
    else if (args.dryRun) result.hold = { terminal: false, reason: 'dry-run' };
    else result.published = 1;
  }
  io.mkdirSync(out, { recursive: true });
  writtenJson(path.join(out, 'pack.json'), pack, io);
  writtenJson(path.join(out, 'result.json'), result, io);
  if (result.published === 1) {
    const originalPosts = io.readFileSync(postsFile, 'utf8');
    if (originalPosts !== currentPostsRaw) {
      result.published = 0;
      result.hold = { terminal: false, reason: 'posts-changed-before-append' };
      writtenJson(path.join(out, 'result.json'), result, io);
      return { result, pack, post: null };
    }
    try { (deps.appendPostToPostsJson || appendPostToPostsJson)(root, post); }
    catch (error) {
      // A dependency can fail after rename. Restore only if its new last record is ours.
      const current = io.readFileSync(postsFile, 'utf8');
      if (current !== originalPosts) {
        let currentPosts;
        try { currentPosts = JSON.parse(current); } catch { currentPosts = null; }
        const basePosts = JSON.parse(originalPosts);
        if (Array.isArray(currentPosts) && currentPosts.length === basePosts.length + 1 &&
          currentPosts.at(-1)?.slug === slug &&
          JSON.stringify(currentPosts.slice(0, -1)) === JSON.stringify(basePosts)) {
          const rollback = `${postsFile}.roundup-rollback-${process.pid}-${Date.now()}`;
          io.writeFileSync(rollback, originalPosts, 'utf8');
          io.renameSync(rollback, postsFile);
        }
      }
      result.published = 0;
      result.hold = { terminal: false, reason: error.code || 'append-failed' };
      writtenJson(path.join(out, 'result.json'), result, io);
      throw error;
    }
  }
  return { result, pack, post: result.published ? post : null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseRoundupArgs(process.argv.slice(2));
    if (args.help) console.log('Usage: node scripts/news-pilot/roundup-run.mjs --run=DIR --out=DIR --root=DIR [--now=ISO] [--dry-run] [--vault=PATH] [--image=/images/...]');
    else {
      const { result } = await runRoundup(args);
      console.log(JSON.stringify(result));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
