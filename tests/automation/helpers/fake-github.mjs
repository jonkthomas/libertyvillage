// A small in-memory GitHub good enough to EXECUTE the coordinator's production
// paths end to end, over real HTTP, through the real `github.mjs` client.
//
// It is deliberately not a mock of the coordinator: the tests spawn the actual CLI
// (`node scripts/automation/coordinator.mjs ...`) with GITHUB_API_URL pointed here,
// so argument parsing, the command registry, the policy modules, the durable state
// issue and the exit codes are all the shipped ones.
import http from 'node:http';

const TRUSTED_BOT = 'github-actions[bot]';

export function fakeGithubEnv(apiUrl, overrides = {}, baseEnv = process.env) {
  return {
    ...baseEnv,
    ...overrides,
    GITHUB_API_URL: apiUrl,
    GH_TOKEN: 'test-token',
    LV_EXE_GITHUB_PROXY_AUTH: 'false',
  };
}

export function createFakeGitHub({ repo = 'owner/repo' } = {}) {
  const issues = new Map();
  const comments = new Map();
  const labels = new Set();
  const requests = [];
  const files = new Map();
  let nextNumber = 100;
  let compare = {
    merge_base_commit: { sha: 'b'.repeat(40) }, ahead_by: 1, behind_by: 0, status: 'ahead',
    files: [{ filename: 'data/posts.json' }],
    diff: 'diff --git a/data/posts.json b/data/posts.json\n+one line\n',
  };
  const branches = new Map([
    ['main', 'a'.repeat(40)],
    ['staging', 'b'.repeat(40)],
  ]);
  const statuses = new Map();
  const PROTECTED = new Set(['main', 'staging']);

  const asIssue = (record) => ({
    number: record.number,
    title: record.title,
    body: record.body,
    state: record.state,
    user: { login: record.author },
    labels: [...record.labels].map((name) => ({ name })),
    updated_at: record.updatedAt,
    ...(record.pull ? { pull_request: { url: `/repos/${repo}/pulls/${record.number}` } } : {}),
  });

  const asPull = (record) => ({
    number: record.number,
    title: record.title,
    state: record.state,
    draft: false,
    merged: record.merged === true,
    merge_commit_sha: record.merge_commit_sha ?? null,
    user: { login: record.author },
    labels: [...record.labels].map((name) => ({ name })),
    updated_at: record.updatedAt,
    head: { ref: record.headRef, sha: record.headSha, repo: { full_name: repo, fork: false } },
    base: { ref: record.baseRef, repo: { full_name: repo } },
  });

  function addIssue({ title, body = '', author = TRUSTED_BOT, labels: names = [], state = 'open' }) {
    const number = nextNumber += 1;
    issues.set(number, { number, title, body, author, labels: new Set(names), state, updatedAt: new Date().toISOString(), pull: false });
    comments.set(number, []);
    return issues.get(number);
  }

  function addPull({ headRef, headSha, baseRef = 'staging', author = TRUSTED_BOT, labels: names = [], state = 'open', updatedAt = new Date().toISOString(), title = 'candidate' }) {
    const number = nextNumber += 1;
    issues.set(number, { number, title, body: '', author, labels: new Set(names), state, updatedAt, pull: true, headRef, headSha, baseRef });
    comments.set(number, []);
    return issues.get(number);
  }

  function addComment(number, body, author = TRUSTED_BOT) {
    comments.get(number).push({ id: comments.get(number).length + 1, body, user: { login: author } });
  }

  // Simulates the clock advancing between two scheduled runs: every durable
  // timestamp the ladder reads is moved back by `hours`.
  function fastForward(hours) {
    const shift = (iso) => new Date(Date.parse(iso) - hours * 3600_000).toISOString();
    for (const record of issues.values()) {
      record.updatedAt = shift(record.updatedAt);
      record.body = record.body.replace(/"(lastFailureAt|abandonedAt)":"([^"]+)"/g, (_, field, value) => `"${field}":"${shift(value)}"`);
    }
  }

  const json = (response, status, payload) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(payload === undefined ? '' : JSON.stringify(payload));
  };

  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const url = new URL(request.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ method: request.method, path: url.pathname, query: url.search, body });
      const base = `/repos/${repo}`;

      if (!url.pathname.startsWith(base)) return json(response, 404, { message: 'no such repo' });
      const tail = parts.slice(3);

      // GET /compare/{range} — JSON for the merge base, raw text for the diff.
      if (request.method === 'GET' && tail[0] === 'compare') {
        if (String(request.headers.accept || '').includes('diff')) {
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          return response.end(compare.diff);
        }
        return json(response, 200, {
          merge_base_commit: compare.merge_base_commit, ahead_by: compare.ahead_by,
          behind_by: compare.behind_by ?? 0, status: compare.status ?? 'ahead',
          files: compare.files ?? [],
        });
      }

      if (request.method === 'GET' && tail[0] === 'branches' && tail[1]) {
        const sha = branches.get(tail[1]);
        if (!sha) return json(response, 404, { message: 'no such branch' });
        return json(response, 200, { name: tail[1], commit: { sha } });
      }

      if (request.method === 'GET' && tail[0] === 'commits' && tail[2] === 'status') {
        const list = statuses.get(tail[1]) || [];
        return json(response, 200, { sha: tail[1], statuses: list, state: 'pending' });
      }

      if (request.method === 'POST' && tail[0] === 'statuses' && tail[1]) {
        const context = body?.context;
        if (context === 'Vercel') return json(response, 422, { message: 'Vercel is not a coordinator publish context' });
        const list = statuses.get(tail[1]) || [];
        list.push({ context, state: body?.state, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        statuses.set(tail[1], list);
        return json(response, 201, { context, state: body?.state });
      }

      if (request.method === 'POST' && tail[0] === 'merges') {
        if (PROTECTED.has(body?.base)) {
          return json(response, 403, { message: 'GH006: protected branch require a pull request' });
        }
        return json(response, 201, { sha: 'c'.repeat(40), merged: true });
      }

      if (tail[0] === 'git' && tail[1] === 'refs') {
        const ref = body?.ref || tail.slice(2).join('/');
        const name = String(ref || '').replace(/^refs\/heads\//, '');
        if (PROTECTED.has(name) && (request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE')) {
          return json(response, 403, { message: 'GH006: protected branch require a pull request' });
        }
        if (request.method === 'POST') return json(response, 201, { ref: body?.ref, object: { sha: body?.sha } });
        if (request.method === 'DELETE') return json(response, 204);
      }

      // GET /contents/{path}?ref=sha — the repository-controlled reference data.
      if (request.method === 'GET' && tail[0] === 'contents') {
        const file = decodeURIComponent(tail.slice(1).join('/'));
        const stored = files.get(`${file}@${url.searchParams.get('ref')}`);
        if (stored === undefined) return json(response, 404, { message: 'Not Found' });
        return json(response, 200, { type: 'file', encoding: 'base64', content: Buffer.from(stored, 'utf8').toString('base64') });
      }

      // GET /issues  (state issue lookup)
      if (request.method === 'GET' && tail[0] === 'issues' && tail.length === 1) {
        const wanted = url.searchParams.get('labels');
        const state = url.searchParams.get('state') || 'open';
        const page = Number(url.searchParams.get('page') || '1');
        const matches = page > 1 ? [] : [...issues.values()]
          .filter((record) => record.state === state)
          .filter((record) => !wanted || record.labels.has(wanted))
          .map(asIssue);
        return json(response, 200, matches);
      }

      // POST /issues (create the durable state issue)
      if (request.method === 'POST' && tail[0] === 'issues' && tail.length === 1) {
        const created = addIssue({ title: body.title, body: body.body, labels: body.labels || [] });
        return json(response, 201, asIssue(created));
      }

      // POST /labels
      if (request.method === 'POST' && tail[0] === 'labels' && tail.length === 1) {
        if (labels.has(body.name)) return json(response, 422, { message: 'already_exists' });
        labels.add(body.name);
        return json(response, 201, { name: body.name });
      }

      // /issues/{n}...
      if (tail[0] === 'issues' && tail.length >= 2) {
        const number = Number(tail[1]);
        const record = issues.get(number);
        if (!record) return json(response, 404, { message: 'no such issue' });

        if (request.method === 'GET' && tail.length === 2) return json(response, 200, asIssue(record));
        if (request.method === 'PATCH' && tail.length === 2) {
          if (typeof body?.body === 'string') record.body = body.body;
          if (typeof body?.state === 'string') record.state = body.state;
          record.updatedAt = new Date().toISOString();
          return json(response, 200, asIssue(record));
        }
        if (tail[2] === 'comments') {
          if (request.method === 'GET') {
            const page = Number(url.searchParams.get('page') || '1');
            return json(response, 200, page > 1 ? [] : comments.get(number));
          }
          if (request.method === 'POST') {
            addComment(number, body.body);
            return json(response, 201, { id: comments.get(number).length });
          }
        }
        if (tail[2] === 'labels') {
          if (request.method === 'POST') {
            for (const name of body.labels || []) record.labels.add(name);
            return json(response, 200, [...record.labels].map((name) => ({ name })));
          }
          if (request.method === 'DELETE' && tail[3]) {
            const name = decodeURIComponent(tail[3]);
            if (!record.labels.delete(name)) return json(response, 404, { message: 'label not set' });
            return json(response, 200, []);
          }
        }
      }

      // GET /pulls  (open candidates for a base branch)
      if (request.method === 'GET' && tail[0] === 'pulls' && tail.length === 1) {
        const wantedBase = url.searchParams.get('base');
        const state = url.searchParams.get('state') || 'open';
        const page = Number(url.searchParams.get('page') || '1');
        const matches = page > 1 ? [] : [...issues.values()]
          .filter((record) => record.pull && record.state === state)
          .filter((record) => !wantedBase || record.baseRef === wantedBase)
          .map(asPull);
        return json(response, 200, matches);
      }

      // /pulls/{n}
      if (tail[0] === 'pulls' && tail.length >= 2) {
        const record = issues.get(Number(tail[1]));
        if (!record?.pull) return json(response, 404, { message: 'no such pull' });
        if (tail[2] === 'files' && request.method === 'GET') {
          const page = Number(url.searchParams.get('page') || '1');
          return json(response, 200, page > 1 ? [] : (record.files || []).map((filename) => ({ filename })));
        }
        if (tail[2] === 'merge' && request.method === 'PUT') {
          if (PROTECTED.has(record.baseRef) && record.state !== 'open') {
            return json(response, 403, { message: 'GH006: protected branch require a pull request' });
          }
          if (body?.merge_method && body.merge_method !== 'merge') {
            return json(response, 422, { message: 'squash/rebase merges are forbidden' });
          }
          record.merged = true;
          record.state = 'closed';
          record.merge_commit_sha = record.headSha;
          return json(response, 200, { merged: true, sha: record.headSha });
        }
        if (request.method === 'GET' && tail.length === 2) return json(response, 200, asPull(record));
        if (request.method === 'PATCH' && tail.length === 2) {
          if (typeof body?.state === 'string') record.state = body.state;
          record.updatedAt = new Date().toISOString();
          return json(response, 200, asPull(record));
        }
      }

      return json(response, 404, { message: `unhandled ${request.method} ${url.pathname}` });
    });
  });

  return {
    server,
    requests,
    addIssue,
    addPull,
    addComment,
    fastForward,
    setFile: (file, ref, contents) => files.set(`${file}@${ref}`, contents),
    setCompare: (next) => { compare = { ...compare, ...next }; },
    setBranch: (name, sha) => branches.set(name, sha),
    issueByTitle: (title) => [...issues.values()].find((record) => record.title === title) ?? null,
    commentsOn: (number) => comments.get(number) ?? [],
    pull: (number) => issues.get(number),
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
