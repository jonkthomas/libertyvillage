// Test-only stand-in for Package B submit/gate. The real modules are not
// integrated. This prints the spec CLI contract: one JSON result on stdout and
// the module exit code on the process, including 2 and 3. It does not wrap
// that pair again. stats --alert reads SLACK_WEBHOOK_URL, not the draft name.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function unwrapModuleResult(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'result') && Object.prototype.hasOwnProperty.call(value, 'exitCode')) {
    return { result: value.result, exitCode: value.exitCode };
  }
  return { result: value, exitCode: 0 };
}

export function submitContent(mode = process.env.LV_STUB_SUBMIT || 'id') {
  if (mode === '2') return { result: { error: 'ValidationError', message: 'conflict' }, exitCode: 2 };
  if (mode === 'null') return { result: { submissionId: null, reason: 'no-changes' }, exitCode: 0 };
  return { result: { submissionId: 17, existing: false, items: [] }, exitCode: 0 };
}

export function gateContent(code = Number(process.env.LV_STUB_GATE || '0')) {
  return { result: { submissionId: 17, state: code === 2 ? 'blocked' : 'published' }, exitCode: code };
}

function argsAfterCli(argv) {
  const start = argv.findIndex((arg) => arg.endsWith('cli.mjs'));
  return start === -1 ? argv : argv.slice(start + 1);
}

function record(entry) {
  if (!process.env.LV_STUB_LOG) return;
  fs.appendFileSync(process.env.LV_STUB_LOG, `${JSON.stringify(entry)}\n`);
}

function emit(moduleReturn, command, rest) {
  const { result, exitCode } = unwrapModuleResult(moduleReturn);
  record({
    command,
    args: rest,
    exitCode,
    slack: process.env.SLACK_WEBHOOK_URL ?? null,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(exitCode);
}

function main() {
  const [command, ...rest] = argsAfterCli(process.argv.slice(2));
  if (command === 'export') emit({ snapshotId: 'snap', liveSeq: 1, files: [] }, command, rest);
  else if (command === 'submit') emit(submitContent(), command, rest);
  else if (command === 'gate') emit(gateContent(), command, rest);
  else if (command === 'list') {
    const rows = process.env.LV_STUB_LIST === 'open' ? [{ id: 4, kind: 'news', state: 'open', items: [] }] : [];
    emit(rows, command, rest);
  } else if (command === 'stats') {
    const projectBytes = Number(process.env.LV_STUB_BYTES || '0');
    const warn = projectBytes > 350 * 1024 * 1024;
    if (rest.includes('--alert') && warn && process.env.SLACK_WEBHOOK_URL) {
      record({
        command: 'stats-alert',
        slackText: `⚠ Neon content storage ${Math.round(projectBytes / 1048576)} MB > 350 MB of 512 MB`,
        usedDraftWebhook: Boolean(process.env.CONTENT_SLACK_WEBHOOK_URL) && !process.env.SLACK_WEBHOOK_URL,
      });
    }
    emit({ projectBytes, warn, databases: {}, assets: { count: 0, bytes: 0, reclaimable: 0 } }, command, rest);
  } else emit({ result: { error: 'Error', message: `unknown command: ${command}` }, exitCode: 1 }, command, rest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
