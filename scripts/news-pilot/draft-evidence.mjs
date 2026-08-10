/**
 * Evidence-pack builder for the news drafting stage.
 * Fetches member canonical URLs and stores truncated supporting passages only.
 * LOCAL / DRAFT ONLY — never writes site content.
 */

import fs from 'node:fs';
import path from 'node:path';

import { fetchWithRetry, FETCH_DEFAULTS } from './fetch.mjs';
import {
  stripHtml,
  truncateSnippet,
  canonicalUrl,
  publisherDomain,
  parseToIsoDate,
} from './normalize.mjs';
import { detectRiskFlags } from './score.mjs';
import { isUnusableUrl } from './url-guard.mjs';

export { isUnusableUrl } from './url-guard.mjs';

export const EVIDENCE_CONFIG = Object.freeze({
  /** Max chars retained per source body sample (not full article retention). */
  maxBodyChars: 2_400,
  /** Max chars per supporting passage. */
  maxPassageChars: 320,
  /** Max passages retained per source. */
  maxPassagesPerSource: 8,
  /** Minimum stripped-text length to count as substantive extraction. */
  minSubstantiveChars: 180,
  /** Minimum passage length kept. */
  minPassageChars: 40,
  fetchTimeoutMs: FETCH_DEFAULTS.timeoutMs,
  fetchMaxRetries: 1,
  userAgent: FETCH_DEFAULTS.userAgent,
});

/**
 * Load candidates.json from a run artifact directory.
 * @param {string} runDir
 */
