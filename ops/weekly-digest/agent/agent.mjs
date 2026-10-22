#!/usr/bin/env node
// Liberty Village weekly fix-it agent — runs ON the lv-content-runner VM as the
// non-root `lv-digest` user (systemd: lv-digest-agent.service/timer, Monday
// 09:00 America/Toronto, after the 08:00 digest). It has NO access to
// /etc/lv-runner*.env (root:root 0600) and NEVER re-runs loops, merges, deploys
// or writes production data. It only feeds the weekly digest JSON to a
// headless pi run whose job is: file GitHub issues (label lv-digest-agent) and
// open DRAFT PRs on jonkthomas/libertyvillage (base staging) for John to review.
//
//   node /opt/lv-digest-agent/agent.mjs [--dry-run] [--json PATH]
//
// Dry-run (default until a GitHub token is installed): the pi run prints the
// issues/PRs it WOULD file and makes no GitHub calls.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME_DIR = '/var/lib/lv-digest';
const REPO = 'jonkthomas/libertyvillage';
const LABEL = 'lv-digest-agent';
const MAX_ISSUES = 3;
const MAX_PRS = 3;
const PI_BIN = process.env.PI_BIN || '/usr/local/bin/pi';
const GH_BIN = '/usr/local/bin/gh';
const REPO_URL = 'https://github.com/jonkthomas/libertyvillage.git';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || !process.env.GH_TOKEN;
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1]
  : path.join(HOME_DIR, 'lv-digest-latest.json');
const logsDir = path.join(HOME_DIR, 'agent-logs');
fs.mkdirSync(logsDir, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);

function prompt(digestJson, openIssues) {
  const week = digestJson?.window
    ? `${digestJson.window.from?.slice(0, 10)} → ${digestJson.window.to?.slice(0, 10)}` : 'unknown';
  return `You are the Liberty Village weekly fix-it agent. Input: the weekly content-loops digest JSON for ${week} (embedded at the end).

Your job: turn this week's failures and anomalies into (a) GitHub issues and (b) draft pull requests on ${REPO} that a human (John) will review.

STRICT AUTHORITY RULES — violating any of these is a critical failure:
- NEVER merge, close, deploy, push to protected branches (main/staging), or re-run any content loop.
- NEVER touch lv-runner systemd units, /etc/lv-runner.hold, /etc/lv-runner*.env, production data or production databases.
- NEVER write to production Neon or Vercel. This VM has NO production credentials for you — keep it that way.
- ONLY: file NEW issues (label: ${LABEL}) and open DRAFT PRs (base: staging, draft: true) on ${REPO}.
- Hard caps per run: at most ${MAX_ISSUES} issues and ${MAX_PRS} PRs. Quality over quantity; fewer is fine.
- Dedupe: issues already open with label ${LABEL} are listed below — do NOT refile them; at most add a brief comment with new evidence if your finding materially extends one.

WORKFLOW:
1. Read the digest JSON: failures[] (reasons, log files), runs[], queue (hold state), posted[] and gsc stats.
2. Rate each finding P0 / P1 / P2 (P0 = breaks the core flow now; P1 = wrong behavior John would notice; P2 = hardening). Use your judgment from the digest evidence only — do not invent.
3. For each finding you act on: file an issue with title \`[digest <date>] <short problem>\`, the P-rating, the digest evidence (log lines/reasons verbatim), and a concrete suggested fix.
4. ONLY for P0/P1 findings whose fix is small and clear: clone ${REPO_URL} shallow into ${HOME_DIR}/repo (public, no token needed to clone), create branch digest/<yyyy-mm-dd>-<slug>, write the minimal fix, commit, push (credential helper is configured), and open a DRAFT PR (base staging). Keep diffs minimal. Run any cheap repo checks you can (read package.json scripts) but do NOT run next build or dev servers.
5. P2 findings: mention them inside a single P2 round-up issue (or an existing one) — never open a PR for P2.

${dryRun ? `DRY-RUN MODE (no GitHub token / --dry-run): DO NOT call any GitHub API, do NOT push, do NOT create issues/PRs. Instead print, for each planned action: ACTION: issue|pr | P-rating | title | body summary | evidence. End with a one-line summary count.` : `REAL MODE: use ${GH_BIN} (GH_TOKEN env is set) for issues/comments/PRs, and git with the configured credential helper for pushes. Print the URL of everything you created.`}

ALREADY-OPEN ${LABEL} ISSUES (do not refile):
${openIssues.length ? openIssues.map((i) => `- #${i.number} ${i.title}`).join('\n') : '- none'}

DIGEST JSON:
\`\`\`json
${JSON.stringify(digestJson, null, 1)}
\`\`\``;
}

// ── main ─────────────────────────────────────────────────────────────────────
let digest;
try {
  digest = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  log(`no readable digest at ${jsonPath} (${e.message}) — nothing to do`);
  process.exit(0); // not an error: digest job may not have run yet
}
const week = digest?.window?.to?.slice(0, 10) ?? 'unknown';

// Dedupe list (real mode only; dry-run makes no GitHub calls).
let openIssues = [];
if (!dryRun) {
  const r = spawnSync(GH_BIN, ['issue', 'list', '-R', REPO, '--label', LABEL, '--state', 'open',
    '--json', 'number,title', '--limit', '50'], { encoding: 'utf8', timeout: 60_000 });
  if (r.status === 0) {
    try { openIssues = JSON.parse(r.stdout); } catch { /* tolerate */ }
  } else {
    log(`warning: could not list open issues (${r.stderr?.slice(0, 120)}); proceeding without dedupe list`);
  }
}

const promptText = prompt(digest, openIssues);
const promptFile = path.join(os.tmpdir(), 'lv-digest-prompt.md');
fs.writeFileSync(promptFile, promptText);

log(`mode: ${dryRun ? 'DRY-RUN' : 'real'} · digest week ends ${week} · prompt ${promptText.length} bytes`);

// pi -p with the prompt file; 45 min hard cap.
const t0 = Date.now();
const run = spawnSync(PI_BIN, ['-p', `@${promptFile}`], {
  encoding: 'utf8', timeout: 45 * 60_000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, HOME: HOME_DIR },
});
const secs = Math.round((Date.now() - t0) / 1000);
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();

const logFile = path.join(logsDir, `agent-${week}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
fs.writeFileSync(logFile, `prompt: ${promptFile}\nexit: ${run.status}\nseconds: ${secs}\n\n${output}\n`);
log(`pi exit ${run.status} after ${secs}s · log: ${logFile}`);

if (run.status !== 0) {
  console.error(output.slice(-4000));
  process.exit(run.status ?? 1);
}
console.log(output);
try { fs.unlinkSync(promptFile); } catch { /* tmp cleanup best-effort */ }
