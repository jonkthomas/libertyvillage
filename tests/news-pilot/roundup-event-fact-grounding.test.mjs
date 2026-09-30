import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceStatesClock, verifyRoundupForms } from '../../scripts/news-pilot/roundup-verify.mjs';
import { writeRoundup } from '../../scripts/news-pilot/roundup-write.mjs';
import { planRoundupV2 } from '../../scripts/news-pilot/roundup.mjs';
import * as realGeography from '../../scripts/news-pilot/roundup-geo.mjs';
import { extractRoundupRecords } from '../../scripts/news-pilot/roundup-records.mjs';
import { ROUNDUP_SOURCES } from '../../scripts/news-pilot/sources.mjs';

// Synthetic captions only (no private staging draft). The real IG extractor,
// verifier and planner build the unit; the assertions are on what the writer
// and reviewers are actually sent, not on what a stubbed model "decides".
const now = '2026-09-29T15:00:00Z';
const source = ROUNDUP_SOURCES.find((s) => s.id === 'ig:burgerdrops');
const place = '116 Atlantic Ave. Patio';
const embellished = 'Guest pop-up starts at 11:30 with limited batches and a tasting programme';
const CAPTIONS = {
  // Business opening hours: the clock is a shop-hours line, not an event start.
  hours: { caption: `Guest pop-up Saturday Oct 3 at our shop. Shop hours 11:30 AM until sold out.\n📍 ${place}`,
    subject: 'Guest pop-up', dateQuote: 'Saturday Oct 3' },
  // Explicit, item-bound event start inside the quoted date span.
  explicit: { caption: `Guest pop-up at our shop. The pop-up begins at 11:30 AM Saturday Oct 3.\n📍 ${place}`,
    subject: 'Guest pop-up', dateQuote: 'begins at 11:30 AM Saturday Oct 3' },
  // The observed layout: an unlabelled clock line, neither "starts" nor "hours".
  ambiguous: { caption: `[ OCT. 3: $6 Fried Onion Burgers by George Motz]\n⏰ 11:30AM until sold out\n📍 ${place}`,
    subject: '$6 Fried Onion Burgers by George Motz', dateQuote: 'OCT. 3' },
};

async function verifiedUnit(name, startTime = '11:30') {
  const { caption, subject, dateQuote } = CAPTIONS[name];
  const url = `https://www.instagram.com/p/${name.toUpperCase()}/`;
  const post = { shortcode: name.toUpperCase(), ownerUsername: 'burgerdrops', timestamp: '2026-09-27T22:51:24Z', caption };
  const records = extractRoundupRecords({ source, url, body: caption, post });
  const form = { signalId: name, recordId: records[0].recordId, subject, what: embellished, where_it_happens: place,
    when: { kind: 'event', date: '2026-10-03', endDate: null, startTime, endTime: null },
    who_is_affected: 'Visitors', relevance_reason: 'Local pop-up', verdict: 'core', item_type: 'event',
    people: [], risk: {}, exclude_reason: null,
    evidence: [{ url, recordId: records[0].recordId, subject_quote: subject, place_quote: place, date_quote: dateQuote }] };
  const verified = await verifyRoundupForms({ signals: [{ signalId: name, sourceId: source.id, url, post, records }],
    forms: [form], now, posts: [], geography: realGeography, sources: [source], publisherTiers: {},
    fetcher: async () => { throw new Error('IG must not use the HTML fetcher'); } });
  return { verified, unit: planRoundupV2(verified.items, { now }).countedItems[0] };
}

// Records every request; answers draft/revision calls with the supplied body
// per unit and reviews with the supplied findings (default: none).
const recorder = ({ body = () => 'On Oct 3 at 116 Atlantic Ave. Patio in Liberty Village.', fact = [[]], risk = [[]] } = {}) => {
  const calls = [];
  let factAt = 0, riskAt = 0;
  return { calls, callModel: async (req) => {
    calls.push(req);
    const payload = JSON.parse(req.userText);
    if (req.system.includes('Independent fact reviewer'))
      return { ok: true, text: JSON.stringify({ findings: fact[Math.min(factAt++, fact.length - 1)] }) };
    if (req.system.includes('Independent locality'))
      return { ok: true, text: JSON.stringify({ findings: risk[Math.min(riskAt++, risk.length - 1)] }) };
    return { ok: true, text: JSON.stringify({ intro: 'Local plans this week.',
      units: payload.units.map((u) => ({ unitId: u.unitId, heading: u.subject, body: body(u, calls.length) })) }) };
  } };
};
const write = (units, callModel) => writeRoundup({ units, now }, { resolved: { ok: true, provider: { id: 'anthropic' } },
  reviewer: { ok: true, provider: { id: 'deepseek' } }, callModel });
