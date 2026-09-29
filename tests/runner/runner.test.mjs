import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JOBS, acceptGeneratedOutput, alertFailure, assertTarget, childEnv, changedPaths, classifyCliFailure, command, consumeResumedBlogTopic, copyGenerated, copyScratchTree, generatedPathsForTransfer, hasOneNewBlogPost, allowedGeneratedPath, seoCodeSuggestionPath, readScratchHead, selectTopic, recordTopic, exhaustTopicOnNoPost, shouldExhaustTopicOnNoPost, reserveTopicSubmission, clearTopicReservation, slotKey } from '../../ops/exedev-runner/runner.mjs';

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

test('generator HEAD check refuses FIFO, device link and unbounded metadata', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-runner-head-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const git = path.join(temp, '.git');
  fs.mkdirSync(git);
  const head = path.join(git, 'HEAD');
  const pinned = 'a'.repeat(40);
  fs.writeFileSync(head, `${pinned}\n`);
  assert.equal(readScratchHead(temp), pinned);
  fs.writeFileSync(head, 'a'.repeat(1024 * 1024));
  assert.throws(() => readScratchHead(temp), /generator changed pinned commit/);
  fs.rmSync(head);
  fs.symlinkSync('/dev/zero', head);
  assert.throws(() => readScratchHead(temp), { code: 'ELOOP' });
  fs.rmSync(head);
  const fifo = spawnSync('mkfifo', [head], { encoding: 'utf8' });
  assert.equal(fifo.status, 0, fifo.stderr);
  assert.throws(() => readScratchHead(temp), /generator changed pinned commit/);
});

test('scratch npm binary stays bound to scratch instead of loading a second trusted Next instance', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-runner-links-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const trusted = path.join(temp, 'trusted');
  const scratch = path.join(temp, 'scratch');
  const target = path.join('node_modules', 'next', 'dist', 'bin', 'next');
  fs.mkdirSync(path.join(trusted, 'node_modules', '.bin'), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(trusted, target)), { recursive: true });
  fs.writeFileSync(path.join(trusted, target), 'local Next binary');
  fs.symlinkSync('../next/dist/bin/next', path.join(trusted, 'node_modules', '.bin', 'next'));

  copyScratchTree(trusted, scratch);
  const copiedLink = path.join(scratch, 'node_modules', '.bin', 'next');
  assert.equal(fs.readlinkSync(copiedLink), '../next/dist/bin/next');
  assert.equal(fs.realpathSync(copiedLink), fs.realpathSync(path.join(scratch, target)));
  assert.equal(fs.readFileSync(copiedLink, 'utf8'), 'local Next binary');
});

