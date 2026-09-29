import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDRESS_POINTS, CORE_POLYGON, VENUES, WATCH_LIST, canonicalVenueId, classifyAddress,
  classifySegment, classifyVenueName, classifyTransitAlert, classifySectionPlace,
  validateWatchList,
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

test('full City ring extract keeps explicit A1 and frontage policy overrides', () => {
  assert.equal(ADDRESS_POINTS.length, 381);
  assert.equal(CORE_POLYGON.features[0].geometry.coordinates[0].length, 43);
  assert.ok(ADDRESS_POINTS.some((p) => p.number === '40' && p.street === 'Hanna Ave'));
  assert.ok(ADDRESS_POINTS.some((p) => p.number === '68' && p.street === 'Douro St'));
  assert.equal(classifyAddress('68 Douro St, Toronto').verdict, 'not-LV');
  assert.equal(classifyAddress('1187 King St W, Toronto').verdict, 'adjacent');
  assert.equal(classifyAddress('1155 King St W, Toronto').verdict, 'adjacent');
  rejected(classifyAddress('1205 Queen St W, Toronto'));
  rejected(classifyAddress('100 Joe Shuster Way, Toronto'));
  rejected(classifyAddress('99 Douro St, Toronto'));
});

test('road record needs its road and two allowlisted segment intersections', () => {
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
  rejected(classifyTransitAlert({ route: '504', stops: [] }));
  rejected(classifyTransitAlert({ route: 'all routes', segmentText: 'city-wide weekend TTC closures' }));
});

test('project and BIA sections use their own event place, not project or actor identity', () => {
  assert.equal(place('Open house October 3, 2026. Location: 171 East Liberty St, Toronto').verdict, 'core');
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
  assert.equal(WATCH_LIST.length, 29);
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
