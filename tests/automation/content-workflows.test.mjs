import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDataLane, parsePorcelain } from '../../scripts/content/seo-guard.mjs';
import { submitContent, unwrapModuleResult } from './fixtures/content-cli-stub.mjs';

const require = createRequire(import.meta.url);
const { seoModeClause } = require('../../scripts/seo-improve-agent.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = '9b23de506221fe24e749a9b1c20574041de1b9de';
const WORKFLOWS = {
  'discover-businesses.yml': 'discover',
  'weekly-topic-discovery.yml': 'discover-topics',
  'news-autopublish.yml': 'autopublish',
  'weekly-seo-improvements.yml': 'seo-improve',
  'weekly-blog.yml': 'generate-blog',
};
const DB_ENV = [
  'CONTENT_DATABASE_URL: ${{ secrets.CONTENT_DATABASE_URL }}',
  'CONTENT_DATABASE_URL_UNPOOLED: ${{ secrets.CONTENT_DATABASE_URL_UNPOOLED }}',
  'CONTENT_DEPLOY_HOOK_URL: ${{ secrets.CONTENT_DEPLOY_HOOK_URL }}',
  'CONTENT_SITE_BYPASS: ${{ secrets.CONTENT_SITE_BYPASS }}',
  'CONTENT_DB_NAME: ${{ vars.CONTENT_DB_NAME }}',
  'CONTENT_SITE_URL: ${{ vars.CONTENT_SITE_URL }}',
  'CONTENT_TARGET: ${{ needs.route.outputs.target }}',
  'ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}',
  'SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}',
  'environment: content-${{ needs.route.outputs.target }}',
  'contents: read',
];

// Staging-ref dispatch of the new inputs is not a pass. The default branch does
// not have these inputs until promotion, and this suite does not live-dispatch.
export const STAGING_DISPATCH_GATE = {
  status: 'pending-cutover',
  reason: 'workflow_dispatch inputs are absent from the default branch until promotion; staging-ref dispatch was not run and is not a pass',
  commands: [
    'gh workflow run discover-businesses.yml --ref staging -f store=db -f content_target=staging -f max=2',
    'gh workflow run weekly-topic-discovery.yml --ref staging -f store=db -f content_target=staging',
  ],
};

function readWorkflow(name) {
  return fs.readFileSync(path.join(ROOT, '.github/workflows', name), 'utf8');
}

function baseWorkflow(name) {
  return execFileSync('git', ['show', `${BASE}:.github/workflows/${name}`], { cwd: ROOT, encoding: 'utf8' });
}

function jobBlock(text, name) {
  const match = new RegExp(`^  ${name}:\\n`, 'm').exec(text);
  assert.ok(match, `missing job ${name}`);
  const start = match.index;
  const restStart = start + match[0].length;
  const rest = text.slice(restStart);
  const next = /^  [A-Za-z0-9_-]+:\n/m.exec(rest);
  const end = next ? restStart + next.index : text.length;
  return text.slice(start, end);
}

function stepsOf(job) {
  const marker = '\n    steps:\n';
  const index = job.indexOf(marker);
  assert.notEqual(index, -1, 'missing steps');
  return job.slice(index + marker.length);
}

function routeScript(text) {
  const start = text.indexOf('# route-writer:begin');
  const end = text.indexOf('# route-writer:end');
  assert.ok(start >= 0 && end > start, 'route script markers missing');
  const lines = text.slice(start, end).split('\n');
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length));
  return lines.map((line) => line.slice(indent)).join('\n');
}

function runRoute(script, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-route-'));
  const scriptPath = path.join(dir, 'route.sh');
  const outputPath = path.join(dir, 'github-output');
  fs.writeFileSync(scriptPath, script);
  fs.writeFileSync(outputPath, '');
  const env = {
    PATH: process.env.PATH,
    GITHUB_OUTPUT: outputPath,
    GITHUB_EVENT_NAME: 'schedule',
    GITHUB_REF: 'refs/heads/main',
    INPUT_STORE: '',
    INPUT_CONTENT_TARGET: '',
    INPUT_SEO_LANE: '',
    LV_CONTENT_STORE: '',
    LV_CONTENT_CUTOVER_HOLD: '',
    ...overrides,
  };
  try {
    execFileSync('bash', [scriptPath], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, outputs: parseOutput(fs.readFileSync(outputPath, 'utf8')), stderr: '' };
  } catch (error) {
    return {
      code: error.status ?? 1,
      outputs: parseOutput(fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''),
      stderr: `${error.stderr || ''}`,
      stdout: `${error.stdout || ''}`,
    };
  }
}

