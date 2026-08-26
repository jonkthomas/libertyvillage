// Eval-owned loopback GitHub simulator for the local live-model supervisor
// acceptance gate. FROZEN by evals/local-supervisor-acceptance.sha256.
//
// This is an external-system double, not a supervisor mock: it never imports
// runBlogSupervisor, never touches the ledger, and its only authorities are its
// in-memory HTTP state and the temporary bare Git remote. It EXECUTES the
// production ingest validators (validateIngestPayload / validateIngestDiff /
// validatePaths('blog-live') / contentShipEnabled) and the trusted-main
// re-lint, and creates the Actions-authored base=main PR synchronously inside
// the repository-dispatch handler. Everything AFTER PR creation — statuses,
// exact synthetic merge-ref validation, merge, production Vercel, PR-shaped
// sync — lives in fake-supervisor-protection.mjs and is driven only after the
// child is observed polling the pinned head (or immediately, for
// evaluator-driven controls that run no child).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitEnv } from './local-git-fixture.mjs';
import { createLifecycleDriver } from './fake-supervisor-protection.mjs';

const BOT = 'github-actions[bot]';
const PUBLISH_CONTEXTS = Object.freeze(['automation/ci', 'automation/opus-gate']);

export function createSupervisorGithub({ repo, fixture, prod, controls = {}, childEnvLike = {} }) {
  const owner = repo.split('/')[0];
  const issues = new Map();
  const comments = new Map();
  const statuses = new Map();
  const requests = [];
  const events = [];
  let nextNumber = 200;
  const record = (type, data) => events.push({ type, at: new Date().toISOString(), ...data });

  const addIssue = ({ title, body = '', author = BOT, labels = [], state = 'open', pull = false, head = null, base = null, files = [] }) => {
    const number = nextNumber += 1;
    const entry = {
      number, title, body, author, labels: new Set(labels), state, pull,
      headRef: head?.ref, headSha: head?.sha, baseRef: base, files: [...files],
      merged: false, merge_commit_sha: null, updatedAt: new Date().toISOString(),
    };
    issues.set(number, entry);
    comments.set(number, []);
    return entry;
  };

  const asIssue = (entry) => ({
    number: entry.number, title: entry.title, body: entry.body, state: entry.state,
    user: { login: entry.author }, labels: [...entry.labels].map((name) => ({ name })),
    updated_at: entry.updatedAt, ...(entry.pull ? { pull_request: { url: `/repos/${repo}/pulls/${entry.number}` } } : {}),
  });
  const asPull = (entry) => ({
    number: entry.number, title: entry.title, state: entry.state, draft: false,
    merged: entry.merged, merge_commit_sha: entry.merge_commit_sha,
    user: { login: entry.author }, labels: [...entry.labels].map((name) => ({ name })),
    updated_at: entry.updatedAt,
    head: { ref: entry.headRef, sha: entry.headSha, repo: { full_name: repo, fork: false } },
    base: { ref: entry.baseRef, repo: { full_name: repo } },
  });

  const postStatus = (sha, context, state, actor) => {
    if (actor === 'coordinator-double' && !PUBLISH_CONTEXTS.includes(context)) {
      throw new Error(`coordinator double refused non-publish context: ${context}`);
    }
    if (!statuses.has(sha)) statuses.set(sha, []);
    statuses.get(sha).push({ context, state, actor, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    record('status', { sha, context, state, actor });
  };

  const addAudit = (number, sha, decision, attempt = 0) => {
    const body = [
      `<!-- automation-audit:${sha}:${decision}:${attempt} -->`,
      `<!-- automation-audit-data:${JSON.stringify({ sha, decision, attempt })} -->`,
      `Autonomous gate audit: **${decision}** for \`${sha}\`.`,
    ].join('\n');
    comments.get(number).push({ id: comments.get(number).length + 1, body, user: { login: BOT } });
    record('audit-comment', { number, sha, decision });
  };

  const statusesFor = (sha) => statuses.get(sha) || [];
  const lifecycle = createLifecycleDriver({
    fixture, prod, controls,
    hub: { repo, record, postStatus, addAudit, addIssue, asPull, statusesFor },
  });

  const runTrustedLint = (wt) => {
    execFileSync(process.execPath, [path.join(wt, 'scripts/blog-lint.mjs'), '--posts', 'data/posts.json', '--businesses', 'data/businesses.json'], {
      cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...gitEnv(), LINT_MODE: undefined },
    });
  };

  const bareWorktree = (ref, fn) => {
    const wt = fs.mkdtempSync(path.join(fixture.root, 'ingest-wt-'));
    try {
      fixture.bareGit(['worktree', 'add', '--detach', wt, ref]);
      return fn(wt, (args, options) => execFileSync('git', ['-C', wt, ...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(), ...options,
      }).trim());
    } finally {
      try { fixture.bareGit(['worktree', 'remove', '--force', wt]); } catch { /* gone */ }
    }
  };

  function requireContentShip() {
    if (typeof prod.contentShipEnabled !== 'function') {
      throw new Error('production contentShipEnabled is unavailable; blog-live ingest cannot be enabled');
    }
    const ownerFile = path.join(fixture.root, 'ingest-owner.txt');
    fs.writeFileSync(ownerFile, `${fixture.show('main', 'ops/exedev-supervisor/owner.txt').trim()}\n`);
    const enabled = prod.contentShipEnabled(
      { LV_WEEKLY_OWNER: childEnvLike.LV_WEEKLY_OWNER, LV_CONTENT_SHIP_ENABLED: childEnvLike.LV_CONTENT_SHIP_ENABLED },
      { ownerFile, owner: fixture.show('main', 'ops/exedev-supervisor/owner.txt').trim() },
    );
    if (enabled !== true) throw new Error('contentShipEnabled is false; blog-live ingest refused');
  }

  // Design C ingest semantics, executed synchronously inside the dispatch
  // handler so the trusted PR exists before the HTTP response returns. The PR
  // lifecycle (statuses/merge-ref/merge/Vercel/sync) is NOT run here — it is
  // armed for external driving once the host observes the pinned head.
  function runIngest(payload) {
    const checked = prod.validateIngestPayload(payload);
    if (!checked.ok) throw new Error(`invalid ingest payload: ${checked.errors.join('; ')}`);
    requireContentShip();
    const branchSha = fixture.bareGit(['rev-parse', '--verify', `refs/heads/${payload.data_branch}^{commit}`]);
    if (branchSha !== payload.data_sha) throw new Error('data branch ownership re-check failed');
    const stagingSha = fixture.rev('staging');
    const mainSha = fixture.rev('main');
    const candidateFiles = fixture.threeDotFiles(stagingSha, payload.data_sha);
    const diffOk = prod.validateIngestDiff(candidateFiles);
    if (!diffOk.ok) throw new Error(`ingest diff rejected: ${diffOk.errors.join('; ')}`);
    if (!fixture.isAncestor(mainSha, stagingSha)) throw new Error('enablement tripwire: main is not an ancestor of staging');
    const parity = fixture.diffNames(mainSha, stagingSha, ['data/posts.json', 'public/images/blog/']);
    if (parity.length) throw new Error(`enablement tripwire: two-dot blog-path diff is non-empty: ${parity.join(', ')}`);
    bareWorktree(mainSha, (wt, wtGit) => {
      for (const file of candidateFiles) wtGit(['checkout', payload.data_sha, '--', file]);
      runTrustedLint(wt);
    });
    const base = controls.ingestBase || 'main';
    const branch = `blog/auto-supervisor-${payload.data_sha.slice(0, 12)}`;
    const headSha = bareWorktree(fixture.rev(base), (wt, wtGit) => {
      for (const file of candidateFiles) wtGit(['checkout', payload.data_sha, '--', file]);
      if (controls.injectFile) {
        fs.mkdirSync(path.dirname(path.join(wt, controls.injectFile)), { recursive: true });
        fs.writeFileSync(path.join(wt, controls.injectFile), '// planted by hitchhiker control\n');
        wtGit(['add', '--', controls.injectFile]);
      }
      wtGit(['add', '--all']);
      wtGit(['-c', `user.name=${BOT}`, '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', 'blog: ingest supervised weekly candidate']);
      return wtGit(['rev-parse', 'HEAD']);
    });
    const prFiles = fixture.threeDotFiles(mainSha, headSha);
    const pathsOk = prod.validatePaths('blog-live', prFiles);
    if (!pathsOk.ok) throw new Error(`blog-live path policy rejected the candidate: ${pathsOk.errors.join('; ')}`);
    const expected = [...candidateFiles].sort().join(',');
    if ([...prFiles].sort().join(',') !== expected) throw new Error('ingest tree parity failed: PR files differ from the candidate diff');
    fixture.bareGit(['update-ref', `refs/heads/${branch}`, headSha]);
    const pr = addIssue({ title: 'blog: supervised weekly candidate', pull: true, head: { ref: branch, sha: headSha }, base: 'main', files: prFiles });
    record('ingest-pr-created', { number: pr.number, head: branch, sha: headSha, base: 'main' });
    record('coordinator-dispatch', { kind: 'blog-live', sha: headSha, number: pr.number });
    record('mark-regeneration', { key: payload.topic_key });
    lifecycle.arm(pr);
    return pr;
  }

  const json = (response, status, payload) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(payload === undefined ? '' : JSON.stringify(payload));
  };

  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { return json(response, 400, { message: 'bad json' }); }
      const url = new URL(request.url, 'http://localhost');
      requests.push({ method: request.method, path: url.pathname, query: url.search, body, at: new Date().toISOString() });
      if (!url.pathname.startsWith(`/repos/${repo}`)) return json(response, 404, { message: 'no such repo' });
      const tail = url.pathname.split('/').filter(Boolean).slice(3).map(decodeURIComponent);
      const page = Number(url.searchParams.get('page') || '1');
      try {
        if (request.method === 'POST' && tail[0] === 'dispatches') {
          record('dispatch', { event_type: body?.event_type, payload: body?.client_payload });
          if (body?.event_type === 'supervisor-ingest-blog') {
            try { runIngest(body.client_payload); } catch (error) { record('ingest-failed', { error: error.message }); }
          }
          return json(response, 204);
        }
        if (tail[0] === 'pulls' && tail.length === 1 && request.method === 'GET') {
          const wantedBase = url.searchParams.get('base');
          const wantedHead = url.searchParams.get('head');
          const state = url.searchParams.get('state') || 'open';
          const matches = page > 1 ? [] : [...issues.values()].filter((entry) => entry.pull)
            .filter((entry) => state === 'all' || entry.state === state)
            .filter((entry) => !wantedBase || entry.baseRef === wantedBase)
            .filter((entry) => !wantedHead || `${owner}:${entry.headRef}` === wantedHead)
            .map(asPull);
          return json(response, 200, matches);
        }
        if (tail[0] === 'pulls' && tail.length === 1 && request.method === 'POST') {
          record('http-pull-create-refused', { body });
          return json(response, 403, { message: 'pull request creation is Actions-owned in this double' });
        }
        if (tail[0] === 'pulls' && tail.length >= 2) {
          const entry = issues.get(Number(tail[1]));
          if (!entry?.pull) return json(response, 404, { message: 'no such pull' });
          if (tail[2] === 'files' && request.method === 'GET') {
            return json(response, 200, page > 1 ? [] : entry.files.map((filename) => ({ filename })));
          }
          if (request.method === 'GET') return json(response, 200, asPull(entry));
          if (request.method === 'PATCH') {
            if (typeof body?.state === 'string') entry.state = body.state;
            entry.updatedAt = new Date().toISOString();
            return json(response, 200, asPull(entry));
          }
        }
        if (tail[0] === 'commits' && tail[2] === 'status' && request.method === 'GET') {
          const sha = controls.statusPayloadSha || tail[1];
          const visible = (statuses.get(tail[1]) || [])
            .map((status) => ({ context: status.context, state: status.state, created_at: status.created_at, updated_at: status.updated_at }));
          json(response, 200, { sha, statuses: visible, state: 'pending' });
          lifecycle.onStatusPoll(tail[1]);
          return undefined;
        }
        if (tail[0] === 'commits' && tail.length === 2 && request.method === 'GET') {
          try {
            return json(response, 200, { sha: tail[1], parents: fixture.parentsOf(tail[1]).map((sha) => ({ sha })) });
          } catch { return json(response, 404, { message: 'no such commit' }); }
        }
        if (tail[0] === 'branches' && request.method === 'GET') {
          try { return json(response, 200, { name: tail[1], commit: { sha: fixture.rev(tail[1]) } }); }
          catch { return json(response, 404, { message: 'no such branch' }); }
        }
        if (tail[0] === 'compare' && request.method === 'GET') {
          const [left, right] = tail.slice(1).join('/').split('...');
          try {
            const leftSha = fixture.rev(left);
            const rightSha = fixture.rev(right);
            const { behind, ahead } = fixture.counts(leftSha, rightSha);
            const status = leftSha === rightSha ? 'identical' : behind === 0 ? 'ahead' : ahead === 0 ? 'behind' : 'diverged';
            const mergeBase = fixture.bareGit(['merge-base', leftSha, rightSha]);
            return json(response, 200, { status, ahead_by: ahead, behind_by: behind, total_commits: ahead, merge_base_commit: { sha: mergeBase } });
          } catch { return json(response, 404, { message: 'cannot compare' }); }
        }
        if (tail[0] === 'contents' && request.method === 'GET') {
          try {
            const text = fixture.show(url.searchParams.get('ref'), tail.slice(1).join('/'));
            return json(response, 200, { type: 'file', encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64') });
          } catch { return json(response, 404, { message: 'Not Found' }); }
        }
        if (tail[0] === 'statuses' && request.method === 'POST') {
          if (body?.context && !PUBLISH_CONTEXTS.includes(body.context)) {
            record('http-status-refused', { sha: tail[1], context: body.context });
            return json(response, 422, { message: `context ${body.context} is not a coordinator publish context` });
          }
          postStatus(tail[1], body.context, body.state, 'http-coordinator');
          return json(response, 201, { state: body.state, context: body.context });
        }
        if (tail[0] === 'labels' && request.method === 'POST') return json(response, 201, { name: body?.name });
        if (tail[0] === 'issues' && tail.length === 1) {
          if (request.method === 'GET') {
            const wanted = url.searchParams.get('labels');
            const state = url.searchParams.get('state') || 'open';
            const matches = page > 1 ? [] : [...issues.values()]
              .filter((entry) => state === 'all' || entry.state === state)
              .filter((entry) => !wanted || entry.labels.has(wanted))
              .map(asIssue);
            return json(response, 200, matches);
          }
          if (request.method === 'POST') {
            return json(response, 201, asIssue(addIssue({ title: body.title, body: body.body, labels: body.labels || [] })));
          }
        }
        if (tail[0] === 'issues' && tail.length >= 2) {
          const entry = issues.get(Number(tail[1]));
          if (!entry) return json(response, 404, { message: 'no such issue' });
          if (request.method === 'GET' && tail.length === 2) return json(response, 200, asIssue(entry));
          if (request.method === 'PATCH' && tail.length === 2) {
            if (typeof body?.body === 'string') entry.body = body.body;
            if (typeof body?.state === 'string') entry.state = body.state;
            entry.updatedAt = new Date().toISOString();
            return json(response, 200, asIssue(entry));
          }
          if (tail[2] === 'comments') {
            if (request.method === 'GET') return json(response, 200, page > 1 ? [] : comments.get(entry.number));
            if (request.method === 'POST') {
              comments.get(entry.number).push({ id: comments.get(entry.number).length + 1, body: body.body, user: { login: BOT } });
              return json(response, 201, { id: comments.get(entry.number).length });
            }
          }
          if (tail[2] === 'labels' && request.method === 'POST') {
            for (const name of body?.labels || []) entry.labels.add(name);
            return json(response, 200, [...entry.labels].map((name) => ({ name })));
          }
          if (tail[2] === 'labels' && request.method === 'DELETE' && tail[3]) {
            if (!entry.labels.delete(tail[3])) return json(response, 404, { message: 'label not set' });
            return json(response, 200, []);
          }
        }
        return json(response, 404, { message: `unhandled ${request.method} ${url.pathname}` });
      } catch (error) {
        record('simulator-error', { error: error.message });
        return json(response, 500, { message: error.message });
      }
    });
  });

  const api = {
    server, requests, events, issues, comments, statuses, controls,
    addIssue, addAudit, postStatus, runIngest,
    driveSync: lifecycle.driveSync, attemptDirectPush: lifecycle.attemptDirectPush,
    stageMerge: lifecycle.stageMerge, validateMergeRef: lifecycle.validateMergeRef,
    seedCandidateStateIssue() {
      const body = prod.renderCandidateState(prod.emptyCandidateState('blog'));
      return addIssue({ title: 'automation-state: blog candidate ladder', body, labels: ['automation-state'] });
    },
    pulls: () => [...issues.values()].filter((entry) => entry.pull),
    statusesFor,
    coordinatorPostedVercel: () => [...statuses.values()].flat()
      .some((status) => status.context === 'Vercel' && status.actor !== 'evaluator-vercel')
      || requests.some((entry) => entry.method === 'POST' && entry.path.includes('/statuses/') && entry.body?.context === 'Vercel'),
    dispatchKinds: () => events.filter((event) => event.type === 'coordinator-dispatch').map((event) => event.kind)
      .concat(events.filter((event) => event.type === 'dispatch' && event.event_type === 'autonomous-coordinate').map((event) => event.payload?.kind)),
    async listen() {
      await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() { await new Promise((resolve) => { server.close(resolve); }); },
  };
  return api;
}
