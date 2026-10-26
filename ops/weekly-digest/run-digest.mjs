#!/usr/bin/env node
// Weekly Liberty Village digest — entrypoint run by the Mac LaunchAgent
// (com.jonkthomas.lv-weekly-digest, Monday 08:00 America/Toronto).
//
//   node ops/weekly-digest/run-digest.mjs [--dry-run] [--no-slack] [--no-push]
//        [--date 2026-10-27T08:00:00-04:00] [--out-dir DIR] [--base-url URL]
//
// Steps: fetch (VM logs, timers/hold, sitemap+titles, GSC) -> build model ->
// render dense HTML + JSON -> publish into the spec-deck server dir (tailnet
// URL) -> post the link to Slack C0B6HEAHZT4 via hermes -> push the digest
// JSON to the VM for the fix-it agent. Every fetch degrades to a note.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  trailingWindow, gscWeeks, parseRuns, postedFromSitemap, buildModel, slackMessage,
} from './lib/digest.mjs';
import { renderHtml } from './lib/render.mjs';
import { agentInput } from './lib/agent-input.mjs';
import {
  fetchLedgerOnVm, fetchVmLogs, fetchVmQueue, fetchSitemap, fetchTitles, fetchGsc, gscDelta, vmExec, VM_HOST,
} from './lib/fetchers.mjs';

const HOME = os.homedir();
const INSTALL_DIR = path.join(HOME, '.local', 'share', 'lv-weekly-digest');
const DEFAULT_OUT = path.join(HOME, '.pi', 'agent', 'spec-decks', 'lv-digest');
const DEFAULT_BASE = 'https://ofia.tail97aece.ts.net/decks/lv-digest';
const HERMES = path.join(HOME, '.local', 'bin', 'hermes');
const VAULT = path.join(HOME, 'Desktop', 'important-coding-projects', 'claude-config', 'secrets', 'pi-tool-vault.env');
const LOCAL_ENV = path.join(INSTALL_DIR, 'digest.env');
const SLACK_TARGET = 'slack:C0B6HEAHZT4';
const SLACK_PROFILE = 'ofia';
const VM_JSON_DIR = '/var/lib/lv-digest';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const dryRun = flag('--dry-run');
const log = (...a) => console.log(new Date().toISOString(), ...a);

// The launchd environment has no shell profile — and ~/Desktop is TCC-blocked
// for launchd — so keys come from a local 0600 env file first (synced from the
// vault by install-mac.sh), then the vault itself when readable (interactive
// runs). Values only ever land in process.env, never in output.
function loadVault(notes) {
  const sources = [LOCAL_ENV, VAULT];
  for (const src of sources) {
    try {
      for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
      }
    } catch (e) {
      if (src === LOCAL_ENV) notes.push(`local env file missing or unreadable (${e.code ?? e.message}); run install-mac.sh`);
      else notes.push(`vault unreadable from this context (${e.code ?? e.message}); expected under launchd unless ${LOCAL_ENV} exists`);
    }
  }
}

function digestId(now) {
  // Toronto calendar date of the run = the digest id.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).replaceAll('-', '-');
}

