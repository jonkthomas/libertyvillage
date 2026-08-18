#!/usr/bin/env node
// Read-only sentinel for PRs the autonomous gate blocked and nobody picked up.
// Lists open PRs labelled automation-blocked, keeps the ones whose last update is
// older than the staleness window, and emits one single-line Slack summary for the
// workflow to post. It never writes to the repository and never closes anything.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paged, writeOutput } from './github.mjs';

export const BLOCKED_LABEL = 'automation-blocked';
export const STALE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

function hasBlockedLabel(item) {
  return (item?.labels || []).some((label) => (typeof label === 'string' ? label : label?.name) === BLOCKED_LABEL);
}

// Pure and clock-injectable: `now` is a millisecond timestamp or a Date.
export function selectStaleBlockedPrs(items, { now, staleHours = STALE_HOURS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('sentinel requires an explicit clock');
  if (!Number.isFinite(staleHours) || staleHours <= 0) throw new Error('sentinel requires a positive staleness window');
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.pull_request && item?.state === 'open' && hasBlockedLabel(item))
    .map((item) => {
      const updatedMs = Date.parse(item.updated_at ?? '');
      const idleHours = Number.isFinite(updatedMs) ? Math.floor((nowMs - updatedMs) / HOUR_MS) : null;
      return { number: item.number, title: String(item.title ?? ''), updatedAt: item.updated_at ?? null, idleHours };
    })
    // An unreadable timestamp is surfaced, never silently dropped.
    .filter((pr) => pr.idleHours === null || pr.idleHours >= staleHours)
    .sort((left, right) => left.number - right.number);
}

export function formatSlackText(stale, { staleHours = STALE_HOURS } = {}) {
  const summary = stale
    .map((pr) => `#${pr.number} ${pr.title.replace(/\s+/g, ' ').trim().slice(0, 80)} (idle ${pr.idleHours === null ? 'unknown' : `${pr.idleHours}h`})`)
    .join(' | ');
  return `Automation sentinel: ${stale.length} blocked PR(s) untouched for more than ${staleHours}h — ${summary}`;
}

async function main() {
  const repo = process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('missing --repo');
  const items = await paged(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent(BLOCKED_LABEL)}`);
  const stale = selectStaleBlockedPrs(items, { now: Date.now() });
  writeOutput({ stale_count: stale.length, slack_text: stale.length ? formatSlackText(stale) : '' });
  console.log(stale.length
    ? `Blocked PRs idle for more than ${STALE_HOURS}h: ${stale.map((pr) => `#${pr.number}`).join(', ')}`
    : `No blocked PR has been idle for more than ${STALE_HOURS}h.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
