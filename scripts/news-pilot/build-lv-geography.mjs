/**
 * Offline deterministic builder for the Liberty Village geography data files
 * (docs/specs/weekly-roundup-v2.md §6.2; policy addendum:
 * docs/specs/weekly-roundup-v2-geography-addendum.md, DRAFT).
 *
 * Reads the City of Toronto Centreline and Address Points CSV extracts
 * (Open Government Licence – Toronto), refuses any input whose sha256 is not
 * the pinned reviewed extract, and writes:
 *   data/lv-core.geojson        core ring from Centreline boundary legs
 *   data/lv-address-points.json address points strictly inside the ring
 *   data/lv-segments.json       core segment rows, four reviewed adjacent
 *                               corridors, reviewed Exhibition Place internal rows
 *
 * Deterministic fail-closed policy (see the addendum for the full conflict list):
 *   - The ring is derived by graph-walking named Centreline legs between
 *     name-derived corner intersections (King/Dufferin, King/Strachan,
 *     Strachan/C N R, Dufferin/C N R). A leg that does not connect fails the run.
 *   - Core segments are City road-feature segments wholly inside the ring,
 *     EXCLUDING Douro St rows (A1 street exception: Douro is not-LV even though
 *     11 of its address points fall inside the ring) and the boundary roads.
 *   - Adjacent frontage is NOT derived from a bounding box: it comes only from
 *     reviewed Centreline ID lists that must equal the City intersection-ID
 *     path between named anchors (corridors) or the rows wholly inside the
 *     Exhibition Place grounds ring (internal roads). Each row keeps its City
 *     intersection names so a record matches by intersection on a constituent
 *     row. Lake Shore ends at British Columbia Rd because named Dufferin St
 *     never meets Lake Shore Blvd W in Centreline.
 *   - Any drift (input hash, missing City ID, renamed road, changed path or
 *     row set, missing anchor node) throws instead of emitting different data.
 *
 * This generator never reads the committed data/*.json files as input.
 *
 * Usage:
 *   node scripts/news-pilot/build-lv-geography.mjs \
 *     --centreline /tmp/lv-geo/centreline-4326.csv \
 *     --addresses /tmp/lv-geo/address-4326.csv \
 *     [--out DIR]   # default: scripts/news-pilot/data next to this file
 */

import { createHash } from 'node:crypto';
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
 * Reviewed adjacent frontage corridors. Geometry comes from the City CSV by
 * Centreline ID; the IDs are the reviewed selection and must equal the City's
 * shortest same-name intersection-ID path between the two named anchor nodes,
 * so a missing ID, a renamed road or a changed chain fails the run. Each
 * geometry entry keeps the City row's native orientation.
 *
 * Lake Shore Blvd W: named Dufferin St never meets Lake Shore in Centreline
 * (its southern chain ends at Saskatchewan Rd / British Columbia Rd, about
 * -79.4249). The western anchor is British Columbia Rd (node at -79.42918), the
 * first named Lake Shore intersection at or west of the Dufferin longitude and
 * the Exhibition Place west road.
 */
const REVIEWED_ADJACENT_CORRIDORS = [
  { road: 'King St W', fromRoad: 'Strachan Ave', toRoad: 'Dufferin St', centrelineIds: [1146739, 30095295, 30095345, 30095346, 60084322, 3155022, 1146840, 3120558, 7553457, 7553490, 30100479, 30100482, 30100483, 30100476, 30100477, 7553372, 60052295] },
  { road: 'Strachan Ave', fromRoad: 'King St W', toRoad: 'Lake Shore Blvd W', centrelineIds: [1146779, 1146860, 1146906, 60006713, 60006730, 30120067, 30120066, 1147128, 30144372, 30144371, 30103011, 1147284] },
  { road: 'Dufferin St', fromRoad: 'King St W', toRoad: 'Saskatchewan Rd', centrelineIds: [30111929, 30111928, 30111925, 9234179, 9234187, 9234204, 9234205, 1147346, 1147359, 20231260] },
  { road: 'Lake Shore Blvd W', fromRoad: 'Strachan Ave', toRoad: 'British Columbia Rd', centrelineIds: [30125351, 30021327, 30021270, 30021271, 30016282, 60024495, 30016243, 9234087, 1147551] },
];