function renderIndex(existing) {
  const rows = existing
    .filter((f) => /^lv-digest-\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .sort().reverse()
    .map((f) => `<li><a href="${f}">${f.replace('lv-digest-', '').replace('.html', '')}</a></li>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LV weekly digests</title>
<style>body{font:13px/1.5 -apple-system,system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px}li{margin:4px 0}a{color:#1d4ed8}</style>
</head><body><h1>Liberty Village weekly digests</h1><ul>${rows || '<li>none yet</li>'}</ul></body></html>`;
}

async function main() {
  const notes = [];
  loadVault(notes);
  const now = new Date(opt('--date', new Date().toISOString()));
  const outDir = opt('--out-dir', DEFAULT_OUT);
  const baseUrl = (opt('--base-url', DEFAULT_BASE)).replace(/\/$/, '');

  const window = trailingWindow(now);
  const weeks = gscWeeks(now);
  const id = digestId(now);
  log(`digest ${id} window ${window.from} → ${window.to}`);

  // 1. VM runner logs (tolerant)
  let runFiles = {};
  try { runFiles = await fetchVmLogs(window.from, window.to); }
  catch (e) { notes.push(`VM logs unavailable: ${e.message}`); }
  const runs = parseRuns(runFiles, window.from, window.to);
  log(`runs parsed: ${runs.length} (${Object.keys(runFiles).length} files fetched)`);

  // 2. Posted pages (live sitemap) + titles
  let posted = [];
  let sitemapText = null;
  try {
    sitemapText = await fetchSitemap();
    posted = postedFromSitemap(sitemapText, window.from, window.to);
  } catch (e) { notes.push(`sitemap unavailable: ${e.message}`); }
  let titles = {};
  if (posted.length) {
    try { titles = await fetchTitles(posted.map((p) => p.url)); } catch { /* optional */ }
  }
  log(`posted in window: ${posted.length}`);

  // 3. Queue state (timers + hold)
  let queue = { held: null, timers: [], note: 'not fetched' };
  try { queue = await fetchVmQueue(); } catch (e) { notes.push(`queue state unavailable: ${e.message}`); }

  // 4. GSC (treg -> VM fallback, source tracked)
  let gsc = { source: 'unavailable', weeks: [] };
  try { gsc = await fetchGsc(weeks); } catch (e) { gsc = { source: 'unavailable', weeks: [], note: String(e.message ?? e) }; }
  if (gsc.tregError) notes.push(`GSC via treg failed, used VM fallback (${gsc.tregError})`);
  if (gsc.source === 'unavailable') notes.push(`GSC unavailable: ${gsc.note ?? 'unknown'}`);
  gsc.delta = gscDelta(gsc.weeks ?? []);
  log(`gsc source: ${gsc.source}`);

  // Include five weeks so +4w observations remain visible, even with no action this week.
  let actions = [];
  try { actions = await fetchLedgerOnVm({ since: new Date(now.getTime() - 35 * 86400000).toISOString() }); }
  catch { notes.push('Growth ledger unavailable this week.'); }

  // 5. Build + render
  const digestUrl = dryRun ? `${baseUrl}/lv-digest-${id}.html (dry run, not published)` : `${baseUrl}/lv-digest-${id}.html`;
  const model = buildModel({
    generatedAt: new Date().toISOString(),
    window, runs, posted, titles, queue, gsc, actions, notes,
    links: { digestUrl, repo: 'https://github.com/jonkthomas/libertyvillage' },
  });
  const html = renderHtml(model);
  const json = JSON.stringify(model, null, 1);

  if (dryRun) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join('/tmp', `lv-digest-${id}.html`), html);
    fs.writeFileSync(path.join('/tmp', `lv-digest-${id}.json`), json);
    log(`dry run: wrote /tmp/lv-digest-${id}.{html,json} (${html.length} bytes html)`);
    console.log(slackMessage(model));
    return 0;
  }

  // 6. Publish (spec-deck server dir; tailscale serves /decks -> 8787)
  fs.mkdirSync(outDir, { recursive: true });
  const htmlPath = path.join(outDir, `lv-digest-${id}.html`);
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(path.join(outDir, `lv-digest-${id}.json`), json);
  fs.writeFileSync(path.join(outDir, 'lv-digest-latest.json'), json);
  fs.writeFileSync(path.join(outDir, 'index.html'),
    renderIndex(fs.readdirSync(outDir)));
  log(`published ${htmlPath}`);

  // 7. Slack post (hermes; bot must be in the channel)
  let slackOk = true;
  if (!flag('--no-slack')) {
    try {
      const msg = slackMessage({ ...model, links: { ...model.links, digestUrl: `${baseUrl}/lv-digest-${id}.html` } });
      const out = execFileSync(HERMES, ['--profile', SLACK_PROFILE, 'send', '-t', SLACK_TARGET, '--json'], { input: msg, encoding: 'utf8', timeout: 60_000 });
      log(`slack: ${out.trim().slice(0, 200)}`);
    } catch (e) { slackOk = false; notes.push(`Slack post failed: ${String(e.message ?? e).slice(0, 200)}`); log(`slack FAILED: ${e.message}`); }
  }

  // 8. Push digest JSON to the VM for the fix-it agent
  let pushOk = true;
  if (!flag('--no-push')) {
    try {
      // Only the allowlisted public-safe projection crosses into the model's
      // filesystem. Keep the full analytics/diagnostics on the private Mac.
      const b64 = Buffer.from(JSON.stringify(agentInput(model)), 'utf8').toString('base64');
      await vmExec(`
set -e
if id lv-digest >/dev/null 2>&1; then
  printf '%s' '${b64}' | base64 -d | sudo install -m 0644 -o lv-digest -g lv-digest /dev/stdin ${VM_JSON_DIR}/lv-digest-latest.json
else
  echo 'lv-digest user missing (VM agent not installed)'
  exit 1
fi`, { timeoutMs: 60_000 });
      log(`pushed digest JSON to ${VM_HOST}:${VM_JSON_DIR}/lv-digest-latest.json`);
    } catch (e) { pushOk = false; notes.push(`VM JSON push failed: ${String(e.message ?? e).slice(0, 200)}`); log(`push FAILED: ${e.message}`); }
  }

  console.log(`digest: ${baseUrl}/lv-digest-${id}.html`);
  console.log(`notes: ${notes.length ? notes.join(' | ') : 'none'}`);
  return slackOk && pushOk ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
