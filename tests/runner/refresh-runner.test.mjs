// Runner glue for the refresh loop: the CLI calls, exit codes and the on-demand
// --topic / --dry-run handling around scripts/content/refresh.mjs runRefreshLoop.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acceptGeneratedOutput, copyScratchTree, refreshDeps } from '../../ops/exedev-runner/runner.mjs';
import { extractRefreshedPost, refreshLogLine, runRefreshLoop } from '../../scripts/content/refresh.mjs';
import { canonicalJson } from '../../scripts/automation/blog-source-pack.mjs';
import seoAgent from '../../scripts/seo-improve-agent.js';
import { hasTestDb, seededDb } from '../content/fixtures/content-db.mjs';

const PLAN = { isoWeek: '2026-W45', remaining: 2, attemptsLeft: 4, candidates: [{ slug: 'a', score: 9, title: 'A' }, { slug: 'b', score: 5, title: 'B' }], settled: [] };
function harness(request, rewrite = (posts, topic) => posts.map((p) => (p.slug === topic.refresh.slug ? { ...p, title: `${p.title}!` } : p))) {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-refresh-run-'));
  const calls = [];
  const events = [];
  let posts = [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }];
  const cli = (args, allowExit = []) => {
    calls.push({ args, allowExit });
    const [, sub] = args;
    if (sub === 'plan') return { stdout: JSON.stringify(PLAN) };
    if (sub === 'reserve') {
      const slug = JSON.parse(fs.readFileSync(args[args.indexOf('--candidate') + 1], 'utf8')).slug;
      return { stdout: JSON.stringify({ snapshotId: slug === 'a' ? 1 : 2, slug, targetQuery: `q ${slug}`, mode: slug === 'b' ? 'snippet' : 'full' }) };
    }
    if (sub === 'submit') {
      const before = JSON.parse(fs.readFileSync(args[args.indexOf('--before') + 1], 'utf8'));
      const after = JSON.parse(fs.readFileSync(args[args.indexOf('--after') + 1], 'utf8'));
      const snapshotId = Number(args[args.indexOf('--snapshot') + 1]);
      const slug = snapshotId === 1 ? 'a' : 'b';
      try {
        const record = extractRefreshedPost({ before, after, slug });
        return { stdout: JSON.stringify({ snapshotId, slug, state: 'published', after: { title: record.title } }) };
      } catch (error) {
        return { stdout: JSON.stringify({ snapshotId, slug, state: 'failed', reasonCode: error.reason }) };
      }
    }
    if (sub === 'close') return { stdout: JSON.stringify({ snapshotId: Number(args[3]), state: 'failed', reasonCode: args[5] }) };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const generated = [];
  const deps = refreshDeps({
    target: 'staging', slot: '202611030423-abcd1234', request, run, cli, export: () => calls.push({ args: ['export'] }),
    generate: (topic) => { generated.push(topic); posts = rewrite(posts, topic); },
    readPosts: () => posts, writePosts: (value) => { posts = value; }, log: (event, details) => events.push({ event, details }),
  });
  return { deps, calls, events, generated };
}

test('refresh runner: plan -> reserve -> export -> generator(refresh slug) -> submit with exits 2/3 allowed', async () => {
  const h = harness({});
  const result = await runRefreshLoop({ deps: h.deps });
  assert.equal(result.refreshed, 2);
  assert.deepEqual(h.generated, [{ title: 'A', refresh: { slug: 'a', query: 'q a', mode: 'full' } }, { title: 'B', refresh: { slug: 'b', query: 'q b', mode: 'snippet' } }], 'the lane reaches the generator request');
  const submit = h.calls.find((c) => c.args[1] === 'submit');
  assert.deepEqual(submit.allowExit, [2, 3], 'refused/rejected (2) and propagation pending (3) are outcomes, not crashes');
  assert.ok(submit.args.includes('runner:seo-improvements#202611030423-abcd1234'));
  assert.ok(h.calls.findIndex((c) => c.args[0] === 'export') < h.calls.findIndex((c) => c.args[1] === 'submit'), 'fresh export before generation');
  assert.deepEqual(h.events.filter((e) => e.event === 'refresh-outcome').map((e) => e.details.state), ['published', 'published']);
});