function parseOutput(text) {
  const outputs = {};
  for (const line of text.split('\n')) {
    if (!line) continue;
    const index = line.indexOf('=');
    outputs[line.slice(0, index)] = line.slice(index + 1);
  }
  return outputs;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function repo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-seo-guard-'));
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'guard@example.test']);
  git(cwd, ['config', 'user.name', 'Guard Test']);
  fs.mkdirSync(path.join(cwd, 'data'));
  fs.writeFileSync(path.join(cwd, 'data', 'posts.json'), '{"posts":[]}\n');
  fs.writeFileSync(path.join(cwd, 'README.md'), 'base\n');
  git(cwd, ['add', 'data/posts.json', 'README.md']);
  git(cwd, ['commit', '-m', 'base']);
  return cwd;
}

function runGuard(cwd, args) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(ROOT, 'scripts/content/seo-guard.mjs'), ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status ?? 1, stdout: `${error.stdout || ''}`, stderr: `${error.stderr || ''}` };
  }
}

const sharedScript = routeScript(readWorkflow('discover-businesses.yml'));

test('every writer route script is the same secret-free bash', () => {
  for (const name of Object.keys(WORKFLOWS)) {
    const text = readWorkflow(name);
    assert.equal(routeScript(text), sharedScript, name);
    const route = jobBlock(text, 'route');
    assert.equal(route.includes('secrets.'), false, `${name} route must not read secrets`);
    assert.match(route, /permissions:\n {6}contents: read/);
  }
  assert.match(readWorkflow('weekly-seo-improvements.yml'), /ROUTE_SEO: "1"/);
  for (const name of Object.keys(WORKFLOWS)) {
    if (name === 'weekly-seo-improvements.yml') continue;
    assert.equal(jobBlock(readWorkflow(name), 'route').includes('ROUTE_SEO: "1"'), false, name);
  }
});

test('route refuses a staging ref aimed at production and any unknown ref', () => {
  const stagingProd = runRoute(sharedScript, {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/staging',
    INPUT_STORE: 'db',
    INPUT_CONTENT_TARGET: 'production',
  });
  assert.equal(stagingProd.code, 1);
  assert.match(stagingProd.stderr, /staging ref requires store=db and content_target=staging/);

  const unknown = runRoute(sharedScript, { GITHUB_REF: 'refs/heads/feature/lane' });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /unknown ref: refs\/heads\/feature\/lane/);

  const mainStaging = runRoute(sharedScript, {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    INPUT_STORE: 'db',
    INPUT_CONTENT_TARGET: 'staging',
  });
  assert.equal(mainStaging.code, 1);
  assert.match(mainStaging.stderr, /content-staging requires refs\/heads\/staging/);
});

test('production target is main-only and content-staging is the staging ref with store=db', () => {
  const production = runRoute(sharedScript, { LV_CONTENT_STORE: 'db' });
  assert.equal(production.code, 0);
  assert.deepEqual(production.outputs, { store: 'db', target: 'production', lane: '' });

  const explicit = runRoute(sharedScript, {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    INPUT_STORE: 'db',
    INPUT_CONTENT_TARGET: 'production',
  });
  assert.equal(explicit.code, 0);
  assert.equal(explicit.outputs.target, 'production');

  const staging = runRoute(sharedScript, {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/staging',
    INPUT_STORE: 'db',
    INPUT_CONTENT_TARGET: 'staging',
  });
  assert.equal(staging.code, 0);
  assert.deepEqual(staging.outputs, { store: 'db', target: 'staging', lane: '' });

  const stagingGit = runRoute(sharedScript, {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/staging',
    INPUT_STORE: 'git',
    INPUT_CONTENT_TARGET: 'staging',
  });
  assert.equal(stagingGit.code, 1);
});

