// Dense single-page HTML renderer for the weekly digest. Plain system CSS,
// no JS, no external assets. John prefers plain, simple, dense UIs.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (n) => (n == null || Number.isNaN(n) ? '—' :
  typeof n === 'number' && !Number.isInteger(n) ? n.toFixed(2) : String(n));
const pct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n}%`);

function table(headers, rows, { empty = 'none' } = {}) {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const link = (url, label) => `<a href="${esc(url)}">${esc(label ?? url)}</a>`;

function runOutcomeBadge(outcome) {
  return `<span class="badge ${esc(outcome)}">${esc(outcome)}</span>`;
}

export function renderHtml(model) {
  const w = model.window;
  const s = model.runs.summary;
  const gsc = model.gsc ?? {};
  const weeks = gsc.weeks ?? [];
  const latest = weeks.at(-1);

  const heads = [];
  heads.push(`<span class="stat"><b>${model.posted.items.length}</b> posted</span>`);
  heads.push(`<span class="stat"><b>${s.total}</b> runs (${s.success} ok · <b>${s.failure}</b> failed · ${s.held} held · ${s.incomplete} incomplete)</span>`);
  if (latest) heads.push(`<span class="stat"><b>${num(latest.clicks)}</b> GSC clicks ${pct(gsc.delta?.clicksPct)} WoW</span>`);
  if (model.queue?.held) heads.push(`<span class="badge failure">loops HELD</span>`);

  const postedRows = model.posted.items.map((p) => [
    esc(p.section),
    p.title ? link(p.url, p.title) : link(p.url, p.url),
    `<time>${esc(/^\d{4}-\d{2}-\d{2}$/.test(p.lastmod) ? p.lastmod : new Date(p.lastmod).toISOString().slice(0, 16).replace('T', ' '))}</time>`,
  ]);

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
    `<code class="dim">${esc(f.file.split('/').pop())}</code>`,
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

  const qRows = (gsc.topQueries ?? []).map((q) => [esc(q.keys?.[0] ?? ''), num(q.clicks), num(q.impressions), num(q.position)]);
  const pRows = (gsc.topPages ?? []).map((p) => [link(p.keys?.[0] ?? '', String(p.keys?.[0] ?? '').replace(/^https?:\/\/[^/]+/, '')), num(p.clicks), num(p.impressions), num(p.position)]);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LV weekly digest ${esc(w.to.slice(0, 10))}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;margin:0 auto;max-width:1150px;padding:16px 20px 40px;color:#1a1a1a;background:#fff}
h1{font-size:17px;margin:0 0 2px}
h2{font-size:13px;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:#555;border-bottom:1px solid #ddd;padding-bottom:3px}
.meta{color:#666;font-size:12px;margin:0}
.head{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;align-items:center}
.stat{background:#f4f4f5;border-radius:4px;padding:3px 8px;font-size:12px}
.badge{display:inline-block;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600}
.badge.success{background:#dcfce7;color:#166534}
.badge.failure{background:#fee2e2;color:#991b1b}
.badge.held{background:#fef3c7;color:#92400e}
.badge.incomplete{background:#e5e7eb;color:#374151}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #e8e8e8;vertical-align:top}
th{color:#555;font-weight:600;white-space:nowrap}
td time{white-space:nowrap;color:#555}
a{color:#1d4ed8;text-decoration:none}
a:hover{text-decoration:underline}
code{font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:#f4f4f5;padding:0 3px;border-radius:3px}
code.dim{color:#777}
.empty{color:#888;font-style:italic;margin:4px 0}
.fail{color:#991b1b;font-weight:500}
.notes li{color:#7a5c00;font-size:12px}
footer{margin-top:28px;color:#999;font-size:11px}
</style></head><body>
<h1>Liberty Village weekly content digest</h1>
<p class="meta">${esc(new Date(w.from).toISOString().slice(0, 10))} → ${esc(new Date(w.to).toISOString().slice(0, 10))} · generated ${esc(new Date(model.generatedAt).toISOString().slice(0, 16).replace('T', ' '))} UTC</p>
<div class="head">${heads.join('\n')}</div>

<h2>Posted this week (live site)</h2>
${table(['Section', 'Page', 'Last mod'], postedRows, { empty: 'nothing posted in the window' })}

<h2>Loop runs</h2>
${table(['Job', 'Target', 'Slot', 'Started', 'Outcome', 'Note', 'SHA'], runRows, { empty: 'no runs recorded in the window' })}

<h2>Failures &amp; why</h2>
${table(['Run', 'When', 'Reason', 'Log'], failureRowsHtml, { empty: 'no failures 🎉' })}

<h2>Queued next</h2>
<p class="meta">hold file: ${model.queue.held == null ? 'unknown' : model.queue.held ? '<b>present — writes stopped</b>' : 'absent'}${model.queue.note ? ' · ' + esc(model.queue.note) : ''}</p>
${table(['Timer', 'Next elapse', 'Last trigger', 'Schedule'], timerRows, { empty: 'no lv-* timers found' })}

<h2>Google Search Console</h2>
<p class="meta">source: <code>${esc(gsc.source ?? 'unavailable')}</code>${gsc.note ? ' · ' + esc(gsc.note) : ''}</p>
${table(['Week', 'Clicks', 'Impressions', 'CTR', 'Avg position'], deltaRow ? [...gscWeekRows, deltaRow] : gscWeekRows, { empty: 'GSC data unavailable' })}
${weeks.length ? `<h3>Top queries (latest week)</h3>${table(['Query', 'Clicks', 'Impr.', 'Pos.'], qRows)}
<h3>Top pages (latest week)</h3>${table(['Page', 'Clicks', 'Impr.', 'Pos.'], pRows)}` : ''}

${model.notes?.length ? `<h2>Fetch notes</h2><ul class="notes">${model.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}

<footer>libertyvillage.co weekly digest · built from runner JSONL (lv-content-runner), the live sitemap, and Search Console · digest JSON for the fix-it agent is published alongside this page</footer>
</body></html>`;
}
