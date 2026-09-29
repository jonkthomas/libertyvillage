import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRoundupForms, revalidateRoundupForms, recordProvesTime } from '../../scripts/news-pilot/roundup-verify.mjs';
import { roundupSourceQuality } from '../../scripts/news-pilot/roundup-evidence.mjs';
import { planRoundupV2 } from '../../scripts/news-pilot/roundup.mjs';
import * as realGeography from '../../scripts/news-pilot/roundup-geo.mjs';
import { extractRoundupRecords } from '../../scripts/news-pilot/roundup-records.mjs';
import { ROUNDUP_SOURCES } from '../../scripts/news-pilot/sources.mjs';

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
  assert.equal(result.items[0].citations[0].url, url);
  assert.equal(result.items[0].citations[0].recordId, 'r1');
  assert.match(result.verifyDigest, /^[a-f0-9]{64}$/);
  const forged = options();
  forged.forms[0].tier = 'official';
  forged.sources = [{ ...source, tier: 'lead' }];
  assert.equal((await verifyRoundupForms(forged)).excluded[0].reason, 'weak-source');
});

test('City/BIA verified source supplies Toronto context for its own dated address event', async () => {
  const body = 'Open House\nDate: October 3, 2026\nLocation: Liberty Market Building, 171 East Liberty St., Suite 232';
  const verified = options([signal(body)], [{ ...form(), subject: 'Open House',
    when: { kind: 'event', date: '2026-10-03', endDate: null, startTime: null, endTime: null },
    evidence: [{ url, recordId: 'r1', subject_quote: 'Open House',
      place_quote: 'Location: Liberty Market Building, 171 East Liberty St., Suite 232', date_quote: 'October 3, 2026' }] }], body);
  verified.geography = realGeography;
  const result = await verifyRoundupForms(verified);
  assert.equal(result.items.length, 1, JSON.stringify(result.excluded));
  assert.equal(result.items[0].verdict, 'core');
  assert.equal(result.items[0].canonicalVenueId, 'addr:171-east-liberty-st');
});

