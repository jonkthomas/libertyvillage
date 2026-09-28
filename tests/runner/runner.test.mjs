import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOBS, alertFailure, assertTarget, childEnv, copyGenerated, allowedGeneratedPath, selectTopic, recordTopic, slotKey } from '../../ops/exedev-runner/runner.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const owned = path.resolve(dirname, '../../ops/exedev-runner');
const read = (name) => fs.readFileSync(path.join(owned, name), 'utf8');

test('six UTC jobs have the approved schedule', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(JOBS).map(([job, spec]) => [job, spec.calendar])), {
    'topic-discovery': 'Mon *-*-* 10:00:00 UTC',
    'seo-improvements': 'Mon *-*-* 10:11:00 UTC',
    'discover-businesses': 'Mon *-*-* 13:00:00 UTC',
    news: '*-*-* 12:17:00 UTC',
    'weekly-growth-report': 'Thu *-*-* 10:37:00 UTC',
    'weekly-blog': 'Sun,Wed *-*-* 11:00:00 UTC',
  });
  for (const [job, spec] of Object.entries(JOBS)) {
    const timer = read(`lv-runner-${job}.timer`);
    assert.match(timer, new RegExp(`OnCalendar=${spec.calendar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(timer, new RegExp(`Unit=lv-runner@${job}:production:scheduled.service`));
  }
});

test('on-demand and timer enter the same service and each scheduled occurrence gets a slot', () => {
  assert.match(read('launcher.sh'), /systemctl start "lv-runner@\$\{job\}:\$\{target\}:\$\{slot\}\.service"/);
  assert.match(read('launcher.sh'), /if \[\[ "\$slot" == scheduled \]\]; then slot="\$\(date -u \+%Y%m%d%H%M\)-scheduled"/);
  assert.match(read('lv-runner@.service'), /ExecStart=\/usr\/local\/libexec\/lv-runner-service %i/);
  assert.equal(slotKey('news', 'staging', '202609281217-scheduled'), 'runner:news:staging:202609281217-scheduled');
});

test('target guard rejects wrong DB, site, bypass, and GitHub write bindings', () => {
  const stage = {
    CONTENT_TARGET: 'staging', CONTENT_DB_NAME: 'lv_staging',
    CONTENT_DATABASE_URL: 'postgres://a:b@db.example/lv_staging',
    CONTENT_DATABASE_URL_UNPOOLED: 'postgres://a:b@db.example/lv_staging',
    CONTENT_SITE_URL: 'https://staging.libertyvillage.co', CONTENT_SITE_BYPASS: 'secret',
    CONTENT_DEPLOY_HOOK_URL: 'https://api.vercel.com/hook/staging',
  };
  assert.doesNotThrow(() => assertTarget(stage, 'staging'));
  assert.throws(() => assertTarget({ ...stage, CONTENT_DB_NAME: 'neondb' }, 'staging'));
  assert.throws(() => assertTarget({ ...stage, CONTENT_DATABASE_URL: 'postgres://a:b@db.example/neondb' }, 'staging'));
  assert.throws(() => assertTarget({ ...stage, CONTENT_SITE_URL: 'https://libertyvillage.co' }, 'staging'));
  assert.throws(() => assertTarget({ ...stage, GITHUB_TOKEN: 'write' }, 'staging'));
  const prod = { ...stage, CONTENT_TARGET: 'production', CONTENT_DB_NAME: 'neondb', CONTENT_DATABASE_URL: 'postgres://a:b@db.example/neondb', CONTENT_DATABASE_URL_UNPOOLED: 'postgres://a:b@db.example/neondb', CONTENT_SITE_URL: 'https://libertyvillage.co', CONTENT_SITE_BYPASS: '', LV_RUNNER_PRODUCTION_ENABLED: '1' };
  assert.doesNotThrow(() => assertTarget(prod, 'production'));
  assert.throws(() => assertTarget({ ...prod, CONTENT_SITE_BYPASS: 'secret' }, 'production'));
});

test('scratch code poisoning cannot cross into trusted CLI', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-runner-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const trusted = path.join(temp, 'trusted');
  const scratch = path.join(temp, 'scratch');
  for (const root of [trusted, scratch]) fs.mkdirSync(path.join(root, 'scripts', 'content'), { recursive: true });
  fs.writeFileSync(path.join(trusted, 'scripts/content/cli.mjs'), 'trusted CLI');
  fs.writeFileSync(path.join(scratch, 'scripts/content/cli.mjs'), 'throw new Error("POISON EXECUTED")');
  fs.mkdirSync(path.join(scratch, 'data'));
  fs.writeFileSync(path.join(scratch, 'data/posts.json'), '[]');
  assert.throws(() => copyGenerated(scratch, trusted, 'weekly-blog', ['scripts/content/cli.mjs', 'data/posts.json']), /allowlist/);
  assert.equal(fs.readFileSync(path.join(trusted, 'scripts/content/cli.mjs'), 'utf8'), 'trusted CLI');
  assert.equal(fs.existsSync(path.join(trusted, 'data/posts.json')), false);
  assert.deepEqual(copyGenerated(scratch, trusted, 'weekly-blog', ['data/posts.json']), ['data/posts.json']);
  assert.equal(fs.readFileSync(path.join(trusted, 'data/posts.json'), 'utf8'), '[]');
  assert.equal(allowedGeneratedPath('public/images/blog/valid-slug.jpg', 'weekly-blog'), true);
  assert.equal(allowedGeneratedPath('scripts/content/cli.mjs', 'weekly-blog'), false);
});

test('generator environment is limited and push has an invalid destination', () => {
  const source = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'agent', CONTENT_DATABASE_URL: 'db-secret', SLACK_WEBHOOK_URL: 'slack-secret', GH_TOKEN: 'write-token' };
  assert.deepEqual(childEnv(source, ['PATH', 'ANTHROPIC_API_KEY']), { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'agent' });
  const helper = read('launcher.sh').split("if [[ \"$mode\" == lv-runner-service ]]")[0];
  assert.doesNotMatch(helper, /CONTENT_DATABASE_URL|SLACK_WEBHOOK_URL|GH_TOKEN|GITHUB_TOKEN/);
  assert.match(helper, /GIT_CONFIG_VALUE_1='https:\/\/invalid\.invalid\/denied'/);
  assert.match(helper, /ProtectSystem=strict/);
  assert.match(helper, /NoNewPrivileges=yes/);
});

test('topic attempts stay local and consumption waits for success', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-topic-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const statePath = path.join(temp, 'topic-state.json');
  const queue = { topics: [{ kind: 'blog', title: 'A title', key: 'abc' }] };
  assert.equal(selectTopic(queue, {}, 'staging').key, 'abc');
  recordTopic(statePath, 'staging', queue.topics[0]);
  let state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(state.staging.abc, { attempts: 1, consumed: false });
  recordTopic(statePath, 'staging', queue.topics[0], true);
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(state.staging.abc, { attempts: 1, consumed: true });
  assert.equal(selectTopic(queue, state, 'staging'), null);
});

test('news preflight and artifact handoff are ordered before submit', () => {
  const runner = read('runner.mjs');
  const preflight = runner.indexOf("'--state', 'open,gating'");
  const drafting = runner.indexOf("source('scripts/news-pilot/run.mjs'");
  assert.ok(preflight > 0 && drafting > preflight);
  assert.match(runner, /published\.published !== 1/);
  assert.match(runner, /submitAndGate\(job, target, slot, log, \['--news-out', publish\]\)/);
  assert.match(runner, /if \(request\.dryRun\) return \{ dryRun: true \}/);
});

test('failure alert contains only a non-secret run reference and reports delivery failure', async () => {
  let body;
  const sent = await alertFailure({ webhook: 'https://slack.example/secret', job: 'weekly-blog', target: 'staging', slot: '202609281100-abcd1234' }, async (_url, init) => { body = JSON.parse(init.body); return { ok: true }; });
  assert.equal(sent, true);
  assert.equal(body.text, '⚠ weekly-blog DB content job failed (staging); lv-runner 202609281100-abcd1234');
  assert.equal(await alertFailure({ webhook: 'https://slack.example/secret', job: 'news', target: 'staging', slot: '202609281217-abcd1234' }, async () => { throw new Error('offline'); }), false);
});
