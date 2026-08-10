#!/usr/bin/env node
/**
 * Liberty Village news pilot — AUTONOMOUS PUBLISH PATH (rare + certain).
 *
 * Takes a discovery run, applies the strict auto-publish gate, and for at most
 * ONE qualifying story: drafts via the existing drafting stage, re-validates,
 * assigns a verified image (draft path or neutral OG fallback), and appends
 * exactly one post to data/posts.json.
 *
 * Zero qualifying stories exits 0 — that is success, not failure.
 *
 * Safety:
 *  - never overwrites an existing slug
 *  - atomic write + parse + count checks
 *  - does not weaken draft validation, SSRF, quote, or evidence gates
 *  - human review path remains unchanged
 *
 * Usage:
 *   node scripts/news-pilot/publish.mjs --run=.news-pilot/runs/<dir>
 *   node scripts/news-pilot/publish.mjs --run=... --dry-run
 *   node scripts/news-pilot/publish.mjs --run=... --now=2026-08-10T18:00:00.000Z
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadRunArtifact,
  buildEvidencePack,
  loadSiteLinkIndex,
  suggestInternalLinks,
} from './draft-evidence.mjs';
import { evaluateEvidenceGate } from './draft-gate.mjs';
import {
  resolveModelProvider,
  buildDraftPrompt,
  generateDraftWithModel,
  parseModelJson,
  listAvailableModelCredentials,
  hydrateModelEnvFromVault,
  DEFAULT_VAULT,
} from './draft-model.mjs';
import {
  validateDraft,
  normalizeModelDraftPayload,
  repairInternalLinkFields,
  enforceRunDates,
  normalizeDraftImageField,
  createLocalImageExists,
  runDateIso,
} from './draft-validate.mjs';
import {
  AUTO_PUBLISH_CONFIG,
  evaluateAutoPublishEligibility,
  evaluatePublishReadyDraft,
  prefilterAutoPublishCandidate,
  rankAutoPublishCandidates,
  readPostsJson,
  resolveAutoPublishImage,
  countAutoPublishesOnRunDate,
} from './publish-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/**
 * @param {string[]} argv
 */
export function parsePublishArgs(argv) {
  const out = {
    run: null,
    out: null,
    now: null,
    vault: DEFAULT_VAULT,
    root: ROOT,
    preferModel: null,
    dryRun: false,
    skipGenerate: false,
    maxTokens: 12_000,
    maxCandidates: 25,
    help: false,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-generate') out.skipGenerate = true;
    else if (a.startsWith('--run=')) out.run = a.slice('--run='.length);
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else if (a.startsWith('--now=')) out.now = a.slice('--now='.length);
    else if (a.startsWith('--vault=')) out.vault = a.slice('--vault='.length);
    else if (a.startsWith('--root=')) out.root = path.resolve(a.slice('--root='.length));
    else if (a.startsWith('--prefer-model='))
      out.preferModel = a.slice('--prefer-model='.length);
    else if (a.startsWith('--max-tokens='))
      out.maxTokens = Number(a.slice('--max-tokens='.length));
    else if (a.startsWith('--max-candidates='))
      out.maxCandidates = Number(a.slice('--max-candidates='.length));
  }
  return out;
}

function printHelp() {
  console.log(`news-pilot publish — autonomous publish (rare + certain)

Usage:
  node scripts/news-pilot/publish.mjs --run=<runDir>
  node scripts/news-pilot/publish.mjs --run=<runDir> --dry-run

Options:
  --run=DIR           Discovery run with candidates.json
  --now=ISO           Injectable clock (default: real now)
  --out=DIR           Output directory (default: .news-pilot/publish/<stamp>)
  --dry-run           Evaluate + draft path without writing data/posts.json
  --skip-generate     Stop after eligibility (no model call)
  --prefer-model=ID   Model provider preference
  --vault=PATH        Optional secrets vault (CI: /dev/null)
  --root=DIR          Repo root (tests)

Zero published is a successful exit (code 0).
At most one post per run-date. Never overwrites slugs.
`);
}

/**
 * @param {string|null|undefined} nowArg
 * @param {() => number} [clock]
 */
