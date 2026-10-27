import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as runner from '../../ops/exedev-runner/runner.mjs';
import { extractRefreshedPost } from '../../scripts/content/refresh.mjs';

const ROOT = new URL('../../', import.meta.url);
const launcher = fs.readFileSync(new URL('ops/exedev-runner/launcher.sh', ROOT), 'utf8').split("<<'PY'")[1].split('\nPY')[0];

// Exercise the real launcher Python, real Node entry point and real query
// options. Only systemd/root accounts and the paid SDK transport are replaced.
function invoke(t, refresh, throughRunner = false, scenario = 'edit') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-narrow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const scratch = path.join(root, 'state/scratch/test-slot');
  const sdk = path.join(source, 'node_modules/@anthropic-ai/claude-agent-sdk');
  fs.mkdirSync(sdk, { recursive: true });
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
  fs.writeFileSync(path.join(sdk, 'index.js'), `
    import fs from 'node:fs';
    import path from 'node:path';
    let savedPosts;
    let calls = 0;
    export async function* query(input) {
      calls++;
      const original = fs.readFileSync('data/posts.json');
      const posts = savedPosts ??= JSON.parse(original);
      console.log('PROBE=' + JSON.stringify({ input, posts }));
      if (process.env.REFRESH_SLUG) {
        yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'edit-1', name: 'Edit', input: {
          file_path: path.join(input.options.cwd, 'data/posts.json'), old_string: 'PRIVATE OLD CONTENT', new_string: 'PRIVATE NEW CONTENT'
        } }] } };
        posts[0].description = 'Clearer local guide.';
        let writeError;
        try {
          if (['failed', 'all-failed'].includes(${JSON.stringify(scenario)})) throw Object.assign(new Error('PRIVATE'), { code: 'EROFS' });
          // Claude Code saves atomically beside the target, then renames it.
          fs.writeFileSync('data/posts.json.tmp', JSON.stringify(posts), { mode: ${scenario === 'private-edit' ? '0o600' : '0o644'} });
          fs.renameSync('data/posts.json.tmp', 'data/posts.json');
          if (${['invalid-json', 'invalid-spent', 'invalid-unknown-budget'].includes(scenario) ? 'true' : 'false'} || (${scenario === 'repair-once' ? 'true' : 'false'} && calls === 1)) fs.writeFileSync('data/posts.json', 'PRIVATE malformed JSON');
        } catch (error) { writeError = error.code; }
        yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'edit-1',
          is_error: Boolean(writeError), content: (writeError || '') + ' PRIVATE TOOL OUTPUT'
        }] } };
        const writePath = ${JSON.stringify(scenario)} === 'wrong-path' ? '../other/posts.json' : './data/posts.json';
        yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'write-2', name: 'Write', input: {
          file_path: writePath, content: 'PRIVATE WRITE CONTENT'
        } }] } };
        if (${JSON.stringify(scenario)} === 'restore') fs.writeFileSync('data/posts.json', original);
        yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'write-2', is_error: ['all-failed', 'old-layout'].includes(${JSON.stringify(scenario)}), content: 'ENOSPC PRIVATE TOOL OUTPUT' }] } };
      }
      yield { type: 'result', subtype: 'success', num_turns: ${scenario === 'invalid-spent' ? '20' : '1'},
        ${scenario === 'invalid-unknown-budget' ? '' : `total_cost_usd: ${scenario === 'invalid-spent' ? '1' : '0.1'},`} };
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
  const logs = path.join(root, 'logs');
  fs.mkdirSync(logs);
  const block = launcher.replaceAll('/var/lib/lv-runner', state).replaceAll('/run/lv-runner', run).replaceAll('/var/log/lv-generator', logs);
  const resultFile = path.join(root, 'result.json');
  const python = `
import os, sys, types, json, pathlib, subprocess, pwd, importlib.util, errno
os.geteuid = lambda: 0
def chown(file, uid, gid, **kwargs):
    if pathlib.Path(file).name == 'posts.json':
        info = pathlib.Path(file).lstat()
        with pathlib.Path(${JSON.stringify(path.join(root, 'ownership.jsonl'))}).open('a') as output:
            output.write(json.dumps(dict(uid=uid, inode=info.st_ino, mode=info.st_mode & 0o777)) + '\\n')
        if uid == 102 and ${scenario === 'ownership-error' ? 'True' : 'False'}: raise OSError(errno.EPERM, 'PRIVATE')
os.chown = chown
pwd.getpwnam = lambda name: types.SimpleNamespace(pw_uid=101 if name == 'lv-generator' else 102, pw_gid=101)
real_run = subprocess.run
def system_run(args, **kwargs):
    if args[0] == 'systemctl':
        rows = [json.loads(line) for file in pathlib.Path(${JSON.stringify(logs)}).glob('*.jsonl') for line in file.read_text().splitlines()]
        with pathlib.Path(${JSON.stringify(path.join(root, 'unit-checks.jsonl'))}).open('a') as output:
            output.write(json.dumps(dict(readBackPresent=any(row.get('phase') == 'read-back' for row in rows))) + '\\n')
        return types.SimpleNamespace(returncode=0, stdout=b'inactive\\n')
    return real_run(args, **kwargs)
subprocess.run = system_run
spec = importlib.util.spec_from_file_location('generator_diag', ${JSON.stringify(new URL('ops/exedev-runner/generator_diag.py', ROOT).pathname)})
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)
def capture(cmd, diag, timeout):
    if ${scenario === 'old-layout' ? 'True' : 'False'}:
        writable = f'ReadWritePaths={scratch}/data /var/cache/lv-generator'
        cmd[cmd.index(writable)] = f'ReadWritePaths={scratch}/data/posts.json /var/cache/lv-generator'
    props = [cmd[i+1] for i,v in enumerate(cmd) if v == '-p']
    values = dict(p.split('=', 1) for p in props)
    envtext = pathlib.Path(values['EnvironmentFile']).read_text()
    env = dict(line.split('=',1) for line in envtext.splitlines())
    env = {k: json.loads(v) for k,v in env.items()}
    env['PATH'] = os.environ['PATH']
    posts_file = pathlib.Path(values['WorkingDirectory']) / 'data/posts.json'
    before = posts_file.read_bytes()
    # Simulate ProtectSystem=strict's read-only parent on macOS, keeping the
    # target file writable in both layouts. Use the real constructed unit path.
    data = posts_file.parent
    data.chmod(0o755 if str(data) in values['ReadWritePaths'].split() else 0o555)
    proc = real_run(cmd[-2:], cwd=values['WorkingDirectory'], env=env, capture_output=True, text=True)
    data.chmod(0o755)
    diag.feed_lines(proc.stdout.encode())
    if ${scenario === 'host-divergence' ? 'True' : 'False'}: posts_file.write_bytes(before)
    if ${scenario === 'host-invalid-json' ? 'True' : 'False'}: posts_file.write_text('PRIVATE malformed JSON')
    if ${scenario === 'read-denied' ? 'True' : 'False'}: posts_file.chmod(0)
    pathlib.Path(${JSON.stringify(resultFile)}).write_text(json.dumps(dict(cmd=cmd, timeout=timeout, env=env, stdout=proc.stdout, stderr=proc.stderr)))
    return 1 if ${scenario === 'helper-exit' ? 'True' : 'False'} else proc.returncode
