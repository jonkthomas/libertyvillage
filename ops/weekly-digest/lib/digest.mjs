// Pure digest-building logic for the Liberty Village weekly digest.
// No network, no fs: everything here is unit-testable (see tests/digest/).
// Tolerant by contract: runner JSONL gains fields over time (unknown/missing
// fields must never break a digest) and every fetch may degrade to a note.

import { explain, normalizeCode, jobName, siteName } from './plain-english.mjs';
import { fixerSlackLine } from './fixer-section.mjs';
import { refreshRow, refreshedThisWeek } from './refreshed.mjs';

export const TORONTO_TZ = 'America/Toronto';

export function fmtDate(d, opts = {}) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TORONTO_TZ, ...opts }).format(new Date(d));
}

export function fmtDateTime(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TZ, year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(d));
}

/** Trailing 7-day window ending `now` (ISO strings). */
export function trailingWindow(now, days = 7) {
  const to = new Date(now);
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** The two complete Mon–Sun weeks ending with the last finished Sunday before `now`. */
export function gscWeeks(now) {
  const d = new Date(now);
  // Find the most recent Monday 00:00 UTC at/before now, then step back.
  const day = d.getUTCDay(); // 0=Sun
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday));
  const thisSunday = new Date(monday.getTime() + 6 * 86_400_000);
  const end = thisSunday <= d ? thisSunday : new Date(monday.getTime() - 86_400_000);
  const w1End = end;
  const w1Start = new Date(end.getTime() - 6 * 86_400_000);
  const w2End = new Date(w1Start.getTime() - 86_400_000);
  const w2Start = new Date(w2End.getTime() - 6 * 86_400_000);
  const iso = (x) => x.toISOString().slice(0, 10);
  return [
    { start: iso(w2Start), end: iso(w2End) }, // previous week
    { start: iso(w1Start), end: iso(w1End) }, // latest complete week
  ];
}

// ── Runner JSONL ─────────────────────────────────────────────────────────────

/**
 * Parse one run's JSONL text. Tolerant: unparsable lines and unknown events are
 * counted, never thrown. Returns a run row or null (no start line / no lines).
 */
export function parseRun(fileName, text) {
  const run = {
    file: fileName,
    job: null, target: null, slot: null,
    startedAt: null, endedAt: null, sha: null,
    outcome: null, // success | failure | held | incomplete
    reason: null, error: null, detail: null,
    events: 0, badLines: 0, eventNames: [],
    refreshes: [],
  };
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev;
    try { ev = JSON.parse(trimmed); } catch { run.badLines += 1; continue; }
    if (!ev || typeof ev !== 'object' || typeof ev.event !== 'string') { run.badLines += 1; continue; }
    run.events += 1;
    run.eventNames.push(ev.event);
    if (!run.startedAt && typeof ev.at === 'string') run.startedAt = ev.at;
    if (ev.event === 'start') {
      run.job = typeof ev.job === 'string' ? ev.job : run.job;
      run.target = typeof ev.target === 'string' ? ev.target : run.target;
      run.slot = typeof ev.slot === 'string' ? ev.slot : run.slot;
    } else if (ev.event === 'code-pinned' && typeof ev.sha === 'string') {
      run.sha = ev.sha.slice(0, 8);
    } else if (ev.event === 'success') {
      // Sticky outcomes: a failure or hold earlier in the log is the truthful
      // final state (the runner emits roundup-hold-alerted before success).
      if (!run.outcome) {
        run.outcome = 'success';
        run.endedAt = typeof ev.at === 'string' ? ev.at : run.endedAt;
        const r = ev.result;
        if (r && typeof r === 'object') {
          if (typeof r.reason === 'string') run.reason = r.reason;
          if (r.noChanges === true && !run.reason) run.reason = 'no changes';
          if (r.dryRun === true && !run.reason) run.reason = 'dry run';
        }
      }
    } else if (ev.event === 'failure' || ev.event === 'alert-failed') {
      // First failure decides; success never overrides it.
      if (run.outcome !== 'failure') {
        run.outcome = 'failure';
        run.endedAt = typeof ev.at === 'string' ? ev.at : run.endedAt;
        run.error = typeof ev.error === 'string' ? ev.error : null;
        // Real runner logs action/exit top-level; older/sibling builds may nest
        // them in cliFailure. Accept both.
        if (typeof ev.action === 'string') run.detail = `cli: ${ev.action}`;
        else if (ev.cliFailure && typeof ev.cliFailure === 'object' && ev.cliFailure.action) {
          run.detail = `cli: ${ev.cliFailure.action}`;
        }
        // Tolerate sibling-added fields: any other string prop on failure lines.
        if (!run.error) {
          const extra = Object.entries(ev).filter(([k, v]) =>
            !['at', 'event', 'error', 'cliFailure', 'action', 'exit', 'job', 'target', 'slot', 'submissionId'].includes(k) &&
            (typeof v === 'string' || typeof v === 'number')).map(([, v]) => String(v));
          run.error = extra[0] ?? null;
        }
      }
    } else if (ev.event === 'refresh-outcome') {
      run.refreshes.push(refreshRow(ev, run));
    } else if (ev.event === 'roundup-hold-alerted') {
      if (!run.outcome) {
        run.outcome = 'held';
        run.reason = typeof ev.week === 'string' ? `roundup hold, week ${ev.week}` : 'roundup hold';
      }
    }
  }
  if (!run.startedAt && run.events === 0) return null;
  if (!run.outcome) run.outcome = 'incomplete';
  if (!run.job) {
    // Fall back to filename: <job>-<target>-<slot>.jsonl
    const m = fileName.match(/^(?:.*\/)?([a-z-]+?)-(staging|production)-([^/]+)\.jsonl$/i);
    if (m) { run.job = m[1]; run.target = m[2]; run.slot = m[3]; }
    else run.job = fileName.replace(/\.jsonl$/, '');
  }
  return run;
}

