/**
 * Offline deterministic builder for the Liberty Village geography data files
 * (docs/specs/weekly-roundup-v2.md §6.2; policy addendum:
 * docs/specs/weekly-roundup-v2-geography-addendum.md, DRAFT).
 *
 * Reads the City of Toronto Centreline and Address Points CSV extracts
 * (Open Government Licence – Toronto) and writes:
 *   data/lv-core.geojson        core ring from Centreline boundary legs
 *   data/lv-address-points.json address points strictly inside the ring
 *   data/lv-segments.json       55 core segment rows + 5 reviewed adjacent corridors
 *
 * Deterministic fail-closed policy (see the addendum for the full conflict list):
 *   - The ring is derived by graph-walking named Centreline legs between
 *     name-derived corner intersections (King/Dufferin, King/Strachan,
 *     Strachan/C N R, Dufferin/C N R). A leg that does not connect fails the run.
 *   - Core segments are City road-feature segments wholly inside the ring,
 *     EXCLUDING Douro St rows (A1 policy: Douro is not-LV even though 11 of its
 *     address points fall inside the ring) and the boundary roads themselves.
 *   - Adjacent frontage is NOT derived geometrically: it comes only from the
 *     explicit reviewed corridor allowlist below (geometry still read from the
 *     City CSV by Centreline ID). Lake Shore coverage ends at Newfoundland Rd
 *     because named Dufferin St never meets Lake Shore Blvd W in Centreline.
 *     Exhibition Place internal roads are not yet admitted.
 *   - Any drift (missing City ID, renamed road, broken chain) throws instead of
 *     silently emitting different data. Unlisted segments fail closed.
 *
 * This generator never reads the committed data/*.json files as input.
 *
 * Usage:
 *   node scripts/news-pilot/build-lv-geography.mjs \
 *     --centreline /tmp/lv-geo/centreline-4326.csv \
 *     --addresses /tmp/lv-geo/address-4326.csv \
 *     [--out DIR]   # default: scripts/news-pilot/data next to this file
 */

import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(HERE, 'data');

const BBOX = Object.freeze({
  lon0: -79.44,
  lon1: -79.4,
  lat0: 43.628,
  lat1: 43.648,
});

const ROAD_FEATURES = new Set([
  'Local',
  'Collector',
  'Major Arterial',
  'Minor Arterial',
  'Laneway',
  'Access Road',
]);

/** A1 policy: excluded from the core segment table even when geometrically inside. */
const A1_EXCLUDED_CORE_STREETS = new Set(['Douro St']);

/** Boundary roads are adjacent frontage, never core segments. */
const BOUNDARY_ROADS = new Set(['King St W', 'Strachan Ave', 'Dufferin St', 'Lake Shore Blvd W', 'C N R']);

/**
 * Reviewed adjacent frontage corridors (commit f95b625 review). Geometry comes
 * from the City CSV by Centreline ID; IDs are the reviewed selection and any
 * absence from the CSV fails the run. Each geometry entry keeps the City row's
 * native orientation.
 */
const REVIEWED_ADJACENT_CORRIDORS = [
  { road: 'Strachan Ave', fromRoad: 'Fleet St', toRoad: 'King St W', centrelineIds: [30144371, 30144372, 1147128, 30120066, 30120067, 60006730, 60006713, 1146906, 1146860, 1146779] },
  { road: 'King St W', fromRoad: 'Strachan Ave', toRoad: 'Dufferin St', centrelineIds: [1146739, 30095295, 30095345, 30095346, 60084322, 3155022, 1146840, 3120558, 7553457, 7553490, 30100479, 30100482, 30100483, 30100476, 30100477, 7553372, 60052295] },
  { road: 'Lake Shore Blvd W', fromRoad: 'Strachan Ave', toRoad: 'Newfoundland Rd', centrelineIds: [30125351] },
  { road: 'Dufferin St', fromRoad: 'King St W', toRoad: 'Saskatchewan Rd', centrelineIds: [30111929, 30111928, 30111925, 9234179, 9234187, 9234204, 9234205, 1147346, 1147359, 20231260] },
  { road: 'Strachan Ave', fromRoad: 'King St W', toRoad: 'Lake Shore Blvd W', centrelineIds: [1146779, 1146860, 1146906, 60006713, 60006730, 30120067, 30120066, 1147128, 30144372, 30144371, 30103011, 1147284] },
];