test('store input wins, auto falls through to the repo variable, and git is the default', () => {
  assert.equal(runRoute(sharedScript, {}).outputs.store, 'git');
  assert.equal(runRoute(sharedScript, { INPUT_STORE: 'auto', LV_CONTENT_STORE: 'db' }).outputs.store, 'db');
  assert.equal(runRoute(sharedScript, { INPUT_STORE: 'git', LV_CONTENT_STORE: 'db' }).outputs.store, 'git');
  const unknown = runRoute(sharedScript, { INPUT_STORE: 'nope' });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /unknown store input/);
  const badVar = runRoute(sharedScript, { LV_CONTENT_STORE: 'nope' });
  assert.equal(badVar.code, 1);
  assert.match(badVar.stderr, /unknown store: nope/);
});

test('SEO code lane is reachable with store=db and ignored when the store is git', () => {
  const code = runRoute(sharedScript, {
    ROUTE_SEO: '1',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    INPUT_STORE: 'db',
    INPUT_CONTENT_TARGET: 'production',
    INPUT_SEO_LANE: 'code',
  });
  assert.equal(code.code, 0);
  assert.equal(code.outputs.lane, 'code');
  assert.equal(code.outputs.store, 'db');

  const data = runRoute(sharedScript, {
    ROUTE_SEO: '1',
    INPUT_STORE: 'db',
    INPUT_SEO_LANE: '',
  });
  assert.equal(data.outputs.lane, 'data');

  const ignored = runRoute(sharedScript, {
    ROUTE_SEO: '1',
    INPUT_STORE: 'git',
    INPUT_SEO_LANE: 'code',
  });
  assert.equal(ignored.outputs.store, 'git');
  assert.equal(ignored.outputs.lane, '');

  const notSeo = runRoute(sharedScript, { INPUT_STORE: 'db', INPUT_SEO_LANE: 'code' });
  assert.equal(notSeo.outputs.lane, '');
});

