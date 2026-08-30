import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FROZEN_GIT_ENV = Object.freeze({
  GIT_AUTHOR_DATE: '2026-08-30T11:00:00.000Z',
  GIT_COMMITTER_DATE: '2026-08-30T11:00:00.000Z',
});

function git(repoPath, args) {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...FROZEN_GIT_ENV },
  }).trim();
}

function writePost(repoPath, post) {
  fs.writeFileSync(path.join(repoPath, 'data/posts.json'), `${JSON.stringify([post], null, 2)}\n`);
  git(repoPath, ['add', 'data/posts.json']);
}

function gateFor(input, commitSha, { overall, findings }) {
  return {
    model: input.gate.model,
    scoreThreshold: input.gate.scoreThreshold,
    blockingSeverities: input.gate.blockingSeverities,
    commitSha,
    overall,
    findings,
  };
}

export async function exerciseSeededJourney(input, { publish }) {
  git(input.repoPath, ['checkout', '-b', 'fixture/rejected-first', input.baseCommit]);
  writePost(input.repoPath, {
    id: input.seed.firstCandidateId,
    grounded: false,
    content: 'Seeded first candidate with one blocking unsupported claim.',
  });
  git(input.repoPath, ['commit', '-m', 'fixture: rejected first candidate']);
  const rejectedCommit = git(input.repoPath, ['rev-parse', 'HEAD']);

  git(input.repoPath, ['checkout', '-b', 'fixture/distinct-final', input.baseCommit]);
  writePost(input.repoPath, {
    id: input.seed.distinctCandidateId,
    grounded: true,
    content: 'A distinct grounded Sunday article backed by the seeded local evidence.',
  });
  git(input.repoPath, ['commit', '-m', 'fixture: distinct grounded article']);
  const articleCommit = git(input.repoPath, ['rev-parse', 'HEAD']);

  if (publish) {
    git(input.repoPath, ['checkout', input.targetBranch]);
    git(input.repoPath, ['merge', '--no-ff', '--no-edit', 'fixture/distinct-final']);
  } else {
    git(input.repoPath, ['checkout', input.targetBranch]);
  }

  return {
    attempts: [
      {
        candidateId: input.seed.firstCandidateId,
        articleCommit: rejectedCommit,
        disposition: 'rejected',
        gate: gateFor(input, rejectedCommit, {
          overall: 7,
          findings: [{ severity: 'high', path: 'data/posts.json', note: 'unsupported claim' }],
        }),
      },
      {
        candidateId: input.seed.distinctCandidateId,
        articleCommit,
        disposition: 'published',
        mode: 'distinct-candidate',
        grounded: true,
        gate: gateFor(input, articleCommit, { overall: 9, findings: [] }),
      },
    ],
    publication: {
      claimedTerminal: 'PUBLISHED_MAIN',
      targetBranch: input.targetBranch,
      articleCommit,
    },
  };
}