test('trusted diff never executes a generator-poisoned scratch Git fsmonitor', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-runner-git-trust-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const trusted = path.join(temp, 'trusted');
  const scratch = path.join(temp, 'scratch');
  fs.mkdirSync(path.join(trusted, 'data'), { recursive: true });
  fs.writeFileSync(path.join(trusted, 'data', 'posts.json'), '[]');
  const git = (cwd, args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(temp, ['init', '-q', trusted]);
  git(trusted, ['add', 'data/posts.json']);
  git(trusted, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
  copyScratchTree(trusted, scratch);
  fs.writeFileSync(path.join(scratch, 'data', 'posts.json'), '["generated"]');
  const marker = path.join(temp, 'fsmonitor-ran');
  git(scratch, ['config', 'core.fsmonitor', `touch ${marker}; false`]);
  spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: scratch });
  assert.equal(fs.existsSync(marker), true, 'negative control: vulnerable scratch Git runs fsmonitor');
  fs.rmSync(marker);

  assert.deepEqual(changedPaths(scratch, trusted), ['data/posts.json']);
  assert.equal(fs.existsSync(marker), false, 'trusted Git index never reads scratch config');
  assert.deepEqual(copyGenerated(scratch, trusted, 'weekly-blog'), ['data/posts.json']);
  assert.equal(fs.existsSync(marker), false, 'default copy path also avoids scratch Git config');
  assert.equal(fs.readFileSync(path.join(trusted, 'data', 'posts.json'), 'utf8'), '["generated"]');
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
  assert.equal(allowedGeneratedPath('tasks/seo-data-latest.json', 'weekly-blog'), false);
  fs.mkdirSync(path.join(scratch, 'tasks'));
  fs.writeFileSync(path.join(scratch, 'tasks/seo-data-latest.json'), '{"private":"analytics"}');
  fs.writeFileSync(path.join(scratch, 'tasks/x.json'), 'invalid JSON; never read');
  fs.writeFileSync(path.join(scratch, 'scripts/evil.sh'), `touch ${path.join(temp, 'evil-ran')}`);
  const outputs = ['tasks/seo-data-latest.json', 'tasks/x.json', 'scripts/evil.sh', 'data/posts.json'];
  const transfer = generatedPathsForTransfer(outputs, 'weekly-blog');
  assert.deepEqual(transfer, ['data/posts.json']);
  assert.deepEqual(copyGenerated(scratch, trusted, 'weekly-blog', transfer), ['data/posts.json'], 'unexpected scratch files cannot stop a valid transfer');
  for (const name of ['tasks/seo-data-latest.json', 'tasks/x.json', 'scripts/evil.sh']) assert.equal(fs.existsSync(path.join(trusted, name)), false, `${name} was not copied`);
  assert.equal(fs.existsSync(path.join(temp, 'evil-ran')), false, 'untrusted script was not executed');
  assert.deepEqual(generatedPathsForTransfer(['data/posts.json', 'data/posts.json.backup', 'tasks/pipeline-summary.txt', 'tasks/blog-draft.json', 'scripts/content/cli.mjs'], 'weekly-blog'), ['data/posts.json'], 'every non-transfer artifact is discarded by policy');
  assert.deepEqual(generatedPathsForTransfer(['data/posts.json.backup', 'tasks/pipeline-summary.txt'], 'seo-improvements'), [], 'policy also applies to SEO');
  for (const rel of ['scripts/evil.sh', 'app/page.tsx', 'public/robots.txt', '.github/workflows/deploy.yml', 'package.json', 'next.config.ts', 'tasks/evil.sh']) assert.equal(seoCodeSuggestionPath(rel), true, `${rel} needs a human-PR notice`);
  for (const rel of ['data/posts.json.backup', 'tasks/blog-draft.json', 'tasks/seo-data-latest.json']) assert.equal(seoCodeSuggestionPath(rel), false, `${rel} is a scratch-only data/note artifact`);
});

