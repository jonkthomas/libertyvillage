import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { github, paged } from '../automation/github.mjs';
import { isExactSha } from '../automation/policy.mjs';
import {
  matchWeeklyOwnerEnv, parseWeeklyOwnerFile, resolveWeeklyOwner as resolveCanonicalWeeklyOwner,
} from '../automation/weekly-owner.mjs';
import { validateIngestDiff, repositoryDispatchBody } from './ingest-contract.mjs';
import { generateWithPi, writeCandidateArtifact } from './pi-session.mjs';
import { fetchObservation } from './github-monitor.mjs';
import { contentShipEnabled } from '../automation/promotion-control.mjs';
import { KIND_POLICIES } from '../automation/constants.mjs';
import { lostDispatchRetry, mayRepin, MONITOR_LIMIT_MS, terminalFromObservation } from './sha-monitor.mjs';
import {
  branchPublicationHistory, buildFallbackGuide, DEFERRED_TO_DEADLINE,
  isoWeekWindow, PUBLISHED_MAIN, recordsFromBusinesses, runWeeklyLane, WEEKLY_OBJECTIVE_MET,
  WEEKLY_PUBLICATION_MISSED,
} from './weekly-publication-loop.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const COMMAND_OUTPUT_LIMIT = 8 * 1024;
export const OUTCOME_REASON_LIMIT = 512;

function numberedCommandOutput(value, label) {
  return boundedCommandOutput(value).split('\n')
    .map((line, index) => /^<\d+ characters omitted; showing tail>$/.test(line)
      ? line
      : `${label} line ${index + 1}: ${line}`)
    .join('\n');
}

function boundedCommandOutput(value) {
  const output = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
  const trimmed = output.trim();
  if (!trimmed) return '<empty>';
  if (trimmed.length <= COMMAND_OUTPUT_LIMIT) return trimmed;
  const omitted = trimmed.length - COMMAND_OUTPUT_LIMIT;
  return `<${omitted} characters omitted; showing tail>\n${trimmed.slice(-COMMAND_OUTPUT_LIMIT)}`;
}

export function boundedOutcomeReason(value) {
  const singleLine = String(value ?? '').replace(/\p{C}+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!singleLine) return '<empty>';
  const characters = [...singleLine];
  if (characters.length <= OUTCOME_REASON_LIMIT) return singleLine;
  const suffix = ' …[truncated]';
  return `${characters.slice(0, OUTCOME_REASON_LIMIT - [...suffix].length).join('').trimEnd()}${suffix}`;
}

export function runCommand(file, args, options = {}) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
  } catch (error) {
    const status = Number.isInteger(error.status) ? `exit ${error.status}` : `signal ${error.signal || 'unknown'}`;
    const invocation = [file, ...args].map((part) => JSON.stringify(String(part))).join(' ');
    throw new Error([
      `supervisor command failed (${status}): ${invocation}`,
      options.cwd ? `cwd: ${options.cwd}` : null,
      `stdout:\n${numberedCommandOutput(error.stdout, 'stdout')}`,
      `stderr:\n${numberedCommandOutput(error.stderr, 'stderr')}`,
    ].filter(Boolean).join('\n'), { cause: error });
  }
}

export function command(file, args, options = {}) {
  return runCommand(file, args, options);
}

let cachedNpmCli = undefined;
function npmCliJs() {
  if (cachedNpmCli !== undefined) return cachedNpmCli;
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    const cli = path.join(globalRoot, 'npm/bin/npm-cli.js');
    cachedNpmCli = fs.existsSync(cli) ? cli : null;
  } catch {
    cachedNpmCli = null;
  }
  return cachedNpmCli;
}

function npm(args, options) {
  const cli = npmCliJs();
  if (cli) return command(process.execPath, [cli, ...args], options);
  return command('npm', args, options);
}

