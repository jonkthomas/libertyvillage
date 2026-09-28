// g8 notify (§4.6). Slack incoming webhooks have no idempotency key, so delivery
// is at-least-once: a crash after the webhook returns and before
// markPhase('notified') repeats the same lines on resume. Every line carries the
// stable `#<submissionId>` so a repeat is recognisable as the same event.
export const MAX_SUCCESS_LINES = 10;
export const SLACK_TIMEOUT_MS = 10_000;

const scriptedPrefix = (scripted) => (scripted ? '[scripted] ' : '');
const score = (overall) => (overall === null || overall === undefined || overall === '' ? 'n/a' : String(Number(overall)));

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

// ✅ <target> published: <title> — <url> (#id, kind, score, repairs), one line per item (≤ 10).
export function formatSuccess({ submission, items, registry, siteUrl, scripted = false }) {
  const tail = `(#${submission.id}, ${submission.kind}, ${score(submission.overall)}, ${submission.repairs ?? 0})`;
  const lines = items.slice(0, MAX_SUCCESS_LINES).map((item) => {
    const { title, url } = describeItem(item, { registry, siteUrl });
    return `${scriptedPrefix(scripted)}✅ ${submission.target} published: ${title} — ${url} ${tail}`;
  });
  if (items.length > MAX_SUCCESS_LINES) {
    lines.push(`${scriptedPrefix(scripted)}… and ${items.length - MAX_SUCCESS_LINES} more ${tail}`);
  }
  return lines.join('\n');
}

// 🔁 <target> <op> <dataset>/<key> (#id)
export function formatAdmin({ submission, items, scripted = false }) {
  return items.map((item) => `${scriptedPrefix(scripted)}🔁 ${submission.target} ${item.op} ${item.dataset}/${item.key} (#${submission.id})`).join('\n');
}

// Failure: kind, #id, decision, score, top 3 findings, and the show command.
export function formatFailure({ submission, decision, overall, findings = [], errors = [], scripted = false }) {
  const prefix = scriptedPrefix(scripted);
  const top = [...(Array.isArray(findings) ? findings : [])]
    .sort((left, right) => severityRank(left?.severity) - severityRank(right?.severity))
    .slice(0, 3)
    .map((finding) => `${prefix}• [${finding.severity}] ${finding.path}: ${finding.note}`);
  const detail = top.length ? top : (Array.isArray(errors) ? errors : []).slice(0, 3).map((error) => `${prefix}• ${error}`);
  return [
    `${prefix}❌ ${submission.target} ${submission.kind} #${submission.id} ${decision || submission.decision || 'error'} (score ${score(overall ?? submission.overall)})`,
    ...detail,
    `${prefix}content show --submission ${submission.id}`,
  ].join('\n');
}

export function formatPropagationWarning({ submission, reason, scripted = false }) {
  return `${scriptedPrefix(scripted)}⚠ ${submission.target} #${submission.id} published but not yet live (${reason}); resume with content deploy --target ${submission.target}`;
}

export function formatCompensationConflict({ submission, scripted = false }) {
  return `${scriptedPrefix(scripted)}⚠ ${submission.target} #${submission.id} smoke-failed: compensation-conflict, newer content kept — content show --submission ${submission.id}`;
}

export function formatAdminSmokeAlert({ submission, failures = [], scripted = false }) {
  const where = failures.map((failure) => `${failure.dataset}/${failure.key}: ${failure.reason}`).join('; ') || 'page check failed';
  return `${scriptedPrefix(scripted)}⚠ ${submission.target} admin #${submission.id} smoke failed (${where}); no automatic undo — content show --submission ${submission.id}`;
}

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
