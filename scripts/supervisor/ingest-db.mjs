#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDbIngestDiff, validateIngestPayload } from './ingest-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function execute(file, args, { allow = [0] } = {}) {
  const result = spawnSync(file, args, { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.error || !allow.includes(result.status)) {
    throw new Error(`${file} ${args[0]} failed: ${result.error?.message || result.stderr?.trim() || result.stdout?.trim() || result.status}`);
  }
  return result;
}

function jsonResult(result, step) {
  try { return JSON.parse(result.stdout.trim().split('\n').at(-1)); }
  catch { throw new Error(`${step} did not return JSON`); }
}

function postStatus(repo, sha, state, description, targetUrl) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '')) throw new Error('GITHUB_REPOSITORY is invalid');
  const args = ['api', '-X', 'POST', `repos/${repo}/statuses/${sha}`,
    '-f', 'context=content/publish', '-f', `state=${state}`, '-f', `description=${description.slice(0, 140)}`];
  if (targetUrl) args.push('-f', `target_url=${targetUrl}`);
  execute('gh', args);
}

export function runDbIngest(payload, { repo = process.env.GITHUB_REPOSITORY } = {}) {
  const valid = validateIngestPayload(payload);
  if (!valid.ok || payload.store !== 'db') throw new Error(`invalid DB ingest payload: ${valid.errors.join('; ')}`);
  if (process.env.CONTENT_TARGET && process.env.CONTENT_TARGET !== payload.target) throw new Error('payload target differs from CONTENT_TARGET');
  const sha = payload.data_sha;
  console.log(`validated DB ingest sha=${sha} target=${payload.target}`);
  let step = 'pending';
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-ingest-candidate-'));
  const candidateFile = path.join(temporary, 'candidate.json');
  try {
    postStatus(repo, sha, 'pending', 'ingest:pending');
    step = 'code';
    const codeSha = execute('git', ['rev-parse', 'HEAD']).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(codeSha) || (process.env.LV_INGEST_CODE_SHA && process.env.LV_INGEST_CODE_SHA !== codeSha)) {
      throw new Error('ingest code SHA differs from pinned staging code');
    }
    console.log(`code_sha=${codeSha}`);
    step = 'fetch';
    execute('git', ['fetch', '--no-tags', 'origin', payload.data_branch]);
    if (execute('git', ['rev-parse', 'FETCH_HEAD']).stdout.trim() !== sha) throw new Error('fetched branch SHA differs from payload');
    execute('git', ['fetch', '--no-tags', 'origin', 'staging']);
    console.log(`fetch/SHA verified ${sha}`);
    step = 'diff';
    const files = execute('git', ['diff', '--name-only', `origin/staging...${sha}`]).stdout.trim().split('\n').filter(Boolean);
    const checked = validateDbIngestDiff(files);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    console.log('diff verified: candidate/post.json');
    step = 'candidate';
    fs.writeFileSync(candidateFile, execute('git', ['show', `${sha}:candidate/post.json`]).stdout, { flag: 'wx', mode: 0o600 });
    step = 'export';
    execute(process.execPath, ['scripts/content/cli.mjs', 'export', '--root', '.']);
    step = 'submit';
    const generatedAt = execute('git', ['show', '-s', '--format=%cI', sha]).stdout.trim();
    const submit = jsonResult(execute(process.execPath, [
      'scripts/content/cli.mjs', 'submit', '--kind', 'blog-live', '--record-file', candidateFile,
      '--dataset', 'posts', '--baseline', '.content-export/manifest.json',
      '--idempotency-key', `vm:${sha}`, '--actor', `ingest:${sha}`,
      '--topic-key', payload.topic_key, '--generated-at', generatedAt,
      '--target', payload.target,
      ...(process.env.CONTENT_DB_NAME ? ['--expect-db', process.env.CONTENT_DB_NAME] : []),
    ]), step);
    if (!Number.isSafeInteger(Number(submit.submissionId))) throw new Error('submit returned no submission ID');
    console.log(`submit accepted submission=${submit.submissionId}`);
    step = 'gate';
    const gated = execute(process.execPath, [
      'scripts/content/cli.mjs', 'gate', '--submission', String(submit.submissionId),
      '--target', payload.target,
      ...(process.env.CONTENT_DB_NAME ? ['--expect-db', process.env.CONTENT_DB_NAME] : []),
    ], { allow: [0, 2, 3] });
    const result = jsonResult(gated, step);
    console.log(`gate completed submission=${submit.submissionId} exit=${gated.status}`);
    if ([0, 3].includes(gated.status)) {
      const liveSeq = Number(result.liveSeq);
      const targetUrl = result.published?.find((item) => item.dataset === 'posts')?.url;
      if (!Number.isSafeInteger(liveSeq) || liveSeq < 1 || !targetUrl) throw new Error('gate publish missing live sequence or post URL');
      postStatus(repo, sha, 'success', `published:${submit.submissionId}:seq:${liveSeq}`, targetUrl);
      return { state: 'published', submissionId: submit.submissionId, liveSeq, targetUrl, propagationPending: gated.status === 3 };
    }
    postStatus(repo, sha, 'failure', `decision=${result.decision || 'block'} submission=${submit.submissionId}`);
    return { state: 'blocked', submissionId: submit.submissionId, decision: result.decision || 'block' };
  } catch (error) {
    try { postStatus(repo, sha, 'failure', `ingest-error:${step}`); }
    catch (statusError) { console.error(`ingest status write failed: ${statusError.message}`); }
    throw error;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const index = process.argv.indexOf('--payload');
    if (index < 0 || !process.argv[index + 1]) throw new Error('--payload is required');
    const result = runDbIngest(JSON.parse(process.argv[index + 1]));
    console.log(JSON.stringify(result));
    if (result.state === 'blocked') process.exitCode = 2;
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}
