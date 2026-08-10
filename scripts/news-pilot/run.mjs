#!/usr/bin/env node
/**
 * Liberty Village hyperlocal news discovery pilot — local shadow-mode runner.
 *
 * NEVER writes to data/posts.json or site content.
 * NEVER publishes. --dry-run defaults true (network still allowed).
 *
 * Usage:
 *   node scripts/news-pilot/run.mjs
 *   node scripts/news-pilot/run.mjs --since-hours=168 --out=.news-pilot/runs/custom
 *   node scripts/news-pilot/run.mjs --max-sources=5
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listEnabledSources } from './sources.mjs';
import {
  createRequestBudget,
  fetchSource,
  parseVaultEnvText,
  FETCH_DEFAULTS,
} from './fetch.mjs';
import { normalizeSourceResult } from './normalize.mjs';
import { scoreCandidate, reviewRankMetric, SCORE_CONFIG } from './score.mjs';
import { dedupeAndMarkCovered, extractPostIndex } from './dedupe.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/**
 * Run-level gates that are not scoring weights.
 * Kept here so age-window policy is documented in one place.
 */
export const RUN_CONFIG = Object.freeze({
  /**
   * Production default discovery horizon (hours) when --since-hours is omitted.
   *
   * Intent: a short ops window (e.g. 720h / 30d) is fine for breaking-news
   * checks, but it structurally hides slow civic/development stories such as
   * multi-month park design competitions. Scoring already contemplates a long
   * tail via SCORE_CONFIG.freshnessMaxAgeHours (2160h); the run window should
   * not be the tighter bottleneck by default.
   *
   * 8760h = 365 days. Older items still enter scoring, then:
   *   - freshness decay + reviewRankMetric rank them BELOW current news
   *   - detectConcludedTimeBoundEvent still rejects stale fixture previews
   * Override: --since-hours=720 (comparability) or any finite N.
   */
  defaultSinceHours: 8760,
  /**
   * Approximate dates get a generous but FINITE multiple of --since-hours.
   * They previously bypassed the window entirely (unconditional pass).
   */
  approximateSinceHoursMultiplier: 1.5,
  /**
   * Unknown / missing publishedAt: KEEP the candidate.
   * We cannot prove age either way; dropping them silently hid official
   * undated notices. Downstream freshness stays neutral (unknownFreshness).
   */
  keepUnknownDates: true,
});

/** Vault path from env or explicit --vault only — no personal-path fallback. */
const DEFAULT_VAULT = process.env.PI_TOOL_VAULT_PATH || null;

