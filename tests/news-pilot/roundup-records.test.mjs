import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRoundupRecords, htmlToText, normalizeRecordText, resolveCaptionDates, selectElements,
} from '../../scripts/news-pilot/roundup-records.mjs';
import { ROUNDUP_SOURCES, roundupSourceById } from '../../scripts/news-pilot/sources.mjs';

const src = (id) => roundupSourceById(id, ROUNDUP_SOURCES);
const norm = normalizeRecordText;
const ig = (handle) => ({ id: `ig:${handle}`, parse: 'ig-post', identityKind: 'ig', handle });
const igRecords = (handle, shortcode, timestamp, caption) => extractRoundupRecords({
  source: ig(handle), url: `https://www.instagram.com/p/${shortcode}/`, body: caption,
  post: { shortcode, timestamp, ownerUsername: handle },
});

// Real captions from the 2026-09-29 read-only trial (owned public posts), raw line breaks intact.
const CAPTIONS = {
  IG065: ['oyflibertyvillage', 'Dc0yJIYRmVP', '2026-09-04T12:03:10.000Z', 'Get ready to SCULPT IT to LATIN MUSICA 🔥💃🏽\n\nJoin us on Tuesday, September 15 @ 5:30PM for a high energy Sculpt IT workout set to Latin beats! 🎶💪🏼 \n\nAnd the best part? 👀 After class, Rawcology is treating everyone to a delicious post-workout snack!\n\n✨ Sculpt\n🔥 Sweat\n💃🏽 Latin beats\n\nBooking opens a week before. See you on the mat'],
  IG069: ['nrghaus', 'Dc4RalGpidd', '2026-09-04T20:45:35.000Z', 'Alchemy | A Guided Contrast Therapy Experience \n\nOn September 10th at 7pm, we’re bringing you a special collaborative edition of Alchemy with @mark.hamidi and @angela_ahimsa \n\nMove, breathe, release and journey through heat + cold.\n\nSeptember 10 · 7 PM\n📍 NRG Haus\nReserve your spot through the link in bio.'],
  IG084: ['greenlibertyvillage', 'DdCEMULjpRq', '2026-09-08T16:00:15.000Z', 'Your Saturday Eco-Fair guide 🌱\n\n🎨 Eco arts & crafts\n🔧 Bike & stroller tune-ups\n🛍️ Sustainable local vendors\n🌱 Neighbourhood Plant Swap\n🎁 Wellness Prize Raffle\n💚 Community & wellness info\n\nSee you Saturday, Sept 12, 4-7 pm, at Liberty Village Park!\n\n#EcoFair #LibertyVillage #GreenLibertyVillage #EcoToronto #SustainableLiving'],
  IG157: ['libertyresident', 'DdccoPoB4-y', '2026-09-18T21:54:04.000Z', 'Join us tomorrow for our final Liberate Your Locker event of the year!'],
  IG158: ['questxochocolate', 'DdcicwEJmVq', '2026-09-18T22:47:02.000Z', '✨ BREAK IT. REPAIR IT. EAT IT. 🍫\n\nTomorrow at the Chocolate Lab: Chocolate Painting — Kintsugi Art.\n\n📅 This SATURDAY (Tomorrow)\n📍 QUEST XO Chocolate Creative Lab | Liberty Village\n\n#TorontoEvents'],
  IG193: ['nrghaus', 'DdsGnFrJjtb', '2026-09-24T23:50:34.000Z', 'TORONTO! Join us and celebrate GoodLife HYROX Toronto at Station 9: The Recovery! Race-day energy meets recovery, music and all the vibes\n\nWhen: Saturday 3 October | 7-10PM\nWhere: @nrghaus\n\nMove between sauna and cold plunge, and enjoy drinks from the functional, alcohol-free bar.'],
  IG214: ['burgerdrops', 'DdzsAfDS8GO', '2026-09-27T22:51:24.000Z', '🍔 We’re bringing back celebrated burger historian, author and filmmaker George Motz to Toronto for two special back-to-back events next weekend.\n\n🎟️ Tickets on-sale Monday, September 28 @ 11AM.\n\n[ OCT. 2: Meet, Greet & Eat w/ George Motz ]\n⏰ 5:30PM - 9:00PM\n🍔 Exclusive menu by the Burger Drops Team\n📍The Barn @ Downsview Park\n\n[ OCT. 3: $6 Fried Onion Burgers by George Motz]\n⏰ 11:30AM until sold out\n📍 116 Atlantic Ave. Patio\n\n#bdtour2026 #burgerdrops'],
  IG215: ['questxochocolate', 'DdzvxJJJLy9', '2026-09-27T23:07:57.000Z', '🎨🍫 EAT YOUR ART. GET CREATIVE.\n\nThis Wednesday, come paint, play, experiment—and create a chocolate masterpiece you can actually eat.\n\nChocolate Painting: Open Studio at the Creative Lab. No experience needed. Just bring your imagination. ✨\n\n📅 This Wednesday at 6:30pm\n📍 QUEST XO Chocolate Creative Lab | Liberty Village in Toronto\n\nCome create something delicious. 🍫\n\n#TorontoEvents'],
  IG221: ['burgerdrops', 'Dd12rA_ScQQ', '2026-09-28T18:49:36.000Z', '📍Final Burger Tour 2026 Stop: Toronto! 🇨🇦 This one’s for our city, our people, our home. ❤️ Tickets for the special October 2 event are now on sale! ⬇️ Or join us for a burger at 116 Altantic Ave. on October 3 (no ticket required). @motzburger #bdtour2026'],
  IG223: ['questxochocolate', 'Dd2Bor1JPju', '2026-09-28T20:22:28.000Z', '🍕 WAIT… THAT’S CHOCOLATE?! 👀🍫\n\nChocolate Illusions: Pizza Edition is back this Saturday at 1:30 PM!\n\n📅 This Saturday | 1:30 PM\n📍 QUEST XO Chocolate Creative Lab | Liberty Village\n\n#TorontoEvents'],
};

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

