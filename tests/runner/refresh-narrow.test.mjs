import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as runner from '../../ops/exedev-runner/runner.mjs';
import { extractRefreshedPost } from '../../scripts/content/refresh.mjs';

const ROOT = new URL('../../', import.meta.url);
const launcher = fs.readFileSync(new URL('ops/exedev-runner/launcher.sh', ROOT), 'utf8').split("<<'PY'")[1].split('\nPY')[0];

// Exercise the real launcher Python, real Node entry point and real query
// options. Only systemd/root accounts and the paid SDK transport are replaced.
function invoke(t, refresh, throughRunner = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-narrow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const scratch = path.join(root, 'state/scratch/test-slot');
  const sdk = path.join(source, 'node_modules/@anthropic-ai/claude-agent-sdk');
  fs.mkdirSync(sdk, { recursive: true });
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
  fs.writeFileSync(path.join(sdk, 'index.js'), `
    import fs from 'node:fs';
    export async function* query(input) {
      const posts = JSON.parse(fs.readFileSync('data/posts.json'));
      console.log('PROBE=' + JSON.stringify({ input, posts }));
      if (process.env.REFRESH_SLUG) {
        posts[0].description = 'Clearer local guide.';
        fs.writeFileSync('data/posts.json', JSON.stringify(posts));
      }
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }, { type: 'tool_use', name: 'Write' }] } };
      yield { type: 'result', subtype: 'success', num_turns: 1 };
    }
  `);
  for (const rel of ['scripts/seo-improve-agent.js', 'scripts/prompts/seo-refresh-system.md', 'scripts/prompts/seo-improve-system.md']) {
    fs.mkdirSync(path.dirname(path.join(source, rel)), { recursive: true });
    fs.copyFileSync(new URL(rel, ROOT), path.join(source, rel));
  }
  fs.mkdirSync(path.join(source, 'data'));
  fs.mkdirSync(path.join(source, '.claude'));
  fs.mkdirSync(path.join(source, '.git'));
  fs.writeFileSync(path.join(source, '.claude/settings.json'), '{"broad":"settings"}');
  fs.writeFileSync(path.join(source, 'tsconfig.json'), '{}');
  fs.writeFileSync(path.join(source, 'data/businesses.json'), '[{"slug":"other-business"}]');
  const target = throughRunner
    ? JSON.parse(fs.readFileSync(new URL('data/posts.json', ROOT))).find((p) => p.slug === refresh.slug)
    : { slug: 'target', title: 'Target' };
  assert.ok(target, 'refresh fixture target exists');
  const posts = [target, { slug: 'off-target', title: 'Other' }];
  fs.writeFileSync(path.join(source, 'data/posts.json'), JSON.stringify(posts));
  // The base implementation copied the entire tree at this same runner seam.
  (runner.prepareGeneratorScratch ?? runner.copyScratchTree)(source, scratch, refresh);
  const files = fs.readdirSync(scratch, { recursive: true });
  const state = path.join(root, 'state');
  const run = path.join(root, 'run');
  fs.mkdirSync(path.join(state, 'generator-requests'));
  fs.mkdirSync(path.join(run, 'agent-secrets'), { recursive: true });
  fs.writeFileSync(path.join(state, 'generator-requests/test-slot.json'), JSON.stringify({ dryRun: false, ...(refresh ? { refresh } : {}) }));
  fs.writeFileSync(path.join(run, 'agent-secrets/test-slot.json'), '{}');
  const block = launcher.replaceAll('/var/lib/lv-runner', state).replaceAll('/run/lv-runner', run);
  const resultFile = path.join(root, 'result.json');
  const python = `
import os, sys, types, json, pathlib, subprocess, pwd
os.geteuid = lambda: 0
os.chown = lambda *a, **kw: None
pwd.getpwnam = lambda name: types.SimpleNamespace(pw_uid=0, pw_gid=0)
real_run = subprocess.run
def system_run(args, **kwargs):
    if args[0] == 'systemctl': return types.SimpleNamespace(returncode=0, stdout=b'inactive\\n')
    return real_run(args, **kwargs)
subprocess.run = system_run
class Diag:
    def __init__(self, *a): pass
    def event(self, *a, **kw): pass
    def close(self): pass
    def relay(self, result): return None
def capture(cmd, diag, timeout):
    props = [cmd[i+1] for i,v in enumerate(cmd) if v == '-p']
    values = dict(p.split('=', 1) for p in props)
    envtext = pathlib.Path(values['EnvironmentFile']).read_text()
    env = dict(line.split('=',1) for line in envtext.splitlines())
    env = {k: json.loads(v) for k,v in env.items()}
    env['PATH'] = os.environ['PATH']
    proc = real_run(cmd[-2:], cwd=values['WorkingDirectory'], env=env, capture_output=True, text=True)
    pathlib.Path(${JSON.stringify(resultFile)}).write_text(json.dumps(dict(cmd=cmd, timeout=timeout, env=env, stdout=proc.stdout, stderr=proc.stderr)))
    return proc.returncode
sys.modules['generator_diag'] = types.SimpleNamespace(GeneratorDiagnostic=Diag, capture_generator=capture)
sys.argv = ['launcher', 'seo-improvements', 'test-slot']
exec(compile(${JSON.stringify(block)}, 'launcher', 'exec'))
`;
  let observed;
  let proc;
  if (throughRunner) {
    // Include the private generator's return and scratch cleanup, as in the
    // production binding; replace only sudo/systemd and the paid SDK transport.
    const moduleFile = path.join(root, 'runner.mjs');
    fs.writeFileSync(moduleFile, fs.readFileSync(new URL('ops/exedev-runner/runner.mjs', ROOT), 'utf8') + '\nexport { generator };\n');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'sudo'), '#!/usr/bin/env python3\n' + python, { mode: 0o755 });
    const observedFile = path.join(root, 'observed.json');
    proc = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import { pathToFileURL } from 'node:url';
      const { generator, refreshDeps } = await import(pathToFileURL(${JSON.stringify(moduleFile)}));
      const events = [];
      const file = ${JSON.stringify(path.join(source, 'data/posts.json'))};
      const deps = refreshDeps({ target: 'staging', slot: 'test-slot', request: {}, run: ${JSON.stringify(run)},
        export: () => {}, readPosts: () => JSON.parse(fs.readFileSync(file)),
        writePosts: (posts) => fs.writeFileSync(file, JSON.stringify(posts)),
        generate: (topic) => generator('seo-improvements', 'test-slot', topic, false, ${JSON.stringify(path.join(root, 'generator.jsonl'))}),
        log: (event, details) => events.push({ event, ...details }),
      });
      const result = deps.generate({ snapshotId: 1, slug: ${JSON.stringify(refresh?.slug)}, mode: 'snippet' }, {});
      fs.writeFileSync(${JSON.stringify(observedFile)}, JSON.stringify({ result, events, trusted: JSON.parse(fs.readFileSync(file)), scratchExists: fs.existsSync(${JSON.stringify(scratch)}) }));
    `], { encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LV_RUNNER_REPO: source, LV_RUNNER_STATE_ROOT: state } });
    if (proc.status === 0) observed = JSON.parse(fs.readFileSync(observedFile));
  } else {
    proc = spawnSync('python3', ['-c', python], { encoding: 'utf8', timeout: 15000 });
  }
  assert.equal(proc.status, 0, proc.stderr + (fs.existsSync(resultFile) ? fs.readFileSync(resultFile) : ''));
  const result = JSON.parse(fs.readFileSync(resultFile));
  const probes = result.stdout.split('\n').filter((line) => line.startsWith('PROBE=')).map((line) => JSON.parse(line.slice(6)));
  return { ...result, probes, files, scratch, observed, posts: throughRunner ? null : JSON.parse(fs.readFileSync(path.join(scratch, 'data/posts.json'))) };
}

test('refresh launcher Edit/Write reaches runner after through one-record scratch acceptance without false discards', (t) => {
  const slug = 'goodlife-fitness-liberty-village-review-guide';
  const generated = invoke(t, { slug, query: 'goodlife liberty village', mode: 'snippet' }, true);
  const { result, trusted, events, scratchExists } = generated.observed;
  assert.equal(extractRefreshedPost({ ...result, slug, mode: 'snippet' }).description, 'Clearer local guide.');
  assert.deepEqual(trusted, result.after);
  assert.equal(scratchExists, false, 'accepted target survives scratch cleanup');
  assert.deepEqual(result.after[1], result.before[1]);
  assert.deepEqual(events.find((e) => e.event === 'refresh-generator-output').discardedOffTarget, []);
  t.diagnostic('Real generator + launcher + Node writer: one GoodLife record edited; accepted target survives scratch deletion, reaches runner after and passes strict snippet extraction; other post unchanged; discardedOffTarget=[].');
});

test('refresh constructed launcher/SDK invocation has the refresh prompt, one record, one writable file and bounded runtime; legacy stays broad', (t) => {
  const refresh = invoke(t, { slug: 'target', query: 'target guide', mode: 'snippet' });
  assert.deepEqual(refresh.env.REFRESH_SLUG, 'target');
  assert.equal(refresh.env.REFRESH_MODE, 'snippet');
  assert.equal(refresh.env.REFRESH_QUERY, 'target guide');
  assert.equal(refresh.probes.length, 1, 'no judge, reader or revision stage');
  const { input, posts } = refresh.probes[0];
  assert.deepEqual(posts.map((p) => p.slug), ['target']);
  assert.equal(input.options.systemPrompt, fs.readFileSync(new URL('scripts/prompts/seo-refresh-system.md', ROOT), 'utf8'));
  assert.match(input.prompt, /SNIPPET REFRESH MODE/);
  assert.deepEqual(input.options.settingSources, []);
  assert.deepEqual(input.options.skills, []);
  assert.deepEqual(input.options.tools, ['Read', 'Edit', 'Write']);
  assert.equal(input.options.maxTurns, 20);
  assert.equal(input.options.maxBudgetUsd, 1);
  assert.equal(input.options.mcpServers, undefined);
  assert.deepEqual(refresh.files.filter((f) => !f.startsWith('node_modules')).sort(), [
    'data', 'data/posts.json', 'scripts', 'scripts/prompts', 'scripts/prompts/seo-refresh-system.md', 'scripts/seo-improve-agent.js',
  ]);
  assert.ok(refresh.cmd.includes(`ReadWritePaths=${refresh.scratch}/data/posts.json /var/cache/lv-generator`));
  assert.ok(refresh.cmd.includes('RuntimeMaxSec=10min'));
  assert.equal(refresh.timeout, 12 * 60);
  assert.match(refresh.stdout, /\[tool_use\] Edit/);
  assert.equal(refresh.posts[0].description, 'Clearer local guide.', 'actual Node writer exercised');

  const legacy = invoke(t, null);
  assert.equal(legacy.env.REFRESH_SLUG, undefined);
  assert.equal(legacy.probes[0].input.options.systemPrompt, fs.readFileSync(new URL('scripts/prompts/seo-improve-system.md', ROOT), 'utf8'));
  assert.deepEqual(legacy.probes[0].input.options.settingSources, ['project']);
  assert.ok(legacy.probes[0].input.options.skills.includes('internal-linker'));
  assert.equal(legacy.probes[0].input.options.maxTurns, 110);
  assert.equal(legacy.probes[0].input.options.maxBudgetUsd, 4);
  assert.ok(legacy.probes[0].input.options.mcpServers.gsc);
  assert.equal(legacy.probes[0].input.options.tools, undefined);
  assert.equal(legacy.probes[0].posts.length, 2);
  assert.ok(legacy.files.includes('tsconfig.json'));
  assert.ok(legacy.files.includes('.claude/settings.json'));
  assert.ok(legacy.files.includes('data/businesses.json'));
  assert.ok(legacy.cmd.includes(`ReadWritePaths=${legacy.scratch} /var/cache/lv-generator`));
  assert.ok(legacy.cmd.includes('RuntimeMaxSec=40min'));
  assert.equal(legacy.timeout, 45 * 60);
  t.diagnostic('Real launcher + Node writer: REFRESH_MODE=snippet; one target record; refresh system prompt; tools=Read,Edit,Write; no skills/settings/MCP; 20 turns/$1; RuntimeMaxSec=10min; legacy prompt/options/tree/runtime preserved.');
});
