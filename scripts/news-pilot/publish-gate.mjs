/**
 * Autonomous publish eligibility — rare and certain.
 *
 * Discovery "auto-eligible" (~0.72) is a human-queue signal, not a publish
 * decision. Review-queue precision is roughly 6–7/10; unattended publishing of
 * that band would ship weak/wrong local news. This gate is deliberately
 * stricter and fail-closed. Zero publishes on a given day is success.
 */

import fs from 'node:fs';
import path from 'node:path';

import { HUMAN_RISK_FLAGS } from './draft-gate.mjs';
import {
  createLocalImageExists,
  isPlausibleLocalImagePath,
  runDateIso,
} from './draft-validate.mjs';

/**
 * Auto-publish bar justification (against real candidates):
 *
 * - SCORE_CONFIG.reviewMin = 0.42, autoEligibleMin = 0.72
 * - quality-9-v5-default review reps top out ~0.61 (King/Dufferin, TTC resume);
 *   none clear 0.72 except development-application rows which are forced to review
 * - live CI review-fix-live-20260810T143929Z: 0 auto-eligible, 0 review
 * - calibration runs that hit ≥0.72 are almost entirely raw AIC development
 *   applications — excluded below
 *
 * A THRESHOLD ON score.total CANNOT EXPRESS PUBLISH CONFIDENCE. score.total is a
 * ranking score built to order a review queue for a human: it blends local
 * relevance, notability, evidence and freshness. Measured against every run in
 * .news-pilot/runs/, real stories peak near 0.50 (brewery closure 0.496, LV
 * traffic additions 0.466, Carpet Factory 0.458) while raw AIC permit rows reach
 * 0.836. A bar high enough to exclude the permits excludes every real story, and
 * a bar low enough to admit real stories admits the permits. The ordering is
 * simply not a confidence measure.
 *
 * So eligibility is CATEGORICAL: a conjunction of facts about the story (no risk
 * flags, corroborated or official sourcing, a real event rather than a record or
 * landing page, current, has a real image, not already covered, draft validates).
 * score.total survives only as a coarse sanity floor at the review threshold.
 */
export const AUTO_PUBLISH_CONFIG = Object.freeze({
  /**
   * Coarse sanity floor only, NOT the gate. Matches SCORE_CONFIG.reviewMin so
   * anything an editor would not even see cannot publish. Real eligibility is
   * decided by the categorical conditions below.
   */
  minScore: 0.42,
  /** Hard cap: at most one autonomous publish per calendar run-date. */
  maxPerDay: 1,
  /** Risk flags that always force human review (never auto). */
  blockedRiskFlags: HUMAN_RISK_FLAGS,
  /** Official/primary tiers may stand alone when extraction is substantive. */
  strongSourceTiers: Object.freeze(['official', 'primary', 'government']),
  /** Without a strong tier, require this many independent substantive publishers. */
  minIndependentPublishers: 2,
  /**
   * Neutral brand/OG fallback — clearly not a photo of the event.
   * Never invent per-story paths; never download or fabricate imagery.
   */
  neutralFallbackImage: '/images/og/og-home.jpg',
  /** Tag written onto auto-published posts for the one-per-day ledger. */
  autoPublishTag: 'auto-published',
  /**
   * Only an outright rehash blocks. A follow-up carries a genuinely new
   * development and links the prior post, so it remains publishable.
   */
  blockedCoverageRelations: Object.freeze(['duplicate']),
});

/**
 * @param {object|null|undefined} candidate
 */
export function collectRiskFlags(candidate) {
  const fromScore = Array.isArray(candidate?.score?.riskFlags)
    ? candidate.score.riskFlags
    : [];
  const top = Array.isArray(candidate?.riskFlags) ? candidate.riskFlags : [];
  return uniqueStrings([...fromScore, ...top]);
}

/**
 * @param {object|null|undefined} candidate
 * @param {object|null|undefined} evidencePack
 */
export function resolveCoverageRelation(candidate, evidencePack = null) {
  return (
    evidencePack?.coverageRelation ||
    candidate?.coverageRelation ||
    (candidate?.alreadyCovered ? 'duplicate' : 'new')
  );
}

