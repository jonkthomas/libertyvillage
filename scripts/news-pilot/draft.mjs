#!/usr/bin/env node
/**
 * Liberty Village news pilot — DRAFTING STAGE (local, draft-only).
 *
 * NEVER writes to data/posts.json or any site content file.
 * NEVER creates a PR, push, merge, or publish.
 * Output: .news-pilot/drafts/<timestamp>/
 *
 * Human-gated: requires explicit --cluster=<id> or --rank=<N>.
 * Does not auto-pick the top candidate.
 *
 * Usage:
 *   node scripts/news-pilot/draft.mjs --run=.news-pilot/runs/quality-9-v5-default --cluster=c0071
 *   node scripts/news-pilot/draft.mjs --run=.news-pilot/runs/quality-9-v5-default --rank=3
 *   node scripts/news-pilot/draft.mjs --run=... --cluster=c0071 --now=2026-08-08T18:00:00.000Z
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadRunArtifact,
  resolveSelectedCluster,
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
} from './draft-validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/**
 * @param {string[]} argv
 */
export function parseDraftArgs(argv) {
  const out = {
    run: null,
    cluster: null,
    rank: null,
    out: null,
    now: null,
    vault: DEFAULT_VAULT,
    root: ROOT,
    preferModel: null,
    skipGenerate: false,
    maxTokens: 12_000,
    help: false,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--run=')) out.run = a.slice('--run='.length);
    else if (a.startsWith('--cluster=')) out.cluster = a.slice('--cluster='.length);
    else if (a.startsWith('--rank=')) out.rank = Number(a.slice('--rank='.length));
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else if (a.startsWith('--now=')) out.now = a.slice('--now='.length);
    else if (a.startsWith('--vault=')) out.vault = a.slice('--vault='.length);
    else if (a.startsWith('--root=')) out.root = path.resolve(a.slice('--root='.length));
    else if (a.startsWith('--prefer-model='))
      out.preferModel = a.slice('--prefer-model='.length);
    else if (a.startsWith('--max-tokens='))
      out.maxTokens = Number(a.slice('--max-tokens='.length));
    else if (a === '--skip-generate') out.skipGenerate = true;
  }
  return out;
}

function printHelp() {
  console.log(`news-pilot draft — local draft-only stage

Usage:
  node scripts/news-pilot/draft.mjs --run=<runDir> --cluster=<clusterId>
  node scripts/news-pilot/draft.mjs --run=<runDir> --rank=<1-based>

Options:
  --run=DIR          Run artifact directory containing candidates.json
  --cluster=ID       Explicit cluster id (human gate)
  --rank=N           Explicit 1-based rank among scored representatives
  --now=ISO          Injectable clock instant (default: real now)
  --out=DIR          Output directory (default: .news-pilot/drafts/<timestamp>)
  --vault=PATH       Optional secrets vault for model keys
  --prefer-model=ID  Prefer provider id (kimi-coder, byteplus-ark, ...)
  --skip-generate    Build evidence + gate only (no model call)

Never writes data/posts.json. Output is draft-only under .news-pilot/drafts/.
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

function ensureDraftOutDir(root, explicit, nowMs) {
  const dir =
    explicit ||
    path.join(root, '.news-pilot', 'drafts', stampFromMs(nowMs));
  fs.mkdirSync(dir, { recursive: true });
  // Safety: refuse if someone aims at data/
  const resolved = path.resolve(dir);
  const dataDir = path.resolve(root, 'data');
  if (resolved === dataDir || resolved.startsWith(dataDir + path.sep)) {
    throw new Error('refusing_to_write_under_data/');
  }
  const postsPath = path.resolve(root, 'data', 'posts.json');
  if (resolved === postsPath) {
    throw new Error('refusing_to_write_posts_json');
  }
  return resolved;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(file, text) {
  fs.writeFileSync(file, String(text ?? ''), 'utf8');
}

function loadRelatedPost(root, slug) {
  if (!slug) return null;
  try {
    const posts = JSON.parse(
      fs.readFileSync(path.join(root, 'data', 'posts.json'), 'utf8'),
    );
    if (!Array.isArray(posts)) return null;
    return posts.find((p) => p.slug === slug) || null;
  } catch {
    return null;
  }
}

function renderDraftMarkdown(post, meta = {}) {
  const imageLine =
    post.image == null || post.image === ''
      ? 'image: null  # HUMAN MUST SUPPLY IMAGE BEFORE PUBLISH'
      : `image: ${JSON.stringify(post.image)}`;
  const lines = [
    '---',
    `slug: ${post.slug}`,
    `title: ${JSON.stringify(post.title)}`,
    `description: ${JSON.stringify(post.description)}`,
    `publishedAt: ${post.publishedAt}`,
    `updatedAt: ${post.updatedAt}`,
    `category: ${post.category}`,
    `author: ${post.author}`,
    `tags: ${JSON.stringify(post.tags || [])}`,
    imageLine,
    '---',
    '',
    `# ${post.title}`,
    '',
    `**Published:** ${post.publishedAt}  `,
    `**Materially updated:** ${post.updatedAt}`,
    '',
    `> ${post.answerBlock}`,
    '',
    post.content || '',
    '',
  ];
  if (meta.humanMustSupplyImage) {
    lines.push(
      '',
      '<!-- HUMAN GATE: image missing — supply a real image path before publish. Do not fabricate. -->',
      '',
    );
  }
  if (meta.model) {
    lines.push('', `<!-- draft-model: ${meta.providerId}/${meta.model} -->`, '');
  }
  return lines.join('\n');
}