test('refresh runner: --topic refreshes only that slug; --dry-run plans and changes nothing', async () => {
  const one = harness({ topic: 'b' });
  assert.equal((await runRefreshLoop({ deps: one.deps })).attempted, 1);
  assert.deepEqual(one.generated.map((g) => g.refresh.slug), ['b']);
  const dry = harness({ dryRun: true });
  const result = await runRefreshLoop({ deps: dry.deps });
  assert.equal(result.attempted, 0);
  assert.equal(dry.generated.length, 0);
  assert.ok(!dry.calls.some((c) => ['reserve', 'submit'].includes(c.args[1])), 'a dry run never snapshots or submits');
});

test('refresh runner: a generator failure closes the snapshot with a reason and ends the run', async () => {
  const h = harness({});
  h.deps.generate = () => { throw new Error('generator technical failure'); };
  const result = await runRefreshLoop({ deps: h.deps });
  assert.equal(result.attempted, 1);
  assert.deepEqual(h.events.find((e) => e.event === 'refresh-outcome').details.reasonCode, 'refresh-generator-failed');
  assert.ok(h.calls.some((c) => c.args[1] === 'close' && c.args.includes('refresh-generator-failed')));
  assert.deepEqual(h.events.find((e) => e.event === 'refresh-outcome').details.failureDetail, { stage: 'generate', code: 'unknown' });
  assert.deepEqual(refreshLogLine({ reasonCode: 'refresh-generator-failed', failureDetail: {
    stage: 'PRIVATE'.repeat(1000), code: 'PRIVATE', exit: 1000, message: 'PRIVATE',
  } }).failureDetail, { stage: 'generate', code: 'unknown' });
});

// Real export -> runner before -> scratch writer -> accepted output -> runner
// after. Sorted JSON keys change serialization, never another post's values.
test('refresh runner: DB export and scratch key ordering allow a single-post refresh', { skip: !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set' }, async (t) => {
  const handle = await seededDb();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-refresh-export-'));
  t.after(async () => { fs.rmSync(root, { recursive: true, force: true }); await handle.close(); });
  const trusted = path.join(root, 'trusted');
  const scratch = path.join(root, 'scratch');
  const run = path.join(root, 'run');
  fs.mkdirSync(run);
  const postsFile = path.join(trusted, 'data', 'posts.json');
  const cliFile = fileURLToPath(new URL('../../scripts/content/cli.mjs', import.meta.url));
  let editOther = false;
  const deps = refreshDeps({
    target: 'test', slot: 'refresh-ordering', request: {}, run, log: () => {},
    export: () => {
      const exported = spawnSync(process.execPath, [cliFile, 'export', '--root', trusted, '--target', 'test'], {
        encoding: 'utf8', env: { PATH: process.env.PATH, CONTENT_DATABASE_URL: handle.url, CONTENT_DB_NAME: handle.name },
      });
      assert.equal(exported.status, 0, exported.stderr);
    },
    readPosts: () => JSON.parse(fs.readFileSync(postsFile, 'utf8')),
    writePosts: (posts) => fs.writeFileSync(postsFile, JSON.stringify(posts)),
    generate: ({ refresh }) => {
      fs.rmSync(scratch, { recursive: true, force: true });
      copyScratchTree(trusted, scratch);
      const output = path.join(scratch, 'data', 'posts.json');
      const posts = JSON.parse(fs.readFileSync(output, 'utf8'));
      posts.find((p) => p.slug === refresh.slug).title += ': clearer guide';
      if (editOther) posts.find((p) => p.slug !== refresh.slug).description += ' Actual off-target edit.';
      fs.writeFileSync(output, canonicalJson(posts));
      acceptGeneratedOutput(scratch, trusted, 'seo-improvements', ['data/posts.json']);
    },
  });
  const slug = (await handle.db.query("select key from content.entries where dataset='posts' and live_rev is not null order by position limit 1")).rows[0].key;
  const generated = deps.generate({ slug, mode: 'snippet' }, { title: 'Refresh' });
  const other = generated.before.find((p) => p.slug !== slug);
  assert.notEqual(JSON.stringify(other), JSON.stringify(JSON.parse(fs.readFileSync(path.join(scratch, 'data/posts.json'), 'utf8')).find((p) => p.slug === other.slug)), 'scratch really reordered keys');
  assert.deepEqual(generated.after.find((p) => p.slug === other.slug), other, 'all non-target values remain identical');
  assert.equal(extractRefreshedPost({ ...generated, slug, mode: 'snippet' }).title, `${generated.before.find((p) => p.slug === slug).title}: clearer guide`);
  editOther = true;
  const bad = deps.generate({ slug, mode: 'snippet' }, { title: 'Refresh' });
  assert.deepEqual(bad.after.filter((p) => p.slug !== slug), bad.before.filter((p) => p.slug !== slug));
  assert.ok(extractRefreshedPost({ ...bad, slug, mode: 'snippet' }));
});