test('prose geo receives item-bound fields and news identity uses evidence URL', async () => {
  let geographyInput;
  const news = options();
  news.sources = [{ ...source, url: 'https://registry.example/discovery', identityKind: 'news-discovery' }];
  news.publisherTiers = { 'official.example': 'official' };
  news.forms[0].when = { kind: 'news-update', date: '2026-10-03' };
  news.forms[0].item_type = 'news';
  news.geography = { classifySectionPlace: (input) => {
    geographyInput = input;
    return { verdict: 'core', canonicalVenueId: 'addr:171-east-liberty-st' };
  } };
  news.now = '2026-10-03T15:00:00Z';
  assert.equal((await verifyRoundupForms(news)).items[0].identityKey, `news:${url}`);
  assert.equal(geographyInput.placeQuote, 'at 171 East Liberty St, Toronto');
  assert.equal(geographyInput.subject, 'Autumn Market');
  assert.equal(geographyInput.domain, 'official.example');
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

test('injected Response bodies are read and blocked responses are not retried', async () => {
  const response = options();
  response.fetcher = async () => new Response(text, { status: 200 });
  assert.equal((await verifyRoundupForms(response)).items.length, 1);
  let calls = 0;
  const denied = options();
  denied.fetcher = async () => { calls += 1; return new Response('Just a moment', { status: 403 }); };
  assert.equal((await verifyRoundupForms(denied)).excluded[0].reason, 'unverifiable');
  assert.equal(calls, 1);
  const robots = options();
  robots.fetcher = async () => ({ ok: false, errorCode: 'blocked', status: null });
  assert.equal((await verifyRoundupForms(robots)).excluded[0].reason, 'unverifiable');
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

test('event dates on discovery prose and Last updated metadata cannot qualify', async () => {
  const discovery = options();
  discovery.sources = [{ ...source, identityKind: 'news-discovery', tier: 'lead' }];
  discovery.publisherTiers = { 'official.example': 'official' };
  assert.equal((await verifyRoundupForms(discovery)).excluded[0].reason, 'undated');
  const updatedBody = text.replace('Date: October 3, 2026', 'Last updated: October 3, 2026');
  const updated = options([signal(updatedBody)], [{ ...form(), evidence: [{ ...form().evidence[0],
    date_quote: 'Last updated: October 3, 2026' }] }], updatedBody);
  assert.equal((await verifyRoundupForms(updated)).excluded[0].reason, 'undated');
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
  const navOnlyDate = '<nav>September 25, 2026</nav><main>September 20, 2026. Autumn Market at 171 East Liberty St, Toronto.</main>';
  const recordTools = { cleanMainHtml: (html) => html.replace(/<nav>[\s\S]*?<\/nav>/i, ''),
    htmlToText: (html) => html.replace(/<[^>]+>/g, ' ') };
  assert.equal((await verifyRoundupForms({ ...opts, recordTools, fetcher: async (requested) => ({
    body: requested === copyUrl ? copyBody : navOnlyDate, status: 200 }) })).excluded[0].reason, 'stale');
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
  const post = { shortcode: 'ABC123', ownerUsername: 'studio', timestamp: '2026-09-27T23:07:57Z', caption };
  const igSignal = { signalId: 'ig1', sourceId: 'ig:studio', url: igUrl, post, records: [record(caption)] };
  const igForm = { ...form('ig1', igUrl), subject: 'Studio Open House', when: { kind: 'event', date: '2026-09-30', startTime: '18:30' },
    evidence: [{ url: igUrl, recordId: 'r1', subject_quote: 'Studio Open House',
      place_quote: 'at 171 East Liberty St, Toronto', date_quote: 'This Wednesday at 6:30pm' }] };
  const opts = { signals: [igSignal], forms: [igForm], now, posts: [], recordExtractor: ({ body }) => [record(body)],
    fetcher: async () => { throw new Error('Instagram must not use network fetcher'); },
    geography: { classifyVenueName: () => ({ locality: 'core', canonicalVenueId: 'addr:171-east-liberty-st' }) },
    sources: [{ id: 'ig:studio', identityId: 'ig:studio', parse: 'ig-post', tier: 'primary' }], publisherTiers: {} };
  assert.equal((await verifyRoundupForms(opts)).items[0].when.date, '2026-09-30');
  const ambiguous = { ...opts, signals: [{ ...igSignal, post: { ...post, caption: caption.replace('This Wednesday', 'This weekend') } }],
    forms: [{ ...igForm, evidence: [{ ...igForm.evidence[0], date_quote: 'This weekend at 6:30pm' }] }] };
  assert.equal((await verifyRoundupForms(ambiguous)).excluded[0].reason, 'undated');
  const late = { ...opts, now: '2026-10-01T12:00:00Z', signals: [{ ...igSignal, post: { ...post, timestamp: '2026-09-30T23:00:00Z' } }] };
  assert.equal((await verifyRoundupForms(late)).excluded[0].reason, 'retrospective');
  const sameDayCaption = 'Studio Open House at 171 East Liberty St, Toronto. Today. Meet the team.';
  const sameDay = { ...opts, now: '2026-09-30T23:30:00Z',
    signals: [{ ...igSignal, post: { ...post, timestamp: '2026-09-30T23:00:00Z', caption: sameDayCaption } }],
    forms: [{ ...igForm, when: { kind: 'event', date: '2026-09-30', startTime: null },
      evidence: [{ ...igForm.evidence[0], date_quote: 'Today' }] }] };
  assert.equal((await verifyRoundupForms(sameDay)).excluded[0].reason, 'retrospective');
  const excludedLead = { ...igSignal, signalId: 'ig-lead', post: { ...post, shortcode: 'LEAD' } };
  const refetch = { fetchedAt: '2026-09-29T14:55:00Z', provider: 'fixture', rows: [{ ...post, status: 'ok' }] };
  assert.equal((await verifyRoundupForms({ ...opts, signals: [igSignal, excludedLead],
    igRefetch: { ...refetch, rows: [...refetch.rows, { ...excludedLead.post, status: 'ok' }] } })).items.length, 1);
  assert.equal((await verifyRoundupForms({ ...opts, signals: [igSignal, excludedLead],
    igRefetch: refetch })).excluded[0].reason, 'unverifiable');
  assert.equal((await verifyRoundupForms({ ...opts, igRefetch: { ...refetch, rows: [{ ...post, caption: caption + ' changed', status: 'ok' }] } })).excluded[0].reason, 'unverifiable');
  for (const rows of [[], [{ ...post, status: 'missing' }], [{ ...post, status: 'private' }]]) {
    assert.equal((await verifyRoundupForms({ ...opts, igRefetch: { ...refetch, rows } })).excluded[0].reason, 'record-missing');
  }
  for (const changed of [{ ownerUsername: 'other' }, { timestamp: '2026-09-28T23:07:57Z' }]) {
    assert.equal((await verifyRoundupForms({ ...opts, igRefetch: { ...refetch, rows: [{ ...post, ...changed, status: 'ok' }] } })).excluded[0].reason, 'unverifiable');
  }
  const offsiteCaption = caption + ' This session is at High Park.';
  const offsite = { ...opts, signals: [{ ...igSignal, post: { ...post, caption: offsiteCaption } }] };
  assert.equal((await verifyRoundupForms(offsite)).excluded[0].reason, 'not-LV');
});

test('real IG extractor and verifier admit only an item-bound pinned own venue, never an offsite pin', async () => {
  const cases = [
    { handle: 'burgerdrops', shortcode: 'BURGER', timestamp: '2026-09-27T22:51:24Z',
      caption: '[ OCT. 3: $6 Fried Onion Burgers by George Motz]\n⏰ 11:30AM until sold out\n📍 116 Atlantic Ave. Patio',
      subject: '$6 Fried Onion Burgers by George Motz', dateQuote: 'OCT. 3', place: '116 Atlantic Ave. Patio', time: '11:30' },
    { handle: 'questxochocolate', shortcode: 'QUEST', timestamp: '2026-09-28T20:22:28Z',
      caption: 'Chocolate Illusions: Pizza Edition is back this Saturday at 1:30 PM!\n📅 This Saturday | 1:30 PM\n📍 QUEST XO Chocolate Creative Lab | Liberty Village',
      subject: 'Chocolate Illusions: Pizza Edition', dateQuote: 'This Saturday',
      place: 'QUEST XO Chocolate Creative Lab | Liberty Village', time: '13:30' },
  ];
  for (const row of cases) {
    const source = ROUNDUP_SOURCES.find((s) => s.id === `ig:${row.handle}`);
    const url = `https://www.instagram.com/p/${row.shortcode}/`;
    const post = { shortcode: row.shortcode, ownerUsername: row.handle, timestamp: row.timestamp, caption: row.caption };
    const records = extractRoundupRecords({ source, url, body: row.caption, post });
    const item = { signalId: row.shortcode, sourceId: source.id, url, post, records };
    const claim = { url, recordId: records[0].recordId, subject_quote: row.subject,
      place_quote: row.place, date_quote: row.dateQuote };
    const proposed = { ...form(row.shortcode, url), recordId: records[0].recordId, subject: row.subject,
      when: { kind: 'event', date: '2026-10-03', startTime: row.time },
      evidence: [claim], item_type: 'event' };
    const run = (signalItem) => verifyRoundupForms({ signals: [signalItem], forms: [proposed], now, posts: [],
      geography: realGeography, sources: [source], publisherTiers: {},
      fetcher: async () => { throw new Error('IG may not use HTML fetcher'); } });
    const accepted = await run(item);
    assert.equal(accepted.items[0]?.locality, 'core', `${row.handle}: ${JSON.stringify(accepted.excluded)}`);
    const changed = { ...item, post: { ...post, caption: row.caption.replace(`📍 ${row.place}`, '📍 The Barn @ Downsview Park') } };
    const refused = await run(changed);
    assert.equal(refused.items.length, 0, row.handle);
    if (row.handle === 'burgerdrops') {
      for (const location of ['at @stacktmarket', '@stacktmarket', '@ Stackt']) {
        const mixedCaption = `Burger Drops pop-up Saturday October 3 ${location}\n${row.caption}`;
        const mixedPost = { ...post, caption: mixedCaption };
        const mixedRecord = extractRoundupRecords({ source, url, body: mixedCaption, post: mixedPost })[0];
        const mixed = await verifyRoundupForms({ signals: [{ ...item, post: mixedPost, records: [mixedRecord] }],
          forms: [{ ...proposed, recordId: mixedRecord.recordId,
            evidence: [{ ...claim, recordId: mixedRecord.recordId }] }], now, posts: [],
          geography: realGeography, sources: [source], publisherTiers: {},
          fetcher: async () => { throw new Error('IG may not HTML fetch'); } });
        assert.equal(mixed.items.length, 0, `pinned own venue must not override contradictory ${location}`);
        assert.equal(mixed.excluded[0]?.reason, 'unverifiable');
      }
    }
  }
});

test('feed records compare trusted snapshot fields before admission', async () => {
  const feedUrl = 'https://city.example/roads';
  const typed = { id: 'r42', road: 'Strachan Ave', fromRoad: 'King St W', toRoad: 'Fleet St',
    startTime: '2026-09-29T12:00:00Z', endTime: '2026-10-02T12:00:00Z', description: 'Road work' };
  const fresh = record(JSON.stringify(typed));
  fresh.typed = typed;
  const feedSignal = { signalId: 'road1', sourceId: 'roads', url: feedUrl, records: [fresh] };
  const roadForm = { ...form('road1', feedUrl), subject: 'Strachan Ave', when: { kind: 'restriction', date: '2026-09-29' },
    item_type: 'road', evidence: [{ url: feedUrl, recordId: 'r1', subject_quote: 'Strachan Ave', place_quote: null, date_quote: null }] };
  const opts = { signals: [feedSignal], forms: [roadForm], now, posts: [],
    fetcher: async () => ({ body: '{}', status: 200 }), recordExtractor: () => [fresh],
    geography: { classifySegment: () => ({ locality: 'core' }) },
    sources: [{ id: 'roads', parse: 'json-feed', identityKind: 'road-feed', tier: 'official' }], publisherTiers: {} };
  const accepted = await verifyRoundupForms(opts);
  assert.equal(accepted.items[0].identityKey, 'road:r42');
  assert.equal(accepted.items[0].when.endDate, '2026-10-02');
  assert.equal(accepted.items[0].when.endTime, '08:00');
  const changed = { ...fresh, typed: { ...typed, endTime: '2026-10-03T12:00:00Z' } };
  assert.equal((await verifyRoundupForms({ ...opts, recordExtractor: () => [changed] })).excluded[0].reason, 'record-missing');
});

test('Instagram own-venue fallback (null place_quote) never admits a caption that states another place', async () => {
  const igUrl = 'https://www.instagram.com/p/BD123/';
  const run = async (caption) => {
    const post = { shortcode: 'BD123', ownerUsername: 'burgerdrops', timestamp: '2026-09-27T23:07:57Z', caption };
    return verifyRoundupForms({
      signals: [{ signalId: 'ig1', sourceId: 'ig:burgerdrops', url: igUrl, post, records: [record(caption)] }],
      forms: [{ ...form('ig1', igUrl), subject: 'Burger Drops', when: { kind: 'event', date: '2026-10-03', startTime: null },
        evidence: [{ url: igUrl, recordId: 'r1', subject_quote: 'Burger Drops', place_quote: null, date_quote: 'Saturday October 3' }] }],
      now, posts: [], recordExtractor: ({ body }) => [record(body)],
      fetcher: async () => { throw new Error('Instagram must not use network fetcher'); },
      geography: realGeography, publisherTiers: {},
      sources: [{ id: 'ig:burgerdrops', identityId: 'ig:burgerdrops', handle: 'burgerdrops', parse: 'ig-post', tier: 'primary',
        canonicalVenueId: 'addr:116-atlantic-ave', multiLocation: false, requiresVenueInPost: false }],
    });
  };
  const own = await run('Burger Drops pop-up Saturday October 3. Smash burgers all day.');
  assert.equal(own.items[0]?.locality, 'core', JSON.stringify(own.excluded));
  const offsite = await run('Burger Drops pop-up Saturday October 3\n📍The Barn @ Downsview Park');
  assert.equal(offsite.items.length, 0);
  assert.equal(offsite.excluded[0].reason, 'not-LV');
  const elsewhere = await run('Burger Drops pop-up Saturday October 3\n📍 Stackt Market, 28 Bathurst St');
  assert.equal(elsewhere.items.length, 0);
  assert.equal(elsewhere.excluded[0].reason, 'unverifiable');
  for (const caption of [
    'Burger Drops pop-up Saturday October 3 at Stackt Market, 28 Bathurst St',
    'Burger Drops is at the Evergreen Brick Works market Saturday October 3',
    'Catch Burger Drops at Union Station Saturday October 3!',
    'Burger Drops pop-up Saturday October 3 in Mississauga at Square One',
  ]) {
    const admitted = await run(caption);
    assert.equal(admitted.items.length, 0, caption + JSON.stringify(admitted));
    assert.ok(['unverifiable', 'not-LV'].includes(admitted.excluded[0].reason), caption);
  }
  const prose = await run('Burger Drops meets Sarah Chen Saturday October 3. Smash burgers all day in Liberty Village.');
  assert.equal(prose.items[0]?.locality, 'core', JSON.stringify(prose.excluded));
});
