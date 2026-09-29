import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRoundupForms, revalidateRoundupForms, recordProvesTime } from '../../scripts/news-pilot/roundup-verify.mjs';
import { roundupSourceQuality } from '../../scripts/news-pilot/roundup-evidence.mjs';
import { planRoundupV2 } from '../../scripts/news-pilot/roundup.mjs';

const now = '2026-09-29T15:00:00Z';
const url = 'https://official.example/events';
const text = 'Autumn Market at 171 East Liberty St, Toronto. Date: October 3, 2026. Starts at 4pm. Neighbours are welcome.';
const source = { id: 'events', url, parse: 'html-page', identityKind: 'org', tier: 'official' };
const record = (body = text, recordId = 'r1') => ({ recordId, text: body, typed: {} });
const signal = (body = text, id = 's1', address = url) => ({ signalId: id, sourceId: 'events', url: address,
  records: [record(body)], body });
const form = (id = 's1', address = url) => ({ signalId: id, recordId: 'r1', subject: 'Autumn Market', what: 'Market',
  where_it_happens: '171 East Liberty St', when: { kind: 'event', date: '2026-10-03', startTime: '16:00' },
  item_type: 'event', people: [], risk: {}, verdict: 'core', exclude_reason: null,
  evidence: [{ url: address, recordId: 'r1', subject_quote: 'Autumn Market',
    place_quote: 'at 171 East Liberty St, Toronto', date_quote: 'October 3, 2026' }] });
const geo = { classifySectionPlace: () => ({ locality: 'core', canonicalVenueId: 'addr:171-east-liberty-st' }) };
const options = (signals = [signal()], forms = [form()], body = text) => ({ signals, forms, now, posts: [],
  fetcher: async () => ({ body, status: 200 }), recordExtractor: ({ body: fresh }) => [record(fresh)],
  geography: geo, sources: [source], publisherTiers: {} });

test('item-bound record, trusted tier and digest', async () => {
  const result = await verifyRoundupForms(options());
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].identityKey, 'occ:addr:171-east-liberty-st:2026-10-03:16:00');
  assert.match(result.verifyDigest, /^[a-f0-9]{64}$/);
  const forged = options();
  forged.forms[0].tier = 'official';
  forged.sources = [{ ...source, tier: 'lead' }];
  assert.equal((await verifyRoundupForms(forged)).excluded[0].reason, 'weak-source');
});

test('cross-record and missing records fail on fresh extraction', async () => {
  const cross = options();
  cross.recordExtractor = ({ body }) => [record('Autumn Market is announced for local residents, with more details to follow.'),
    record(body, 'r2')];
  assert.equal((await verifyRoundupForms(cross)).excluded[0].reason, 'cross-record');
  const missing = options();
  missing.recordExtractor = () => [record(text, 'r2')];
  assert.equal((await verifyRoundupForms(missing)).excluded[0].reason, 'record-missing');
  const swapped = options();
  swapped.forms[0].evidence[0].url = 'https://other.example/a';
  assert.equal((await verifyRoundupForms(swapped)).excluded[0].reason, 'source-swapped');
});

test('risk, private or unclear person, and changed date refuse the item', async () => {
  const risky = options();
  risky.forms[0].risk = { crime: true };
  assert.equal((await verifyRoundupForms(risky)).excluded[0].reason, 'risky');
  const person = options();
  person.forms[0].people = [{ name: 'Jane', role: 'unclear' }];
  assert.equal((await verifyRoundupForms(person)).excluded[0].reason, 'risky');
  const changed = options([signal()], [form()], text.replace('October 3', 'October 4'));
  assert.equal((await verifyRoundupForms(changed)).excluded[0].reason, 'source-swapped');
});

test('source quality requires an official item-bound entry or two independent substantive publishers', () => {
  const entry = { itemBound: true, extractionSubstantive: true, fetchOk: true, tier: 'lead', publisherDomain: 'blogto.com' };
  assert.equal(roundupSourceQuality([entry]), false);
  assert.equal(roundupSourceQuality([{ ...entry, tier: 'official' }]), true);
  assert.equal(roundupSourceQuality([entry, { ...entry, publisherDomain: 'cbc.ca' }]), true);
  assert.equal(roundupSourceQuality([entry, { ...entry, publisherDomain: 'blogto.com' }]), false);
  assert.equal(roundupSourceQuality([entry, { ...entry, publisherDomain: 'cbc.ca', itemBound: false }]), false);
});

