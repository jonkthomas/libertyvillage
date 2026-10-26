// "Refreshed this week": the refresh loop's outcomes, read from the runner's
// `refresh-outcome` log lines (scripts/content/refresh.mjs refreshLogLine). Kept
// in its own file so the other digest sections can change without touching it.
import { explain } from './plain-english.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const face = (v) => (v && typeof v === 'object' ? { title: text(v.title, 200), description: text(v.description, 400) } : null);

/** One tolerant row from a `refresh-outcome` event (unknown shapes degrade to nulls). */
export function refreshRow(ev, run = {}) {
  const b = ev?.baseline && typeof ev.baseline === 'object' ? ev.baseline : {};
  return {
    at: text(ev?.at, 40), target: run.target ?? null, snapshotId: num(ev?.snapshotId), slug: text(ev?.slug, 128), url: text(ev?.url, 300),
    state: text(ev?.state, 20), reasonCode: text(ev?.reasonCode, 80), targetQuery: text(ev?.targetQuery, 200),
    lane: ev?.mode === 'snippet' || ev?.actionType === 'snippet' ? 'snippet' : 'full',
    baseline: { clicks: num(b.clicks), impressions: num(b.impressions), ctr: num(b.ctr), position: num(b.position) },
    before: face(ev?.before), after: face(ev?.after), change: text(ev?.change, 300),
  };
}

/** Every refresh outcome in the window's runs, oldest first; one row per snapshot
 *  (a later run's outcome, e.g. a pending deploy confirmed live, replaces the earlier). */
export function refreshedThisWeek(runs) {
  const rows = (Array.isArray(runs) ? runs : []).flatMap((run) => (run.refreshes ?? []).map((row) => ({ ...row, target: run.target ?? row.target })))
    .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  const latest = new Map();
  rows.forEach((row, i) => latest.set(row.snapshotId != null ? `${row.target}:${row.snapshotId}` : `row:${i}`, row));
  return [...latest.values()].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
}

const int = (n) => (n == null ? '—' : new Intl.NumberFormat('en-CA').format(Math.round(n)));
const metrics = (b) => `${int(b.clicks)} clicks · ${int(b.impressions)} impressions · ${b.ctr == null ? '—' : `${(b.ctr * 100).toFixed(1)}%`} CTR · position ${b.position == null ? '—' : b.position.toFixed(1)}`;
const pair = (label, before, after) => {
  const same = before === after || after == null;
  return `<p><span class="k">${esc(label)}</span><span>${same ? esc(before ?? '—') : `<s class="dim">${esc(before ?? '—')}</s><br>${esc(after)}`}</span></p>`;
};

/** The page section. Live-site refreshes in full; test-site ones in one line. */
export function renderRefreshed(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const live = all.filter((r) => r.target !== 'staging');
  const test = all.filter((r) => r.target === 'staging');
  const block = (r) => {
    // Only a confirmed live page counts as refreshed; a pending one is still publishing.
    const published = r.state === 'published' || r.state === 'rolled-back';
    const pending = r.state === 'pending';
    const why = published ? null : explain(r.reasonCode ?? 'refresh-error');
    const status = r.state === 'published' ? 'refreshed' : r.state === 'rolled-back' ? 'rolled back' : pending ? 'not live yet' : 'not changed';
    const lane = r.lane === 'snippet' ? 'snippet: title, description, intro' : 'full rewrite';
    return `<div class="problem">
<div class="problem-head"><b>${r.url ? `<a href="${esc(r.url)}">${esc(r.after?.title ?? r.before?.title ?? r.slug)}</a>` : esc(r.slug)}</b><span class="tag">${esc(lane)}</span><span class="tag">${esc(status)}</span></div>
${published ? `${pair('Title', r.before?.title, r.after?.title)}${pair('Description', r.before?.description, r.after?.description)}
<p><span class="k">Changed</span><span>${esc(r.change ?? '—')}</span></p>`
    : pending ? `<p><span class="k">Why</span><span>${esc(why.title)}. The new version is saved but readers still see the old page; the next refresh run finishes publishing it.</span></p>`
      : `<p><span class="k">Why</span><span>${esc(why.title)}. ${esc(why.cause)} The live page was left as it was.</span></p>`}
<p class="where"><span class="k">Before</span><span>${esc(metrics(r.baseline ?? {}))}${r.targetQuery ? ` · top search “${esc(r.targetQuery)}”` : ''} (last 28 days)</span></p>
</div>`;
  };
  const body = live.length ? live.map(block).join('\n') : '<p class="empty">No posts were refreshed this week.</p>';
  const note = test.length ? `<p class="testonly"><span class="k">Test site only</span><span>${test.map((r) => `${esc(r.slug)} (${esc(r.lane)}, ${esc(r.state)})`).join('; ')}.</span></p>` : '';
  const done = live.filter((r) => r.state === 'published' || r.state === 'rolled-back');
  const snippets = done.filter((r) => r.lane === 'snippet').length;
  const lanes = done.length ? `<p class="dim">${done.length - snippets} full rewrite${done.length - snippets === 1 ? '' : 's'} · ${snippets} snippet-only (searches at position 4–20 with a weak click rate get a new title, description and intro first)</p>\n` : '';
  return `<h2>Refreshed this week</h2>\n${lanes}${body}${note}`;
}