test('blog acceptance refuses generator FIFO before reading any post JSON', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-blog-fifo-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const scratch = path.join(temp, 'scratch');
  const trusted = path.join(temp, 'trusted');
  for (const root of [scratch, trusted]) fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const baseline = [{ slug: 'already-in-db' }];
  fs.writeFileSync(path.join(trusted, 'data/posts.json'), JSON.stringify(baseline));
  const fifo = path.join(scratch, 'data/posts.json');
  const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  const runnerUrl = new URL('../../ops/exedev-runner/runner.mjs', import.meta.url).href;
  // A regression to reading scratch before copyGenerated must time out, not
  // hang the test process (or a privileged staging worker) indefinitely.
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `import { acceptGeneratedOutput } from ${JSON.stringify(runnerUrl)}; try { acceptGeneratedOutput(${JSON.stringify(scratch)}, ${JSON.stringify(trusted)}, 'weekly-blog', ['data/posts.json'], [{slug:'already-in-db'}]); process.exit(9); } catch (error) { console.log(error.message); }`], { encoding: 'utf8', timeout: 2000 });
  assert.equal(probe.error, undefined, 'generator FIFO must never block trusted read');
  assert.equal(probe.status, 0, probe.stderr);
  assert.match(probe.stdout, /scratch output is not a regular file/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(trusted, 'data/posts.json'), 'utf8')), baseline);
  assert.equal(typeof acceptGeneratedOutput, 'function');
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
  const queue = { topics: [{ kind: 'blog', title: 'A title', key: 'abc' }, { kind: 'blog', title: 'Another', key: 'def' }] };
  const slot = '202609281100-topicabc';
  assert.equal(selectTopic(queue, {}, 'staging').key, 'abc');
  recordTopic(statePath, 'staging', queue.topics[0]);
  let state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(state.staging.abc, { attempts: 1, consumed: false });
  reserveTopicSubmission(statePath, 'staging', queue.topics[0], slot, 17);
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(state.staging.abc, { attempts: 1, consumed: false, pendingSlot: slot, pendingSubmissionId: 17 });
  assert.equal(selectTopic(queue, state, 'staging').key, 'def', 'next slot must not duplicate a published-pending topic');
  const selectedPath = path.join(temp, 'topics', `${slot}.json`);
  fs.mkdirSync(path.dirname(selectedPath));
  fs.writeFileSync(selectedPath, JSON.stringify(queue.topics[0]));
  assert.equal(consumeResumedBlogTopic(temp, 'staging', slot, {}, { id: 17, success: false }), false);
  assert.equal(consumeResumedBlogTopic(temp, 'staging', slot, {}, { id: null, success: true }), false);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).staging.abc.consumed, false);
  assert.equal(consumeResumedBlogTopic(temp, 'staging', slot, {}, { id: 17, success: true }), true);
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(state.staging.abc, { attempts: 1, consumed: true });
  assert.equal(selectTopic(queue, state, 'staging').key, 'def');
  recordTopic(statePath, 'staging', queue.topics[1]);
  reserveTopicSubmission(statePath, 'staging', queue.topics[1], slot, 18);
  clearTopicReservation(statePath, 'staging', queue.topics[1], 'other-slot');
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).staging.def.pendingSlot, slot);
  clearTopicReservation(statePath, 'staging', queue.topics[1], slot);
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(state.staging.def, { attempts: 1, consumed: false });
  assert.equal(selectTopic({ topics: [queue.topics[1]] }, state, 'staging').key, 'def', 'terminal rejection releases reservation');
});

test('no-post exhausts a queued topic immediately without marking it published', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-topic-no-post-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const statePath = path.join(temp, 'topic-state.json');
  const queue = { topics: [{ kind: 'blog', title: 'Unverifiable premise', key: 'first' }, { kind: 'blog', title: 'Supported premise', key: 'second' }] };
  recordTopic(statePath, 'staging', queue.topics[0]);
  exhaustTopicOnNoPost(statePath, 'staging', queue.topics[0]);
  exhaustTopicOnNoPost(statePath, 'staging', queue.topics[0]);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(state.staging.first, { attempts: 3, consumed: false });
  assert.equal(selectTopic(queue, state, 'staging').key, 'second');
  exhaustTopicOnNoPost(statePath, 'staging', { key: null });
  assert.equal(fs.readFileSync(statePath, 'utf8'), `${JSON.stringify(state)}\n`);
  const noPost = new Error('blog generated no post');
  assert.equal(shouldExhaustTopicOnNoPost('weekly-blog', { dryRun: false }, queue.topics[0], noPost), true);
  assert.equal(shouldExhaustTopicOnNoPost('weekly-blog', { dryRun: true }, queue.topics[0], noPost), false);
  assert.equal(shouldExhaustTopicOnNoPost('weekly-blog', {}, { title: 'manual', key: null }, noPost), false);
  assert.equal(shouldExhaustTopicOnNoPost('weekly-blog', {}, queue.topics[0], new Error('generator failed')), false);
  assert.equal(shouldExhaustTopicOnNoPost('news', {}, queue.topics[0], noPost), false);
});

test('weekly blog requires one new post relative to exported DB, not Git HEAD drift', () => {
  const exported = [{ slug: 'already-in-db' }];
  assert.equal(hasOneNewBlogPost(exported, exported), false);
  assert.equal(hasOneNewBlogPost(exported, [{ slug: 'replacement' }]), false);
  assert.equal(hasOneNewBlogPost(exported, [{ slug: 'already-in-db' }, { slug: 'already-in-db' }]), false);
  assert.equal(hasOneNewBlogPost(exported, [{ slug: 'already-in-db' }, { slug: 'new-grounded-post' }]), true);
});

