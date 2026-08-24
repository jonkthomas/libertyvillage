#!/usr/bin/env node
// Read-only sentinel for PRs the autonomous gate blocked and nobody picked up.
// Lists open PRs labelled automation-blocked, keeps the ones whose last update is
// older than the staleness window, and emits one single-line Slack summary for the
// workflow to post. It never writes to the repository and never closes anything.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKED_LABEL, TERMINAL_LABELS, TRUSTED_PR_AUTHORS } from './constants.mjs';
import { github, paged, writeOutput } from './github.mjs';

// Re-exported so existing importers keep one binding site; the string itself now
// lives in constants.mjs alongside the label the coordinator writes.
export { BLOCKED_LABEL };
export const STALE_HOURS = 24;
export const ORPHAN_HOURS = 2;
export const AUTOMATION_STATUS_PREFIX = 'automation/';
export const STALE_NOTIFICATION_UTC_HOUR = 12;
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

// The independent tripwire on the whole terminal-state guarantee (F12): a
// bot-authored PR the coordinator opened, left open past a full cycle, carrying
// neither a terminal label nor an automation/* head status, was never given a
// visible outcome by anything. A fresh current-head commit gets one bounded grace
// period so a repair/heal push is not mistaken for a lost dispatch while it is in
// flight. Human PRs are deliberately out of scope — PR #32 is authored by
// jonkthomas and is not a bot orphan, and a sentinel that flags human PRs produces
// standing noise instead of a signal.
export function selectOrphanAutomationPrs(items, { now, staleHours = ORPHAN_HOURS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('sentinel requires an explicit clock');
  if (!Number.isFinite(staleHours) || staleHours <= 0) throw new Error('sentinel requires a positive staleness window');
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.pull_request && item?.state === 'open')
    .filter((item) => TRUSTED_PR_AUTHORS.includes(item?.user?.login))
    .filter((item) => !(item?.labels || []).some((label) => TERMINAL_LABELS.includes(typeof label === 'string' ? label : label?.name)))
    .filter((item) => !(item?.statusContexts || []).some((context) => String(context).startsWith(AUTOMATION_STATUS_PREFIX)))
    .map((item) => {
      const createdMs = Date.parse(item.created_at ?? '');
      const headCommittedMs = Date.parse(item.headCommittedAt ?? '');
      const ageHours = Number.isFinite(createdMs) ? Math.floor((nowMs - createdMs) / HOUR_MS) : null;
      const headAgeHours = Number.isFinite(headCommittedMs) ? Math.floor((nowMs - headCommittedMs) / HOUR_MS) : null;
      return {
        number: item.number, title: String(item.title ?? ''), createdAt: item.created_at ?? null,
        updatedAt: item.updated_at ?? null, headCommittedAt: item.headCommittedAt ?? null,
        ageHours, headAgeHours,
      };
    })
    // Unknown timestamps remain visible (fail closed) instead of silently making
    // an unobservable PR look healthy.
    .filter((pr) => (pr.ageHours === null || pr.ageHours >= staleHours)
      && (pr.headAgeHours === null || pr.headAgeHours >= staleHours))
    .sort((left, right) => left.number - right.number);
}

export function formatOrphanText(orphans, { staleHours = ORPHAN_HOURS } = {}) {
  const summary = orphans
    .map((pr) => `#${pr.number} ${pr.title.replace(/\s+/g, ' ').trim().slice(0, 80)} (PR age ${pr.ageHours === null ? 'unknown' : `${pr.ageHours}h`}, head age ${pr.headAgeHours === null ? 'unknown' : `${pr.headAgeHours}h`})`)
    .join(' | ');
  return `Automation sentinel ORPHAN pass: ${orphans.length} bot PR(s) reached no terminal state in ${staleHours}h — ${summary}`;
}

export function shouldNotifyStaleBlocked(now, utcHour = STALE_NOTIFICATION_UTC_HOUR) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('sentinel requires an explicit clock');
  if (!Number.isInteger(utcHour) || utcHour < 0 || utcHour > 23) throw new Error('invalid stale notification hour');
  return new Date(nowMs).getUTCHours() === utcHour;
}

export function formatSlackText(stale, { staleHours = STALE_HOURS } = {}) {
  const summary = stale
    .map((pr) => `#${pr.number} ${pr.title.replace(/\s+/g, ' ').trim().slice(0, 80)} (idle ${pr.idleHours === null ? 'unknown' : `${pr.idleHours}h`})`)
    .join(' | ');
  return `Automation sentinel: ${stale.length} blocked PR(s) untouched for more than ${staleHours}h — ${summary}`;
}

// Read-only: every call below is a GET.
async function orphanCandidates(repo) {
  const open = await paged(`/repos/${repo}/pulls?state=open`);
  const candidates = open.filter((pr) => TRUSTED_PR_AUTHORS.includes(pr?.user?.login));
  const items = [];
  for (const pr of candidates) {
    const status = await github(`/repos/${repo}/commits/${pr.head.sha}/status`);
    const headCommit = await github(`/repos/${repo}/commits/${pr.head.sha}`);
    items.push({
      number: pr.number, title: pr.title, state: pr.state,
      created_at: pr.created_at, updated_at: pr.updated_at,
      headCommittedAt: headCommit?.commit?.committer?.date ?? null,
      pull_request: {}, user: pr.user, labels: pr.labels || [],
      statusContexts: (status?.statuses || []).map((entry) => entry.context),
    });
  }
  return items;
}

async function main() {
  const repo = process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('missing --repo');
  const now = Date.now();
  const items = await paged(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent(BLOCKED_LABEL)}`);
  const stale = selectStaleBlockedPrs(items, { now });
  const orphans = selectOrphanAutomationPrs(await orphanCandidates(repo), { now });
  const staleNotificationDue = shouldNotifyStaleBlocked(now);
  const notify = orphans.length > 0 || (staleNotificationDue && stale.length > 0);
  writeOutput({
    stale_count: stale.length,
    orphan_count: orphans.length,
    notify: notify ? 'true' : 'false',
    stale_notification_due: staleNotificationDue ? 'true' : 'false',
    slack_text: staleNotificationDue && stale.length ? formatSlackText(stale) : '',
    orphan_text: orphans.length ? formatOrphanText(orphans) : '',
  });
  console.log(stale.length
    ? `Blocked PRs idle for more than ${STALE_HOURS}h: ${stale.map((pr) => `#${pr.number}`).join(', ')}`
    : `No blocked PR has been idle for more than ${STALE_HOURS}h.`);
  console.log(orphans.length
    ? `ORPHAN automation PRs with no terminal state: ${orphans.map((pr) => `#${pr.number}`).join(', ')}`
    : 'ORPHAN pass clean: every bot PR reached a visible terminal state.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
