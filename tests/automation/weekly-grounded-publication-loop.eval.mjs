#!/usr/bin/env node
// =============================================================================
// EVALUATOR-OWNED LOCKED JOURNEY EVAL — reliable weekly grounded publication.
//
// The builder MUST NOT edit, weaken, delete, re-scope, or skip this file or its
// locked fixtures. Maker != checker.
//
// Builder contract (the highest publication seam):
//   scripts/supervisor/weekly-publication-loop.mjs MUST export
//   `runWeeklyGroundedPublicationJourney(input)` and return the shape asserted
//   below. `input` supplies an isolated git repo, exact target branch, frozen
//   Sunday timestamp, immutable gate profile, and three seeded candidate IDs.
//   The first seeded candidate MUST be rejected. The journey MUST then publish
//   either a distinct candidate or the seeded Sunday grounded fallback. Every
//   attempt MUST retain model=claude-opus-5, scoreThreshold=8, blocking
//   severities critical/high, and bind its gate evidence to its exact commit.
//   Success exists only when the returned exact final article commit is actually
//   contained in refs/heads/<targetBranch>; a terminal/status claim is evidence
//   only and cannot make the eval pass.
//
// Run (offline, deterministic, no secrets, no network):
//   node --test tests/automation/weekly-grounded-publication-loop.eval.mjs
//
// Controlled evaluator proof:
//   LV_WEEKLY_PUBLICATION_HARNESS=tests/automation/fixtures/weekly-grounded-publication-loop/conforming-harness.mjs \
//     node --test tests/automation/weekly-grounded-publication-loop.eval.mjs
//   LV_WEEKLY_PUBLICATION_HARNESS=tests/automation/fixtures/weekly-grounded-publication-loop/false-publication-harness.mjs \
//     node --test tests/automation/weekly-grounded-publication-loop.eval.mjs
//
// Lock: evals/weekly-grounded-publication-loop.sha256
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BLOCKING_SEVERITIES, GATE_MODEL, SCORE_THRESHOLD } from '../../scripts/automation/constants.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PRODUCTION_HARNESS = 'scripts/supervisor/weekly-publication-loop.mjs';
const FROZEN_SUNDAY = '2026-08-30T11:00:00.000Z';
const FROZEN_GIT_ENV = Object.freeze({
  GIT_AUTHOR_DATE: FROZEN_SUNDAY,
  GIT_COMMITTER_DATE: FROZEN_SUNDAY,
});
const FROZEN_GATE = Object.freeze({
  model: 'claude-opus-5',
  scoreThreshold: 8,
  blockingSeverities: Object.freeze(['critical', 'high']),
});
const SEED = Object.freeze({
  firstCandidateId: 'seeded-first-candidate',
  distinctCandidateId: 'seeded-distinct-candidate',
  sundayFallbackId: 'seeded-sunday-grounded-fallback',
});

function git(repoPath, args) {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...FROZEN_GIT_ENV },
  }).trim();
}

function makeJourneyRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-weekly-publication-eval-'));
  git(repoPath, ['init', '-b', 'main']);
  git(repoPath, ['config', 'user.name', 'Liberty Village Journey Eval']);
  git(repoPath, ['config', 'user.email', 'journey-eval@example.invalid']);
  fs.mkdirSync(path.join(repoPath, 'data'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'data/posts.json'), '[]\n');
  git(repoPath, ['add', 'data/posts.json']);
  git(repoPath, ['commit', '-m', 'fixture: seed publication target']);
  return { repoPath, baseCommit: git(repoPath, ['rev-parse', 'HEAD']) };
}

async function loadHarness() {
  const selected = process.env.LV_WEEKLY_PUBLICATION_HARNESS || PRODUCTION_HARNESS;
  const absolute = path.isAbsolute(selected) ? selected : path.resolve(ROOT, selected);
  if (!fs.existsSync(absolute)) {
    throw new Error(`NOT IMPLEMENTED: ${selected} does not exist; provide the locked weekly publication seam`);
  }
  const module = await import(pathToFileURL(absolute).href);
  assert.equal(typeof module.runWeeklyGroundedPublicationJourney, 'function',
    `${selected} must export runWeeklyGroundedPublicationJourney(input)`);
  return module.runWeeklyGroundedPublicationJourney;
}

function assertExactGate(attempt) {
  assert.equal(attempt.gate?.model, FROZEN_GATE.model,
    `${attempt.candidateId}: gate model changed`);
  assert.equal(attempt.gate?.scoreThreshold, FROZEN_GATE.scoreThreshold,
    `${attempt.candidateId}: gate threshold changed`);
  assert.deepEqual(attempt.gate?.blockingSeverities, FROZEN_GATE.blockingSeverities,
    `${attempt.candidateId}: blocking severities changed`);
  assert.equal(attempt.gate?.commitSha, attempt.articleCommit,
    `${attempt.candidateId}: gate evidence is not bound to the exact article commit`);
  assert.notEqual(attempt.gate?.bypassed, true, `${attempt.candidateId}: gate was bypassed`);
  assert.equal(Array.isArray(attempt.gate?.findings), true,
    `${attempt.candidateId}: gate findings are missing`);
}