const sentUnits = (req) => JSON.parse(req.userText).units;

test('verifier keeps a record clock for eligibility (§6.4) and still refuses a dropped clock', async () => {
  for (const name of Object.keys(CAPTIONS)) {
    const { unit } = await verifiedUnit(name);
    assert.equal(unit.when.startTime, '11:30', name);
    assert.equal(unit.what, embellished, `${name}: pack keeps the model summary untouched`);
  }
  const dropped = await verifiedUnit('hours', null);
  assert.equal(dropped.verified.items.length, 0);
  assert.equal(dropped.verified.excluded[0].reason, 'undated');
});

test('opening-hours and ambiguous caption clocks reach the writer and reviewers as date-only events', async () => {
  for (const name of ['hours', 'ambiguous']) {
    const { unit } = await verifiedUnit(name);
    const { calls, callModel } = recorder();
    await write([unit], callModel);
    assert.equal(calls.length, 3, 'draft, fact review, risk review');
    for (const req of calls) {
      const [sent] = sentUnits(req);
      assert.deepEqual(sent.when, { ...unit.when, startTime: null, endTime: null }, `${name}: ${req.system.slice(0, 30)}`);
      assert.equal('what' in sent, false, `${name}: model summary is not writer/reviewer evidence`);
      assert.ok(!req.userText.includes('limited batches') && !req.userText.includes('tasting programme'));
      // The only remaining 11:30 is the opaque identity key (not a fact field).
      assert.deepEqual(req.userText.split(unit.identityKey).join('').match(/11:30/g), null, name);
    }
  }
});

test('explicit item-bound event start stays writable', async () => {
  const { unit } = await verifiedUnit('explicit');
  const { calls, callModel } = recorder();
  await write([unit], callModel);
  for (const req of calls) {
    const [sent] = sentUnits(req);
    assert.equal(sent.when.startTime, '11:30');
    assert.equal(sent.evidence[0].date_quote, 'begins at 11:30 AM Saturday Oct 3');
    assert.equal('what' in sent, false);
  }
});

test('typed feed, structured and listing times remain trusted; unquoted clocks do not', () => {
  const day = '2026-10-03';
  const feed = [{ feed: true, typed: { startTime: '2026-10-03T15:30:00Z', endTime: '2026-10-03T20:00:00Z' },
    subject_quote: 'Strachan Ave', place_quote: null, date_quote: null }];
  assert.equal(evidenceStatesClock(feed, day, '11:30', 'start'), true);
  assert.equal(evidenceStatesClock(feed, day, '16:00', 'end'), true);
  assert.equal(evidenceStatesClock(feed, day, '16:00', 'start'), false, 'an end instant is not a start');
  const structured = [{ typed: { startDate: '2026-10-03T19:00:00-04:00' }, subject_quote: 'Concert' }];
  assert.equal(evidenceStatesClock(structured, day, '19:00'), true);
  assert.equal(evidenceStatesClock([{ typed: { startDate: '2026-10-03' }, subject_quote: 'Expo' }], day, '00:00'), false);
  assert.equal(evidenceStatesClock([{ listing: true, typed: { timeText: '7 pm' }, subject_quote: 'Match' }], day, '19:00'), true);
  const igTyped = { owner: 'burgerdrops', timestamp: '2026-10-03T15:30:00Z', shortcode: 'X', ordinal: 0, date: day };
  assert.equal(evidenceStatesClock([{ typed: igTyped, subject_quote: 'Guest pop-up', date_quote: 'Oct 3' }], day, '11:30'), false,
    'a post timestamp is not an event time');
  assert.equal(evidenceStatesClock([{ typed: igTyped, subject_quote: 'Guest pop-up', date_quote: 'Oct 3 from 11:30am' }], day, '11:30'), true);
});