/**
 * Exhibition Place grounds ring, as City Centreline legs between intersection
 * IDs: C N R (Strachan -> Dufferin), Dufferin St (C N R -> Saskatchewan Rd),
 * British Columbia Rd (Saskatchewan Rd -> Lake Shore), Lake Shore Blvd W
 * (British Columbia Rd -> Strachan), Strachan Ave (Lake Shore -> C N R).
 * Only used to select the reviewed internal-road IDs below.
 */
const EXHIBITION_RING_LEGS = [
  { road: 'C N R', from: ['Strachan Ave', 'C N R'], to: ['Dufferin St', 'C N R'] },
  { road: 'Dufferin St', from: ['Dufferin St', 'C N R'], to: ['Dufferin St', 'Saskatchewan Rd'] },
  { road: 'British Columbia Rd', from: ['Dufferin St', 'British Columbia Rd'], to: ['Lake Shore Blvd W', 'British Columbia Rd'] },
  { road: 'Lake Shore Blvd W', from: ['Lake Shore Blvd W', 'British Columbia Rd'], to: ['Lake Shore Blvd W', 'Strachan Ave'] },
  { road: 'Strachan Ave', from: ['Lake Shore Blvd W', 'Strachan Ave'], to: ['Strachan Ave', 'C N R'] },
];
const EXHIBITION_FEATURES = new Set([...ROAD_FEATURES, 'Other', 'Pending']);
/**
 * Reviewed Exhibition Place internal road rows (adjacent). The generator
 * re-derives the set (qualifying feature, wholly inside the grounds ring, not a
 * trail/ramp/expressway/bridge, not a boundary road) and fails if it differs.
 * British Columbia Rd is the grounds' west road and is listed explicitly.
 */
const REVIEWED_EXHIBITION_INTERNAL_IDS = [
  // Alberta Crcl
  1147555,
  // British Columbia Rd
  20231334, 30131620, 60056618,
  // Canada Blvd
  14063952, 20231256,
  // Manitoba Dr
  14063910, 30060515, 30131679, 30131681,
  // New Brunswick Way
  30131665,
  // Newfoundland Rd
  30075980,
  // Nova Scotia Ave
  30090303,
  // Nunavut Rd
  30131658,
  // Ontario Dr
  1147562, 20229232, 30060497,
  // Prince Edward Island Cres
  30090287, 30090297,
  // Princes' Blvd
  14063901, 14063902, 14065264, 20230465, 20230466, 20230494, 30131660, 30131661,
  // Quebec St
  30131680,
  // Saskatchewan Rd
  30016265, 30154568,
  // Yukon Pl
  1147556, 1147560,
];
const EXHIBITION_EDGE_ROADS = new Set(['British Columbia Rd']);

/** SHA-256 of the exact City extracts reviewed for this data. A new extract needs review. */
const PINNED_INPUTS = Object.freeze({
  centreline: '92f68eeea3198888200acc7751550484086e51a3da8fac4a0b36bd8ce622c02f',
  addresses: 'e6fcedbbf71b8bba6c5e876653488cd0f17a27cad54841cf4cb1564e465d22a3',
});

const SOURCE = Object.freeze({
  licence: 'Open Government Licence – Toronto',
  retrieved: '2026-09-29',
  centreline: Object.freeze({
    package: 'toronto-centreline-tcl',
    packageId: '1d079757-377b-4564-82df-eb5638583bfb',
    resourceId: '4dec5884-a5cf-49e7-b562-f835150dc0b1',
    resource: 'centreline-version-2-4326.csv',
    sha256: PINNED_INPUTS.centreline,
    note: 'City of Toronto Centreline (TCL) version 2, WGS84 CSV resource as downloaded 2026-09-29.',
  }),
  addressPoints: Object.freeze({
    package: 'address-points-municipal-toronto-one-address-repository',
    packageId: 'abedd8bc-e3dd-4d45-8e69-79165a76e4fa',
    resourceId: '64d4e54b-738f-4cd9-a9e7-8050fac8a52f',
    resource: 'address-points-4326.csv',
    sha256: PINNED_INPUTS.addresses,
    note: 'Municipal address points whose coordinate falls strictly inside the core ring.',
  }),
});