function gatePasses(attempt) {
  const findings = Array.isArray(attempt.gate?.findings) ? attempt.gate.findings : [];
  return Number(attempt.gate?.overall) >= FROZEN_GATE.scoreThreshold
    && !findings.some((finding) => FROZEN_GATE.blockingSeverities.includes(finding?.severity));
}

function exactCommitIsContained(repoPath, commit, targetBranch) {
  assert.match(commit ?? '', /^[0-9a-f]{40}$/, 'publication must return an exact article commit SHA');
  git(repoPath, ['cat-file', '-e', `${commit}^{commit}`]);
  try {
    git(repoPath, ['merge-base', '--is-ancestor', commit, `refs/heads/${targetBranch}`]);
    return true;
  } catch {
    return false;
  }
}

function commitContainsCandidate(repoPath, commit, candidateId) {
  const posts = JSON.parse(git(repoPath, ['show', `${commit}:data/posts.json`]));
  return Array.isArray(posts) && posts.some((post) => post?.id === candidateId);
}

test('a rejected first candidate advances safely and only an exact contained article commit counts as published', async (t) => {
  assert.equal(GATE_MODEL, FROZEN_GATE.model, 'production gate model drifted before the journey ran');
  assert.equal(SCORE_THRESHOLD, FROZEN_GATE.scoreThreshold, 'production gate threshold drifted before the journey ran');
  assert.deepEqual([...BLOCKING_SEVERITIES], FROZEN_GATE.blockingSeverities,
    'production blocking severities drifted before the journey ran');
  assert.equal(new Date(FROZEN_SUNDAY).getUTCDay(), 0, 'the frozen fallback journey must run on Sunday');

  const fixture = makeJourneyRepo();
  t.after(() => fs.rmSync(fixture.repoPath, { recursive: true, force: true }));
  const runJourney = await loadHarness();
  const result = await runJourney({
    repoPath: fixture.repoPath,
    targetBranch: 'main',
    baseCommit: fixture.baseCommit,
    scheduledAt: FROZEN_SUNDAY,
    gate: structuredClone(FROZEN_GATE),
    seed: structuredClone(SEED),
  });

  assert.equal(Array.isArray(result?.attempts), true, 'journey must return ordered attempts');
  assert.ok(result.attempts.length >= 2, 'rejection must advance to another publication attempt');
  const first = result.attempts[0];
  const final = result.attempts.at(-1);

  assert.equal(first.candidateId, SEED.firstCandidateId, 'journey did not exercise the seeded first candidate');
  assert.equal(commitContainsCandidate(fixture.repoPath, first.articleCommit, first.candidateId), true,
    'the first exact commit does not contain the seeded first article');
  assert.equal(first.disposition, 'rejected', 'the seeded first candidate was not rejected');
  assertExactGate(first);
  assert.equal(gatePasses(first), false, 'the first candidate claims rejection despite passing the frozen gate');

  assert.ok(['distinct-candidate', 'sunday-grounded-fallback'].includes(final.mode),
    'final attempt must be a distinct candidate or Sunday grounded fallback');
  if (final.mode === 'distinct-candidate') {
    assert.equal(final.candidateId, SEED.distinctCandidateId, 'journey did not advance to the seeded distinct candidate');
  } else {
    assert.equal(final.candidateId, SEED.sundayFallbackId, 'journey did not use the seeded Sunday grounded fallback');
  }
  assert.notEqual(final.candidateId, first.candidateId, 'journey reused the rejected candidate identity');
  assert.notEqual(final.articleCommit, first.articleCommit, 'journey reused the rejected article commit');
  assert.notEqual(final.articleCommit, fixture.baseCommit, 'journey reported the pre-article base commit');
  assert.equal(commitContainsCandidate(fixture.repoPath, final.articleCommit, final.candidateId), true,
    'the final exact commit does not contain the selected article');
  assert.equal(final.disposition, 'published', 'final attempt is not the published attempt');
  assert.equal(final.grounded, true, 'final article is not grounded');
  assertExactGate(final);
  assert.equal(gatePasses(final), true, 'final article did not pass the unchanged frozen gate');

  assert.equal(result.publication?.claimedTerminal, 'PUBLISHED_MAIN', 'journey did not reach its publication terminal');
  assert.equal(result.publication?.targetBranch, 'main', 'publication targeted a different branch');
  assert.equal(result.publication?.articleCommit, final.articleCommit,
    'publication claim is not bound to the final exact article commit');
  assert.equal(exactCommitIsContained(fixture.repoPath, first.articleCommit, 'main'), false,
    'the rejected first article commit leaked into the target branch');
  assert.equal(exactCommitIsContained(fixture.repoPath, result.publication.articleCommit, 'main'), true,
    `publication was merely claimed: exact article commit ${result.publication.articleCommit} is not contained in refs/heads/main`);
});