test('two corroborating lead pages require a deterministic shared group', async () => {
  const otherUrl = 'https://second.example/story';
  const first = { ...signal(), groupId: 'story-123' };
  const second = { ...signal(text, 's2', otherUrl), sourceId: 'secondary', groupId: 'story-123' };
  const corroborated = options([first, second], [form()]);
  corroborated.forms[0].evidence.push({ ...form().evidence[0], url: otherUrl });
  corroborated.sources = [{ ...source, tier: 'lead' }, { ...source, id: 'secondary', url: otherUrl, tier: 'lead' }];
  assert.equal((await verifyRoundupForms(corroborated)).items.length, 1);
  delete second.groupId;
  assert.equal((await verifyRoundupForms(corroborated)).excluded[0].reason, 'weak-source');
});

test('resolved-date time proof accepts literal times only', () => {
  assert.equal(recordProvesTime('This Wednesday at 6:30pm', '2026-09-30', Date.parse('2026-09-30T22:30:00Z')), true);
  assert.equal(recordProvesTime('Tuesday, September 15 @ 5:30PM', '2026-09-15', Date.parse('2026-09-15T21:30:00Z')), true);
  assert.equal(recordProvesTime('This Wednesday', '2026-09-30', Date.parse('2026-09-30T22:30:00Z')), false);
  assert.equal(recordProvesTime('Saturday, Sept 12, 7-10PM', '2026-09-12', Date.parse('2026-09-12T23:00:00Z')), true);
});

test('syndicated news uses original dateline and refuses unresolved originals', async () => {
  const copyUrl = 'https://copy.example/story';
  const originalUrl = 'https://original.example/story';
  const copyBody = `<link rel="canonical" href="${originalUrl}"><main>September 28, 2026. Autumn Market at 171 East Liberty St, Toronto is announced for residents.</main>`;
  const originalBody = '<main>September 25, 2026. Autumn Market at 171 East Liberty St, Toronto is announced for residents.</main>';
  const newsSource = { id: 'news', identityKind: 'news-discovery', parse: 'html-page', url: copyUrl };
  const newsSignal = { signalId: 'news1', sourceId: 'news', url: copyUrl, records: [record(copyBody)] };
  const newsForm = { ...form('news1', copyUrl), when: { kind: 'news-update', date: '2026-09-25' }, item_type: 'news' };
  newsForm.evidence[0].date_quote = 'September 28, 2026';
  const opts = { signals: [newsSignal], forms: [newsForm], now, posts: [], geography: geo,
    sources: [newsSource], publisherTiers: { 'copy.example': 'official' },
    recordExtractor: ({ body }) => [record(body)],
    fetcher: async (requested) => ({ body: requested === copyUrl ? copyBody : originalBody, status: 200 }) };
  const accepted = await verifyRoundupForms(opts);
  assert.equal(accepted.items[0].identityKey, `news:${originalUrl}`);
  assert.equal((await verifyRoundupForms({ ...opts, fetcher: async (requested) => ({
    body: requested === copyUrl ? copyBody : '', status: requested === copyUrl ? 200 : 403 }) })).excluded[0].reason, 'unverifiable');
  const loop = `<link rel="canonical" href="${copyUrl}"><main>September 25, 2026. Autumn Market at 171 East Liberty St, Toronto.</main>`;
  assert.equal((await verifyRoundupForms({ ...opts, fetcher: async (requested) => ({
    body: requested === copyUrl ? copyBody : loop, status: 200 }) })).excluded[0].reason, 'unverifiable');
  const self = copyBody.replace(originalUrl, copyUrl) + ' Originally published in the Star.';
  assert.equal((await verifyRoundupForms({ ...opts, fetcher: async () => ({ body: self, status: 200 }) })).excluded[0].reason, 'unverifiable');
});