const SEGMENTS_PROVENANCE = Object.freeze({
  status: 'generated-core-plus-reviewed-adjacent',
  source: 'City of Toronto Centreline version 2',
  sourceUrl: 'https://open.toronto.ca/dataset/toronto-centreline-tcl/',
  centreline: SOURCE.centreline,
  note: 'Polygon-interior City core segments (four Douro St rows excluded by the A1 street exception) plus four reviewed adjacent frontage corridors whose IDs equal the City intersection-ID path between their anchors, plus reviewed Exhibition Place internal road rows. A record matches when its road equals the row or corridor road and each named cross road is an intersection on a constituent City row. Lake Shore Blvd W ends at British Columbia Rd because named Dufferin St does not meet Lake Shore in Centreline. Unlisted segments fail closed.',
  geometrySource: 'Geometry, intersection IDs and intersection names read from the CSV resource 4dec5884-a5cf-49e7-b562-f835150dc0b1 (sha256 pinned above). The datastore/GeoJSON resource ad296ebf-fca6-4e67-b3ce-48040a20e6cd is not used.',
});

const GEOJSON_REVIEW_NOTE = 'City Centreline ring geometry. A City address point strictly inside it is core (including King St W, Strachan Ave and Dufferin St frontage points); the Douro St street exception is the only address override. Boundary road segments are adjacent, never core.';
const ADDRESS_REVIEW_NOTE = 'Complete City address-point extract strictly inside the generated Centreline ring (381 pairs). Every pair is core with Toronto context except Douro St (11 pairs), which the A1 street exception keeps not-LV.';

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
 * @param {string} file
 */
async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
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
 * Anchor node shared by two named roads; a missing node fails the run.
 * @param {Map<string, Set<string>>} streetsAt
 * @param {Map<string, number[]>} atPoint
 * @param {string} a
 * @param {string} b
 */
function anchorNode(streetsAt, atPoint, a, b) {
  const node = sharedIntersection(streetsAt, atPoint, a, b);
  if (!node) throw new Error(`no City Centreline intersection node for ${a} x ${b}`);
  return node;
}

/**
 * Per-row intersection names so a record can match any intersection on the path.
 * @param {Seg} seg
 * @param {Map<string, Set<string>>} streetsAt
 */
function constituent(seg, streetsAt) {
  const ends = endpointNames(seg, streetsAt);
  return { centrelineId: seg.id, fromIntersection: ends.from, toIntersection: ends.to };
}

/**
 * Deterministic fail-closed corridor row: the reviewed Centreline IDs must be
 * exactly the City's same-name intersection-ID path between the two anchor
 * nodes; geometry is read from the City CSV with native orientation.
 * @param {{road: string, fromRoad: string, toRoad: string, centrelineIds: number[]}} spec
 * @param {Seg[]} segs
 * @param {Map<string, Seg>} byId
 * @param {Map<string, Set<string>>} streetsAt
 * @param {Map<string, number[]>} atPoint
 */
function corridorRow(spec, segs, byId, streetsAt, atPoint) {
  for (const id of spec.centrelineIds) {
    const seg = byId.get(String(id));
    if (!seg) throw new Error(`adjacent corridor ${spec.road}: City Centreline ID ${id} absent from the CSV`);
    if (seg.name !== spec.road) throw new Error(`adjacent corridor ${spec.road}: City ID ${id} is named ${seg.name}`);
  }
  const start = anchorNode(streetsAt, atPoint, spec.road, spec.fromRoad);
  const end = anchorNode(streetsAt, atPoint, spec.road, spec.toRoad);
  const path = walk(segs, spec.road, start, end);
  if (!path.ended || !path.used.length) throw new Error(`adjacent corridor ${spec.road}: no City path ${spec.fromRoad} -> ${spec.toRoad}`);
  const reviewed = spec.centrelineIds.map(String).sort().join(',');
  const derived = path.used.map((seg) => seg.id).sort().join(',');
  if (reviewed !== derived) {
    throw new Error(`adjacent corridor ${spec.road} ${spec.fromRoad}->${spec.toRoad}: reviewed IDs differ from City path [${path.used.map((seg) => seg.id).join(', ')}]`);
  }
  const rows = spec.centrelineIds.map((id) => byId.get(String(id)));
  return {
    road: spec.road,
    fromRoad: spec.fromRoad,
    toRoad: spec.toRoad,
    locality: 'adjacent',
    anchors: { from: start, to: end },
    centrelineIds: [...spec.centrelineIds],
    constituents: rows.map((seg) => constituent(seg, streetsAt)),
    geometry: rows.map((seg) => seg.coords),
  };
}

