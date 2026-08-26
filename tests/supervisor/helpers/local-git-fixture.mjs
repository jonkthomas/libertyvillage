// Eval-owned Git fixture for the local live-model supervisor acceptance gate.
// Spec: /tmp/lv-supervisor-local-acceptance-spec.md (sha256 3ed29573…). FROZEN by
// evals/local-supervisor-acceptance.sha256 — the builder must not modify this file.
//
// Owns: temporary bare origin with PR-required protection (direct push of
// main/staging rejected by a pre-receive hook), run clone with the #138
// clone-HEAD/staging-HEAD posts.json split, revert-based mutation variants, the
// GitHub-merge-API analogue (ref updates that never traverse the hook), and the
// ancestor/blog-parity invariant the Design C fixture must already satisfy.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PROTECTED_BRANCHES = Object.freeze(['main', 'staging']);
export const BLOG_PATHS = Object.freeze(['data/posts.json', 'public/images/blog/']);
const BOT = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];

export function gitEnv(extra = {}) {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'file',
    ...extra,
  };
}

export function git(dir, args, options = {}) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(), ...options,
  }).trim();
}

function writeProtectionHook(bare) {
  const hook = path.join(bare, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, [
    '#!/bin/sh',
    '# Eval-owned protection double: main and staging require a pull request.',
    'status=0',
    'while read old new ref; do',
    '  case "$ref" in',
    '    refs/heads/main|refs/heads/staging)',
    '      echo "GH006: Protected branch update failed for $ref: changes must be made through a pull request." >&2',
    '      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) reject $ref $old $new" >> "$GIT_DIR/protection-attempts.log"',
    '      status=1;;',
    '  esac',
    'done',
    'exit $status',
    '',
  ].join('\n'), { mode: 0o755 });
}

// A deterministic post that the real 557-line claim linter REJECTS: a bold,
// business-shaped proper name with no data/businesses.json record, plus
// specifics attributed to it. Used for the staging baseline sentinel (#138
// mutation) and the serial-N3 shim candidate.
export function dirtyPostBody() {
  return [
    'Neighbourhood notes. **Acceptance Fictitious Cafe** pours espresso for $4.25',
    'and stays open 7 am to 9 pm. [Acceptance Missing](/directory/acceptance-missing-record)',
    'is steps from Liberty Market Lane and charges $12.50 for lunch daily.',
  ].join(' ');
}

export function sentinelPost(slug, { dirty = true } = {}) {
  return {
    slug,
    title: 'Acceptance Fixture Sentinel',
    description: dirty ? dirtyPostBody() : 'Fixture sentinel record for baseline-split proof.',
    content: dirty ? dirtyPostBody() : 'Fixture sentinel content with no business claims.',
    publishedAt: '2026-01-01', updatedAt: '2026-01-01', category: 'community',
    answerBlock: 'Fixture sentinel.', image: '/images/blog/liberty-village-guide.jpg',
    author: 'LibertyVillage.co', tags: ['a', 'b', 'c', 'd'],
    faqs: [], relatedServices: [], relatedTopics: [], relatedPosts: [], keyTakeaways: [],
  };
}

function appendPost(dir, post) {
  const file = path.join(dir, 'data/posts.json');
  const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
  posts.push(post);
  fs.writeFileSync(file, `${JSON.stringify(posts, null, 2)}\n`);
}

