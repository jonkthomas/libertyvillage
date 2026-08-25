import fs from 'node:fs';
import { isExactSha } from './policy.mjs';

const DEFAULT_API = 'https://api.github.com';
export const EXE_GITHUB_PROXY_HOST = 'github.int.exe.xyz';

export function githubRequestAuth(env = process.env) {
  const api = env.GITHUB_API_URL || DEFAULT_API;
  let parsed;
  try {
    parsed = new URL(api);
  } catch {
    throw new Error(`invalid GITHUB_API_URL: ${api}`);
  }
  const proxyAuth = env.LV_EXE_GITHUB_PROXY_AUTH === 'true';
  if (proxyAuth) {
    if (parsed.protocol !== 'https:' || parsed.host !== EXE_GITHUB_PROXY_HOST) {
      throw new Error(`LV_EXE_GITHUB_PROXY_AUTH is restricted to https://${EXE_GITHUB_PROXY_HOST}`);
    }
    return { api, authorization: null };
  }
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');
  return { api, authorization: `Bearer ${token}` };
}

export async function github(path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  const { api, authorization } = githubRequestAuth();
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      Accept: accept,
      ...(authorization ? { Authorization: authorization } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'liberty-village-automation-coordinator',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  if (!text) return null;
  if (accept.includes('diff')) return text;
  return JSON.parse(text);
}

export async function paged(path) {
  const join = path.includes('?') ? '&' : '?';
  const values = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await github(`${path}${join}per_page=100&page=${page}`);
    if (!Array.isArray(result)) throw new Error(`expected array from ${path}`);
    values.push(...result);
    if (result.length < 100) return values;
  }
  throw new Error(`pagination limit exceeded for ${path}`);
}

export async function mergeBaseSha(repo, baseRef, sha) {
  const comparison = await github(`/repos/${repo}/compare/${encodeURIComponent(baseRef)}...${sha}`);
  const baseSha = comparison?.merge_base_commit?.sha;
  if (!isExactSha(baseSha)) throw new Error('cannot resolve an exact merge base for the PR head');
  return baseSha;
}

export function writeOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  for (const [key, raw] of Object.entries(values)) {
    const value = String(raw ?? '');
    if (value.includes('\n')) throw new Error(`multiline GitHub output not allowed: ${key}`);
    if (outputPath) fs.appendFileSync(outputPath, `${key}=${value}\n`);
    else console.log(`${key}=${value}`);
  }
}