test('selectElements cuts unbalanced rows at the next row and keeps inline text joined', () => {
  const html = '<div class="row"><b>A</b><div class="x">one</div><div class="row"><span>B</span> o<i>pen</i></div>';
  const rows = selectElements(html, '.row').map((r) => htmlToText(r.innerHtml));
  assert.deepEqual(rows.map((t) => t.replace(/\n/g, ' ')), ['A one', 'B open']);
  assert.equal(selectElements('<p><span>a</span><span>b</span></p>', 'p span:nth(1)')[0].innerHtml, 'b');
});

test('normalization decodes entities, straightens quotes and dashes, collapses whitespace', () => {
  assert.equal(norm('Liberty&nbsp;Village’s  “Eco–Fair” &amp; more'), 'Liberty Village\'s "Eco-Fair" & more');
});

// ---------------------------------------------------------------------------
// Listing rows (real layouts: BMO Field, Coca-Cola Coliseum, Exhibition Place)
// ---------------------------------------------------------------------------

const BMO = `<html><body><nav class="menu"><a>BMO Field Events Liberty Village</a></nav><main>
<div class="eventItemWrapper"><div class="eventItem entry featured team clearfix"><div class="info clearfix"><div class="info-inner">
<div class="date" aria-label="October 3 2026"> <span class="m-date__singleDate"><span class="m-date__month">Oct </span><span class="m-date__day">03</span></span> <span class="time">at 3:00 PM</span></div>
<h3 class="h3 title long_title"> <a href="/events/detail/x" title="More Info">Toronto Argonauts vs. BC Lions</a> </h3>
<div class="meta"><h5 class="time"><svg viewBox="0 0 20 20"><path d="M1"/><span class="startlang">Event Starts</span> <span class="start"> 3:00 PM</span> </h5></div></div></div></div></div>
<div class="eventItemWrapper"><div class="eventItem entry"><div class="info"><div class="date"><span class="m-date__month">Oct </span><span class="m-date__day">10</span> <span class="time">at 1:00 PM</span></div>
<h3 class="title"><a>Toronto FC vs. CF Montréal</a></h3><span class="start"> 1:00 PM</span></div></div></div>
</main><footer>© BMO Field</footer></body></html>`;

