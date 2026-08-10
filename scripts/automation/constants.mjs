export const GATE_MODEL = 'claude-opus-5';
export const FIXER_MODEL = 'claude-sonnet-4-5-20250929';
export const SCORE_THRESHOLD = 8;
export const MAX_REPAIRS = 3;

export const STATUS_CONTEXTS = Object.freeze({
  ci: 'automation/ci',
  gate: 'automation/opus-gate',
});

export const TRUSTED_PR_AUTHORS = Object.freeze(['github-actions[bot]']);
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
    allowedPaths: ['data/posts.json', 'public/images/blog/', 'tasks/seo-data-latest.json', 'tasks/auto-blog-runs/'],
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
    allowedPaths: ['data/businesses.json', 'public/images/businesses/', 'tasks/discovery-runs/'],
    repairablePaths: ['data/businesses.json'],
    maxFiles: 20,
    maxRepairBytes: 300_000,
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
