#!/usr/bin/env node

/**
 * US-001: Claude Agent SDK verification spike
 *
 * Verifies the Claude Agent SDK works end-to-end with MCP servers.
 * Calls query() with a simple prompt to read data/posts.json and count posts.
 */

async function main() {
  // Dynamic import since the SDK is ESM and the project is CJS
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  console.log('=== Claude Agent SDK Verification Spike ===\n');
  console.log('Starting SDK query...');
  const startTime = Date.now();

  const conversation = query({
    prompt: 'Read data/posts.json and tell me how many posts exist',
    options: {
      model: 'claude-sonnet-4-5-20250929',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
      maxBudgetUsd: 0.50,
      persistSession: false,
      cwd: '/workspace/libertyvillage',
      systemPrompt: 'You are a test agent verifying SDK functionality. Read the requested file and answer concisely.',
      mcpServers: {
        gsc: {
          command: 'npx',
          args: ['-y', 'mcp-server-gsc'],
          env: {
            GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || './gcp-credentials.json',
          },
        },
        ga4: {
          command: 'npx',
          args: ['-y', 'mcp-server-google-analytics'],
          env: {
            GA4_PROPERTY_ID: process.env.GA_PROPERTY_ID || '523614078',
            GA4_CLIENT_EMAIL: process.env.GA4_CLIENT_EMAIL || '',
            GA4_PRIVATE_KEY: process.env.GA4_PRIVATE_KEY || '',
          },
        },
      },
    },
  });

  let resultMessage = null;

  try {
    for await (const message of conversation) {
      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            console.log(`  [init] Claude Code v${message.claude_code_version}, model: ${message.model}`);
            console.log(`  [init] Tools: ${message.tools.length} available`);
            console.log(`  [init] MCP servers: ${message.mcp_servers.map(s => `${s.name}(${s.status})`).join(', ') || 'none'}`);
          }
          break;

        case 'assistant':
          // Extract text from the assistant message content blocks
          const textBlocks = (message.message?.content || [])
            .filter(block => block.type === 'text')
            .map(block => block.text);
          if (textBlocks.length > 0) {
            console.log(`  [assistant] ${textBlocks.join(' ').substring(0, 200)}`);
          }
          // Log tool use blocks
          const toolUseBlocks = (message.message?.content || [])
            .filter(block => block.type === 'tool_use');
          for (const tool of toolUseBlocks) {
            console.log(`  [tool_use] ${tool.name}`);
          }
          break;

        case 'result':
          resultMessage = message;
          break;

        default:
          // Log other message types briefly
          if (message.type === 'tool_progress') {
            // Skip noisy progress messages
          } else {
            console.log(`  [${message.type}${message.subtype ? ':' + message.subtype : ''}]`);
          }
          break;
      }
    }
  } catch (err) {
    console.error(`\nError during conversation iteration: ${err.message}`);
    if (!resultMessage) {
      process.exit(1);
    }
  }

  const wallDuration = Date.now() - startTime;

  console.log('\n=== Results ===\n');

  if (!resultMessage) {
    console.error('ERROR: No result message received from SDK');
    process.exit(1);
  }

  if (resultMessage.subtype === 'success') {
    console.log('Status: SUCCESS');
    console.log(`Result: ${resultMessage.result}`);
    console.log(`Total cost: $${resultMessage.total_cost_usd.toFixed(4)}`);
    console.log(`Num turns: ${resultMessage.num_turns}`);
    console.log(`Duration (API): ${resultMessage.duration_ms}ms`);
    console.log(`Duration (wall): ${wallDuration}ms`);
    console.log(`Stop reason: ${resultMessage.stop_reason}`);

    // Log per-model usage
    if (resultMessage.modelUsage) {
      console.log('\nModel Usage:');
      for (const [model, usage] of Object.entries(resultMessage.modelUsage)) {
        console.log(`  ${model}: input=${usage.inputTokens}, output=${usage.outputTokens}, cache_read=${usage.cacheReadInputTokens}, cost=$${usage.costUSD.toFixed(4)}`);
      }
    }

    console.log('\nVerification: PASSED');
    process.exit(0);
  } else {
    console.error(`Status: ERROR (${resultMessage.subtype})`);
    console.error(`Errors: ${(resultMessage.errors || []).join(', ')}`);
    console.error(`Total cost: $${resultMessage.total_cost_usd.toFixed(4)}`);
    console.error(`Num turns: ${resultMessage.num_turns}`);
    console.error(`Duration (API): ${resultMessage.duration_ms}ms`);
    console.error(`Duration (wall): ${wallDuration}ms`);

    if (resultMessage.permission_denials?.length > 0) {
      console.error(`Permission denials: ${resultMessage.permission_denials.map(d => d.tool_name).join(', ')}`);
    }

    console.error('\nVerification: FAILED');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