test('html-listing rows carry typed subject/date/time and a registry-stable recordId', () => {
  const recs = extractRoundupRecords({ source: src('rv2-bmo-field'), url: 'https://www.bmofield.com/events', body: BMO });
  assert.equal(recs.length, 2);
  assert.deepEqual(recs.map((r) => r.kind), ['listing-row', 'listing-row']);
  assert.equal(recs[0].typed.subject, 'Toronto Argonauts vs. BC Lions');
  assert.equal(recs[0].typed.dateText, 'Oct 03 at 3:00 PM');
  assert.equal(recs[0].typed.timeText, '3:00 PM');
  assert.ok(norm(recs[0].text).includes('Toronto Argonauts vs. BC Lions'));
  assert.ok(!norm(recs[0].text).includes('Toronto FC'), 'rows never bleed into the next row');
  const again = extractRoundupRecords({ source: src('rv2-bmo-field'), url: 'https://www.bmofield.com/events', body: BMO.replace('<footer>', '<p>x</p><footer>') });
  assert.deepEqual(again.map((r) => r.recordId), recs.map((r) => r.recordId), 'recordId is independent of unrelated page changes');
});

test('listing rows exclude registry-excluded buildings (Exhibition Place: Hotel X)', () => {
  const html = `<main><div class="card-events"><div class="card-events__title"><h6>HYROX Toronto 2026</h6></div>
  <div class="card-events__bottom-text"><span> Oct 1 - Oct 4, 2026 </span><span>Enercare Centre</span></div></div>
  <div class="card-events"><div class="card-events__title"><h6>Spa Night</h6></div>
  <div class="card-events__bottom-text"><span> Oct 2, 2026 </span><span>Hotel X Toronto</span></div></div></main>`;
  const recs = extractRoundupRecords({ source: src('rv2-explace'), url: 'https://www.explace.on.ca/event/', body: html });
  assert.deepEqual(recs.map((r) => [r.typed.subject, r.typed.dateText, r.typed.building]), [['HYROX Toronto 2026', 'Oct 1 - Oct 4, 2026', 'Enercare Centre']]);
});

// ---------------------------------------------------------------------------
// JSON-LD Event records
// ---------------------------------------------------------------------------

test('JSON-LD: only Event objects are records; each block parsed separately; malformed blocks ignored', () => {
  const html = `<head>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"blogTO","address":{"streetAddress":"40 Hanna Ave"}}</script>
  <script type="application/ld+json">{"@type":"NewsArticle","datePublished":"'+ com['"}</script>
  <script type="application/ld+json">{"@graph":[{"@type":"MusicEvent","name":"THE RED CLAY STRAYS","startDate":"2026-09-30T18:30:00-04:00","location":{"@type":"Place","name":"RBC Amphitheatre","address":{"@type":"PostalAddress","streetAddress":"909 Lakeshore Blvd. W.","addressLocality":"Toronto","postalCode":"M6K3L3"}}},{"@type":"WebPage","name":"Shows"}]}</script>
  </head><body><main><h1>Shows</h1><p>Organizer based at 40 Hanna Ave.</p></main></body>`;
  const recs = extractRoundupRecords({ source: src('rv2-rbc-amphitheatre'), url: 'https://www.rbcamphitheatre.com/shows', body: html });
  assert.equal(recs.length, 1);
  const [ev] = recs;
  assert.equal(ev.kind, 'jsonld-event');
  assert.deepEqual([ev.typed.name, ev.typed.startDate, ev.typed.location.name, ev.typed.location.address.streetAddress],
    ['THE RED CLAY STRAYS', '2026-09-30T18:30:00-04:00', 'RBC Amphitheatre', '909 Lakeshore Blvd. W.']);
  assert.ok(norm(ev.text).includes('909 Lakeshore Blvd. W.'));
  assert.ok(!norm(ev.text).includes('40 Hanna'), 'the Organization address is never part of the Event record');
});

// ---------------------------------------------------------------------------
// Page sections (real org/project layouts) and nav stripping
// ---------------------------------------------------------------------------

const BIA = `<html><body><header class="site-header"><nav>Liberty Village Events Shop</nav></header><main>
<article class="eventlist-event"><h1 class="eventlist-title">Give Me Liberty Street Party</h1>
<time class="event-date" datetime="2026-09-17">Thursday, September 17, 2026</time>
<p>Get ready for an unforgettable celebration of community, creativity, and culture! 🎉On Thursday, September 17th, 2026, the iconic Lamport Stadium parking lot (75 Fraser Avenue) will transform into a dynamic outdoor festival for the Give Me Liberty street party.</p></article>
<article class="eventlist-event"><h1 class="eventlist-title">Toronto Zoo Night</h1><p>Visit the zoo on September 18, 2026.</p></article>
</main><footer><p>Stay in touch: Liberty Village BIA, 67 Mowat Ave</p></footer></body></html>`;

