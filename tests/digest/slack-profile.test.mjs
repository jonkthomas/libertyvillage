import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const summary = '  Weekly digest — café 😀\ncol1\tcol2\n\n';
const hermesSendSource = path.join(os.homedir(), '.hermes/hermes-agent/hermes_cli/send_cmd.py');

function slackCall() {
  const source = fs.readFileSync(new URL('../../ops/weekly-digest/run-digest.mjs', import.meta.url), 'utf8');
  const constants = source.match(/^const SLACK_(?:TARGET|PROFILE) = .+;$/gm).join('\n');
  const start = source.indexOf('  // 7. Slack post');
  const end = source.indexOf('  // 8. Push digest JSON');
  assert.ok(start >= 0 && end > start);
  const calls = [];
  // Execute the actual send block with a recorder: no Hermes process or network.
  vm.runInNewContext(constants + '\n' + source.slice(start, end), {
    HERMES: '/fixture/hermes', model: { links: {} }, baseUrl: 'https://digest.test', id: '2026-10-23', notes: [],
    flag: () => false, log: () => {}, slackMessage: () => summary,
    execFileSync: (command, args, options) => { calls.push({ command, args: Array.from(args), options: { ...options } }); return 'ok'; },
  });
  assert.equal(calls.length, 1);
  return calls[0];
}

test('digest Slack call selects Ofia and leaves the positional body unset for stdin', () => {
  assert.deepEqual(slackCall(), {
    command: '/fixture/hermes',
    args: ['--profile', 'ofia', 'send', '-t', 'slack:C0B6HEAHZT4', '--json'],
    options: { input: summary, encoding: 'utf8', timeout: 60_000 },
  });
});

test('installed Hermes parser reads the digest stdin byte-for-byte without sending', {
  skip: !fs.existsSync(hermesSendSource) && 'installed Hermes send_cmd.py unavailable; exact argv regression still runs',
}, () => {
  const call = slackCall();
  // Import only the send module (stdlib dependencies), register its real parser,
  // and read the body. Never call cmd_send or the parsed dispatcher function.
  const probe = spawnSync('python3', ['-I', '-B', '-c', `
import argparse, importlib.util, sys
spec = importlib.util.spec_from_file_location('offline_hermes_send', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
parser = argparse.ArgumentParser()
module.register_send_subparser(parser.add_subparsers(dest='command', required=True))
args = parser.parse_args(sys.argv[2:])
assert args.message is None, 'positional body overrides piped digest stdin'
assert not sys.stdin.isatty(), 'probe requires piped stdin'
body = module._read_message_body(args.message, args.file)
sys.stdout.buffer.write(body.encode('utf-8'))
`, hermesSendSource, ...call.args.slice(2)], { input: call.options.input, timeout: 10_000 });
  assert.equal(probe.status, 0, probe.stderr?.toString());
  assert.deepEqual(probe.stdout, Buffer.from(summary, 'utf8'));
});