function parseArgs(argv) {
  const out = {
    dryRun: true,
    maxSources: null,
    // null here means "caller did not pass --since-hours"; runPilot applies
    // RUN_CONFIG.defaultSinceHours. Explicit --since-hours=N always wins.
    sinceHours: null,
    sinceHoursExplicit: false,
    out: null,
    vault: DEFAULT_VAULT,
  };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-dry-run') out.dryRun = false;
    else if (a.startsWith('--max-sources=')) out.maxSources = Number(a.split('=')[1]);
    else if (a.startsWith('--since-hours=')) {
      out.sinceHours = Number(a.split('=')[1]);
      out.sinceHoursExplicit = true;
    } else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else if (a.startsWith('--vault=')) out.vault = a.slice('--vault='.length);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function loadSecrets(vaultPath) {
  const secrets = {
    SERPER_API_KEY: process.env.SERPER_API_KEY || '',
    SERPAPI_API_KEY: process.env.SERPAPI_API_KEY || '',
  };
  if (vaultPath && fs.existsSync(vaultPath)) {
    try {
      const parsed = parseVaultEnvText(fs.readFileSync(vaultPath, 'utf8'));
      if (!secrets.SERPER_API_KEY && parsed.SERPER_API_KEY) {
        secrets.SERPER_API_KEY = parsed.SERPER_API_KEY;
      }
      if (!secrets.SERPAPI_API_KEY && parsed.SERPAPI_API_KEY) {
        secrets.SERPAPI_API_KEY = parsed.SERPAPI_API_KEY;
      }
    } catch {
      // vault optional if env already set
    }
  }
  return secrets;
}

function readPostsIndex(root = ROOT) {
  const p = path.join(root, 'data', 'posts.json');
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return extractPostIndex(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Age-window gate for --since-hours.
 * - exact dates: strict window
 * - approximate dates: generous finite multiple (not unlimited)
 * - unknown / missing dates: kept on purpose (see RUN_CONFIG.keepUnknownDates)
 * @param {object} candidate
 * @param {number} sinceHours
 * @param {number} nowMs
 * @param {typeof RUN_CONFIG} [config]
 */
export function withinSince(candidate, sinceHours, nowMs, config = RUN_CONFIG) {
  if (sinceHours == null || !Number.isFinite(sinceHours)) return true;
  const confidence = candidate.dateConfidence || (candidate.publishedAt ? 'exact' : 'unknown');

  // Development applications are inherently weeks old — exempt from the window.
  if (
    candidate.applicationNumber ||
    String(candidate.sourceId || '').startsWith('ckan-dev-apps') ||
    /\bdevelopment application\b/i.test(candidate.title || '')
  ) {
    return true;
  }

  // Unknown / missing / unparseable: keep. Age is unprovable; do not silent-drop.
  if (!candidate.publishedAt || confidence === 'unknown') {
    return config.keepUnknownDates !== false;
  }

  const t = Date.parse(candidate.publishedAt);
  if (Number.isNaN(t)) return config.keepUnknownDates !== false;

  const ageH = (nowMs - t) / 3_600_000;
  if (confidence === 'approximate') {
    const mult = config.approximateSinceHoursMultiplier ?? 1.5;
    return ageH <= sinceHours * mult;
  }
  // exact (and any other concrete confidence)
  return ageH <= sinceHours;
}

/** @param {object} candidate */
function isMunicipalProjectCandidate(candidate) {
  const labels = candidate?.score?.municipalProjectLabels;
  if (Array.isArray(labels) && labels.length > 0) return true;
  // Fallback if score blob missing labels but reasons recorded the hold.
  const reasons = candidate?.decisionReasons || candidate?.score?.reasons || [];
  return reasons.some((r) => /municipal project/i.test(String(r)));
}

/**
 * Decision-tier order, then freshness-aware metric (not raw total alone).
 * Municipal facility/project pages always sort to the BOTTOM of the review
 * band so dated news outranks them regardless of residual score noise.
 */
export function compareCandidatesForReview(a, b, config = SCORE_CONFIG) {
  const order = { 'auto-eligible': 0, review: 1, reject: 2 };
  const d = (order[a.decision] ?? 9) - (order[b.decision] ?? 9);
  if (d !== 0) return d;
  const aMuni = isMunicipalProjectCandidate(a);
  const bMuni = isMunicipalProjectCandidate(b);
  if (aMuni !== bMuni) return aMuni ? 1 : -1;
  const rb = reviewRankMetric(b.score, config);
  const ra = reviewRankMetric(a.score, config);
  if (rb !== ra) return rb - ra;
  return (b.score?.total || 0) - (a.score?.total || 0);
}

function redactSecrets(value, secrets) {
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  for (const key of Object.values(secrets)) {
    if (key && key.length >= 8) {
      const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      s = s.replace(re, '[REDACTED]');
    }
  }
  // belt-and-suspenders for query param leaks
  s = s.replace(/api_key=[^&\s"']+/gi, 'api_key=[REDACTED]');
  s = s.replace(/X-API-KEY["'\s:]+[^"'\s,]+/gi, 'X-API-KEY:[REDACTED]');
  return s;
}

/**
 * Final decision. Duplicates hard-reject. Follow-ups never auto-publish —
 * they route to review with the linked prior slug for later cross-link/update.
 * @param {object} scored
 * @param {{ coverageRelation?: string, alreadyCovered?: boolean, matchingSlug?: string|null, coverageReason?: string|null }} coverage
 */
export function decideFinal(scored, coverage = {}) {
  const relation =
    coverage.coverageRelation ||
    (coverage.alreadyCovered ? 'duplicate' : 'new');
  const via = coverage.matchSource ? ` via ${coverage.matchSource}` : '';

  if (relation === 'duplicate' || coverage.alreadyCovered) {
    return {
      decision: 'reject',
      decisionReasons: [
        coverage.coverageReason ||
          `duplicate of published post${coverage.matchingSlug ? ` (${coverage.matchingSlug})` : ''}${via}`,
      ],
    };
  }

  if (relation === 'follow-up') {
    // Preserve hard rejects (local gate / low total). Never promote to auto-eligible.
    if (scored.tier === 'reject') {
      return {
        decision: 'reject',
        decisionReasons: scored.reasons,
      };
    }
    return {
      decision: 'review',
      decisionReasons: [
        coverage.coverageReason ||
          `follow-up to ${coverage.matchingSlug || 'prior post'}${via} (not auto-eligible)`,
        ...scored.reasons,
      ],
    };
  }

  return {
    decision: scored.tier,
    decisionReasons: scored.reasons,
  };
}

function buildReport({
  meta,
  candidates,
  errors,
  sourceStats,
  config = SCORE_CONFIG,
}) {
  const byDecision = { 'auto-eligible': 0, review: 0, reject: 0 };
  for (const c of candidates) {
    byDecision[c.decision] = (byDecision[c.decision] || 0) + 1;
  }
  const wouldPublish = byDecision['auto-eligible'] || 0;

  const lines = [];
  lines.push('# News discovery pilot report');
  lines.push('');
  lines.push('## Run metadata');
  lines.push('');
  lines.push(`- startedAt: ${meta.startedAt}`);
  lines.push(`- finishedAt: ${meta.finishedAt}`);
  lines.push(`- dryRun: ${meta.dryRun}`);
  lines.push(`- sinceHours: ${meta.sinceHours ?? 'all'}`);
  lines.push(`- maxSources: ${meta.maxSources ?? 'all-enabled'}`);
  lines.push(`- sourcesAttempted: ${meta.sourcesAttempted}`);
  lines.push(`- sourcesOk: ${meta.sourcesOk}`);
  lines.push(`- sourcesFailed: ${meta.sourcesFailed}`);
  lines.push(`- requestCount: ${meta.requestCount}`);
  lines.push(`- candidateCount: ${candidates.length}`);
  lines.push('');
  lines.push('## Counts by decision tier');
  lines.push('');
  lines.push(`- auto-eligible: ${byDecision['auto-eligible'] || 0}`);
  lines.push(`- review: ${byDecision.review || 0}`);
  lines.push(`- reject: ${byDecision.reject || 0}`);
  lines.push('');
  lines.push(`**would have published: ${wouldPublish}**`);
  lines.push('');
  lines.push('## Source results');
  lines.push('');
  for (const s of sourceStats) {
    const status = s.ok ? 'ok' : `FAIL (${s.error || s.errorCode || 'error'})`;
    lines.push(
      `- ${s.id}: ${status}; candidates=${s.candidateCount}; attempts=${s.attempts ?? '-'}`,
    );
  }
  lines.push('');
  lines.push('## Top candidates');
  lines.push('');

  const ranked = [...candidates].sort((a, b) => compareCandidatesForReview(a, b));

  const top = ranked.slice(0, 25);
  if (!top.length) {
    lines.push('_No candidates produced._');
  }
  for (const [i, c] of top.entries()) {
    lines.push(`### ${i + 1}. ${c.title}`);
    lines.push('');
    lines.push(`- decision: **${c.decision}**`);
    lines.push(
      `- rank: ${reviewRankMetric(c.score, config).toFixed(4)} (freshness-aware; this orders the list)`,
    );
    lines.push(`- score.total: ${c.score?.total}`);
    lines.push(
      `- breakdown: local=${c.score?.breakdown?.localRelevance}, notability=${c.score?.breakdown?.notability}, evidence=${c.score?.breakdown?.evidence}, freshness=${c.score?.breakdown?.freshness}`,
    );
    lines.push(`- riskFlags: ${c.score?.riskFlags?.length ? c.score.riskFlags.join(', ') : '(none)'}`);
    lines.push(`- source: ${c.sourceId} (${c.sourceTier})`);
    lines.push(
      `- cluster: ${c.clusterId} (publishers=${c.independentPublisherCount || c.independentSourceCount})`,
    );
    lines.push(`- url: ${c.url || c.canonicalUrl || ''}`);
    lines.push(`- urlUsable: ${c.urlUsable !== false}`);
    lines.push(`- publishedAt: ${c.publishedAt || 'unknown'} (${c.dateConfidence || 'unknown'})`);
    if (c.coverageRelation && c.coverageRelation !== 'new') {
      const src = c.matchSource ? `; matchSource=${c.matchSource}` : '';
      lines.push(
        `- coverage: **${c.coverageRelation}** → ${c.relatedPostSlug || c.matchingSlug || ''} (${c.coverageReason || ''}${src})`,
      );
    } else if (c.alreadyCovered) {
      const src = c.matchSource ? `; matchSource=${c.matchSource}` : '';
      lines.push(
        `- alreadyCovered: ${c.matchingSlug || ''} (${c.coverageReason || ''}${src})`,
      );
    }
    const why =
      c.decision === 'auto-eligible'
        ? 'why-accepted'
        : c.decision === 'review'
          ? 'why-review'
          : 'why-rejected';
    lines.push(`- ${why}: ${(c.decisionReasons || []).slice(0, 8).join('; ')}`);
    lines.push('');
  }

  if (errors.length) {
    lines.push('## Errors');
    lines.push('');
    for (const e of errors) {
      lines.push(`- ${e.sourceId}: ${e.error || e.errorCode || 'error'}`);
    }
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  lines.push('- Shadow-mode only. Nothing was published.');
  lines.push('- data/posts.json was read-only for alreadyCovered checks.');
  lines.push('- Zero auto-eligible candidates is a valid successful outcome.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Resolve and validate the run output directory BEFORE any mkdir.
 * Refuses paths under data/ so --out=data/x cannot create site content dirs.
 * @param {string} root
 * @param {string|null|undefined} explicit
 * @param {string} stamp
 */
export function ensureRunOutDir(root, explicit, stamp) {
  const dir =
    explicit ||
    path.join(root, '.news-pilot', 'runs', stamp);
  const resolved = path.resolve(dir);
  const dataDir = path.resolve(root, 'data');
  if (resolved === dataDir || resolved.startsWith(dataDir + path.sep)) {
    throw new Error('refusing_to_write_under_data/');
  }
  const postsPath = path.resolve(root, 'data', 'posts.json');
  if (resolved === postsPath) {
    throw new Error('refusing_to_write_posts_json');
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

/**
 * Reserve request budget per source before the fetch loop.
 * CKAN is capped so Serper/SerpApi retain capacity.
 * @param {ReturnType<typeof createRequestBudget>} budget
 * @param {object[]} sources
 */
export function reserveSourceBudgets(budget, sources) {
  if (!budget || typeof budget.reserve !== 'function') return;
  const list = (Array.isArray(sources) ? sources : []).filter((s) => s?.id);
  const maxRetries = FETCH_DEFAULTS.maxRetries;
  const perAttempt = maxRetries + 1;
  const ckanCap = Math.max(
    1,
    Number(FETCH_DEFAULTS.ckanMaxRequestsPerRun) ||
      Math.floor(FETCH_DEFAULTS.maxRequestsPerRun * 0.4),
  );

  // Reserve non-CKAN sources first so search APIs cannot be starved by fanout.
  for (const source of list) {
    if (source.ckan) continue;
    budget.reserve(source.id, perAttempt);
  }
  for (const source of list) {
    if (!source.ckan) continue;
    const cfg = source.ckan;
    const jobs =
      (cfg.streetNames?.length || 0) + (cfg.postalPrefixes?.length || 0);
    const worst = Math.max(perAttempt, jobs * perAttempt);
    budget.reserve(source.id, Math.min(worst, ckanCap));
  }
}

export async function runPilot(options = {}) {
  const sinceHoursResolved =
    options.sinceHours !== undefined && options.sinceHours !== null
      ? options.sinceHours
      : RUN_CONFIG.defaultSinceHours;
  const args = {
    dryRun: options.dryRun !== false,
    maxSources: options.maxSources ?? null,
    sinceHours: sinceHoursResolved,
    out: options.out ?? null,
    vault: options.vault ?? DEFAULT_VAULT,
    root: options.root ?? ROOT,
  };

  const startedAt = new Date().toISOString();
  const nowMs = options.nowMs ?? Date.now();
  const secrets = loadSecrets(args.vault);
  const sources = listEnabledSources({ maxSources: args.maxSources });
  const budget = createRequestBudget(FETCH_DEFAULTS.maxRequestsPerRun);
  // Per-source reservations so CKAN fanout cannot starve later search sources.
  reserveSourceBudgets(budget, sources);

  const published = readPostsIndex(args.root);

  const errors = [];
  const sourceStats = [];
  /** @type {object[]} */
  let rawCandidates = [];

  for (const source of sources) {
    const result = await fetchSource(source, { secrets, budget });
    if (!result.ok) {
      errors.push({
        sourceId: source.id,
        error: result.error,
        errorCode: result.errorCode,
        status: result.status,
        attempts: result.attempts,
      });
      sourceStats.push({
        id: source.id,
        ok: false,
        error: result.error,
        errorCode: result.errorCode,
        attempts: result.attempts,
        candidateCount: 0,
      });
      continue;
    }
    const normalized = normalizeSourceResult(source, result);
    sourceStats.push({
      id: source.id,
      ok: true,
      attempts: result.attempts,
      candidateCount: normalized.length,
      status: result.status,
    });
    rawCandidates = rawCandidates.concat(normalized);
  }

  // Optional freshness window on publishedAt
  if (args.sinceHours != null && Number.isFinite(args.sinceHours)) {
    rawCandidates = rawCandidates.filter((c) => withinSince(c, args.sinceHours, nowMs));
  }

  const { candidates: clustered, clusters } = dedupeAndMarkCovered(rawCandidates, published, {
    nowMs,
  });
  const clusterById = new Map(clusters.map((cl) => [cl.clusterId, cl]));

  const scoredCandidates = clustered.map((c) => {
    const score = scoreCandidate(c, {
      nowMs,
      clusterInfo: {
        independentSourceCount: c.independentPublisherCount || c.independentSourceCount || 1,
        independentPublisherCount: c.independentPublisherCount || c.independentSourceCount || 1,
        clusterHasUsableUrl: c.clusterHasUsableUrl !== false,
      },
    });
    const coverage = {
      coverageRelation: c.coverageRelation || (c.alreadyCovered ? 'duplicate' : 'new'),
      alreadyCovered: c.alreadyCovered === true,
      matchingSlug: c.matchingSlug,
      relatedPostSlug: c.relatedPostSlug || c.matchingSlug,
      matchSource: c.matchSource || null,
      coverageReason: c.coverageReason,
    };
    const { decision, decisionReasons } = decideFinal(score, coverage);
    const via = coverage.matchSource ? `@${coverage.matchSource}` : '';
    const relationPrefix =
      coverage.coverageRelation === 'duplicate'
        ? [`duplicate:${coverage.matchingSlug || coverage.coverageReason}${via}`]
        : coverage.coverageRelation === 'follow-up'
          ? [`follow-up:${coverage.matchingSlug || coverage.coverageReason}${via}`]
          : [];
    return {
      ...c,
      coverageRelation: coverage.coverageRelation,
      relatedPostSlug: coverage.relatedPostSlug,
      matchSource: coverage.matchSource,
      score,
      decision,
      decisionReasons: [...relationPrefix, ...decisionReasons],
      // Follow-ups must not become auto-eligible merely by dodging hard-reject.
      autoPublishEligible:
        decision === 'auto-eligible' &&
        score.autoPublishEligible &&
        coverage.coverageRelation !== 'follow-up',
      _clusterMeta: clusterById.get(c.clusterId) || null,
    };
  });

  // Representative: prefer usable publisher URL, then highest score.
  const clusterBest = new Map();
  for (const c of scoredCandidates) {
    const prev = clusterBest.get(c.clusterId);
    if (!prev) {
      clusterBest.set(c.clusterId, c);
      continue;
    }
    const prevUsable = prev.urlUsable !== false && !/google\.com\/goto/i.test(prev.url || '');
    const curUsable = c.urlUsable !== false && !/google\.com\/goto/i.test(c.url || '');
    if (curUsable && !prevUsable) {
      clusterBest.set(c.clusterId, c);
      continue;
    }
    if (curUsable === prevUsable && c.score.total > prev.score.total) {
      clusterBest.set(c.clusterId, c);
    }
  }
  const representatives = [...clusterBest.values()];

  const finishedAt = new Date().toISOString();
  const meta = {
    startedAt,
    finishedAt,
    dryRun: args.dryRun,
    sinceHours: args.sinceHours,
    maxSources: args.maxSources,
    sourcesAttempted: sources.length,
    sourcesOk: sourceStats.filter((s) => s.ok).length,
    sourcesFailed: sourceStats.filter((s) => !s.ok).length,
    requestCount: budget.used,
    mode: 'shadow-local-pilot',
  };

  const outDir = ensureRunOutDir(
    args.root,
    args.out,
    startedAt.replace(/[:.]/g, '-'),
  );

  const candidatesPath = path.join(outDir, 'candidates.json');
  const reportPath = path.join(outDir, 'report.md');
  const errorsPath = path.join(outDir, 'errors.json');

  const candidatesPayload = {
    meta,
    candidates: scoredCandidates,
    representatives: representatives.map((c) => c.id),
  };

  const safeCandidates = JSON.parse(redactSecrets(candidatesPayload, secrets));
  const safeErrors = JSON.parse(redactSecrets({ meta, errors, sourceStats }, secrets));

  fs.writeFileSync(candidatesPath, JSON.stringify(safeCandidates, null, 2));
  fs.writeFileSync(errorsPath, JSON.stringify(safeErrors, null, 2));

  const report = buildReport({
    meta,
    candidates: representatives,
    errors,
    sourceStats,
  });
  fs.writeFileSync(reportPath, redactSecrets(report, secrets));

  const byDecision = { 'auto-eligible': 0, review: 0, reject: 0 };
  for (const c of representatives) {
    byDecision[c.decision] = (byDecision[c.decision] || 0) + 1;
  }

  const summary = {
    outDir,
    sourcesOk: meta.sourcesOk,
    sourcesFailed: meta.sourcesFailed,
    candidates: scoredCandidates.length,
    clusters: representatives.length,
    autoEligible: byDecision['auto-eligible'] || 0,
    review: byDecision.review || 0,
    reject: byDecision.reject || 0,
    wouldHavePublished: byDecision['auto-eligible'] || 0,
    top: representatives
      .slice()
      .sort((a, b) => compareCandidatesForReview(a, b))
      .slice(0, 5)
      .map((c) => ({
        title: c.title,
        total: c.score?.total,
        decision: c.decision,
        sourceId: c.sourceId,
        riskFlags: c.score?.riskFlags || [],
      })),
  };

  return { meta, summary, outDir, scoredCandidates, representatives, errors, sourceStats };
}

function printSummary(summary) {
  console.log('news-pilot run complete');
  console.log(`  out: ${summary.outDir}`);
  console.log(
    `  sources: ${summary.sourcesOk} ok / ${summary.sourcesFailed} failed`,
  );
  console.log(
    `  candidates: ${summary.candidates} (${summary.clusters} clusters)`,
  );
  console.log(
    `  decisions: auto-eligible=${summary.autoEligible} review=${summary.review} reject=${summary.reject}`,
  );
  console.log(`  would have published: ${summary.wouldHavePublished}`);
  if (summary.top?.length) {
    console.log('  top:');
    for (const t of summary.top) {
      console.log(
        `    - [${t.decision}] ${t.total?.toFixed?.(3) ?? t.total} ${t.title.slice(0, 80)}`,
      );
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/news-pilot/run.mjs [options]
  --dry-run          default true; shadow mode (no publish)
  --max-sources=N    limit enabled sources
  --since-hours=N    drop candidates older than N hours (undated kept).
                     Default when omitted: ${RUN_CONFIG.defaultSinceHours}h
                     (${RUN_CONFIG.defaultSinceHours / 24}d slow-civic lane).
                     Use e.g. 720 for a short comparability window.
  --out=PATH         artifact directory
  --vault=PATH       optional pi vault env file (or set PI_TOOL_VAULT_PATH)`);
    process.exit(0);
  }

  const result = await runPilot(args);
  printSummary(result.summary);
  // Exit 0 even when zero candidates qualify
  process.exit(0);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((e) => {
    console.error('news-pilot fatal:', e?.message || e);
    process.exit(1);
  });
}
