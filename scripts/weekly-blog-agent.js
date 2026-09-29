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

// This entrypoint is CommonJS so it can run under the isolated generator's Node runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const listBlogImages = (root) => {
  const dir = path.join(root, "public", "images", "blog");
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".jpg") && fs.statSync(path.join(dir, name)).isFile() && fs.statSync(path.join(dir, name)).size > 10_000).map((name) => `/images/blog/${name}`)
    : [];
};

function classifyStopReason({ written, lastAssistantText, errors }) {
  if (written) return "post-written";
  if (errors.length) return "sdk-error";
  const text = lastAssistantText.toLowerCase();
  if (
    /grounding|unsupported|unverifiable/.test(text) &&
    /halt|stop|cannot|refus/.test(text)
  )
    return "unsupported-grounding";
  if (/duplicate|overlap/.test(text) && /halt|stop|cannot|refus/.test(text))
    return "duplicate";
  if (/insufficient|no (?:credible )?sources|no evidence/.test(text))
    return "insufficient-sources";
  return "no-post-unspecified";
}

async function runPipeline({ query, env = process.env, root = PROJECT_ROOT, now = new Date() }) {
  // The source-pack module is ESM; this entrypoint remains CommonJS for the runner.
  const { buildSourcePack, canonicalJson, checkDraftAgainstPack } = await import("./automation/blog-source-pack.mjs");
  const startTime = Date.now();
  const systemPromptPath = path.join(root, "scripts", "prompts", "weekly-blog-system.md");
  const runLogDir = path.join(root, "tasks", "auto-blog-runs");
  let sourcePack = null;
  let sourcePackPath = null;

  // Read system prompt
  if (!fs.existsSync(systemPromptPath)) throw new Error(`System prompt not found: ${systemPromptPath}`);
  const systemPrompt = fs.readFileSync(systemPromptPath, "utf8");
  const postsPath = path.join(root, "data", "posts.json");
  const originalPostsText = fs.readFileSync(postsPath, "utf8");
  const exportedPosts = JSON.parse(originalPostsText);
  const businesses = readJson(path.join(root, "data", "businesses.json"));
  const services = readJson(path.join(root, "data", "services.json"));
  const topics = readJson(path.join(root, "data", "topics.json"));
  const originalSlugs = new Set(exportedPosts.map((post) => post.slug));

  // Build prompt with optional overrides
  let prompt =
    "Execute the weekly blog pipeline. Follow the system prompt instructions step by step.";

  if (env.TOPIC_OVERRIDE) {
    prompt = `OVERRIDE: Skip SEO analysis and topic selection. Generate a blog post about: ${env.TOPIC_OVERRIDE}\n\n${prompt}`;
  }

  if (env.DRY_RUN === "true") {
    prompt +=
      "\n\nDRY RUN MODE: Do NOT commit changes. Save the generated post to tasks/auto-blog-dry-run.json for review.";
  }

  // Load GA4 credentials from the service-account JSON file directly,
  // so secrets never need to be exported as workflow env vars (and never
  // appear in step-banner env dumps). The upstream MCP server reads
  // GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY / GA_PROPERTY_ID.
  const credsPath = env.GOOGLE_APPLICATION_CREDENTIALS || "./gcp-credentials.json";
  let gaClientEmail = "";
  let gaPrivateKey = "";
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    gaClientEmail = creds.client_email || "";
    gaPrivateKey = creds.private_key || "";
  } catch (err) {
    console.warn(
      `[warn] Could not read GA credentials at ${credsPath}: ${err.message}`,
    );
  }

  const mcpServers = {
    gsc: {
      command: "npx",
      args: ["-y", "mcp-server-gsc"],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: credsPath,
      },
    },
    ga4: {
      command: "npx",
      args: ["-y", "mcp-server-google-analytics"],
      env: {
        GA_PROPERTY_ID: env.GA_PROPERTY_ID || "",
        GOOGLE_CLIENT_EMAIL: gaClientEmail,
        GOOGLE_PRIVATE_KEY: gaPrivateKey,
      },
    },
    playwright: {
      command: "npx",
      args: [
        "@playwright/mcp",
        "--headless",
        "--allow-unrestricted-file-access",
      ],
      env: {},
    },
  };

  console.log("=== Weekly Blog Pipeline ===");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Topic Override: ${env.TOPIC_OVERRIDE || "none"}`);
  console.log(`Dry Run: ${env.DRY_RUN || "false"}`);
  console.log("");

  const runLog = {
    date: new Date(now).toISOString(),
    success: false,
    costUsd: 0,
    turnsUsed: 0,
    durationMs: 0,
    topicSelected: null,
    postSlug: null,
    seoDataSummary: null,
    postWritten: false,
    stopReason: "pending",
    errors: [],
  };

  try {
    if (env.TOPIC_OVERRIDE) {
      const result = buildSourcePack({ topic: env.TOPIC_OVERRIDE, businesses, posts: exportedPosts, services, topics, images: listBlogImages(root), now });
      if (!result.ok) {
        runLog.stopReason = result.reason;
        runLog.errors.push(`${result.reason}: ${result.premise?.join(', ') || 'directory evidence unavailable'} (${result.supportingRecords ?? 0} supporting records)`);
      } else {
        const pack = result.pack;
        sourcePack = pack;
        runLog.sourcePack = pack.fingerprint;
        fs.mkdirSync(runLogDir, { recursive: true });
        const sidecar = path.join(runLogDir, `${new Date(now).toISOString().slice(0, 10)}-${pack.fingerprint.slice(6)}-source-pack.json`);
        fs.writeFileSync(sidecar, `${canonicalJson(pack)}\n`);
        sourcePackPath = sidecar;
        prompt += `\n\nSOURCE PACK (first-party directory export; use only these records for local facts):\n${canonicalJson(pack)}\n\nA two-business article is allowed when exactly two records support the topic. Keep the article narrow. Attribute each business fact in the same sentence with its exact name or /directory/<slug> link. Verbatim spans are evidence of what the record says, not proof that an offer, hours, or policy remains current. Do not claim current availability, pricing, or policies. Do not add any local fact outside this pack. Use only listed internal slugs. Write the selected topic only; never switch topics. Run the existing blog linter before handoff. If this pack is insufficient, refuse the draft.`;
        const ambiguous = pack.sources.filter((source) => businesses.filter((record) => record.name === source.name).length > 1);
        if (ambiguous.length) prompt += `\n\nAMBIGUOUS DIRECTORY NAMES: ${ambiguous.map((source) => `${source.name} must be attributed as [${source.name.split(/\s+/)[0]}](/directory/${source.id}); avoid its full recorded name anywhere in the post because another record shares it but does not support this topic`).join(' ')}. The exact directory slug disambiguates the evidence.`;
      }
    }
    if (runLog.stopReason !== "pending") return finish();
    const conversation = query({
      prompt,
      options: {
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 75,
        // Headroom: clean runs land ~$2.01-$2.05, so a $2.00 cap tripped every
        // run since 2026-05-20 (exited non-zero even after the post completed).
        maxBudgetUsd: 3.5,
        systemPrompt,
        mcpServers,
        cwd: root,
        persistSession: false,
      },
    });

    // Use .next() loop to capture both yielded messages AND the generator return value.
    // A for-await-of loop discards the generator's return value, so we iterate manually.
    let resultMessage = null;
    let lastAssistantText = "";
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
          case "system":
            if (message.subtype === "init") {
              console.log(
                `[init] Model: ${message.model}, Tools: ${message.tools?.length || 0}`,
              );
              if (message.mcp_servers?.length) {
                console.log(
                  `[init] MCP: ${message.mcp_servers.map((s) => `${s.name}(${s.status})`).join(", ")}`,
                );
              }
            }
            break;

          case "assistant": {
            const textBlocks = (message.message?.content || [])
              .filter((block) => block.type === "text")
              .map((block) => block.text);
            if (textBlocks.length > 0) {
              const text = textBlocks.join(" ");
              lastAssistantText = text;
              const preview = text.replace(/\s+/g, " ").substring(0, 200);
              console.log(
                `[agent] ${preview}${text.length > 200 ? "..." : ""}`,
              );
            }
            const toolBlocks = (message.message?.content || []).filter(
              (block) => block.type === "tool_use",
            );
            for (const tool of toolBlocks) {
              console.log(`[tool_use] ${tool.name}`);
            }
            break;
          }

          case "result":
            resultMessage = message;
            break;

          default:
            // Skip noisy tool_progress messages; log others briefly
            if (message.type !== "tool_progress") {
              console.log(
                `[${message.type}${message.subtype ? ":" + message.subtype : ""}]`,
              );
            }
            break;
        }
      }
    }

    // Populate run log from result
    if (resultMessage) {
      runLog.costUsd = resultMessage.total_cost_usd || 0;
      runLog.turnsUsed = resultMessage.num_turns || 0;

      if (resultMessage.subtype === "success") {
        runLog.success = true;
      } else {
        runLog.errors.push(
          `Agent ended with subtype: ${resultMessage.subtype}`,
        );
        if (resultMessage.errors?.length) {
          runLog.errors.push(...resultMessage.errors);
        }
      }
    } else {
      runLog.errors.push("No result message received from SDK");
    }
    const generatedPosts = readJson(postsPath);
    const newPosts = Array.isArray(generatedPosts) ? generatedPosts.filter((post) => typeof post.slug === "string" && post.slug && !originalSlugs.has(post.slug)) : [];
    runLog.postWritten = Array.isArray(generatedPosts) && generatedPosts.length === exportedPosts.length + 1 && newPosts.length === 1 && exportedPosts.every((post, index) => JSON.stringify(post) === JSON.stringify(generatedPosts[index]));
    if (runLog.postWritten && env.TOPIC_OVERRIDE) {
      const currentBusinesses = readJson(path.join(root, "data", "businesses.json"));
      const currentServices = readJson(path.join(root, "data", "services.json"));
      const currentTopics = readJson(path.join(root, "data", "topics.json"));
      const checked = checkDraftAgainstPack(newPosts[0], sourcePack, { businesses: currentBusinesses, posts: exportedPosts, services: currentServices, topics: currentTopics, imagePaths: listBlogImages(root), now });
      if (!fs.existsSync(sourcePackPath) || fs.readFileSync(sourcePackPath, "utf8") !== `${canonicalJson(sourcePack)}\n`) {
        checked.errors.push("source-pack-sidecar-changed");
        fs.writeFileSync(sourcePackPath, `${canonicalJson(sourcePack)}\n`);
      }
      checked.ok = checked.errors.length === 0;
      if (!checked.ok) {
        fs.writeFileSync(postsPath, originalPostsText);
        runLog.postWritten = false;
        runLog.success = false;
        runLog.stopReason = "pre-submit-refused";
        runLog.errors.push(...checked.errors.slice(0, 20));
      }
    }
    if (!runLog.postWritten && fs.readFileSync(postsPath, "utf8") !== originalPostsText) fs.writeFileSync(postsPath, originalPostsText);
    if (runLog.postWritten) {
      runLog.topicSelected = env.TOPIC_OVERRIDE || newPosts[0].title;
      runLog.postSlug = newPosts[0].slug;
    }
    if (runLog.stopReason === "pending") runLog.stopReason = classifyStopReason({
      written: runLog.postWritten,
      lastAssistantText,
      errors: runLog.errors,
    });
  } catch (error) {
    console.error(`Pipeline error: ${error.message}`);
    runLog.errors.push(error.message);
    runLog.stopReason = "generator-error";
    runLog.success = false;
    fs.writeFileSync(postsPath, originalPostsText);
    if (sourcePack && sourcePackPath) fs.writeFileSync(sourcePackPath, `${canonicalJson(sourcePack)}\n`);
  }

  return finish();

  function finish() {
    runLog.durationMs = Date.now() - startTime;

    // Save run log
    fs.mkdirSync(runLogDir, { recursive: true });
    const logDate = new Date(now).toISOString().split("T")[0];
    const logPath = path.join(runLogDir, `${logDate}.json`);
    fs.writeFileSync(logPath, JSON.stringify(runLog, null, 2));

    console.log("");
    console.log("=== Pipeline Complete ===");
    console.log(`Success: ${runLog.success}`);
    // Fixed-vocabulary outcome: the root helper can persist this without candidate text.
    console.log(
      `[outcome] ${JSON.stringify({ postWritten: runLog.postWritten, stopReason: runLog.stopReason })}`,
    );
    console.log(`Cost: $${runLog.costUsd.toFixed(4)}`);
    console.log(`Turns: ${runLog.turnsUsed}`);
    console.log(`Duration: ${(runLog.durationMs / 1000).toFixed(1)}s`);
    console.log(`Log saved: ${logPath}`);

    // GitHub Actions step summary
    if (env.GITHUB_STEP_SUMMARY) {
      const summary = [
        "## Weekly Blog Pipeline Results",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        `| Status | ${runLog.success ? "Success" : "Failed"} |`,
        `| Topic | ${runLog.topicSelected || "N/A"} |`,
        `| Post Slug | ${runLog.postSlug || "N/A"} |`,
        `| Cost | $${runLog.costUsd.toFixed(4)} |`,
        `| Turns | ${runLog.turnsUsed} |`,
        `| Duration | ${(runLog.durationMs / 1000).toFixed(1)}s |`,
        "",
      ].join("\n");
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
    }
    return runLog;
  }
}

async function main() {
  // Dynamic import since the SDK is ESM and the project is CJS.
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const result = await runPipeline({ query });
  process.exit(result.postWritten && result.stopReason === "post-written" ? 0 : 1);
}

module.exports = { classifyStopReason, runPipeline };
if (require.main === module)
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