test('refresh runner grafts only the target, serializes only that change and logs discarded slugs', async () => {
  const h = harness({ topic: 'a' }, (posts) => posts.map((p) => ({ ...p, title: `${p.title}!`, ...(p.slug === 'b' ? { content: 'PRIVATE BODY', updatedAt: '2026-11-02' } : {}) })));
  assert.equal((await runRefreshLoop({ deps: h.deps })).refreshed, 1);
  const submit = h.calls.find((c) => c.args[1] === 'submit').args;
  const before = JSON.parse(fs.readFileSync(submit[submit.indexOf('--before') + 1], 'utf8'));
  const after = JSON.parse(fs.readFileSync(submit[submit.indexOf('--after') + 1], 'utf8'));
  assert.equal(extractRefreshedPost({ before, after, slug: 'a' }).title, 'A!');
  assert.deepEqual(after[1], before[1]);
  assert.deepEqual(h.events.find((e) => e.details?.discardedOffTarget).details.discardedOffTarget, ['b']);
  assert.ok(!JSON.stringify(h.events).includes('PRIVATE BODY'));
});

for (const [name, rewrite, reasonCode] of [
  ['missing target', (posts) => posts.filter((p) => p.slug !== 'a'), 'refresh-slug-changed'],
  ['changed target slug', (posts) => posts.map((p) => p.slug === 'a' ? { ...p, slug: 'renamed' } : p), 'refresh-slug-changed'],
  ['unchanged target with other edits', (posts) => posts.map((p) => p.slug === 'b' ? { ...p, title: 'Other edit' } : p), 'refresh-no-change'],
]) test(`refresh runner still refuses ${name}`, async () => {
  const h = harness({ topic: 'a' }, rewrite);
  const result = await runRefreshLoop({ deps: h.deps });
  assert.equal(result.refreshed, 0);
  assert.equal(result.outcomes[0].reasonCode, reasonCode);
  assert.equal(h.events.find((e) => e.event === 'refresh-outcome').details.reasonCode, reasonCode);
});

test('refresh discard log caps slug count and excludes invalid slugs and bodies', () => {
  const h = harness({}, (posts) => [...posts.map((p) => p.slug === 'a' ? { ...p, title: 'A!' } : p),
    { slug: 'PRIVATE BODY / invalid' }, { slug: 'x'.repeat(129) },
    ...Array.from({ length: 30 }, (_, i) => ({ slug: `added-${i}`, content: 'PRIVATE BODY' }))]);
  h.deps.generate({ slug: 'a' }, {});
  const details = h.events.find((e) => e.details?.discardedOffTarget).details;
  assert.deepEqual(details.discardedOffTarget, Array.from({ length: 20 }, (_, i) => `added-${i}`));
  assert.ok(!JSON.stringify(details).includes('PRIVATE BODY'));
});