/**
 * Source-quality rule: official/primary substantive source OR ≥2 independent
 * substantive publisher domains. Uses evidence-pack counts only (never inflated
 * discovery cluster counts).
 * @param {object|null|undefined} evidencePack
 * @param {typeof AUTO_PUBLISH_CONFIG} [config]
 */
export function evaluateSourceQuality(evidencePack, config = AUTO_PUBLISH_CONFIG) {
  const pack = evidencePack || {};
  const sources = Array.isArray(pack.sources) ? pack.sources : [];
  const substantive = sources.filter((s) => s && s.extractionSubstantive);
  if (substantive.length === 0) {
    return {
      ok: false,
      code: 'no_substantive_source',
      reasons: ['No substantive extracted evidence from any source.'],
      detail: { substantive: 0 },
    };
  }

  const tiers = substantive.map((s) => String(s.sourceTier || 'lead').toLowerCase());
  const hasStrong = tiers.some((t) => config.strongSourceTiers.includes(t));

  const publisherDomains = new Set(
    substantive.map((s) => s.publisherDomain || s.publisher).filter(Boolean),
  );
  const publisherCount =
    Number(pack.independentPublisherCount) > 0
      ? Number(pack.independentPublisherCount)
      : publisherDomains.size;

  if (hasStrong) {
    return {
      ok: true,
      code: 'official_or_primary',
      reasons: [
        `Strong-tier substantive source present (${tiers.filter((t) => config.strongSourceTiers.includes(t)).join(', ')}).`,
      ],
      detail: { publisherCount, tiers: uniqueStrings(tiers), hasStrong: true },
    };
  }

  if (publisherCount >= config.minIndependentPublishers) {
    return {
      ok: true,
      code: 'multi_publisher_corroboration',
      reasons: [
        `${publisherCount} independent substantive publisher domains (≥ ${config.minIndependentPublishers}).`,
      ],
      detail: { publisherCount, tiers: uniqueStrings(tiers), hasStrong: false },
    };
  }

  return {
    ok: false,
    code: 'insufficient_source_quality',
    reasons: [
      `Need an official/primary substantive source or ≥${config.minIndependentPublishers} independent substantive publishers; got publisherCount=${publisherCount}, tiers=${uniqueStrings(tiers).join('|') || 'none'}.`,
    ],
    detail: { publisherCount, tiers: uniqueStrings(tiers), hasStrong: false },
  };
}

/**
 * Resolve the image used for autonomous publish without fabrication.
 * Prefers a verified draft image; otherwise a verified neutral OG fallback.
 * @param {object|null|undefined} post
 * @param {{ root?: string, imageExists?: (p: string) => boolean, config?: typeof AUTO_PUBLISH_CONFIG }} [opts]
 */
export function resolveAutoPublishImage(post, opts = {}) {
  const config = opts.config || AUTO_PUBLISH_CONFIG;
  const imageExists =
    typeof opts.imageExists === 'function'
      ? opts.imageExists
      : opts.root
        ? createLocalImageExists(opts.root)
        : () => false;

  const raw = typeof post?.image === 'string' ? post.image.trim() : '';
  if (raw && isPlausibleLocalImagePath(raw) && imageExists(raw)) {
    return {
      ok: true,
      image: raw,
      source: 'draft_verified',
      reasons: ['Draft image path verified on disk.'],
    };
  }

  const fallback = config.neutralFallbackImage;
  if (
    fallback &&
    isPlausibleLocalImagePath(fallback) &&
    imageExists(fallback)
  ) {
    return {
      ok: true,
      image: fallback,
      source: 'neutral_fallback',
      reasons: [
        `Using neutral category/OG fallback ${fallback} (not an event photo; never fabricated).`,
      ],
    };
  }

  return {
    ok: false,
    image: null,
    source: 'none',
    reasons: [
      'No verified draft image and neutral fallback missing/unverified — refusing imageless auto-publish.',
    ],
  };
}