const SOURCE = Object.freeze({
  licence: 'Open Government Licence – Toronto',
  retrieved: '2026-09-29',
  centreline: Object.freeze({
    package: 'toronto-centreline-tcl',
    packageId: '1d079757-377b-4564-82df-eb5638583bfb',
    resourceId: '4dec5884-a5cf-49e7-b562-f835150dc0b1',
    resource: 'centreline-version-2-4326.csv',
    note: 'City of Toronto Centreline (TCL), WGS84. Package data current as of the 2026-09-29 download.',
  }),
  addressPoints: Object.freeze({
    package: 'address-points-municipal-toronto-one-address-repository',
    packageId: 'abedd8bc-e3dd-4d45-8e69-79165a76e4fa',
    resourceId: '64d4e54b-738f-4cd9-a9e7-8050fac8a52f',
    resource: 'address-points WGS84 CSV',
    note: 'Municipal address points whose coordinate falls strictly inside the core ring.',
  }),
});

const SEGMENTS_PROVENANCE = Object.freeze({
  status: 'generated-core-plus-reviewed-adjacent-corridors',
  source: 'City of Toronto Centreline version 2',
  sourceUrl: 'https://open.toronto.ca/dataset/toronto-centreline-tcl/',
  note: '55 polygon-interior City core segments (four Douro St rows excluded by A1 policy) plus five reviewed adjacent frontage corridors joined by City intersection IDs. Adjacent Lake Shore coverage ends at Newfoundland Rd because named Dufferin St does not meet Lake Shore in Centreline; Exhibition Place internal roads remain unresolved. Unlisted segments fail closed. Independent review and spec addendum needed before PR.',
  geometrySource: 'City Toronto Centreline version 2 datastore resource ad296ebf-fca6-4e67-b3ce-48040a20e6cd. Exact corridor centreline IDs and geometries selected by graph path between matching intersection IDs; where absent, coordinates fail closed.',
  resourceId: '4dec5884-a5cf-49e7-b562-f835150dc0b1',
});

const GEOJSON_REVIEW_NOTE = 'City Centreline ring geometry; ring membership alone does not override named A1 exclusion or boundary frontage locality. Independent review required for Douro St conflict before PR.';
const ADDRESS_REVIEW_NOTE = 'Complete City address-point extract strictly inside generated Centreline ring (381 pairs). Classification excludes Douro St by A1 and treats King/Strachan/Dufferin frontage as adjacent despite geometric membership; spec conflict requires independent review.';

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const out = { centreline: null, addresses: null, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--centreline') out.centreline = argv[++i];
    else if (token === '--addresses') out.addresses = argv[++i];
    else if (token === '--out') out.out = argv[++i];
    else throw new Error(`unknown argument: ${token}`);
  }
  if (!out.centreline || !out.addresses) {
    throw new Error('usage: node build-lv-geography.mjs --centreline CITY.csv --addresses CITY.csv [--out DIR]');
  }
  return out;
}

/**
 * Split one CSV line. Fields are quoted with RFC-style doubled quotes.
 * @param {string} line
 */
