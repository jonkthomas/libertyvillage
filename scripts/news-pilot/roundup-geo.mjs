import { readFileSync } from 'node:fs';

const data = (name) => JSON.parse(readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8'));
export const CORE_POLYGON = data('lv-core.geojson');
export const ADDRESS_POINTS = data('lv-address-points.json').addresses;
const segmentData = data('lv-segments.json');
export const SEGMENTS = segmentData.segments;
export const VENUES = data('lv-venues.json').venues;
export const WATCH_LIST = data('ig-watch.json').entries;

const verdict = (value, reason, extra = {}) => ({ verdict: value, reason, ...extra });
const normalize = (value) => String(value ?? '').normalize('NFC').replace(/[’']/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const key = (value) => normalize(value).toLowerCase().replace(/\bavenue\b/g, 'ave').replace(/\bstreet\b/g, 'st').replace(/\bboulevard\b/g, 'blvd').replace(/\broad\b/g, 'rd').replace(/\bdrive\b/g, 'dr').replace(/\beast liberty\b/g, 'east liberty').replace(/\be liberty\b/g, 'east liberty').replace(/\bking street west\b/g, 'king st w').replace(/\bking st west\b/g, 'king st w').replace(/\blake shore boulevard west\b/g, 'lake shore blvd w').replace(/\blake shore blvd west\b/g, 'lake shore blvd w').replace(/\bprinces' boulevard\b/g, 'princes blvd').replace(/\bprinces boulevard\b/g, 'princes blvd').replace(/\s+/g, ' ').trim();
const normalizeStreet = (street) => key(street).replace(/\.$/, '');
const streetPattern = '(?:East Liberty|E Liberty|King|Lake Shore|Hanna|Jefferson|Liberty|Fraser|Atlantic|Mowat|Western Battery|Pardee|Princes[’\']?|Manitoba|Strachan|Dufferin|Queen|Fleet|Newfoundland|Snooker|Joe Shuster|Douro|Temple|Elm Grove|Tyndall|Canniff|Crawford|Shaw|Lynn Williams|Pirandello|Solidarity)\\s+(?:Ave(?:nue)?|St(?:reet)?(?:\\s+W(?:est)?)?|Blvd|Boulevard|Rd|Road|Dr|Drive|Way)';
const addressPattern = new RegExp(`\\b(\\d{1,5}[A-Za-z]?)\\s+(${streetPattern})(?:[,\\s]*(?:#|unit\\s+|suite\\s+|ste\\s+)([A-Za-z0-9]+))?\\b`, 'ig');
const knownPoints = new Set(ADDRESS_POINTS.map(({ number, street }) => `${key(number)}|${normalizeStreet(street)}`));
const venueById = new Map(VENUES.map((v) => [v.canonicalVenueId, v]));
const knownOutside = new Set(['1205|queen st w']);
// A US state abbreviation after a comma ("Somerset, NJ 08873"). Team names such as "New York Liberty" are not places.
const foreignPlace = /,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b|,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;

function parsedAddress(address) {
  if (address && typeof address === 'object') {
    const number = address.number ?? address.streetNumber;
    const street = address.street ?? address.streetName ?? address.streetAddress;
    const unit = address.unit ?? address.suite;
    if (number && street) return { number: String(number), street: normalizeStreet(street), unit: unit ? String(unit).toLowerCase() : null, text: `${number} ${street}` };
    address = street ?? '';
  }
  const text = normalize(address);
  const match = [...text.matchAll(addressPattern)][0];
  if (!match) return null;
  const before = text.slice(0, match.index);
  const leadingUnit = before.match(/(?:unit|suite|ste|#)\s*([a-z0-9]+)\s*,?\s*$/i)?.[1];
  return { number: match[1].toLowerCase(), street: normalizeStreet(match[2]), unit: (match[3] ?? leadingUnit)?.toLowerCase() ?? null, text };
}

export function canonicalVenueId(address) {
  const parsed = parsedAddress(address);
  if (!parsed) return null;
  const street = parsed.street.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `addr:${parsed.number}-${street}${parsed.unit ? `#${parsed.unit}` : ''}`;
}

function torontoContext(address, context) {
  const object = typeof address === 'object' && address !== null ? address : {};
  const locality = normalize(context.addressLocality ?? object.addressLocality ?? object.city);
  if (locality && !/^toronto$/i.test(locality)) return false;
  const postal = normalize(context.postalCode ?? object.postalCode);
  const haystack = [typeof address === 'string' ? address : '', context.recordText, context.text].filter(Boolean).join(' ');
  if (foreignPlace.test(typeof address === 'string' ? address : '') || /\b(?:Hurricane\s*,?\s*UT|Utah|New York|NYC|Vancouver|Montreal|Ottawa)\b/i.test(haystack)) return false;
  return /^toronto$/i.test(locality) || /^M6K\b/i.test(postal) || /\bM6K\s*[0-9][A-Z][0-9]\b/i.test(haystack) || /\bToronto\b/i.test(haystack) || context.trustedToronto === true || context.registryToronto === true;
}

export function classifyAddress(address, context = {}) {
  const parsed = parsedAddress(address);
  if (!parsed) return verdict('unverifiable', 'address-missing');
  if (!torontoContext(address, context)) {
    const elsewhere = context.addressLocality || foreignPlace.test(parsed.text) || /\b(?:Hurricane\s*,?\s*UT|Utah|New York|NYC|Vancouver|Montreal|Ottawa)\b/i.test(parsed.text);
    return verdict(elsewhere ? 'not-LV' : 'unverifiable', elsewhere ? 'outside-toronto' : 'toronto-context-missing');
  }
  const pointKey = `${parsed.number}|${parsed.street}`;
  const id = canonicalVenueId({ number: parsed.number, street: parsed.street, unit: parsed.unit });
  if (parsed.street === 'douro st') return verdict('not-LV', 'a1-douro-policy-exclusion');
  // Approved §6.2: a City point strictly inside the core polygon is core, King/Strachan/Dufferin frontage included.
  if (knownPoints.has(pointKey)) return verdict('core', 'city-polygon-address-point', { canonicalVenueId: id });
  const venue = VENUES.find((v) => v.locality === 'core' && canonicalVenueId(v.address) === id);
  if (venue) return verdict('core', 'verified-named-core-venue', { canonicalVenueId: id });
  if (knownOutside.has(pointKey) || /^(?:joe shuster|douro|temple|elm grove|tyndall|queen)\b/.test(parsed.street)) return verdict('not-LV', 'known-outside-address');
  const adjacent = VENUES.find((v) => v.locality === 'adjacent' && canonicalVenueId(v.address) === id);
  if (adjacent) return verdict('adjacent', 'verified-adjacent-venue', { canonicalVenueId: id });
  return verdict('unverifiable', 'address-not-in-reviewed-table');
}

const roadKey = (road) => normalizeStreet(road).replace(/'/g, '').replace(/\bcrescent\b/g, 'cres').replace(/^the /, '');
const BOUNDARY_ROADS = new Set(['king st w', 'strachan ave', 'dufferin st', 'c n r', 'lake shore blvd w']);
const rowNames = (row) => [...(row.fromIntersection ?? []), ...(row.toIntersection ?? [])].map(roadKey);
// Match units: each reviewed corridor, and all rows of one road within one class (core, Exhibition internal).
// A record's cross roads must each be a City intersection on a constituent row of the unit.
const SEGMENT_UNITS = (() => {
  const units = new Map();
  for (const segment of SEGMENTS) {
    if (segment.constituents) {
      units.set(`corridor|${segment.road}|${segment.fromRoad}|${segment.toRoad}`, {
        road: roadKey(segment.road), locality: segment.locality, names: new Set(segment.constituents.flatMap(rowNames)), geometry: segment.geometry,
      });
      continue;
    }
    const unitKey = `${segment.group ?? segment.locality}|${roadKey(segment.linearName)}`;
    const unit = units.get(unitKey) ?? { road: roadKey(segment.linearName), locality: segment.locality, names: new Set(), geometry: [] };
    for (const name of rowNames(segment)) unit.names.add(name);
    unit.geometry.push(segment.coordinates);
    units.set(unitKey, unit);
  }
  return [...units.values()];
})();
function distanceToRoadMetres(coordinates, geometry) {
  const lines = geometry ?? [];
  if (!lines.length) return Infinity;
  const [lon, lat] = coordinates.map(Number);
  const metresPerLon = 111_320 * Math.cos(lat * Math.PI / 180);
  const metresPerLat = 111_132;
  let minimum = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const ax = (a[0] - lon) * metresPerLon;
      const ay = (a[1] - lat) * metresPerLat;
      const bx = (b[0] - lon) * metresPerLon;
      const by = (b[1] - lat) * metresPerLat;
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      minimum = Math.min(minimum, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return minimum;
}
export function classifySegment({ road, fromRoad, toRoad, atRoad, coordinates } = {}) {
  const linear = roadKey(road);
  const single = !fromRoad && !toRoad ? roadKey(atRoad) : '';
  const from = single || roadKey(fromRoad);
  const to = single || roadKey(toRoad);
  if (!linear || !from || !to) return verdict('unverifiable', 'segment-endpoints-missing');
  const matches = SEGMENT_UNITS.filter((unit) => unit.road === linear && unit.names.has(from) && unit.names.has(to));
  if (!matches.length) return verdict('not-LV', 'segment-not-in-reviewed-table');
  if (new Set(matches.map((unit) => unit.locality)).size > 1) return verdict('unverifiable', 'ambiguous-segment-match');
  const { locality } = matches[0];
  // A core road crossing the boundary (Mowat King->King) could lie on either side of it.
  if (locality === 'core' && BOUNDARY_ROADS.has(from) && BOUNDARY_ROADS.has(to)) return verdict('unverifiable', 'core-segment-boundary-endpoints-only');
  // A coordinate is never a positive locality signal. A contradictory coordinate fails closed.
  if (coordinates) {
    const pair = Array.isArray(coordinates) ? coordinates : [coordinates.longitude ?? coordinates.lon, coordinates.latitude ?? coordinates.lat];
    if (!Number.isFinite(Number(pair[0])) || !Number.isFinite(Number(pair[1]))) return verdict('unverifiable', 'invalid-coordinate');
    if (distanceToRoadMetres(pair, matches.flatMap((unit) => unit.geometry)) > 150) return verdict('not-LV', 'coordinate-contradicts-segment');
  }
  return verdict(locality, 'reviewed-segment');
}

function domainMatches(domain, registered) {
  const clean = String(domain ?? '').toLowerCase().replace(/^www\./, '');
  return registered?.some((item) => clean === item || clean.endsWith(`.${item}`));
}
function namedVenues(text) {
  const lower = normalize(text).toLowerCase();
  const matches = VENUES.filter((v) => v.aliases.some((alias) => {
    const escaped = alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, 'i').test(lower);
  }));
  const specific = matches.filter((v) => v.name !== 'Exhibition Place');
  return specific.length ? specific : matches;
}
export function classifyVenueName(name, context = {}) {
  const matches = namedVenues(name);
  if (!matches.length) return verdict('unverifiable', 'venue-not-allowlisted');
  const distinct = [...new Set(matches.map((v) => v.canonicalVenueId))];
  if (distinct.length > 1) return verdict('unverifiable', 'multiple-venue-identities');
  const venue = matches[0];
  if (context.address) {
    const stated = classifyAddress(context.address, { ...context, trustedToronto: context.trustedToronto || /\bToronto\b/i.test(name) });
    if (stated.canonicalVenueId && stated.canonicalVenueId !== venue.canonicalVenueId) return verdict('unverifiable', 'venue-address-conflict');
    if (stated.verdict === 'not-LV') return stated;
    if (stated.verdict === 'unverifiable') return verdict('unverifiable', 'stated-address-unverified');
  }
  if (context.addressLocality && !/^Toronto$/i.test(context.addressLocality)) return verdict('not-LV', 'venue-in-other-city');
  const toronto = /\bToronto\b|\bExhibition Place\b/i.test(name) || context.trustedToronto === true || domainMatches(context.domain, venue.officialDomains);
  if (!toronto) return verdict('unverifiable', 'venue-toronto-context-missing');
  return verdict(venue.locality, 'allowlisted-venue', { canonicalVenueId: venue.canonicalVenueId, registryVenueId: venue.registryVenueId });
}

const TRANSIT_STOPS = {
  '504': /\b(?:Strachan|Shaw|Atlantic|Jefferson|Fraser|Dufferin|Liberty Village)\b/i,
  '29': /\b(?:Dufferin Gate|Exhibition)\b/i,
  '509': /\b(?:Exhibition Loop|Exhibition Place|Exhibition Station)\b/i,
  '511': /\b(?:Exhibition Loop|Exhibition Place|Exhibition Station)\b/i,
  '63': /\b(?:Liberty Village|Atlantic Ave|East Liberty St)\b/i,
};
// 504 is local only on King St W between Strachan and Dufferin; a named stop beyond either end is not.
const KING_OUTSIDE_STOPS = /\b(?:Bathurst|Spadina|Portland|Niagara|Tecumseth|Walnut|Wellington|Peter|John|Simcoe|University|York|Bay|Yonge|Church|Jarvis|Sherbourne|Parliament|Sumach|River|Broadview|Distillery|Cherry|Sudbury|Joe Shuster|Gladstone|Brock|Lansdowne|Close|Dunn|Jameson|Sorauren|Roncesvalles|Dowling|Queen|Dundas West)\b/;
export function classifyTransitAlert({ route, stops, segmentText } = {}) {
  const routeNumber = String(route ?? '').match(/\b(504|29|509|511|63)\b/)?.[1];
  if (!routeNumber) return verdict('not-LV', 'route-not-allowlisted');
  const text = [Array.isArray(stops) ? stops.join(' ') : stops, segmentText].filter(Boolean).join(' ');
  if (!text || !TRANSIT_STOPS[routeNumber].test(text)) return verdict('not-LV', 'stop-not-allowlisted');
  if (routeNumber === '504' && KING_OUTSIDE_STOPS.test(text)) return verdict('not-LV', 'stop-outside-king-frontage');
  return verdict('adjacent', 'route-and-stop-allowlisted');
}

const actorPhrase = /\b(?:based at|based in|headquartered|head office|offices at|organized by[^.!?]*? at|presented by[^.!?]*? of)\b/i;
const eventRelation = /\b(?:at|in|on|returns to|coming to|moving to|opening at|opening in|takes place at|will be held at)\b|\b(?:location|venue|address|where)\s*:|📍/i;
const offsitePlace = /\b(?:High Park|Downsview Park|City Hall|Toronto Zoo|Parkdale|Hurricane\s*,?\s*UT)\b/i;
const verdictOrder = { 'not-LV': 0, adjacent: 1, core: 2 };
function cap(result, agentVerdict) {
  if (!(agentVerdict in verdictOrder) || result.verdict === 'unverifiable') return result;
  return verdictOrder[agentVerdict] < verdictOrder[result.verdict] ? { ...result, verdict: agentVerdict, reason: 'agent-verdict-cap' } : result;
}
export function classifySectionPlace({ placeQuote, sectionText, subject, dateQuote, domain, agentVerdict, trustedToronto = false } = {}) {
  const quote = normalize(placeQuote);
  const section = normalize(sectionText);
  if (!quote || !section || !section.includes(quote)) return verdict('unverifiable', 'place-quote-not-in-section');
  if (actorPhrase.test(quote) && !/\b(?:takes place at|will be held at|location\s*:|venue\s*:|where\s*:)\b|📍/i.test(quote)) return verdict('unverifiable', 'actor-address-not-event-location');
  if (!eventRelation.test(quote)) return verdict('unverifiable', 'event-location-relation-missing');
  const addressMatches = [...quote.matchAll(addressPattern)].map((m) => classifyAddress(m[0],
    { recordText: section, trustedToronto: trustedToronto || /\bToronto\b/i.test(section) }));
  // §6.2: every prose venue, core ones included, needs Toronto context in the same record.
  if (foreignPlace.test(quote)) return verdict('not-LV', 'outside-toronto');
  const venueMatches = namedVenues(quote).filter((v) => v.registryVenueId || /Liberty Village Park|Lamport Stadium/i.test(v.name)).map((v) => classifyVenueName(v.name, { domain, trustedToronto: /\bToronto\b|\bExhibition Place\b/i.test(section) }));
  const transitMatches = /\bOntario Line\b/i.test(section) && /\bExhibition Station\b/i.test(quote)
    ? [verdict('adjacent', 'allowlisted-transit-location')]
    : [];
  const classified = [...addressMatches, ...venueMatches, ...transitMatches].filter((x) => x.verdict !== 'unverifiable');
  if (classified.some((x) => x.verdict === 'not-LV') && classified.some((x) => x.verdict !== 'not-LV')) return verdict('unverifiable', 'conflicting-places');
  if (offsitePlace.test(quote) && classified.some((x) => x.verdict === 'core' || x.verdict === 'adjacent')) return verdict('unverifiable', 'offsite-place-conflict');
  if (!classified.length) return offsitePlace.test(quote) || /\bvirtual\b/i.test(quote) ? verdict('not-LV', 'offsite-or-virtual') : verdict('unverifiable', 'place-not-classifiable');
  if (new Set(classified.map((x) => x.canonicalVenueId).filter(Boolean)).size > 1) return verdict('unverifiable', 'multiple-venue-identities');
  if (new Set(classified.map((x) => x.verdict)).size > 1) return verdict('unverifiable', 'conflicting-localities');
  const sameItem = (subject && quote.toLowerCase().includes(normalize(subject).toLowerCase())) || (dateQuote && quote.includes(normalize(dateQuote))) || /^(?:location|venue|address|where)\s*:/i.test(quote) && (!subject || section.toLowerCase().includes(normalize(subject).toLowerCase()));
  if (!sameItem) return verdict('unverifiable', 'place-not-bound-to-item');
  return cap(classified[0], agentVerdict);
}

const sameBuilding = (a, b) => Boolean(a && b) && a.replace(/#.*$/, '') === b.replace(/#.*$/, '');
const neighbourhoodOnly = /^[\s.,:;|-]*(?:liberty village|lv)(?:[\s,]+toronto)?[\s.!,]*$/i;
/**
 * Instagram own-venue fallback guard (§6.2): with no place_quote, a caption that states
 * another place must not inherit the watch venue. Offsite names are not-LV; any other
 * pinned or labelled place that is not the account's own building is unverifiable.
 */
export function statedOtherPlace(text, ownVenueId) {
  const raw = String(text ?? '');
  if (offsitePlace.test(normalize(raw))) return verdict('not-LV', 'offsite-place-stated');
  for (const line of raw.split(/\r?\n/)) {
    for (const match of line.matchAll(/(?:📍|\b(?:location|venue|address|where)\s*:)([^📍]*)/giu)) {
      const place = normalize(match[1]);
      if (!place || neighbourhoodOnly.test(place)) continue;
      if (sameBuilding(canonicalVenueId(place), ownVenueId)) continue;
      const named = namedVenues(place);
      if (named.length && named.every((v) => sameBuilding(v.canonicalVenueId, ownVenueId))) continue;
      return verdict('unverifiable', 'other-place-stated');
    }
  }
  return null;
}

export function validateWatchList(entries = WATCH_LIST) {
  const errors = [];
  if (!Array.isArray(entries)) return { valid: false, errors: ['watch-list-must-be-array'] };
  if (entries.length > 34) errors.push('watch-list-exceeds-34-account-cap');
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const prefix = `entry ${index}`;
    if (!entry || typeof entry !== 'object') { errors.push(`${prefix}: invalid entry`); continue; }
    const handle = String(entry.handle ?? '').toLowerCase();
    if (!/^[a-z0-9._]+$/.test(handle) || handle.length > 30) errors.push(`${prefix}: invalid handle`);
    if (seen.has(handle)) errors.push(`${prefix}: duplicate handle`);
    seen.add(handle);
    if (!entry.business || typeof entry.business !== 'string') errors.push(`${prefix}: missing business`);
    const venue = venueById.get(entry.canonicalVenueId);
    if (!venue || venue.locality !== 'core') errors.push(`${prefix}: venue is not verified core`);
    if (!/^https?:\/\/[^\s]+$/i.test(entry.verificationUrl ?? '')) errors.push(`${prefix}: invalid verificationUrl`);
    if (!entry.verificationMethod || typeof entry.verificationMethod !== 'string') errors.push(`${prefix}: missing verificationMethod`);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(entry.ownDomain ?? '')) errors.push(`${prefix}: invalid ownDomain`);
    try {
      const host = new URL(entry.verificationUrl).hostname.toLowerCase().replace(/^www\./, '');
      if (host !== entry.ownDomain && !host.endsWith(`.${entry.ownDomain}`)) errors.push(`${prefix}: verification URL does not match own domain`);
    } catch {
      errors.push(`${prefix}: malformed verification URL`);
    }
    if (typeof entry.multiLocation !== 'boolean' || typeof entry.requiresVenueInPost !== 'boolean') errors.push(`${prefix}: invalid location flags`);
    if (!['apify', 'meta'].includes(entry.provider)) errors.push(`${prefix}: invalid provider`);
  }
  return { valid: errors.length === 0, errors };
}