test('LV_CONTENT_CUTOVER_HOLD=1 allows only a staging db dispatch and unset or 0 does not', () => {
  const allowed = {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/staging',
    INPUT_STORE: 'db',
    INPUT_CONTENT_TARGET: 'staging',
    LV_CONTENT_CUTOVER_HOLD: '1',
  };
  assert.equal(runRoute(sharedScript, allowed).code, 0);

  const refused = [
    { ...allowed, GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', INPUT_CONTENT_TARGET: '' },
    { ...allowed, GITHUB_EVENT_NAME: 'repository_dispatch', GITHUB_REF: 'refs/heads/main', INPUT_CONTENT_TARGET: 'production' },
    { ...allowed, GITHUB_EVENT_NAME: 'workflow_run' },
    { ...allowed, GITHUB_REF: 'refs/heads/main', INPUT_CONTENT_TARGET: 'production' },
    { ...allowed, INPUT_CONTENT_TARGET: 'production' },
    { ...allowed, INPUT_STORE: 'git' },
  ];
  for (const overrides of refused) {
    const result = runRoute(sharedScript, overrides);
    assert.equal(result.code, 1, JSON.stringify(overrides));
    assert.match(result.stderr, /LV_CONTENT_CUTOVER_HOLD refuses this writer event before side effects/);
    assert.deepEqual(result.outputs, {}, 'a refused hold must not publish route outputs');
  }

  const unset = runRoute(sharedScript, {
    GITHUB_EVENT_NAME: 'schedule',
    GITHUB_REF: 'refs/heads/main',
    LV_CONTENT_STORE: 'git',
  });
  assert.equal(unset.code, 0);
  assert.deepEqual(unset.outputs, { store: 'git', target: 'production', lane: '' });

  const zero = runRoute(sharedScript, {
    GITHUB_EVENT_NAME: 'schedule',
    LV_CONTENT_CUTOVER_HOLD: '0',
    LV_CONTENT_STORE: 'git',
  });
  assert.equal(zero.code, 0);
  assert.equal(zero.outputs.store, 'git');
});

test('writer workflows bind the db job to the routed environment and keep legacy steps', () => {
  for (const [name, originalJob] of Object.entries(WORKFLOWS)) {
    const text = readWorkflow(name);
    const legacy = jobBlock(text, 'legacy');
    const db = jobBlock(text, 'db');
    assert.match(text, /store:\n {8}description:/);
    assert.match(text, /content_target:\n {8}description:/);
    assert.match(legacy, /needs:.*route/);
    assert.match(legacy, /needs\.route\.outputs\.store == 'git'/);
    assert.match(db, /needs\.route\.outputs\.store == 'db' && needs\.route\.outputs\.lane != 'code'/);
    for (const binding of DB_ENV) assert.ok(db.includes(binding), `${name} missing ${binding}`);
    assert.equal(legacy.includes('CONTENT_DATABASE_URL'), false, `${name} legacy must not take content DB secrets`);
    assert.match(db, /ref: "\$\{\{ github\.sha \}\}"/);
    assert.match(db, /persist-credentials: false/);
    assert.match(db, /node scripts\/content\/cli\.mjs export --root \./);
    assert.match(db, /node scripts\/content\/cli\.mjs gate --submission "\$ID"/);

    const currentSteps = stepsOf(legacy);
    const originalSteps = stepsOf(jobBlock(baseWorkflow(name), originalJob));
    if (name !== 'weekly-seo-improvements.yml') {
      assert.equal(currentSteps, originalSteps, `${name} legacy steps must be byte-identical`);
    } else {
      const guardHeader = [
        '      - name: Guard — forbidden paths & change budget',
        '        id: guard',
        "        if: ${{ steps.candidate.outputs.generate == 'true' && steps.generate.outcome == 'success' && inputs.dry_run != true && inputs.dry_run != 'true' }}",
      ].join('\n');
      const inserted = [
        '      - name: Code lane refuses data edits',
        "        if: ${{ needs.route.outputs.lane == 'code' && steps.candidate.outputs.generate == 'true' && steps.generate.outcome == 'success' && inputs.dry_run != true && inputs.dry_run != 'true' }}",
        '        run: node scripts/content/seo-guard.mjs code-only',
        '      - name: Guard — forbidden paths & change budget',
        '        id: guard',
        "        if: ${{ success() && steps.candidate.outputs.generate == 'true' && steps.generate.outcome == 'success' && inputs.dry_run != true && inputs.dry_run != 'true' }}",
      ].join('\n');
      const expected = originalSteps.replace(guardHeader, inserted);
      assert.equal(currentSteps, expected);
      assert.match(legacy, /SEO_MODE: \$\{\{ needs\.route\.outputs\.lane == 'code' && 'code' \|\| '' \}\}/);
      assert.match(legacy, /needs\.route\.outputs\.store == 'git' \|\| needs\.route\.outputs\.lane == 'code'/);
      assert.match(db, /SEO_MODE: data/);
      assert.match(db, /seo-guard\.mjs capture > \/tmp\/seo-base\.json/);
      assert.match(db, /mixed-blocked/);
      assert.match(text, /seo_lane:/);
    }
  }

  const blog = readWorkflow('weekly-blog.yml');
  assert.equal(stepsOf(jobBlock(blog, 'resolve-owner')), stepsOf(jobBlock(baseWorkflow('weekly-blog.yml'), 'resolve-owner')));
  assert.match(blog, /needs\.resolve-owner\.outputs\.owner == 'gha'/);
  assert.match(blog, /inputs\.force_gha == true/);
  assert.match(jobBlock(blog, 'db'), /owner == 'gha'/);
  assert.equal(jobBlock(blog, 'db').includes('force_gha'), false);
  const news = jobBlock(readWorkflow('news-autopublish.yml'), 'db');
  assert.match(news, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(news, /cli\.mjs list --submissions --kind news --state open,gating/);
  assert.doesNotMatch(news, /news-preflight\.mjs/);
  assert.match(readWorkflow('discover-businesses.yml'), /cli\.mjs stats --alert/);
});

test('S9 and S10 stay a pending cutover gate', () => {
  assert.equal(STAGING_DISPATCH_GATE.status, 'pending-cutover');
  assert.match(STAGING_DISPATCH_GATE.reason, /not a pass/);
  assert.equal(STAGING_DISPATCH_GATE.commands.length, 2);
  assert.doesNotMatch(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8'), /execFileSync\(\s*['"]gh['"]/);
});

test('all DB writer jobs alert on any job failure and ingest posts failure status for startup failures', () => {
  for (const name of Object.keys(WORKFLOWS)) {
    const db = jobBlock(readWorkflow(name), 'db');
    assert.match(db, /- name: Alert content DB job failure\n\s+if: \$\{\{ failure\(\) \}\}/, name);
    assert.match(db, /SLACK_WEBHOOK_URL: \$\{\{ secrets\.SLACK_WEBHOOK_URL \}\}/, name);
    assert.match(db, /curl .*SLACK_WEBHOOK_URL/, name);
  }
  const ingest = jobBlock(readWorkflow('supervisor-ingest.yml'), 'ingest-db');
  assert.match(ingest, /- name: Report startup failure[^\n]*\n\s+if: \$\{\{ failure\(\) \}\}/);
  assert.doesNotMatch(ingest, /steps\.ingest\.outcome == 'failure'/);
  assert.match(ingest, /-f context=content\/publish -f state=failure/);
});

test('SEO_MODE only adds a prompt restriction', () => {
  const previous = process.env.SEO_MODE;
  delete process.env.SEO_MODE;
  assert.equal(seoModeClause(), '');
  process.env.SEO_MODE = 'data';
  assert.match(seoModeClause(), /data\/\*\.json/);
  assert.match(seoModeClause(), /tasks\/seo-improve-summary\.md/);
  process.env.SEO_MODE = 'code';
  assert.match(seoModeClause(), /do not create or edit anything under data\//);
  process.env.SEO_MODE = 'other';
  assert.equal(seoModeClause(), '');
  if (previous === undefined) delete process.env.SEO_MODE;
  else process.env.SEO_MODE = previous;
  const source = fs.readFileSync(path.join(ROOT, 'scripts/seo-improve-agent.js'), 'utf8');
  assert.equal((source.match(/seoModeClause\(\)/g) || []).length, 3);
});

test('porcelain parsing drops rename sources and quotes', () => {
  const entries = parsePorcelain([
    ' M data/posts.json',
    '?? screenshot.png',
    'R  data/old.json -> data/new.json',
    '?? "tasks/seo-improve-runs/note.json"',
    '',
  ].join('\n'));
  assert.deepEqual(entries.map((entry) => entry.path), [
    'data/posts.json',
    'screenshot.png',
    'data/new.json',
    'tasks/seo-improve-runs/note.json',
  ]);
  assert.equal(entries[1].untracked, true);
  assert.deepEqual(classifyDataLane(['data/posts.json']), {
    code: 0,
    body: { mode: 'data', changed: ['data/posts.json'], decision: 'submit' },
  });
  assert.equal(classifyDataLane([]).body.changed.length, 0);
  assert.equal(classifyDataLane(['data/posts.json', 'app/page.tsx']).code, 2);
});

test('seo-guard submits data plus runner notes, no-ops, and blocks mixed or code-lane data edits', () => {
  const cwd = repo();
  const clean = runGuard(cwd, ['capture']);
  assert.equal(clean.code, 0);
  const baseline = path.join(cwd, 'baseline.json');
  fs.writeFileSync(baseline, clean.stdout);
  const noop = runGuard(cwd, ['check', baseline]);
  assert.equal(noop.code, 0);
  assert.equal(noop.stdout.trim(), '{"mode":"data","changed":[]}');
  assert.equal(runGuard(cwd, ['code-only']).code, 0);

  fs.mkdirSync(path.join(cwd, 'tasks/seo-improve-runs'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'data/posts.json'), '{"posts":[{"slug":"new"}]}\n');
  fs.writeFileSync(path.join(cwd, 'tasks/seo-improve-summary.md'), '# summary\n');
  fs.writeFileSync(path.join(cwd, 'tasks/seo-improve-runs/2026-09-27.json'), '{}\n');
  fs.writeFileSync(path.join(cwd, 'tasks/seo-scores.json'), '{}\n');
  fs.writeFileSync(path.join(cwd, 'screenshot.png'), 'png');
  const submit = runGuard(cwd, ['check', baseline]);
  assert.equal(submit.code, 0);
  const submitBody = JSON.parse(submit.stdout);
  assert.equal(submitBody.decision, 'submit');
  assert.deepEqual(submitBody.changed, ['data/posts.json']);

  fs.mkdirSync(path.join(cwd, 'app'));
  fs.writeFileSync(path.join(cwd, 'app/page.tsx'), 'export default function Page(){return null}\n');
  const mixed = runGuard(cwd, ['check', baseline]);
  assert.equal(mixed.code, 2);
  assert.match(mixed.stdout, /mixed-blocked/);
  assert.match(mixed.stderr, /mixed-blocked/);
  assert.equal(runGuard(cwd, ['code-only']).code, 1);
  assert.match(runGuard(cwd, ['code-only']).stdout, /data\/posts\.json/);
});

const WRITER_CLI = {
  'discover-businesses.yml': { kind: 'business', workflow: 'discover-businesses' },
  'weekly-topic-discovery.yml': { kind: 'topic-discovery', workflow: 'weekly-topic-discovery' },
  'news-autopublish.yml': { kind: 'news', workflow: 'news-autopublish', newsOut: true },
  'weekly-seo-improvements.yml': { kind: 'seo', workflow: 'weekly-seo-improvements' },
  'weekly-blog.yml': { kind: 'blog', workflow: 'weekly-blog' },
};

function runBlock(yaml, stepName) {
  const marker = `      - name: ${stepName}\n`;
  const start = yaml.indexOf(marker);
  assert.notEqual(start, -1, stepName);
  const runAt = yaml.indexOf('\n        run: |\n', start);
  assert.notEqual(runAt, -1, `${stepName} run block`);
  const body = yaml.slice(runAt + '\n        run: |\n'.length);
  const lines = [];
  for (const line of body.split('\n')) {
    if (line === '') {
      lines.push('');
      continue;
    }
    if (!line.startsWith('          ')) break;
    lines.push(line.slice(10));
  }
  return lines.join('\n').replaceAll('${{ github.run_id }}', '101').replaceAll('${{ github.run_attempt }}', '1').replaceAll('${{ steps.publish.outputs.out_dir }}', 'news-out');
}

function stubNode(dir) {
  const stub = path.join(ROOT, 'tests/automation/fixtures/content-cli-stub.mjs');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const nodePath = path.join(bin, 'node');
  fs.writeFileSync(nodePath, `#!/bin/bash
if [[ "$1" == *cli.mjs ]]; then
  exec ${JSON.stringify(process.execPath)} ${JSON.stringify(stub)} "$@"
fi
exec ${JSON.stringify(process.execPath)} "$@"
`);
  fs.chmodSync(nodePath, 0o755);
  return bin;
}

function runWriterShell(script, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cli-wire-'));
  const log = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(log, '');
  const bin = stubNode(dir);
  try {
    const stdout = execFileSync('bash', ['-eo', 'pipefail', '-c', script], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        LV_STUB_LOG: log,
        ...env,
      },
    });
    return { code: 0, stdout, calls: readCalls(log) };
  } catch (error) {
    return { code: error.status ?? 1, stdout: `${error.stdout || ''}`, stderr: `${error.stderr || ''}`, calls: readCalls(log) };
  }
}