/**
 * Count autonomous publishes already on the run calendar date.
 * @param {object[]} posts
 * @param {number} nowMs
 * @param {typeof AUTO_PUBLISH_CONFIG} [config]
 */
export function countAutoPublishesOnRunDate(
  posts,
  nowMs,
  config = AUTO_PUBLISH_CONFIG,
) {
  const runDate = runDateIso(nowMs);
  const list = Array.isArray(posts) ? posts : [];
  return list.filter((p) => {
    if (!p || p.category !== 'news') return false;
    if (p.publishedAt !== runDate) return false;
    const tags = Array.isArray(p.tags) ? p.tags : [];
    return tags.includes(config.autoPublishTag);
  }).length;
}

/**
 * Cheap prefilter before evidence fetch / model call.
 * @param {object} candidate
 * @param {{ nowMs: number, posts?: object[], config?: typeof AUTO_PUBLISH_CONFIG }} opts
 */
export function prefilterAutoPublishCandidate(candidate, opts) {
  const config = opts.config || AUTO_PUBLISH_CONFIG;
  const reasons = [];
  const nowMs = opts.nowMs;
  if (!Number.isFinite(Number(nowMs))) {
    return {
      ok: false,
      code: 'missing_clock',
      reasons: ['Injectable clock nowMs is required.'],
    };
  }

  const riskFlags = collectRiskFlags(candidate);
  const blockedRisks = riskFlags.filter((f) =>
    config.blockedRiskFlags.includes(f),
  );
  if (blockedRisks.length > 0) {
    return {
      ok: false,
      code: 'risk_flags',
      reasons: [
        `Risk flag(s) block autonomous publish: ${blockedRisks.join(', ')}.`,
      ],
      detail: { riskFlags, blockedRisks },
    };
  }
  if (riskFlags.length > 0) {
    // Any non-empty risk flag set blocks — including unknown future flags.
    return {
      ok: false,
      code: 'risk_flags',
      reasons: [`Risk flag(s) block autonomous publish: ${riskFlags.join(', ')}.`],
      detail: { riskFlags },
    };
  }

  const coverage = resolveCoverageRelation(candidate);
  if (
    coverage === 'duplicate' ||
    candidate?.alreadyCovered === true ||
    config.blockedCoverageRelations.includes(coverage)
  ) {
    return {
      ok: false,
      code: 'coverage_blocked',
      reasons: [
        `Coverage relation "${coverage}" is not auto-publishable` +
          (candidate?.matchingSlug ? ` (match: ${candidate.matchingSlug})` : '') +
          '.',
      ],
      detail: { coverage, matchingSlug: candidate?.matchingSlug || null },
    };
  }

  if (candidate?.score?.concludedEvent === true || candidate?.concludedEvent === true) {
    return {
      ok: false,
      code: 'concluded_event',
      reasons: ['Concluded/stale time-bound event cannot auto-publish.'],
    };
  }

  const total = Number(candidate?.score?.total);
  if (!Number.isFinite(total) || total < config.minScore) {
    return {
      ok: false,
      code: 'score_below_bar',
      reasons: [
        `Score ${Number.isFinite(total) ? total.toFixed(4) : 'n/a'} < sanity floor ${config.minScore}.`,
      ],
      detail: { total, minScore: config.minScore },
    };
  }

  // A municipal facility/strategy landing page is a standing reference page, not
  // a dated news event, however well it scores.
  const municipalLabels = candidate?.score?.municipalProjectLabels || [];
  if (Array.isArray(municipalLabels) && municipalLabels.length > 0) {
    return {
      ok: false,
      code: 'municipal_page',
      reasons: [
        `Municipal project/landing page is not a news event: ${municipalLabels.join(', ')}.`,
      ],
      detail: { municipalLabels },
    };
  }

  // Video segments, listicles and opinion pieces are not reportable events.
  const nonEventLabels = candidate?.score?.nonEventLabels || [];
  if (Array.isArray(nonEventLabels) && nonEventLabels.length > 0) {
    return {
      ok: false,
      code: 'non_event',
      reasons: [`Not a reportable news event: ${nonEventLabels.join(', ')}.`],
      detail: { nonEventLabels },
    };
  }

  // Development applications are never auto (mirrors score.mjs force-to-review).
  if (looksLikeDevelopmentApplication(candidate)) {
    return {
      ok: false,
      code: 'development_application',
      reasons: ['Development application rows are human-review only.'],
    };
  }

  if (candidate?.urlUsable === false || candidate?.clusterHasUsableUrl === false) {
    return {
      ok: false,
      code: 'unusable_url',
      reasons: ['Cluster has no usable URL.'],
    };
  }

  const prior = countAutoPublishesOnRunDate(opts.posts || [], nowMs, config);
  if (prior >= config.maxPerDay) {
    return {
      ok: false,
      code: 'daily_cap',
      reasons: [
        `Already ${prior} auto-publish(es) on ${runDateIso(nowMs)} (cap ${config.maxPerDay}).`,
      ],
      detail: { prior, maxPerDay: config.maxPerDay },
    };
  }

  reasons.push('Prefilter passed (score, risk, coverage, cap).');
  return {
    ok: true,
    code: 'prefilter_pass',
    reasons,
    detail: { total, prior, minScore: config.minScore },
  };
}

