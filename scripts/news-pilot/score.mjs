/**
 * PURE deterministic scoring for news candidates.
 * No I/O. Pass nowMs for freshness determinism in tests.
 */

import { hasSportingMatchup } from './dedupe.mjs';

// Re-export so existing score.test imports keep working from this module.
export { hasSportingMatchup } from './dedupe.mjs';

/** Tunable thresholds and weights — single exported config object. */
export const SCORE_CONFIG = Object.freeze({
  weights: Object.freeze({
    // Rebalanced toward notability so real events outrank "mentions LV" filler.
    localRelevance: 0.32,
    notability: 0.38,
    evidence: 0.18,
    freshness: 0.12,
  }),
  /**
   * King St W numbering rises westward; Strachan is ~900 and Dufferin ~1150.
   * Above this the address is Parkdale/Brockton, not Liberty Village.
   */
  kingStWestMaxNumber: 1150,
  /** Minimum total for auto-eligible (and no risk flags). */
  autoEligibleMin: 0.72,
  /** Minimum total for review tier (below → reject). */
  reviewMin: 0.42,
  /** Hard gate: below this local relevance nothing reaches the editor queue. */
  minLocalRelevance: 0.2,
  /**
   * Freshness half-life in hours.
   * Tuned for "notable, not breaking" (~10 days) rather than same-day chase.
   */
  freshnessHalfLifeHours: 240,
  /** Age at which freshness bottoms out for exact dates. */
  freshnessMaxAgeHours: 2160, // 90 days
  /**
   * Approximate dates previously decayed *slower* (1.6x), which let low-trust
   * stale previews outrank fresh exact stories. Same-rate decay is the fix;
   * untrusted old dates are further penalized below.
   */
  approximateHalfLifeMultiplier: 1.0,
  /** Extra freshness penalty once an approximate date is older than one half-life. */
  approximateStaleFreshnessFactor: 0.55,
  /** Neutral freshness when date is unknown. */
  unknownFreshness: 0.5,
  /** Floor for exact-date freshness after max age. */
  staleFreshnessFloor: 0.05,
  /** Development applications are inherently weeks old — soft freshness floor (review-band, not auto). */
  developmentAppFreshnessFloor: 0.42,
  /**
   * Slow civic design-competition stories are months-old by nature.
   * Floor keeps them out of the 0.05 stale pit without making them look "fresh".
   */
  civicDesignCompetitionFreshnessFloor: 0.28,
  /**
   * Time-bound fixture/event previews older than this are treated as concluded.
   * One half-life: "tonight"/"X vs Y" copy past this age is not current news.
   */
  concludedEventMaxAgeHours: 240,
  /**
   * When a construction/closure item's referenced end window is past, still require
   * the publish date itself to be at least this old before hard-concluding on a
   * bare month name (guards fresh stories that say "until November" in August).
   * Exact year anchors and elapsed relative durations ignore this floor.
   */
  concludedBareMonthMinPublishAgeHours: 24 * 60,
  /** Cap stacked notability keywords so boilerplate official records cannot max out. */
  notabilityCap: 0.72,
  /**
   * Review-queue ordering blends total with freshness so a stale high-notability
   * item cannot bury a genuinely current comparable story. Weight is on freshness.
   */
  reviewRankFreshnessWeight: 0.22,
  /** Evidence base by source tier before corroboration boost. */
  tierEvidence: Object.freeze({
    official: 0.85,
    reputable: 0.65,
    lead: 0.4,
  }),
  /** Extra evidence per additional independent PUBLISHER in cluster (capped). */
  corroborationBonus: 0.12,
  corroborationCap: 0.3,
  /** Generic Toronto-wide penalty when no LV signal. */
  genericTorontoPenalty: 0.35,
  /** Snippet/title char window used for matching. */
  textLimit: 1200,
  /** Multiplicative notability factor for demoted non-events. */
  nonEventNotabilityFactor: 0.15,
  /** Flat total penalty applied to demoted non-events. */
  nonEventTotalPenalty: 0.08,
  /**
   * Municipal facility/project landing pages are identified for rank-last review
   * ordering only (see compareCandidatesForReview). No score haircuts — sort-last
   * alone keeps them below dated news.
   */
});

/**
 * Curated Liberty Village gazetteer (streets, landmarks, postal).
 * Includes bare street tokens so CKAN titles like "34 HANNA" match.
 */