export function splitCsvLine(line) {
  /** @type {string[]} */
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted && ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * @param {string} file
 * @param {(row: Record<string, string>) => void} onRow
 */
async function readCsv(file, onRow) {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  /** @type {string[]|null} */
  let header = null;
  let pending = '';
  for await (const line of rl) {
    pending = pending ? `${pending}\n${line}` : line;
    const quoteCount = pending.split('"').length - 1;
    if (quoteCount % 2 === 1) continue;
    const cols = splitCsvLine(pending);
    pending = '';
    if (!header) { header = cols; continue; }
    if (cols.length < header.length) continue;
    /** @type {Record<string, string>} */
    const row = {};
    for (let i = 0; i < header.length; i += 1) row[header[i]] = cols[i] ?? '';
    onRow(row);
  }
  if (pending) throw new Error(`unterminated CSV quote in ${file}`);
}

/**
 * Flatten a GeoJSON geometry to a single [lon, lat] list (City rows here are
 * Point, LineString or single-line MultiLineString).
 * @param {string} raw
 * @returns {number[][]}
 */
function lineCoords(raw) {
  let geometry;
  try { geometry = JSON.parse(raw); } catch { return []; }
  const type = geometry?.type;
  const coordinates = geometry?.coordinates;
  if (!coordinates) return [];
  if (type === 'Point' && typeof coordinates[0] === 'number') return [[coordinates[0], coordinates[1]]];
  if (type === 'MultiPoint' || type === 'LineString') {
    return coordinates.filter((pt) => Array.isArray(pt) && typeof pt[0] === 'number');
  }
  /** @type {number[][]} */
  const coords = [];
  const lines = Array.isArray(coordinates) ? coordinates : [];
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    for (const pt of line) {
      if (Array.isArray(pt) && typeof pt[0] === 'number') coords.push([pt[0], pt[1]]);
    }
  }
  return coords;
}

/**
 * @param {number[][]} coords
 */
function inBbox(coords) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return !(maxLon < BBOX.lon0 || minLon > BBOX.lon1 || maxLat < BBOX.lat0 || minLat > BBOX.lat1);
}

/**
 * @param {number} lon
 * @param {number} lat
 */
function pointInBbox(lon, lat) {
  return lon >= BBOX.lon0 && lon <= BBOX.lon1 && lat >= BBOX.lat0 && lat <= BBOX.lat1;
}

/**
 * @typedef {object} Seg
 * @property {string} id
 * @property {string} name
 * @property {string} feature
 * @property {string} fromId
 * @property {string} toId
 * @property {number[][]} coords
 */

/**
 * Shortest chain of same-name segments from startId to endId (BFS by
 * intersection node, City CSV order). Deterministic for a given CSV.
 * @param {Seg[]} segs
 * @param {string} name
 * @param {string} startId
 * @param {string} endId
 */
function walk(segs, name, startId, endId) {
  const pool = segs.filter((seg) => seg.name === name);
  /** @type {Map<string, {seg: Seg, prev: string}|null>} */
  const prev = new Map();
  const queue = [startId];
  prev.set(startId, null);
  while (queue.length) {
    const current = queue.shift();
    if (current === endId) break;
    for (const seg of pool) {
      const next = seg.fromId === current ? seg.toId : seg.toId === current ? seg.fromId : null;
      if (!next || prev.has(next)) continue;
      prev.set(next, { seg, prev: current });
      queue.push(next);
    }
  }
  if (!prev.has(endId)) return { coords: [], used: [], ended: false, current: startId };
  /** @type {{seg: Seg, from: string}[]} */
  const chain = [];
  let cursor = endId;
  while (cursor !== startId) {
    const step = prev.get(cursor);
    if (!step) break;
    chain.push({ seg: step.seg, from: step.prev });
    cursor = step.prev;
  }
  chain.reverse();
  /** @type {number[][]} */
  const coords = [];
  /** @type {Seg[]} */
  const used = [];
  for (const step of chain) {
    const forward = step.seg.fromId === step.from;
    const pts = forward ? step.seg.coords.slice() : [...step.seg.coords].reverse();
    // Drop the shared endpoint so each interior node appears once. Adjacent
    // City rows can differ by sub-centimetre noise at shared nodes; keeping
    // the previous row's endpoint is the deterministic choice.
    if (coords.length && pts.length) pts.shift();
    coords.push(...pts);
    used.push(step.seg);
  }
  return { coords, used, ended: chain.length > 0 || startId === endId, current: endId };
}

/**
 * Southernmost intersection node whose street-name set contains both names.
 * @param {Map<string, Set<string>>} streetsAt
 * @param {Map<string, number[]>} atPoint
 * @param {string} a
 * @param {string} b
 */
