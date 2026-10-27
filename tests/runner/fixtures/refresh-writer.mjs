import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as runner from '../../../ops/exedev-runner/runner.mjs';

const ROOT = new URL('../../../', import.meta.url);
const launcher = fs.readFileSync(new URL('ops/exedev-runner/launcher.sh', ROOT), 'utf8').split("<<'PY'")[1].split('\nPY')[0];

// Exercise the real launcher Python, real Node entry point and real query
// options. Only systemd/root accounts and the paid SDK transport are replaced.
export function invoke(t, refresh, throughRunner = false, scenario = 'edit', { target: targetOverride } = {}) {
  const dataset = refresh?.dataset ?? 'posts';
  const dataFile = `data/${dataset}.json`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-narrow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  if (refresh) {
    // Own the inventory ref, including in depth-1 CI checkouts without origin/staging.
    execFileSync('git', ['clone', '--quiet', '--shared', '--single-branch', '--no-checkout', ROOT.pathname, source]);
    execFileSync('git', ['update-ref', 'refs/remotes/origin/staging', 'HEAD'], { cwd: source });
  }
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
      const original = fs.readFileSync('${dataFile}');
      const posts = savedPosts ??= JSON.parse(original);
      console.log('PROBE=' + JSON.stringify({ input, posts }));
      if (process.env.REFRESH_SLUG) {
        yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'edit-1', name: 'Edit', input: {
          file_path: path.join(input.options.cwd, '${dataFile}'), old_string: 'PRIVATE OLD CONTENT', new_string: 'PRIVATE NEW CONTENT'
        } }] } };
        posts[0].description = ${JSON.stringify(scenario === 'voice-warn' ? 'A vibrant local guide.' : 'Clearer local guide.')};
        if (${['lint-repair', 'lint-stays', 'json-then-lint', 'lint-spent', 'lint-unknown-budget'].includes(scenario) ? 'true' : 'false'}) {
          const body = posts[0].content.slice(posts[0].content.indexOf('## '));
          posts[0].content = (calls === 1 || ${scenario !== 'lint-repair' ? 'true' : 'false'}
            ? 'GoodLife Fitness Liberty Village is at 47 Jefferson Ave.'
            : 'GoodLife Fitness Liberty Village is at 85 Hanna Ave Suite 200, Toronto, ON M6K 3S3.') + '\\n\\n' + body;
        }
        if (${['title-repair', 'title-stays', 'json-then-title'].includes(scenario) ? 'true' : 'false'}) {
          posts[0].title = calls === 1 || ${scenario !== 'title-repair' ? 'true' : 'false'}
            ? 'GoodLife Liberty Village: 3.8★ Review, Hours & Tips'
            : 'GoodLife Fitness Review: Prices, Hours & Tips';
        }
        let writeError;
        try {
          if (['failed', 'all-failed'].includes(${JSON.stringify(scenario)})) throw Object.assign(new Error('PRIVATE'), { code: 'EROFS' });
          // Claude Code saves atomically beside the target, then renames it.
          fs.writeFileSync('${dataFile}.tmp', JSON.stringify(posts), { mode: ${scenario === 'private-edit' ? '0o600' : '0o644'} });
          fs.renameSync('${dataFile}.tmp', '${dataFile}');
          if (${['invalid-json', 'invalid-spent', 'invalid-unknown-budget'].includes(scenario) ? 'true' : 'false'} || (${['repair-once', 'json-then-lint', 'json-then-title'].includes(scenario) ? 'true' : 'false'} && calls === 1)) fs.writeFileSync('${dataFile}', 'PRIVATE malformed JSON');
        } catch (error) { writeError = error.code; }
        yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'edit-1',
          is_error: Boolean(writeError), content: (writeError || '') + ' PRIVATE TOOL OUTPUT'
        }] } };
        const writePath = ${JSON.stringify(scenario)} === 'wrong-path' ? '../other/posts.json' : './${dataFile}';
        yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'write-2', name: 'Write', input: {
          file_path: writePath, content: 'PRIVATE WRITE CONTENT'
        } }] } };
        if (${JSON.stringify(scenario)} === 'restore') fs.writeFileSync('${dataFile}', original);
        yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'write-2', is_error: ['all-failed', 'old-layout'].includes(${JSON.stringify(scenario)}), content: 'ENOSPC PRIVATE TOOL OUTPUT' }] } };
      }
      yield { type: 'result', subtype: 'success', num_turns: ${['invalid-spent', 'lint-spent'].includes(scenario) ? '20' : '1'},
        ${['invalid-unknown-budget', 'lint-unknown-budget'].includes(scenario) ? '' : `total_cost_usd: ${['invalid-spent', 'lint-spent'].includes(scenario) ? '1' : '0.1'},`} };
    }
  `);
  for (const rel of [...runner.REFRESH_RUNTIME_FILES, 'scripts/prompts/seo-improve-system.md']) {
    fs.mkdirSync(path.dirname(path.join(source, rel)), { recursive: true });
    fs.copyFileSync(new URL(rel, ROOT), path.join(source, rel));
  }
  fs.mkdirSync(path.join(source, 'data'));
  fs.mkdirSync(path.join(source, '.claude'));
  if (!refresh) fs.mkdirSync(path.join(source, '.git'));
  fs.writeFileSync(path.join(source, '.claude/settings.json'), '{"broad":"settings"}');
  fs.writeFileSync(path.join(source, 'tsconfig.json'), '{}');
  for (const dataset of ['posts', 'businesses', 'services', 'topics']) fs.copyFileSync(new URL(`data/${dataset}.json`, ROOT), path.join(source, `data/${dataset}.json`));
  const target = targetOverride ?? (throughRunner
    ? JSON.parse(fs.readFileSync(new URL(dataFile, ROOT))).find((p) => p.slug === refresh.slug)
    : { ...JSON.parse(fs.readFileSync(new URL(dataFile, ROOT)))[0], slug: 'target', title: 'Target',
      content: 'Local guide.\n\n## Details\nLocal details.', answerBlock: 'Local guide.', faqs: [], keyTakeaways: [], relatedPosts: [], relatedServices: [], relatedTopics: [] });
  assert.ok(target, 'refresh fixture target exists');
  const posts = [target, { slug: 'off-target', title: 'Other' }];
  fs.writeFileSync(path.join(source, dataFile), JSON.stringify(posts));
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
    if pathlib.Path(file).name == '${dataset}.json':
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
    posts_file = pathlib.Path(values['WorkingDirectory']) / '${dataFile}'
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
      const file = ${JSON.stringify(path.join(source, dataFile))};
      const deps = refreshDeps({ target: 'staging', slot: 'test-slot', request: {}, run: ${JSON.stringify(run)},
        learnings: ${JSON.stringify(refresh?.learnings ?? '')},
        export: () => {}, readPosts: () => JSON.parse(fs.readFileSync(file)),
        writePosts: (posts) => fs.writeFileSync(file, JSON.stringify(posts)),
        generate: (topic) => generator('seo-improvements', 'test-slot', topic, false, ${JSON.stringify(path.join(root, 'generator.jsonl'))}),
        log: (event, details) => events.push({ event, ...details }),
      });
      const snapshot = { snapshotId: 1, dataset: ${JSON.stringify(dataset)}, slug: ${JSON.stringify(refresh?.slug)}, mode: 'snippet' };
      let result;
      let submissions = 0;
      if (${['all-failed', 'invalid-json', 'host-invalid-json', 'invalid-spent', 'invalid-unknown-budget', 'read-denied', 'helper-exit', 'relay-malformed', 'ownership-error', 'lint-stays', 'json-then-lint', 'lint-spent', 'lint-unknown-budget', 'title-stays', 'json-then-title'].includes(scenario) ? 'true' : 'false'}) {
        const { runRefreshLoop } = await import(${JSON.stringify(new URL('scripts/content/refresh.mjs', ROOT).href)});
        result = await runRefreshLoop({ deps: { ...deps,
          plan: () => ({ candidates: [{ slug: snapshot.slug }], remaining: 1 }),
          reserve: () => snapshot,
          submit: () => { submissions++; throw new Error('failed writes must never reach submit'); },
          close: ({ snapshotId, reasonCode }) => ({ snapshotId, reasonCode, state: 'failed' }),
        } });
      } else result = deps.generate(snapshot, {});
      fs.writeFileSync(${JSON.stringify(observedFile)}, JSON.stringify({ result, events, submissions, trusted: JSON.parse(fs.readFileSync(file)), scratchExists: fs.existsSync(${JSON.stringify(scratch)}) }));
    `], { encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LV_RUNNER_REPO: source, LV_RUNNER_STATE_ROOT: state } });
    if (proc.status === 0) observed = JSON.parse(fs.readFileSync(observedFile));
  } else {
    proc = spawnSync('python3', ['-c', python], { encoding: 'utf8', timeout: 15000 });
  }
  assert.equal(proc.status, !throughRunner && ['restore', 'failed', 'old-layout'].includes(scenario) ? 1 : 0, proc.stderr + (fs.existsSync(resultFile) ? fs.readFileSync(resultFile) : ''));
  const result = JSON.parse(fs.readFileSync(resultFile));
  const probes = result.stdout.split('\n').filter((line) => line.startsWith('PROBE=')).map((line) => JSON.parse(line.slice(6)));
  const diagnostics = fs.readdirSync(logs).flatMap((file) => fs.readFileSync(path.join(logs, file), 'utf8').trim().split('\n').map(JSON.parse));
  const unitChecks = fs.readFileSync(path.join(root, 'unit-checks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const generatorLog = path.join(root, 'generator.jsonl');
  const generatorEvents = throughRunner && fs.existsSync(generatorLog) ? fs.readFileSync(generatorLog, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const ownership = fs.readFileSync(path.join(root, 'ownership.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  return { ...result, ownership, generatorEvents, probes, files, scratch, observed, diagnostics, unitChecks, posts: throughRunner ? null : JSON.parse(fs.readFileSync(path.join(scratch, dataFile))) };
}

