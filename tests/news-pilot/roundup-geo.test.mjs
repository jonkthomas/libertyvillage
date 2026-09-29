import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDRESS_POINTS, CORE_POLYGON, SEGMENTS, VENUES, WATCH_LIST, canonicalVenueId, classifyAddress,
  classifySegment, classifyVenueName, classifyTransitAlert, classifySectionPlace,
  statedOtherPlace, validateWatchList,
} from '../../scripts/news-pilot/roundup-geo.mjs';

const place = (placeQuote, extras = {}) => classifySectionPlace({ placeQuote, sectionText: placeQuote, subject: 'Open house', dateQuote: 'October 3, 2026', ...extras });
const rejected = (result) => assert.ok(['not-LV', 'unverifiable'].includes(result.verdict), JSON.stringify(result));

test('known City address points and the named Lamport lot are core only with Toronto context', () => {
  for (const address of ['40 Hanna Ave', '65 Jefferson Ave', '171 East Liberty St', '39 East Liberty St']) {
    assert.equal(classifyAddress(address, { addressLocality: 'Toronto' }).verdict, 'core', address);
  }
  assert.equal(classifyAddress('75 Fraser Ave, Toronto').verdict, 'core');
  assert.equal(classifyAddress('40 Hanna Ave').verdict, 'unverifiable');
  assert.equal(classifyAddress('40 Hanna Ave', { addressLocality: 'Hurricane' }).verdict, 'not-LV');
  assert.equal(canonicalVenueId('171 E Liberty St, Unit 113'), 'addr:171-east-liberty-st#113');
  assert.equal(canonicalVenueId('Unit 100, 171 E Liberty St'), 'addr:171-east-liberty-st#100');
  assert.equal(canonicalVenueId('171 E Liberty St #126'), 'addr:171-east-liberty-st#126');
  assert.equal(classifyAddress('40 Hanna Ave, M6K 3S3').verdict, 'core');
});

test('full City ring extract: every interior City point is core except the Douro street exception', () => {
  assert.equal(ADDRESS_POINTS.length, 381);
  assert.equal(CORE_POLYGON.features[0].geometry.coordinates[0].length, 43);
  assert.ok(ADDRESS_POINTS.some((p) => p.number === '40' && p.street === 'Hanna Ave'));
  assert.ok(ADDRESS_POINTS.some((p) => p.number === '68' && p.street === 'Douro St'));
  assert.equal(classifyAddress('68 Douro St, Toronto').verdict, 'not-LV');
  // Approved §6.2 core-address rule: King/Strachan/Dufferin frontage points inside the polygon are core.
  assert.deepEqual(classifyAddress('1187 King St W, Toronto'), { verdict: 'core', reason: 'city-polygon-address-point', canonicalVenueId: 'addr:1187-king-st-w' });
  assert.equal(classifyAddress('1155 King St W, Toronto').verdict, 'core');
  assert.equal(classifyAddress('1187 King St W').verdict, 'unverifiable');
  rejected(classifyAddress('1100 King St W, Toronto'));
  // Douro stays a street-specific exception; the Shaw/Crawford/Canniff pocket is not silently excluded.
  // City-internal sub-suffixes (3AA, 15RR) are not parsed and fail closed.
  const pocket = ADDRESS_POINTS.filter((p) => ['Crawford St', 'Canniff St', 'Shaw St', 'Solidarity Way'].includes(p.street) && /^\d+[A-Z]?$/.test(p.number));
  assert.equal(pocket.length, 13);
  for (const p of pocket) assert.equal(classifyAddress(`${p.number} ${p.street}, Toronto`).verdict, 'core', `${p.number} ${p.street}`);
  rejected(classifyAddress('1205 Queen St W, Toronto'));
  rejected(classifyAddress('100 Joe Shuster Way, Toronto'));
  rejected(classifyAddress('99 Douro St, Toronto'));
});

