import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KIND_POLICIES } from '../../scripts/automation/constants.mjs';
import { validatePaths } from '../../scripts/automation/policy.mjs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/autonomous-coordinator.yml', import.meta.url), 'utf8');
const sentinel = fs.readFileSync(new URL('../../.github/workflows/blocked-sentinel.yml', import.meta.url), 'utf8');
const sentinelScript = fs.readFileSync(new URL('../../scripts/automation/blocked-sentinel.mjs', import.meta.url), 'utf8');
const reviewAgent = fs.readFileSync(new URL('../../scripts/automation/review-agent.mjs', import.meta.url), 'utf8');
const coordinator = fs.readFileSync(new URL('../../scripts/automation/coordinator.mjs', import.meta.url), 'utf8');
const contentSync = fs.readFileSync(new URL('../../scripts/automation/content-sync.mjs', import.meta.url), 'utf8');
const preflight = fs.readFileSync(new URL('../../scripts/automation/news-preflight.mjs', import.meta.url), 'utf8');
const WORKFLOWS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');

function hasStagingPrOpener(text) {
  if (/^\s+[^#\n]*gh pr create --base staging\b/m.test(text)) return true;
  return text.split(/(?=^      - (?:name:|uses:))/m).some((step) => (
    /^\s+uses: peter-evans\/create-pull-request@/m.test(step)
    && /^\s+base: staging\s*$/m.test(step)
  ));
}

function workflowJobSteps(text, jobName) {
  const headers = [...text.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  const jobIndex = headers.findIndex((header) => header[1] === jobName);
  assert.notEqual(jobIndex, -1, `missing workflow job ${jobName}`);
  const jobStart = headers[jobIndex].index;
  const jobEnd = headers[jobIndex + 1]?.index ?? text.length;
  const job = text.slice(jobStart, jobEnd);
  const stepsStart = job.indexOf('\n    steps:\n');
  assert.notEqual(stepsStart, -1, `missing steps for workflow job ${jobName}`);
  const stepsText = job.slice(stepsStart + '\n    steps:\n'.length);
  const stepHeaders = [...stepsText.matchAll(/^ {6}- ([A-Za-z0-9_-]+):\s*(.*)$/gm)];
  return stepHeaders.map((header, index) => {
    const start = header.index;
    const end = index + 1 < stepHeaders.length ? stepHeaders[index + 1].index : stepsText.length;
    const step = stepsText.slice(start, end);
    const property = (name) => {
      const first = new RegExp(`^ {6}- ${name}:\\s*(.*)$`, 'm').exec(step);
      const nested = new RegExp(`^ {8}${name}:\\s*(.*)$`, 'm').exec(step);
      return (first || nested)?.[1]?.trim() ?? null;
    };
    return { text: step, name: property('name'), id: property('id'), uses: property('uses'), if: property('if') };
  });
}

function controlConditionAllows(step, enabled) {
  const match = /^\$\{\{ steps\.control\.outputs\.enabled == '(true|false)' \}\}$/.exec(step.if || '');
  if (!match) return !step.if;
  return String(enabled) === match[1];
}

test('coordinator is dispatch-only and synthetic merge checkouts fetch parent history', () => {
  assert.doesNotMatch(workflow, /workflow_call|inputs\./);
  const mergeCheckouts = [...workflow.matchAll(/ref: refs\/pull\/[^\n]+\/merge\n\s+fetch-depth: 0/g)];
  assert.equal(mergeCheckouts.length, 2);
});

test('news-pilot safety regressions gate generator and promotion CI', () => {
  const commands = workflow.match(/- run: npm run test:news-pilot/g) || [];
  assert.equal(commands.length, 2, 'generator and promotion CI must both run news safety tests');
  const generator = workflow.slice(
    workflow.indexOf('  generator-ci:'),
    workflow.indexOf('  generator-ci-status:'),
  );
  const promotion = workflow.slice(
    workflow.indexOf('  promotion-ci:'),
    workflow.indexOf('  promotion-ci-status:'),
  );
  assert.match(generator, /npm run test:news-pilot/);
  assert.match(promotion, /npm run test:news-pilot/);
});

test('disabled promotion control makes every downstream pass step unreachable', () => {
  const steps = workflowJobSteps(workflow, 'pass-promotion');
  const controlIndex = steps.findIndex((step) => step.id === 'control');
  assert.equal(controlIndex, 1, 'only the trusted-main checkout may precede promotion control');
  assert.match(steps[controlIndex].text, /promotion-control\.mjs --github-output/);

  const downstream = steps.slice(controlIndex + 1);
  assert.ok(downstream.length > 0, 'promotion control must guard real downstream work');
  for (const step of downstream) {
    assert.equal(step.if, "${{ steps.control.outputs.enabled == 'true' }}",
      `downstream promotion step is not controlled: ${step.name || step.id || step.uses}`);
  }

  const effects = downstream.filter((step) => (
    step.uses === 'actions/download-artifact@v4'
    || step.uses === 'actions/upload-artifact@v4'
    || /coordinator\.mjs audit|gh pr merge/.test(step.text)
  ));
  assert.equal(effects.length, 3, 'download, audit/merge, and upload must all remain explicit controlled steps');
  assert.ok(effects.some((step) => step.uses === 'actions/download-artifact@v4'), 'missing controlled verdict download');
  assert.ok(effects.some((step) => /coordinator\.mjs audit/.test(step.text)), 'missing controlled promotion audit');
  assert.ok(effects.some((step) => /gh pr merge/.test(step.text)), 'missing controlled promotion merge');
  assert.ok(effects.some((step) => step.uses === 'actions/upload-artifact@v4'), 'missing controlled audit upload');
  assert.deepEqual(effects.filter((step) => controlConditionAllows(step, false)), [],
    'disabled ownership must execute no artifact, audit, or merge effect');
  assert.equal(effects.filter((step) => controlConditionAllows(step, true)).length, effects.length,
    'GHA ownership must preserve the complete promotion path');
});

test('every autonomous generator kind has an independent review lens', () => {
  for (const kind of ['seo', 'blog', 'blog-live', 'news', 'business', 'topic-discovery', 'promotion']) {
    assert.match(reviewAgent, new RegExp(`\\n  ['"]?${kind}['"]?: \\[`), `missing ${kind} review lens`);
  }
  assert.match(reviewAgent, /Liberty Township/);
});

test('every workflow that opens a staging PR explicitly dispatches a matching coordinator policy', () => {
  const contracts = {
    'discover-businesses.yml': {
      kind: 'business', prefix: 'auto/business-discovery',
      paths: ['data/businesses.json', 'data/discovery-seen.json', 'public/images/businesses/example.jpg'],
      stage: /add-paths: \|\n\s+data\/businesses\.json\n\s+data\/discovery-seen\.json\n\s+public\/images\/businesses\/\*\*/,
    },
    'news-autopublish.yml': {
      kind: 'news', prefix: 'news/auto-', paths: ['data/posts.json'], stage: 'git add data/posts.json',
    },
    'weekly-blog.yml': {
      kind: 'blog', prefix: 'blog/auto-', paths: ['data/posts.json', 'public/images/blog/example.jpg'],
      stage: 'git add data/posts.json "public/images/blog/"',
    },
    'weekly-seo-improvements.yml': {
      kind: 'seo', prefix: 'seo/auto-',
      paths: ['app/page.tsx', 'components/Card.tsx', 'data/topics.json', 'lib/schema.ts', 'public/images/example.jpg'],
      stage: 'git add app components data lib public/images 2>/dev/null || true',
    },
    'weekly-topic-discovery.yml': {
      kind: 'topic-discovery', prefix: 'auto/topic-discovery-', paths: ['data/topic-queue.json'],
      stage: 'git add data/topic-queue.json',
    },
  };
  const openers = fs.readdirSync(WORKFLOWS).filter((file) => file.endsWith('.yml')).filter((file) => {
    const text = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    return hasStagingPrOpener(text);
  }).sort();
  assert.deepEqual(openers, Object.keys(contracts).sort(),
    'a staging PR opener was added or removed without an explicit coordinator contract');

  for (const file of openers) {
    const text = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    const contract = contracts[file];
    const dispatch = text.match(/run: node [^\n]*coordinator\.mjs dispatch[^\n]*/)?.[0] ?? '';
    assert.match(dispatch, /--pr "\$\{\{ steps\.[^}]+outputs\.[^}]*number[^}]* \}\}"/, `${file}: exact PR output missing`);
    assert.match(dispatch, /--sha "\$\{\{ steps\.[^}]+outputs\.[^}]*sha[^}]* \}\}"/, `${file}: exact head SHA output missing`);
    assert.match(dispatch, new RegExp(`--kind ${contract.kind}(?: |$)`), `${file}: wrong or missing coordinator kind`);
    assert.ok(KIND_POLICIES[contract.kind].headPrefixes.includes(contract.prefix), `${file}: policy prefix mismatch`);
    assert.ok(text.includes(contract.prefix), `${file}: workflow head does not match policy prefix`);
    if (contract.stage instanceof RegExp) assert.match(text, contract.stage, `${file}: staged paths drifted`);
    else {
      assert.equal((text.match(/git add /g) || []).length, 1, `${file}: staging must have one auditable git add`);
      assert.ok(text.includes(contract.stage), `${file}: staged paths drifted`);
    }
    assert.equal(validatePaths(contract.kind, contract.paths).ok, true, `${file}: workflow paths exceed kind policy`);
    for (const allowed of KIND_POLICIES[contract.kind].allowedPaths) {
      assert.ok(contract.paths.some((filePath) => allowed.endsWith('/') ? filePath.startsWith(allowed) : filePath === allowed),
        `${file}: contract does not exercise allowed path ${allowed}`);
    }
  }
});

test('supervisor ingest transplants onto main as blog-live and never opens a staging PR', () => {
  const ingest = fs.readFileSync(path.join(WORKFLOWS, 'supervisor-ingest.yml'), 'utf8');
  assert.match(ingest, /gh pr create --base main/);
  assert.doesNotMatch(ingest, /gh pr create --base staging/);
  assert.match(ingest, /git checkout -B "blog\/auto-supervisor-\$\{DATA_SHA:0:12\}" origin\/main/);
  assert.match(ingest, /--kind blog-live/);
  assert.doesNotMatch(ingest, /--kind blog(?: |$)/);
  assert.match(ingest, /validatePaths\('blog-live'/);
  assert.match(ingest, /promotion-control\.mjs --content-ship/);
  assert.match(ingest, /merge-base --is-ancestor origin\/main origin\/staging/);
  assert.doesNotMatch(ingest, /git push origin (staging|main)\b/);
  assert.match(workflow, /content-main/);
  assert.match(workflow, /observe-and-sync-staging/);
  assert.match(contentSync, /sync\/main-/);
  assert.doesNotMatch(coordinator + contentSync, /git push origin (staging|main)\b/);
});

test('preflight reuses canonical models and content commands avoid GitHub APIs', () => {
  assert.match(preflight, /from '\.\/constants\.mjs'/);
  assert.match(preflight, /GATE_MODEL/); assert.match(preflight, /FIXER_MODEL/);
  assert.match(preflight, /MAX_REPAIRS/); assert.match(preflight, /SCORE_THRESHOLD/);
  assert.equal((reviewAgent.match(/\n  news: \[/g) || []).length, 1);
  const contentCommands = reviewAgent.slice(reviewAgent.indexOf('async function reviewContent'), reviewAgent.indexOf('async function fileAtSha'));
  assert.doesNotMatch(contentCommands, /github\(/);
});

test('repair attempt is consumed before fixer push and redispatch', () => {
  // Scoped to the repair job: the heal job carries its own push and budget label.
  const repairJob = workflow.slice(workflow.indexOf('  apply-generator-repair:'), workflow.indexOf('  pass-generator:'));
  const persist = repairJob.indexOf('coordinator.mjs set-attempt');
  const push = repairJob.indexOf('git push origin "HEAD:$HEAD_REF"');
  const redispatch = repairJob.indexOf('coordinator.mjs dispatch', push);
  assert.ok(persist >= 0, 'missing attempt persistence');
  assert.ok(persist < push, 'attempt must be persisted before push');
  assert.ok(push < redispatch, 'redispatch must use the pushed repair SHA');
  assert.match(repairJob.slice(persist, push), /NEXT_ATTEMPT/);
  assert.match(repairJob.slice(persist, push), /ls-remote/);
});

test('base heal consumes its budget before pushing an unforced merge and redispatches the healed SHA', () => {
  const healJob = workflow.slice(workflow.indexOf('  heal-generator-base:'), workflow.indexOf('  generator-review:'));
  assert.match(healJob, /if: \$\{\{ always\(\) && needs\.validate-generator\.outputs\.trusted == 'true' && needs\.generator-ci\.result == 'failure' && needs\.validate-generator\.outputs\.can_heal == 'true' \}\}/);
  const persist = healJob.indexOf('coordinator.mjs set-heal');
  const push = healJob.indexOf('git push origin "HEAD:$HEAD_REF"');
  const redispatch = healJob.indexOf('coordinator.mjs dispatch', push);
  assert.ok(persist >= 0 && persist < push, 'heal budget must be consumed before push');
  assert.ok(push < redispatch, 'redispatch must use the pushed heal SHA');
  assert.equal((healJob.match(/ls-remote/g) || []).length, 2, 'both the label bump and the push recheck the remote head');
  assert.doesNotMatch(healJob, /--force|\+HEAD/);
  assert.doesNotMatch(healJob, /npm (ci|run)/, 'the heal job never executes PR code');
  assert.match(healJob, /ref: \$\{\{ needs\.validate-generator\.outputs\.head_sha \}\}/);
  assert.match(healJob, /outputs:\n\s+healed: \$\{\{ steps\.heal\.outputs\.healed \}\}/);
  assert.equal((healJob.match(/if: \$\{\{ steps\.heal\.outputs\.healed == 'true' \}\}/g) || []).length, 4,
    'budget, push, redispatch/audit, and artifact steps must run only after a real heal');
  assert.match(coordinator, /writeOutput\(\{ healed: 'false', reason: 'current-base'/);
  assert.match(coordinator, /writeOutput\(\{ healed: 'false', reason: 'clean-merge'/);
});

test('block-generator stands down only when a pass, repair, or actual heal succeeded', () => {
  const blockJob = workflow.slice(workflow.indexOf('  block-generator:'), workflow.indexOf('  validate-promotion:'));
  assert.match(blockJob, /needs\.pass-generator\.result != 'success'/);
  assert.match(blockJob, /needs\.apply-generator-repair\.result != 'success'/);
  assert.match(blockJob, /\(needs\.heal-generator-base\.result != 'success' \|\| needs\.heal-generator-base\.outputs\.healed != 'true'\)/);
  assert.match(blockJob, /\n\s+heal-generator-base,\n/);
});

test('the blocked sentinel is a read-only hourly sweep that only notifies', () => {
  assert.match(sentinel, /schedule:\n\s+- cron: "0 \* \* \* \*"/);
  assert.match(sentinel, /workflow_dispatch:/);
  const permissions = sentinel.slice(sentinel.indexOf('permissions:'), sentinel.indexOf('steps:'));
  assert.match(permissions, /contents: read/);
  assert.match(permissions, /issues: read/);
  assert.match(permissions, /pull-requests: read/);
  assert.doesNotMatch(permissions, /write/);
  assert.doesNotMatch(sentinel, /gh pr|gh issue|coordinator\.mjs/);
  assert.match(sentinel, /node scripts\/automation\/blocked-sentinel\.mjs/);
  assert.match(sentinel, /SLACK_WEBHOOK_URL/);
  assert.match(sentinel, /steps\.scan\.outputs\.notify == 'true'/,
    'Slack must use the scanner\'s deterministic hourly/daily notification gate');
  assert.match(sentinelScript, /STALE_NOTIFICATION_UTC_HOUR = 12/);
  assert.match(sentinelScript, /slack_text: staleNotificationDue && stale\.length/,
    'stale-blocked text must be omitted from the other 23 hourly runs');
  assert.match(sentinelScript, /const notify = orphans\.length > 0 \|\| \(staleNotificationDue && stale\.length > 0\)/,
    'orphans notify hourly while stale-only alerts wait for the daily gate');
  assert.match(coordinator, /GITHUB_SERVER_URL/);
  assert.match(coordinator, /GITHUB_RUN_ID/);
  assert.match(coordinator, /GitHub Actions run:/);
});

test('red CI without an Opus verdict names the blocking CI class in the audit', () => {
  const blockJob = workflow.slice(workflow.indexOf('  block-generator:'), workflow.indexOf('  validate-promotion:'));
  assert.match(blockJob, /--failure-class ci --failure-name generator-ci --failure-result "\$CI_RESULT"/);
  assert.match(coordinator, /No Opus verdict was produced\. Blocking failure:/);
  assert.match(coordinator, /no Opus verdict; \$\{failure\.class\}\/\$\{failure\.name\}=\$\{failure\.result\}/);
});

test('generator pass refreshes after audit and skips auto-merge and observation when redispatched', () => {
  const passJob = workflow.slice(workflow.indexOf('  pass-generator:'), workflow.indexOf('  block-generator:'));
  const audit = passJob.indexOf('coordinator.mjs audit');
  const refresh = passJob.indexOf('coordinator.mjs refresh-generator-base');
  const autoMerge = passJob.indexOf('gh pr merge');
  const observe = passJob.indexOf('coordinator.mjs observe-and-promote');
  assert.ok(audit >= 0 && audit < refresh, 'base refresh must follow exact-SHA audit');
  assert.ok(refresh < autoMerge && autoMerge < observe, 'refresh must precede merge and observation');
  assert.match(passJob, /observe-and-sync-staging/);
  assert.equal((passJob.match(/steps\.refresh\.outputs\.refreshed != 'true'/g) || []).length, 5);
  assert.doesNotMatch(passJob.slice(0, refresh), /gh pr merge|observe-and-promote|observe-and-sync-staging/);
});
