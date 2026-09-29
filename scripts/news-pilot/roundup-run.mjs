#!/usr/bin/env node
/** Verify discovery clusters, then append at most one weekly news post. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRunArtifact, buildSourceEvidence, extractMainHtml, extractMetaPublishDate } from './draft-evidence.mjs';
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
const RISK_CATEGORIES = new Set(['crime', 'safety', 'civic-controversy', 'election', 'development-application']);
const DAY_MS = 86_400_000;
const torontoFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric',
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

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

function torontoInstant(local) {
  const match = String(local || '').match(/^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?$/);
  if (!match) return null;
  const wanted = match.slice(1).map((value, index) => Number(value ?? (index < 3 ? 0 : 0)));
  const naive = Date.UTC(wanted[0], wanted[1] - 1, wanted[2], wanted[3] || 0, wanted[4] || 0, wanted[5] || 0);
  for (const offsetHours of [4, 5]) {
    const instant = naive + offsetHours * 3_600_000;
    const parts = Object.fromEntries(torontoFormatter.formatToParts(instant).filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]));
    if ([parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second]
      .every((value, index) => value === (wanted[index] || 0))) return instant;
  }
  return null;
}

/** Single writer-owned date policy; shared validation still independently gates append. */
export function temporalWindow({ nowMs, item }) {
  if (!Number.isFinite(nowMs)) throw new Error('temporal policy requires nowMs');
  if (item?.eventEnd && Date.parse(item.eventEnd) <= nowMs) return { category: null, reason: 'concluded' };
  let start = null;
  let dateOnlyEnd = null;
  if (item?.eventStartVerified === true) {
    if (item.eventStartDate) {
      start = torontoInstant(item.eventStartDate);
      const next = new Date(Date.parse(`${item.eventStartDate}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
      dateOnlyEnd = torontoInstant(next);
    } else if (item.eventStart) start = Date.parse(item.eventStart);
  }
  if (start !== null && (!Number.isFinite(start) || start <= nowMs)) return { category: null, reason: 'concluded' };
  const announced = item?.announcedAtVerified && item.announcedAt ? Date.parse(item.announcedAt) : NaN;
  if (Number.isFinite(announced) && announced >= nowMs - 7 * DAY_MS && announced <= nowMs)
    return { category: 'news-update', reason: null, evidence: { announcedAt: item.announcedAt } };
  if (start !== null && Number.isFinite(start) && start > nowMs && start < nowMs + 14 * DAY_MS &&
    (dateOnlyEnd === null || (Number.isFinite(dateOnlyEnd) && dateOnlyEnd <= nowMs + 14 * DAY_MS)))
    return { category: 'upcoming-event', reason: null, evidence: item.eventStartDate
      ? { eventStartDate: item.eventStartDate, timezone: 'America/Toronto' } : { eventStart: item.eventStart } };
  return { category: null, reason: Number.isFinite(announced) || start !== null ? 'stale' : 'undated' };
}

function matchingSpan(excerpt, rawDate) {
  const raw = String(rawDate || '');
  const date = raw.slice(0, 10);
  const parsed = Date.parse(`${date}T12:00:00Z`);
  const options = Number.isFinite(parsed) ? [
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(parsed),
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(parsed),
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(parsed).replace(/^Sep /, 'Sept. '),
  ] : [];
  const found = [raw, date, ...options].find((value) => value && String(excerpt).includes(value));
  if (!found) return null;
  const sentence = String(excerpt).split(/(?<=[.!?])\s+(?=[A-Z])/)
    .find((value) => value.includes(found) && value.trim().length <= 320);
  return sentence?.trim() || null;
}

function verifiedInstant(html, excerpt, title) {
  const raw = String(html || '');
  const values = [];
  for (const tag of raw.match(/<meta\b[^>]*>/gi) || []) {
    if (!/(?:article:published_time|datePublished)/i.test(tag) || /dateModified/i.test(tag)) continue;
    const match = tag.match(/content\s*=\s*["']([^"']+)["']/i);
    if (match) values.push(match[1]);
  }
  for (const match of raw.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (value) => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') {
          const type = String(value['@type'] || '').toLowerCase();
          const headline = String(value.headline || '').toLowerCase();
          const expected = String(title || '').toLowerCase();
          if (/(?:newsarticle|article)/.test(type) && headline && expected &&
            (headline.includes(expected) || expected.includes(headline)) && typeof value.datePublished === 'string')
            values.push(value.datePublished);
          Object.values(value).forEach(walk);
        }
      };
      walk(JSON.parse(match[1]));
    } catch { /* malformed structured data is not date evidence */ }
  }
  const main = extractMainHtml(raw);
  for (const tag of main.match(/<time\b[^>]*>/gi) || []) {
    const match = tag.match(/datetime\s*=\s*["']([^"']+)["']/i);
    if (match) values.push(match[1]);
  }
  for (const value of values) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)$/i.test(value)) continue;
    const iso = extractMetaPublishDate(`<time datetime="${value}"></time>`);
    const span = matchingSpan(excerpt, value);
    if (iso && span && Number.isFinite(Date.parse(iso))) return { iso, span };
  }
  return null;
}

function verifiedEventWindow(html, excerpt, title) {
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
        const eventName = String(value.name || '').trim().toLowerCase();
        const expected = String(title || '').trim().toLowerCase();
        const venue = typeof value.location === 'string' ? value.location :
          [value.location?.name, value.location?.address?.streetAddress, value.location?.address?.addressLocality].filter(Boolean).join(' ');
        if (!eventName || !expected || !(eventName.includes(expected) || expected.includes(eventName)) ||
          !/Liberty Village/i.test(venue) || !/Liberty Village/i.test(excerpt)) continue;
        const rawStart = value.startDate;
        if (typeof rawStart !== 'string') continue;
        const span = matchingSpan(excerpt, rawStart);
        if (!span) continue;
        let start;
        if (/^\d{4}-\d\d-\d\d$/.test(rawStart)) start = { eventStartDate: rawStart };
        else if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(rawStart)) {
          const instant = torontoInstant(rawStart);
          if (instant !== null) start = { eventStart: new Date(instant).toISOString() };
        } else if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(rawStart) &&
          Number.isFinite(Date.parse(rawStart))) start = { eventStart: new Date(rawStart).toISOString() };
        if (!start) continue;
        const rawEnd = value.endDate;
        let eventEnd;
        if (typeof rawEnd === 'string') {
          if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(rawEnd)) {
            const instant = torontoInstant(rawEnd);
            if (instant !== null) eventEnd = new Date(instant).toISOString();
          } else if (Number.isFinite(Date.parse(rawEnd)) && rawEnd.includes('T') && /(?:Z|[+-]\d\d:\d\d)$/.test(rawEnd))
            eventEnd = new Date(rawEnd).toISOString();
        }
        return { ...start, ...(eventEnd ? { eventEnd } : {}), eventStartSpan: span, location: venue };
      }
    } catch { /* malformed structured data cannot prove an event window */ }
  }
  return null;
}

function wholeSentence(excerpt, title = '') {
  const clean = String(excerpt || '').trim();
  const withoutHeading = title && clean.toLowerCase().startsWith(title.toLowerCase())
    ? clean.slice(title.length).trim() : clean;
  return withoutHeading.split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim()).find((sentence) => sentence.length >= 40 && sentence.length <= 320) || null;
}

function actorFromPassage(passage, candidateActor) {
  if (candidateActor && passage.includes(candidateActor)) return candidateActor;
  const match = passage.match(/^(.{3,100}?)\s+(?:reported|announced|scheduled|published|opened|confirmed)\b/i);
  return match?.[1]?.trim() || '';
}

const CONTEXT_PHRASES = Object.freeze({
  closure: 'Residents and visitors planning trips through the area may want to check the source for details.',
  community: 'Residents planning to attend may want to check the source for details.',
  transit: 'Residents and visitors planning trips may want to check the source for details.',
});

function localDate(instant) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric',
    month: 'long', day: 'numeric' }).format(Date.parse(instant));
}

export function contextParagraph(item, category) {
  const sourceUrl = category === 'news-update' ? item.announcedAtSourceUrl : item.eventStartSourceUrl;
  const publisher = item.sources.find((source) => source.canonicalUrl === sourceUrl)?.publisher;
  const where = item.location;
  if (category === 'news-update')
    return `${publisher} published this update on ${localDate(item.announcedAt)}. It concerns ${item.actor} in ${where}.`;
  const when = item.eventStartDate ? `${item.eventStartDate} (America/Toronto local date)` :
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(Date.parse(item.eventStart));
  return `According to ${publisher}, it is scheduled for ${when} at ${where}.` +
    (CONTEXT_PHRASES[item.category] ? ` ${CONTEXT_PHRASES[item.category]}` : '');
}

function addContextParagraphs(post, items, categories) {
  const sections = post.content.split(/(?=^##\s+\d+\.\s+)/m);
  if (sections.length !== items.length) throw new Error('roundup_section_count_mismatch');
  return { ...post, content: sections.map((section, index) => {
    const newline = section.indexOf('\n');
    return `${section.slice(0, newline)}\n\n${contextParagraph(items[index], categories[index])}${section.slice(newline)}`;
  }).join('') };
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

function retainSafeItems(items, checked, census, categoryByFingerprint) {
  const kept = new Set(checked.accepted.map((entry) => entry.item));
  for (const entry of [...checked.held, ...checked.refused, ...checked.excluded]) {
    if (categoryByFingerprint.has(entry.item?.fingerprint) && entry.reasons.length &&
      entry.reasons.every((reason) => reason === 'stale' || reason === 'undated')) {
      kept.add(entry.item);
      continue;
    }
    for (const reason of entry.reasons) addReason(census, reason);
  }
  return items.filter((item) => kept.has(item));
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
  const categoryByFingerprint = new Map();
  const sourceDates = new Map();
  const sourceEvents = new Map();
  const sourceTitles = new Map();
  const temporalCategories = { 'news-update': 0, 'upcoming-event': 0 };
  for (const members of clusters.values()) {
    const representative = members.find((member) => member.isClusterRepresentative) || members[0];
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
      const date = verifiedInstant(fetched.rawText, evidence.bodyExcerpt, representative.title);
      sourceTitles.set(url, representative.title);
      if (date) dated.push({ ...date, sourceUrl: url });
      sourceDates.set(url, date);
      const sourceEvent = verifiedEventWindow(fetched.rawText, evidence.bodyExcerpt, representative.title);
      sourceEvents.set(url, sourceEvent);
      eventWindow ||= sourceEvent ? { ...sourceEvent, eventStartSourceUrl: url } : null;
      bodies.push(evidence.bodyExcerpt);
      sources.push({ canonicalUrl: url, publisher: evidence.publisher, publisherDomain: publisherDomain(url),
        sourceTier: member.sourceTier === 'official' ? 'official' : member.sourceTier === 'primary' ? 'primary' : member.sourceTier || 'lead',
        excerpt: evidence.bodyExcerpt, extractionSubstantive: true, extractedAt: now,
        fetchOk: true, urlUsable: true });
    }
    if (!sources.length) { addReason(census, 'weak-source'); continue; }
    if (members.some((member) => isDevelopmentApplication(member) || member.sourceId === 'ckan-dev-apps-lv' ||
      member.applicationNumber || RISK_CATEGORIES.has(member.category))) {
      addReason(census, 'risky');
      continue;
    }
    if (members.some((member) => member.eventStart || member.eventStartDate || member.eventEnd) && !eventWindow) {
      addReason(census, 'invalid-event');
      continue;
    }
    const excerpt = sources[0].excerpt;
    const passage = wholeSentence(excerpt, representative.title);
    if (!passage) { addReason(census, 'weak-source'); continue; }
    const announced = dated.length ? dated.sort((a, b) => Date.parse(b.iso) - Date.parse(a.iso))[0] : null;
    const title = String(representative.title || '').trim();
    const summary = passage;
    const item = { title, summary, location: /Liberty Village/i.test(bodies.join(' ')) ? 'Liberty Village' : '',
      actor: actorFromPassage(passage, representative.actor), category: representative.category || 'community',
      kind: representative.kind || 'update', fingerprint: String(representative.fingerprint || representative.clusterId || representative.id || sources[0].canonicalUrl),
      riskFlags: [...new Set([...detectRiskFlags({ title, snippet: [summary, ...bodies].join(' ') }),
        ...members.flatMap((member) => member.score?.riskFlags || member.riskFlags || [])])],
      announcedAt: announced?.iso || null, announcedAtVerified: Boolean(announced),
      ...(announced ? { announcedAtSourceUrl: announced.sourceUrl, announcedAtSpan: announced.span } : {}),
      claims: [], sources };
    if (eventWindow) Object.assign(item, { ...eventWindow, eventStartVerified: true });
    if (RISK_CATEGORIES.has(item.category)) { addReason(census, 'risky'); continue; }
    const temporal = policy({ nowMs, item });
    if (temporal.reason) { addReason(census, temporal.reason); continue; }
    temporalCategories[temporal.category] = (temporalCategories[temporal.category] || 0) + 1;
    categoryByFingerprint.set(item.fingerprint, temporal.category);
    const provenanceUrl = temporal.category === 'news-update' ? item.announcedAtSourceUrl : item.eventStartSourceUrl;
    const supportingSource = sources.find((source) => source.canonicalUrl === provenanceUrl);
    const supportingSpan = wholeSentence(supportingSource?.excerpt, representative.title);
    if (!supportingSpan) { addReason(census, 'weak-source'); continue; }
    const actualDate = temporal.category === 'news-update' ? item.announcedAt.slice(0, 10) :
      item.eventStartDate || item.eventStart.slice(0, 10);
    const claimText = temporal.category === 'news-update'
      ? `${supportingSource.publisher} published this update on ${actualDate}: "${supportingSpan}"`
      : `${supportingSource.publisher} lists the event for ${actualDate}: "${supportingSpan}"`;
    item.claims = [{ text: claimText, span: supportingSpan, sourceUrl: provenanceUrl }];
    proposed.push(item);
  }
  let checked = validateRoundupPack({ items: proposed }, { weekStartUtc: week.weekStartUtc, nowMs, livePosts, dailyNews });
  const initiallySafe = retainSafeItems(proposed, checked, census, categoryByFingerprint);
  const refetched = await revalidateRoundupItems(initiallySafe, {
    refetch: async (url, old) => {
      const fetched = await fetchPage(url);
      if (!fetched.ok) throw new Error('refetch-failed');
      const evidence = buildSourceEvidence({ canonicalUrl: url }, fetched);
      const date = verifiedInstant(fetched.rawText, evidence.bodyExcerpt, sourceTitles.get(url));
      const event = verifiedEventWindow(fetched.rawText, evidence.bodyExcerpt, sourceTitles.get(url));
      return { ...old, excerpt: evidence.bodyExcerpt, extractionSubstantive: evidence.extractionSubstantive,
        fetchOk: evidence.fetchOk, urlUsable: evidence.urlUsable,
        riskFlags: detectRiskFlags({ snippet: evidence.bodyExcerpt }),
        ...(JSON.stringify(date) !== JSON.stringify(sourceDates.get(url)) ? { announcedAt: date?.iso || null } : {}),
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
  const pack = { items: retainSafeItems(refetched.accepted, checked, census, categoryByFingerprint) };
  const plan = (deps.planRoundup || planRoundup)({ ...pack, isoWeek: week.isoWeek, now }, { isoWeek: week.isoWeek,
    weekStartUtc: week.weekStartUtc, nowMs, livePosts, dailyNews });
  const zero = pack.items.length === 0;
  const sharedRejected = !zero && (plan.items?.length !== pack.items.length || plan.decision === 'missed' || plan.decision === 'hold');
  census.accepted = pack.items.length;
  census.temporalCategories = Object.fromEntries(Object.keys(temporalCategories)
    .map((category) => [category, pack.items.filter((item) => categoryByFingerprint.get(item.fingerprint) === category).length]));
  const result = { isoWeek: week.isoWeek, slug, now, packDigest: roundupPackDigest(pack),
    decision: zero || sharedRejected ? 'hold' : plan.decision, published: 0, census };
  if (zero) {
    result.hold = { terminal: false, reason: 'zero-eligible-now', census };
  }
  const image = args.image || DEFAULT_IMAGE;
  const imageExists = (asset) => /^\/images\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(asset) &&
    io.existsSync(path.join(root, 'public', asset.slice(1)));
  let post;
  if (!zero) {
    const draftPlan = sharedRejected ? { decision: pack.items.length >= 2 ? 'roundup' : 'single-update',
      items: pack.items, slug, isoWeek: week.isoWeek, now } : plan;
    post = buildRoundupPost(draftPlan, { image, root, imageExists });
    post = addContextParagraphs(post, pack.items, pack.items.map((item) => categoryByFingerprint.get(item.fingerprint)));
    const errors = checkRoundupRecord({ item: { key: slug }, record: post,
      ctx: { isoWeek: week.isoWeek, weekStartUtc: week.weekStartUtc, now, items: pack.items },
      live: { posts: currentPosts }, news: { root, imageExists } });
    if (currentPosts.some((existing) => existing?.slug === slug)) result.hold = { terminal: true, reason: 'slug-exists' };
    else if (errors.length || sharedRejected) { result.decision = 'hold';
      result.hold = { terminal: false, reason: sharedRejected ? 'shared-temporal-policy' : 'submit-policy', errors }; }
    else if (args.dryRun) result.hold = { terminal: false, reason: 'dry-run' };
    else result.hold = { terminal: false, reason: 'pending-append' };
  }
  io.mkdirSync(out, { recursive: true });
  writtenJson(path.join(out, 'pack.json'), pack, io);
  writtenJson(path.join(out, 'result.json'), result, io);
  if (result.hold?.reason === 'pending-append') {
    const originalPosts = io.readFileSync(postsFile, 'utf8');
    if (originalPosts !== currentPostsRaw) {
      result.published = 0;
      result.hold = { terminal: false, reason: 'posts-changed-before-append' };
      writtenJson(path.join(out, 'result.json'), result, io);
      return { result, pack, post: null };
    }
    try {
      (deps.appendPostToPostsJson || appendPostToPostsJson)(root, post);
      result.published = 1;
      delete result.hold;
      writtenJson(path.join(out, 'result.json'), result, io);
    }
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
