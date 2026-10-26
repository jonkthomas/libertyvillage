import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explain, normalizeCode, KNOWN_CODES, LINKS, codesInErrors } from '../../ops/weekly-digest/lib/plain-english.mjs';
import { execSummary, slackMessage, problemGroups } from '../../ops/weekly-digest/lib/digest.mjs';
import { renderHtml } from '../../ops/weekly-digest/lib/render.mjs';
import {
  formatSuccess, formatAdmin, formatFailure, formatPropagationWarning, formatCompensationConflict,
  formatAdminSmokeAlert, formatGateError, formatCadenceAlert, formatStorageAlert,
} from '../../scripts/content/notify.mjs';
import { registry } from '../../scripts/content/canonical.mjs';
import { alertFailure, alertText, SAFE_FAILURES } from '../../ops/exedev-runner/runner.mjs';
import { formatOrphanText, formatSlackText } from '../../scripts/automation/blocked-sentinel.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const realShaped = () => JSON.parse(fs.readFileSync(path.join(dirname, 'fixtures', 'digest-model-2026-10-26.json'), 'utf8'));

// Codes the brief names, in the spellings the runner, gate and cadence emit.
const BRIEF_CODES = [
  'business-outside-pack', 'draft-changed-topic', 'blog-lint:unrecorded-business', 'blog-lint:unsupported-hours',
  'blog-lint:some-future-rule', 'gate blocked or rejected', 'near-duplicate', 'cadence content deficit',
  'backfill publication incomplete', 'operational-error', 'WEEKLY_CONTENT_MISSED', 'missed-week', 'weekly content missed',
];

test('every known code maps to a plain cause, impact and action', () => {
  for (const code of [...KNOWN_CODES, ...BRIEF_CODES]) {
    const e = explain(code);
    assert.equal(e.known, true, `${code} fell back`);
    for (const field of ['title', 'cause', 'impact', 'action']) {
      assert.ok(typeof e[field] === 'string' && e[field].length > 10, `${code}.${field} empty`);
    }
    // The explanation never repeats the raw code itself.
    if (/[-_:]/.test(code)) assert.ok(![e.title, e.cause, e.impact, e.action].join(' ').includes(code), `${code} leaked into its own text`);
  }
});

test('every runner failure class and CLI failure reason has a plain explanation', () => {
  const cli = ['cli-claim', 'cli-conflict', 'cli-database', 'cli-database-target', 'cli-network', 'cli-operation', 'cli-permission',
    'cli-schema', 'cli-server', 'cli-state', 'cli-target', 'cli-timeout', 'cli-validation', 'invalid-json', 'operational-error'];
  const gate = ['lint', 'validation', 'not-converging', 'unrepairable', 'exhausted', 'block', 'conflict', 'error', 'smoke-failed', 'timeout', 'state-error'];
  for (const code of [...SAFE_FAILURES, ...cli, ...gate]) assert.equal(explain(code).known, true, `no plain-English entry for "${code}"`);
});

test('lint sub-codes get a specific cause; an unseen lint rule keeps the generic one', () => {
  assert.match(explain('blog-lint:unsupported-hours').cause, /opening hours/);
  assert.match(explain('blog-lint:some-future-rule').cause, /fact check could not confirm/);
  assert.deepEqual(codesInErrors(['data/posts.json: p: [unrecorded-business] X', 'other']), ['blog-lint:unrecorded-business']);
  assert.equal(normalizeCode('cli-validation exit 2'), 'cli-validation');
  assert.equal(normalizeCode('cli: inspect-run-slot'), 'cli-operation');
  assert.equal(normalizeCode('no terminal event (killed/timeout/reboot?)'), 'no terminal event');
});

test('unknown codes fall back to "investigating" with the fix-it tickets link', () => {
  for (const raw of ['totally-new-failure', 'slack webhook 503', '', null, '__proto__', 'constructor']) {
    const e = explain(raw);
    assert.equal(e.known, false, String(raw));
    assert.match(e.title, /investigating/);
    assert.equal(e.link, LINKS.fixIt);
    assert.ok(![e.title, e.cause, e.impact, e.action].join(' ').includes('totally-new-failure'));
  }
});

