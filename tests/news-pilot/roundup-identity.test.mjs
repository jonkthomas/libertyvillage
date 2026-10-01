import test from 'node:test';
import assert from 'node:assert/strict';
import { planRoundupV2, roundupCoverageFromPack } from '../../scripts/news-pilot/roundup.mjs';

const now = '2026-09-29T15:00:00Z';
const event = (id, venue, date, time, patch = {}) => ({
  identityKey: `occ:${venue}:${date}:${time}`, canonicalVenueId: venue, subject: id,
  item_type: 'event', locality: 'core', when: { kind: 'event', date, startTime: time },
  evidence: [{ url: `https://example.com/${id}` }], ...patch,
});

test('reminders and own-domain corroboration merge by venue, date and start', () => {
  const ig = event('Market', 'addr:171-east-liberty-st#113', '2026-10-03', '11:30', { tier: 'primary' });
  const page = event('Market', ig.canonicalVenueId, '2026-10-03', '11:30', { tier: 'primary',
    evidence: [{ url: 'https://business.example/market' }] });
  const plan = planRoundupV2([ig, page, event('Other', 'addr:171-east-liberty-st#126', '2026-10-03', '11:30'),
    event('Third', 'addr:70-east-liberty-st', '2026-10-03', '12:00')], { now });
  assert.equal(plan.units, 3);
  assert.equal(plan.countedItems.find((item) => item.identityKey === ig.identityKey).evidence.length, 2);
  assert.equal(roundupCoverageFromPack({ isoWeek: plan.isoWeek, now, units: plan.countedItems,
    stillInEffect: [] }).keys.length, 3);
});

test('venue identity preserves unit, start time, next date and class cap', () => {
  const nrg = event('NRG', 'addr:171-east-liberty-st#113', '2026-10-03', '18:00', { item_type: 'class' });
  const oxygen = event('Oxygen', 'addr:171-east-liberty-st#126', '2026-10-03', '18:00', { item_type: 'class' });
  const later = event('Later', nrg.canonicalVenueId, '2026-10-03', '20:00');
  const next = event('Next date', nrg.canonicalVenueId, '2026-10-10', '18:00');
  const secondClass = event('Second class', nrg.canonicalVenueId, '2026-10-04', '18:00', { item_type: 'class' });
  const plan = planRoundupV2([nrg, oxygen, later, next, secondClass], { now });
  assert.equal(plan.units, 4);
  assert.equal(plan.excluded.find((entry) => entry.reason === 'class-cap')?.item.identityKey, secondClass.identityKey);
  assert.equal(plan.coreAnchorUnits, 2);
  const prior = [{ kind: 'roundup', roundupCoverage: { version: 1, keys: [nrg.identityKey] } }];
  const following = planRoundupV2([nrg, next, oxygen, later], { now, posts: prior });
  assert.equal(following.countedItems.some((item) => item.identityKey === nrg.identityKey), false);
  assert.equal(following.countedItems.some((item) => item.identityKey === next.identityKey), true);
});