test('html-page sections: one record per heading; nav/header/footer text is never in a record', () => {
  const recs = extractRoundupRecords({ source: src('rv2-lv-bia-events'), url: 'https://www.libertyvillagebia.com/events', body: BIA });
  const sections = recs.filter((r) => r.kind === 'section');
  assert.deepEqual(sections.map((r) => r.typed.heading), ['Give Me Liberty Street Party', 'Toronto Zoo Night']);
  const street = norm(sections[0].text);
  assert.ok(street.includes('On Thursday, September 17th, 2026, the iconic Lamport Stadium parking lot (75 Fraser Avenue)'));
  assert.ok(!street.includes('Toronto Zoo'), 'the second event is its own record');
  for (const r of recs) {
    assert.ok(!norm(r.text).includes('Liberty Village Events Shop'), 'nav text stripped');
    assert.ok(!norm(r.text).includes('67 Mowat Ave'), 'footer text stripped');
  }
});

test('City project layout: the Open House section holds date, time and location; "Last updated" is elsewhere', () => {
  const html = `<body><div id="page-header"><nav class="breadcrumbs">Home › Parks</nav></div>
  <h1>New Park at 34 Hanna Avenue</h1><p>A new 4,900 m2 park is coming to 34 Hanna Ave.</p>
  <h2>Open House</h2><p><strong>Date:</strong> October 3, 2026<br><strong>Time:</strong> Noon to 4 p.m.<br><strong>Location:</strong> Liberty Market Building, 171 East Liberty St., Suite 232</p>
  <h2>Contact</h2><p>Last updated: September 20, 2026</p></body>`;
  const recs = extractRoundupRecords({ source: src('rv2-city-project-34-hanna-park'), url: 'https://www.toronto.ca/x/', body: html });
  const open = recs.find((r) => r.typed.heading === 'Open House');
  assert.ok(norm(open.text).includes('Date: October 3, 2026 Time: Noon to 4 p.m. Location: Liberty Market Building, 171 East Liberty St.'));
  assert.ok(!norm(open.text).includes('Last updated'));
  assert.ok(!recs.some((r) => norm(r.text).includes('Home › Parks')), 'breadcrumbs stripped');
  const contact = recs.find((r) => r.typed.heading === 'Contact');
  assert.ok(norm(contact.text).includes('Last updated: September 20, 2026'));
});

test('a quote that appears only in site navigation is in no record (site-nav keyword trap)', () => {
  const html = `<body><nav><ul><li><a>Liberty Village</a></li></ul></nav><div class="main-menu">Liberty Village news</div>
  <article><h1>Stabbing downtown</h1><p>Police said a man was injured near Yonge St. on September 20, 2026.</p></article></body>`;
  const recs = extractRoundupRecords({ source: src('rv2-serper-news'), url: 'https://www.torontotoday.ca/x', body: html });
  assert.ok(recs.length >= 1);
  assert.ok(recs.every((r) => !norm(r.text).includes('Liberty Village')));
});

test('a page with no headings is one section', () => {
  const recs = extractRoundupRecords({ source: src('rv2-serper-news'), url: 'https://example.com/a', body: '<body><p>Only prose here about an event.</p></body>' });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].typed.ordinal, 0);
});

// ---------------------------------------------------------------------------
// Feed records
// ---------------------------------------------------------------------------

test('road-restriction feed records: trusted id, epoch-ms times, raw canonical serialization', () => {
  const body = JSON.stringify({ Closure: [{ id: 'Tor-RD1S2026-975', road: 'Hanna Ave', fromRoad: 'Snooker St', toRoad: 'Liberty St', atRoad: null,
    latitude: '43.639270', longitude: '-79.419830', startTime: '1790600400000', endTime: '1790969400000',
    description: 'Toronto-TMC: PARKING REQUESTED FOR EQUIPMENT', name: 'Hanna Ave 47 m South of Snooker St' }] });
  const [r] = extractRoundupRecords({ source: src('rv2-road-restrictions'), url: 'https://secure.toronto.ca/x', body });
  assert.equal(r.recordId, 'Tor-RD1S2026-975');
  assert.deepEqual([r.typed.road, r.typed.fromRoad, r.typed.toRoad, r.typed.startTime, r.typed.endTime],
    ['Hanna Ave', 'Snooker St', 'Liberty St', 1790600400000, 1790969400000]);
  assert.deepEqual(r.typed.coordinates, [-79.41983, 43.63927]);
  assert.ok(r.text.includes('"description":"Toronto-TMC: PARKING REQUESTED FOR EQUIPMENT"'));
});

