// Pure digest-building logic for the Liberty Village weekly digest.
// No network, no fs: everything here is unit-testable (see tests/digest/).
// Tolerant by contract: runner JSONL gains fields over time (unknown/missing
// fields must never break a digest) and every fetch may degrade to a note.

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

/** Parse sitemap.xml text, return urls whose <lastmod> falls in [from, to). */
export function postedFromSitemap(xmlText, from, to) {
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  const items = [];
  const re = /<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]*)<\/lastmod>)?/g;
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    const loc = m[1].trim();
    const lastmod = m[2] ? m[2].trim() : null;
    const t = lastmod ? Date.parse(lastmod) : NaN;
    if (Number.isFinite(t) && t >= fromMs && t < toMs) {
      items.push({ url: loc, lastmod, section: sectionOf(loc) });
    }
  }
  return items;
}

// ── Model ────────────────────────────────────────────────────────────────────

export function buildModel({ generatedAt, window, runs, posted, titles = {}, queue, gsc, notes = [], links = {} }) {
  const runsView = summarizeRuns(runs ?? []);
  return {
    generatedAt,
    window,
    runs: { summary: runsView.summary, byJob: runsView.byJob, list: runs ?? [] },
    failures: failureRows(runs ?? [], window.to),
    posted: { items: (posted ?? []).map((p) => ({ ...p, title: titles[p.url] ?? null })) },
    queue: queue ?? { held: null, timers: [], note: 'not fetched' },
    gsc: gsc ?? { source: 'unavailable', note: 'not fetched' },
    notes,
    links,
  };
}

export function slackMessage(model) {
  const w = `${fmtDate(model.window.from, { month: 'short', day: 'numeric' })}–${fmtDate(model.window.to, { month: 'short', day: 'numeric' })}`;
  const s = model.runs.summary;
  const gscLine = model.gsc?.weeks?.length
    ? `GSC: ${model.gsc.weeks.at(-1).clicks} clicks${model.gsc.delta?.clicksPct != null ? ` (${model.gsc.delta.clicksPct >= 0 ? '+' : ''}${model.gsc.delta.clicksPct}% WoW)` : ''}`
    : 'GSC: unavailable';
  const held = model.queue?.held ? ' · loops HELD' : '';
  const lines = [
    `Liberty Village weekly digest — ${w}${held}`,
    `• Posted: ${model.posted.items.length} page(s)`,
    `• Runs: ${s.total} attempted, ${s.failure} failed`,
    `• ${gscLine}`,
    model.links.digestUrl ?? '',
  ].filter(Boolean);
  return lines.join('\n');
}