test('road record needs its road and two allowlisted segment intersections', () => {
  assert.equal(SEGMENTS.filter((s) => s.constituents).length, 4);
  assert.equal(classifySegment({ road: 'Hanna Ave', fromRoad: 'Snooker St', toRoad: 'Liberty St' }).verdict, 'core');
  for (const row of [
    ['Strachan Ave', 'Fleet St', 'King St W'],
    ['Strachan Ave', 'King St W', 'Lake Shore Blvd W'],
    ['King St W', 'Strachan Ave', 'Dufferin St'],
    ['Lake Shore Blvd W', 'Strachan Ave', 'Newfoundland Rd'],
    ['Dufferin St', 'King St W', 'Saskatchewan Rd'],
  ]) assert.equal(classifySegment({ road: row[0], fromRoad: row[1], toRoad: row[2] }).verdict, 'adjacent');
  for (const road of ['Joe Shuster Way', 'Douro St', 'Temple Ave', 'Elm Grove', 'Tyndall Ave', 'Stadium Rd', 'Fort York Blvd']) {
    rejected(classifySegment({ road, fromRoad: 'Liberty St', toRoad: 'King St W' }));
  }
  rejected(classifySegment({ road: 'Hanna Ave', fromRoad: 'Snooker St' }));
  rejected(classifySegment({ road: 'Hanna Ave', fromRoad: 'Snooker St', toRoad: 'Liberty St', coordinates: [-79.5, 43.7] }));
  rejected(classifySegment({ road: 'Hanna Ave', fromRoad: 'Snooker St', toRoad: 'Liberty St', coordinates: [-79.414, 43.638] }));
  assert.equal(classifySegment({ road: 'Hanna Ave', fromRoad: 'Snooker St', toRoad: 'Liberty St', coordinates: [-79.420026, 43.638985] }).verdict, 'core');
});

test('A1 real road-feed records are adjacent by intersection on a constituent City row', () => {
  // Typed shapes as roundup-records.mjs emits them from the replayed City feed bodies.
  const R09 = { id: 'Tor-RD042026-1044-5', road: 'Strachan Ave', fromRoad: 'Fleet St', toRoad: 'Fleet St', atRoad: null, coordinates: [-79.40955, 43.63606] };
  const R53 = { id: 'Tor-RD52026-5103', road: 'King St W', fromRoad: 'Strachan Ave', toRoad: 'Strachan Ave', atRoad: null, coordinates: [-79.41171, 43.64209] };
  const R54 = { road: 'Lake Shore Blvd W', fromRoad: 'Newfoundland Rd', toRoad: 'Martin Goodman Trl', atRoad: null, coordinates: [-79.41108, 43.6324] };
  for (const record of [R09, R53, R54]) assert.deepEqual(classifySegment(record), { verdict: 'adjacent', reason: 'reviewed-segment' }, record.road);
  assert.equal(classifySegment({ road: 'King St W', fromRoad: 'Atlantic Ave', toRoad: 'Jefferson Ave' }).verdict, 'adjacent');
  assert.equal(classifySegment({ road: 'King St W', atRoad: 'Shaw St' }).verdict, 'adjacent');
  assert.equal(classifySegment({ road: 'Dufferin St', fromRoad: 'Liberty St', toRoad: 'Springhurst Ave' }).verdict, 'adjacent');
  // Lake Shore runs Strachan -> British Columbia Rd (Dufferin never meets Lake Shore in Centreline).
  assert.equal(classifySegment({ road: 'Lake Shore Blvd W', fromRoad: 'Ontario Dr', toRoad: 'British Columbia Rd' }).verdict, 'adjacent');
  assert.equal(classifySegment({ road: 'Lake Shore Blvd W', fromRoad: 'Aquatic Dr', toRoad: 'Remembrance Dr' }).verdict, 'adjacent');
  // Beyond the reviewed paths, or contradicted by the record's own coordinate: fail closed.
  rejected(classifySegment({ road: 'Lake Shore Blvd W', fromRoad: 'Jameson Ave', toRoad: 'British Columbia Rd' }));
  rejected(classifySegment({ road: 'Lake Shore Blvd W', fromRoad: 'Strachan Ave', toRoad: 'Fleet St' }));
  rejected(classifySegment({ road: 'King St W', fromRoad: 'Strachan Ave', toRoad: 'Bathurst St' }));
  rejected(classifySegment({ road: 'Strachan Ave', fromRoad: 'King St W', toRoad: 'Queen St W' }));
  rejected(classifySegment({ road: 'Dufferin St', fromRoad: 'King St W', toRoad: 'Queen St W' }));
  rejected(classifySegment({ ...R54, coordinates: [-79.38, 43.65] }));
  rejected(classifySegment({ ...R09, road: 'Fleet St' }));
});