test('trusted CLI errors preserve safe classes and guidance without raw candidate text', (t) => {
  const args = ['scripts/content/cli.mjs', 'lookup'];
  assert.deepEqual(classifyCliFailure('node', args, { status: 2, stdout: JSON.stringify({ error: 'ConflictError', conflicts: [{ key: 'private-slug' }] }) }), { reason: 'cli-conflict', action: 'reload-snapshot', exit: 2 });
  assert.equal(classifyCliFailure('node', args, { status: 2, stdout: JSON.stringify({ error: 'ValidationError', message: 'private candidate content' }) }).reason, 'cli-validation');
  assert.equal(classifyCliFailure('node', args, { status: 1, stdout: JSON.stringify({ error: 'Error', message: 'HTTP 503 unavailable' }) }).reason, 'cli-server');
  assert.equal(classifyCliFailure('node', args, { status: 1, stdout: JSON.stringify({ error: 'Error', message: 'fetch failed' }) }).reason, 'cli-network');
  assert.equal(classifyCliFailure('node', args, { status: 1, stdout: JSON.stringify({ error: '__proto__' }) }).reason, 'cli-operation');
  assert.equal(classifyCliFailure('node', args, { status: 1, stdout: JSON.stringify({ error: 'Error', message: 'private'.repeat(3000) }) }).reason, 'cli-operation');
  assert.equal(classifyCliFailure('git', args, { status: 1, stdout: '{}' }), null);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cli-error-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const binary = path.join(temp, 'node');
  fs.writeFileSync(binary, '#!/bin/sh\nprintf \'%s\\n\' \'{"error":"ConflictError","message":"private candidate text","conflicts":[{"key":"private-slug"}]}\'\nexit 2\n', { mode: 0o700 });
  let error;
  try { command(binary, args, { cwd: temp }); assert.fail('CLI should have failed'); }
  catch (caught) { error = caught; }
  assert.equal(error.cliFailure.reason, 'cli-conflict');
  assert.equal(error.cliFailure.action, 'reload-snapshot');
  assert.equal(error.cliFailure.exit, 2);
  assert.doesNotMatch(JSON.stringify(error), /private candidate|private-slug/);
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

test('installer keeps the unaccepted SEO writer disabled without toggling other five timers', () => {
  const install = fs.readFileSync(new URL('../../ops/exedev-runner/install.sh', import.meta.url), 'utf8');
  assert.match(install, /systemctl daemon-reload[\s\S]*systemctl disable --now lv-runner-seo-improvements\.timer/);
  assert.doesNotMatch(install, /systemctl enable/);
  assert.match(install, /other timer states unchanged/);
});

test('failure alert contains only a non-secret run reference and reports delivery failure', async () => {
  let body;
  const sent = await alertFailure({ webhook: 'https://slack.example/secret', job: 'weekly-blog', target: 'staging', slot: '202609281100-abcd1234' }, async (_url, init) => { body = JSON.parse(init.body); return { ok: true }; });
  assert.equal(sent, true);
  assert.equal(body.text, '⚠ weekly-blog DB content job failed (staging); lv-runner 202609281100-abcd1234');
  const suggested = await alertFailure({ webhook: 'https://slack.example/secret', job: 'seo-improvements', target: 'staging', slot: '202609281100-abcd1234', codeSuggestion: true }, async (_url, init) => { body = JSON.parse(init.body); return { ok: true }; });
  assert.equal(suggested, true);
  assert.match(body.text, /code outside the data lane.*human PR required/);
  assert.doesNotMatch(body.text, /job failed|slack.example|invalid JSON/);
  assert.equal(await alertFailure({ webhook: 'https://slack.example/secret', job: 'news', target: 'staging', slot: '202609281217-abcd1234' }, async () => { throw new Error('offline'); }), false);
});