// Every #libvillage message, rendered from realistic inputs.
async function allMessages() {
  const sub = { id: 412, kind: 'blog', target: 'production' };
  const out = {
    success: formatSuccess({ submission: sub, items: [{ dataset: 'posts', key: 'dentists-2026', payload: { title: 'Dentists in Liberty Village' } }], registry, siteUrl: 'https://libertyvillage.co' }),
    successMany: formatSuccess({ submission: { ...sub, kind: 'topic-discovery' }, items: Array.from({ length: 12 }, (_, i) => ({ dataset: 'topic-queue', key: `k${i}`, payload: { title: `Topic ${i}` } })), registry, siteUrl: 'https://libertyvillage.co' }),
    admin: formatAdmin({ submission: { ...sub, kind: 'admin' }, items: [{ op: 'upsert', dataset: 'businesses', key: 'jukebox-print' }, { op: 'unpublish', dataset: 'businesses', key: 'old-cafe' }] }),
    lint: formatFailure({ submission: sub, decision: 'lint', errors: ['data/posts.json: dentists: [unrecorded-business] Smile Dental'] }),
    block: formatFailure({ submission: sub, decision: 'block', findings: [{ severity: 'high', path: 'data/posts.json', note: 'Hours are not supported.' }] }),
    unknownDecision: formatFailure({ submission: sub, decision: 'brand-new-decision' }),
    hook: formatPropagationWarning({ submission: sub, reason: 'hook-failed' }),
    smoke: formatPropagationWarning({ submission: sub, reason: 'smoke-timeout' }),
    conflict: formatCompensationConflict({ submission: sub }),
    adminSmoke: formatAdminSmokeAlert({ submission: sub, failures: [{ dataset: 'businesses', key: 'jukebox-print', reason: 'marker-missing' }] }),
    gateError: formatGateError({ id: 419, reason: 'operational-error' }),
    missed: formatCadenceAlert({ target: 'production', weekStart: '2026-10-19', alertKind: 'WEEKLY_CONTENT_MISSED', counts: { content: 1, roundup: 0 }, failureClass: 'deadline-missed', notificationKey: 'cadence-alert:production:2026-10-19:WEEKLY_CONTENT_MISSED' }),
    missedNews: formatCadenceAlert({ target: 'staging', weekStart: '2026-10-19', alertKind: 'WEEKLY_NEWS_MISSED', counts: { content: 2, roundup: 0 }, failureClass: 'deadline-missed' }),
    storage: formatStorageAlert({ projectBytes: 371_000_000 }),
    sentinel: formatSlackText([{ number: 211, title: 'Blog fix', idleHours: 30 }]),
    orphan: formatOrphanText([{ number: 214, title: 'Digest fix', ageHours: 3, headAgeHours: null }]),
    digest: slackMessage(realShaped()),
  };
  const slot = '20261023044740-1b9e355b';
  for (const reason of ['cadence content deficit', 'backfill publication incomplete', 'gate blocked or rejected', 'operational-error', 'cli-operation', 'something-new-xyz']) {
    await alertFailure({ webhook: 'https://hooks.example/x', job: 'weekly-blog', target: 'production', slot, reason },
      async (_url, init) => { out[`runner ${reason}`] = JSON.parse(init.body).text; return { ok: true }; });
  }
  await alertFailure({ webhook: 'https://hooks.example/x', job: 'october-blog-backfill', target: 'production', slot, exhaustedLabel: '2026-10-19' },
    async (_url, init) => { out['runner exhausted'] = JSON.parse(init.body).text; return { ok: true }; });
  return out;
}

const RAW = /\b(?:business-outside-pack|draft-changed-topic|blog-lint|unrecorded-business|cadence content deficit|backfill publication incomplete|gate blocked or rejected|operational-error|cli-[a-z]+|something-new-xyz|brand-new-decision|hook-failed|smoke-timeout|compensation-conflict|marker-missing|WEEKLY_[A-Z]+_MISSED|deadline-missed|cadence-alert|weekly-blog|october-blog-backfill|topic-queue|lv-runner|jsonl)\b|[{}]|data\/posts\.json|20261023044740/;