// Creates the isolated fixture for one scenario. `mutateStaging` runs in the
// build checkout before refs are pushed (revert mutations, planted files);
// `mainSha` defaults to the staging tip so the Design C graph invariant
// (main is an ancestor of staging; two-dot blog-path diff empty) holds.
export function createFixture({ root, sourceRepo, sourceSha, mutateStaging = null, cloneSplit = true, stagingSentinel = true, mainAt = 'base' }) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const bare = path.join(root, 'origin.git');
  execFileSync('git', ['init', '--bare', '--initial-branch', 'main', bare], { env: gitEnv(), stdio: 'pipe' });
  const build = path.join(root, 'build');
  execFileSync('git', ['clone', '--no-tags', '--no-checkout', sourceRepo, build], { env: gitEnv(), stdio: 'pipe' });
  git(build, ['checkout', '--detach', sourceSha]);
  if (stagingSentinel) {
    // #138 baseline material: a post already IN the staging tree that lints
    // dirty, so an evaluator can prove a wrong-baseline lint changes result.
    appendPost(build, sentinelPost('acceptance-staging-baseline-sentinel'));
    git(build, ['add', '--', 'data/posts.json']);
    git(build, [...BOT, 'commit', '-m', 'fixture: staging baseline sentinel post']);
  }
  let baseSha = git(build, ['rev-parse', 'HEAD']);
  if (mutateStaging) mutateStaging(build, (args, options) => git(build, args, options));
  const stagingSha = git(build, ['rev-parse', 'HEAD']);
  if (mainAt === 'staging') baseSha = stagingSha;
  git(build, ['push', bare, `${stagingSha}:refs/heads/staging`, `${baseSha}:refs/heads/main`]);
  git(bare, ['symbolic-ref', 'HEAD', 'refs/heads/staging']);
  writeProtectionHook(bare);
  const clone = path.join(root, 'clone');
  execFileSync('git', ['clone', '--no-tags', bare, clone], { env: gitEnv(), stdio: 'pipe' });
  if (cloneSplit) {
    // Required #138 split: `git show HEAD:data/posts.json` from the CLONE root
    // must differ from the same command in the staging worktree.
    appendPost(clone, sentinelPost('acceptance-clone-head-sentinel'));
    git(clone, ['checkout', '-b', 'acceptance-clone-head']);
    git(clone, ['add', '--', 'data/posts.json']);
    git(clone, [...BOT, 'commit', '-m', 'fixture: clone-head sentinel split']);
  }
  const fixture = {
    root, bare, clone, baseSha, stagingSha,
    bareGit: (args, options) => git(bare, args, options),
    cloneGit: (args, options) => git(clone, args, options),
    rev: (ref) => git(bare, ['rev-parse', '--verify', `${ref}^{commit}`]),
    parentsOf(sha) { return git(bare, ['rev-list', '--parents', '-n', '1', sha]).split(/\s+/).slice(1); },
    isAncestor(ancestor, descendant) {
      try { git(bare, ['merge-base', '--is-ancestor', ancestor, descendant]); return true; } catch { return false; }
    },
    diffNames(from, to, paths = []) {
      const args = ['diff', '--name-only', from, to];
      if (paths.length) args.push('--', ...paths);
      return git(bare, args).split('\n').filter(Boolean);
    },
    threeDotFiles(base, head) {
      return git(bare, ['diff', '--name-only', `${base}...${head}`]).split('\n').filter(Boolean);
    },
    counts(left, right) {
      const [behind, ahead] = git(bare, ['rev-list', '--left-right', '--count', `${left}...${right}`]).split(/\s+/).map(Number);
      return { behind, ahead };
    },
    show(ref, file) { return git(bare, ['show', `${ref}:${file}`], { maxBuffer: 64 * 1024 * 1024 }); },
    remoteHeads() {
      return git(bare, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/'])
        .split('\n').filter(Boolean).map((line) => line.split(' '));
    },
    protectionLog() {
      const file = path.join(bare, 'protection-attempts.log');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
    },
    graphInvariant() {
      const main = fixture.rev('main');
      const staging = fixture.rev('staging');
      return {
        ancestor: fixture.isAncestor(main, staging),
        blogDelta: fixture.diffNames(main, staging, [...BLOG_PATHS]),
      };
    },
    // GitHub merge-API analogue: updates a protected ref through a temporary
    // worktree on the bare repository. Local ref updates never run the
    // pre-receive hook — exactly like GitHub's own merge endpoint.
    mergeViaApi({ base, headSha, method = 'merge', message }) {
      const wt = fs.mkdtempSync(path.join(root, 'merge-wt-'));
      try {
        git(bare, ['worktree', 'add', wt, base]);
        const text = message || `Merge ${headSha.slice(0, 12)} into ${base}`;
        if (method === 'merge') git(wt, [...BOT, 'merge', '--no-ff', '-m', text, headSha]);
        else if (method === 'ff') git(wt, ['merge', '--ff-only', headSha]);
        else if (method === 'squash') {
          git(wt, ['merge', '--squash', headSha]);
          git(wt, [...BOT, 'commit', '-m', text]);
        } else throw new Error(`unknown merge method: ${method}`);
        return git(wt, ['rev-parse', 'HEAD']);
      } finally {
        try { git(bare, ['worktree', 'remove', '--force', wt]); } catch { /* already gone */ }
      }
    },
    // Builds the sync/main-<sha12> head: a --no-ff merge of main into staging,
    // parked on a NON-protected ref. Returns head SHA + the incoming tree delta
    // relative to the current staging tip. Never touches refs/heads/staging.
    buildSyncHead(mainSha) {
      const staging = fixture.rev('staging');
      const wt = fs.mkdtempSync(path.join(root, 'sync-wt-'));
      try {
        git(bare, ['worktree', 'add', '--detach', wt, staging]);
        git(wt, [...BOT, 'merge', '--no-ff', '-m', `sync: main ${mainSha.slice(0, 12)} into staging`, mainSha]);
        const headSha = git(wt, ['rev-parse', 'HEAD']);
        const branch = `sync/main-${mainSha.slice(0, 12)}`;
        git(bare, ['update-ref', `refs/heads/${branch}`, headSha]);
        return { branch, headSha, delta: fixture.diffNames(staging, headSha) };
      } finally {
        try { git(bare, ['worktree', 'remove', '--force', wt]); } catch { /* already gone */ }
      }
    },
    revertOnStaging(sha) {
      git(build, ['checkout', '--detach', fixture.stagingSha]);
      git(build, [...BOT, 'revert', '--no-edit', sha]);
      const reverted = git(build, ['rev-parse', 'HEAD']);
      git(build, ['push', '--force', bare, `${reverted}:refs/heads/staging-next`]);
      git(bare, ['update-ref', 'refs/heads/staging', reverted]);
      git(bare, ['update-ref', '-d', 'refs/heads/staging-next']);
      fixture.stagingSha = reverted;
      return reverted;
    },
    // Builds an untrusted supervisor data commit (staging-parented, posts.json
    // only) and parks it on a supervisor/blog-data-<digits> ref, exactly like
    // the host's publish step. Used by controls that drive ingest directly.
    makeDataBranch(post) {
      const wt = fs.mkdtempSync(path.join(root, 'data-wt-'));
      try {
        git(bare, ['worktree', 'add', '--detach', wt, fixture.rev('staging')]);
        appendPost(wt, post);
        git(wt, ['add', '--', 'data/posts.json']);
        git(wt, ['-c', 'user.name=exe.dev supervisor', '-c', 'user.email=supervisor@exe.dev', 'commit', '-m', 'blog: supervised candidate data']);
        const dataSha = git(wt, ['rev-parse', 'HEAD']);
        const dataBranch = `supervisor/blog-data-${Date.now()}`;
        git(bare, ['update-ref', `refs/heads/${dataBranch}`, dataSha]);
        return { dataSha, dataBranch };
      } finally {
        try { git(bare, ['worktree', 'remove', '--force', wt]); } catch { /* gone */ }
      }
    },
    commitOnBranch(branch, mutate, message) {
      const wt = fs.mkdtempSync(path.join(root, 'branch-wt-'));
      try {
        git(bare, ['worktree', 'add', '--detach', wt, fixture.rev(branch)]);
        mutate(wt, (args, options) => git(wt, args, options));
        git(wt, ['add', '--all']);
        git(wt, [...BOT, 'commit', '-m', message]);
        const sha = git(wt, ['rev-parse', 'HEAD']);
        git(bare, ['update-ref', `refs/heads/${branch}`, sha]);
        return sha;
      } finally {
        try { git(bare, ['worktree', 'remove', '--force', wt]); } catch { /* gone */ }
      }
    },
    commitOnStaging(mutate, message) {
      const sha = fixture.commitOnBranch('staging', mutate, message);
      fixture.stagingSha = sha;
      return sha;
    },
  };
  return fixture;
}

export function assertContainedOrigin(cloneDir, root) {
  const url = git(cloneDir, ['remote', 'get-url', 'origin']);
  if (/^(https?|ssh|git):|^git@/.test(url)) throw new Error(`refused non-local fixture origin: ${url}`);
  const resolved = path.resolve(url);
  if (resolved !== root && !resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`refused fixture origin outside the evaluator root: ${url}`);
  }
  return resolved;
}