function readCalls(log) {
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('writer db jobs call the spec CLI and propagate submit and gate exits', () => {
  assert.deepEqual(unwrapModuleResult(submitContent('null')), {
    result: { submissionId: null, reason: 'no-changes' },
    exitCode: 0,
  });
  assert.equal(unwrapModuleResult(submitContent('2')).exitCode, 2);
  assert.equal(unwrapModuleResult({ submissionId: 17 }).exitCode, 0);

  for (const [name, spec] of Object.entries(WRITER_CLI)) {
    const db = jobBlock(readWorkflow(name), 'db');
    assert.equal(db.includes('CONTENT_SLACK_WEBHOOK_URL'), false, name);
    assert.match(db, /node scripts\/content\/cli\.mjs export --root \./);
    const submit = runBlock(db, `Submit ${spec.kind} content`);
    assert.match(submit, new RegExp(`submit --dir \\. --kind ${spec.kind} --`));
    if (spec.newsOut) assert.match(submit, /--news-out "news-out"/);
    assert.match(submit, new RegExp(`--idempotency-key "gha:${spec.workflow}:101:1"`));
    const gate = runBlock(db, `Gate ${spec.kind} content`);
    assert.match(gate, /jq -r '\.submissionId'/);
    assert.match(gate, /node scripts\/content\/cli\.mjs gate --submission "\$ID"/);

    const skipped = runWriterShell(`${submit}\n${gate}`, { LV_STUB_SUBMIT: 'null' });
    assert.equal(skipped.code, 0, `${name} null submit ${skipped.stderr}`);
    assert.deepEqual(skipped.calls.map((call) => call.command), ['submit']);

    const published = runWriterShell(`${submit}\n${gate}`, { LV_STUB_SUBMIT: 'id', LV_STUB_GATE: '0' });
    assert.equal(published.code, 0, name);
    assert.deepEqual(published.calls.map((call) => call.command), ['submit', 'gate']);
    assert.ok(published.calls[1].args.includes('--submission'));
    assert.ok(published.calls[1].args.includes('17'));

    const blocked = runWriterShell(`${submit}\n${gate}`, { LV_STUB_SUBMIT: 'id', LV_STUB_GATE: '2' });
    assert.equal(blocked.code, 2, `${name} gate exit 2`);
    const pending = runWriterShell(`${submit}\n${gate}`, { LV_STUB_SUBMIT: 'id', LV_STUB_GATE: '3' });
    assert.equal(pending.code, 3, `${name} gate exit 3`);
    const rejected = runWriterShell(submit, { LV_STUB_SUBMIT: '2' });
    assert.equal(rejected.code, 2, `${name} submit exit 2`);
    assert.deepEqual(rejected.calls.map((call) => call.command), ['submit']);
  }
});

test('news dry-run with an unfinished DB submission never resumes a mutating gate', () => {
  const db = jobBlock(readWorkflow('news-autopublish.yml'), 'db');
  const publish = runBlock(db, 'Run autonomous publish gate');
  const env = {
    GITHUB_RUN_ID: '101', GITHUB_WORKFLOW: 'News dry-run test',
    LV_STUB_LIST: 'open', EVENT_NAME: 'workflow_dispatch', DRY_RUN: 'true',
  };
  const dry = runWriterShell(`GITHUB_OUTPUT=$(mktemp)\n${publish}`, env);
  assert.equal(dry.code, 0, dry.stderr);
  assert.deepEqual(dry.calls.map((call) => call.command), ['list']);
  assert.match(dry.stdout, /status=pending_autopublish_pr/);

  const live = runWriterShell(`GITHUB_OUTPUT=$(mktemp)\n${publish}`, { ...env, DRY_RUN: 'false' });
  assert.equal(live.code, 0, live.stderr);
  assert.deepEqual(live.calls.map((call) => call.command), ['list', 'gate']);
  assert.match(live.stdout, /status=resumed_news_submission/);
});

test('discover stats --alert uses SLACK_WEBHOOK_URL and news list requires an array', () => {
  const discover = jobBlock(readWorkflow('discover-businesses.yml'), 'db');
  const stats = runBlock(discover, 'Weekly content storage check');
  assert.match(stats, /node scripts\/content\/cli\.mjs stats --alert/);
  const alert = runWriterShell(stats, {
    LV_STUB_BYTES: String(400 * 1024 * 1024),
    SLACK_WEBHOOK_URL: 'https://example.test/slack',
    CONTENT_SLACK_WEBHOOK_URL: 'https://example.test/draft',
  });
  assert.equal(alert.code, 0, alert.stderr);
  const posted = alert.calls.find((call) => call.slackText);
  assert.match(posted.slackText, /⚠ Neon content storage 400 MB > 350 MB of 512 MB/);
  assert.equal(alert.calls.some((call) => call.command === 'stats' && call.slack === 'https://example.test/slack'), true);

  const quiet = runWriterShell(stats, {
    LV_STUB_BYTES: String(400 * 1024 * 1024),
    CONTENT_SLACK_WEBHOOK_URL: 'https://example.test/draft',
  });
  assert.equal(quiet.calls.some((call) => call.slackText), false);

  const news = readWorkflow('news-autopublish.yml');
  const listAt = news.indexOf('LIST=$(node scripts/content/cli.mjs list --submissions --kind news --state open,gating)');
  const pendingAt = news.indexOf('PENDING=$(printf', listAt);
  const pendingEnd = news.indexOf('\n', news.indexOf("process.stdout.write(String(j.length));});')", pendingAt));
  const fragment = `set -euo pipefail\n${news.slice(listAt, pendingEnd)}\necho "$PENDING"`;
  const open = runWriterShell(fragment, { LV_STUB_LIST: 'open' });
  assert.equal(open.code, 0, open.stderr);
  assert.equal(open.stdout.trim(), '1');
  const empty = runWriterShell(fragment, { LV_STUB_LIST: 'empty' });
  assert.equal(empty.stdout.trim(), '0');
  const wrapped = runWriterShell('set -euo pipefail\nLIST=\'{"result":[],"exitCode":0}\'\nPENDING=$(printf \'%s\\n\' "$LIST" | node -e \'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s.trim().split(/\\n/).pop());if(!Array.isArray(j)){process.stderr.write("list stdout must be an array\\n");process.exit(1);}process.stdout.write(String(j.length));});\')\necho "$PENDING"', {});
  assert.equal(wrapped.code, 1);
});
