import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Drive the scheduled runner's real main -> runRefresh -> command -> Node child
// path. Substitute checkout tools and CLI responses; inspect the actual child's
// environment before either evaluation or planning can do any network/DB work.
test('scheduled refresh evaluate child gets GSC credentials without broadening other CLI environments', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-refresh-gsc-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'state');
  const slot = '202610270423-env-test';
  const run = path.join(state, 'refresh/staging', slot);
  for (const dir of [bin, run, path.join(repo, '.git'), path.join(repo, 'scripts/content')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(run, 'gsc.json'), '{}');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
case "$1" in
  remote) printf '%s\\n' 'https://github.com/jonkthomas/libertyvillage.git' ;;
  rev-parse) printf '%s\\n' '${'a'.repeat(40)}' ;;
esac
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const trace = path.join(repo, 'children.jsonl');
  fs.writeFileSync(path.join(repo, 'scripts/content/cli.mjs'), `import fs from 'node:fs';
const sub = process.argv[3];
const env = { ...process.env };
// macOS adds this process-local value independently of the runner allowlist.
delete env.__CF_USER_TEXT_ENCODING;
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ sub, env }) + '\\n');
console.log(JSON.stringify(sub === 'evaluate'
  ? { evaluated: 0, reverted: 0, won: 0, deferred: 0, outcomes: [], learnings: '' }
  : { candidates: [], remaining: 2 }));
`);
  fs.writeFileSync(path.join(repo, 'scripts/content/refresh.mjs'), `export async function runRefreshLoop({ deps }) {
await deps.plan(); return { refreshed: 0, attempted: 0 };
}`);
  const trusted = {
    PATH: `${bin}:${process.env.PATH}`, HOME: root, LANG: 'C', TZ: 'UTC', NODE_ENV: 'test',
    CONTENT_DATABASE_URL: 'postgres://postgres@127.0.0.1:55432/lv_staging',
    CONTENT_DATABASE_URL_UNPOOLED: 'postgres://postgres@127.0.0.1:55432/lv_staging',
    CONTENT_DB_NAME: 'lv_staging', CONTENT_TARGET: 'staging', CONTENT_SITE_URL: 'https://staging.invalid',
    CONTENT_SITE_BYPASS: 'fixture-bypass', CONTENT_DEPLOY_HOOK_URL: 'https://staging.invalid/hook',
    ANTHROPIC_API_KEY: 'fixture-agent',
  };
  const credentials = path.join(root, 'fixture-gsc.json');
  const child = spawnSync(process.execPath, [new URL('../../ops/exedev-runner/runner.mjs', import.meta.url).pathname,
    'seo-improvements', 'staging', slot], { encoding: 'utf8', timeout: 15000, env: {
    ...trusted, GOOGLE_APPLICATION_CREDENTIALS: credentials,
    LV_RUNNER_REPO: repo, LV_RUNNER_STATE_ROOT: state, LV_RUNNER_LOG_ROOT: path.join(root, 'logs'),
    SERPAPI_API_KEY: 'fixture-source', APIFY_API_TOKEN: 'fixture-apify', GOOGLE_API_KEY: 'fixture-google',
    POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE: 'fixture-posthog', DEEPSEEK_API_KEY: 'fixture-deepseek',
    UNRELATED_ENV: 'fixture-unrelated',
  } });
  assert.equal(child.status, 0, child.stderr);
  const children = fs.readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(children.map((c) => c.sub), ['evaluate', 'plan']);
  assert.equal(children[0].env.GOOGLE_APPLICATION_CREDENTIALS, credentials);
  assert.deepEqual(children[0].env, { ...trusted, GOOGLE_APPLICATION_CREDENTIALS: credentials });
  assert.deepEqual(children[1].env, trusted, 'the extra GSC credential is scoped to evaluation only');
  t.diagnostic('Scheduled runner spawned evaluate with GSC + trusted allowlist only; plan retains the original trusted allowlist.');
});