export function loadRunArtifact(runDir) {
  const file = path.join(runDir, 'candidates.json');
  if (!fs.existsSync(file)) {
    throw new Error(`candidates_json_missing:${file}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const candidates = Array.isArray(raw) ? raw : raw.candidates || [];
  return {
    meta: Array.isArray(raw) ? {} : raw.meta || {},
    candidates,
    representatives: Array.isArray(raw) ? null : raw.representatives || null,
    path: file,
  };
}

/**
 * Group candidates by clusterId.
 * @param {object[]} candidates
 */
export function groupByCluster(candidates) {
  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const c of candidates || []) {
    const id = c.clusterId || c.id || 'unknown';
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(c);
  }
  return map;
}

/**
 * Rank cluster representatives by score.total desc (stable by clusterId).
 * @param {object[]} candidates
 */
export function rankClusterRepresentatives(candidates) {
  const byCluster = groupByCluster(candidates);
  const reps = [];
  for (const [clusterId, members] of byCluster) {
    const marked = members.find((m) => m.isClusterRepresentative);
    const rep =
      marked ||
      [...members].sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0))[0];
    if (!rep) continue;
    reps.push({
      clusterId,
      representative: rep,
      members,
      scoreTotal: rep.score?.total || 0,
    });
  }
  reps.sort((a, b) => {
    if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
    return String(a.clusterId).localeCompare(String(b.clusterId));
  });
  return reps;
}

/**
 * Resolve an explicit human selection.
 * Requires --cluster=ID or --rank=N (1-based). Never auto-picks.
 * @param {object[]} candidates
 * @param {{ clusterId?: string|null, rank?: number|null }} selection
 */
export function resolveSelectedCluster(candidates, selection = {}) {
  const ranked = rankClusterRepresentatives(candidates);
  if (!ranked.length) {
    return { ok: false, error: 'no_clusters_in_run', ranked: [] };
  }

  const hasCluster =
    selection.clusterId != null && String(selection.clusterId).trim() !== '';
  const hasRank =
    selection.rank != null && Number.isFinite(Number(selection.rank));

  if (!hasCluster && !hasRank) {
    return {
      ok: false,
      error: 'explicit_selection_required',
      message:
        'Drafting is human-gated. Pass --cluster=<clusterId> or --rank=<1-based> explicitly. Refusing to auto-pick the top candidate.',
      rankedPreview: ranked.slice(0, 10).map((r, i) => ({
        rank: i + 1,
        clusterId: r.clusterId,
        score: r.scoreTotal,
        title: r.representative.title,
        decision: r.representative.decision || r.representative.score?.tier,
        riskFlags: r.representative.score?.riskFlags || [],
      })),
    };
  }

  if (hasCluster) {
    const id = String(selection.clusterId).trim();
    const found = ranked.find((r) => r.clusterId === id);
    if (!found) {
      return {
        ok: false,
        error: 'cluster_not_found',
        message: `No cluster "${id}" in run artifact.`,
        ranked,
      };
    }
    const rank = ranked.indexOf(found) + 1;
    return { ok: true, ...found, rank, ranked };
  }

  const rank = Number(selection.rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > ranked.length) {
    return {
      ok: false,
      error: 'rank_out_of_range',
      message: `--rank must be an integer from 1..${ranked.length}`,
      ranked,
    };
  }
  const found = ranked[rank - 1];
  return { ok: true, ...found, rank, ranked };
}

/**
 * Prefer <article>, then <main>, then body; strip chrome.
 * @param {string} html
 */
export function extractMainHtml(html) {
  const raw = String(html || '');
  const article = raw.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (article) return article[1];
  const main = raw.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main) return main[1];
  const body = raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body) return body[1];
  return raw;
}

/**
 * @param {string} html
 */
export function extractMetaPublishDate(html) {
  const raw = String(html || '');
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']datePublished["']/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const parsed = parseToIsoDate(m[1]);
    if (parsed?.iso) return parsed.iso;
  }
  return null;
}

/**
 * @param {string} html
 */
export function extractMetaPublisher(html, fallbackUrl) {
  const raw = String(html || '');
  const ogSite = raw.match(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
  );
  if (ogSite) return ogSite[1].trim();
  const app = raw.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
  );
  if (app) return app[1].trim();
  return publisherDomain(fallbackUrl) || null;
}

/**
 * Split cleaned article text into short supporting passages.
 * @param {string} text
 * @param {typeof EVIDENCE_CONFIG} [config]
 */
export function selectPassages(text, config = EVIDENCE_CONFIG) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  // Prefer sentence-ish splits; fall back to hard windows.
  const sentences = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= config.minPassageChars);

  const chunks = sentences.length ? sentences : [];
  if (!chunks.length) {
    for (let i = 0; i < cleaned.length; i += config.maxPassageChars) {
      chunks.push(cleaned.slice(i, i + config.maxPassageChars));
    }
  }

  // Score: prefer passages with concrete signals (numbers, places, named orgs).
  const scored = chunks.map((c, idx) => {
    let score = 0;
    if (/\b\d{4}\b|\b\d+\b/.test(c)) score += 2;
    if (/\b(Liberty Village|Hanna|King|Atlantic|Toronto|TTC|Metrolinx)\b/i.test(c))
      score += 2;
    if (/\b(announc|approv|propos|shortlist|clos|open|park|storey|residential)\b/i.test(c))
      score += 1;
    if (c.length > 400) score -= 1;
    return { c, score, idx };
  });
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

  const out = [];
  const seen = new Set();
  for (const item of scored) {
    if (out.length >= config.maxPassagesPerSource) break;
    const passage = truncateSnippet(item.c, config.maxPassageChars);
    const key = passage.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(passage);
  }
  return out;
}

/**
 * Build a single source evidence record from fetched HTML (or failure).
 * Pure aside from inputs — used by tests with fixtures.
 * @param {object} member candidate member
 * @param {{ ok: boolean, status?: number|null, rawText?: string, error?: string, errorCode?: string }} fetchResult
 * @param {typeof EVIDENCE_CONFIG} [config]
 */
export function buildSourceEvidence(member, fetchResult, config = EVIDENCE_CONFIG) {
  const url = member.canonicalUrl || member.url || '';
  const base = {
    candidateId: member.id || null,
    sourceId: member.sourceId || null,
    sourceTier: member.sourceTier || null,
    url,
    canonicalUrl: canonicalUrl(url) || url,
    publisherDomain: member.publisherDomain || publisherDomain(url),
    publisher: member.publisherDomain || publisherDomain(url),
    publishDate: member.publishedAt || null,
    dateConfidence: member.dateConfidence || null,
    urlUsable: member.urlUsable !== false && Boolean(url) && !isUnusableUrl(url),
    fetchOk: false,
    fetchStatus: fetchResult?.status ?? null,
    fetchError: null,
    extractionSubstantive: false,
    passages: /** @type {string[]} */ ([]),
    bodyExcerpt: '',
    supports: /** @type {string[]} */ ([]),
  };

  if (!base.urlUsable) {
    base.fetchError = 'unusable_url';
    return base;
  }
  if (!fetchResult || !fetchResult.ok) {
    base.fetchError = fetchResult?.errorCode || fetchResult?.error || 'fetch_failed';
    return base;
  }

  const html = fetchResult.rawText || '';
  const mainHtml = extractMainHtml(html);
  const text = stripHtml(mainHtml);
  const metaDate = extractMetaPublishDate(html);
  if (metaDate) base.publishDate = metaDate;
  const pub = extractMetaPublisher(html, url);
  if (pub) base.publisher = pub;

  const bodyExcerpt = truncateSnippet(text, config.maxBodyChars);
  base.bodyExcerpt = bodyExcerpt;
  base.passages = selectPassages(text, config);
  base.extractionSubstantive =
    text.replace(/\s+/g, ' ').trim().length >= config.minSubstantiveChars &&
    base.passages.length > 0;
  base.fetchOk = true;

  // Lightweight "what this source supports" labels from passage cues — not model claims.
  base.supports = inferSupportLabels(base.passages, member);
  return base;
}

/**
 * Prefer stored risk flags only when non-empty; empty arrays must not skip detection.
 * @param {object|null|undefined} member
 */
export function resolveMemberRiskFlags(member) {
  const stored = member?.score?.riskFlags;
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return detectRiskFlags(member || {});
}

/**
 * @param {string[]} passages
 * @param {object} member
 */
export function inferSupportLabels(passages, member) {
  const blob = `${member?.title || ''} ${passages.join(' ')}`;
  const labels = [];
  const checks = [
    ['location', /\b(Liberty Village|Hanna Avenue|Hanna Ave|Atlantic Avenue|\d{2,5}\s+[A-Z][a-z]+)/i],
    ['project-scope', /\b(park|tower|storey|hotel|residential|office|competition|shortlist|closure|streetcar|TTC)\b/i],
    ['size-or-count', /\b\d[\d,]*\s*(m²|m2|metres|meters|storey|storeys|teams?|units?|hours?)\b/i],
    ['actor', /\b(City of Toronto|TTC|Metrolinx|Toronto Parking Authority|council|developer)\b/i],
    ['status-or-timeline', /\b(announc\w+|approv\w+|propos\w+|shortlist\w+|under review|opens?|closes?|begins?|deadline|202\d)\b/i],
  ];
  for (const [label, re] of checks) {
    if (re.test(blob)) labels.push(label);
  }
  return labels;
}

/**
 * Fetch all cluster members and build a structured evidence pack.
 * @param {object} args
 * @param {object} args.representative
 * @param {object[]} args.members
 * @param {string} args.clusterId
 * @param {number} [args.rank]
 * @param {number} [args.nowMs]
 * @param {typeof EVIDENCE_CONFIG} [args.config]
 * @param {(url: string, opts?: object) => Promise<object>} [args.fetchFn] injectable
 */
export async function buildEvidencePack({
  representative,
  members,
  clusterId,
  rank = null,
  nowMs = Date.now(),
  config = EVIDENCE_CONFIG,
  fetchFn = fetchWithRetry,
}) {
  const uniqueMembers = dedupeMembersByUrl(members || [representative]);
  const sources = [];

  for (const member of uniqueMembers) {
    const url = member.canonicalUrl || member.url || '';
    // isUnusableUrl blocks private/loopback/link-local hosts before any fetchFn call.
    if (!url || isUnusableUrl(url) || member.urlUsable === false) {
      sources.push(
        buildSourceEvidence(member, {
          ok: false,
          error: 'unusable_url',
          errorCode: 'unusable_url',
          status: null,
          rawText: '',
        }, config),
      );
      continue;
    }
    const fetchResult = await fetchFn(url, {
      timeoutMs: config.fetchTimeoutMs,
      maxRetries: config.fetchMaxRetries,
      userAgent: config.userAgent,
      // Evidence fetches must not follow redirects onto private/loopback hosts.
      guardPublicHttp: true,
      isBlockedUrl: isUnusableUrl,
    });
    sources.push(buildSourceEvidence(member, fetchResult, config));
  }

  // Re-run risk detection across extracted article evidence, not only discovery
  // titles/snippets. A neutral headline can conceal a fatality, injury, fire,
  // allegation or other human-only subject in the article body.
  const evidenceRiskFlags = sources.flatMap((source) =>
    detectRiskFlags(
      {
        rawTextSample: [source.bodyExcerpt, ...(source.passages || [])].join(' '),
      },
      // Evidence retention is already bounded (~5 KB/source). Scan all retained
      // text so a fatality disclosed after the discovery scorer's 1,200-char
      // ranking window cannot evade the autonomous safety gate.
      { limit: Number.MAX_SAFE_INTEGER },
    ),
  );
  const riskFlags = uniqueSorted([
    ...resolveMemberRiskFlags(representative),
    ...uniqueMembers.flatMap((m) => resolveMemberRiskFlags(m)),
    ...evidenceRiskFlags,
  ]);

  const substantiveSources = sources.filter((s) => s.extractionSubstantive);
  const usableUrlSources = sources.filter((s) => s.urlUsable && s.fetchOk);

  // Corroboration counts ONLY publishers that yielded substantive extracted evidence.
  // Failed fetches / empty extractions must not inflate independentPublisherCount
  // and defeat the single_lead_consequential gate.
  const substantivePublisherCount = new Set(
    substantiveSources.map((s) => s.publisherDomain).filter(Boolean),
  ).size;

  // Flatten claim→passage index for the generator (still evidence-only).
  const claimSupport = [];
  for (const src of substantiveSources) {
    for (const passage of src.passages) {
      claimSupport.push({
        sourceUrl: src.canonicalUrl || src.url,
        publisher: src.publisher,
        publishDate: src.publishDate,
        sourceTier: src.sourceTier,
        passage,
        supports: src.supports,
      });
    }
  }

  return {
    builtAt: new Date(nowMs).toISOString(),
    clusterId,
    rank,
    title: representative?.title || '',
    decision: representative?.decision || representative?.score?.tier || null,
    coverageRelation: representative?.coverageRelation || 'new',
    relatedPostSlug: representative?.relatedPostSlug || null,
    matchingSlug: representative?.matchingSlug || null,
    independentPublisherCount: substantivePublisherCount,
    independentSourceCount: substantiveSources.length,
    sourceTiers: uniqueSorted(substantiveSources.map((s) => s.sourceTier).filter(Boolean)),
    riskFlags,
    score: representative?.score
      ? {
          total: representative.score.total,
          tier: representative.score.tier,
          breakdown: representative.score.breakdown,
        }
      : null,
    snippet: representative?.snippet || '',
    sources,
    claimSupport,
    stats: {
      memberCount: uniqueMembers.length,
      sourceRecords: sources.length,
      usableUrlFetches: usableUrlSources.length,
      substantiveExtractions: substantiveSources.length,
      failedFetches: sources.filter((s) => !s.fetchOk).length,
    },
  };
}

/**
 * @param {object[]} members
 */
export function dedupeMembersByUrl(members) {
  const out = [];
  const seen = new Set();
  for (const m of members || []) {
    const url = canonicalUrl(m.canonicalUrl || m.url || '') || m.url || m.id;
    const key = String(url || m.id || Math.random());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function uniqueSorted(arr) {
  return [...new Set(arr)].sort();
}

/**
 * Read-only site index for internal-link suggestions (never mutated).
 * @param {string} root
 */
export function loadSiteLinkIndex(root) {
  const index = {
    posts: /** @type {{slug:string,title:string,category?:string,tags?:string[]}[]} */ ([]),
    topics: /** @type {{slug:string,title?:string}[]} */ ([]),
    services: /** @type {{slug:string,name?:string}[]} */ ([]),
    businesses: /** @type {{slug:string,name?:string}[]} */ ([]),
    postSlugs: new Set(),
    topicSlugs: new Set(),
    serviceSlugs: new Set(),
    businessSlugs: new Set(),
  };

  const tryRead = (rel) => {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  };

  const posts = tryRead('data/posts.json');
  if (Array.isArray(posts)) {
    for (const p of posts) {
      if (!p?.slug) continue;
      index.posts.push({
        slug: p.slug,
        title: p.title || p.slug,
        category: p.category,
        tags: p.tags || [],
      });
      index.postSlugs.add(p.slug);
    }
  }

  const topics = tryRead('data/topics.json');
  if (Array.isArray(topics)) {
    for (const t of topics) {
      if (!t?.slug) continue;
      index.topics.push({ slug: t.slug, title: t.title || t.name || t.slug });
      index.topicSlugs.add(t.slug);
    }
  }

  const services = tryRead('data/services.json');
  if (Array.isArray(services)) {
    for (const s of services) {
      if (!s?.slug) continue;
      index.services.push({ slug: s.slug, name: s.name || s.title || s.slug });
      index.serviceSlugs.add(s.slug);
    }
  }

  const businesses = tryRead('data/businesses.json');
  if (Array.isArray(businesses)) {
    for (const b of businesses) {
      if (!b?.slug) continue;
      index.businesses.push({ slug: b.slug, name: b.name || b.slug });
      index.businessSlugs.add(b.slug);
    }
  }

  return index;
}

/**
 * Pick a small set of genuinely relevant internal link targets from the evidence text.
 * Heuristic only — generator must still only emit these slugs.
 * @param {object} evidencePack
 * @param {ReturnType<typeof loadSiteLinkIndex>} siteIndex
 * @param {number} [limit]
 */
export function suggestInternalLinks(evidencePack, siteIndex, limit = 8) {
  const blob = [
    evidencePack.title,
    evidencePack.snippet,
    ...(evidencePack.claimSupport || []).map((c) => c.passage),
  ]
    .join(' ')
    .toLowerCase();

  const scored = [];
  for (const p of siteIndex.posts) {
    let s = 0;
    const hay = `${p.slug} ${p.title} ${(p.tags || []).join(' ')}`.toLowerCase();
    for (const token of hay.split(/[^a-z0-9]+/).filter((t) => t.length > 3)) {
      if (blob.includes(token)) s += 1;
    }
    if (evidencePack.relatedPostSlug && p.slug === evidencePack.relatedPostSlug) s += 10;
    if (evidencePack.matchingSlug && p.slug === evidencePack.matchingSlug) s += 10;
    if (s > 0) scored.push({ type: 'post', slug: p.slug, title: p.title, score: s, href: `/blog/${p.slug}` });
  }
  for (const t of siteIndex.topics) {
    let s = 0;
    const hay = `${t.slug} ${t.title || ''}`.toLowerCase();
    for (const token of hay.split(/[^a-z0-9]+/).filter((x) => x.length > 3)) {
      if (blob.includes(token)) s += 1;
    }
    // light topical boosts
    if (/park|green|public realm/.test(blob) && /park|summer|family|history/.test(hay)) s += 2;
    if (/transit|ttc|streetcar|traffic|road/.test(blob) && /transit|traffic|parking|bike/.test(hay))
      s += 2;
    if (/develop|tower|storey|housing|condo/.test(blob) && /history|community|parking/.test(hay))
      s += 1;
    if (s > 0)
      scored.push({ type: 'guide', slug: t.slug, title: t.title, score: s, href: `/guide/${t.slug}` });
  }
  for (const svc of siteIndex.services) {
    let s = 0;
    const hay = `${svc.slug} ${svc.name || ''}`.toLowerCase();
    if (/restaurant|food|brewery|dining|cafe|coffee/.test(blob) && /restaurant|bar|coffee|brunch|patio/.test(hay))
      s += 2;
    if (s > 0)
      scored.push({
        type: 'service',
        slug: svc.slug,
        title: svc.name,
        score: s,
        href: `/best/${svc.slug}`,
      });
  }

  scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  const out = [];
  const seen = new Set();
  for (const item of scored) {
    if (out.length >= limit) break;
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    out.push(item);
  }
  return out;
}