/**
 * Exhibition Place grounds ring from named City legs (see EXHIBITION_RING_LEGS).
 * @param {Seg[]} segs
 * @param {Map<string, Set<string>>} streetsAt
 * @param {Map<string, number[]>} atPoint
 */
function exhibitionRing(segs, streetsAt, atPoint) {
  /** @type {number[][]} */
  let ring = [];
  /** @type {string[]} */
  const legIds = [];
  for (const leg of EXHIBITION_RING_LEGS) {
    const from = anchorNode(streetsAt, atPoint, leg.from[0], leg.from[1]);
    const to = anchorNode(streetsAt, atPoint, leg.to[0], leg.to[1]);
    const path = walk(segs, leg.road, from, to);
    if (!path.ended || path.coords.length < 2) throw new Error(`Exhibition ring leg ${leg.road} did not connect`);
    ring = ring.length ? [...ring, ...path.coords.slice(1)] : path.coords;
    legIds.push(...path.used.map((seg) => seg.id));
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (haversine(first[0], first[1], last[0], last[1]) > 1) throw new Error('Exhibition ring is not closed');
  ring[ring.length - 1] = first;
  return { ring, legIds };
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
  // A1 adjacent positives must be reachable by intersection on a constituent row.
  const corridors = segments.filter((s) => s.locality === 'adjacent' && s.constituents);
  const onCorridor = (road, ...names) => corridors.some((c) => c.road === road &&
    names.every((name) => c.constituents.some((row) => row.fromIntersection.includes(name) || row.toIntersection.includes(name))));
  for (const [road, ...names] of [
    ['Strachan Ave', 'Fleet St'],
    ['King St W', 'Strachan Ave'],
    ['King St W', 'Atlantic Ave', 'Jefferson Ave'],
    ['Lake Shore Blvd W', 'Newfoundland Rd', 'Martin Goodman Trl'],
    ['Lake Shore Blvd W', 'British Columbia Rd'],
    ['Dufferin St', 'King St W', 'Saskatchewan Rd'],
  ]) {
    if (!onCorridor(road, ...names)) throw new Error(`A1 adjacent intersection missing: ${road} at ${names.join(' / ')}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const [label, file] of [['centreline', args.centreline], ['addresses', args.addresses]]) {
    const digest = await sha256File(file);
    if (digest !== PINNED_INPUTS[label]) {
      throw new Error(`${label} CSV sha256 ${digest} is not the reviewed extract ${PINNED_INPUTS[label]}; a new City extract needs review`);
    }
  }
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
    segments.push(corridorRow(spec, segs, byId, streetsAt, atPoint));
  }
  const exhibition = exhibitionRing(segs, streetsAt, atPoint);
  const exhibitionLeg = new Set(exhibition.legIds);
  const exhibitionRows = segs.filter((seg) => (EXHIBITION_EDGE_ROADS.has(seg.name) && exhibitionLeg.has(seg.id)) || (
    !exhibitionLeg.has(seg.id) && !BOUNDARY_ROADS.has(seg.name) && EXHIBITION_FEATURES.has(seg.feature) &&
    !/trl|trail|gardiner|ramp|bridge|shoreline/i.test(seg.name) && isWhollyInside(seg, exhibition.ring)));
  const derivedInternal = exhibitionRows.map((seg) => seg.id).sort().join(',');
  const reviewedInternal = REVIEWED_EXHIBITION_INTERNAL_IDS.map(String).sort().join(',');
  if (derivedInternal !== reviewedInternal) {
    throw new Error(`Exhibition Place internal rows differ from the reviewed ID list: ${exhibitionRows.map((seg) => `${seg.id} ${seg.name}`).join('; ')}`);
  }
  for (const id of REVIEWED_EXHIBITION_INTERNAL_IDS) {
    const seg = byId.get(String(id));
    segments.push({
      centrelineId: seg.id,
      linearName: seg.name,
      ...constituent(seg, streetsAt),
      locality: 'adjacent',
      group: 'exhibition-place-internal',
      feature: seg.feature,
      coordinates: seg.coords,
    });
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
  const corridorN = segments.filter((s) => s.constituents).length;
  const internalN = segments.filter((s) => s.group === 'exhibition-place-internal').length;
  console.log(`wrote ring=${ring.length} addresses=${addresses.length} segments core=${coreN} corridors=${corridorN} exhibitionInternal=${internalN} douroExcluded=${excludedDouro}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
