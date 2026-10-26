// "What the agent fixed": the ops fixer's actions (ops/ops-fixer, action log
// /var/lib/lv-ops-fixer/actions.jsonl), what each one led to, what it handed to
// the fix-it agent, and the GitHub issues the fix-it agent filed. Pure; the
// page and the Slack post both read it from the published digest model.
import { explain, jobName, midSentence } from './plain-english.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DID = {
  'rerun-job': 'Ran it again.',
  'next-topic': 'Ran it again with the next topic.',
  'retry-deploy': 'Retried the site rebuild.',
};
const RESULT_WINDOW_MS = 6 * 3600_000;

/** What the fixer's action led to: the first run of the unit it started, within 6 hours. */
export function actionResult(action, runs = []) {
  if (action.result === 'failed-to-start') return { outcome: 'not-started', words: 'It did not start.' };
  const t = Date.parse(action.at);
  const run = runs
    .filter((r) => r.job === action.unitJob && r.target === 'production' && Date.parse(r.startedAt) >= t && Date.parse(r.startedAt) <= t + RESULT_WINDOW_MS)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0];
  if (!run) return { outcome: 'pending', words: 'No result yet.' };
  if (run.outcome === 'success') return { outcome: 'fixed', words: 'It worked.' };
  if (run.outcome === 'failure') return { outcome: 'failed', words: 'It failed again.' };
  return { outcome: 'pending', words: 'Still running when this report was built.' };
}

/** The section's rows, in time order, limited to the digest window. */
export function fixerView(model) {
  const from = Date.parse(model.window?.from ?? 0), to = Date.parse(model.window?.to ?? Date.now());
  const inWindow = (r) => Date.parse(r?.at) >= from && Date.parse(r?.at) < to;
  const records = (Array.isArray(model.fixer?.actions) ? model.fixer.actions : []).filter(inWindow)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const runs = model.runs?.list ?? [];
  const lead = (r) => `${jobName(r.job)}: ${midSentence(explain(r.code).title)}.`;
  const acted = records.filter((r) => r.decision === 'acted' && Object.hasOwn(DID, r.action)).map((r) => {
    const result = actionResult(r, runs);
    return { at: r.at, what: `${lead(r)} ${DID[r.action]}`, result: result.words, outcome: result.outcome };
  });
  const handedOver = records.filter((r) => r.decision === 'escalated' || r.decision === 'budget-exhausted').map((r) => ({
    at: r.at,
    what: r.decision === 'escalated'
      ? `${lead(r)} Not a known safe fix, so the fix-it agent looks at it.`
      : `${lead(r)} Stopped retrying after ${Number(r.tries) || 'several'} tries this week; the fix-it agent looks at it.`,
  }));
  const issues = (Array.isArray(model.fixer?.issues) ? model.fixer.issues : [])
    .filter((i) => i && typeof i.url === 'string' && /^https:\/\/github\.com\//.test(i.url))
    .map((i) => ({ number: i.number, title: String(i.title ?? ''), url: i.url, state: i.state === 'CLOSED' ? 'closed' : 'open' }));
  return { acted, handedOver, issues, fixed: acted.filter((a) => a.outcome === 'fixed').length };
}

// Toronto time, as on the rest of the page (no digest.mjs import: it imports this file).
const when = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d));

export function renderFixerSection(model) {
  const v = fixerView(model);
  const rows = [
    ...v.acted.map((a) => `<li><time>${esc(when(a.at))}</time> ${esc(a.what)} <b>${esc(a.result)}</b></li>`),
    ...v.handedOver.map((h) => `<li><time>${esc(when(h.at))}</time> ${esc(h.what)}</li>`),
  ];
  const issues = v.issues.length
    ? `<p><span class="k">Issues filed</span> ${v.issues.map((i) => `<a href="${esc(i.url)}">#${esc(i.number)} ${esc(i.title)}</a> (${i.state})`).join('; ')}</p>`
    : '';
  const body = rows.length ? `<ul class="fixed">${rows.join('')}</ul>` : '<p class="empty">Nothing needed fixing this week.</p>';
  return `<h2>What the agent fixed</h2>\n${body}\n${issues}`;
}

/** One Slack line, or null when the agent did nothing and filed nothing. */
export function fixerSlackLine(model) {
  const v = fixerView(model);
  if (!v.acted.length && !v.handedOver.length && !v.issues.length) return null;
  const parts = [];
  if (v.acted.length) parts.push(`${v.acted.length === 1 ? '1 automatic fix' : `${v.acted.length} automatic fixes`}, ${v.fixed} worked`);
  if (v.handedOver.length) parts.push(`${v.handedOver.length} sent to the fix-it agent`);
  if (v.issues.length) parts.push(`${v.issues.length === 1 ? '1 issue' : `${v.issues.length} issues`} filed`);
  return `What the agent fixed: ${parts.join('; ')}.`;
}
