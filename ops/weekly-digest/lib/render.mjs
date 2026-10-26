// Weekly content report: an exec one-pager written the way a head of content
// reports in. Verdict first, four KPIs, what shipped, problems grouped by cause
// (shared plain-English map), next week, what's working; the raw run log sits in
// a collapsed appendix so nothing is lost. Plain system CSS, no JS, no external
// assets. John prefers plain, simple, dense UIs.
import { execSummary, fmtDate } from './digest.mjs';
import { renderFixerSection } from './fixer-section.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (n) => (n == null || Number.isNaN(n) ? '—' :
  typeof n === 'number' && !Number.isInteger(n) ? n.toFixed(2) : String(n));
const int = (n) => (n == null ? '—' : new Intl.NumberFormat('en-CA').format(Math.round(n)));
const pct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n}%`);

function table(headers, rows, { empty = 'none' } = {}) {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const link = (url, label) => `<a href="${esc(url)}">${esc(label ?? url)}</a>`;
const path = (url) => String(url ?? '').replace(/^https?:\/\/[^/]+/, '') || '/';
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');
const day = (d) => (isDay(d) ? fmtDate(`${d}T12:00:00Z`, { weekday: 'short', month: 'short', day: 'numeric' })
  : d ? fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }) : '');
const when = (d) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function runOutcomeBadge(outcome) {
  return `<span class="badge ${esc(outcome)}">${esc(outcome)}</span>`;
}

function kpiTile(k) {
  const tone = k.better == null ? 'flat' : k.better ? 'good' : 'bad';
  const value = k.display ?? (k.label === 'Average position' ? (k.value == null ? '—' : Number(k.value).toFixed(1)) : int(k.value));
  let change;
  if (k.delta == null) change = k.note ? esc(k.note) : '&nbsp;';
  else {
    const arrow = k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '';
    const amount = k.unit === '%' ? `${Math.abs(k.delta)}%` : Math.abs(k.delta).toFixed(1);
    const prev = k.label === 'Average position' ? Number(k.previous).toFixed(1) : int(k.previous);
    const verdict = k.better == null ? 'flat' : k.better ? 'better' : 'worse';
    change = `${arrow} ${amount} vs ${prev} last week · ${verdict}${k.note ? ` (${esc(k.note)})` : ''}`;
  }
  return `<div class="kpi"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-change ${tone}">${change}</div></div>`;
}

// "Weekly blog post on libertyvillage.co (Thu Oct 23, Fri Oct 24)" per job+site.
function whereLine(where) {
  const byKey = new Map();
  for (const w of where) {
    const k = `${w.job} on ${w.site}`;
    byKey.set(k, [...(byKey.get(k) ?? []), w.at]);
  }
  return [...byKey].map(([k, ats]) => {
    const days = new Map();
    for (const a of ats) { const d = fmtDate(a, { month: 'short', day: 'numeric' }); days.set(d, (days.get(d) ?? 0) + 1); }
    return `${esc(k)} (${[...days].map(([d, n]) => esc(n > 1 ? `${d} ×${n}` : d)).join(', ')})`;
  }).join('; ');
}

// The digest says who acts with a tag, so drop the Slack-style "Nothing to do." lead.
const nextStep = (action) => action.replace(/^Nothing to do(?: now| yet)?\.\s*/, '') || 'No follow-up needed.';

function problemBlock(g) {
  // A resolved cause never asks for action: a later run of the same job succeeded.
  const open = g.open > 0;
  const needs = open && g.needsYou;
  const next = open ? `${esc(nextStep(g.action))}${g.known ? '' : ` ${link(g.link, 'Fix-it tickets')}`}`
    : esc(`Fixed itself${g.resolvedAt ? ` on ${fmtDate(g.resolvedAt, { month: 'short', day: 'numeric' })}` : ''}; nothing to do.`);
  return `<div class="problem${needs ? ' needs' : ''}">
<div class="problem-head"><b>${esc(g.title)}</b><span class="count">${g.count}×</span><span class="tag">${open ? 'open' : 'resolved'}</span>${needs ? '<span class="tag you">needs you</span>' : ''}${g.known || !open ? '' : '<span class="tag">investigating</span>'}</div>
<p><span class="k">Why</span><span>${esc(g.cause)}${open ? ` ${esc(g.impact)}` : ''}</span></p>
<p><span class="k">Next step</span><span>${next}</span></p>
<p class="where"><span class="k">Where</span><span>${whereLine(g.where)}</span></p>
</div>`;
}