/** Parse {name → text} map, keep runs whose start time falls in [from, to). */
export function parseRuns(files, from, to) {
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  return Object.entries(files)
    .map(([name, text]) => parseRun(name, text))
    .filter((r) => {
      if (!r || !r.startedAt) return false;
      const t = Date.parse(r.startedAt);
      return t >= fromMs && t < toMs;
    })
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

export function summarizeRuns(runs) {
  const summary = { total: runs.length, success: 0, failure: 0, held: 0, incomplete: 0 };
  const byJob = new Map();
  for (const r of runs) {
    if (r.outcome === 'success') summary.success += 1;
    else if (r.outcome === 'failure') summary.failure += 1;
    else if (r.outcome === 'held') summary.held += 1;
    else summary.incomplete += 1;
    const k = `${r.job}${r.target ? ':' + r.target : ''}`;
    const j = byJob.get(k) ?? { job: r.job, target: r.target, ran: 0, success: 0, failure: 0, held: 0, incomplete: 0 };
    j.ran += 1;
    if (j[r.outcome] !== undefined) j[r.outcome] += 1;
    byJob.set(k, j);
  }
  return { summary, byJob: [...byJob.values()] };
}

/** Failures MUST surface: every failed run becomes an entry here. A run that
 * started long ago with no terminal event (timeout/OOM/reboot kills the
 * runner before it can log) counts as failed too. */
export function failureRows(runs, now) {
  const staleMs = now != null ? Date.parse(now) : Date.now();
  return runs
    .filter((r) => r.outcome === 'failure' ||
      (r.outcome === 'incomplete' && r.startedAt && staleMs - Date.parse(r.startedAt) > 4 * 3600_000))
    .map((r) => ({
      job: r.job, target: r.target, slot: r.slot, startedAt: r.startedAt,
      reason: r.outcome === 'incomplete'
        ? 'no terminal event (killed/timeout/reboot?)'
        : (r.error ?? r.detail ?? r.reason ?? 'unknown'),
      file: r.file,
    }));
}

// ── Sitemap ("what was posted") ──────────────────────────────────────────────

export function sectionOf(url) {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean);
    return p[0] ?? 'root';
  } catch { return 'other'; }
}

/**
 * Parse sitemap.xml text, return urls whose <lastmod> falls in [from, to).
 * Static, directory, guide and building pages carry the build time as lastmod
 * (app/sitemap.ts `now`), so one deploy stamps hundreds of URLs at once; only
 * blog/news posts carry their own publish/update date. A lastmod value shared
 * by a large share of URLs is that deploy stamp, not a publication: skip it.
 */