export const LOCAL_GAZETTEER = Object.freeze([
  'liberty village',
  'libertyvillage',
  'hanna ave',
  'hanna avenue',
  'hanna',
  'atlantic ave',
  'atlantic avenue',
  'atlantic',
  'liberty st',
  'liberty street',
  'jefferson ave',
  'jefferson avenue',
  'jefferson',
  'east liberty',
  'east liberty st',
  'east liberty street',
  'lynn williams',
  'lynn williams st',
  'lynn williams street',
  'western battery',
  'western battery rd',
  'western battery road',
  'mowat ave',
  'mowat avenue',
  'mowat',
  'pirandello',
  'exhibition place',
  'exhibitionplace',
  'lamport stadium',
  'lamport',
  'ordnance',
  'strachan',
  'dufferin gates',
  'dufferin street',
  'dufferin st',
  'king st w',
  'king street west',
  'king street w',
  'king west',
  'm6k',
  'toy factory',
  'carpet factory',
  'liberty market',
  'enercare centre',
  'enercare center',
  'coca-cola coliseum',
  'bmo field',
  'ontario place',
  'ontario line',
  'exhibition go',
  'exhibition loop',
  'fraser ave',
  'fraser avenue',
  'fraser',
]);

export const NOTABILITY_KEYWORDS = Object.freeze([
  // Avoid bare "close" — it false-positives on street names like "CLOSE AVE".
  { re: /\bclos(?:es|ed|ure|ing)\b|\bclose down\b|\bpermanently close\b/i, w: 0.28, label: 'closure' },
  { re: /\bbrewery\b|\bbrewpub\b|\bbusiness clos/i, w: 0.12, label: 'business-closure' },
  { re: /\bconstruction\b|\btunnell?ing\b/i, w: 0.22, label: 'construction' },
  { re: /\bopening\b|\bopens\b|\bgrand opening\b/i, w: 0.2, label: 'opening' },
  { re: /\bservice change\b|\bservice advisory\b|\bdelay\b|\bdivert/i, w: 0.2, label: 'service-change' },
  {
    re: /\bdevelopment application\b|\brezoning\b|\bofficial plan\b|\bsite plan\b/i,
    w: 0.3,
    label: 'development-application',
  },
  {
    re: /\b(?:\d+-)?storey\b|\b(?:\d+-)?story\b|\btower\b|\bcondo\b|\bmixed-?use\b|\bhotel proposed\b|\bproposed\b.{0,40}\b(tower|condo|hotel|residential)\b/i,
    w: 0.22,
    label: 'development-built-form',
  },
  { re: /\binfrastructure\b|\btraffic (?:and community )?(?:infrastructure|additions)\b/i, w: 0.16, label: 'infrastructure-plan' },
  { re: /\bpark\b|\bgreen space\b|\bplayground\b/i, w: 0.12, label: 'park' },
  {
    // Slow civic design competitions (e.g. international park design shortlist).
    // Require competition/shortlist/design-team context — bare "public realm" is too
    // broad and lifts static municipal strategy landing pages into review.
    re: /\b(?:international\s+)?design competition\b|\binternational competition\b|\bshortlisted\b|\bshort-?listed\b|\bdesign teams?\b/i,
    w: 0.18,
    label: 'civic-design-competition',
  },
  {
    re: /\bconsultation\b|\bcommunity meeting\b|\bpublic meeting\b|\bopen house\b/i,
    w: 0.18,
    label: 'consultation',
  },
  { re: /\bevent\b|\bfestival\b|\bconcert\b|\bindy\b|\bcne\b/i, w: 0.1, label: 'event' },
  { re: /\bttc\b|\bstreetcar\b|\btransit\b|\bbus route\b|\bontario line\b/i, w: 0.16, label: 'transit' },
  { re: /\broad.?closure\b|\blane closure\b|\btraffic\b/i, w: 0.16, label: 'traffic' },
  { re: /\bfire\b|\boutage\b|\bwater main\b|\bwatermain\b/i, w: 0.2, label: 'infrastructure' },
]);

/**
 * Deterministic non-event detectors — video b-roll, listicles, opinion, roundups.
 * These are demoted, not hard-rejected.
 */
export const NON_EVENT_PATTERNS = Object.freeze([
  {
    label: 'video-segment',
    re: /\baround the 6ix\b|\bmust-see places\b|\/video\/|\bwatch the full\b|\btv segment\b|\bb-?roll\b/i,
  },
  {
    label: 'listicle',
    re: /\bbest (?:bars|restaurants|cafes|things)\b|\btop \d+\b|\b\d+ best\b|\bwhat to (?:do|eat|see)\b|\bguide to the best\b/i,
  },
  {
    label: 'opinion',
    re: /\bop-?ed\b|\bopinion:\b|\bi think\b|\bcolumn:\b|\bthink-?piece\b|\bcommentary:\b/i,
  },
  {
    label: 'roundup',
    re: /\bbest of\b|\bin photos\b|\bweek in (?:review|photos)\b|\bthings to do this weekend\b|\bweekend planner\b/i,
  },
]);

