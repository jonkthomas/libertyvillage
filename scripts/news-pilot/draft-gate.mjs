/**
 * Deterministic pre-draft evidence gate.
 * "Refused, here is why" is a successful outcome (exit 0).
 */

/** Risk flags that always require human handling before any draft generation. */
export const HUMAN_RISK_FLAGS = Object.freeze([
  'crime',
  'legal',
  'safety',
  'health',
  'civic-controversy',
  'named-person',
]);

/**
 * Consequential-story detector for the single-lead corroboration rule.
 * Soft lifestyle blurbs are not treated as consequential by default.
 */
export const CONSEQUENTIAL_PATTERN =
  /\b(develop(?:ment|er)?|rezon(?:e|ing)|application|storey|tower|hotel|rental proposal|condo|apartments?|infrastructure|transit|streetcar|TTC|Metrolinx|road closure|lane closure|crash|collision|fire|evacuat\w*|explosion|shooting|stabbing|homicide|arrest|charged|lawsuit|bylaw|city council|zoning|park competition|shortlist(?:ed)?|public realm|budget|tax|expropriat\w*|demolish\w*|construction)\b/i;

export const GATE_CONFIG = Object.freeze({
  humanRiskFlags: HUMAN_RISK_FLAGS,
  consequentialPattern: CONSEQUENTIAL_PATTERN,
  /** Official / primary tiers can stand alone; lead/wire/blog cannot for consequential claims. */
  weakSoloTiers: Object.freeze(['lead', 'wire', 'blog', 'social', 'aggregator']),
});

/**
 * @param {object} evidencePack from buildEvidencePack
 * @param {typeof GATE_CONFIG} [config]
 * @returns {{ ok: true } | { ok: false, code: string, reasons: string[], detail?: object }}
 */
export function evaluateEvidenceGate(evidencePack, config = GATE_CONFIG) {
  const reasons = [];
  const pack = evidencePack || {};
  const sources = Array.isArray(pack.sources) ? pack.sources : [];
  const riskFlags = Array.isArray(pack.riskFlags) ? pack.riskFlags : [];

  const usableUrlMembers = sources.filter((s) => s.urlUsable);
  if (usableUrlMembers.length === 0) {
    reasons.push('No cluster member has a usable canonical URL to fetch.');
    return {
      ok: false,
      code: 'no_usable_url',
      reasons,
      detail: { sourceCount: sources.length },
    };
  }

  const fetchedUsable = sources.filter((s) => s.urlUsable && s.fetchOk);
  const substantive = sources.filter((s) => s.extractionSubstantive);
  if (substantive.length === 0) {
    const failNotes = sources
      .map((s) => {
        if (!s.urlUsable) return `${s.url || '(no-url)'}: unusable_url`;
        if (!s.fetchOk) return `${s.url}: ${s.fetchError || 'fetch_failed'}`;
        return `${s.url}: extraction_not_substantive`;
      })
      .slice(0, 12);
    reasons.push(
      'Extraction yielded nothing substantive from any member URL (or every fetch failed).',
    );
    return {
      ok: false,
      code: 'extraction_empty',
      reasons,
      detail: {
        usableUrlMembers: usableUrlMembers.length,
        fetchedUsable: fetchedUsable.length,
        substantive: substantive.length,
        notes: failNotes,
      },
    };
  }

  const humanFlags = riskFlags.filter((f) => config.humanRiskFlags.includes(f));
  if (humanFlags.length > 0) {
    reasons.push(
      `Story carries risk flag(s) requiring human handling: ${humanFlags.join(', ')}.`,
    );
    return {
      ok: false,
      code: 'risk_flags',
      reasons,
      detail: { humanFlags, allFlags: riskFlags },
    };
  }

  // Single lead-tier source for a consequential claim → refuse.
  const textBlob = [
    pack.title,
    pack.snippet,
    ...sources.flatMap((s) => s.passages || []),
  ].join(' ');
  const consequential =
    config.consequentialPattern.test(textBlob) ||
    config.consequentialPattern.test(pack.title || '');

  if (consequential) {
    const substantiveTiers = substantive.map((s) =>
      String(s.sourceTier || 'lead').toLowerCase(),
    );
    const distinctPublishers = new Set(
      substantive.map((s) => s.publisherDomain || s.publisher).filter(Boolean),
    );
    const publisherCount =
      Number(pack.independentPublisherCount) > 0
        ? Number(pack.independentPublisherCount)
        : distinctPublishers.size;

    const hasStrongTier = substantiveTiers.some(
      (t) => !config.weakSoloTiers.includes(t),
    );
    const onlyWeakTiers = substantiveTiers.every((t) =>
      config.weakSoloTiers.includes(t),
    );

    if (onlyWeakTiers && publisherCount <= 1 && !hasStrongTier) {
      reasons.push(
        'Consequential claim is corroborated by only a single lead-tier source; needs official primary source or additional independent publishers before drafting.',
      );
      return {
        ok: false,
        code: 'single_lead_consequential',
        reasons,
        detail: {
          publisherCount,
          substantiveTiers: unique(substantiveTiers),
          consequential: true,
        },
      };
    }
  }

  return {
    ok: true,
    code: 'pass',
    reasons: ['Evidence gate passed.'],
    detail: {
      substantiveSources: substantive.length,
      riskFlags,
      consequential,
    },
  };
}

function unique(arr) {
  return [...new Set(arr)];
}