test('an unsupported start also withholds its end; a feed unit keeps both', async () => {
  const base = { identityKey: 'occ:x', verdict: 'core', itemType: 'event', date: '2026-10-03', subject: 'Market',
    citations: [{ url: 'https://source.example/x', sourceId: 's', recordId: 'r1' }] };
  const quoteOnly = { ...base, when: { kind: 'event', date: '2026-10-03', endDate: null, startTime: '11:30', endTime: '22:00' },
    evidence: [{ url: 'https://source.example/x', recordId: 'r1', subject_quote: 'Market', place_quote: 'Liberty Village',
      date_quote: 'October 3, 2026 until 10 pm', typed: {} }] };
  const road = { ...base, identityKey: 'road:1', itemType: 'road', when: { kind: 'restriction', date: '2026-10-03',
    endDate: '2026-10-03', startTime: '11:30', endTime: '16:00' },
  evidence: [{ url: 'https://source.example/x', recordId: 'r1', subject_quote: 'Market', place_quote: null, date_quote: null,
    feed: true, typed: { startTime: '2026-10-03T15:30:00Z', endTime: '2026-10-03T20:00:00Z' } }] };
  const { calls, callModel } = recorder();
  await write([quoteOnly, road], callModel);
  const [sentQuote, sentRoad] = sentUnits(calls[0]);
  assert.equal(sentQuote.when.startTime, null);
  assert.equal(sentQuote.when.endTime, null);
  assert.equal(sentRoad.when.startTime, '11:30');
  assert.equal(sentRoad.when.endTime, '16:00');
});

test('fact reviewer is told model summaries are not evidence, and its finding drives one revision then risk review', async () => {
  const { unit } = await verifiedUnit('ambiguous');
  const finding = { unitId: unit.identityKey, sentence: 'The pop-up starts at 11:30 a.m. while supplies last.',
    problem: 'unsupported', fix: 'Remove the start time and scarcity qualifier; they are not in the quotes.' };
  const { calls, callModel } = recorder({ fact: [[finding]],
    body: (u, n) => n === 1 ? finding.sentence : 'George Motz serves $6 Fried Onion Burgers on Oct 3 at 116 Atlantic Ave. Patio.' });
  const out = await write([unit], callModel);
  const [draft, fact, revise, risk] = calls;
  assert.equal(calls.length, 4);
  assert.match(fact.system, /unit\.subject, verified unit\.when/);
  assert.doesNotMatch(fact.system, /unit\.what/);
  assert.match(fact.system, /must be stated in the same unit evidence quotes or typed fields/);
  assert.match(fact.system, /If unit\.when has no startTime, any stated hour is unsupported/);
  assert.match(draft.system, /State a time only when unit\.when has it/);
  assert.deepEqual(JSON.parse(revise.userText).findings, [finding]);
  assert.equal('what' in sentUnits(revise)[0], false);
  assert.equal(JSON.parse(risk.userText).draft.units[0].body, out.draft.units[0].body);
  assert.equal(out.draft.units[0].body.includes('11:30'), false);
  assert.deepEqual(out.findings.map((f) => f.findings.length), [1, 0]);
});

test('quoted price and address evidence still reaches the writer (PR196 copy policy)', async () => {
  const { unit } = await verifiedUnit('ambiguous');
  const { calls, callModel } = recorder({ body: () => '$6 Fried Onion Burgers by George Motz at 116 Atlantic Ave. Patio on Oct 3.' });
  const out = await write([unit], callModel);
  const [sent] = sentUnits(calls[0]);
  assert.equal(sent.subject, '$6 Fried Onion Burgers by George Motz');
  assert.equal(sent.evidence[0].place_quote, place);
  assert.match(out.draft.units[0].body, /\$6 .*116 Atlantic Ave/);
});

test('private-person regeneration and its fresh reviews also use the date-only, summary-free material', async () => {
  const { unit } = await verifiedUnit('hours');
  const other = (await verifiedUnit('ambiguous')).unit;
  const refusedUnit = { ...other, identityKey: 'occ:refused' };
  const { calls, callModel } = recorder({ risk: [[{ unitId: 'occ:refused', person: 'Jane Resident', problem: 'private-individual' }], []] });
  const out = await write([unit, refusedUnit], callModel);
  assert.deepEqual(out.refused, ['occ:refused']);
  assert.equal(calls.length, 6, 'draft, fact, risk, regenerate, fresh fact, fresh risk');
  for (const req of calls.slice(3)) {
    const sent = sentUnits(req);
    assert.deepEqual(sent.map((u) => u.unitId), [unit.identityKey]);
    assert.equal(sent[0].when.startTime, null);
    assert.equal('what' in sent[0], false);
  }
});