export function postedFromSitemap(xmlText, from, to) {
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  const urls = [];
  const re = /<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]*)<\/lastmod>)?/g;
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    urls.push({ url: m[1].trim(), lastmod: m[2] ? m[2].trim() : null });
  }
  const counts = new Map();
  for (const u of urls) if (u.lastmod) counts.set(u.lastmod, (counts.get(u.lastmod) ?? 0) + 1);
  const isDeployStamp = (lastmod) => {
    const n = counts.get(lastmod) ?? 0;
    return n >= 10 && n >= urls.length * 0.25;
  };
  const items = [];
  for (const { url, lastmod } of urls) {
    const t = lastmod ? Date.parse(lastmod) : NaN;
    if (Number.isFinite(t) && t >= fromMs && t < toMs && !isDeployStamp(lastmod)) {
      items.push({ url, lastmod, section: sectionOf(url) });
    }
  }
  return items;
}

/** Decode the HTML entities a page <title> carries (the renderer escapes again). */
export function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return named[e.toLowerCase()] ?? whole;
  });
}

// ── Model ────────────────────────────────────────────────────────────────────

export function buildModel({ generatedAt, window, runs, posted, titles = {}, queue, gsc, actions = [], fixer = null, notes = [], links = {} }) {
  const runsView = summarizeRuns(runs ?? []);
  return {
    generatedAt,
    window,
    runs: { summary: runsView.summary, byJob: runsView.byJob, list: runs ?? [] },
    failures: failureRows(runs ?? [], window.to),
    posted: { items: (posted ?? []).map((p) => ({ ...p, title: titles[p.url] ? decodeEntities(titles[p.url]) : null })) },
    queue: queue ?? { held: null, timers: [], note: 'not fetched' },
    gsc: gsc ?? { source: 'unavailable', note: 'not fetched' },
    actions,
    fixer: fixer ?? { actions: [], issues: [] },
    notes,
    links,
    refreshes: refreshedThisWeek(runs ?? []),
  };
}

// ── Exec summary (shared by the Slack post and the page) ────────────────────
// Derived at render time from the published model, so the JSON shape the fix-it
// agent reads is unchanged and old digests re-render the same way.

/** Planned posts per week; mirrors the runner's CADENCE.contentGoal. */
export const WEEKLY_POST_PLAN = 2;

const shortDay = (d) => fmtDate(d, { month: 'short', day: 'numeric' });
const round = (n, dp = 0) => (n == null || !Number.isFinite(Number(n)) ? null : Number(Number(n).toFixed(dp)));
const fmtInt = (n) => (n == null ? '—' : new Intl.NumberFormat('en-CA').format(Math.round(n)));
const pctChange = (prev, cur) => (prev ? round(((cur - prev) / prev) * 100, 1) : null);
const pos1 = (n) => (n == null ? null : Number(n).toFixed(1));

/** "Oct 19–26" within a month, "Oct 26–Nov 2" across months; optional ", 2026". */
export function dateRange(from, to, { year = false } = {}) {
  const month = (d) => fmtDate(d, { month: 'short' });
  const day = (d) => fmtDate(d, { day: 'numeric' });
  const tail = year ? `, ${fmtDate(to, { year: 'numeric' })}` : '';
  return month(from) === month(to) ? `${month(from)} ${day(from)}–${day(to)}${tail}` : `${shortDay(from)}–${shortDay(to)}${tail}`;
}

/** "2026-10-28 11:00 UTC" (systemd list-timers) or ISO -> Date, else null. */
export function parseTimerTime(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const iso = s.trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?) UTC$/, '$1T$2Z');
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