diagnostics.capture_generator = capture
if ${scenario === 'relay-malformed' ? 'True' : 'False'}: diagnostics.GeneratorDiagnostic.refresh_relay = lambda self: b'PRIVATE malformed relay'
sys.modules['generator_diag'] = diagnostics
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
      const snapshot = { snapshotId: 1, slug: ${JSON.stringify(refresh?.slug)}, mode: 'snippet' };
      let result;
      if (${['all-failed', 'invalid-json', 'host-invalid-json', 'invalid-spent', 'invalid-unknown-budget', 'read-denied', 'helper-exit', 'relay-malformed', 'ownership-error'].includes(scenario) ? 'true' : 'false'}) {
        const { runRefreshLoop } = await import(${JSON.stringify(new URL('scripts/content/refresh.mjs', ROOT).href)});
        result = await runRefreshLoop({ deps: { ...deps,
          plan: () => ({ candidates: [{ slug: snapshot.slug }], remaining: 1 }),
          reserve: () => snapshot,
          submit: () => { throw new Error('failed writes must never reach submit'); },
          close: ({ snapshotId, reasonCode }) => ({ snapshotId, reasonCode, state: 'failed' }),
        } });
      } else result = deps.generate(snapshot, {});
      fs.writeFileSync(${JSON.stringify(observedFile)}, JSON.stringify({ result, events, trusted: JSON.parse(fs.readFileSync(file)), scratchExists: fs.existsSync(${JSON.stringify(scratch)}) }));
    `], { encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LV_RUNNER_REPO: source, LV_RUNNER_STATE_ROOT: state } });
    if (proc.status === 0) observed = JSON.parse(fs.readFileSync(observedFile));
  } else {
    proc = spawnSync('python3', ['-c', python], { encoding: 'utf8', timeout: 15000 });
  }
  assert.equal(proc.status, 0, proc.stderr + (fs.existsSync(resultFile) ? fs.readFileSync(resultFile) : ''));
  const result = JSON.parse(fs.readFileSync(resultFile));
  const probes = result.stdout.split('\n').filter((line) => line.startsWith('PROBE=')).map((line) => JSON.parse(line.slice(6)));
  const diagnostics = fs.readdirSync(logs).flatMap((file) => fs.readFileSync(path.join(logs, file), 'utf8').trim().split('\n').map(JSON.parse));
  const unitChecks = fs.readFileSync(path.join(root, 'unit-checks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const generatorLog = path.join(root, 'generator.jsonl');
  const generatorEvents = throughRunner && fs.existsSync(generatorLog) ? fs.readFileSync(generatorLog, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const ownership = fs.readFileSync(path.join(root, 'ownership.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  return { ...result, ownership, generatorEvents, probes, files, scratch, observed, diagnostics, unitChecks, posts: throughRunner ? null : JSON.parse(fs.readFileSync(path.join(scratch, 'data/posts.json'))) };
}

test('atomic inode replacement with mode 0600 restores the replacement to the runner and accepts it', (t) => {
  const generated = invoke(t, { slug: 'goodlife-fitness-liberty-village-review-guide', query: 'goodlife', mode: 'snippet' }, true, 'private-edit');
  const [handoff, restored] = generated.ownership;
  assert.notEqual(handoff.inode, restored.inode, 'temp-file rename replaces the original inode');
  assert.equal(restored.uid, 102, 'ownership walk restores the replacement, not the original inode');
  assert.equal(restored.mode, 0o600);
  assert.equal(generated.observed.result.after[0].description, 'Clearer local guide.');
  assert.equal(generated.observed.scratchExists, false);
  t.diagnostic('Mode-0600 replacement is readable and accepted after ownership restoration; this case also passes on 8053ea2, refuting mode alone as the cause.');
});

test('handoff errors reach refresh-outcome with bounded stage/code and no private content', (t) => {
  for (const [scenario, expected] of [
    ['host-invalid-json', { stage: 'output-read', code: 'invalid-json' }],
    ['invalid-json', { stage: 'output-validate', code: 'invalid-json' }],
    ['read-denied', { stage: 'output-read', code: 'EACCES' }],
    ['helper-exit', { stage: 'helper-exit', code: 'helper-exit', exit: 1 }],
    ['relay-malformed', { stage: 'relay-parse', code: 'invalid-json' }],
    ['ownership-error', { stage: 'ownership-restore', code: 'EPERM' }],
  ]) {
    const generated = invoke(t, { slug: 'goodlife-fitness-liberty-village-review-guide', query: 'goodlife', mode: 'snippet' }, true, scenario);
    const outcome = generated.observed.events.find((e) => e.event === 'refresh-outcome');
    assert.equal(outcome.reasonCode, 'refresh-generator-failed', scenario);
    assert.deepEqual(outcome.failureDetail, expected, scenario);
    assert.deepEqual(generated.generatorEvents.find((e) => e.event === 'refresh-generator-failed').failureDetail, expected, 'installed runner retains cause with an older pinned loop');
    assert.ok(!JSON.stringify(generated.observed.events).includes('PRIVATE'), scenario);
    assert.equal(generated.observed.scratchExists, false, scenario);
  }
});

test('malformed writer JSON gets one syntax-only repair within the original caps or fails closed', (t) => {
  const refresh = { slug: 'goodlife-fitness-liberty-village-review-guide', query: 'goodlife', mode: 'snippet' };
  const repaired = invoke(t, refresh, true, 'repair-once');
  assert.equal(repaired.probes.length, 2);
  const repair = repaired.probes[1].input;
  assert.equal(repair.options.maxTurns, 19);
  assert.equal(repair.options.maxBudgetUsd, 0.9);
  assert.deepEqual(repair.options.tools, ['Read', 'Edit', 'Write']);
  assert.deepEqual(repair.options.settingSources, []);
  assert.deepEqual(repair.options.skills, []);
  assert.equal(repair.options.mcpServers, undefined);
  assert.match(repair.prompt, /Repair JSON syntax only/);
  assert.match(repair.prompt, /SNIPPET REFRESH MODE/);
  assert.deepEqual(repaired.diagnostics.filter((e) => e.event === 'refresh-output'), [
    { event: 'refresh-output', attempt: 1, status: 'invalid-json' },
    { event: 'refresh-output', attempt: 2, status: 'valid' },
  ]);
  assert.deepEqual(repaired.diagnostics.filter((e) => e.event === 'refresh-write').map((e) => e.sequence), [1, 2, 3, 4]);
  assert.equal(extractRefreshedPost({ ...repaired.observed.result, ...refresh }).description, 'Clearer local guide.');
  assert.deepEqual(repaired.observed.result.after[1], repaired.observed.result.before[1]);
  for (const [scenario, attempts] of [['invalid-json', 2], ['invalid-spent', 1], ['invalid-unknown-budget', 1]]) {
    const refused = invoke(t, refresh, true, scenario);
    assert.equal(refused.probes.length, attempts, scenario);
    assert.equal(refused.observed.result.outcomes[0].reasonCode, 'refresh-generator-failed');
    assert.deepEqual(refused.observed.events.find((e) => e.event === 'refresh-outcome').failureDetail, { stage: 'output-validate', code: 'invalid-json' });
    assert.equal(refused.observed.scratchExists, false);
    assert.ok(!JSON.stringify(refused.observed.events).includes('PRIVATE'));
  }
  t.diagnostic('Real launcher + writer + runner: malformed saved JSON repaired once with remaining 19 turns/$0.90; repeated invalid JSON or exhausted/unknown budgets never submit.');
});

test('refresh launcher Edit/Write reaches runner after through one-record scratch acceptance without false discards', (t) => {
  const slug = 'goodlife-fitness-liberty-village-review-guide';
  const generated = invoke(t, { slug, query: 'goodlife liberty village', mode: 'snippet' }, true);
  const { result, trusted, events, scratchExists } = generated.observed;
  assert.equal(extractRefreshedPost({ ...result, slug, mode: 'snippet' }).description, 'Clearer local guide.');
  assert.deepEqual(trusted, result.after);
  assert.equal(scratchExists, false, 'accepted target survives scratch cleanup');
  assert.deepEqual(result.after[1], result.before[1]);
  assert.deepEqual(events.find((e) => e.event === 'refresh-generator-output').discardedOffTarget, []);
  const hashes = generated.diagnostics.filter((e) => e.event === 'refresh-file');
  const fingerprint = (bytes) => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  const beforeBytes = Buffer.from(JSON.stringify([result.before[0]]) + '\n');
  const afterBytes = Buffer.from(JSON.stringify([result.after[0]]));
  assert.deepEqual(hashes, [
    { event: 'refresh-file', phase: 'handoff', ...fingerprint(beforeBytes) },
    { event: 'refresh-file', phase: 'writer-handoff', ...fingerprint(beforeBytes) },
    { event: 'refresh-file', phase: 'tool-result', sequence: 1, ...fingerprint(afterBytes) },
    { event: 'refresh-file', phase: 'tool-result', sequence: 2, ...fingerprint(afterBytes) },
    { event: 'refresh-file', phase: 'writer-read-back', ...fingerprint(afterBytes) },
    { event: 'refresh-file', phase: 'read-back', ...fingerprint(afterBytes) },
  ]);
  assert.deepEqual(generated.diagnostics.filter((e) => e.event === 'refresh-write'), [
    { event: 'refresh-write', sequence: 1, tool: 'Edit', file_path: 'data/posts.json' },
    { event: 'refresh-write', sequence: 2, tool: 'Write', file_path: 'data/posts.json' },
  ]);
  assert.ok(!JSON.stringify(generated.diagnostics).includes('PRIVATE'));
  assert.deepEqual(generated.unitChecks, [{ readBackPresent: false }, { readBackPresent: true }], 'host read-back is measured only after confirming the writer stopped');
  t.diagnostic('Real generator + launcher + Node writer: one GoodLife record edited; accepted target survives scratch deletion, reaches runner after and passes strict snippet extraction; other post unchanged; discardedOffTarget=[].');
});

test('refresh constructed launcher/SDK invocation has the refresh prompt, one record, one writable directory and bounded runtime; legacy stays broad', (t) => {
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
  assert.ok(refresh.cmd.includes(`ReadWritePaths=${refresh.scratch}/data /var/cache/lv-generator`));
  assert.equal(fs.statSync(path.join(refresh.scratch, 'data')).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(path.join(refresh.scratch, 'data')), ['posts.json']);
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
  assert.ok(!legacy.diagnostics.some((e) => e.event.startsWith('refresh-')), 'legacy diagnostics stay unchanged');
  t.diagnostic('Real launcher + Node writer: REFRESH_MODE=snippet; one target record; refresh system prompt; tools=Read,Edit,Write; no skills/settings/MCP; 20 turns/$1; RuntimeMaxSec=10min; legacy prompt/options/tree/runtime preserved.');
});

for (const scenario of ['restore', 'failed', 'wrong-path', 'host-divergence']) {
  test(`refresh diagnostics distinguish ${scenario} without content`, (t) => {
    const { diagnostics } = invoke(t, { slug: 'target', query: 'target guide', mode: 'snippet' }, false, scenario);
    const hashes = diagnostics.filter((e) => e.event === 'refresh-file');
    const handoff = hashes.find((e) => e.phase === 'handoff').sha256;
    const afterEdit = hashes.find((e) => e.sequence === 1).sha256;
    const afterWrite = hashes.find((e) => e.sequence === 2).sha256;
    assert.equal(hashes.find((e) => e.phase === 'writer-read-back').sha256, afterWrite);
    assert.equal(hashes.find((e) => e.phase === 'read-back').sha256, scenario === 'host-divergence' ? handoff : afterWrite);
    if (scenario === 'restore') {
      assert.notEqual(afterEdit, handoff);
      assert.equal(afterWrite, handoff, 'the second write restored the original bytes');
    } else if (scenario === 'failed') {
      assert.equal(afterEdit, handoff);
      assert.deepEqual(diagnostics.find((e) => e.event === 'refresh-write-result'), {
        event: 'refresh-write-result', sequence: 1, isError: true, errorCode: 'EROFS',
      });
    } else if (scenario === 'wrong-path') {
      assert.equal(diagnostics.filter((e) => e.event === 'refresh-write')[1].file_path, '../other/posts.json');
    } else {
      assert.notEqual(afterWrite, handoff, 'writer and host views diverged after the helper returned');
    }
    assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'));
  });
}


test('atomic refresh save fails with old file-only writable layout and passes with directory layout', (t) => {
  const refresh = { slug: 'target', query: 'target guide', mode: 'snippet' };
  const old = invoke(t, refresh, false, 'old-layout');
  assert.equal(old.posts[0].description, undefined, 'read-only parent prevents temp-file creation');
  const failure = old.diagnostics.find((e) => e.event === 'refresh-write-result');
  assert.equal(failure.isError, true);
  assert.equal(failure.errorCode, 'EACCES', 'chmod simulation reports EACCES; systemd read-only mount reports EROFS');
  const current = invoke(t, refresh);
  assert.equal(current.posts[0].description, 'Clearer local guide.');
  assert.equal(current.diagnostics.find((e) => e.event === 'refresh-write-result').isError, false);
  assert.deepEqual(fs.readdirSync(path.join(current.scratch, 'data')), ['posts.json'], 'temp file renamed into the target');
  t.diagnostic('Atomic temp-write + rename: old file-only layout denied with EACCES; new directory layout saved the one-record file.');
});

test('all refresh writes failing relays first error and closes with refresh-write-failed', (t) => {
  const generated = invoke(t, { slug: 'goodlife-fitness-liberty-village-review-guide', query: 'goodlife', mode: 'snippet' }, true, 'all-failed');
  const { at, ...failure } = generated.generatorEvents.find((e) => e.event === 'refresh-write-failed');
  assert.ok(at);
  assert.deepEqual(failure, {
    event: 'refresh-write-failed', reasonCode: 'refresh-write-failed', errorCode: 'EROFS',
  });
  assert.equal(generated.observed.result.outcomes[0].reasonCode, 'refresh-write-failed');
  assert.equal(generated.observed.scratchExists, false);
  assert.ok(!generated.observed.events.some((e) => e.event === 'refresh-no-change'));
  assert.equal(generated.diagnostics.filter((e) => e.event === 'refresh-write-result').length, 2);
  t.diagnostic('Real launcher + Node writer + runner loop: EROFS then ENOSPC closes refresh-write-failed, records first errorCode EROFS, never submits, and cleans scratch.');
});
