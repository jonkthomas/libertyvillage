import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildModel, slackMessage } from '../../ops/weekly-digest/lib/digest.mjs';
import { renderHtml } from '../../ops/weekly-digest/lib/render.mjs';
import * as fetchers from '../../ops/weekly-digest/lib/fetchers.mjs';

const action = { action_kind: 'new_post', slug: 'coffee', target_query: 'liberty village coffee', baseline: { clicks: 10, impressions: 100, ctr: 0.1, position: 18 }, outcome_2w: { clicks: 25, impressions: 200, ctr: 0.125, position: 9 }, outcome_4w: null };
function fixture(clicks = 120, previous = 100) {
  return buildModel({ generatedAt: '2026-10-26T12:00:00Z', window: { from: '2026-10-19T12:00:00Z', to: '2026-10-26T12:00:00Z' }, runs: [], posted: [],
    queue: { held: false, timers: [] }, gsc: { source: 'fixture', weeks: [{ start: '2026-10-12', end: '2026-10-18', clicks: previous }, { start: '2026-10-19', end: '2026-10-25', clicks }] }, actions: [action] });
}
test('digest leads with clicks WoW and renders T0 to mature outcomes in Slack and HTML', () => {
  const model = fixture();
  const slack = slackMessage(model), html = renderHtml(model);
  assert.equal(slack.split('\n')[0], 'Search clicks this week: 120 (+20% WoW); last week: 100');
  for (const body of [slack, html]) {
    assert.match(body, /What we did → what it moved/);
    assert.match(body, /T0 10 clicks, 100 impressions, CTR 10.0%, position 18.0 → \+2w 25 clicks, 200 impressions, CTR 12.5%, position 9.0 → \+4w pending/);
  }
  assert.match(html, /What shipped/); assert.match(html, /What went wrong/); assert.match(html, /Next week/);
  const dir = process.env.LV_GROWTH_EVIDENCE_DIR;
  if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'digest.html'), html); fs.writeFileSync(path.join(dir, 'digest-slack.txt'), slack); fs.writeFileSync(path.join(dir, 'digest.json'), JSON.stringify(model)); }
});
test('click declines, zero prior clicks, missing analytics and unknown T0 are honest', () => {
  assert.match(slackMessage(fixture(80)), /^Search clicks this week: 80 \(-20% WoW\)/);
  assert.match(slackMessage(fixture(5, 0)), /^Search clicks this week: 5 \(WoW unavailable; zero prior clicks\)/);
  const model = fixture(); model.gsc.weeks = []; model.actions[0] = { ...action, baseline: { clicks: null } };
  assert.match(slackMessage(model), /^Search clicks this week: unavailable/);
  assert.match(renderHtml(model), /T0 unknown clicks/);
});
test('Mac ledger transport requests read-only list over existing VM/env bridge', async () => {
  const rows = await fetchers.fetchLedgerOnVm({ since: '2026-09-21T10:00:00.000Z' }, async (command, opts) => {
    assert.match(command, /\. \/etc\/lv-runner.env;[\s\S]*\. \/etc\/lv-runner-production.env;/,
      'load common keys then production DB credentials, as launcher.sh does');
    assert.doesNotMatch(command, /lv-runner-staging/);
    assert.match(command, /ledger.mjs list '2026-09-21T10:00:00.000Z'/);
    assert.equal(opts.asRoot, true); assert.doesNotMatch(command, /weekly|INSERT|UPDATE|DELETE/i); return JSON.stringify([action]);
  });
  assert.equal(rows[0].slug, 'coffee');
  await assert.rejects(fetchers.fetchLedgerOnVm({ since: "'; touch /tmp/no" }));
});