function sharedIntersection(streetsAt, atPoint, a, b) {
  /** @type {string|null} */
  let best = null;
  let bestLat = Infinity;
  for (const [id, names] of streetsAt) {
    if (!names.has(a) || !names.has(b)) continue;
    const pt = atPoint.get(id);
    const lat = pt ? pt[1] : 0;
    if (!best || lat < bestLat) { best = id; bestLat = lat; }
  }
  return best;
}

/**
 * @param {number[][]} ring
 */
function shoelace(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/**
 * Ray cast. Points on the boundary return false.
 * @param {number} lon
 * @param {number} lat
 * @param {number[][]} ring
 */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Metres between two WGS84 points.
 * @param {number} lon1
 * @param {number} lat1
 * @param {number} lon2
 * @param {number} lat2
 */
function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * @param {number} lon
 * @param {number} lat
 * @param {number[][]} line
 */
function distanceToLine(lon, lat, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    const [x1, y1] = line[i - 1];
    const [x2, y2] = line[i];
    const steps = 8;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      const d = haversine(lon, lat, x, y);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * @param {number[][]} coords
 */
function samples(coords) {
  if (coords.length <= 2) return coords.slice();
  return [coords[0], coords[Math.floor(coords.length / 2)], coords[coords.length - 1]];
}

/**
 * Endpoint street names (all streets at the intersection node except the
 * segment's own name), sorted.
 * @param {Seg} seg
 * @param {Map<string, Set<string>>} streetsAt
 */
function endpointNames(seg, streetsAt) {
  const from = [...(streetsAt.get(seg.fromId) || [])].filter((name) => name !== seg.name).sort();
  const to = [...(streetsAt.get(seg.toId) || [])].filter((name) => name !== seg.name).sort();
  return { from, to };
}

/**
 * Wholly inside: midpoint inside and no sample clearly outside the ring.
 * An endpoint that merely touches the ring is allowed.
 * @param {Seg} seg
 * @param {number[][]} ring
 */
function isWhollyInside(seg, ring) {
  const pts = samples(seg.coords);
  const mid = seg.coords[Math.floor((seg.coords.length - 1) / 2)];
  if (!pointInRing(mid[0], mid[1], ring)) return false;
  for (const [lon, lat] of pts) {
    if (pointInRing(lon, lat, ring)) continue;
    if (distanceToLine(lon, lat, ring) > 12) return false;
  }
  return true;
}

/**
 * Serialize with two-space indent and ASCII-only output (non-ASCII escaped as
 * \uXXXX, matching the committed files byte for byte).
 * @param {unknown} value
 */
function asciiJson(value) {
  return JSON.stringify(value, null, 2).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Deterministic fail-closed corridor row: geometry read from the City CSV by
 * reviewed Centreline ID, native orientation kept; the chain must be connected
 * and anchored at the named fromRoad/toRoad intersections when the City
 * provides those nodes.
 * @param {{road: string, fromRoad: string, toRoad: string, centrelineIds: number[]}} spec
 * @param {Map<string, Seg>} byId
 * @param {Map<string, Set<string>>} streetsAt
 * @param {Map<string, number[]>} atPoint
 */
function corridorRow(spec, byId, streetsAt, atPoint) {
  /** @type {number[][][]} */
  const geometry = [];
  for (const id of spec.centrelineIds) {
    const seg = byId.get(String(id));
    if (!seg) throw new Error(`adjacent corridor ${spec.road}: City Centreline ID ${id} absent from the CSV`);
    if (seg.name !== spec.road) throw new Error(`adjacent corridor ${spec.road}: City ID ${id} is named ${seg.name}`);
    geometry.push(seg.coords);
  }
  // Connectivity: consecutive polylines must share an endpoint (unordered,
  // sub-centimetre City noise tolerated).
  const close = (a, b) => haversine(a[0], a[1], b[0], b[1]) < 1;
  const endpointPairs = geometry.map((line) => [line[0], line[line.length - 1]]);
  const shared = [];
  for (let i = 1; i < geometry.length; i += 1) {
    const [a0, a1] = endpointPairs[i - 1];
    const [b0, b1] = endpointPairs[i];
    const link = close(a0, b0) || close(a0, b1) ? (close(a0, b0) ? [a0, b0] : [a0, b1]) : close(a1, b0) || close(a1, b1) ? (close(a1, b0) ? [a1, b0] : [a1, b1]) : null;
    if (!link) throw new Error(`adjacent corridor ${spec.road}: IDs ${spec.centrelineIds[i - 1]} and ${spec.centrelineIds[i]} do not share an endpoint`);
    shared.push(link);
  }
  let chainStart;
  let chainEnd;
  if (!shared.length) {
    chainStart = endpointPairs[0][0];
    chainEnd = endpointPairs[0][1];
  } else {
    chainStart = close(endpointPairs[0][0], shared[0][0]) || close(endpointPairs[0][0], shared[0][1]) ? endpointPairs[0][1] : endpointPairs[0][0];
    const last = endpointPairs[endpointPairs.length - 1];
    const lastShared = shared[shared.length - 1];
    chainEnd = close(last[0], lastShared[0]) || close(last[0], lastShared[1]) ? last[1] : last[0];
  }
  for (const [road, point, label] of [[spec.fromRoad, chainStart, 'start'], [spec.toRoad, chainEnd, 'end']]) {
    const node = sharedIntersection(streetsAt, atPoint, spec.road, road);
    if (!node) { console.log(`note: no Centreline intersection node for ${spec.road} x ${road}; corridor ${label} anchor unchecked`); continue; }
    const anchor = atPoint.get(node);
    if (anchor && haversine(anchor[0], anchor[1], point[0], point[1]) > 150) {
      throw new Error(`adjacent corridor ${spec.road}: ${label} is not within 150 m of the ${spec.road}/${road} intersection`);
    }
  }
  return { road: spec.road, fromRoad: spec.fromRoad, toRoad: spec.toRoad, locality: 'adjacent', centrelineIds: [...spec.centrelineIds], geometry };
}

/**
 * Semantic A1 traps. Fail closed on classification boundary drift.
 * @param {object[]} segments
 * @param {{number: string, street: string}[]} addresses
 */
function assertSanity(segments, addresses) {
  const hasAddr = (number, street) => addresses.some((row) => row.number === number && row.street === street);
  const must = [
    ['40', 'Hanna Ave'],
    ['65', 'Jefferson Ave'],
    ['171', 'East Liberty St'],
    ['39', 'East Liberty St'],
  ];
  // 75 Fraser Ave is Lamport Stadium in the spec, but the 2026-09-29 City
  // address extract has no 75 Fraser Ave point. The stadium's city point is
  // 1155 King St W (Allan A. Lamport Stadium Park). Do not invent a coordinate.
  if (!hasAddr('75', 'Fraser Ave')) console.log('note: City address extract has no 75 Fraser Ave point');
  for (const [number, street] of must) {
    if (!hasAddr(number, street)) throw new Error(`missing core address ${number} ${street}`);
  }
  const bannedStreets = ['Temple Ave', 'Elm Grove Ave', 'Tyndall Ave', 'Joe Shuster Way'];
  for (const street of bannedStreets) {
    if (addresses.some((row) => row.street === street)) throw new Error(`banned street present in address table: ${street}`);
  }
  if (hasAddr('1205', 'Queen St W')) throw new Error('1205 Queen St W must not be core');
  const douro = addresses.filter((row) => row.street === 'Douro St');
  if (douro.length !== 11) throw new Error(`expected 11 Douro St points strictly inside the ring, found ${douro.length}`);

  const coreNames = new Set(segments.filter((s) => s.locality === 'core').map((s) => s.linearName));
  for (const banned of BOUNDARY_ROADS) {
    if (coreNames.has(banned)) throw new Error(`${banned} must not be a core segment`);
  }
  for (const banned of A1_EXCLUDED_CORE_STREETS) {
    if (coreNames.has(banned)) throw new Error(`${banned} must not be a core segment (A1)`);
  }
  const match = (locality, road, a, b) =>
    segments.some((seg) => {
      if (seg.locality !== locality || seg.linearName !== road) return false;
      const ends = [seg.fromIntersection.join('|'), seg.toIntersection.join('|')];
      const blob = ends.join(' || ');
      return blob.includes(a) && blob.includes(b);
    });
  if (!match('core', 'Hanna Ave', 'Snooker St', 'Liberty St')) throw new Error('Hanna Ave Snooker–Liberty is not core');
  const corridors = segments.filter((s) => s.locality === 'adjacent');
  const hasCorridor = (road, fromRoad, toRoad) => corridors.some((c) => c.road === road && c.fromRoad === fromRoad && c.toRoad === toRoad);
  if (!hasCorridor('Strachan Ave', 'Fleet St', 'King St W')) throw new Error('Strachan Fleet–King adjacent corridor missing');
  if (!hasCorridor('Strachan Ave', 'King St W', 'Lake Shore Blvd W')) throw new Error('Strachan King–Lake Shore adjacent corridor missing');
  if (!hasCorridor('King St W', 'Strachan Ave', 'Dufferin St')) throw new Error('King Strachan–Dufferin adjacent corridor missing');
  if (!hasCorridor('Lake Shore Blvd W', 'Strachan Ave', 'Newfoundland Rd')) throw new Error('Lake Shore Strachan–Newfoundland adjacent corridor missing');
  if (!hasCorridor('Dufferin St', 'King St W', 'Saskatchewan Rd')) throw new Error('Dufferin King–Saskatchewan adjacent corridor missing');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  /** @type {Seg[]} */
  const segs = [];
  /** @type {Map<string, Set<string>>} */
  const streetsAt = new Map();
  /** @type {Map<string, number[]>} */
  const atPoint = new Map();
  /** @type {Map<string, Seg>} */
  const byId = new Map();

  await readCsv(args.centreline, (row) => {
    const coords = lineCoords(row.geometry);
    if (coords.length < 2 || !inBbox(coords)) return;
    const seg = {
      id: row.CENTRELINE_ID,
      name: row.LINEAR_NAME_FULL,
      feature: row.FEATURE_CODE_DESC,
      fromId: row.FROM_INTERSECTION_ID,
      toId: row.TO_INTERSECTION_ID,
      coords,
    };
    if (byId.has(seg.id)) throw new Error(`duplicate Centreline ID in City CSV: ${seg.id}`);
    segs.push(seg);
    byId.set(seg.id, seg);
    for (const [id, pt] of [[seg.fromId, coords[0]], [seg.toId, coords[coords.length - 1]]]) {
      if (!streetsAt.has(id)) streetsAt.set(id, new Set());
      streetsAt.get(id).add(seg.name);
      if (!atPoint.has(id)) atPoint.set(id, pt);
    }
  });

  const kingDufferin = sharedIntersection(streetsAt, atPoint, 'King St W', 'Dufferin St');
  const kingStrachan = sharedIntersection(streetsAt, atPoint, 'King St W', 'Strachan Ave');
  const strachanRail = sharedIntersection(streetsAt, atPoint, 'Strachan Ave', 'C N R');
  const dufferinRail = sharedIntersection(streetsAt, atPoint, 'Dufferin St', 'C N R');
  if (!kingDufferin || !kingStrachan || !strachanRail || !dufferinRail) {
    throw new Error(`missing ring corners king/dufferin=${kingDufferin} king/strachan=${kingStrachan} strachan/cnr=${strachanRail} dufferin/cnr=${dufferinRail}`);
  }

  const north = walk(segs, 'King St W', kingDufferin, kingStrachan);
  const east = walk(segs, 'Strachan Ave', kingStrachan, strachanRail);
  const south = walk(segs, 'C N R', strachanRail, dufferinRail);
  const west = walk(segs, 'Dufferin St', dufferinRail, kingDufferin);
  for (const [label, leg] of [['king', north], ['strachan', east], ['rail', south], ['dufferin', west]]) {
    if (!leg.ended || leg.coords.length < 2) {
      throw new Error(`ring leg ${label} did not connect (ended at ${leg.current}, points ${leg.coords.length})`);
    }
  }

  /** @type {number[][]} */
  let ring = [...north.coords, ...east.coords.slice(1), ...south.coords.slice(1), ...west.coords.slice(1)];
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring = [...ring, ring[0]];
  }
  if (shoelace(ring) < 0) ring = [...ring].reverse();
  if (ring.length < 8) throw new Error(`ring implausibly small: ${ring.length} points`);

  /** @type {object[]} */
  const segments = [];
  let excludedDouro = 0;
  for (const seg of segs) {
    if (BOUNDARY_ROADS.has(seg.name)) continue;
    if (!ROAD_FEATURES.has(seg.feature)) continue;
    if (/trail|gardiner|ramp/i.test(seg.name)) continue;
    if (!isWhollyInside(seg, ring)) continue;
    if (A1_EXCLUDED_CORE_STREETS.has(seg.name)) { excludedDouro += 1; continue; }
    const ends = endpointNames(seg, streetsAt);
    segments.push({
      centrelineId: seg.id,
      linearName: seg.name,
      fromIntersection: ends.from,
      toIntersection: ends.to,
      locality: 'core',
      feature: seg.feature,
      coordinates: seg.coords,
    });
  }
  // The committed reviewed table excludes exactly four interior Douro St rows.
  if (excludedDouro !== 4) {
    throw new Error(`expected exactly four interior Douro St rows excluded by A1 policy, found ${excludedDouro}`);
  }
  for (const spec of REVIEWED_ADJACENT_CORRIDORS) {
    segments.push(corridorRow(spec, byId, streetsAt, atPoint));
  }

  /** @type {Map<string, {number: string, street: string}>} */
  const addressMap = new Map();
  await readCsv(args.addresses, (row) => {
    const coords = lineCoords(row.geometry);
    const pt = coords[0];
    if (!pt || !pointInBbox(pt[0], pt[1])) return;
    const number = String(row.ADDRESS_NUMBER || '').trim();
    const suffix = String(row.LO_NUM_SUF || '').trim();
    const street = String(row.LINEAR_NAME_FULL || '').trim();
    if (!number || number === 'None' || !street || street === 'None') return;
    if (!pointInRing(pt[0], pt[1], ring)) return;
    const fullNumber = suffix && suffix !== 'None' ? `${number}${suffix}` : number;
    const key = `${fullNumber.toLowerCase()}|${street.toLowerCase()}`;
    if (!addressMap.has(key)) addressMap.set(key, { number: fullNumber, street });
  });
  const addresses = [...addressMap.values()].sort((a, b) =>
    a.street === b.street ? a.number.localeCompare(b.number, undefined, { numeric: true }) : a.street.localeCompare(b.street));

  assertSanity(segments, addresses);

  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: 'Liberty Village core',
          boundary: 'King St W (north), C N R rail corridor (south), Strachan Ave (east), Dufferin St (west)',
          licence: SOURCE.licence,
          retrieved: SOURCE.retrieved,
          centreline: SOURCE.centreline,
          note: 'Ring follows City centreline. Boundary streets are adjacent frontage and are not interior.',
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
    reviewNote: GEOJSON_REVIEW_NOTE,
  };

  const addressDoc = {
    licence: SOURCE.licence,
    retrieved: SOURCE.retrieved,
    addressPoints: SOURCE.addressPoints,
    addresses,
    reviewNote: ADDRESS_REVIEW_NOTE,
  };

  const segmentsDoc = { provenance: SEGMENTS_PROVENANCE, segments };

  await mkdir(args.out, { recursive: true });
  await writeFile(path.join(args.out, 'lv-core.geojson'), `${asciiJson(geojson)}\n`);
  await writeFile(path.join(args.out, 'lv-address-points.json'), `${asciiJson(addressDoc)}\n`);
  await writeFile(path.join(args.out, 'lv-segments.json'), `${asciiJson(segmentsDoc)}\n`);

  const coreN = segments.filter((s) => s.locality === 'core').length;
  const adjN = segments.filter((s) => s.locality === 'adjacent').length;
  console.log(`wrote ring=${ring.length} addresses=${addresses.length} segments core=${coreN} adjacent=${adjN} douroExcluded=${excludedDouro}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
