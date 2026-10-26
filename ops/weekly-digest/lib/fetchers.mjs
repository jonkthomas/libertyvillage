// Network fetchers for the weekly digest. Each fetcher degrades to a note —
// a digest always renders, with whatever sources succeeded.
// VM access goes through the exe.dev API (EXEDEV_API_KEY env) -> ssh lv-content-runner.
// Secrets: only env var NAMES are referenced; values are never logged.

const EXE_API = 'https://exe.dev/exec';
export const VM_HOST = 'lv-content-runner';
const SITEMAP_URL = 'https://libertyvillage.co/sitemap.xml';
const RUN_LOG_DIR = '/var/log/lv-runner';
const TITLE_FETCH_LIMIT = 25;

/** Run a command on the VM via the exe.dev API. Returns stdout (throws on failure). */
export async function vmExec(command, { timeoutMs = 90_000, asRoot = false } = {}) {
  const key = process.env.EXEDEV_API_KEY;
  if (!key) throw new Error('EXEDEV_API_KEY not set');
  const b64 = Buffer.from(command, 'utf8').toString('base64');
  const pipe = asRoot ? 'base64 -d | sudo bash' : 'base64 -d | bash';
  const res = await fetch(EXE_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: `ssh ${VM_HOST} "echo ${b64} | ${pipe}"`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`exe.dev HTTP ${res.status}`);
  const text = await res.text();
  // exe.dev wraps failures in a JSON error document.
  if (text.startsWith('{') && /"error"/.test(text.slice(0, 200))) {
    let detail = text.slice(0, 300);
    try { detail = JSON.parse(text).error ?? detail; } catch { /* raw */ }
    throw new Error(`exe.dev: ${detail}`);
  }
  return text;
}

/** Fetch the file list + contents of runner JSONL logs for files touched in the window. */
export async function fetchVmLogs(fromIso) {
  // File mtimes decide candidacy; contents decide the real window (parseRun filters).
  const script = `
set -e
from_s=$(date -u -d "${fromIso}" +%s 2>/dev/null || echo 0)
cd ${RUN_LOG_DIR} 2>/dev/null || exit 0
for f in *.jsonl; do
  [ -e "$f" ] || continue
  m=$(stat -c %Y "$f")
  if [ "$m" -ge "$(( from_s - 90000 ))" ]; then
    echo "=====FILE=====$f"
    cat "$f" 2>/dev/null || echo '{"event":"unreadable-log"}'
  fi
done`;
  const out = await vmExec(script, { timeoutMs: 120_000, asRoot: true });
  const files = {};
  for (const chunk of out.split('=====FILE=====')) {
    const name = chunk.slice(0, chunk.indexOf('\n')).trim();
    const body = chunk.slice(chunk.indexOf('\n') + 1);
    if (name && name.endsWith('.jsonl')) files[name] = body;
  }
  return files;
}

/** Timer queue state + hold file. Uses systemd 255 JSON output. */
export async function fetchVmQueue() {
  const holdOut = await vmExec(
    `sudo test -e /etc/lv-runner.hold && echo HOLD_PRESENT || echo HOLD_ABSENT`);
  let timers = [];
  try {
    const jsonOut = await vmExec(
      `systemctl list-timers --all --no-pager -o json 2>/dev/null || echo '[]'`,
      { timeoutMs: 30_000 });
    timers = JSON.parse(jsonOut).filter((t) => String(t.unit ?? '').startsWith('lv-'));
  } catch { /* tolerate */ }
  // Per-unit OnCalendar schedules in one call, e.g. "OnCalendar=Mon *-*-* 09:00:00 America/Toronto".
  const units = timers.map((t) => t.unit).filter(Boolean);
  const cal = {};
  if (units.length) {
    try {
      const out = await vmExec(`systemctl show -p TimersCalendar ${units.join(' ')} 2>/dev/null || true`);
      // Multi-unit output: one "TimersCalendar={ OnCalendar=... ; next_elapse=... }"
      // line per unit, blank-line separated, in the same order as the units arg.
      const blocks = out.split('\n').filter((l) => l.includes('OnCalendar='));
      units.forEach((u, i) => {
        const c = blocks[i]?.match(/OnCalendar=([^;]+?)(?:\s*;|$)/);
        if (c) cal[u] = c[1].trim();
      });
    } catch { /* tolerate */ }
  }
  const iso = (us) => (Number(us) > 0 ? new Date(Number(us) / 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null);
  return {
    held: /HOLD_PRESENT/.test(holdOut),
    timers: timers.map((t) => ({
      unit: t.unit,
      next: iso(t.next),
      last: iso(t.last),
      activates: t.activates,
      schedule: cal[t.unit] ?? null,
    })),
  };
}

/** Sitemap text for posted-page discovery. */
export async function fetchSitemap() {
  const res = await fetch(SITEMAP_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  return res.text();
}

/** Live <title> for a bounded set of posted URLs (5 at a time). */
export async function fetchTitles(urls) {
  const titles = {};
  const batch = urls.slice(0, TITLE_FETCH_LIMIT);
  for (let i = 0; i < batch.length; i += 5) {
    await Promise.all(batch.slice(i, i + 5).map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return;
        const html = (await res.text()).slice(0, 20_000);
        titles[url] = (html.match(/<title>([^<]{1,160})<\/title>/i)?.[1] ?? '').trim() || null;
      } catch { /* tolerate */ }
    }));
  }
  return titles;
}

