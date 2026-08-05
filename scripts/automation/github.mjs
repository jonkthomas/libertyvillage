import fs from 'node:fs';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

function token() {
  const value = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!value) throw new Error('GH_TOKEN is required');
  return value;
}

export async function github(path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token()}`,
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

export function writeOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  for (const [key, raw] of Object.entries(values)) {
    const value = String(raw ?? '');
    if (value.includes('\n')) throw new Error(`multiline GitHub output not allowed: ${key}`);
    if (outputPath) fs.appendFileSync(outputPath, `${key}=${value}\n`);
    else console.log(`${key}=${value}`);
  }
}