/**
 * Full eligibility after evidence pack is available (source quality).
 * Does not draft or write posts.
 * @param {object} args
 * @param {object} args.candidate
 * @param {object} args.evidencePack
 * @param {number} args.nowMs
 * @param {object[]} [args.posts]
 * @param {typeof AUTO_PUBLISH_CONFIG} [args.config]
 */
export function evaluateAutoPublishEligibility({
  candidate,
  evidencePack,
  nowMs,
  posts = [],
  config = AUTO_PUBLISH_CONFIG,
}) {
  const pre = prefilterAutoPublishCandidate(candidate, { nowMs, posts, config });
  if (!pre.ok) {
    return {
      ok: false,
      code: pre.code,
      reasons: pre.reasons,
      detail: pre.detail || null,
      stage: 'prefilter',
    };
  }

  // Re-check risk flags from evidence pack (may surface member-level flags).
  const packFlags = Array.isArray(evidencePack?.riskFlags)
    ? evidencePack.riskFlags
    : [];
  const allFlags = uniqueStrings([...collectRiskFlags(candidate), ...packFlags]);
  if (allFlags.length > 0) {
    return {
      ok: false,
      code: 'risk_flags',
      reasons: [
        `Risk flag(s) block autonomous publish: ${allFlags.join(', ')}.`,
      ],
      detail: { riskFlags: allFlags },
      stage: 'evidence',
    };
  }

  const coverage = resolveCoverageRelation(candidate, evidencePack);
  if (
    coverage === 'duplicate' ||
    evidencePack?.matchingSlug && coverage === 'duplicate' ||
    config.blockedCoverageRelations.includes(coverage)
  ) {
    return {
      ok: false,
      code: 'coverage_blocked',
      reasons: [`Coverage relation "${coverage}" is not auto-publishable.`],
      detail: {
        coverage,
        matchingSlug:
          evidencePack?.matchingSlug || candidate?.matchingSlug || null,
      },
      stage: 'evidence',
    };
  }

  const source = evaluateSourceQuality(evidencePack, config);
  if (!source.ok) {
    return {
      ok: false,
      code: source.code,
      reasons: source.reasons,
      detail: source.detail || null,
      stage: 'source_quality',
    };
  }

  return {
    ok: true,
    code: 'eligible',
    reasons: [...pre.reasons, ...source.reasons],
    detail: {
      prefilter: pre.detail,
      source: source.detail,
      sourceCode: source.code,
    },
    stage: 'complete',
  };
}

/**
 * Final gate after draft validation + image resolution.
 * @param {object} args
 */