test('refresh-no-change logs only emitted target snippet differences and lengths, including exact no-op', (t) => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-refresh-diff-'));
  t.after(() => fs.rmSync(run, { recursive: true, force: true }));
  const before = { slug: 'a', title: 'PRIVATE TITLE', description: 'PRIVATE DESCRIPTION', content: 'PRIVATE INTRO\n\n## Body\nPRIVATE BODY' };
  for (const [original, emitted, reasonCode, expected] of [
    [before, { ...before }, 'refresh-no-change', { generatorNoOp: true, fields: {
      title: { changed: false, beforeLength: 13, afterLength: 13 },
      description: { changed: false, beforeLength: 19, afterLength: 19 },
      intro: { changed: false, beforeLength: 15, afterLength: 15 },
    } }],
    [before, { ...before, title: 'CHANGED TITLE', description: 'CHANGED', content: 'NEW INTRO\n\n## Body\nPRIVATE BODY' }, 'refresh-no-change', { generatorNoOp: false, fields: {
      title: { changed: true, beforeLength: 13, afterLength: 13 },
      description: { changed: true, beforeLength: 19, afterLength: 7 },
      intro: { changed: true, beforeLength: 15, afterLength: 11 },
    } }],
    [{ ...before, content: 'FIRST\n\nPRIVATE BODY' }, { ...before, content: 'NEW FIRST\n\nPRIVATE BODY' }, 'refresh-no-change', { generatorNoOp: false, fields: {
      title: { changed: false, beforeLength: 13, afterLength: 13 },
      description: { changed: false, beforeLength: 19, afterLength: 19 },
      intro: { changed: true, beforeLength: 5, afterLength: 9 },
    } }],
    [before, { ...before, title: 'CHANGED TITLE' }, null, null],
  ]) {
    let posts = [original, { slug: 'other', title: 'PRIVATE OTHER' }];
    const events = [];
    const deps = refreshDeps({ target: 'staging', slot: 'diff', request: {}, run,
      export: () => {}, readPosts: () => posts, writePosts: (value) => { posts = value; },
      generate: () => ({ posts: [emitted] }),
      cli: () => ({ stdout: JSON.stringify({ state: reasonCode ? 'failed' : 'published', reasonCode }) }),
      log: (event, details) => events.push({ event, ...details }),
    });
    const snapshot = { snapshotId: 1, slug: 'a', mode: 'snippet' };
    const generated = deps.generate(snapshot, {});
    // Diagnose the generator's emitted record even if the submit reports no
    // change unexpectedly. Reading the checkout again would hide this evidence.
    posts = [original];
    deps.submit(snapshot, generated);
    const diagnostic = events.find((e) => e.event === 'refresh-no-change');
    assert.deepEqual(diagnostic, expected ? { event: 'refresh-no-change', snapshotId: 1, ...expected } : undefined);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|CHANGED|NEW INTRO|NEW FIRST/);
  }
  t.diagnostic('refresh-no-change: emitted title/description/intro flags and lengths observed; exact emitted no-op logs generatorNoOp:true; first-paragraph fallback covered; no field text logged.');
});

test('refresh output stays in scratch until grafted; other data and task files never transfer', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-refresh-transfer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scratch = path.join(root, 'scratch');
  const trusted = path.join(root, 'trusted');
  for (const dir of [scratch, trusted]) {
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tasks'));
  }
  const before = [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }];
  const output = before.map((p) => ({ ...p, title: 'Changed' }));
  fs.writeFileSync(path.join(trusted, 'data/posts.json'), JSON.stringify(before));
  fs.writeFileSync(path.join(trusted, 'data/businesses.json'), '[]');
  fs.writeFileSync(path.join(scratch, 'data/posts.json'), JSON.stringify(output));
  fs.writeFileSync(path.join(scratch, 'data/businesses.json'), '[{"slug":"off-target"}]');
  fs.writeFileSync(path.join(scratch, 'tasks/seo-improve-summary.md'), 'PRIVATE BODY');
  const accepted = acceptGeneratedOutput(scratch, trusted, 'seo-improvements', ['data/posts.json', 'data/businesses.json', 'tasks/seo-improve-summary.md'], before, true);
  assert.deepEqual(accepted.posts, output);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(trusted, 'data/posts.json'), 'utf8')), before);
  assert.equal(fs.readFileSync(path.join(trusted, 'data/businesses.json'), 'utf8'), '[]');
  assert.ok(!fs.existsSync(path.join(trusted, 'tasks/seo-improve-summary.md')));
});

test('refresh writer options scope both builder and revise without broad SEO prompt or skills', (t) => {
  const env = { REFRESH_SLUG: process.env.REFRESH_SLUG, REFRESH_MODE: process.env.REFRESH_MODE };
  t.after(() => { for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  assert.equal(typeof seoAgent.writerOptions, 'function');
  for (const mode of ['full', 'snippet']) {
    process.env.REFRESH_SLUG = 'a'; process.env.REFRESH_MODE = mode;
    for (const revision of ['', 'Fix review issues']) {
      const opts = seoAgent.writerOptions({ revision, topicFocus: 'Broad opportunity' });
      const system = fs.readFileSync(opts.systemPromptPath, 'utf8');
      assert.match(opts.prompt, /ONLY.*a/);
      assert.doesNotMatch(system + opts.prompt, /cannibalization|internal-linker|10 files|Broad opportunity/i);
      assert.deepEqual(opts.skills, []);
      assert.deepEqual(opts.settingSources, []);
      assert.match(opts.prompt, mode === 'snippet' ? /SNIPPET REFRESH MODE/ : /REFRESH MODE/);
      if (revision) assert.ok(opts.prompt.includes(revision));
    }
  }
  delete process.env.REFRESH_SLUG;
  const general = seoAgent.writerOptions({});
  assert.ok(general.skills.includes('internal-linker'), 'legacy SEO keeps its skills');
  assert.match(fs.readFileSync(general.systemPromptPath, 'utf8'), /cannibalization/);
});