test('submit re-verifies pack units against its first-submit clock', async () => {
  const names = ['Autumn Market', 'Second Market', 'Third Market'];
  const bodies = Object.fromEntries(names.map((name, index) => [
    `https://official.example/events/${index}`, `${name} at 171 East Liberty St, Toronto. Date: October ${index + 3}, 2026. Starts at 4pm. Neighbours are welcome.`,
  ]));
  const signals = names.map((name, index) => ({ signalId: `s${index}`, sourceId: 'events',
    url: `https://official.example/events/${index}`, records: [record(bodies[`https://official.example/events/${index}`])] }));
  const forms = names.map((name, index) => ({ ...form(`s${index}`, signals[index].url), subject: name,
    when: { kind: 'event', date: `2026-10-0${index + 3}`, startTime: '16:00' },
    evidence: [{ ...form().evidence[0], url: signals[index].url, subject_quote: name,
      date_quote: `October ${index + 3}, 2026` }] }));
  const injected = { signals, forms, now, posts: [], geography: geo, sources: [source], publisherTiers: {},
    recordExtractor: ({ body }) => [record(body)], fetcher: async (requested) => ({ body: bodies[requested], status: 200 }) };
  const verified = await verifyRoundupForms(injected);
  const plan = planRoundupV2(verified.items, { now });
  assert.equal(plan.decision, 'publish');
  const pack = { isoWeek: plan.isoWeek, now, units: plan.countedItems, signals, forms };
  assert.equal((await revalidateRoundupForms(pack, { ...injected, now: '2026-09-29T15:30:00Z' })).plan.decision, 'publish');
  await assert.rejects(revalidateRoundupForms({ ...pack, units: [{ ...pack.units[0], subject: 'Invented' }, ...pack.units.slice(1)] },
    { ...injected, now: '2026-09-29T15:30:00Z' }), /rebuild before submit/);
  await assert.rejects(revalidateRoundupForms(pack, { ...injected, now: '2026-10-03T20:01:00Z' }), /rebuild before submit/);
});

test('Instagram relative date is based on provider Toronto timestamp and own record', async () => {
  const igUrl = 'https://www.instagram.com/p/ABC123/';
  const caption = 'Studio Open House at 171 East Liberty St, Toronto. This Wednesday at 6:30pm. Meet the team.';
  const post = { shortCode: 'ABC123', ownerUsername: 'studio', timestamp: '2026-09-27T23:07:57Z', caption };
  const igSignal = { signalId: 'ig1', sourceId: 'ig:studio', url: igUrl, post, records: [record(caption)] };
  const igForm = { ...form('ig1', igUrl), subject: 'Studio Open House', when: { kind: 'event', date: '2026-09-30', startTime: '18:30' },
    evidence: [{ url: igUrl, recordId: 'r1', subject_quote: 'Studio Open House',
      place_quote: 'at 171 East Liberty St, Toronto', date_quote: 'This Wednesday at 6:30pm' }] };
  const opts = { signals: [igSignal], forms: [igForm], now, posts: [], recordExtractor: ({ body }) => [record(body)],
    geography: { classifyVenueName: () => ({ locality: 'core', canonicalVenueId: 'addr:171-east-liberty-st' }) },
    sources: [{ id: 'ig:studio', identityId: 'ig:studio', parse: 'ig-post', tier: 'primary' }], publisherTiers: {} };
  assert.equal((await verifyRoundupForms(opts)).items[0].when.date, '2026-09-30');
  const ambiguous = { ...opts, signals: [{ ...igSignal, post: { ...post, caption: caption.replace('This Wednesday', 'This weekend') } }],
    forms: [{ ...igForm, evidence: [{ ...igForm.evidence[0], date_quote: 'This weekend at 6:30pm' }] }] };
  assert.equal((await verifyRoundupForms(ambiguous)).excluded[0].reason, 'undated');
  const late = { ...opts, now: '2026-10-01T12:00:00Z', signals: [{ ...igSignal, post: { ...post, timestamp: '2026-09-30T23:00:00Z' } }] };
  assert.equal((await verifyRoundupForms(late)).excluded[0].reason, 'retrospective');
});
