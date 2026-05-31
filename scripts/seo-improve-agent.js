#!/usr/bin/env node
/**
 * Weekly SEO/AEO Improvement Pipeline — multi-agent orchestrator.
 *
 *   BUILDER (invokes vendored SEO skills + GSC/GA4 MCP) -> edits site
 *   -> npm run build (gate) -> next start
 *   -> JUDGE (adversarial, scores 0-10) + READER (end-user, Playwright, scores 0-10)
 *   -> weighted overall score; if below threshold, ONE revise pass + re-score.
 *
 * Writes tasks/seo-improve-summary.md (PR body) and tasks/seo-scores.json
 * (consumed by the workflow for draft/label/Slack). Never pushes — CI opens a PR.
 *
 * Env: DRY_RUN, GOOGLE_APPLICATION_CREDENTIALS, GA_PROPERTY_ID,
 *      DATAFORSEO_LOGIN/PASSWORD, SERPER_API_KEY, GITHUB_STEP_SUMMARY
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const P = (f) => path.join(__dirname, 'prompts', f);
const SUMMARY_PATH = path.join(ROOT, 'tasks', 'seo-improve-summary.md');
const SCORES_PATH = path.join(ROOT, 'tasks', 'seo-scores.json');
const RUN_LOG_DIR = path.join(ROOT, 'tasks', 'seo-improve-runs');
const THRESHOLD = 8;       // overall must hit this to ship "ready"
const JUDGE_FLOOR = 7;     // AND the adversarial judge must clear this (it has veto;
                           // a page can't pass on reader polish while SEO substance is weak)
const isPassed = (j, overall) => overall >= THRESHOLD && (j?.overall ?? 0) >= JUDGE_FLOOR;
const DRY = process.env.DRY_RUN === 'true';

const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './gcp-credentials.json';
let gaEmail = '', gaKey = '';
try { const c = JSON.parse(fs.readFileSync(credsPath, 'utf8')); gaEmail = c.client_email || ''; gaKey = c.private_key || ''; } catch {}

const MCP = {
  gscGa4: {
    gsc: { command: 'npx', args: ['-y', 'mcp-server-gsc'], env: { GOOGLE_APPLICATION_CREDENTIALS: credsPath } },
    ga4: { command: 'npx', args: ['-y', 'mcp-server-google-analytics'], env: { GA_PROPERTY_ID: process.env.GA_PROPERTY_ID || '', GOOGLE_CLIENT_EMAIL: gaEmail, GOOGLE_PRIVATE_KEY: gaKey } }
  },
  playwright: {
    playwright: { command: 'npx', args: ['@playwright/mcp', '--headless', '--allow-unrestricted-file-access'], env: {} }
  }
};

let totalCost = 0;

async function runStage(label, opts) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const systemPrompt = fs.readFileSync(opts.systemPromptPath, 'utf8');
  console.log(`\n=== STAGE: ${label} ===`);
  const conversation = query({
    prompt: opts.prompt,
    options: {
      model: 'claude-sonnet-4-5-20250929',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: opts.maxTurns,
      maxBudgetUsd: opts.budget,
      systemPrompt,
      cwd: ROOT,
      persistSession: false,
      ...(opts.mcpServers ? { mcpServers: opts.mcpServers } : {}),
      ...(opts.settingSources ? { settingSources: opts.settingSources } : {}),
      ...(opts.skills ? { skills: opts.skills } : {})
    }
  });

  let result = null;
  const textChunks = [];
  let done = false;
  while (!done) {
    const step = await conversation.next();
    if (step.done) { if (step.value) result = result || step.value; done = true; continue; }
    const m = step.value;
    if (m.type === 'system' && m.subtype === 'init') {
      console.log(`[${label}] tools:${m.tools?.length || 0} skills:${(m.skills || []).length || 'n/a'} mcp:${(m.mcp_servers || []).map(s => s.name + '(' + s.status + ')').join(',')}`);
    } else if (m.type === 'assistant') {
      const txt = (m.message?.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
      if (txt) { textChunks.push(txt); console.log(`[${label}] ${txt.slice(0, 160)}${txt.length > 160 ? '…' : ''}`); }
      for (const t of (m.message?.content || []).filter(b => b.type === 'tool_use')) console.log(`[${label}:tool] ${t.name}`);
    } else if (m.type === 'result') { result = m; }
  }
  const cost = result?.total_cost_usd || 0;
  totalCost += cost;
  const success = result?.subtype === 'success';
  console.log(`[${label}] done — success:${success} cost:$${cost.toFixed(4)} turns:${result?.num_turns || 0}`);
  return { success, cost, turns: result?.num_turns || 0, text: textChunks.join('\n') };
}

function extractJson(text) {
  if (!text) return null;
  const fence = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]).pop();
  const candidate = fence || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

function changedContentFiles() {
  try {
    return execSync('git status --porcelain', { cwd: ROOT }).toString()
      .split('\n').map(l => l.slice(3).replace(/.* -> /, '')).filter(Boolean)
      .filter(f => !/^tasks\/seo-(improve-(summary\.md|runs\/)|scores\.json)/.test(f));
  } catch { return []; }
}

function startServer() {
  const srv = spawn('npx', ['next', 'start', '-p', '3000'], { cwd: ROOT, detached: true, stdio: 'ignore' });
  srv.unref();
  return srv;
}
function waitForPort(timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get('http://localhost:3000/', (res) => { res.destroy(); resolve(true); });
      req.on('error', () => { if (Date.now() - start > timeoutMs) resolve(false); else setTimeout(tick, 2000); });
    };
    tick();
  });
}

async function judge() {
  return runStage('JUDGE', {
    systemPromptPath: P('seo-judge-system.md'),
    prompt: 'Adversarially review the working-tree changes per your system prompt. Run git diff/status, read the changed files and tasks/seo-improve-summary.md, then output ONLY the scores JSON.',
    maxTurns: 40, budget: 1.5
  });
}
async function reader() {
  return runStage('READER', {
    systemPromptPath: P('seo-reader-system.md'),
    prompt: 'Review the changed pages as a real user via http://localhost:3000 using Playwright (screenshots, desktop + mobile). Output ONLY the scores JSON.',
    mcpServers: MCP.playwright, maxTurns: 50, budget: 2.0
  });
}
const weightedOverall = (j, r) => {
  const jo = j?.overall ?? 0, ro = r?.overall ?? 0;
  return Math.round((jo * 0.6 + ro * 0.4) * 10) / 10;
};

async function main() {
  const t0 = Date.now();
  const runLog = { date: new Date().toISOString(), dryRun: DRY, success: false, totalCostUsd: 0, errors: [] };
  let server = null;

  try {
    // 1) BUILDER — invokes vendored SEO skills
    const builder = await runStage('BUILDER', {
      systemPromptPath: P('seo-improve-system.md'),
      prompt: 'Execute the weekly SEO/AEO improvement pass per the system prompt. Invoke the relevant skills (on-page, schema-markup, geo-citability, internal-linker, seo-content, keyword-research) when they apply. ' + (DRY ? 'DRESS REHEARSAL (dry run): make your data-backed edits normally — they will NOT be committed or deployed (the runner is discarded). Ensure at least one concrete, justified edit so the judge and reader stages have something real to evaluate. Then write tasks/seo-improve-summary.md.' : ('Make data-backed edits within the hard rails, then write tasks/seo-improve-summary.md.' + (process.env.FORCE_EDIT === 'true' ? ' Even if wins look marginal this week, make at least one concrete, justified improvement so a reviewable PR is produced.' : ''))),
      mcpServers: MCP.gscGa4,
      settingSources: ['project'],
      skills: ['on-page', 'schema-markup', 'geo-citability', 'internal-linker', 'seo-content', 'keyword-research'],
      maxTurns: 110, budget: 4.0
    });
    if (!builder.success) runLog.errors.push('builder did not finish cleanly');

    // Full loop runs for BOTH real and dry runs (dry = dress rehearsal: edits
    // happen in the ephemeral runner, judge/reader/score all run, but the
    // workflow opens no PR and commits nothing). Only a true no-op skips review.
    if (changedContentFiles().length === 0) {
      console.log('No content changes — no-op. Skipping judge/reader.');
      runLog.success = true;
    } else {
      // 2) build gate
      console.log('\n=== BUILD GATE ===');
      execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
      // 3) serve for reader
      server = startServer();
      const up = await waitForPort();
      if (!up) { console.warn('server did not come up — reader will score 0 on visuals'); }

      // 4) judge + reader
      let j = extractJson((await judge()).text);
      let r = extractJson((await reader()).text);
      let overall = weightedOverall(j, r);
      console.log(`\nScore round 1 — judge:${j?.overall} reader:${r?.overall} overall:${overall}`);

      // 5) one revise loop if it doesn't clear the bar (overall >=8 AND judge >=7)
      let revised = false;
      if (!isPassed(j, overall)) {
        revised = true;
        const issues = JSON.stringify({ judge: j?.blocking_issues || [], judge_suggestions: j?.suggestions || [], reader_problems: r?.problems || [] }, null, 2);
        await runStage('REVISE', {
          systemPromptPath: P('seo-improve-system.md'),
          prompt: `Your prior changes scored ${overall}/10 overall with judge ${j?.overall} (bar: overall ≥${THRESHOLD} AND judge ≥${JUDGE_FLOOR}). The adversarial judge is the SEO-substance gate — address its blocking issues directly, don't just polish. Stay within the hard rails, then update tasks/seo-improve-summary.md:\n${issues}`,
          mcpServers: MCP.gscGa4, settingSources: ['project'],
          skills: ['on-page', 'schema-markup', 'geo-citability', 'internal-linker', 'seo-content', 'keyword-research'],
          maxTurns: 80, budget: 3.0
        });
        execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
        // restart server (content changed)
        try { process.kill(-server.pid); } catch {}
        server = startServer(); await waitForPort();
        j = extractJson((await judge()).text);
        r = extractJson((await reader()).text);
        overall = weightedOverall(j, r);
        console.log(`Score round 2 — judge:${j?.overall} reader:${r?.overall} overall:${overall}`);
      }

      const scores = {
        overall, threshold: THRESHOLD, judgeFloor: JUDGE_FLOOR, passed: isPassed(j, overall), revised,
        judge: j, reader: r, totalCostUsd: Math.round(totalCost * 100) / 100
      };
      fs.writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 2));

      // append scoreboard to the PR summary
      const board = [
        '', '---', '## Review scores',
        `**Overall: ${overall}/10** · judge ${j?.overall ?? '?'}/10 · reader ${r?.overall ?? '?'}/10 — bar: overall ≥${THRESHOLD} AND judge ≥${JUDGE_FLOOR} → ${scores.passed ? 'PASS (ready)' : 'BELOW BAR — opens as DRAFT'}${revised ? ' · revised once' : ''}`,
        '', '| Agent | Dimension scores | Overall |', '|---|---|---|',
        `| Adversarial judge | ${j ? Object.entries(j.scores || {}).map(([k, v]) => `${k} ${v}`).join(', ') : 'parse-failed'} | ${j?.overall ?? '?'} |`,
        `| End-user reader | ${r ? Object.entries(r.scores || {}).map(([k, v]) => `${k} ${v}`).join(', ') : 'parse-failed'} | ${r?.overall ?? '?'} |`,
        '',
        ...(j?.blocking_issues?.length ? ['**Judge blocking issues:**', ...j.blocking_issues.map(s => `- ${s}`), ''] : []),
        ...(r?.problems?.length ? ['**Reader problems:**', ...r.problems.map(s => `- ${s}`), ''] : [])
      ].join('\n');
      try { fs.appendFileSync(SUMMARY_PATH, board); } catch {}
      runLog.success = true;
      runLog.scores = scores;
    }
  } catch (e) {
    console.error('Orchestrator error:', e.message);
    runLog.errors.push(e.message);
  } finally {
    if (server) { try { process.kill(-server.pid); } catch {} }
  }

  if (!fs.existsSync(SUMMARY_PATH)) {
    fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
    fs.writeFileSync(SUMMARY_PATH, `# Weekly SEO Improvements — ${new Date().toISOString().split('T')[0]}\n\n## TL;DR\nNo summary written${runLog.errors.length ? ` (errors: ${runLog.errors.join('; ')})` : ''}.\n`);
  }
  runLog.totalCostUsd = Math.round(totalCost * 100) / 100;
  runLog.durationMs = Date.now() - t0;
  fs.mkdirSync(RUN_LOG_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_LOG_DIR, `${new Date().toISOString().split('T')[0]}.json`), JSON.stringify(runLog, null, 2));

  console.log(`\n=== Pipeline Complete === success:${runLog.success} totalCost:$${runLog.totalCostUsd} dur:${(runLog.durationMs / 1000).toFixed(0)}s`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## SEO pipeline\n- success: ${runLog.success}\n- overall score: ${runLog.scores?.overall ?? 'n/a'}\n- total cost: $${runLog.totalCostUsd}\n`);
  }
  process.exit(runLog.success ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