test('core road records fail closed when both cross roads are boundary roads', () => {
  // Mowat Ave King->King could be north of King (outside) or south of it (core): ambiguous.
  assert.deepEqual(classifySegment({ road: 'Mowat Ave', fromRoad: 'King St W', toRoad: 'King St W' }), { verdict: 'unverifiable', reason: 'core-segment-boundary-endpoints-only' });
  assert.equal(classifySegment({ road: 'Mowat Ave', atRoad: 'King St W' }).verdict, 'unverifiable');
  rejected(classifySegment({ road: 'Mowat Ave', fromRoad: 'King St W', toRoad: 'Queen St W' }));
  rejected(classifySegment({ road: 'Hanna Ave', fromRoad: 'Snooker St', toRoad: 'Queen St W' }));
});

test('Exhibition Place internal roads are adjacent only by reviewed City row IDs', () => {
  const internal = SEGMENTS.filter((s) => s.group === 'exhibition-place-internal');
  assert.equal(internal.length, 32);
  assert.ok(internal.every((s) => s.locality === 'adjacent' && /^\d+$/.test(s.centrelineId)));
  assert.equal(classifySegment({ road: "Princes' Blvd", fromRoad: 'Newfoundland Rd', toRoad: 'Canada Blvd' }).verdict, 'adjacent');
  assert.equal(classifySegment({ road: 'Princes Blvd', fromRoad: 'Newfoundland Rd', toRoad: 'Canada Blvd' }).verdict, 'adjacent');
  assert.equal(classifySegment({ road: 'Manitoba Dr', fromRoad: 'Nova Scotia Ave', toRoad: 'Quebec St' }).verdict, 'adjacent');
  assert.equal(classifySegment({ road: 'British Columbia Rd', fromRoad: 'Yukon Pl', toRoad: 'Lake Shore Blvd W' }).verdict, 'adjacent');
  for (const road of ['Remembrance Dr', 'Ontario Place Blvd', 'Stadium Rd', 'Fort York Blvd']) {
    rejected(classifySegment({ road, fromRoad: 'Lake Shore Blvd W', toRoad: 'Martin Goodman Trl' }));
  }
});

test('full venue identities require Toronto context and preserve adjacent classification', () => {
  assert.equal(classifyVenueName('BMO Field, Toronto').verdict, 'adjacent');
  assert.equal(classifyVenueName('Coca-Cola Coliseum', { domain: 'coca-colacoliseum.com' }).verdict, 'adjacent');
  assert.equal(classifyVenueName('Enercare Centre, Exhibition Place').verdict, 'adjacent');
  assert.equal(classifyVenueName('Queen Elizabeth Building, Exhibition Place').verdict, 'adjacent');
  assert.equal(classifyVenueName('RBC Amphitheatre, Toronto').verdict, 'adjacent');
  rejected(classifyVenueName('Coliseum'));
  rejected(classifyVenueName('BMO Field', { addressLocality: 'Hurricane' }));
  rejected(classifyVenueName('BMO Field, Toronto', { address: '40 Hanna Ave, Toronto' }));
});

test('TTC requires both route and affected local stop', () => {
  assert.equal(classifyTransitAlert({ route: '509', stops: ['Exhibition Loop'] }).verdict, 'adjacent');
  assert.equal(classifyTransitAlert({ route: '504', segmentText: 'King St W between Strachan and Dufferin' }).verdict, 'adjacent');
  assert.equal(classifyTransitAlert({ route: '504', stops: ['King St West at Atlantic Ave'] }).verdict, 'adjacent');
  assert.equal(classifyTransitAlert({ route: '504', segmentText: 'King St W between Strachan and Dufferin; service will close early' }).verdict, 'adjacent');
  // U2: route 504 runs the whole of King; only the Strachan-Dufferin frontage is local.
  rejected(classifyTransitAlert({ route: '504', segmentText: 'King St W between Spadina Ave and Bathurst St' }));
  rejected(classifyTransitAlert({ route: '504', segmentText: 'King St W between Strachan Ave and Bathurst St' }));
  rejected(classifyTransitAlert({ route: '504', segmentText: 'King St W' }));
  rejected(classifyTransitAlert({ route: '504', stops: [] }));
  rejected(classifyTransitAlert({ route: 'all routes', segmentText: 'city-wide weekend TTC closures' }));
});