export function evaluatePublishReadyDraft({
  validation,
  post,
  root,
  nowMs,
  posts = [],
  existingSlugSet = null,
  imageExists = null,
  config = AUTO_PUBLISH_CONFIG,
}) {
  const reasons = [];
  if (!validation || validation.ok !== true) {
    return {
      ok: false,
      code: 'validation_failed',
      reasons: [
        `Draft validation failed: ${(validation?.failures || [])
          .map((f) => f.code)
          .join(', ') || 'unknown'}.`,
      ],
    };
  }

  const failures = validation.failures || [];
  if (failures.length > 0) {
    return {
      ok: false,
      code: 'validation_failed',
      reasons: [`Draft has ${failures.length} validation failure(s).`],
    };
  }

  const image = resolveAutoPublishImage(post, { root, imageExists, config });
  if (!image.ok) {
    return {
      ok: false,
      code: 'image_required',
      reasons: image.reasons,
    };
  }

  const slug = post?.slug;
  if (!slug || typeof slug !== 'string') {
    return {
      ok: false,
      code: 'missing_slug',
      reasons: ['Draft post is missing a slug.'],
    };
  }

  const slugs =
    existingSlugSet ||
    new Set((Array.isArray(posts) ? posts : []).map((p) => p?.slug).filter(Boolean));
  if (slugs.has(slug)) {
    return {
      ok: false,
      code: 'slug_exists',
      reasons: [`Refusing to overwrite existing slug: ${slug}`],
    };
  }

  const prior = countAutoPublishesOnRunDate(posts, nowMs, config);
  if (prior >= config.maxPerDay) {
    return {
      ok: false,
      code: 'daily_cap',
      reasons: [
        `Already ${prior} auto-publish(es) on ${runDateIso(nowMs)} (cap ${config.maxPerDay}).`,
      ],
    };
  }

  reasons.push(...image.reasons);
  reasons.push('Draft validation passed with zero failures.');
  reasons.push(`Slug "${slug}" is new.`);
  return {
    ok: true,
    code: 'publish_ready',
    reasons,
    image: image.image,
    imageSource: image.source,
  };
}

/**
 * @param {object} candidate
 */
export function looksLikeDevelopmentApplication(candidate) {
  const text = `${candidate?.title || ''} ${candidate?.snippet || ''}`;
  return /\bdevelopment application\b/i.test(text) || /\b\d{2}\s+\d{6}\s+STE\b/i.test(text);
}

/**
 * Rank representatives for auto-publish consideration (highest score first).
 * @param {object[]} candidates
 */
export function rankAutoPublishCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const byCluster = new Map();
  for (const c of list) {
    const id = c.clusterId || c.id;
    if (!id) continue;
    const prev = byCluster.get(id);
    if (!prev) {
      byCluster.set(id, c);
      continue;
    }
    const prefer =
      c.isClusterRepresentative && !prev.isClusterRepresentative
        ? c
        : (c.score?.total || 0) > (prev.score?.total || 0)
          ? c
          : prev;
    byCluster.set(id, prefer);
  }
  return [...byCluster.values()].sort((a, b) => {
    const d = (b.score?.total || 0) - (a.score?.total || 0);
    if (d !== 0) return d;
    return String(a.clusterId || a.id).localeCompare(String(b.clusterId || b.id));
  });
}

/**
 * Ensure neutral fallback exists when building from a known root.
 * @param {string} root
 * @param {typeof AUTO_PUBLISH_CONFIG} [config]
 */
export function neutralFallbackExists(root, config = AUTO_PUBLISH_CONFIG) {
  const checker = createLocalImageExists(root);
  return checker(config.neutralFallbackImage);
}

/**
 * Absolute path helper for tests (never used in CI logs as a vault path).
 * @param {string} root
 * @param {string} imagePath
 */
export function publicImageAbs(root, imagePath) {
  return path.resolve(root, 'public', String(imagePath).replace(/^\//, ''));
}

/**
 * @param {string[]} arr
 */
function uniqueStrings(arr) {
  return [...new Set((arr || []).map((s) => String(s)).filter(Boolean))];
}

/**
 * Read posts.json safely.
 * @param {string} root
 */
export function readPostsJson(root) {
  const file = path.join(root, 'data', 'posts.json');
  const raw = fs.readFileSync(file, 'utf8');
  const posts = JSON.parse(raw);
  if (!Array.isArray(posts)) {
    throw new Error('posts_json_not_array');
  }
  return { file, raw, posts };
}
