import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('digest Slack call selects Ofia and passes the summary on stdin', () => {
  const source = fs.readFileSync(new URL('../../ops/weekly-digest/run-digest.mjs', import.meta.url), 'utf8');
  const constants = source.match(/^const SLACK_(?:TARGET|PROFILE) = .+;$/gm).join('\n');
  const start = source.indexOf('  // 7. Slack post');
  const end = source.indexOf('  // 8. Push digest JSON');
  assert.ok(start >= 0 && end > start);
  const calls = [];
  // Execute the actual send block with a recorder: no Hermes process or network.
  vm.runInNewContext(constants + '\n' + source.slice(start, end), {
    HERMES: '/fixture/hermes', model: { links: {} }, baseUrl: 'https://digest.test', id: '2026-10-23', notes: [],
    flag: () => false, log: () => {}, slackMessage: () => 'weekly summary',
    execFileSync: (command, args, options) => { calls.push({ command, args: Array.from(args), options: { ...options } }); return 'ok'; },
  });
  assert.deepEqual(calls, [{
    command: '/fixture/hermes',
    args: ['--profile', 'ofia', 'send', '-t', 'slack:C0B6HEAHZT4', '--json', '-'],
    options: { input: 'weekly summary', encoding: 'utf8', timeout: 60_000 },
  }]);
});