/**
 * Municipal facility/project landing pages — static project info, not timed news.
 * Deterministic URL/title cues only; not a general page classifier.
 */
export const MUNICIPAL_PROJECT_PATTERNS = Object.freeze([
  {
    label: 'municipal-facility-url',
    re: /toronto\.ca\/[^\s"']*(?:park-facility-projects|construction-new-facilities|facility-projects|parks-forestry-recreation\/[^\s"']*projects?)/i,
  },
  {
    label: 'municipal-facility-title',
    re: /^new\s+(?:park|facility|community centre|community center|recreation centre|recreation center|arena|splash pad)\s+at\b/i,
  },
]);

/** Risk detectors — any match forces autoPublishEligible false. */
export const RISK_PATTERNS = Object.freeze([
  {
    flag: 'crime',
    re: /\b(murder|homicide|shooting|shot dead|stabbing|assault|robbery|theft|stole|stolen|steal(?:ing)?|break-?in|carjack|gun|firearm|arrested|charged with)\b/i,
  },
  {
    flag: 'legal',
    re: /\b(lawsuit|sued|indicted|court ruling|injunction|criminal charge|pleads? guilty|according to a judge|judge (?:found|ruled|tosses|finds))\b/i,
  },
  {
    flag: 'safety',
    re: /\b(explosion|evacuate|evacuation|hazardous|gas leak|carbon monoxide|active attacker)\b/i,
  },
  {
    flag: 'named-person',
    re: /\b(victim identified|suspect identified|charged .+ aged \d+|police name)\b/i,
  },
  {
    flag: 'health',
    re: /\b(outbreak|measles|covid|overdose|meningitis|e\.?\s*coli|listeria)\b/i,
  },
  {
    flag: 'political',
    re: /\b(campaign rally|election campaign|party leader|partisan|endorsement for (mp|mpp|councillor))\b/i,
  },
  {
    flag: 'civic-controversy',
    re: /\b(?:cull(?:s|ed|ing)?|euthaniz(?:e|ed|es|ing|ation)|animal control|kill(?:ing|ed)\s+(?:of\s+)?(?:the\s+)?(?:coyote|wildlife|animal)s?|(?:coyote|wildlife)\s+(?:cull|kill|euthan)|protest(?:s|ers|ing)?|demonstrat(?:ion|ions|ors|ing)|public outcry|backlash|controvers(?:y|ial)|unnecessary suffering|contested\s+(?:review|decision|report|findings)|critic(?:ism|ized|ises|izes|ising|izing)\s+(?:of\s+)?(?:the\s+)?(?:city|police|council|mayor)|(?:city|police|council|mayor)\s+(?:criticized|under fire|faces? backlash)|official review)\b/i,
  },
  {
    flag: 'unverified-closure',
    re: /\b(reports of|unconfirmed|rumour|rumor).{0,40}\bclos/i,
  },
]);

const GENERIC_TORONTO = /\b(toronto|gta|greater toronto|city-wide|city wide|downtown toronto)\b/i;

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function candidateText(candidate, limit = SCORE_CONFIG.textLimit) {
  const parts = [
    candidate?.title || '',
    candidate?.snippet || '',
    candidate?.rawTextSample || '',
    candidate?.url || '',
  ];
  return parts.join('\n').slice(0, limit);
}

/** @param {object} candidate */
export function isDevelopmentApplication(candidate) {
  if (candidate?.applicationNumber) return true;
  if (String(candidate?.sourceId || '').startsWith('ckan-dev-apps')) return true;
  return /\bdevelopment application\b/i.test(candidate?.title || '');
}

/**
 * @param {object} candidate
 * @returns {{ score: number, reasons: string[], matches: string[] }}
 */
export function scoreLocalRelevance(candidate, config = SCORE_CONFIG) {
  const text = candidateText(candidate).toLowerCase();
  const reasons = [];
  const matches = [];
  let score = 0;

  if (/\bliberty village\b/i.test(text) || text.includes('libertyvillage')) {
    score += 0.7;
    matches.push('liberty village');
    reasons.push('explicit Liberty Village match');
  }

  // Prefer longer gazetteer phrases first; avoid double-counting bare tokens
  // already covered by a longer hit (e.g. "hanna avenue" covers "hanna").
  const sortedTerms = [...LOCAL_GAZETTEER].sort((a, b) => b.length - a.length);
  const hitTerms = [];
  for (const term of sortedTerms) {
    if (term === 'liberty village' || term === 'libertyvillage') continue;
    if (!text.includes(term)) continue;
    const covered = hitTerms.some(
      (h) => h.includes(term) || (term.length > 3 && h.startsWith(term + ' ')),
    );
    if (covered) continue;
    hitTerms.push(term);
    matches.push(term);
  }

  const uniq = [...new Set(matches)];
  if (uniq.length) {
    const gazHits = uniq.filter((m) => m !== 'liberty village');
    const gaz = Math.min(0.45, gazHits.length * 0.12);
    score += gaz;
    const shown = uniq.slice(0, 6).join(', ');
    reasons.push(`gazetteer hits: ${shown}`);
  }

  // Bare street + number pattern from CKAN ("34 HANNA")
  if (
    /\b\d{1,5}\s+(hanna|atlantic|liberty|jefferson|mowat|fraser|pirandello|ordnance|east liberty|lynn williams|western battery)\b/i.test(
      text,
    )
  ) {
    if (score < 0.35) {
      score += 0.35;
      reasons.push('LV-core street address token');
    }
  }

  const kingStWest = text.match(/\b(\d{1,5})\s+king\s+st(?:reet)?\s+w/i);
  if (kingStWest && Number(kingStWest[1]) > config.kingStWestMaxNumber) {
    score = Math.max(0, score - 0.35);
    reasons.push('King St W address west of Dufferin (outside Liberty Village)');
  }

  // M6K spans Parkdale as well as Liberty Village, so it corroborates a local
  // signal but cannot establish one on its own.
  if (/\bm6k\b/i.test(text)) {
    if (score >= 0.2) {
      score += 0.08;
      if (!matches.includes('m6k')) matches.push('m6k');
      reasons.push('M6K postal signal (corroborating)');
    } else {
      reasons.push('M6K postal alone is not a Liberty Village signal');
    }
  }

  const hasLocal = score >= 0.2;
  if (!hasLocal && GENERIC_TORONTO.test(text)) {
    score = Math.max(0, score - config.genericTorontoPenalty);
    reasons.push('generic Toronto-wide item without LV signal (penalized)');
  }

  if (!hasLocal && score < 0.15) {
    reasons.push('weak or no local Liberty Village signal');
  }

  return { score: clamp01(score), reasons, matches: [...new Set(matches)] };
}

/** @param {object} candidate */
export function detectNonEventLabels(candidate) {
  const text = candidateText(candidate);
  const labels = [];
  for (const p of NON_EVENT_PATTERNS) {
    if (p.re.test(text)) labels.push(p.label);
  }
  return labels;
}

/**
 * Static municipal facility/project landing pages (not dated news events).
 * @param {object} candidate
 * @returns {string[]}
 */
export function detectMunicipalProjectLabels(candidate) {
  const title = String(candidate?.title || '');
  const url = String(candidate?.canonicalUrl || candidate?.url || '');
  const text = candidateText(candidate);
  const labels = [];
  for (const p of MUNICIPAL_PROJECT_PATTERNS) {
    if (p.label.endsWith('-title')) {
      if (p.re.test(title)) labels.push(p.label);
    } else if (p.re.test(url) || p.re.test(text)) {
      labels.push(p.label);
    }
  }
  return [...new Set(labels)];
}

/** @param {object} candidate */
export function scoreNotability(candidate, config = SCORE_CONFIG) {
  const text = candidateText(candidate);
  const reasons = [];
  let score = 0.05;
  for (const kw of NOTABILITY_KEYWORDS) {
    if (kw.re.test(text)) {
      score += kw.w;
      reasons.push(`notability:${kw.label}`);
    }
  }

  const nonEvents = detectNonEventLabels(candidate);
  if (nonEvents.length) {
    score = score * config.nonEventNotabilityFactor;
    reasons.push(`non-event demotion: ${nonEvents.join(', ')}`);
  }

  // Municipal facility pages: labels only (rank-last). No notability haircut.
  const municipalProjects = detectMunicipalProjectLabels(candidate);

  const cap = config.notabilityCap ?? 0.72;
  if (score > cap) {
    reasons.push(`notability capped at ${cap}`);
    score = cap;
  }

  return { score: clamp01(score), reasons, nonEvents, municipalProjects };
}

/**
 * Corroboration uses DISTINCT PUBLISHER DOMAINS, not sourceIds / query configs.
 * @param {object} candidate
 * @param {{ independentSourceCount?: number, independentPublisherCount?: number }} [clusterInfo]
 */
export function scoreEvidence(candidate, clusterInfo = {}, config = SCORE_CONFIG) {
  const tier = candidate?.sourceTier || 'lead';
  const base = config.tierEvidence[tier] ?? config.tierEvidence.lead;
  const n = Math.max(
    1,
    Number(clusterInfo.independentPublisherCount) ||
      Number(clusterInfo.independentSourceCount) ||
      1,
  );
  const bonus = Math.min(config.corroborationCap, Math.max(0, n - 1) * config.corroborationBonus);
  const score = clamp01(base + bonus);
  const reasons = [
    `tier=${tier} base=${base.toFixed(2)}`,
    `independent_publishers=${n}`,
  ];
  if (bonus > 0) reasons.push(`corroboration_bonus=+${bonus.toFixed(2)}`);
  return { score, reasons };
}

const MONTH_INDEX = Object.freeze({
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
});

const SEASON_END_MONTH = Object.freeze({
  spring: 4, // end of May
  summer: 7, // end of August
  fall: 10, // end of November
  autumn: 10,
  winter: 1, // end of February (year handled below)
});

const WORD_NUMBER = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
});

