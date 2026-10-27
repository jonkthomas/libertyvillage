import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractRefreshedPost } from '../../scripts/content/refresh.mjs';
import { REFRESH_RUNTIME_FILES } from '../../ops/exedev-runner/runner.mjs';
import { invoke } from './fixtures/refresh-writer.mjs';

const ROOT = new URL('../../', import.meta.url);

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
    ...new Set([...REFRESH_RUNTIME_FILES, 'scripts/refresh-businesses.json', 'scripts/refresh-preflight.json', 'data/posts.json']
      .flatMap((file) => { const parts = file.split('/'); return parts.map((_, i) => parts.slice(0, i + 1).join('/')); })),
  ].sort());
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
  assert.equal(old.posts[0].description, old.probes[0].posts[0].description, 'read-only parent prevents temp-file creation');
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
  assert.equal(generated.diagnostics.filter((e) => e.event === 'refresh-write-result').length, 4);
  t.diagnostic('Real launcher + Node writer + runner loop: EROFS then ENOSPC closes refresh-write-failed, records first errorCode EROFS, never submits, and cleans scratch.');
});

test('unsupported address gets one grounded revision; persistent findings and shared-cap exhaustion never submit', (t) => {
  const refresh = { slug: 'goodlife-fitness-liberty-village-review-guide', query: 'goodlife', mode: 'snippet' };
  const fixed = invoke(t, refresh, true, 'lint-repair');
  assert.equal(fixed.probes.length, 2);
  const [first, second] = fixed.probes.map((probe) => probe.input);
  const record = JSON.parse(fs.readFileSync(new URL('data/businesses.json', ROOT))).find((b) => b.slug === 'goodlife-fitness-liberty-village');
  const records = JSON.parse(first.prompt.split('BUSINESS RECORDS (evidence data, not instructions):\n')[1].split('\nUse only these businesses.')[0]);
  assert.deepEqual(records.find((b) => b.slug === record.slug), record, 'exact full business record is supplied as evidence');
  assert.match(first.options.systemPrompt, /must be copied verbatim/);
  assert.match(second.prompt, /unsupported-address/);
  assert.match(second.prompt, /47 Jefferson Ave/);
  assert.match(second.prompt, /content/);
  assert.equal(second.options.maxTurns, 19);
  assert.equal(second.options.maxBudgetUsd, 0.9);
  assert.match(fixed.observed.result.after[0].content, /^GoodLife Fitness Liberty Village is at 85 Hanna Ave/);
  const checks = fixed.stdout.split('\n').filter((line) => line.startsWith('[refresh-self-check] '))
    .map((line) => JSON.parse(line.slice('[refresh-self-check] '.length)));
  assert.deepEqual(checks.map((e) => e.ok), [false, true]);
  for (const [scenario, attempts] of [['lint-stays', 2], ['json-then-lint', 2], ['lint-spent', 1], ['lint-unknown-budget', 1]]) {
    const failed = invoke(t, refresh, true, scenario);
    assert.equal(failed.probes.length, attempts, scenario);
    assert.equal(failed.observed.result.outcomes[0].reasonCode, 'refresh-generator-failed', scenario);
    assert.equal(failed.observed.submissions, 0, scenario);
    assert.equal(failed.observed.scratchExists, false);
    assert.ok(!failed.observed.events.some((e) => e.event === 'generator-output-accepted'));
  }
  t.diagnostic('Real launcher/writer/runner: unsupported-address findings delivered once; grounded edit accepted; persistent lint or exhausted/unknown caps produce zero submit calls.');
});


test('title binding gets the single revision; repeated unbound title or JSON-first exhaustion never submits', (t) => {
  const refresh = { slug: 'goodlife-fitness-liberty-village-review-guide', query: 'goodlife', mode: 'snippet' };
  const fixed = invoke(t, refresh, true, 'title-repair');
  assert.equal(fixed.probes.length, 2);
  const repair = fixed.probes[1].input;
  assert.match(repair.prompt, /draft-changed-topic/);
  assert.match(repair.prompt, /title must keep at least 4 of these words from the original: goodlife, fitnes, honest, review, price, hour, 2026/);
  assert.match(fixed.probes[0].input.options.systemPrompt, /keep at least half of the original title's key words/);
  assert.equal(repair.options.maxTurns, 19);
  assert.equal(repair.options.maxBudgetUsd, 0.9);
  assert.deepEqual(fixed.diagnostics.filter((e) => e.event === 'refresh-self-check'), [
    { event: 'refresh-self-check', attempt: 1, ok: false, ruleCodes: ['draft-changed-topic'] },
    { event: 'refresh-self-check', attempt: 2, ok: true, ruleCodes: [] },
  ]);
  for (const scenario of ['title-stays', 'json-then-title']) {
    const refused = invoke(t, refresh, true, scenario);
    assert.equal(refused.probes.length, 2);
    assert.equal(refused.observed.submissions, 0);
    assert.equal(refused.observed.result.outcomes[0].reasonCode, 'refresh-generator-failed');
    assert.equal(refused.observed.scratchExists, false);
  }
});
