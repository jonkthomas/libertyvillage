#!/usr/bin/env node
/**
 * Weekly Blog Pipeline - Claude Agent SDK Orchestrator
 * Runs autonomously to generate and publish a blog post for libertyvillage.co
 *
 * Usage:
 *   node scripts/weekly-blog-agent.js
 *
 * Environment variables:
 *   TOPIC_OVERRIDE   - Skip SEO analysis; generate a post about this topic
 *   DRY_RUN=true     - Do NOT commit changes; save output for review
 *   GOOGLE_APPLICATION_CREDENTIALS - Path to GCP service account JSON
 *   GA_PROPERTY_ID   - GA4 property ID
 *   GA4_CLIENT_EMAIL - GA4 service account email
 *   GA4_PRIVATE_KEY  - GA4 service account private key
 *   GITHUB_STEP_SUMMARY - GitHub Actions job summary file path
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'prompts', 'weekly-blog-system.md');
const RUN_LOG_DIR = path.join(PROJECT_ROOT, 'tasks', 'auto-blog-runs');

async function main() {
  // Dynamic import since the SDK is ESM and the project is CJS
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const startTime = Date.now();

  // Read system prompt
  if (!fs.existsSync(SYSTEM_PROMPT_PATH)) {
    console.error(`System prompt not found: ${SYSTEM_PROMPT_PATH}`);
    process.exit(1);
  }
  const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');

  // Build prompt with optional overrides
  let prompt = 'Execute the weekly blog pipeline. Follow the system prompt instructions step by step.';

  if (process.env.TOPIC_OVERRIDE) {
    prompt = `OVERRIDE: Skip SEO analysis and topic selection. Generate a blog post about: ${process.env.TOPIC_OVERRIDE}\n\n${prompt}`;
  }

  if (process.env.DRY_RUN === 'true') {
    prompt += '\n\nDRY RUN MODE: Do NOT commit changes. Save the generated post to tasks/auto-blog-dry-run.json for review.';
  }

  // Configure MCP servers
  const mcpServers = {
    gsc: {
      command: 'npx',
      args: ['-y', 'mcp-server-gsc'],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || './gcp-credentials.json'
      }
    },
    ga4: {
      command: 'npx',
      args: ['-y', 'mcp-server-google-analytics'],
      env: {
        GA4_PROPERTY_ID: process.env.GA_PROPERTY_ID || '',
        GA4_CLIENT_EMAIL: process.env.GA4_CLIENT_EMAIL || '',
        GA4_PRIVATE_KEY: process.env.GA4_PRIVATE_KEY || ''
      }
    },
    playwright: {
      command: 'npx',
      args: ['@playwright/mcp', '--headless'],
      env: {}
    }
  };

  console.log('=== Weekly Blog Pipeline ===');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Topic Override: ${process.env.TOPIC_OVERRIDE || 'none'}`);
  console.log(`Dry Run: ${process.env.DRY_RUN || 'false'}`);
  console.log('');

  const runLog = {
    date: new Date().toISOString(),
    success: false,
    costUsd: 0,
    turnsUsed: 0,
    durationMs: 0,
    topicSelected: null,
    postSlug: null,
    seoDataSummary: null,
    errors: []
  };

  try {
    const conversation = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-5-20250929',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 50,
        maxBudgetUsd: 2.0,
        systemPrompt,
        mcpServers,
        cwd: PROJECT_ROOT,
        persistSession: false
      }
    });

    // Use .next() loop to capture both yielded messages AND the generator return value.
    // A for-await-of loop discards the generator's return value, so we iterate manually.
    let resultMessage = null;
    let done = false;

    while (!done) {
      const step = await conversation.next();

      if (step.done) {
        // The generator returned — step.value is the return value (may contain final stats)
        if (step.value) {
          resultMessage = resultMessage || step.value;
        }
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
              const preview = text.substring(0, 200);
              console.log(`[agent] ${preview}${text.length > 200 ? '...' : ''}`);
            }
            const toolBlocks = (message.message?.content || [])
              .filter(block => block.type === 'tool_use');
            for (const tool of toolBlocks) {
              console.log(`[tool_use] ${tool.name}`);
            }
            break;
          }

          case 'result':
            resultMessage = message;
            break;

          default:
            // Skip noisy tool_progress messages; log others briefly
            if (message.type !== 'tool_progress') {
              console.log(`[${message.type}${message.subtype ? ':' + message.subtype : ''}]`);
            }
            break;
        }
      }
    }

    // Populate run log from result
    if (resultMessage) {
      runLog.costUsd = resultMessage.total_cost_usd || 0;
      runLog.turnsUsed = resultMessage.num_turns || 0;

      if (resultMessage.subtype === 'success') {
        runLog.success = true;
      } else {
        runLog.errors.push(`Agent ended with subtype: ${resultMessage.subtype}`);
        if (resultMessage.errors?.length) {
          runLog.errors.push(...resultMessage.errors);
        }
      }
    } else {
      runLog.errors.push('No result message received from SDK');
    }
  } catch (error) {
    console.error(`Pipeline error: ${error.message}`);
    runLog.errors.push(error.message);
  }

  runLog.durationMs = Date.now() - startTime;

  // Save run log
  fs.mkdirSync(RUN_LOG_DIR, { recursive: true });
  const logDate = new Date().toISOString().split('T')[0];
  const logPath = path.join(RUN_LOG_DIR, `${logDate}.json`);
  fs.writeFileSync(logPath, JSON.stringify(runLog, null, 2));

  console.log('');
  console.log('=== Pipeline Complete ===');
  console.log(`Success: ${runLog.success}`);
  console.log(`Cost: $${runLog.costUsd.toFixed(4)}`);
  console.log(`Turns: ${runLog.turnsUsed}`);
  console.log(`Duration: ${(runLog.durationMs / 1000).toFixed(1)}s`);
  console.log(`Log saved: ${logPath}`);

  // GitHub Actions step summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      '## Weekly Blog Pipeline Results',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Status | ${runLog.success ? 'Success' : 'Failed'} |`,
      `| Topic | ${runLog.topicSelected || 'N/A'} |`,
      `| Post Slug | ${runLog.postSlug || 'N/A'} |`,
      `| Cost | $${runLog.costUsd.toFixed(4)} |`,
      `| Turns | ${runLog.turnsUsed} |`,
      `| Duration | ${(runLog.durationMs / 1000).toFixed(1)}s |`,
      ''
    ].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }

  process.exit(runLog.success ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