/**
 * Programmatic entry used by CLI and tests.
 * @param {object} args
 * @param {object} [deps] injectable seams
 */
export async function runDraft(args, deps = {}) {
  const root = args.root || ROOT;
  const nowMs = resolveNowMs(args.now, deps.clock);
  const log = deps.log || console;

  if (!args.run) {
    return {
      ok: false,
      exitCode: 2,
      status: 'error',
      error: 'missing_--run',
      message: 'Pass --run=<dir> pointing at a discovery run artifact.',
    };
  }

  const runDir = path.isAbsolute(args.run) ? args.run : path.resolve(root, args.run);
  if (!fs.existsSync(runDir)) {
    return {
      ok: false,
      exitCode: 2,
      status: 'error',
      error: 'run_dir_missing',
      message: `Run directory not found: ${runDir}`,
    };
  }

  const artifact = (deps.loadRunArtifact || loadRunArtifact)(runDir);
  const selection = (deps.resolveSelectedCluster || resolveSelectedCluster)(
    artifact.candidates,
    { clusterId: args.cluster, rank: args.rank },
  );

  if (!selection.ok) {
    const outDir = ensureDraftOutDir(root, args.out, nowMs);
    const payload = {
      status: 'selection_required',
      ok: selection.error === 'explicit_selection_required',
      // human-gate miss is a controlled refusal when no selection provided
      exitCode: selection.error === 'explicit_selection_required' ? 0 : 2,
      error: selection.error,
      message: selection.message,
      rankedPreview: selection.rankedPreview || null,
      runDir,
      outDir,
      now: new Date(nowMs).toISOString(),
    };
    writeJson(path.join(outDir, 'selection.json'), payload);
    log.log(
      selection.error === 'explicit_selection_required'
        ? `REFUSED (human gate): ${selection.message}`
        : `ERROR: ${selection.message || selection.error}`,
    );
    if (payload.rankedPreview) {
      log.log('Top clusters (pass --cluster or --rank explicitly):');
      for (const row of payload.rankedPreview) {
        log.log(
          `  #${row.rank} ${row.clusterId} score=${row.score} [${row.decision}] ${(row.riskFlags || []).join(',') || '-'} ${row.title}`,
        );
      }
    }
    return payload;
  }

  const outDir = ensureDraftOutDir(root, args.out, nowMs);
  log.log(`Selected cluster ${selection.clusterId} (rank #${selection.rank})`);
  log.log(`Title: ${selection.representative.title}`);
  log.log(`Output: ${outDir}`);

  const evidencePack = await (deps.buildEvidencePack || buildEvidencePack)({
    representative: selection.representative,
    members: selection.members,
    clusterId: selection.clusterId,
    rank: selection.rank,
    nowMs,
    fetchFn: deps.fetchFn,
  });
  writeJson(path.join(outDir, 'evidence-pack.json'), evidencePack);
  log.log(
    `Evidence: ${evidencePack.stats.substantiveExtractions}/${evidencePack.stats.sourceRecords} substantive; ${evidencePack.stats.failedFetches} fetch failures`,
  );

  const gate = (deps.evaluateEvidenceGate || evaluateEvidenceGate)(evidencePack);
  writeJson(path.join(outDir, 'gate.json'), gate);

  if (!gate.ok) {
    const result = {
      status: 'refused',
      ok: true, // controlled success
      exitCode: 0,
      gate,
      clusterId: selection.clusterId,
      rank: selection.rank,
      title: selection.representative.title,
      outDir,
      runDir,
      now: new Date(nowMs).toISOString(),
      message: `Refused, here is why: ${gate.reasons.join(' ')}`,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    log.log(`REFUSED: ${gate.code}`);
    for (const r of gate.reasons) log.log(`  - ${r}`);
    return result;
  }

  log.log('Evidence gate: PASS');

  if (args.skipGenerate) {
    const result = {
      status: 'gate_passed_skip_generate',
      ok: true,
      exitCode: 0,
      gate,
      clusterId: selection.clusterId,
      outDir,
      runDir,
      now: new Date(nowMs).toISOString(),
    };
    writeJson(path.join(outDir, 'result.json'), result);
    return result;
  }

  // Model credentials
  hydrateModelEnvFromVault(args.vault || DEFAULT_VAULT, process.env);
  const resolved = deps.resolveModelProvider || resolveModelProvider;
  const modelResolved = await resolved(process.env, {
    prefer: args.preferModel,
    fetchFn: deps.modelFetchFn || deps.fetchFn,
  });
  const available = listAvailableModelCredentials(process.env);
  writeJson(path.join(outDir, 'model-availability.json'), {
    available: available.map((a) => ({
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
    // never write secrets
  });

  if (!modelResolved.ok) {
    const result = {
      status: 'error',
      ok: false,
      exitCode: 3,
      error: modelResolved.error,
      message: modelResolved.message,
      available,
      outDir,
      runDir,
      gate,
    };
    writeJson(path.join(outDir, 'result.json'), result);
    log.error(modelResolved.message);
    return result;
  }

  log.log(
    `Model: ${modelResolved.provider.id} / ${modelResolved.provider.model} (via $${modelResolved.envVar})`,
  );

  const siteIndex = (deps.loadSiteLinkIndex || loadSiteLinkIndex)(root);
  const internalLinkSuggestions = (
    deps.suggestInternalLinks || suggestInternalLinks
  )(evidencePack, siteIndex);
  writeJson(path.join(outDir, 'internal-link-suggestions.json'), internalLinkSuggestions);

  const relatedSlug =
    evidencePack.relatedPostSlug || evidencePack.matchingSlug || null;
  const relatedPost = loadRelatedPost(root, relatedSlug);

  const prompt = (deps.buildDraftPrompt || buildDraftPrompt)({
    evidencePack,
    internalLinkSuggestions,
    relatedPost,
    nowMs,
  });
  // Persist prompt without secrets (prompt has evidence only)
  writeJson(path.join(outDir, 'prompt.json'), {
    system: prompt.system,
    user: JSON.parse(prompt.userText),
  });

  const generation = await (deps.generateDraftWithModel || generateDraftWithModel)({
    resolved: modelResolved,
    system: prompt.system,
    userText: prompt.userText,
    // k3 thinking + full article JSON needs headroom; 4500 truncated live output.
    maxTokens: args.maxTokens || 12_000,
    fetchFn: deps.modelFetchFn,
  });
  writeJson(path.join(outDir, 'model-response-meta.json'), {
    ok: generation.ok,
    providerId: generation.providerId,
    model: generation.model,
    error: generation.error || null,
    usage: generation.usage || null,
    // raw text saved separately; never includes API key
  });

  if (!generation.ok) {
    const result = {
      status: 'error',
      ok: false,
      exitCode: 3,
      error: generation.error,
      detail: generation.detail || null,
      outDir,
      gate,
      model: {
        providerId: generation.providerId,
        model: generation.model,
      },
    };
    writeJson(path.join(outDir, 'result.json'), result);
    log.error(`Model generation failed: ${generation.error}`);
    return result;
  }

  writeText(path.join(outDir, 'model-raw.txt'), generation.text || '');

  const parsed = (deps.parseModelJson || parseModelJson)(generation.text);
  if (!parsed.ok) {
    const result = {
      status: 'validation_failed',
      ok: false,
      exitCode: 4,
      error: parsed.error,
      detail: parsed.detail || null,
      outDir,
      message: 'Model returned non-JSON or unparseable draft.',
    };
    writeJson(path.join(outDir, 'result.json'), result);
    writeJson(path.join(outDir, 'validation-report.json'), {
      ok: false,
      failures: [{ code: parsed.error, message: parsed.detail || parsed.error }],
      checks: [],
    });
    log.error(`Parse failed: ${parsed.error}`);
    return result;
  }

  const normalized = normalizeModelDraftPayload(parsed.value);
  if (!normalized.ok) {
    const result = {
      status: 'validation_failed',
      ok: false,
      exitCode: 4,
      error: normalized.error,
      outDir,
    };
    writeJson(path.join(outDir, 'validation-report.json'), {
      ok: false,
      failures: [{ code: normalized.error, message: 'Could not find post object in model JSON' }],
    });
    writeJson(path.join(outDir, 'result.json'), result);
    return result;
  }

  const repaired = repairInternalLinkFields(normalized.post, siteIndex);
  const imageNorm = normalizeDraftImageField(repaired.post);
  // Code-enforced run dates — model cannot backdate frontmatter to a source article date.
  const dated = enforceRunDates(
    imageNorm.post,
    normalized.newsArticleStructuredData,
    nowMs,
  );
  const repairedPost = dated.post;
  const structuredData = dated.newsArticleStructuredData;

  const validation = (deps.validateDraft || validateDraft)({
    post: repairedPost,
    newsArticleStructuredData: structuredData,
    evidencePack,
    siteIndex,
    nowMs,
    repairWarnings: repaired.warnings || [],
  });
  writeJson(path.join(outDir, 'validation-report.json'), validation);
  writeJson(path.join(outDir, 'draft.json'), {
    post: repairedPost,
    newsArticleStructuredData: structuredData,
    citations: normalized.citations,
    ungroundedRiskNotes: normalized.ungroundedRiskNotes,
    humanMustSupplyImage: imageNorm.humanMustSupplyImage,
    imageStatus: imageNorm.imageStatus,
    runDate: dated.runDate,
    repairWarnings: repaired.warnings || [],
  });
  writeText(
    path.join(outDir, 'draft.md'),
    renderDraftMarkdown(repairedPost, {
      providerId: generation.providerId,
      model: generation.model,
      humanMustSupplyImage: imageNorm.humanMustSupplyImage,
    }),
  );

  // Optional citations file
  writeJson(path.join(outDir, 'citations.json'), normalized.citations || []);

  const publishReady = Boolean(validation.publishReady);
  const result = {
    status: validation.ok ? 'drafted' : 'validation_failed',
    ok: validation.ok,
    publishReady,
    exitCode: validation.ok ? 0 : 4,
    clusterId: selection.clusterId,
    rank: selection.rank,
    title: selection.representative.title,
    outDir,
    runDir,
    now: new Date(nowMs).toISOString(),
    runDate: dated.runDate,
    model: {
      providerId: generation.providerId,
      model: generation.model,
      envVar: modelResolved.envVar,
    },
    gate,
    validation: {
      ok: validation.ok,
      publishReady,
      failureCodes: validation.failures.map((f) => f.code),
      humanGates: (validation.humanGates || []).map((g) => g.code),
      warningCodes: (validation.warnings || []).map((w) => w.code),
      checks: validation.checks.map((c) => ({ code: c.code, ok: c.ok })),
    },
    humanMustSupplyImage: imageNorm.humanMustSupplyImage,
    ungroundedRiskNotes: normalized.ungroundedRiskNotes || [],
    draftPath: path.join(outDir, 'draft.md'),
    postSlug: repairedPost?.slug || null,
    message: !validation.ok
      ? `Draft FAILED validation: ${validation.failures.map((f) => f.code).join(', ')}`
      : publishReady
        ? 'Draft written (local only). Not published.'
        : `Draft written (local only). NOT publish-ready: ${(validation.humanGates || []).map((g) => g.code).join(', ')}`,
  };
  writeJson(path.join(outDir, 'result.json'), result);

  if (validation.ok) {
    log.log(publishReady ? 'Validation: PASS (publish-ready)' : 'Validation: PASS (human gates remain)');
    if (!publishReady) {
      for (const g of validation.humanGates || []) {
        log.log(`  - human-gate ${g.code}: ${g.message}`);
      }
    }
    if ((validation.warnings || []).length) {
      log.log(`Repair warnings: ${validation.warnings.length}`);
      for (const w of validation.warnings) {
        log.log(`  - ${w.code}: ${w.message}`);
      }
    }
    log.log(`Draft: ${result.draftPath}`);
    log.log(`Run date stamped: ${dated.runDate}`);
  } else {
    log.log('Validation: FAIL');
    for (const f of validation.failures) {
      log.log(`  - ${f.code}: ${f.message}`);
    }
  }

  return result;
}

async function main(argv) {
  const args = parseDraftArgs(argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  try {
    const result = await runDraft(args);
    process.exit(result.exitCode ?? (result.ok ? 0 : 1));
  } catch (e) {
    console.error(`draft failed: ${e?.message || e}`);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main(process.argv.slice(2));
}