test('project and BIA sections use their own event place, not project or actor identity', () => {
  assert.equal(place('Open house October 3, 2026. Location: 171 East Liberty St, Toronto').verdict, 'core');
  const cityEvent = { placeQuote: 'Location: Liberty Market Building, 171 East Liberty St., Suite 232',
    sectionText: 'Open House\nDate: October 3, 2026\nLocation: Liberty Market Building, 171 East Liberty St., Suite 232',
    subject: 'Open House', dateQuote: 'October 3, 2026', agentVerdict: 'core' };
  assert.equal(classifySectionPlace({ ...cityEvent, trustedToronto: true }).verdict, 'core',
    'a City source establishes Toronto for its own address-bearing event record');
  rejected(classifySectionPlace(cityEvent), 'the same text on an untrusted page cannot borrow City context');
  rejected(place('Open house October 3, 2026. Location: virtual meeting'));
  rejected(place('Open house October 3, 2026. Location: City Hall'));
  rejected(place('Organizer based at 40 Hanna Ave, Toronto presents an event at High Park'));
  rejected(place('Open house October 3, 2026 at a secret venue in Liberty Village'));
  rejected(place('Open house October 3, 2026 at 1205 Queen St W, Toronto'));
  rejected(place('Open house October 3, 2026 in Parkdale'));
  rejected(place('Open house October 3, 2026 in Hurricane, UT'));
  rejected(place('Open house October 3, 2026 in Liberty Village'));
  assert.equal(place('Open house October 3, 2026 at Exhibition Station, Toronto for the Ontario Line').verdict, 'adjacent');
});

test('prose quote must belong to section and same item, with agent verdict as a ceiling', () => {
  rejected(classifySectionPlace({ placeQuote: 'Open house October 3, 2026 at 40 Hanna Ave, Toronto', sectionText: 'Toronto Zoo event October 3, 2026', subject: 'Toronto Zoo event', agentVerdict: 'core' }));
  rejected(place('Tempo fall to Liberty October 3, 2026', { agentVerdict: 'core' }));
  rejected(place('Open house October 3, 2026, east side of Strachan south of Wellington', { agentVerdict: 'core' }));
  const adjacent = place('Open house October 3, 2026 at BMO Field, Toronto', { agentVerdict: 'core' });
  assert.equal(adjacent.verdict, 'adjacent');
  const capped = place('Open house October 3, 2026 at 40 Hanna Ave, Toronto', { agentVerdict: 'not-LV' });
  assert.equal(capped.verdict, 'not-LV');
});

test('watch registry resolves shared canonical venue IDs and rejects invalid entries', () => {
  assert.equal(validateWatchList().valid, true);
  assert.equal(WATCH_LIST.length, 30);
  const louie = WATCH_LIST.find((x) => x.handle === 'louiecoffeeshop');
  assert.equal(louie.canonicalVenueId, 'addr:1187-king-st-w');
  assert.equal(louie.ownDomain, 'louiecoffee.com');
  assert.ok(ADDRESS_POINTS.some((p) => p.number === '1187' && p.street === 'King St W'));
  for (const entry of WATCH_LIST) {
    const venue = VENUES.find((v) => v.canonicalVenueId === entry.canonicalVenueId && v.name === entry.business);
    assert.ok(venue, entry.handle);
    const classified = classifyAddress(venue.address, { trustedToronto: true });
    assert.equal(classified.verdict, 'core', entry.handle);
    assert.equal(classified.canonicalVenueId, entry.canonicalVenueId, entry.handle);
  }
  const burger = WATCH_LIST.find((x) => x.handle === 'burgerdrops');
  assert.equal(burger.canonicalVenueId, 'addr:116-atlantic-ave');
  assert.equal(classifyAddress('116 Atlantic Ave, Toronto').canonicalVenueId, burger.canonicalVenueId);
  assert.equal(validateWatchList([burger, burger]).valid, false);
  assert.equal(validateWatchList([{ ...burger, canonicalVenueId: 'addr:1205-queen-st-w' }]).valid, false);
  assert.equal(classifyAddress('99 Atlantic Ave, Toronto').verdict, 'core');
  assert.equal(classifyAddress('43 Hanna Ave #123, Toronto').canonicalVenueId, 'addr:43-hanna-ave#123');
});

