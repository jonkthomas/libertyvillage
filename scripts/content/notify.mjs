// g8 notify (§4.6). Slack incoming webhooks have no idempotency key, so delivery
// is at-least-once: a crash after the webhook returns and before
// markPhase('notified') repeats the same message on resume. Every message ends
// with a stable `Ref: submission #<id>` line so a repeat is recognisable.
//
// Messages are written for a non-technical reader (#libvillage): what happened,
// why it matters, what to do, one link. Codes, paths and commands stay in the
// trailing Ref line. Wording comes from the shared plain-English map.
import * as plain from '../../ops/weekly-digest/lib/plain-english.mjs';

const { explain, codesInErrors, jobName, siteName, slackBody, LINKS } = plain;

// A broken or partial map must never cost a notice: any formatter error falls
// back to one generic sentence that still carries the stable submission id.
const generic = (submission) => `Content system update for submission #${submission?.id ?? '?'} (${submission?.target ?? 'unknown site'}). Details: content show --submission ${submission?.id ?? '?'}`;
const guarded = (format, fallback) => (args) => {
  try { return format(args); } catch { return fallback(args ?? {}); }
};

export const MAX_SUCCESS_LINES = 10;
export const SLACK_TIMEOUT_MS = 10_000;

const scriptedPrefix = (scripted) => (scripted ? '[test run] ' : '');
const ref = (submission, extra) => [`submission #${submission.id}`, extra].filter(Boolean).join(' · ');

const DATASET_NOUN = {
  businesses: ['business listing', 'business listings'], posts: ['blog post', 'blog posts'],
  buildings: ['building page', 'building pages'], neighborhoods: ['neighbourhood comparison', 'neighbourhood comparisons'],
  services: ['best-of page', 'best-of pages'], topics: ['guide page', 'guide pages'], 'guide-hub': ['neighbourhood guide', 'neighbourhood guides'],
  'topic-queue': ['topic idea', 'topic ideas'], 'discovery-seen': ['research note', 'research notes'],
};
const noun = (dataset, n = 1) => (DATASET_NOUN[dataset] ?? [String(dataset).replace(/-/g, ' '), `${String(dataset).replace(/-/g, ' ')} items`])[n === 1 ? 0 : 1];
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const stagingNote = (target) => (target === 'staging' ? ' This is the test site; readers do not see it.' : '');

// Display title and URL for one published item, from the dataset registry
// ({route, marker}); datasets without a route link their public snapshot file.
export function describeItem({ dataset, key, payload }, { registry, siteUrl }) {
  const entry = registry?.[dataset];
  if (!entry) throw new Error(`unknown dataset: ${dataset}`);
  let title;
  if (dataset === 'guide-hub') title = 'Liberty Village guide';
  else if (entry.marker && typeof payload?.[entry.marker] === 'string') title = payload[entry.marker];
  else title = typeof payload?.title === 'string' ? payload.title : `${dataset}/${key}`;
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const url = entry.route ? `${base}${entry.route.replace(':key', key)}` : `${base}/content-snapshot/${entry.file}`;
  return { title, url };
}

// Published: one title + link for a single item; a short list (≤ 10) otherwise.
function formatSuccessRaw({ submission, items, registry, siteUrl, scripted = false }) {
  const site = siteName(submission.target);
  const described = items.map((item) => ({ ...describeItem(item, { registry, siteUrl }), dataset: item.dataset, routed: Boolean(registry?.[item.dataset]?.route) }));
  const why = submission.kind === 'blog' ? 'It counts toward the 2-posts-a-week plan.'
    : submission.kind === 'roundup' ? 'It covers this week\'s news roundup.'
      : 'Readers and search engines can see it now.';
  const body = { prefix: scriptedPrefix(scripted), why: `${why}${stagingNote(submission.target)}`, todo: 'Nothing to do.', ref: ref(submission) };
  if (described.length === 1) {
    const [only] = described;
    return slackBody({ ...body, what: `New ${noun(only.dataset)} live on ${site}: "${only.title}"`, link: only.routed ? only.url : null });
  }
  const shown = described.slice(0, MAX_SUCCESS_LINES).map((d) => `• ${capital(noun(d.dataset))}: ${d.title}${d.routed ? ` (${d.url})` : ''}`);
  if (described.length > MAX_SUCCESS_LINES) shown.push(`• … and ${described.length - MAX_SUCCESS_LINES} more`);
  return slackBody({ ...body, what: `${described.length} updates live on ${site} (${jobName(submission.kind)}):\n${shown.join('\n')}` });
}

