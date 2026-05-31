#!/usr/bin/env node
/**
 * Weekly SEO/AEO Improvement Pipeline - Claude Agent SDK Orchestrator
 * Analyzes GSC performance and makes data-backed on-site improvements that a
 * human reviews as a PR. Mirrors weekly-blog-agent.js but opens a PR (CI does
 * the branch/commit/PR), never pushes to main.
 *
 * Usage: node scripts/seo-improve-agent.js
 *
 * Env:
 *   DRY_RUN=true                    - analyze + summarize, make NO file edits
 *   GOOGLE_APPLICATION_CREDENTIALS  - path to GCP service account JSON (GSC/GA4)
 *   GA_PROPERTY_ID                  - GA4 property ID
 *   DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD - optional DataForSEO REST creds
 *   GITHUB_STEP_SUMMARY             - GitHub Actions job summary file path
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'prompts', 'seo-improve-system.md');
const RUN_LOG_DIR = path.join(PROJECT_ROOT, 'tasks', 'seo-improve-runs');
const SUMMARY_PATH = path.join(PROJECT_ROOT, 'tasks', 'seo-improve-summary.md');

async function main() {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const startTime = Date.now();

  if (!fs.existsSync(SYSTEM_PROMPT_PATH)) {
    console.error(`System prompt not found: ${SYSTEM_PROMPT_PATH}`);
    process.exit(1);
  }
  const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');

  let prompt = 'Execute the weekly SEO/AEO improvement pass. Follow the system prompt step by step: pull GSC data, diagnose the highest-leverage opportunities, make data-backed edits within the hard rails, run the build, and write tasks/seo-improve-summary.md.';
  if (process.env.DRY_RUN === 'true') {
    prompt += '\n\nDRY RUN MODE: Do NOT edit any source/data files. Only analyze and write tasks/seo-improve-summary.md describing what you WOULD change.';
  }

  // Read GA creds directly from the service-account file (never via env dumps).
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './gcp-credentials.json';
  let gaClientEmail = '';
  let gaPrivateKey = '';
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    gaClientEmail = creds.client_email || '';
    gaPrivateKey = creds.private_key || '';
  } catch (err) {
    console.warn(`[warn] Could not read GA credentials at ${credsPath}: ${err.message}`);
  }

  const mcpServers = {
    gsc: {
      command: 'npx',
      args: ['-y', 'mcp-server-gsc'],
      env: { GOOGLE_APPLICATION_CREDENTIALS: credsPath }
    },
    ga4: {
      command: 'npx',
      args: ['-y', 'mcp-server-google-analytics'],
      env: {
        GA_PROPERTY_ID: process.env.GA_PROPERTY_ID || '',
        GOOGLE_CLIENT_EMAIL: gaClientEmail,
        GOOGLE_PRIVATE_KEY: gaPrivateKey
      }
    }
  };

  console.log('=== Weekly SEO Improvement Pipeline ===');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Dry Run: ${process.env.DRY_RUN || 'false'}`);
  console.log('');

  const runLog = {
    date: new Date().toISOString(),
    success: false,
    costUsd: 0,
    turnsUsed: 0,
    durationMs: 0,
    dryRun: process.env.DRY_RUN === 'true',
    errors: []
  };

  try {
    const conversation = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-5-20250929',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 110,
        // Broad scope = more analysis + edits + a build. Start with real headroom
        // (the blog agent's $2.0 cap caused weeks of failures); cost still bounded.
        maxBudgetUsd: 5.0,
        systemPrompt,
        mcpServers,
        cwd: PROJECT_ROOT,
        persistSession: false
      }
    });

    let resultMessage = null;
    let done = false;
    while (!done) {
      const step = await conversation.next();
      if (step.done) {
        if (step.value) resultMessage = resultMessage || step.value;
        done = true;
      } else {
        const message = step.value;
        switch (message.type) {
          case 'system':
            if (message.subtype === 'init') {
              console.log(`[init] Model: ${message.model}, Tools: ${message.tools?.length || 0}`);
              if (message.mcp_servers?.length) {
                console.log(`[init] MCP: ${message.mcp_servers.map(s => `${s.name}(${s.status})`).join(', ')}`);
              }
            }
            break;
          case 'assistant': {
            const textBlocks = (message.message?.content || [])
              .filter(block => block.type === 'text')
              .map(block => block.text);
            if (textBlocks.length > 0) {
              const text = textBlocks.join(' ');
              console.log(`[agent] ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
            }
            for (const tool of (message.message?.content || []).filter(b => b.type === 'tool_use')) {
              console.log(`[tool_use] ${tool.name}`);
            }
            break;
          }
          case 'result':
            resultMessage = message;
            break;
          default:
            if (message.type !== 'tool_progress') {
              console.log(`[${message.type}${message.subtype ? ':' + message.subtype : ''}]`);
            }
            break;
        }
      }
    }

    if (resultMessage) {
      runLog.costUsd = resultMessage.total_cost_usd || 0;
      runLog.turnsUsed = resultMessage.num_turns || 0;
      if (resultMessage.subtype === 'success') {
        runLog.success = true;
      } else {
        runLog.errors.push(`Agent ended with subtype: ${resultMessage.subtype}`);
        if (resultMessage.errors?.length) runLog.errors.push(...resultMessage.errors);
      }
    } else {
      runLog.errors.push('No result message received from SDK');
    }
  } catch (error) {
    console.error(`Pipeline error: ${error.message}`);
    runLog.errors.push(error.message);
  }

  runLog.durationMs = Date.now() - startTime;

  // Ensure a summary always exists for the PR body / Slack, even on failure.
  if (!fs.existsSync(SUMMARY_PATH)) {
    fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
    fs.writeFileSync(
      SUMMARY_PATH,
      `# Weekly SEO Improvements — ${new Date().toISOString().split('T')[0]}\n\n` +
      `## TL;DR\nNo summary was written by the agent` +
      `${runLog.errors.length ? ` (errors: ${runLog.errors.join('; ')})` : ''}.\n`
    );
  }

  fs.mkdirSync(RUN_LOG_DIR, { recursive: true });
  const logDate = new Date().toISOString().split('T')[0];
  fs.writeFileSync(path.join(RUN_LOG_DIR, `${logDate}.json`), JSON.stringify(runLog, null, 2));

  console.log('');
  console.log('=== Pipeline Complete ===');
  console.log(`Success: ${runLog.success}`);
  console.log(`Cost: $${runLog.costUsd.toFixed(4)}`);
  console.log(`Turns: ${runLog.turnsUsed}`);
  console.log(`Duration: ${(runLog.durationMs / 1000).toFixed(1)}s`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '## Weekly SEO Improvement Results',
      '',
      `| Status | ${runLog.success ? 'Success' : 'Failed'} |`,
      '|--------|-------|',
      `| Cost | $${runLog.costUsd.toFixed(4)} |`,
      `| Turns | ${runLog.turnsUsed} |`,
      `| Dry run | ${runLog.dryRun} |`,
      ''
    ].join('\n'));
  }

  process.exit(runLog.success ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