test('TTC alert records carry route, stops, segment text and active period', () => {
  const body = JSON.stringify({ routes: [{ id: '77001', route: '504', stopStart: 'King St West at Strachan Ave', stopEnd: 'Dufferin St',
    stops: ['1', '2'], headerText: '504 King: Diversion', effect: 'DETOUR', activePeriod: { start: '2026-10-03T12:00:00Z', end: '2026-10-04T12:00:00Z' } }] });
  const [r] = extractRoundupRecords({ source: src('rv2-ttc-alerts'), url: 'https://alerts.ttc.ca/api/alerts/live-alerts', body });
  assert.equal(r.recordId, '77001:504');
  assert.equal(r.typed.segment, 'King St West at Strachan Ave to Dufferin St');
  assert.ok(r.typed.segmentText.includes('504 King: Diversion'));
  assert.equal(r.typed.activeStart, Date.parse('2026-10-03T12:00:00Z'));
});

// ---------------------------------------------------------------------------
// Instagram event records (R3) and caption dates (A2-IG)
// ---------------------------------------------------------------------------

test('one distinct date: the whole raw caption is one record (IG084, IG193, IG215, IG065, IG069)', () => {
  const expected = { IG084: '2026-09-12', IG193: '2026-10-03', IG215: '2026-09-30', IG065: '2026-09-15', IG069: '2026-09-10' };
  for (const [id, date] of Object.entries(expected)) {
    const [handle, code, ts, caption] = CAPTIONS[id];
    const recs = igRecords(handle, code, ts, caption);
    assert.equal(recs.length, 1, id);
    assert.equal(recs[0].text, caption, `${id} keeps raw formatting`);
    assert.equal(recs[0].typed.date, date, id);
    assert.equal(recs[0].typed.ordinal, 0);
  }
});

test('regression: paragraph splitting would separate subject, date and place for single-date captions', () => {
  const [handle, code, ts, caption] = CAPTIONS.IG215;
  const paragraphs = caption.split(/\n\s*\n/);
  const subject = paragraphs.findIndex((p) => p.includes('Chocolate Painting: Open Studio'));
  const place = paragraphs.findIndex((p) => p.includes('📍 QUEST XO'));
  assert.notEqual(subject, place, 'the fixture really spans paragraphs');
  const [record] = igRecords(handle, code, ts, caption);
  assert.ok(record.text.includes('Chocolate Painting: Open Studio') && record.text.includes('This Wednesday at 6:30pm') && record.text.includes('📍 QUEST XO'));
  const [h84, c84, t84, cap84] = CAPTIONS.IG084;
  const [r84] = igRecords(h84, c84, t84, cap84);
  assert.ok(r84.text.includes('Your Saturday Eco-Fair guide') && r84.text.includes('Liberty Village Park'));
});

test('IG214: three dates split into blocks; the bracketed Oct 3 heading keeps its ⏰ and 📍 lines', () => {
  const [handle, code, ts, caption] = CAPTIONS.IG214;
  const recs = igRecords(handle, code, ts, caption);
  const oct3 = recs.find((r) => r.typed.date === '2026-10-03');
  assert.equal(oct3.text, '[ OCT. 3: $6 Fried Onion Burgers by George Motz]\n⏰ 11:30AM until sold out\n📍 116 Atlantic Ave. Patio');
  const oct2 = recs.find((r) => r.typed.date === '2026-10-02');
  assert.ok(oct2.text.includes('📍The Barn @ Downsview Park'));
  assert.ok(!oct2.text.includes('Atlantic'), 'blocks never mix events');
  assert.equal(new Set(recs.map((r) => r.recordId)).size, recs.length);
});

test('IG221: two dates in one block is never a record (unverifiable)', () => {
  const [handle, code, ts, caption] = CAPTIONS.IG221;
  assert.deepEqual(resolveCaptionDates(caption, ts), ['2026-10-02', '2026-10-03']);
  assert.deepEqual(igRecords(handle, code, ts, caption), []);
});