test('Instagram event blocks classify explicit offsite and core places separately', () => {
  rejected(place('Burger Drops October 2, 2026 📍 The Barn @ Downsview Park', { subject: 'Burger Drops', dateQuote: 'October 2, 2026' }));
  assert.equal(place('Burger Drops October 3, 2026 📍 116 Atlantic Ave, Toronto', { subject: 'Burger Drops', dateQuote: 'October 3, 2026' }).verdict, 'core');
  rejected(place('Impact Kitchen October 3, 2026 #LibertyVillage', { subject: 'Impact Kitchen', dateQuote: 'October 3, 2026' }));
  rejected(place('Balzac\'s October 3, 2026 in Liberty Village', { subject: "Balzac's", dateQuote: 'October 3, 2026' }));
});

test('U1: prose venues need Toronto context; US namesakes and bare core venue names fail', () => {
  rejected(place('Open house October 3, 2026 at Liberty Village Park, Somerset, NJ 08873', { agentVerdict: 'core' }));
  rejected(place('Open house October 3, 2026 at Lamport Stadium', { agentVerdict: 'core' }));
  assert.equal(place('Open house October 3, 2026 at Lamport Stadium, Toronto').verdict, 'core');
  assert.equal(place('Open house October 3, 2026 at Liberty Village Park, Toronto').verdict, 'core');
  rejected(classifyAddress('70 East Liberty St, Somerset, NJ 08873'));
  // A team name is not a foreign place.
  assert.equal(place('Open house October 3, 2026: Tempo vs New York Liberty at Coca-Cola Coliseum, Toronto').verdict, 'adjacent');
});

test('identity: one canonical Lamport, Exhibition Place distinct from Enercare, exact QUEST XO alias', () => {
  const lamport = VENUES.filter((v) => /Lamport/.test(v.name));
  assert.equal(lamport.length, 1);
  assert.equal(lamport[0].canonicalVenueId, 'addr:75-fraser-ave');
  for (const name of ['Lamport Stadium, Toronto', 'Lamport Stadium Parking Lot, Toronto']) {
    assert.equal(classifyVenueName(name).canonicalVenueId, 'addr:75-fraser-ave', name);
  }
  assert.equal(classifyAddress('75 Fraser Ave, Toronto').canonicalVenueId, 'addr:75-fraser-ave');
  const exhibition = classifyVenueName('Exhibition Place, Toronto');
  assert.equal(exhibition.verdict, 'adjacent');
  assert.equal(exhibition.canonicalVenueId, 'grounds:exhibition-place');
  assert.equal(classifyVenueName('Enercare Centre, Exhibition Place').canonicalVenueId, 'addr:100-princes-blvd');
  assert.equal(classifyVenueName('QUEST XO Chocolate Creative Lab | Liberty Village, Toronto').canonicalVenueId, 'addr:25-liberty-st');
  assert.equal(classifyVenueName('QUEST XO Creative Lab, Toronto').canonicalVenueId, 'addr:25-liberty-st');
});

test('U3: an Instagram caption stating another place never inherits the own venue', () => {
  assert.deepEqual(statedOtherPlace('Burger Drops weekend!\nOct 2 📍The Barn @ Downsview Park\nSee you there', 'addr:116-atlantic-ave'), { verdict: 'not-LV', reason: 'offsite-place-stated' });
  assert.equal(statedOtherPlace('Pop-up Oct 3\n📍 Stackt Market, 28 Bathurst St', 'addr:116-atlantic-ave').verdict, 'unverifiable');
  assert.equal(statedOtherPlace('Location: Lamport Stadium Parking Lot', 'addr:116-atlantic-ave').verdict, 'unverifiable');
  assert.equal(statedOtherPlace('Oct 3 📍 116 Atlantic Ave. Patio', 'addr:116-atlantic-ave'), null);
  assert.equal(statedOtherPlace('Latte art night 📍 Liberty Village', 'addr:43-hanna-ave#123'), null);
  assert.equal(statedOtherPlace('Join us 📍43 Hanna Ave, Toronto', 'addr:43-hanna-ave#123'), null);
  assert.equal(statedOtherPlace('New fall menu is here', 'addr:116-atlantic-ave'), null);
});