/** Construction/closure/roadwork context — duration windows only apply here. */
function hasTimeBoundWorksContext(text) {
  return /\b(?:construction|closures?|closed|closing|shutdown|shut down|road\s?works?|track works?|detours?|divert(?:s|ed|ing)?|lane clos|intersection|streetcar|reopen(?:s|ed|ing)?|outage|water\s?main)\b/i.test(
    text,
  );
}

/**
 * End-of-month UTC ms for a month index + year.
 * @param {number} year
 * @param {number} monthIndex 0-11
 */
function endOfMonthUtcMs(year, monthIndex) {
  // Day 0 of next month = last day of this month.
  return Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999);
}

/**
 * Resolve a bare/season month end relative to publish date.
 * @returns {{ endMs: number, label: string, hadExplicitYear: boolean } | null}
 */
function resolveNamedPeriodEnd(periodToken, yearToken, pubMs) {
  const raw = String(periodToken || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .trim();
  const hadExplicitYear = Boolean(yearToken && /^\d{4}$/.test(yearToken));
  const explicitYear = hadExplicitYear ? Number(yearToken) : null;

  if (SEASON_END_MONTH[raw] != null) {
    const monthIndex = SEASON_END_MONTH[raw];
    if (Number.isNaN(pubMs) && explicitYear == null) return null;
    let year = explicitYear;
    if (year == null) {
      const pub = new Date(pubMs);
      year = pub.getUTCFullYear();
      const pubMonth = pub.getUTCMonth();
      // Winter published after February → ends next calendar year's February.
      if (raw === 'winter') {
        if (pubMonth > 1) year += 1;
      } else if (monthIndex < pubMonth) {
        year += 1;
      }
    }
    return {
      endMs: endOfMonthUtcMs(year, monthIndex),
      label: `${raw}${hadExplicitYear ? ' ' + year : ''}`,
      hadExplicitYear,
    };
  }

  const monthIndex = MONTH_INDEX[raw];
  if (monthIndex == null) return null;
  if (Number.isNaN(pubMs) && explicitYear == null) return null;

  let year = explicitYear;
  if (year == null) {
    const pub = new Date(pubMs);
    year = pub.getUTCFullYear();
    // "until November" published in September → November same year;
    // "until March" published in September → March next year.
    if (monthIndex < pub.getUTCMonth()) year += 1;
  }
  return {
    endMs: endOfMonthUtcMs(year, monthIndex),
    label: `${raw}${hadExplicitYear ? ' ' + year : ''}`,
    hadExplicitYear,
  };
}

/**
 * Parse referenced construction/closure completion windows ("until November",
 * "for six weeks", "through the summer", "reopens in March").
 * @returns {{ concluded: boolean, reason?: string, ageHours?: number, endMs?: number } | null}
 */
export function detectReferencedCompletionWindow(
  candidate,
  nowMs = Date.now(),
  config = SCORE_CONFIG,
) {
  const text = candidateText(candidate);
  if (!hasTimeBoundWorksContext(text)) return null;

  const iso = candidate?.publishedAt;
  const pubMs = iso ? Date.parse(iso) : NaN;
  const ageHours = !Number.isNaN(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : null;
  const bareMonthMinAge = config.concludedBareMonthMinPublishAgeHours ?? 24 * 60;

  // Relative duration from publish: "for six weeks", "nearly two-month closure".
  if (!Number.isNaN(pubMs)) {
    const durationRe =
      /\b(?:for|lasting)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(days?|weeks?|months?)\b/gi;
    for (const m of text.matchAll(durationRe)) {
      const nRaw = m[1].toLowerCase();
      const n = WORD_NUMBER[nRaw] ?? Number(nRaw);
      if (!Number.isFinite(n) || n <= 0) continue;
      const unit = m[2].toLowerCase();
      const dayMult = unit.startsWith('day') ? 1 : unit.startsWith('week') ? 7 : 30;
      const endMs = pubMs + n * dayMult * 86_400_000;
      if (nowMs > endMs) {
        return {
          concluded: true,
          endMs,
          ageHours,
          reason: `concluded dated works window (duration ${n} ${unit} from publish, end passed)`,
        };
      }
    }

    const monthClosureRe =
      /\b(?:nearly|almost|about|approximately)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*-\s*month\s+clos/gi;
    for (const m of text.matchAll(monthClosureRe)) {
      const nRaw = m[1].toLowerCase();
      const n = WORD_NUMBER[nRaw] ?? Number(nRaw);
      if (!Number.isFinite(n) || n <= 0) continue;
      const endMs = pubMs + n * 30 * 86_400_000;
      if (nowMs > endMs) {
        return {
          concluded: true,
          endMs,
          ageHours,
          reason: `concluded dated works window (${n}-month closure from publish, end passed)`,
        };
      }
    }
  }

  // Named end anchors: "until November", "through the summer", "reopens in March 2026".
  const namedPattern =
    /\b(?:until|through|thru|to last until|lasting until|scheduled to (?:last until|end|reopen|complete)|(?:reopens?|ends?|complete[sd]?|completion|finishes|finished)\s+(?:in|on|by))\s+(?:the\s+)?(spring|summer|fall|autumn|winter|january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+(\d{4}))?\b/gi;

  for (const m of text.matchAll(namedPattern)) {
    const resolved = resolveNamedPeriodEnd(m[1], m[2], pubMs);
    if (!resolved) continue;
    if (nowMs <= resolved.endMs) continue;

    // Bare month/season without explicit year: if the resolved end is past but the
    // publish date is still fresh, prefer NOT concluding unless the end is well past
    // (30d+). Fresh August roadwork "until November" stays live; Sept-2025 "until
    // November" is long concluded by the following August.
    if (!resolved.hadExplicitYear) {
      if (ageHours == null) continue;
      const daysPastEnd = (nowMs - resolved.endMs) / 86_400_000;
      if (ageHours < bareMonthMinAge && daysPastEnd < 30) continue;
    }

    return {
      concluded: true,
      endMs: resolved.endMs,
      ageHours: ageHours ?? undefined,
      reason: `concluded dated works window (until/through ${resolved.label}, end passed)`,
    };
  }

  return null;
}

/**
 * Fixture/event preview that has already aged out relative to now.
 * Deterministic — imminent/matchup language older than one half-life, OR a
 * construction/closure completion window that has demonstrably passed.
 * @param {object} candidate
 * @param {number} [nowMs]
 * @param {typeof SCORE_CONFIG} [config]
 * @returns {{ concluded: boolean, reason?: string, ageHours?: number }}
 */
export function detectConcludedTimeBoundEvent(candidate, nowMs = Date.now(), config = SCORE_CONFIG) {
  const text = candidateText(candidate);

  // Dated construction/closure windows ("until November", "for six weeks").
  const window = detectReferencedCompletionWindow(candidate, nowMs, config);
  if (window?.concluded) {
    return {
      concluded: true,
      ageHours: window.ageHours,
      reason: window.reason,
    };
  }

  const imminent =
    /\b(?:tonight|today|tomorrow|this weekend|overnight|this week|starts?\s+(?:on\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|begins?\s+(?:on\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i.test(
      text,
    );
  // Sporting fixtures only — civic "residents vs developer" must not count.
  const matchup = hasSportingMatchup(text);
  if (!imminent && !matchup) return { concluded: false };

  const iso = candidate?.publishedAt;
  // Unknown dates cannot prove the event is over — do not invent a rejection.
  if (!iso) return { concluded: false, reason: 'time-bound language without dated publishedAt' };

  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { concluded: false };

  const ageHours = Math.max(0, (nowMs - t) / 3_600_000);
  const maxAge = config.concludedEventMaxAgeHours ?? config.freshnessHalfLifeHours;
  if (ageHours <= maxAge) return { concluded: false, ageHours };

  const markers = [imminent ? 'imminent-language' : null, matchup ? 'matchup' : null]
    .filter(Boolean)
    .join('+');
  return {
    concluded: true,
    ageHours,
    reason: `concluded time-bound event (${markers}, ageHours=${ageHours.toFixed(1)} > ${maxAge})`,
  };
}

/**
 * @param {object} candidate
 * @param {number} [nowMs]
 */
/** True when notability/text marks a civic design-competition story. */
export function isCivicDesignCompetition(candidate) {
  const text = candidateText(candidate);
  return /\b(?:international\s+)?design competition\b|\binternational competition\b|\bshortlisted\b|\bshort-?listed\b|\bdesign teams?\b/i.test(
    text,
  );
}

export function scoreFreshness(candidate, nowMs = Date.now(), config = SCORE_CONFIG) {
  const reasons = [];
  const confidence = candidate?.dateConfidence || (candidate?.publishedAt ? 'exact' : 'unknown');
  const iso = candidate?.publishedAt;
  const civicDesign = isCivicDesignCompetition(candidate);
  const civicFloor = config.civicDesignCompetitionFreshnessFloor ?? 0.28;

  if (isDevelopmentApplication(candidate)) {
    // Dev apps are inherently weeks old; do not let freshness dominate.
    if (!iso) {
      reasons.push('development application without date → elevated floor');
      return { score: config.developmentAppFreshnessFloor, reasons, dateConfidence: confidence };
    }
  }

  if (civicDesign && !iso) {
    reasons.push('civic design-competition without date → elevated floor');
    return { score: civicFloor, reasons, dateConfidence: confidence };
  }

  if (!iso || confidence === 'unknown') {
    reasons.push('missing/unknown publishedAt → neutral freshness');
    return {
      score: config.unknownFreshness,
      reasons,
      dateConfidence: 'unknown',
    };
  }

  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    reasons.push('unparseable publishedAt → neutral freshness');
    return { score: config.unknownFreshness, reasons, dateConfidence: confidence };
  }

  const ageHours = Math.max(0, (nowMs - t) / 3_600_000);
  let half = config.freshnessHalfLifeHours;
  if (confidence === 'approximate') {
    half *= config.approximateHalfLifeMultiplier;
    reasons.push('approximate date → same-rate freshness decay');
  }

  if (isDevelopmentApplication(candidate)) {
    const raw = clamp01(Math.pow(0.5, ageHours / (half * 1.5)));
    const score = Math.max(config.developmentAppFreshnessFloor, raw);
    reasons.push(
      `dev-app ageHours=${ageHours.toFixed(1)} halfLife=${half} floor=${config.developmentAppFreshnessFloor}`,
    );
    return { score, reasons, dateConfidence: confidence };
  }

  if (civicDesign) {
    const raw =
      confidence === 'exact' && ageHours > config.freshnessMaxAgeHours
        ? config.staleFreshnessFloor
        : clamp01(Math.pow(0.5, ageHours / (half * 1.5)));
    const score = Math.max(civicFloor, raw);
    reasons.push(
      `civic design-competition ageHours=${ageHours.toFixed(1)} floor=${civicFloor}`,
    );
    return { score, reasons, dateConfidence: confidence };
  }

  if (confidence === 'exact' && ageHours > config.freshnessMaxAgeHours) {
    reasons.push(`stale ageHours=${ageHours.toFixed(1)}`);
    return { score: config.staleFreshnessFloor, reasons, dateConfidence: confidence };
  }

  let score = clamp01(Math.pow(0.5, ageHours / half));
  // Approximate dates older than one half-life are untrusted as "current".
  if (
    confidence === 'approximate' &&
    ageHours > config.freshnessHalfLifeHours &&
    config.approximateStaleFreshnessFactor != null
  ) {
    score = clamp01(score * config.approximateStaleFreshnessFactor);
    reasons.push(
      `approximate past half-life → freshness ×${config.approximateStaleFreshnessFactor}`,
    );
  }
  reasons.push(`ageHours=${ageHours.toFixed(1)} halfLife=${half} confidence=${confidence}`);
  return { score, reasons, dateConfidence: confidence };
}

/**
 * Ordering metric for the editor review queue. Freshness-aware so stale items
 * with similar raw totals do not outrank current ones.
 * @param {{ total?: number, breakdown?: { freshness?: number } }} score
 * @param {typeof SCORE_CONFIG} [config]
 */
export function reviewRankMetric(score, config = SCORE_CONFIG) {
  const total = Number(score?.total) || 0;
  const freshness = Number(score?.breakdown?.freshness);
  const f = Number.isFinite(freshness) ? freshness : 0.5;
  const w = config.reviewRankFreshnessWeight ?? 0.22;
  return total * (1 - w) + f * w;
}

/** @param {object} candidate @returns {string[]} */
export function detectRiskFlags(candidate) {
  const text = candidateText(candidate);
  const flags = [];
  for (const p of RISK_PATTERNS) {
    if (p.re.test(text)) flags.push(p.flag);
  }
  return flags;
}

/**
 * @param {object} candidate
 * @param {object} [opts]
 */
export function scoreCandidate(candidate, opts = {}) {
  const config = opts.config || SCORE_CONFIG;
  const nowMs = opts.nowMs ?? Date.now();
  const clusterInfo = opts.clusterInfo || {};

  const local = scoreLocalRelevance(candidate, config);
  const notability = scoreNotability(candidate, config);
  const evidence = scoreEvidence(candidate, clusterInfo, config);
  const freshness = scoreFreshness(candidate, nowMs, config);
  const riskFlags = detectRiskFlags(candidate);
  const nonEvents = notability.nonEvents || detectNonEventLabels(candidate);
  const municipalProjects =
    notability.municipalProjects || detectMunicipalProjectLabels(candidate);
  const concluded = detectConcludedTimeBoundEvent(candidate, nowMs, config);

  const w = config.weights;
  let total = clamp01(
    local.score * w.localRelevance +
      notability.score * w.notability +
      evidence.score * w.evidence +
      freshness.score * w.freshness,
  );

  const reasons = [
    ...local.reasons,
    ...notability.reasons,
    ...evidence.reasons,
    ...freshness.reasons,
  ];

  if (nonEvents.length) {
    total = clamp01(total - config.nonEventTotalPenalty);
    reasons.push(`non-event total penalty -${config.nonEventTotalPenalty}`);
  }

  // Municipal facility pages: no score haircut. Rank-last ordering in run.mjs
  // is the sole demotion; keep a label reason for editor transparency.
  if (municipalProjects.length) {
    reasons.push(
      `municipal project page (review rank-last): ${municipalProjects.join(', ')}`,
    );
  }

  // Stale/untrusted ordering is handled by freshness decay + reviewRankMetric,
  // not a flat total haircut (that wrongly buried real older development news).

  // Unusable URL clusters cannot be auto-eligible (enforced below with cluster flag).
  const clusterHasUsableUrl = clusterInfo.clusterHasUsableUrl;
  const urlUsable = candidate?.urlUsable !== false;

  let tier;
  let autoPublishEligible = false;

  const isDevApp = isDevelopmentApplication(candidate);

  if (local.score < config.minLocalRelevance) {
    // Hyperlocal hard gate: an item with no Liberty Village signal is never worth
    // an editor's attention, however notable or authoritative its source.
    tier = 'reject';
    reasons.push(
      `local relevance ${local.score.toFixed(2)} < minLocalRelevance ${config.minLocalRelevance}`,
    );
  } else if (concluded.concluded) {
    // Past fixture/event previews must not surface as current follow-ups.
    tier = 'reject';
    autoPublishEligible = false;
    reasons.push(concluded.reason || 'concluded time-bound event');
  } else if (total < config.reviewMin && municipalProjects.length > 0) {
    // Municipal facility pages: keep in the review queue (ranked last), do not
    // hard-reject for a demoted total. Ranking handles editor priority.
    tier = 'review';
    autoPublishEligible = false;
    reasons.push(
      `municipal project page held for bottom-of-queue review (total ${total.toFixed(3)} < reviewMin ${config.reviewMin})`,
    );
  } else if (total < config.reviewMin) {
    tier = 'reject';
    reasons.push(`total ${total.toFixed(3)} < reviewMin ${config.reviewMin}`);
  } else if (riskFlags.length > 0) {
    tier = 'review';
    autoPublishEligible = false;
    reasons.push(`risk flags force review: ${riskFlags.join(', ')}`);
  } else if (isDevApp) {
    // Official AIC rows need human framing — never auto-publish raw application dumps.
    tier = 'review';
    autoPublishEligible = false;
    reasons.push('development application forced to review (no auto-publish)');
  } else if (
    total >= config.autoEligibleMin &&
    local.score >= 0.35 &&
    urlUsable &&
    clusterHasUsableUrl !== false
  ) {
    tier = 'auto-eligible';
    autoPublishEligible = true;
    reasons.push(`total ${total.toFixed(3)} ≥ autoEligibleMin ${config.autoEligibleMin}`);
  } else {
    tier = 'review';
    if (clusterHasUsableUrl === false || !urlUsable) {
      reasons.push('unusable URL blocks auto-eligible');
    } else {
      reasons.push(
        total >= config.autoEligibleMin
          ? 'score high but local relevance below auto bar'
          : `total ${total.toFixed(3)} in review band`,
      );
    }
  }

  if (riskFlags.length > 0) {
    autoPublishEligible = false;
    if (tier === 'auto-eligible') tier = 'review';
  }

  if (clusterHasUsableUrl === false || isDevApp) {
    autoPublishEligible = false;
    if (tier === 'auto-eligible') tier = 'review';
  }

  if (concluded.concluded) {
    autoPublishEligible = false;
    tier = 'reject';
  }

  return {
    total: Number(total.toFixed(4)),
    breakdown: {
      localRelevance: Number(local.score.toFixed(4)),
      notability: Number(notability.score.toFixed(4)),
      evidence: Number(evidence.score.toFixed(4)),
      freshness: Number(freshness.score.toFixed(4)),
    },
    riskFlags,
    nonEventLabels: nonEvents,
    municipalProjectLabels: municipalProjects,
    concludedEvent: concluded.concluded === true,
    tier,
    autoPublishEligible,
    reasons,
    localMatches: local.matches,
  };
}