// ── GSC ──────────────────────────────────────────────────────────────────────
// Order: treg (TREG_TOKEN, free catalog tool) -> VM read-only searchanalytics
// query as root using the runner env's GOOGLE_SERVICE_ACCOUNT_JSON. The VM
// path never prints or moves the credential; it prints aggregates only.

function gscTotalsFromTreg(rows) {
  return rows.rows ?? [];
}

export async function fetchGscTreg(weeks) {
  const token = process.env.TREG_TOKEN;
  if (!token) throw new Error('TREG_TOKEN not set');
  const call = async (endpointId, params) => {
    const res = await fetch('https://treg.to/mcp/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'call', arguments: { endpoint_id: endpointId, params } } }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await res.json();
    const sc = j?.result?.structuredContent ?? {};
    if (sc.error) throw new Error(`treg: ${sc.error}${sc.hint ? ` (${sc.hint})` : ''}`);
    return typeof sc.body === 'string' ? JSON.parse(sc.body) : sc.body;
  };
  // Query one week to validate access, then both weeks + top rows.
  await call('google-search-console.sites', {});
  const query = (week, dimensions) => call('google-search-console.performance', {
    site: 'sc-domain:libertyvillage.co', startDate: week.start, endDate: week.end,
    ...(dimensions ? { dimensions } : {}),
  });
  const out = { weeks: [] };
  for (const wk of weeks) {
    const t = gscTotalsFromTreg(await query(wk));
    const tot = t[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    out.weeks.push({ start: wk.start, end: wk.end, ...pick(tot) });
  }
  const latest = weeks.at(-1);
  out.topQueries = (await query(latest, ['query'])).slice(0, 10);
  out.topPages = (await query(latest, ['page'])).slice(0, 10);
  return out;
}

const pick = (r) => ({
  clicks: r.clicks ?? 0, impressions: r.impressions ?? 0,
  ctr: r.ctr ?? 0, position: r.position ?? null,
});

function gscVmScript(weeks) {
  return `
import { google } from 'googleapis';
const site = 'sc-domain:libertyvillage.co';
const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] });
const client = google.searchconsole({ version: 'v1', auth });
const weeks = ${JSON.stringify(weeks)};
const q = async (start, end, dimensions) => (await client.searchanalytics.query({
  siteUrl: site,
  requestBody: { startDate: start, endDate: end, type: 'web', dataState: 'all',
    ...(dimensions ? { dimensions, rowLimit: 10 } : {}) },
})).data.rows ?? [];
const out = { weeks: [] };
for (const w of weeks) {
  const rows = await q(w.start, w.end);
  const t = rows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: null };
  out.weeks.push({ start: w.start, end: w.end, clicks: t.clicks ?? 0, impressions: t.impressions ?? 0, ctr: t.ctr ?? 0, position: t.position ?? null });
}
const latest = weeks[weeks.length - 1];
out.topQueries = (await q(latest.start, latest.end, ['query'])).slice(0, 10);
out.topPages = (await q(latest.start, latest.end, ['page'])).slice(0, 10);
process.stdout.write(JSON.stringify(out));
`.trim();
}

/**
 * Read-only GSC searchanalytics query run ON the VM as root, mirroring how the
 * runner materializes its GSA (GOOGLE_SERVICE_ACCOUNT_JSON -> tmpfs key file,
 * root 0600, removed on exit). The credential never leaves the VM and is
 * never printed; only aggregate stats JSON comes back.
 */
export async function fetchGscOnVm(weeks) {
  const script = gscVmScript(weeks);
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  const wrapped = `
set -e
cd /srv/lv-runner/repo   # ESM resolves node_modules from cwd for stdin modules
set -a; . /etc/lv-runner.env; set +a
if [ -z "$GOOGLE_SERVICE_ACCOUNT_JSON" ]; then set -a; . /etc/lv-runner-staging.env; set +a; fi
set +a
: "\${GOOGLE_SERVICE_ACCOUNT_JSON:?no GOOGLE_SERVICE_ACCOUNT_JSON in runner env}"
umask 077
GSC_KEY=/run/lv-digest-gsc-$$.json
trap 'rm -f "$GSC_KEY"' EXIT
printf '%s' "$GOOGLE_SERVICE_ACCOUNT_JSON" > "$GSC_KEY"
GOOGLE_APPLICATION_CREDENTIALS="$GSC_KEY" node --input-type=module - <<GSC_EOF
$(printf '%s' '${b64}' | base64 -d)
GSC_EOF`;
  // The runner env files are root:root 0600: the whole wrapper runs as root
  // (sudo bash), exactly like the runner service does.
  const out = await vmExec(`echo '${Buffer.from(wrapped, 'utf8').toString('base64')}' | base64 -d | sudo bash`, { timeoutMs: 120_000 });
  // Only the last line that parses as our JSON object is used.
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  if (!line) throw new Error(`VM GSC script returned no JSON (last output: ${out.trim().split('\n').slice(-14).join(' | ').slice(0, 800)})`);
  const parsed = JSON.parse(line);
  if (!parsed.weeks?.length) throw new Error('VM GSC script returned empty weeks');
  return parsed;
}

/** GSC with source tracking: treg first, VM googleapis fallback. */
export async function fetchGsc(weeks) {
  try {
    const data = await fetchGscTreg(weeks);
    return { ...data, source: 'treg (google-search-console)' };
  } catch (e1) {
    try {
      const data = await fetchGscOnVm(weeks);
      return { ...data, source: 'vm googleapis (runner GSA, read-only)', tregError: String(e1.message ?? e1) };
    } catch (e2) {
      return { source: 'unavailable', note: `treg: ${e1.message}; vm: ${e2.message}`, weeks: [] };
    }
  }
}

export function gscDelta(weeks) {
  if (weeks.length < 2) return null;
  const [prev, latest] = [weeks[0], weeks[1]];
  const pctOf = (a, b) => b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null;
  return {
    clicksPct: pctOf(latest.clicks, prev.clicks),
    impressionsPct: pctOf(latest.impressions, prev.impressions),
    ctr: latest.ctr ?? null,
    position: latest.position != null && prev.position != null
      ? Math.round((latest.position - prev.position) * 10) / 10 : null,
  };
}

// ── Ops fixer ("What the agent fixed") ───────────────────────────────────────

const FIXER_LOG = '/var/lib/lv-ops-fixer/actions.jsonl';

/** Parse the fixer's action log; keep well-formed records from `fromIso` on. */
export function parseFixerActions(text, fromIso) {
  const from = Date.parse(fromIso);
  return String(text ?? '').split('\n').flatMap((line) => {
    try {
      const r = JSON.parse(line);
      return r && typeof r === 'object' && typeof r.at === 'string' && Date.parse(r.at) >= from && typeof r.decision === 'string' ? [r] : [];
    } catch { return []; }
  });
}

/** The fixer's recent action records from the VM (empty when it is not installed yet). */
export async function fetchVmFixerActions(fromIso) {
  const out = await vmExec(`tail -n 2000 ${FIXER_LOG} 2>/dev/null || true`, { timeoutMs: 60_000, asRoot: true });
  return parseFixerActions(out, fromIso);
}

/** Issues the fix-it agent filed in the window (label lv-digest-agent), via the Mac's gh login. */
export async function fetchFixItIssues(fromIso, { exec } = {}) {
  const run = exec ?? (await import('node:child_process')).execFileSync;
  const out = run('gh', ['issue', 'list', '--repo', 'jonkthomas/libertyvillage', '--label', 'lv-digest-agent', '--state', 'all',
    '--search', `created:>=${String(fromIso).slice(0, 10)}`, '--limit', '20', '--json', 'number,title,url,state,createdAt'],
  { encoding: 'utf8', timeout: 30_000 });
  return JSON.parse(out).filter((i) => Date.parse(i.createdAt) >= Date.parse(fromIso));
}