test('no raw codes, JSON, slugs, run ids or paths in any Slack message body', async () => {
  const messages = await allMessages();
  assert.ok(Object.keys(messages).length >= 20);
  for (const [name, text] of Object.entries(messages)) {
    // Body = everything except the one trailing Ref line operators use.
    const body = text.split('\n').filter((line) => !line.startsWith('Ref: ')).join('\n');
    assert.doesNotMatch(body, RAW, `${name}:\n${text}`);
    assert.match(body, /What you need to do: /, `${name} has no action line`);
    assert.ok((body.match(/https?:\/\//g) ?? []).length <= (name === 'successMany' ? 10 : 1), `${name} has more than one link`);
    assert.ok(text.split('\n').filter((line) => line.startsWith('Ref: ')).length <= 1, `${name} has extra Ref lines`);
  }
  // Repeats stay recognisable: the submission id rides in the Ref line.
  assert.match(messages.success, /\nRef: submission #412$/);
  // Unknown reasons say so and link the fix-it tickets.
  assert.match(messages['runner something-new-xyz'], /investigating/);
  assert.ok(messages['runner something-new-xyz'].includes(LINKS.fixIt));
  assert.match(messages.unknownDecision, /investigating/);
});

test('runner alerts degrade to a plain sentence when the shared map is missing', () => {
  const text = alertText({ job: 'weekly-blog', target: 'production', slot: 'x', reason: 'cadence content deficit' }, null);
  assert.match(text, /did not finish \(production\)\. Details are in the weekly report\./);
});

test('digest headline and KPIs render from the real-shaped 2026-10-26 model', () => {
  const model = realShaped();
  const x = execSummary(model);
  assert.equal(x.week, 'Oct 19–26, 2026');
  assert.equal(x.headline, '2 of 2 planned posts went live. Search clicks fell 17% (100 → 83) while impressions rose 7%: we are showing up more but ranking lower (average position 9.4 → 12.0).');
  // On plan: the 3 "behind plan" progress checks are settled, not issues; the
  // rest count once per cause, resolved when a later run of the job succeeded.
  assert.equal(x.problems, '4 issues this week: 1 resolved, 3 still being retried automatically.');
  assert.equal(x.progressNote, 'Mid-week progress checks flagged the week as behind 3 times; it finished on plan.');
  assert.ok(!x.groups.some((g) => g.title === 'Behind the 2-posts-a-week plan'));
  assert.deepEqual(x.groups.map((g) => [g.title, g.count, g.open]), [
    ['Catch-up post did not publish', 2, 2],
    ['Quality review stopped a draft', 1, 1],
    ['A content-system step failed', 1, 0],
    ['Unexpected technical error', 1, 1],
  ]);
  assert.match(slackMessage(model), /\nProblems: 4 issues this week: 1 resolved, 3 still being retried automatically\. Mid-week progress checks flagged the week as behind 3 times; it finished on plan\.\n/);
  assert.equal(x.ask, 'Nothing needs you this week.');
  assert.deepEqual(x.kpis.map((k) => [k.label, k.display ?? k.value, k.delta, k.better]), [
    ['Posts live vs plan', '2 of 2', null, true],
    ['Search clicks (Oct 19–25)', 83, -17, false],
    ['Search impressions', 10740, 7.4, true],
    ['Average position', 12, 2.6, false],
  ]);
  // Grouped by cause, not one row per run; all 8 failures accounted for.
  const groups = problemGroups(model.failures, model.runs.list);
  assert.equal(groups.reduce((n, g) => n + g.count, 0), model.failures.length);
  assert.equal(groups.length, 5);
  assert.deepEqual(x.next.map((n) => n.what).slice(0, 3), ['October catch-up post', 'News check', 'New blog post']);

  const html = renderHtml(model);
  for (const s of ['Week of Oct 19–26, 2026', x.headline, 'Posts live vs plan', '2 of 2', '▼ 17% vs 100 last week · worse',
    '▲ 2.6 vs 9.4 last week · worse (lower is better)', 'What shipped', 'Jukebox Print &amp; Liberty Village Printing Guide (2026)',
    'What went wrong → what we did', 'Mid-week progress checks flagged the week as behind 3 times; it finished on plan.', 'Catch-up post did not publish', 'Next week', 'Wed and Sun', "What's working",
    'Test site only', '<details>', 'Failures (raw)']) {
    assert.ok(html.includes(s), `missing from page: ${s}`);
  }
  // The exec body (before the appendix) carries no raw codes, slots or log names.
  const body = html.split('<details>')[0].split('</style>')[1];
  assert.doesNotMatch(body, /cadence content deficit|backfill publication incomplete|cli-operation|operational-error|\.jsonl|\d{8,}-scheduled|weekly-blog|october-blog-backfill/);
  assert.ok(!html.includes('<script'), 'digest must stay JS-free');
});

test('a week that missed its plan keeps "behind plan" as an open issue', () => {
  const model = realShaped();
  model.posted.items = model.posted.items.slice(0, 1);
  const x = execSummary(model);
  assert.equal(x.progressNote, null);
  const behind = x.groups.find((g) => g.title === 'Behind the 2-posts-a-week plan');
  // The two live-site checks were followed by a successful blog run; the test-site one was not.
  assert.deepEqual([behind?.count, behind?.open], [3, 1]);
  assert.equal(x.problems, '5 issues this week: 1 resolved, 4 still being retried automatically.');
  assert.doesNotMatch(slackMessage(model), /progress checks/);
});

test('digest page and Slack post handle an empty, data-less week', () => {
  const model = {
    generatedAt: '2026-10-26T13:00:00.000Z', window: { from: '2026-10-19T13:00:00.000Z', to: '2026-10-26T13:00:00.000Z' },
    runs: { summary: { total: 0, success: 0, failure: 0, held: 0, incomplete: 0 }, byJob: [], list: [] },
    failures: [], posted: { items: [] }, queue: { held: null, timers: [], note: 'not fetched' },
    gsc: { source: 'unavailable', note: 'not fetched' }, notes: [], links: {},
  };
  const x = execSummary(model);
  assert.equal(x.headline, 'No posts went live this week (plan: 2). Search data was unavailable this week.');
  assert.match(slackMessage(model), /Published: nothing this week\./);
  const html = renderHtml(model);
  assert.ok(html.includes('Nothing went live this week.'));
  assert.ok(html.includes('No issues this week.'));
});
