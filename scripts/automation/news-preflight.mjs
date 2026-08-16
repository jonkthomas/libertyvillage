#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadSiteLinkIndex } from '../news-pilot/draft-evidence.mjs';
import { validateDraft, createLocalImageExists } from '../news-pilot/draft-validate.mjs';
import { AUTO_PUBLISH_CONFIG, evaluatePublishReadyDraft } from '../news-pilot/publish-gate.mjs';
import { FIXER_MODEL, GATE_MODEL, MAX_REPAIRS, SCORE_THRESHOLD, BLOCKING_SEVERITIES } from './constants.mjs';
import { writeOutput } from './github.mjs';
import { planRecordEntries, POSTS_FILE } from './record-repair.mjs';
import { assertAppendOnlyPostsChange, preflightDecision, validatePostRepair } from './preflight.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function childEnv() {
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  return env;
}

function defaultReview({ root, diffPath, evidencePath, contentSha, verdictPath }) {
  execFileSync('node', [
    'scripts/automation/review-agent.mjs', 'review-content', '--kind', 'news',
    '--diff', diffPath, '--evidence', evidencePath, '--content-sha', contentSha, '--out', verdictPath,
  ], { cwd: root, env: childEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
  return JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
}

function defaultFix({ root, postPath, verdictPath, repairPath }) {
  execFileSync('node', [
    'scripts/automation/review-agent.mjs', 'fix-content', '--kind', 'news',
    '--post', postPath, '--verdict', verdictPath, '--out', repairPath,
  ], { cwd: root, env: childEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
  return JSON.parse(fs.readFileSync(repairPath, 'utf8'));
}

function trimEvidence(value) {
  const full = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(full) <= 200_000) return value;
  const sources = Array.isArray(value?.sources) ? value.sources : [];
  return {
    clusterId: value?.clusterId,
    generatedAt: value?.generatedAt,
    sources: sources.map((source) => ({
      url: source?.url, publisher: source?.publisher || source?.source,
      publishedAt: source?.publishedAt || source?.date,
      title: source?.title, snippet: String(source?.snippet || source?.text || '').slice(0, 2_000),
    })),
  };
}

function structuredData(post) {
  return {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: post.title,
    datePublished: post.publishedAt, dateModified: post.updatedAt,
    ...(post.image ? { image: `https://libertyvillage.co${post.image}` } : {}),
  };
}

export async function runPreflight(args, deps = {}) {
  const root = path.resolve(args.root || ROOT);
  const postsPath = path.resolve(root, args.posts || 'data/posts.json');
  const baselineText = fs.readFileSync(args.baseline, 'utf8');
  const outDir = path.resolve(args.out);
  const publishOut = path.resolve(args.publishOut);
  const output = deps.writeOutput || writeOutput;
  const clock = deps.clock || (() => Date.now());
  const deadline = clock() + Number(args.deadlineMs || 20 * 60 * 1000);
  let result = { published: 1 };
  let clusterId = null;
  let evidence = null;
  let baselinePosts = [];
  let attempts = 0;

  const block = (reason, { hard = false, verdict = null } = {}) => {
    fs.writeFileSync(postsPath, baselineText);
    writeJson(path.join(publishOut, 'result.json'), {
      ...result, ok: !hard, exitCode: hard ? 1 : 0, status: hard ? 'preflight_error' : 'preflight_blocked',
      published: 0, message: `Preflight ${hard ? 'failed' : 'blocked publication'}: ${reason}`,
    });
    const record = { schema_version: 1, gate_go: false, reason, repairs_used: attempts, verdict, blocked_at: new Date(clock()).toISOString() };
    writeJson(path.join(outDir, 'preflight-blocked.json'), record);
    output({ gate_go: 'false', repairs_used: attempts, status: hard ? 'error' : 'blocked' });
    return { ...record, ok: !hard, exitCode: hard ? 1 : 0 };
  };

  try {
    fs.mkdirSync(outDir, { recursive: true });
    result = JSON.parse(fs.readFileSync(path.join(publishOut, 'result.json'), 'utf8'));
    clusterId = result.clusterId;
    evidence = JSON.parse(fs.readFileSync(path.join(publishOut, `evidence-${clusterId}.json`), 'utf8'));
    baselinePosts = JSON.parse(baselineText);
    if (!/^[0-9a-f]{40}$/.test(args.baselineBlob || '') || !/^[0-9a-f]{40}$/.test(args.stagingSha || '')) {
      throw new Error('baseline attestation requires exact blob and staging SHAs');
    }
    const actualBaselineBlob = (deps.hashBaseline || (() => git(root, ['hash-object', '--', args.baseline])))();
    if (actualBaselineBlob !== args.baselineBlob) throw new Error('baseline blob attestation mismatch');
    const initial = assertAppendOnlyPostsChange(baselineText, fs.readFileSync(postsPath, 'utf8'), args.slug);
    if (!initial.ok) return block(initial.errors.join('; '));
    let currentPost = initial.post;

    while (true) {
      if (clock() > deadline) return block('preflight deadline exceeded');
      const currentText = fs.readFileSync(postsPath, 'utf8');
      const appendCheck = assertAppendOnlyPostsChange(baselineText, currentText, args.slug);
      if (!appendCheck.ok) return block(appendCheck.errors.join('; '));
      currentPost = appendCheck.post;
      const diff = (deps.diff || (() => git(root, ['diff', '--no-color', '--unified=3', '--', path.relative(root, postsPath)])))();
      if (!diff || Buffer.byteLength(diff) > 500_000) return block('review diff is empty or over budget');
      const suffix = attempts;
      const diffPath = path.join(outDir, `diff-${suffix}.patch`);
      const trimmedEvidencePath = path.join(outDir, `evidence-${suffix}.json`);
      const verdictPath = path.join(outDir, `verdict-${suffix}.json`);
      fs.writeFileSync(diffPath, diff);
      writeJson(trimmedEvidencePath, trimEvidence(evidence));
      const blobSha = (deps.hashObject || (() => git(root, ['hash-object', '--', path.relative(root, postsPath)])))();
      const verdict = await (deps.review || defaultReview)({ root, diffPath, evidencePath: trimmedEvidencePath, contentSha: blobSha, verdictPath, env: childEnv() });
      if (!fs.existsSync(verdictPath)) writeJson(verdictPath, verdict);
      const decision = preflightDecision({ verdict, contentSha: blobSha, attempts, maxRepairs: MAX_REPAIRS });
      if (decision === 'go') {
        const finalText = fs.readFileSync(postsPath, 'utf8');
        const finalCheck = assertAppendOnlyPostsChange(baselineText, finalText, args.slug);
        if (!finalCheck.ok) return block(finalCheck.errors.join('; '), { verdict });
        const finalBlob = (deps.hashObject || (() => git(root, ['hash-object', '--', path.relative(root, postsPath)])))();
        if (finalBlob !== blobSha) return block('reviewed posts blob changed before attestation', { verdict });
        const attestation = {
          schema_version: 1, kind: 'news', slug: args.slug, cluster_id: clusterId,
          baseline_blob_sha: args.baselineBlob, baseline_staging_sha: args.stagingSha,
          blob_sha: finalBlob, content_sha256: sha256(finalText),
          posts_before: baselinePosts.length, posts_after: finalCheck.candidate.length,
          repairs_used: attempts, reviewer_model: GATE_MODEL, fixer_model: FIXER_MODEL,
          gate: { score_threshold: SCORE_THRESHOLD, blocking_severities: [...BLOCKING_SEVERITIES] },
          verdict, attested_at: new Date(clock()).toISOString(),
        };
        writeJson(path.join(outDir, 'preflight-attestation.json'), attestation);
        output({ gate_go: 'true', blob_sha: finalBlob, content_sha256: attestation.content_sha256, repairs_used: attempts, slug: args.slug, overall: verdict.overall });
        return { ok: true, exitCode: 0, ...attestation };
      }
      if (decision === 'block') return block('review did not grant GO', { verdict });

      attempts += 1;
      const postPath = path.join(outDir, `post-${attempts}.json`);
      const repairPath = path.join(outDir, `repair-${attempts}.json`);
      writeJson(postPath, currentPost);
      const plan = await (deps.fix || defaultFix)({ root, postPath, verdictPath, repairPath, env: childEnv() });
      const entries = planRecordEntries(plan, POSTS_FILE);
      const entry = entries.length === 1 ? entries[0] : null;
      if (entry?.slug !== args.slug) return block('repair plan did not target the drafted post', { verdict });
      const repairedPost = entry.record;
      const repairCheck = validatePostRepair(currentPost, repairedPost);
      if (!repairCheck.ok) return block(`invalid repair: ${repairCheck.errors.join('; ')}`, { verdict });
      const candidatePosts = [...baselinePosts, repairedPost];
      const candidateText = `${JSON.stringify(candidatePosts, null, 2)}\n`;
      const rebuilt = assertAppendOnlyPostsChange(baselineText, candidateText, args.slug);
      if (!rebuilt.ok) return block(rebuilt.errors.join('; '), { verdict });
      const nowMs = Date.parse(result.now);
      const imageExists = deps.imageExists || createLocalImageExists(root);
      const siteIndex = (deps.loadSiteLinkIndex || loadSiteLinkIndex)(root);
      siteIndex?.postSlugs?.delete(args.slug);
      const validation = (deps.validateDraft || validateDraft)({ post: repairedPost, newsArticleStructuredData: structuredData(repairedPost), evidencePack: evidence, siteIndex, nowMs, imageExists });
      const ready = (deps.evaluatePublishReadyDraft || evaluatePublishReadyDraft)({ validation, post: repairedPost, root, nowMs, posts: baselinePosts, imageExists, config: AUTO_PUBLISH_CONFIG });
      if (!validation.ok || !validation.publishReady || !ready.ok) return block('repair failed deterministic publish-ready validation', { verdict });
      fs.writeFileSync(postsPath, candidateText);
    }
  } catch (error) {
    return block(error.message, { hard: true });
  }
}

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=', 2);
    values[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runPreflight(parseArgs(process.argv.slice(2)));
  process.exitCode = result.exitCode;
}