export function coordinator(repoRoot, args, { repo }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-supervisor-output-'));
  const output = path.join(directory, 'output');
  try {
    command(process.execPath, [path.join(repoRoot, 'scripts/automation/coordinator.mjs'), ...args, '--repo', repo], {
      cwd: repoRoot, env: { ...process.env, GITHUB_OUTPUT: output },
    });
    return Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
      const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
    }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

export function resolveWeeklyOwner(env = process.env, ownerFile) {
  return resolveCanonicalWeeklyOwner(env, ownerFile ? { ownerFile } : undefined);
}

export function resolveHostWeeklyOwner(repoRoot, env = process.env) {
  command('git', ['fetch', '--no-tags', 'origin', 'main', 'staging'], { cwd: repoRoot });
  const readRemoteOwner = (branch) => {
    let value;
    try {
      value = execFileSync('git', ['show', `origin/${branch}:ops/exedev-supervisor/owner.txt`], {
        cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(`cannot read canonical weekly owner from origin/${branch}: ${error.stderr?.trim() || error.message}`);
    }
    return parseWeeklyOwnerFile(value, `origin/${branch}:ops/exedev-supervisor/owner.txt`);
  };
  const mainOwner = readRemoteOwner('main');
  const stagingOwner = readRemoteOwner('staging');
  if (mainOwner !== stagingOwner) throw new Error(`weekly owner mismatch: main=${mainOwner} staging=${stagingOwner}`);
  return matchWeeklyOwnerEnv(mainOwner, env);
}

export function readSelectedTopic(queueFile, topicKey) {
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  if (queue?.version !== 1 || !Array.isArray(queue.topics)) throw new Error('trusted topic queue must use schema version 1');
  const topic = queue.topics.find((entry) => entry?.key === topicKey);
  if (!topic) throw new Error(`selected topic is missing from the staging topic queue: ${topicKey}`);
  for (const field of ['key', 'title', 'source', 'rationale']) {
    if (typeof topic[field] !== 'string' || !topic[field].trim()) throw new Error(`selected topic lacks ${field}: ${topicKey}`);
  }
  if (topic.kind !== 'blog') throw new Error(`selected topic is not a blog topic: ${topicKey}`);
  return { key: topic.key, title: topic.title, source: topic.source, rationale: topic.rationale };
}

export function recordSupervisorOutcome({ repoRoot, repo, runId, topicKey, terminal, reason }, coordinatorFn = coordinator) {
  if (!runId || !topicKey) throw new Error('candidate outcome requires exact run and topic keys');
  return coordinatorFn(repoRoot, [
    'record-candidate-outcome', '--kind', 'blog', '--outcome', terminal,
    '--key', runId, '--topic-key', topicKey, '--reason', boundedOutcomeReason(reason || terminal),
  ], { repo });
}

export function cleanupDataBranch(repoRoot, branch) {
  if (!/^supervisor\/blog-data-[0-9]+$/.test(branch || '')) throw new Error(`refused non-owned data branch cleanup: ${String(branch)}`);
  const remote = command('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { cwd: repoRoot });
  if (!remote) return false;
  command('git', ['push', 'origin', '--delete', branch], { cwd: repoRoot });
  return true;
}

function pickExistingPublicImage(workDir) {
  for (const dir of ['public/images/blog', 'public/images/neighborhood', 'public/images/og']) {
    const abs = path.join(workDir, dir);
    if (!fs.existsSync(abs)) continue;
    const name = fs.readdirSync(abs).find((entry) => /\.(?:jpe?g|png|webp|avif|gif)$/i.test(entry));
    if (name) return `/${dir.slice('public/'.length)}/${name}`;
  }
  throw new Error('no existing public image for the fallback guide');
}

function fallbackPostFromGuide(guide, image, runDate) {
  const specifics = (Array.isArray(guide.specifics) ? guide.specifics : [])
    .map((specific) => String(specific?.text ?? '').trim())
    .filter(Boolean);
  const takeaways = [...new Set(specifics)].slice(0, 6);
  while (takeaways.length < 4) takeaways.push('Every listed specific is copied verbatim from a linked directory record.');
  return {
    slug: guide.slug,
    title: guide.title,
    description: `A conservative ${guide.category} guide assembled from Liberty Village repository records.`,
    content: guide.content,
    publishedAt: runDate,
    updatedAt: runDate,
    category: guide.category,
    tags: ['liberty-village', 'guide', guide.category, 'records'],
    answerBlock: `This week's grounded ${guide.category} guide is assembled directly from the site's own business records.`,
    faqs: [
      { question: 'Where do these hours, prices, and addresses come from?', answer: 'Every specific is copied verbatim from a linked directory record on this site.' },
      { question: 'Why is this guide conservative?', answer: 'No detail appears here that a repository record does not already contain.' },
      { question: 'How do I open the full record?', answer: 'Follow the directory links in the guide. Each linked page is the source record.' },
      { question: 'Is anything here invented?', answer: 'No. The linked records are the source; this guide restates them verbatim as of publication.' },
    ],
    relatedServices: [],
    relatedTopics: [],
    relatedPosts: [],
    keyTakeaways: takeaways.slice(0, 6),
    image,
    author: 'LibertyVillage.co',
  };
}

async function findIngestPr(repo, dataSha, { timeoutMs = 25 * 60 * 1000 } = {}) {
  const owner = repo.split('/')[0];
  const branch = `blog/auto-supervisor-${dataSha.slice(0, 12)}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const prs = await paged(`/repos/${repo}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`);
    if (prs.length === 1) return prs[0];
    if (prs.length > 1) throw new Error('ingest produced multiple owned pull requests');
    await sleep(15_000);
  }
  throw new Error('timed out waiting for trusted ingest pull request');
}

export async function monitorOwnedPr({
  repoRoot, repo, prNumber, initialSha, onUpdate = async () => {}, startedAt,
  now = Date.now, sleep: sleepFn = sleep, kind = 'blog-live', coordinatorFn = coordinator,
  fetchObservationFn = fetchObservation,
} = {}) {
  const clock = typeof now === 'function' ? now : () => now;
  const origin = Number.isFinite(startedAt) ? startedAt : clock();
  let sha = initialSha;
  let missingSince = null;
  let redispatches = 0;
  let syncAttempts = 0;
  while (clock() - origin < MONITOR_LIMIT_MS) {
    const observation = await fetchObservationFn(repo, prNumber, sha);
    if (observation.pr?.head?.sha !== sha && observation.pr?.state === 'open') {
      const commit = await github(`/repos/${repo}/commits/${observation.pr.head.sha}`);
      const parents = (commit?.parents || []).map((parent) => parent.sha);
      if (!mayRepin({ oldSha: sha, newSha: observation.pr.head.sha, parents })) {
        throw new Error('refused unrelated pull request head drift');
      }
      sha = observation.pr.head.sha;
      missingSince = null;
      await onUpdate({ head_sha: sha, sha_reason: observation.audit?.decision === 'healing' ? 'heal' : 'repair', redispatches });
      continue;
    }
    const terminal = terminalFromObservation({
      pr: observation.pr, sha, auditDecision: observation.audit?.decision, base: KIND_POLICIES[kind]?.base,
      stagingContained: observation.stagingContained,
      mainContained: observation.mainContained,
      productionVercel: observation.productionVercel,
      contentContainedInMain: observation.contentContainedInMain,
    });
    if (terminal.terminal) return { terminal: terminal.terminal, prState: observation.pr?.state, sha };
    const exactHeadGreen = observation.statuses.ci === 'success'
      && observation.statuses.gate === 'success' && observation.statuses.vercel === 'success';
    if (observation.pr?.merged === true && observation.pr?.base?.ref === 'main'
      && !observation.stagingContained && exactHeadGreen && syncAttempts < 3) {
      syncAttempts += 1;
      try {
        await coordinatorFn(repoRoot, [
          'observe-and-sync-staging', '--pr', String(prNumber), '--sha', sha,
        ], { repo });
        await onUpdate({ head_sha: sha, sync_attempts: syncAttempts });
      } catch (error) {
        await onUpdate({ head_sha: sha, sync_attempts: syncAttempts, sync_error: error.message });
        if (syncAttempts >= 3) return { terminal: 'MONITOR_TIMEOUT', prState: observation.pr?.state, sha };
      }
      await sleepFn(30_000);
      continue;
    }
    const missing = observation.statuses.ci === 'missing' && observation.statuses.gate === 'missing';
    missingSince = missing ? (missingSince ?? clock()) : null;
    const retry = lostDispatchRetry({ attempts: redispatches, missingSince, now: clock() });
    if (retry.action === 'retry') {
      coordinator(repoRoot, ['dispatch', '--pr', String(prNumber), '--kind', kind, '--sha', sha], { repo });
      redispatches += 1; missingSince = clock();
      await onUpdate({ head_sha: sha, sha_reason: 'redispatch', redispatches });
    } else if (retry.action === 'block') return { terminal: 'MONITOR_TIMEOUT', prState: observation.pr?.state, sha };
    await sleepFn(30_000);
  }
  return { terminal: 'MONITOR_TIMEOUT', prState: 'open', sha };
}

export async function runBlogSupervisor({ repoRoot, stateDir, repo, run, dryRun = false, onUpdate = async () => {} }) {
  if (resolveHostWeeklyOwner(repoRoot) !== 'exedev') return { terminal: 'SKIPPED_OWNER' };
  if (!contentShipEnabled()) throw new Error('contentShipEnabled is false; refusing autonomous writes to protected branches');
  const trustedStagingSha = command('git', ['rev-parse', 'origin/staging'], { cwd: repoRoot });
  if (!isExactSha(trustedStagingSha)) throw new Error('origin/staging did not resolve to an exact SHA');
  const workDir = path.join(stateDir, 'work', run.run_id);
  fs.mkdirSync(path.dirname(workDir), { recursive: true, mode: 0o700 });
  command('git', ['worktree', 'add', '--detach', workDir, 'origin/staging'], { cwd: repoRoot });
  let dataBranch = null;
  const releaseDataBranch = () => {
    if (!dataBranch) return;
    const branch = dataBranch;
    dataBranch = null;
    try { cleanupDataBranch(repoRoot, branch); } catch (error) {
      console.error(`data branch cleanup failed for ${branch}: ${error.message}`);
    }
  };
  try {
    await onUpdate({ state: 'BASELINE_CI', trusted_staging_sha: trustedStagingSha });
    npm(['ci'], { cwd: workDir });
    npm(['run', 'lint:automation'], { cwd: workDir });
    npm(['run', 'lint:supervisor'], { cwd: workDir });
    npm(['run', 'test:automation'], { cwd: workDir });
    npm(['run', 'test:supervisor'], { cwd: workDir });

    const excludeFlag = (excludeTopicKeys) => (excludeTopicKeys?.length
      ? ['--exclude-topic-keys', excludeTopicKeys.join(',')] : []);
    const resetWorktree = () => {
      command('git', ['checkout', '--detach', 'origin/staging'], { cwd: workDir });
      command('git', ['reset', '--hard', 'origin/staging'], { cwd: workDir });
      command('git', ['clean', '-fd'], { cwd: workDir });
    };
    const recordOutcome = async (topicKey, terminal, reason) => {
      if (!topicKey) return;
      try {
        recordSupervisorOutcome({
          repoRoot, repo, runId: run.run_id, topicKey, terminal, reason,
        });
      } catch (error) {
        console.error(`candidate outcome record failed for ${topicKey}: ${error.message}`);
      }
    };
    const publishStagedPost = async ({ topic, candidate, post, sessionFile }) => {
      const imagePath = path.resolve(path.join(workDir, 'public'), `.${post.image}`);
      if (!imagePath.startsWith(`${path.join(workDir, 'public')}${path.sep}`) || !fs.existsSync(imagePath)) {
        throw new Error(`candidate image does not exist in the staging worktree: ${post.image}`);
      }
      writeCandidateArtifact({ postsFile: path.join(workDir, 'data/posts.json'), post });
      await onUpdate({ state: 'LINT', pi_session_file: sessionFile, topic_key: topic.topic_key });
      command(process.execPath, [path.join(repoRoot, 'scripts/blog-lint.mjs'), '--posts', 'data/posts.json', '--businesses', 'data/businesses.json'], { cwd: workDir });
      await onUpdate({ state: 'PUSH_DATA_BRANCH', topic_key: topic.topic_key });
      dataBranch = `supervisor/blog-data-${Date.now()}`;
      command('git', ['checkout', '-b', dataBranch], { cwd: workDir });
      command('git', ['add', '--', 'data/posts.json'], { cwd: workDir });
      command('git', ['-c', 'user.name=exe.dev supervisor', '-c', 'user.email=supervisor@exe.dev', 'commit', '-m', 'blog: supervised candidate data'], { cwd: workDir });
      const dataSha = command('git', ['rev-parse', 'HEAD'], { cwd: workDir });
      const files = command('git', ['diff', '--name-only', 'origin/staging...HEAD'], { cwd: workDir }).split('\n').filter(Boolean);
      const paths = validateIngestDiff(files);
      if (!paths.ok) throw new Error(`candidate escaped blog policy: ${paths.errors.join('; ')}`);
      command('git', ['push', 'origin', `HEAD:${dataBranch}`], { cwd: workDir });
      await onUpdate({ state: 'WAIT_INGEST', data_branch: dataBranch, data_sha: dataSha, topic_key: topic.topic_key });
      const payload = {
        kind: 'blog', data_sha: dataSha, data_branch: dataBranch,
        topic_key: topic.topic_key, regenerations: Number(candidate?.regenerations || 0),
      };
      await github(`/repos/${repo}/dispatches`, { method: 'POST', body: repositoryDispatchBody(payload) });
      let pr;
      try {
        pr = await findIngestPr(repo, dataSha);
      } catch (error) {
        if (!String(error.message).includes('timed out waiting for trusted ingest')) throw error;
        cleanupDataBranch(repoRoot, dataBranch);
        try {
          pr = await findIngestPr(repo, dataSha, { timeoutMs: 2 * 60 * 1000 });
        } catch (lateError) {
          if (!String(lateError.message).includes('timed out waiting for trusted ingest')) throw lateError;
          throw error;
        }
      }
      if (!isExactSha(pr?.head?.sha)) throw new Error('ingest PR has no exact head SHA');
      await onUpdate({
        state: 'MONITORING_CI', data_branch: dataBranch, data_sha: dataSha,
        pr_number: pr.number, head_sha: pr.head.sha, sha_reason: 'ingest', topic_key: topic.topic_key,
      });
      const monitored = await monitorOwnedPr({
        repoRoot, repo, prNumber: pr.number, initialSha: pr.head.sha, onUpdate, kind: 'blog-live',
      });
      return { ...monitored, topic_key: topic.topic_key, dataBranch, dataSha };
    };
    const runOneGeneratedCandidate = async ({ topic, candidate }) => {
      const selectedTopic = readSelectedTopic(path.join(workDir, 'data/topic-queue.json'), topic.topic_key);
      if (selectedTopic.title !== topic.topic_title) {
        throw new Error(`selected topic title differs from the staging topic queue: ${topic.topic_key}`);
      }
      try {
        const generated = await generateWithPi({
          cwd: workDir, agentDir: path.join(stateDir, 'pi-runtime'), sessionsDir: path.join(stateDir, 'pi-sessions'),
          topic: selectedTopic,
          contextFiles: [
            'data/topic-queue.json', 'data/businesses.json', 'data/posts.json',
            'scripts/prompts/sections/03-blog-generation.md',
          ],
          provider: process.env.PI_PROVIDER || 'openai', modelId: process.env.PI_MODEL || 'gpt-5.6-sol',
          baseUrl: process.env.PI_BASE_URL || 'https://llm.int.exe.xyz/v1',
        });
        const result = await publishStagedPost({
          topic, candidate, post: generated.post, sessionFile: generated.sessionFile,
        });
        if (result?.terminal && result.terminal !== PUBLISHED_MAIN) {
          await recordOutcome(topic.topic_key, result.terminal, `weekly candidate ${result.terminal}`);
          releaseDataBranch();
          resetWorktree();
        }
        return result;
      } catch (error) {
        await recordOutcome(topic.topic_key, 'GENERATION_FAILED_PRE_PR', error.message);
        releaseDataBranch();
        resetWorktree();
        return { terminal: 'GENERATION_FAILED_PRE_PR', topic_key: topic.topic_key, reason: error.message };
      }
    };

    const scheduledAt = run.started_at || new Date().toISOString();
    const week = isoWeekWindow(scheduledAt);
    const gitAtRepo = (args) => command('git', args, { cwd: repoRoot });
    const lane = await runWeeklyLane({
      scheduledAt,
      dryRun,
      onUpdate,
      fetchTarget: async () => {
        command('git', ['fetch', '--no-tags', 'origin', 'main'], { cwd: repoRoot });
      },
      readPublicationHistory: async () => branchPublicationHistory(gitAtRepo, 'origin/main'),
      resolveTopic: async ({ excludeTopicKeys }) => coordinator(repoRoot, [
        'resolve-topic', '--kind', 'blog', ...excludeFlag(excludeTopicKeys),
      ], { repo }),
      planCandidate: async (topic, { excludeTopicKeys } = {}) => {
        await onUpdate({ state: 'PLAN_CANDIDATE', topic_key: topic.topic_key });
        return coordinator(repoRoot, [
          'plan-candidate', '--kind', 'blog', '--topic-key', topic.topic_key, ...excludeFlag(excludeTopicKeys),
        ], { repo });
      },
      runCandidate: runOneGeneratedCandidate,
      records: async () => recordsFromBusinesses(
        JSON.parse(fs.readFileSync(path.join(workDir, 'data/businesses.json'), 'utf8')),
      ),
      usedCategories: JSON.parse(fs.readFileSync(path.join(workDir, 'data/posts.json'), 'utf8'))
        .map((post) => post?.category).filter(Boolean),
      consumeIntent: async ({ topicKey, contained }) => {
        if (contained !== true || !topicKey) return;
        recordSupervisorOutcome({
          repoRoot, repo, runId: run.run_id, topicKey,
          terminal: PUBLISHED_MAIN, reason: 'intent consumed after fetched remote main containment',
        });
      },
      runFallback: async ({ records: fallbackRecords, usedCategories, scheduledAt: fallbackAt }) => {
        const { guide } = buildFallbackGuide({
          records: fallbackRecords,
          usedCategories,
          publishedAt: String(fallbackAt).slice(0, 10),
          id: `sunday-fallback-${week.key}`,
        });
        const image = pickExistingPublicImage(workDir);
        const post = fallbackPostFromGuide(guide, image, String(fallbackAt).slice(0, 10));
        resetWorktree();
        try {
          const published = await publishStagedPost({
            topic: { topic_key: `sunday-fallback-${week.key}`, topic_title: guide.title },
            candidate: { regenerations: 0 },
            post,
            sessionFile: null,
          });
          if (published?.terminal && published.terminal !== PUBLISHED_MAIN) releaseDataBranch();
          return { ...published, title: guide.title };
        } catch (error) {
          releaseDataBranch();
          resetWorktree();
          return { terminal: WEEKLY_PUBLICATION_MISSED, reason: error.message };
        }
      },
    });
    if (lane.terminal === WEEKLY_OBJECTIVE_MET || lane.terminal === DEFERRED_TO_DEADLINE) {
      return { terminal: lane.terminal, topic_key: lane.topic_key || null, week: lane.week };
    }
    return lane;
  } finally {
    releaseDataBranch();
    try { command('git', ['worktree', 'remove', '--force', workDir], { cwd: repoRoot }); } catch {}
  }
}