test('multi-date caption whose Oct 3 block states no place still yields a block record (verifier holds it)', () => {
  const caption = '[ OCT. 2: Party ]\n📍 The Barn @ Downsview Park\n\n[ OCT. 3: Burgers ]\n⏰ 11:30AM';
  const recs = igRecords('burgerdrops', 'DdzsAfDS8GO', '2026-09-27T22:51:24.000Z', caption);
  const oct3 = recs.find((r) => r.typed.date === '2026-10-03');
  assert.equal(oct3.text, '[ OCT. 3: Burgers ]\n⏰ 11:30AM');
});

test('captions with no stated date (image-only dates) produce no record', () => {
  assert.deepEqual(igRecords('libertyresident', 'DcqiKakmwQF', '2026-08-30T12:40:21.000Z', ''), []);
  assert.deepEqual(igRecords('ohawellness', 'DdHSweujA9B', '2026-09-10T12:00:00.000Z', 'Swipe for our September schedule 🧘'), []);
});

test('relative dates resolve against the provider timestamp in America/Toronto', () => {
  const [, , ts158, cap158] = CAPTIONS.IG158;
  assert.deepEqual(resolveCaptionDates(cap158, ts158), ['2026-09-19'], 'IG158 "This SATURDAY (Tomorrow)" both → Sep 19');
  const [, , ts157, cap157] = CAPTIONS.IG157;
  assert.deepEqual(resolveCaptionDates(cap157, ts157), ['2026-09-19'], 'IG157 tomorrow');
  const [, , ts223, cap223] = CAPTIONS.IG223;
  assert.deepEqual(resolveCaptionDates(cap223, ts223), ['2026-10-03'], 'IG223 this Saturday (posted Monday)');
  const [, , ts215, cap215] = CAPTIONS.IG215;
  assert.deepEqual(resolveCaptionDates(cap215, ts215), ['2026-09-30'], 'IG215 This Wednesday (posted Sunday evening Toronto)');
  assert.deepEqual(resolveCaptionDates('See you next Friday', '2026-09-28T16:00:00Z'), ['2026-10-09'], 'next Friday on a Monday = that Friday + 7');
  assert.deepEqual(resolveCaptionDates('Join us tomorrow!', '2026-10-03T02:30:00Z'), ['2026-10-03'], 'Toronto date boundary (Oct 2, 22:30 local)');
  assert.deepEqual(resolveCaptionDates('Open tonight and today', '2026-09-28T16:00:00Z'), ['2026-09-28']);
  assert.deepEqual(resolveCaptionDates('This Monday only', '2026-09-28T16:00:00Z'), ['2026-09-28'], 'this <weekday> includes P itself');
});

test('explicit dates: yearless month-day resolves inside [P, P + 60 d]; ambiguous phrases resolve to nothing', () => {
  assert.deepEqual(resolveCaptionDates('Saturday, Sept 12 at the park', '2026-09-08T16:00:00Z'), ['2026-09-12']);
  assert.deepEqual(resolveCaptionDates('Saturday 3 October | 7-10PM', '2026-09-24T23:50:34Z'), ['2026-10-03']);
  assert.deepEqual(resolveCaptionDates('What a night on Sept 12!', '2026-09-13T16:00:00Z'), [], 'a past yearless date is not resolved forward');
  assert.deepEqual(resolveCaptionDates('Dec 31, 2026 party', '2026-09-13T16:00:00Z'), ['2026-12-31'], 'year-bearing kept as stated');
  for (const phrase of ['this weekend', 'next week', 'soon', 'coming up', 'later this month', 'last Saturday was great']) {
    assert.deepEqual(resolveCaptionDates(`Join us ${phrase}!`, '2026-09-18T16:00:00Z'), [], phrase);
  }
  assert.deepEqual(resolveCaptionDates('tomorrow, Sept 20', '2026-09-18T16:00:00Z'), ['2026-09-19', '2026-09-20'], 'conflict yields two dates');
  assert.deepEqual(igRecords('x', 'DdzsAfDS8GO', '2026-09-18T16:00:00Z', 'Party tomorrow, Sept 20 📍 116 Atlantic Ave'), [], 'conflicting dates → no record (undated)');
});

test('recordIds are deterministic and independent of model values', () => {
  const [handle, code, ts, caption] = CAPTIONS.IG214;
  assert.deepEqual(igRecords(handle, code, ts, caption).map((r) => r.recordId), igRecords(handle, code, ts, caption).map((r) => r.recordId));
  assert.ok(igRecords(handle, code, ts, caption).every((r) => /^ig:[0-9a-f]{32}$/.test(r.recordId)));
});