const DAY_NAMES = { Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat', Sun: 'Sun' };
/** systemd OnCalendar -> "daily" | "Wed and Sun" | "every Mon" (best effort). */
export function scheduleWords(schedule) {
  const s = String(schedule ?? '').trim();
  if (!s) return '';
  const days = s.match(/^([A-Z][a-z]{2}(?:[,.]+[A-Z][a-z]{2})*)\s/);
  if (!days) return /^\*-\*-\*/.test(s) ? 'daily' : '';
  const list = days[1].split(/[,.]+/).filter((d) => DAY_NAMES[d]);
  return list.length === 1 ? `every ${list[0]}` : list.join(' and ');
}

const TIMER_WORDS = {
  'weekly-blog': 'New blog post', 'october-blog-backfill': 'October catch-up post', 'topic-discovery': 'Topic research (fills the topic queue)',
  'discover-businesses': 'Business directory refresh', news: 'News check', 'weekly-growth-report': 'Growth report',
  'weekly-roundup': 'Weekly news roundup', 'seo-improvements': 'Refresh the 2 weakest posts',
};

/** Timers -> plain "next week" rows, production only, soonest first. */
export function nextWeekPlan(timers, now) {
  const nowMs = Date.parse(now ?? new Date().toISOString());
  const rows = [];
  for (const t of Array.isArray(timers) ? timers : []) {
    const m = String(t.activates ?? '').match(/^lv-runner@([a-z-]+):(staging|production)/);
    const job = m?.[1] ?? (String(t.unit ?? '').startsWith('lv-digest-agent') ? 'fix-it-agent' : null);
    if (!job || (m && m[2] !== 'production')) continue;
    const next = parseTimerTime(t.next);
    rows.push({
      job,
      what: job === 'fix-it-agent' ? 'Fix-it agent reviews this report' : (TIMER_WORDS[job] ?? job.replace(/-/g, ' ')),
      next: next ? next.toISOString() : null,
      repeats: scheduleWords(t.schedule),
      paused: !next,
    });
  }
  return rows
    .filter((r) => !r.next || Date.parse(r.next) >= nowMs - 86_400_000)
    .sort((a, b) => (a.next ? Date.parse(a.next) : Infinity) - (b.next ? Date.parse(b.next) : Infinity));
}

/** A failed run is resolved by the first later successful run of the same job on the same site. */
function resolvedLater(f, runs) {
  const t = Date.parse(f.startedAt);
  return runs
    .filter((r) => r.job === f.job && r.target === f.target && r.outcome === 'success' && Date.parse(r.startedAt) > t)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0] ?? null;
}

/** Failure rows grouped by plain-English cause (largest group first); `open` counts the unresolved ones. */
export function problemGroups(failures, runs = []) {
  const groups = new Map();
  for (const f of Array.isArray(failures) ? failures : []) {
    const e = explain(f.reason);
    const key = e.title;
    const g = groups.get(key) ?? { title: e.title, cause: e.cause, impact: e.impact, action: e.action, needsYou: e.needsYou, known: e.known, link: e.link, count: 0, live: 0, open: 0, where: [] };
    g.count += 1;
    const fixed = resolvedLater(f, Array.isArray(runs) ? runs : []);
    if (!fixed) g.open += 1;
    else if (!g.resolvedAt || Date.parse(fixed.startedAt) > Date.parse(g.resolvedAt)) g.resolvedAt = fixed.startedAt;
    if (f.target === 'production') g.live += 1;
    g.where.push({ job: jobName(f.job), site: siteName(f.target), at: f.startedAt });
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.live - a.live);
}