const OP_WORD = { insert: 'added', upsert: 'updated', update: 'updated', unpublish: 'removed', delete: 'removed', rollback: 'rolled back', compensate: 'rolled back' };

// Manual (admin) change applied: counts by dataset and operation, no slugs.
function formatAdminRaw({ submission, items, scripted = false }) {
  const groups = new Map();
  for (const item of items) {
    const g = groups.get(item.dataset) ?? new Map();
    const word = OP_WORD[item.op] ?? 'changed';
    g.set(word, (g.get(word) ?? 0) + 1);
    groups.set(item.dataset, g);
  }
  const parts = [...groups].map(([dataset, ops]) => [...ops].map(([word, n]) => `${n} ${noun(dataset, n)} ${word}`).join(', '));
  return slackBody({
    prefix: scriptedPrefix(scripted),
    what: `${items.length && items.every((item) => item.op === 'compensate') ? 'Automatic rollback' : 'Manual content update'} applied on ${siteName(submission.target)}: ${parts.join('; ') || 'no items'}.`,
    why: `The change is live for readers now.${stagingNote(submission.target)}`,
    todo: 'Nothing to do.', ref: ref(submission),
  });
}

// Not published: plain cause from the shared map, the reviewer's top note, next step.
function formatFailureRaw({ submission, decision, findings = [], errors = [], scripted = false }) {
  const chosen = decision || submission.decision || 'error';
  const lintCodes = codesInErrors(errors);
  const e = explain(lintCodes.length && ['lint', 'validation'].includes(chosen) ? lintCodes[0] : chosen);
  const top = [...(Array.isArray(findings) ? findings : [])]
    .filter((finding) => typeof finding?.note === 'string' && finding.note.trim())
    .sort((left, right) => severityRank(left?.severity) - severityRank(right?.severity))[0];
  const note = top ? ` Reviewer's main concern: "${top.note.replace(/\s+/g, ' ').trim().slice(0, 200)}"` : '';
  return slackBody({
    prefix: scriptedPrefix(scripted),
    what: `${jobName(submission.kind)} not published on ${siteName(submission.target)}. ${e.cause}${note}`,
    why: e.impact, todo: e.action, link: e.link,
    ref: ref(submission, `details: content show --submission ${submission.id}`),
  });
}

// Published but not yet visible (deploy hook failed or the page check timed out).
function formatPropagationWarningRaw({ submission, reason, scripted = false }) {
  const e = explain(reason);
  return slackBody({
    prefix: scriptedPrefix(scripted),
    what: `${e.title} (${siteName(submission.target)}). ${e.cause}`,
    why: e.impact, todo: e.action,
    ref: ref(submission, `resume: content deploy --target ${submission.target}`),
  });
}

function formatCompensationConflictRaw({ submission, scripted = false }) {
  const e = explain('compensation-conflict');
  return slackBody({
    prefix: scriptedPrefix(scripted),
    what: `${e.title} (${siteName(submission.target)}). ${e.cause}`,
    why: e.impact, todo: e.action,
    ref: ref(submission, `details: content show --submission ${submission.id}`),
  });
}

function formatAdminSmokeAlertRaw({ submission, failures = [], scripted = false }) {
  const e = explain('admin-smoke-failed');
  const pages = failures.length ? ` Affected: ${failures.length} ${failures.length === 1 ? 'page' : 'pages'} (${[...new Set(failures.map((f) => noun(f.dataset)))].join(', ')}).` : '';
  return slackBody({
    prefix: scriptedPrefix(scripted),
    what: `${e.title} (${siteName(submission.target)}). ${e.cause}${pages}`,
    why: e.impact, todo: e.action,
    ref: ref(submission, `details: content show --submission ${submission.id}`),
  });
}

