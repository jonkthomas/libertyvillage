// Runner glue for the refresh loop: the CLI calls, exit codes and the on-demand
// --topic / --dry-run handling around scripts/content/refresh.mjs runRefreshLoop.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshDeps } from '../../ops/exedev-runner/runner.mjs';
import { runRefreshLoop } from '../../scripts/content/refresh.mjs';

const PLAN = { isoWeek: '2026-W45', remaining: 2, attemptsLeft: 4, candidates: [{ slug: 'a', score: 9, title: 'A' }, { slug: 'b', score: 5, title: 'B' }], settled: [] };
function harness(request) {
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
      const after = JSON.parse(fs.readFileSync(args[args.indexOf('--after') + 1], 'utf8'));
      return { stdout: JSON.stringify({ snapshotId: Number(args[args.indexOf('--snapshot') + 1]), slug: after[0].slug, state: 'published', after: { title: after[0].title } }) };
    }
    if (sub === 'close') return { stdout: JSON.stringify({ snapshotId: Number(args[3]), state: 'failed', reasonCode: args[5] }) };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const generated = [];
  const deps = refreshDeps({
    target: 'staging', slot: '202611030423-abcd1234', request, run, cli, export: () => calls.push({ args: ['export'] }),
    generate: (topic) => { generated.push(topic); posts = posts.map((p) => (p.slug === topic.refresh.slug ? { ...p, title: `${p.title}!` } : p)); },
    readPosts: () => posts, log: (event, details) => events.push({ event, details }),
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
});