export function resolveNowMs(nowArg, clock = () => Date.now()) {
  if (nowArg == null || nowArg === '') return clock();
  const ms = Date.parse(nowArg);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid --now value: ${nowArg}`);
  }
  return ms;
}

function stampFromMs(nowMs) {
  return new Date(nowMs).toISOString().replace(/[:.]/g, '-');
}

export function ensurePublishOutDir(root, explicit, nowMs) {
  const dir =
    explicit || path.join(root, '.news-pilot', 'publish', stampFromMs(nowMs));
  const resolved = path.resolve(dir);
  const dataDir = path.resolve(root, 'data');
  if (resolved === dataDir || resolved.startsWith(dataDir + path.sep)) {
    throw new Error('refusing_to_write_publish_artifacts_under_data/');
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function loadRelatedPost(root, slug) {
  if (!slug) return null;
  try {
    const { posts } = readPostsJson(root);
    return posts.find((p) => p.slug === slug) || null;
  } catch {
    return null;
  }
}

/**
 * Append exactly one post atomically. Refuses if slug exists or count wrong.
 * @param {string} root
 * @param {object} post
 * @param {{ dryRun?: boolean }} [opts]
 */
export function appendPostToPostsJson(root, post, opts = {}) {
  const file = path.join(root, 'data', 'posts.json');
  const raw = fs.readFileSync(file, 'utf8');
  const posts = JSON.parse(raw);
  if (!Array.isArray(posts)) {
    throw new Error('posts_json_not_array');
  }
  const before = posts.length;
  if (!post || typeof post !== 'object' || Array.isArray(post)) {
    throw new Error('post_not_object');
  }
  if (!post.slug || typeof post.slug !== 'string') {
    throw new Error('post_missing_slug');
  }
  if (posts.some((p) => p?.slug === post.slug)) {
    const err = new Error(`slug_exists:${post.slug}`);
    err.code = 'slug_exists';
    throw err;
  }

  const next = [...posts, post];
  if (next.length !== before + 1) {
    throw new Error('post_count_invariant');
  }

  // Preserve existing formatting convention: 2-space indent + trailing newline.
  const text = `${JSON.stringify(next, null, 2)}\n`;
  // Validate before touch.
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length !== before + 1) {
    throw new Error('serialized_posts_invalid');
  }
  if (parsed[parsed.length - 1]?.slug !== post.slug) {
    throw new Error('serialized_slug_mismatch');
  }

  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      before,
      after: before + 1,
      slug: post.slug,
      file,
    };
  }

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, 'utf8');
  // Re-read lock check: refuse if file changed under us.
  const currentRaw = fs.readFileSync(file, 'utf8');
  if (currentRaw !== raw) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw new Error('posts_json_changed_during_write');
  }
  fs.renameSync(tmp, file);

  // Post-condition
  const verify = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(verify) || verify.length !== before + 1) {
    throw new Error('post_write_verify_count_failed');
  }
  if (verify.some((p, i) => i < before && p?.slug === post.slug && verify[before]?.slug !== post.slug)) {
    throw new Error('post_write_verify_overwrite');
  }
  if (verify[before]?.slug !== post.slug) {
    throw new Error('post_write_verify_slug');
  }

  return {
    ok: true,
    dryRun: false,
    before,
    after: before + 1,
    slug: post.slug,
    file,
  };
}

/**
 * Apply auto-publish tags + image + category defaults onto a validated post.
 * @param {object} post
 * @param {{ image: string, nowMs: number, clusterId?: string, config?: typeof AUTO_PUBLISH_CONFIG }} opts
 */
export function finalizeAutoPublishPost(post, opts) {
  const config = opts.config || AUTO_PUBLISH_CONFIG;
  const runDate = runDateIso(opts.nowMs);
  const tags = Array.isArray(post.tags) ? [...post.tags] : [];
  if (!tags.includes(config.autoPublishTag)) tags.push(config.autoPublishTag);
  if (opts.clusterId && !tags.includes(`cluster:${opts.clusterId}`)) {
    tags.push(`cluster:${opts.clusterId}`);
  }
  return {
    ...post,
    category: 'news',
    publishedAt: runDate,
    updatedAt: runDate,
    image: opts.image,
    tags,
    author: post.author || 'LibertyVillage.co',
  };
}

/**
 * Programmatic entry used by CLI and tests.
 * @param {object} args
 * @param {object} [deps]
 */
export async function runPublish(args, deps = {}) {
  const root = args.root || ROOT;
  const nowMs = resolveNowMs(args.now, deps.clock);
  const log = deps.log || console;
  const config = deps.config || AUTO_PUBLISH_CONFIG;
  const outDir = ensurePublishOutDir(root, args.out, nowMs);

  const baseResult = {
    ok: true,
    exitCode: 0,
    status: 'no_publish',
    published: 0,
    dryRun: Boolean(args.dryRun),
    outDir,
    runDir: null,
    now: new Date(nowMs).toISOString(),
    runDate: runDateIso(nowMs),
    config: {
      minScore: config.minScore,
      maxPerDay: config.maxPerDay,
      neutralFallbackImage: config.neutralFallbackImage,
    },
  };

  if (!args.run) {
    const result = {
      ...baseResult,
      ok: false,
      exitCode: 2,
      status: 'error',
      error: 'missing_--run',
      message: 'Pass --run=<dir> pointing at a discovery run artifact.',
    };
    writeJson(path.join(outDir, 'result.json'), result);
    return result;
  }

  const runDir = path.isAbsolute(args.run) ? args.run : path.resolve(root, args.run);
  baseResult.runDir = runDir;
  if (!fs.existsSync(runDir)) {
    const result = {
      ...baseResult,
      ok: false,
      exitCode: 2,
      status: 'error',
      error: 'run_dir_missing',
      message: `Run directory not found: ${runDir}`,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    return result;
  }

  const { posts } = (deps.readPostsJson || readPostsJson)(root);
  const priorAuto = countAutoPublishesOnRunDate(posts, nowMs, config);
  if (priorAuto >= config.maxPerDay) {
    const result = {
      ...baseResult,
      status: 'daily_cap_reached',
      message: `Already ${priorAuto} auto-publish(es) on ${runDateIso(nowMs)}; publishing zero is success.`,
      evaluations: [],
    };
    writeJson(path.join(outDir, 'result.json'), result);
    log.log(result.message);
    return result;
  }

  const artifact = (deps.loadRunArtifact || loadRunArtifact)(runDir);
  const ranked = rankAutoPublishCandidates(artifact.candidates).slice(
    0,
    Math.max(1, Number(args.maxCandidates) || 25),
  );
  writeJson(path.join(outDir, 'ranked-candidates.json'), {
    count: ranked.length,
    items: ranked.map((c, i) => ({
      rank: i + 1,
      clusterId: c.clusterId,
      title: c.title,
      score: c.score?.total ?? null,
      decision: c.decision || c.score?.tier || null,
      riskFlags: c.score?.riskFlags || c.riskFlags || [],
      coverageRelation: c.coverageRelation || null,
      alreadyCovered: c.alreadyCovered === true,
    })),
  });

  /** @type {object[]} */
  const evaluations = [];
  let selected = null;
  let selectedEvidence = null;
  let selectedEligibility = null;

  for (const candidate of ranked) {
    const pre = prefilterAutoPublishCandidate(candidate, {
      nowMs,
      posts,
      config,
    });
    const row = {
      clusterId: candidate.clusterId,
      title: candidate.title,
      score: candidate.score?.total ?? null,
      prefilter: pre,
      eligibility: null,
      gate: null,
    };
    if (!pre.ok) {
      evaluations.push(row);
      continue;
    }

    log.log(
      `Considering ${candidate.clusterId} score=${candidate.score?.total} — building evidence…`,
    );
    const members = (artifact.candidates || []).filter(
      (c) => c.clusterId === candidate.clusterId,
    );
    const evidencePack = await (deps.buildEvidencePack || buildEvidencePack)({
      representative: candidate,
      members: members.length ? members : [candidate],
      clusterId: candidate.clusterId,
      rank: evaluations.length + 1,
      nowMs,
      fetchFn: deps.fetchFn,
    });
    writeJson(
      path.join(outDir, `evidence-${candidate.clusterId}.json`),
      evidencePack,
    );

    const gate = (deps.evaluateEvidenceGate || evaluateEvidenceGate)(evidencePack);
    row.gate = { ok: gate.ok, code: gate.code, reasons: gate.reasons };
    if (!gate.ok) {
      row.eligibility = {
        ok: false,
        code: 'evidence_gate',
        reasons: gate.reasons,
      };
      evaluations.push(row);
      continue;
    }

    const eligibility = evaluateAutoPublishEligibility({
      candidate,
      evidencePack,
      nowMs,
      posts,
      config,
    });
    row.eligibility = eligibility;
    evaluations.push(row);

    if (eligibility.ok) {
      selected = candidate;
      selectedEvidence = evidencePack;
      selectedEligibility = eligibility;
      break;
    }
  }

  writeJson(path.join(outDir, 'evaluations.json'), evaluations);

  if (!selected) {
    const result = {
      ...baseResult,
      status: 'no_eligible_candidate',
      message:
        'No story met the autonomous publish bar. Publishing zero is success.',
      evaluations,
      considered: evaluations.length,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    log.log(result.message);
    return result;
  }

  writeJson(path.join(outDir, 'selected.json'), {
    clusterId: selected.clusterId,
    title: selected.title,
    score: selected.score,
    eligibility: selectedEligibility,
  });
  log.log(
    `Eligible: ${selected.clusterId} — ${selected.title} (score ${selected.score?.total})`,
  );

  if (args.skipGenerate) {
    const result = {
      ...baseResult,
      status: 'eligible_skip_generate',
      message: 'Candidate eligible; skipped generation as requested.',
      clusterId: selected.clusterId,
      title: selected.title,
      eligibility: selectedEligibility,
      evaluations,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    return result;
  }

  // --- Draft (reuse drafting stage primitives; no human --cluster flag needed here) ---
  hydrateModelEnvFromVault(args.vault || DEFAULT_VAULT, process.env);
  const modelResolved = await (deps.resolveModelProvider || resolveModelProvider)(
    process.env,
    {
      prefer: args.preferModel,
      fetchFn: deps.modelFetchFn || deps.fetchFn,
    },
  );
  writeJson(path.join(outDir, 'model-availability.json'), {
    available: listAvailableModelCredentials(process.env).map((a) => ({
      id: a.id,
      model: a.model,
      present: a.present,
      envVar: a.envVar,
    })),
    selected: modelResolved.ok
      ? {
          id: modelResolved.provider.id,
          model: modelResolved.provider.model,
          envVar: modelResolved.envVar,
        }
      : null,
  });

  if (!modelResolved.ok) {
    const result = {
      ...baseResult,
      ok: false,
      exitCode: 3,
      status: 'error',
      error: modelResolved.error,
      message: modelResolved.message,
      clusterId: selected.clusterId,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    log.error(modelResolved.message);
    return result;
  }

  const siteIndex = (deps.loadSiteLinkIndex || loadSiteLinkIndex)(root);
  const internalLinkSuggestions = (
    deps.suggestInternalLinks || suggestInternalLinks
  )(selectedEvidence, siteIndex);
  const relatedSlug =
    selectedEvidence.relatedPostSlug || selectedEvidence.matchingSlug || null;
  const relatedPost = loadRelatedPost(root, relatedSlug);
  const prompt = (deps.buildDraftPrompt || buildDraftPrompt)({
    evidencePack: selectedEvidence,
    internalLinkSuggestions,
    relatedPost,
    nowMs,
  });
  writeJson(path.join(outDir, 'prompt.json'), {
    system: prompt.system,
    user: JSON.parse(prompt.userText),
  });

  const generation = await (deps.generateDraftWithModel || generateDraftWithModel)({
    resolved: modelResolved,
    system: prompt.system,
    userText: prompt.userText,
    maxTokens: args.maxTokens || 12_000,
    fetchFn: deps.modelFetchFn,
  });
  writeJson(path.join(outDir, 'model-response-meta.json'), {
    ok: generation.ok,
    providerId: generation.providerId,
    model: generation.model,
    error: generation.error || null,
    usage: generation.usage || null,
  });

  if (!generation.ok) {
    const result = {
      ...baseResult,
      ok: false,
      exitCode: 3,
      status: 'error',
      error: generation.error,
      message: `Model generation failed: ${generation.error}`,
      clusterId: selected.clusterId,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    return result;
  }

  fs.writeFileSync(path.join(outDir, 'model-raw.txt'), generation.text || '', 'utf8');
  const parsed = (deps.parseModelJson || parseModelJson)(generation.text);
  if (!parsed.ok) {
    const result = {
      ...baseResult,
      ok: false,
      exitCode: 4,
      status: 'validation_failed',
      error: parsed.error,
      message: 'Model returned non-JSON or unparseable draft.',
      clusterId: selected.clusterId,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    return result;
  }

  const normalized = normalizeModelDraftPayload(parsed.value);
  if (!normalized.ok) {
    const result = {
      ...baseResult,
      ok: false,
      exitCode: 4,
      status: 'validation_failed',
      error: normalized.error,
      clusterId: selected.clusterId,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    return result;
  }

  const repaired = repairInternalLinkFields(normalized.post, siteIndex);
  const imageExists = deps.imageExists || createLocalImageExists(root);
  const imageNorm = normalizeDraftImageField(repaired.post, { imageExists });
  const dated = enforceRunDates(
    imageNorm.post,
    normalized.newsArticleStructuredData,
    nowMs,
  );

  const validation = (deps.validateDraft || validateDraft)({
    post: dated.post,
    newsArticleStructuredData: dated.newsArticleStructuredData,
    evidencePack: selectedEvidence,
    siteIndex,
    nowMs,
    repairWarnings: repaired.warnings || [],
    imageExists,
  });
  writeJson(path.join(outDir, 'validation-report.json'), validation);

  // Image: draft may omit image (human gate in draft stage). Autopublish applies
  // verified neutral fallback rather than fabricating a per-event path.
  const ready = evaluatePublishReadyDraft({
    validation,
    post: dated.post,
    root,
    nowMs,
    posts,
    imageExists,
    config,
  });
  writeJson(path.join(outDir, 'publish-ready.json'), ready);

  if (!ready.ok) {
    const result = {
      ...baseResult,
      status: 'not_publish_ready',
      ok: true, // controlled non-publish is success for the daily job
      exitCode: 0,
      message: `Eligible candidate failed final publish gate: ${ready.code}. Publishing zero is success.`,
      clusterId: selected.clusterId,
      title: selected.title,
      ready,
      validation: {
        ok: validation.ok,
        failureCodes: (validation.failures || []).map((f) => f.code),
        humanGates: (validation.humanGates || []).map((g) => g.code),
      },
      evaluations,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    writeJson(path.join(outDir, 'draft.json'), {
      post: dated.post,
      newsArticleStructuredData: dated.newsArticleStructuredData,
      humanMustSupplyImage: imageNorm.humanMustSupplyImage,
    });
    log.log(result.message);
    return result;
  }

  const finalPost = finalizeAutoPublishPost(dated.post, {
    image: ready.image,
    nowMs,
    clusterId: selected.clusterId,
    config,
  });

  // Re-validate with the image that will actually ship (fallback may have been applied).
  const finalValidation = (deps.validateDraft || validateDraft)({
    post: finalPost,
    newsArticleStructuredData: dated.newsArticleStructuredData
      ? {
          ...dated.newsArticleStructuredData,
          image: finalPost.image
            ? `https://libertyvillage.co${finalPost.image}`
            : dated.newsArticleStructuredData.image,
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: finalPost.title,
          datePublished: finalPost.publishedAt,
          dateModified: finalPost.updatedAt,
        },
    evidencePack: selectedEvidence,
    siteIndex,
    nowMs,
    repairWarnings: repaired.warnings || [],
    imageExists,
  });
  writeJson(path.join(outDir, 'final-validation-report.json'), finalValidation);

  if (!finalValidation.ok || !finalValidation.publishReady) {
    const result = {
      ...baseResult,
      status: 'not_publish_ready',
      ok: true,
      exitCode: 0,
      message:
        'Final validation after image assignment did not reach publishReady. Publishing zero is success.',
      clusterId: selected.clusterId,
      validation: {
        ok: finalValidation.ok,
        publishReady: finalValidation.publishReady,
        failureCodes: (finalValidation.failures || []).map((f) => f.code),
        humanGates: (finalValidation.humanGates || []).map((g) => g.code),
      },
    };
    writeJson(path.join(outDir, 'result.json'), result);
    log.log(result.message);
    return result;
  }

  writeJson(path.join(outDir, 'post.json'), finalPost);

  let writeResult;
  try {
    writeResult = (deps.appendPostToPostsJson || appendPostToPostsJson)(
      root,
      finalPost,
      { dryRun: Boolean(args.dryRun) },
    );
  } catch (e) {
    const result = {
      ...baseResult,
      ok: false,
      exitCode: 5,
      status: 'error',
      error: e?.code || e?.message || String(e),
      message: `Refused unsafe posts.json write: ${e?.message || e}`,
      clusterId: selected.clusterId,
      slug: finalPost.slug,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    log.error(result.message);
    return result;
  }

  const result = {
    ...baseResult,
    status: args.dryRun ? 'dry_run_publish' : 'published',
    published: args.dryRun ? 0 : 1,
    wouldPublish: 1,
    message: args.dryRun
      ? `Dry-run: would append slug ${finalPost.slug} (posts.json untouched).`
      : `Published slug ${finalPost.slug} (posts ${writeResult.before} → ${writeResult.after}).`,
    clusterId: selected.clusterId,
    title: finalPost.title,
    slug: finalPost.slug,
    image: finalPost.image,
    imageSource: ready.imageSource,
    eligibility: selectedEligibility,
    write: writeResult,
    model: {
      providerId: generation.providerId,
      model: generation.model,
      envVar: modelResolved.envVar,
    },
    evaluations,
  };
  writeJson(path.join(outDir, 'result.json'), result);
  log.log(result.message);
  return result;
}

async function main(argv) {
  const args = parsePublishArgs(argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  try {
    const result = await runPublish(args);
    process.exit(result.exitCode ?? (result.ok ? 0 : 1));
  } catch (e) {
    console.error(`publish failed: ${e?.message || e}`);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main(process.argv.slice(2));
}