// The review step crashed before deciding (gate error); the draft waits.
function formatGateErrorRaw({ id, reason }) {
  const e = explain(reason);
  return slackBody({
    what: `Quality review stopped before finishing a draft. ${e.cause}`,
    why: 'The draft was neither published nor rejected; it is waiting.',
    todo: 'Nothing to do. The next scheduled run picks the draft up again.',
    link: e.known ? null : e.link,
    ref: `submission #${id} · retry: content gate --submission ${id}`,
  });
}

const weekOf = (weekStart) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  .format(new Date(`${weekStart}T00:00:00Z`));

// Missed-week cadence alert ({target, weekStart, alertKind, counts}); never the raw payload.
function formatCadenceAlertRaw({ target, weekStart, alertKind, counts = {} }) {
  const news = alertKind === 'WEEKLY_NEWS_MISSED';
  const e = explain(alertKind);
  const n = Number.isInteger(counts?.[news ? 'roundup' : 'content']) ? counts[news ? 'roundup' : 'content'] : null;
  const what = news
    ? `Missed week on ${siteName(target)}: no news roundup went live for the week of ${weekOf(weekStart)} (plan: 1).`
    : `Missed week on ${siteName(target)}: ${n == null ? 'fewer than 2' : `${n} of 2`} planned posts went live for the week of ${weekOf(weekStart)}.`;
  return slackBody({ what, why: e.impact, todo: e.action, link: LINKS.digest });
}

// Neon storage warning (content stats --alert).
function formatStorageAlertRaw({ projectBytes, warnMb = 350, capMb = 512 }) {
  return slackBody({
    what: `Content database is getting full: ${Math.round(projectBytes / 1048576)} MB used of ${capMb} MB (warning line ${warnMb} MB).`,
    why: `If it reaches ${capMb} MB, new posts cannot be saved.`,
    todo: 'Ask for old content history to be cleaned up before it fills.',
  });
}

const bySubmission = (args) => generic(args.submission);
export const formatSuccess = guarded(formatSuccessRaw, bySubmission);
export const formatAdmin = guarded(formatAdminRaw, bySubmission);
export const formatFailure = guarded(formatFailureRaw, bySubmission);
export const formatPropagationWarning = guarded(formatPropagationWarningRaw, bySubmission);
export const formatCompensationConflict = guarded(formatCompensationConflictRaw, bySubmission);
export const formatAdminSmokeAlert = guarded(formatAdminSmokeAlertRaw, bySubmission);
export const formatGateError = guarded(formatGateErrorRaw, ({ id }) => generic({ id }));
export const formatCadenceAlert = guarded(formatCadenceAlertRaw, ({ target, weekStart }) =>
  `Missed-week alert for ${target ?? 'unknown site'}, week of ${weekStart ?? 'unknown'}. Details are in the weekly report.`);
export const formatStorageAlert = guarded(formatStorageAlertRaw, ({ projectBytes }) =>
  `Content database storage warning: ${Math.round(Number(projectBytes) / 1048576)} MB used of 512 MB.`);

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
function severityRank(severity) {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

// POST {text} to the incoming webhook; any non-2xx or timeout throws, so the
// caller never marks a phase it did not deliver.
export async function postSlack({ webhookUrl, text, fetchImpl = globalThis.fetch, timeoutMs = SLACK_TIMEOUT_MS }) {
  if (!webhookUrl) throw new Error('slack-webhook-missing: SLACK_WEBHOOK_URL is not set');
  const response = await fetchImpl(webhookUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }), signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`slack-webhook-failed: HTTP ${response.status}`);
  return { status: response.status };
}

// Skipped when notified_at is set; otherwise post, then mark. The window between
// the two is the documented at-least-once repeat.
export async function notifyOnce({ submission, text, post, markNotified }) {
  if (submission?.notified_at) return { posted: false, skipped: true };
  await post(text);
  await markNotified();
  return { posted: true, skipped: false };
}