export function renderHtml(model) {
  const x = execSummary(model);
  const w = model.window;
  const s = model.runs.summary;
  const gsc = model.gsc ?? {};
  const weeks = gsc.weeks ?? [];

  const shipped = x.shipped.length
    ? `<ol class="shipped">${x.shipped.map((p) => `<li><span class="day">${esc(day(p.date))}</span>${link(p.url, p.title)}<span class="sec">${esc(p.section)}</span></li>`).join('')}</ol>`
    : '<p class="empty">Nothing went live this week.</p>';

  // Live-site problems (and anything that needs John) in full; test-site-only
  // noise in one line, since readers never saw it.
  const testOnly = x.testGroups;
  const full = x.groups;
  const note = x.progressNote ? `<p class="testonly"><span class="k">Progress checks</span><span>${esc(x.progressNote)}</span></p>` : '';
  const problems = x.groups.length || testOnly.length
    ? [full.length ? '' : `<p class="empty">${esc(x.problems)}</p>`, ...full.map(problemBlock), note,
      testOnly.length ? `<p class="testonly"><span class="k">Test site only</span><span>${testOnly.map((g) => `${esc(g.title)} (${g.count}×)`).join('; ')}. No reader impact; the raw log is in the appendix.</span></p>` : ''].join('\n')
    : `<p class="empty">No issues this week.</p>${note}`;

  const nextRows = x.next.map((n) => [
    n.next ? `<time>${esc(when(n.next))}</time>` : '<span class="dim">not scheduled</span>',
    esc(n.what), `<span class="dim">${esc(n.repeats)}</span>`,
  ]);

  const pos = (n) => (n == null ? '—' : Number(n).toFixed(1));
  const titleOf = new Map(x.shipped.map((p) => [p.url, p.title]));
  const pagesRows = x.working.pages.map((p) => [link(p.keys?.[0] ?? '', titleOf.get(p.keys?.[0]) ?? path(p.keys?.[0])), int(p.clicks), int(p.impressions), pos(p.position)]);
  const queryRows = x.working.queries.map((q) => [esc(q.keys?.[0] ?? ''), int(q.clicks), int(q.impressions), pos(q.position)]);

  // ── Appendix (the previous page's tables, unchanged in content) ──
  const runRows = model.runs.list.map((r) => [
    `<code>${esc(r.job)}</code>`,
    esc(r.target ?? ''),
    `<code class="dim">${esc(r.slot ?? '')}</code>`,
    `<time>${esc((r.startedAt ?? '').slice(0, 16).replace('T', ' '))}</time>`,
    runOutcomeBadge(r.outcome),
    esc(r.reason ?? r.error ?? r.detail ?? ''),
    r.sha ? `<code>${esc(r.sha)}</code>` : '—',
  ]);
  const failureRowsHtml = model.failures.map((f) => [
    `<code>${esc(f.job)}</code>/${esc(f.target ?? '')}`,
    `<time>${esc((f.startedAt ?? '').slice(0, 16).replace('T', ' '))}</time>`,
    `<span class="fail">${esc(f.reason)}</span>`,
    `<code class="dim">${esc(String(f.file ?? '').split('/').pop())}</code>`,
  ]);
  const timerRows = (model.queue.timers ?? []).map((t) => [
    `<code>${esc((t.unit ?? '').replace('.timer', ''))}</code>`,
    t.next ? `<time>${esc(t.next)}</time>` : '<span class="dim">no next elapse</span>',
    t.last ? `<time>${esc(t.last)}</time>` : '—',
    `<code class="dim">${esc(t.schedule ?? '')}</code>`,
  ]);
  const gscWeekRows = weeks.map((wk) => [
    `${wk.start} → ${wk.end}`,
    num(wk.clicks), num(wk.impressions),
    wk.ctr != null ? `${(wk.ctr * 100).toFixed(1)}%` : '—',
    num(wk.position),
  ]);
  const deltaRow = gsc.delta ? [
    '<b>Δ WoW</b>',
    `<b>${pct(gsc.delta.clicksPct)}</b>`, `<b>${pct(gsc.delta.impressionsPct)}</b>`,
    `<b>${gsc.delta.ctr != null ? `${(gsc.delta.ctr * 100).toFixed(1)}%` : '—'}</b>`,
    `<b>${gsc.delta.position != null ? (gsc.delta.position >= 0 ? '+' : '') + gsc.delta.position.toFixed(1) : '—'}</b>`,
  ] : null;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Liberty Village content report · ${esc(x.week)}</title>
<style>
:root{color-scheme:light;--ink:#1a1a1a;--muted:#5f6368;--faint:#8a8f94;--line:#e3e3e3;--soft:#f5f5f4;--good:#166534;--bad:#a61b1b;--warn:#8a5a00}
*{box-sizing:border-box}
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;margin:0 auto;max-width:880px;padding:28px 24px 48px;color:var(--ink);background:#fff;-webkit-text-size-adjust:100%}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0}
h1{font-size:26px;line-height:1.2;margin:4px 0 2px;font-weight:650}
.meta{color:var(--faint);font-size:12px;margin:0}
.verdict{margin:20px 0 0;padding:14px 16px;border-left:3px solid var(--ink);background:var(--soft)}
.verdict .headline{font-size:18px;line-height:1.4;font-weight:600;margin:0}
.verdict p{margin:8px 0 0}
.verdict .ask{font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin:20px 0 0}
.kpi{background:#fff;padding:12px 14px}
.kpi-label{font-size:12px;font-weight:500;color:var(--muted)}
.kpi-value{font-size:26px;font-weight:650;line-height:1.25;font-variant-numeric:tabular-nums;margin-top:2px}
.kpi-change{font-size:12px;font-weight:500;font-variant-numeric:tabular-nums;color:var(--muted)}
.kpi-change.good{color:var(--good)} .kpi-change.bad{color:var(--bad)}
h2{font-size:13px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:30px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--line)}
h3{font-size:14px;margin:0 0 6px}
.shipped{list-style:none;margin:0;padding:0}
.shipped li{display:grid;grid-template-columns:96px 1fr auto;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);align-items:baseline}
.shipped .day{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.shipped .sec,.tag{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:3px;padding:0 5px}
.problem{padding:10px 0;border-bottom:1px solid var(--line)}
.problem p{margin:3px 0;font-size:14px;display:grid;grid-template-columns:92px 1fr;gap:8px}
.problem-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.problem-head b{font-size:15px}
.count{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px}
.tag.you{color:var(--bad);border-color:#f1c0c0}
.k{color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;padding-top:2px}
.where{color:var(--muted)}
.fixed{margin:0;padding-left:18px;font-size:14px}.fixed li{margin:3px 0}.fixed time{color:var(--muted);margin-right:4px}
.testonly{margin:10px 0 0;font-size:14px;color:var(--muted);display:grid;grid-template-columns:92px 1fr;gap:8px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:5px 8px 5px 0;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;white-space:nowrap;font-size:12px}
td{font-variant-numeric:tabular-nums}
td time{white-space:nowrap;color:var(--muted)}
a{color:#1d4ed8;text-decoration:none}
a:hover{text-decoration:underline}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);padding:0 3px;border-radius:3px}
.dim{color:var(--faint)}
.empty{color:var(--faint);margin:4px 0}
.fail{color:var(--bad);font-weight:500}
details{margin:34px 0 0;border-top:1px solid var(--line);padding-top:10px}
summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--muted)}
details h2{margin-top:20px}
details table{font-size:12px}
details p.dim{font-size:12px}
.notes li{color:var(--warn);font-size:12px}
.badge{display:inline-block;border-radius:3px;padding:0 6px;font-size:11px;font-weight:600}
.badge.success{background:#dcfce7;color:#166534}
.badge.failure{background:#fee2e2;color:#991b1b}
.badge.held{background:#fef3c7;color:#92400e}
.badge.incomplete{background:#e5e7eb;color:#374151}
.scroll{overflow-x:auto}
footer{margin-top:28px;color:var(--faint);font-size:11px}
@media (max-width:640px){
  body{font-size:15px;padding:18px 14px 36px}
  h1{font-size:22px}
  .verdict .headline{font-size:16px}
  .kpis{grid-template-columns:1fr 1fr}
  .kpi-value{font-size:22px}
  .cols{grid-template-columns:1fr;gap:16px}
  .shipped li{grid-template-columns:1fr auto;gap:2px 10px}
  .shipped .day{grid-column:1/-1}
  .problem p,.testonly{grid-template-columns:1fr;gap:0}
}
</style></head><body>
<p class="eyebrow">Liberty Village · weekly content report</p>
<h1>Week of ${esc(x.week)}</h1>
<p class="meta">Generated ${esc(when(model.generatedAt))} (Toronto) · search figures cover ${esc(x.gscRange ?? 'the latest complete week')}</p>

<section class="verdict">
<p class="headline">${esc(x.headline)}</p>
<p>${esc(x.problems)}</p>
<p class="ask">${esc(x.ask)}</p>
</section>

<section class="kpis">${x.kpis.map(kpiTile).join('')}</section>

<h2>What shipped</h2>
${shipped}

<h2>What went wrong → what we did</h2>
${problems}

${renderFixerSection(model)}

<h2>Next week</h2>
${model.queue?.held ? '<p class="fail">Publishing is paused (hold switch on): nothing below publishes until it is lifted.</p>' : ''}
${table(['When (Toronto)', 'What', 'Repeats'], nextRows, { empty: 'Schedule unavailable this week.' })}

<h2>What's working</h2>
${weeks.length ? `<div class="cols">
<div><h3>Top pages</h3>${table(['Page', 'Clicks', 'Impr.', 'Pos.'], pagesRows)}</div>
<div><h3>Top searches</h3>${table(['Search', 'Clicks', 'Impr.', 'Pos.'], queryRows)}</div>
</div>` : '<p class="empty">Search data unavailable this week.</p>'}

<details>
<summary>Appendix: run log, schedule, search detail and fetch notes</summary>
<h2>Posted this week (live site)</h2>
${table(['Section', 'Page', 'Last mod'], model.posted.items.map((p) => [
    esc(p.section), link(p.url, p.title ?? p.url),
    `<time>${esc(isDay(p.lastmod) ? p.lastmod : new Date(p.lastmod).toISOString().slice(0, 16).replace('T', ' '))}</time>`,
  ]), { empty: 'nothing posted in the window' })}
<h2>Loop runs</h2>
<p class="dim">${s.total} runs: ${s.success} ok · ${s.failure} failed · ${s.held} held · ${s.incomplete} incomplete${model.queue?.held ? ' · <b>loops HELD</b>' : ''}</p>
<div class="scroll">${table(['Job', 'Target', 'Slot', 'Started', 'Outcome', 'Note', 'SHA'], runRows, { empty: 'no runs recorded in the window' })}</div>
<h2>Failures (raw)</h2>
<div class="scroll">${table(['Run', 'When', 'Reason', 'Log'], failureRowsHtml, { empty: 'no failures' })}</div>
<h2>Timers</h2>
<p class="dim">hold file: ${model.queue.held == null ? 'unknown' : model.queue.held ? '<b>present — writes stopped</b>' : 'absent'}${model.queue.note ? ' · ' + esc(model.queue.note) : ''}</p>
<div class="scroll">${table(['Timer', 'Next elapse', 'Last trigger', 'Schedule'], timerRows, { empty: 'no lv-* timers found' })}</div>
<h2>Google Search Console</h2>
<p class="dim">source: <code>${esc(gsc.source ?? 'unavailable')}</code>${gsc.note ? ' · ' + esc(gsc.note) : ''}</p>
${table(['Week', 'Clicks', 'Impressions', 'CTR', 'Avg position'], deltaRow ? [...gscWeekRows, deltaRow] : gscWeekRows, { empty: 'GSC data unavailable' })}
${model.notes?.length ? `<h2>Fetch notes</h2><ul class="notes">${model.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<p class="dim">Window ${esc(new Date(w.from).toISOString().slice(0, 16).replace('T', ' '))} → ${esc(new Date(w.to).toISOString().slice(0, 16).replace('T', ' '))} UTC</p>
</details>

<footer>libertyvillage.co weekly content report · built from the content runner's logs, the live sitemap and Google Search Console · the digest JSON for the fix-it agent is published alongside this page</footer>
</body></html>`;
}
