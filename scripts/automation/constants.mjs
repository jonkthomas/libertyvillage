export const GATE_MODEL = 'claude-opus-5';
export const FIXER_MODEL = 'claude-sonnet-4-5-20250929';
export const SCORE_THRESHOLD = 8;
export const MAX_REPAIRS = 3;
// Bounded redispatches of one coordinator run after a transient infrastructure or
// model failure (F7). The third failure ends in a visible block, never a hot loop.
export const MAX_TRANSIENT_RETRIES = 2;
// Bounded automatic merges of staging into a conflicted generator branch; the
// third conflict falls through to block-generator because the content needs eyes.
export const MAX_HEALS = 2;

const PUBLISH_STATUS_CONTEXTS = Object.freeze({
  ci: 'automation/ci',
  gate: 'automation/opus-gate',
});

export const STATUS_CONTEXTS = Object.freeze({
  publish: PUBLISH_STATUS_CONTEXTS,
  wait: Object.freeze({
    ...PUBLISH_STATUS_CONTEXTS,
    vercel: 'Vercel',
  }),
});

export const TRUSTED_PR_AUTHORS = Object.freeze(['github-actions[bot]']);

// Single binding site for the controlled labels the coordinator writes and the
// sentinel reads. Duplicating either string is how a blocked PR goes invisible.
export const BLOCKED_LABEL = 'automation-blocked';
export const ABANDONED_LABEL = 'automation-abandoned';
export const TERMINAL_LABELS = Object.freeze([BLOCKED_LABEL, ABANDONED_LABEL]);
export const ALLOW_RECORD_DELETION_LABEL = 'allow-record-deletion';
export const BLOCKING_SEVERITIES = Object.freeze(['critical', 'high']);
export const ALL_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low']);

const GENERATOR_POLICIES = {
  seo: {
    base: 'staging',
    headPrefixes: ['seo/auto-'],
    allowedPaths: ['app/', 'components/', 'data/', 'lib/', 'public/images/'],
    repairablePaths: ['app/', 'components/', 'data/', 'lib/'],
    maxFiles: 15,
    maxRepairBytes: 300_000,
  },
  blog: {
    base: 'staging',
    headPrefixes: ['blog/auto-'],
    // Content only. Provenance (tasks/seo-data-latest.json, tasks/auto-blog-runs/)
    // is scored by the gate but structurally unrepairable by the fixer, so it goes
    // to the run's step summary instead of into the PR (F2, ticket 1a).
    allowedPaths: ['data/posts.json', 'public/images/blog/'],
    repairablePaths: ['data/posts.json'],
    maxFiles: 20,
    maxRepairBytes: 300_000,
  },
  // Content-only ship onto main after staging-context generation/lint.
  // Do not mutate `blog` (GHA rollback) or `promotion` (human/G9, off under exedev).
  'blog-live': {
    base: 'main',
    headPrefixes: ['blog/auto-'],
    allowedPaths: ['data/posts.json', 'public/images/blog/'],
    repairablePaths: ['data/posts.json'],
    maxFiles: 20,
    maxRepairBytes: 300_000,
  },
  // Rare autonomous local-news appends. Content-only PRs into staging; same
  // Opus gate as blog. Images use an existing neutral OG asset (no new files).
  news: {
    base: 'staging',
    headPrefixes: ['news/auto-'],
    allowedPaths: ['data/posts.json'],
    repairablePaths: ['data/posts.json'],
    maxFiles: 5,
    maxRepairBytes: 300_000,
  },
  business: {
    base: 'staging',
    headPrefixes: ['auto/business-discovery'],
    // discovery-seen.json is the append-only registry the generator writes so
    // curated-out records are never re-discovered; it ships in the same PR.
    // Same invariant as blog: every non-image path in the scored diff must be one
    // the fixer can repair, so tasks/discovery-runs/ provenance stays out of the PR.
    allowedPaths: [
      'data/businesses.json', 'data/discovery-seen.json',
      'public/images/businesses/',
    ],
    repairablePaths: ['data/businesses.json', 'data/discovery-seen.json'],
    maxFiles: 20,
    maxRepairBytes: 300_000,
  },
  // Queue maintenance is reviewed and merged through the shared coordinator,
  // but it is not an article candidate and must never consume or mutate a
  // blog/SEO candidate ladder.
  'topic-discovery': {
    base: 'staging',
    headPrefixes: ['auto/topic-discovery-'],
    allowedPaths: ['data/topic-queue.json'],
    repairablePaths: [],
    maxFiles: 1,
    maxRepairBytes: 0,
    candidateLadder: false,
    noFixer: true,
  },
};

export const KIND_POLICIES = Object.freeze({
  ...GENERATOR_POLICIES,
  promotion: {
    base: 'main',
    exactHead: 'staging',
    headPrefixes: ['staging'],
    allowedPaths: [
      'app/', 'components/', 'data/', 'lib/', 'public/',
      'ops/exedev-supervisor/owner.txt',
      'tasks/seo-data-latest.json', 'tasks/auto-blog-runs/', 'tasks/discovery-runs/',
    ],
    repairablePaths: [],
    maxFiles: 100,
    maxRepairBytes: 0,
  },
});

export const FORBIDDEN_PATH_PREFIXES = Object.freeze([
  '.github/',
  'scripts/',
  'docs/',
  '.git/',
  '.claude/',
]);

export const FORBIDDEN_PATHS = Object.freeze([
  'package.json',
  'package-lock.json',
  'next.config.ts',
  'vercel.json',
  'tsconfig.json',
  'eslint.config.mjs',
]);
