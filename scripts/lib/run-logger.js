#!/usr/bin/env node
/**
 * Run logging utility for the weekly blog pipeline.
 * Saves structured JSON logs to tasks/auto-blog-runs/{date}.json
 */

const fs = require('fs');
const path = require('path');

const RUN_LOG_DIR = path.join(__dirname, '..', '..', 'tasks', 'auto-blog-runs');

/**
 * Create a new run log entry
 * @returns {Object} Empty run log template
 */
function createRunLog() {
  return {
    date: new Date().toISOString(),
    success: false,
    costUsd: 0,
    turnsUsed: 0,
    topicSelected: null,
    postSlug: null,
    seoDataSummary: null,
    errors: [],
    duration_ms: 0,
    model: 'claude-sonnet-4-5-20250929',
    dryRun: process.env.DRY_RUN === 'true',
    topicOverride: process.env.TOPIC_OVERRIDE || null
  };
}

/**
 * Save a run log to disk
 * @param {Object} runLog - The run log object
 * @returns {string} Path to saved log file
 */
function saveRunLog(runLog) {
  fs.mkdirSync(RUN_LOG_DIR, { recursive: true });
  const logDate = new Date().toISOString().split('T')[0];
  const logPath = path.join(RUN_LOG_DIR, `${logDate}.json`);

  // If a log already exists for today (retry), append a counter
  let finalPath = logPath;
  let counter = 1;
  while (fs.existsSync(finalPath)) {
    finalPath = path.join(RUN_LOG_DIR, `${logDate}-${counter}.json`);
    counter++;
  }

  fs.writeFileSync(finalPath, JSON.stringify(runLog, null, 2));
  return finalPath;
}

/**
 * Write GitHub Actions step summary
 * @param {Object} runLog - The run log object
 */
function writeGitHubSummary(runLog) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;

  const summary = [
    '## Weekly Blog Pipeline Results',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Status | ${runLog.success ? '✅ Success' : '❌ Failed'} |`,
    `| Topic | ${runLog.topicSelected || 'N/A'} |`,
    `| Post Slug | ${runLog.postSlug || 'N/A'} |`,
    `| Cost | $${runLog.costUsd.toFixed(4)} |`,
    `| Turns | ${runLog.turnsUsed} |`,
    `| Duration | ${(runLog.duration_ms / 1000).toFixed(1)}s |`,
    `| Dry Run | ${runLog.dryRun ? 'Yes' : 'No'} |`,
    '',
    runLog.errors.length > 0 ? `### Errors\n${runLog.errors.map(e => `- ${e}`).join('\n')}` : '',
    ''
  ].join('\n');

  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

module.exports = { createRunLog, saveRunLog, writeGitHubSummary };
