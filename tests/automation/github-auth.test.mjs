import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { github, githubRequestAuth } from '../../scripts/automation/github.mjs';
import { fakeGithubEnv } from './helpers/fake-github.mjs';

const INTERNAL_API = 'https://github.int.exe.xyz/api/v3';

test('GitHub auth policy allows tokenless access only for the explicit pinned exe.dev proxy', () => {
  assert.deepEqual(githubRequestAuth({
    GITHUB_API_URL: INTERNAL_API,
    LV_EXE_GITHUB_PROXY_AUTH: 'true',
  }), { api: INTERNAL_API, authorization: null });
  assert.throws(() => githubRequestAuth({
    GITHUB_API_URL: 'https://github.example.test/api/v3',
    LV_EXE_GITHUB_PROXY_AUTH: 'true',
    GH_TOKEN: 'must-not-bypass-host-pin',
  }), /restricted to https:\/\/github\.int\.exe\.xyz/);
  assert.throws(() => githubRequestAuth({
    GITHUB_API_URL: 'https://github.int.exe.xyz:8443/api/v3',
    LV_EXE_GITHUB_PROXY_AUTH: 'true',
  }), /restricted to https:\/\/github\.int\.exe\.xyz/);
  assert.throws(() => githubRequestAuth({
    GITHUB_API_URL: 'http://github.int.exe.xyz/api/v3',
    LV_EXE_GITHUB_PROXY_AUTH: 'true',
  }), /restricted to https:\/\/github\.int\.exe\.xyz/);
});

test('GitHub auth policy preserves token requirements outside proxy mode', () => {
  assert.deepEqual(githubRequestAuth({ GH_TOKEN: 'gh-value' }), {
    api: 'https://api.github.com', authorization: 'Bearer gh-value',
  });
  assert.deepEqual(githubRequestAuth({ GITHUB_TOKEN: 'github-value', LV_EXE_GITHUB_PROXY_AUTH: 'false' }), {
    api: 'https://api.github.com', authorization: 'Bearer github-value',
  });
  assert.throws(() => githubRequestAuth({}), /GH_TOKEN is required/);
});

test('fake GitHub subprocesses disable the VM transparent-proxy opt-in', () => {
  const api = 'http://127.0.0.1:12345';
  const env = fakeGithubEnv(api, {}, { LV_EXE_GITHUB_PROXY_AUTH: 'true' });
  assert.equal(env.LV_EXE_GITHUB_PROXY_AUTH, 'false');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', [
    "import { githubRequestAuth } from './scripts/automation/github.mjs'",
    'process.stdout.write(JSON.stringify(githubRequestAuth(process.env)))',
  ].join(';')], { encoding: 'utf8', env });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { api, authorization: 'Bearer test-token' });
});

test('GitHub runtime omits Authorization in transparent proxy mode', async () => {
  const prior = {
    fetch: globalThis.fetch,
    api: process.env.GITHUB_API_URL,
    proxy: process.env.LV_EXE_GITHUB_PROXY_AUTH,
    ghToken: process.env.GH_TOKEN,
    githubToken: process.env.GITHUB_TOKEN,
  };
  let request;
  try {
    process.env.GITHUB_API_URL = INTERNAL_API;
    process.env.LV_EXE_GITHUB_PROXY_AUTH = 'true';
    process.env.GH_TOKEN = 'must-not-be-forwarded';
    process.env.GITHUB_TOKEN = 'must-not-be-forwarded-either';
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, text: async () => '{"full_name":"jonkthomas/libertyvillage"}' };
    };
    assert.equal((await github('/repos/jonkthomas/libertyvillage')).full_name, 'jonkthomas/libertyvillage');
    assert.equal(request.url, `${INTERNAL_API}/repos/jonkthomas/libertyvillage`);
    assert.equal('Authorization' in request.options.headers, false);
  } finally {
    globalThis.fetch = prior.fetch;
    for (const [name, value] of [
      ['GITHUB_API_URL', prior.api], ['LV_EXE_GITHUB_PROXY_AUTH', prior.proxy],
      ['GH_TOKEN', prior.ghToken], ['GITHUB_TOKEN', prior.githubToken],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