function searchSentence(gsc) {
  const [prev, cur] = gsc?.weeks?.length >= 2 ? gsc.weeks.slice(-2) : [null, gsc?.weeks?.at(-1)];
  if (!cur) return 'Search data was unavailable this week.';
  if (!prev) return `Search: ${fmtInt(cur.clicks)} clicks from ${fmtInt(cur.impressions)} impressions.`;
  const c = pctChange(prev.clicks, cur.clicks), i = pctChange(prev.impressions, cur.impressions);
  const verb = (n, up, down) => (n == null ? 'held' : n > 0.5 ? up : n < -0.5 ? down : 'held steady');
  const amt = (n) => (n == null || Math.abs(n) <= 0.5 ? '' : ` ${Math.abs(n)}%`); // one decimal, as on the tiles
  const cv = verb(c, 'rose', 'fell'), iv = verb(i, 'rose', 'fell');
  const join = (cv === 'rose') !== (iv === 'rose') && cv !== 'held steady' && iv !== 'held steady' ? 'while' : 'and';
  let s = `Search clicks ${cv}${amt(c)} (${fmtInt(prev.clicks)} → ${fmtInt(cur.clicks)}) ${join} impressions ${iv}${amt(i)}`;
  const p0 = pos1(prev.position), p1 = pos1(cur.position);
  if (p0 != null && p1 != null && Math.abs(p1 - p0) >= 0.3) {
    const worse = Number(p1) > Number(p0);
    if (worse && cv === 'fell' && iv === 'rose') s += `: we are showing up more but ranking lower (average position ${p0} → ${p1})`;
    else s += `; average position ${worse ? 'slipped' : 'improved'} from ${p0} to ${p1}`;
  }
  return `${s}.`;
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The exec view of one digest model: headline, KPI tiles, what shipped,
 * problems grouped by cause, next week, what's working, and what needs John.
 */
export function execSummary(model) {
  const items = model.posted?.items ?? [];
  const live = items.length;
  const plan = WEEKLY_POST_PLAN;
  // A week that ended on plan settles its earlier "behind plan" progress
  // checks: one quiet line, not issues.
  const onPlan = live >= plan;
  const progressCheck = (f) => onPlan && normalizeCode(f.reason) === 'cadence content deficit';
  const checks = (model.failures ?? []).filter(progressCheck).length;
  const progressNote = checks
    ? `Mid-week progress checks flagged the week as behind ${checks === 1 ? 'once' : checks === 2 ? 'twice' : `${checks} times`}; it finished on plan.`
    : null;
  // Issues are live-site (production) causes, each shown as a block on the page;
  // test-site causes stay out of the count and get one footnote line.
  const remaining = (model.failures ?? []).filter((f) => !progressCheck(f));
  const groups = problemGroups(remaining.filter((f) => f.target === 'production'), model.runs?.list ?? []);
  const testGroups = problemGroups(remaining.filter((f) => f.target !== 'production'), model.runs?.list ?? []);
  const needsYou = [...groups, ...testGroups].filter((g) => g.needsYou && g.open > 0);
  const weeks = model.gsc?.weeks ?? [];
  const [prev, cur] = weeks.length >= 2 ? weeks.slice(-2) : [null, weeks.at(-1) ?? null];
  const gscRange = cur?.start && cur?.end ? dateRange(`${cur.start}T12:00:00Z`, `${cur.end}T12:00:00Z`) : null;

  const postsSentence = live >= plan ? `${live} of ${plan} planned posts went live.`
    : live === 0 ? `No posts went live this week (plan: ${plan}).`
      : `${live} of ${plan} planned posts went live, ${plan - live} short.`;
  // Count live-site issues (causes), each resolved or still open, not raw failed runs.
  const open = groups.filter((g) => g.open > 0);
  const cats = [
    [groups.length - open.length, 'resolved', 'resolved'],
    [open.filter((g) => g.known && !g.needsYou).length, 'being retried automatically', 'being retried automatically'],
    [open.filter((g) => !g.known).length, 'being investigated', 'being investigated'],
    [open.filter((g) => g.known && g.needsYou).length, 'needs you', 'need you'],
  ].filter(([n]) => n > 0);
  const n = groups.length;
  let problems;
  if (!n) problems = testGroups.length ? 'No live-site issues this week.' : 'No issues this week.';
  else if (cats.length === 1) problems = n === 1 ? `1 issue this week, ${cats[0][1]}.` : `${n} issues this week, ${n === 2 ? 'both' : 'all'} ${cats[0][2]}.`;
  else problems = `${n} issues this week: ${cats.map(([k, one, many]) => `${k} ${k === 1 ? one : many}`).join(', ')}.`;
  const ask = model.queue?.held ? 'Publishing is paused (hold switch on): lift it when ready.'
    : needsYou.length ? `${needsYou.length === 1 ? '1 thing needs' : `${needsYou.length} things need`} you: ${needsYou.map((g) => lowerFirst(g.action.replace(/\.$/, ''))).join('; ')}.`
      : 'Nothing needs you this week.';

  const kpi = (label, value, previous, opts = {}) => {
    const delta = opts.delta ?? (previous != null && value != null ? pctChange(previous, value) : null);
    const better = delta == null || Math.abs(delta) < (opts.flat ?? 0.5) ? null : (opts.lowerIsBetter ? delta < 0 : delta > 0);
    return { label, value, previous, delta, unit: opts.unit ?? '%', better, note: opts.note ?? null, display: opts.display ?? null };
  };
  const pos = round(cur?.position, 1), posPrev = round(prev?.position, 1);
  const kpis = [
    { label: 'Posts live vs plan', display: `${live} of ${plan}`, previous: null, delta: null, unit: null, better: live >= plan ? true : false,
      note: live >= plan ? 'on plan' : `${plan - live} short` },
    kpi(`Search clicks${gscRange ? ` (${gscRange})` : ''}`, cur?.clicks ?? null, prev?.clicks ?? null),
    kpi('Search impressions', cur?.impressions ?? null, prev?.impressions ?? null),
    kpi('Average position', pos, posPrev, { delta: pos != null && posPrev != null ? round(pos - posPrev, 1) : null, unit: '', lowerIsBetter: true, flat: 0.3, note: 'lower is better' }),
  ];

  return {
    week: dateRange(model.window.from, model.window.to, { year: true }),
    weekShort: dateRange(model.window.from, model.window.to),
    gscRange,
    headline: `${postsSentence} ${searchSentence(model.gsc)}`,
    problems, progressNote, ask,
    kpis, groups, testGroups, needsYou,
    shipped: items.map((p) => ({ title: p.title ?? String(p.url ?? '').replace(/^https?:\/\/[^/]+/, ''), url: p.url, date: p.lastmod, section: p.section })),
    next: nextWeekPlan(model.queue?.timers, model.window.to),
    working: {
      pages: (model.gsc?.topPages ?? []).slice(0, 5),
      queries: (model.gsc?.topQueries ?? []).slice(0, 5),
    },
  };
}

export function searchClicksLead(gsc = {}) {
  const weeks = gsc.weeks ?? [];
  const latest = weeks.at(-1), previous = weeks.at(-2);
  if (!latest || !previous) return 'Search clicks this week: unavailable (WoW unavailable)';
  const pct = previous.clicks > 0 ? Math.round((latest.clicks - previous.clicks) / previous.clicks * 1000) / 10 : null;
  return `Search clicks this week: ${latest.clicks} (${pct == null ? 'WoW unavailable; zero prior clicks' : `${pct >= 0 ? '+' : ''}${pct}% WoW`}); last week: ${previous.clicks}`;
}

export function actionMovementLines(actions = []) {
  const point = (metrics) => !metrics ? 'pending' : `${metrics.clicks ?? 'unknown'} clicks, ${metrics.impressions ?? 'unknown'} impressions, CTR ${metrics.ctr == null ? 'unknown' : `${(metrics.ctr * 100).toFixed(1)}%`}, position ${metrics.position == null ? 'unknown' : Number(metrics.position).toFixed(1)}`;
  return actions.map((action) => `${action.action_kind === 'refresh' ? 'Refreshed' : 'Published'} ${action.slug} (${action.target_query}): T0 ${point(action.baseline)} → +2w ${point(action.outcome_2w)} → +4w ${point(action.outcome_4w)}`);
}

export function slackMessage(model) {
  const x = execSummary(model);
  const day = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') ? shortDay(`${d}T12:00:00Z`) : d ? shortDay(d) : '');
  const shipped = x.shipped.length
    ? `Published: ${x.shipped.map((p) => `"${p.title}"${p.date ? ` (${day(p.date)})` : ''}`).join('; ')}.`
    : 'Published: nothing this week.';
  const lines = [
    searchClicksLead(model.gsc),
    `Liberty Village content report, week of ${x.weekShort}`,
    x.headline,
    shipped,
    'What we did → what it moved',
    ...(model.actions?.length ? actionMovementLines(model.actions) : ['No measured actions yet; outcomes appear after 2 and 4 weeks.']),
    `Problems: ${x.problems}${x.progressNote ? ` ${x.progressNote}` : ''}`,
    fixerSlackLine(model),
    `What you need to do: ${x.ask}`,
    model.links?.digestUrl ? `Full report: ${model.links.digestUrl}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}
