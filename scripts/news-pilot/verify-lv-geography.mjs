/**
 * Read-only independent check of committed LV geography against the pinned City WGS84 CSVs.
 * Checks: input sha256 equals the committed provenance; the address table equals every City
 * point strictly inside the committed ring; every ring edge lies on a City boundary road; every
 * segment row's name, geometry and intersection names equal its City row; the core set equals an
 * independent every-vertex recomputation; each corridor is a connected City chain between its
 * anchor nodes; the Exhibition Place internal set equals every qualifying City row inside a ring
 * rebuilt here from City legs. Its point-in-ring test is the same ray cast as the generator's.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, realpathSync } from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = (name) => JSON.parse(readFileSync(path.join(here, 'data', name), 'utf8'));

function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (quoted && character === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += character;
  }
  cells.push(cell);
  return cells;
}

async function eachCsvRow(file, visit) {
  const lines = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header;
  let pending = '';
  for await (const line of lines) {
    pending = pending ? `${pending}\n${line}` : line;
    if ((pending.match(/"/g)?.length ?? 0) % 2) continue;
    const cells = splitCsvLine(pending);
    pending = '';
    if (!header) { header = cells; continue; }
    if (cells.length !== header.length) throw new Error(`bad CSV row in ${file}`);
    const row = Object.fromEntries(header.map((column, index) => [column, cells[index]]));
    visit(row);
  }
  if (pending) throw new Error(`unterminated CSV quote in ${file}`);
}

function firstPoint(geometry) {
  let value = geometry?.coordinates;
  while (Array.isArray(value) && Array.isArray(value[0])) value = value[0];
  return Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? value : null;
}

function insideRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function argumentsFrom(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--centreline') result.centreline = argv[++i];
    else if (argv[i] === '--addresses') result.addresses = argv[++i];
  }
  if (!result.centreline || !result.addresses) throw new Error('usage: node verify-lv-geography.mjs --centreline CITY.csv --addresses CITY.csv');
  return result;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const lineList = (geometry) => geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
const flat = (geometry) => lineList(geometry).flat();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Planar metres from a point to a ring edge (every vertex is tested, not a sample).
function metresToRing([lon, lat], ring) {
  const kx = 111_320 * Math.cos(lat * Math.PI / 180);
  const ky = 111_132;
  let best = Infinity;
  for (let i = 1; i < ring.length; i += 1) {
    const ax = (ring[i - 1][0] - lon) * kx; const ay = (ring[i - 1][1] - lat) * ky;
    const bx = (ring[i][0] - lon) * kx; const by = (ring[i][1] - lat) * ky;
    const dx = bx - ax; const dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
// Middle vertex inside and every vertex inside or within 12 m of the ring.
function inside(coords, ring) {
  const mid = coords[Math.floor((coords.length - 1) / 2)];
  return insideRing(mid[0], mid[1], ring) && coords.every((pt) => insideRing(pt[0], pt[1], ring) || metresToRing(pt, ring) <= 12);
}

function chainIds(rows, road, start, end) {
  const pool = rows.filter((row) => row.name === road);
  const seen = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    for (const row of pool) {
      const next = row.from === node ? row.to : row.to === node ? row.from : null;
      if (next && !seen.has(next)) { seen.set(next, { row, node }); queue.push(next); }
    }
  }
  if (!seen.has(end)) throw new Error(`no City ${road} chain ${start} -> ${end}`);
  const ids = [];
  const coords = [];
  for (let node = end; node !== start; node = seen.get(node).node) ids.unshift(seen.get(node).row);
  let at = start;
  for (const row of ids) {
    const pts = row.from === at ? row.coords : [...row.coords].reverse();
    coords.push(...(coords.length ? pts.slice(1) : pts));
    at = row.from === at ? row.to : row.from;
  }
  return { ids: ids.map((row) => row.id), coords };
}

async function main() {
  const { centreline, addresses } = argumentsFrom(process.argv.slice(2));
  const addressDoc = data('lv-address-points.json');
  const segmentsDoc = data('lv-segments.json');
  for (const [label, file, pinned] of [['centreline', centreline, segmentsDoc.provenance?.centreline?.sha256], ['addresses', addresses, addressDoc.addressPoints?.sha256]]) {
    const digest = await sha256(file);
    if (!pinned || digest !== pinned) throw new Error(`${label} CSV sha256 ${digest} does not match committed provenance ${pinned}`);
  }
  const ring = data('lv-core.geojson').features?.[0]?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) throw new Error('core ring is missing or open');
  const expectedAddresses = new Set(addressDoc.addresses.map((x) => `${x.number.toLowerCase()}|${x.street.toLowerCase()}`));
  const foundAddresses = new Set();
  await eachCsvRow(addresses, (row) => {
    if (!row.ADDRESS_NUMBER || !row.LINEAR_NAME_FULL || row.ADDRESS_NUMBER === 'None') return;
    let geometry;
    try { geometry = JSON.parse(row.geometry); } catch { return; }
    const point = firstPoint(geometry);
    if (!point || !insideRing(point[0], point[1], ring)) return;
    const suffix = row.LO_NUM_SUF && row.LO_NUM_SUF !== 'None' ? row.LO_NUM_SUF : '';
    foundAddresses.add(`${row.ADDRESS_NUMBER}${suffix}|${row.LINEAR_NAME_FULL}`.toLowerCase());
  });
  const extra = [...foundAddresses].filter((x) => !expectedAddresses.has(x));
  const missing = [...expectedAddresses].filter((x) => !foundAddresses.has(x));
  if (extra.length || missing.length) throw new Error(`address extract mismatch: ${extra.length} missing from commit; ${missing.length} absent from City CSV. Examples ${extra.slice(0, 3)} / ${missing.slice(0, 3)}`);

  const segments = segmentsDoc.segments;
  const boundaryNames = new Set(['King St W', 'Strachan Ave', 'Dufferin St', 'C N R']);
  const cityBoundaryEdges = new Set();
  // Adjacent City rows can differ by sub-centimetre floating-point noise at shared nodes.
  const edgeKey = (a, b) => [a, b].map((point) => point.map((coordinate) => coordinate.toFixed(6)).join(',')).sort().join('|');
  /** @type {Map<string, {id: string, name: string, feature: string, from: string, to: string, lines: number[][][], coords: number[][]}>} */
  const byId = new Map();
  const namesAt = new Map();
  await eachCsvRow(centreline, (row) => {
    let geometry;
    try { geometry = JSON.parse(row.geometry); } catch { geometry = null; }
    const lines = lineList(geometry);
    if (boundaryNames.has(row.LINEAR_NAME_FULL)) {
      for (const line of lines) {
        for (let i = 1; i < line.length; i += 1) cityBoundaryEdges.add(edgeKey(line[i - 1], line[i]));
      }
    }
    const coords = flat(geometry);
    if (!coords.some(([lon, lat]) => lon > -79.45 && lon < -79.39 && lat > 43.62 && lat < 43.65)) return;
    if (byId.has(row.CENTRELINE_ID)) throw new Error(`duplicate City Centreline ID ${row.CENTRELINE_ID}`);
    byId.set(row.CENTRELINE_ID, { id: row.CENTRELINE_ID, name: row.LINEAR_NAME_FULL, feature: row.FEATURE_CODE_DESC,
      from: row.FROM_INTERSECTION_ID, to: row.TO_INTERSECTION_ID, lines, coords });
    for (const node of [row.FROM_INTERSECTION_ID, row.TO_INTERSECTION_ID]) {
      if (!namesAt.has(node)) namesAt.set(node, new Set());
      namesAt.get(node).add(row.LINEAR_NAME_FULL);
    }
  });
  const unmatchedEdges = [];
  for (let i = 1; i < ring.length; i += 1) {
    if (!cityBoundaryEdges.has(edgeKey(ring[i - 1], ring[i]))) unmatchedEdges.push(i - 1);
  }
  if (unmatchedEdges.length) throw new Error(`ring edges absent from named City boundary roads: ${unmatchedEdges.slice(0, 8)}`);

  const city = (id, name) => {
    const row = byId.get(String(id));
    if (!row) throw new Error(`City Centreline ID absent: ${id}`);
    if (row.name !== name) throw new Error(`segment ${id} name mismatch: ${name} / ${row.name}`);
    return row;
  };
  const cross = (row, node) => [...(namesAt.get(node) ?? [])].filter((name) => name !== row.name).sort();
  const checkEnds = (label, row, entry) => {
    if (!same(entry.fromIntersection, cross(row, row.from)) || !same(entry.toIntersection, cross(row, row.to))) throw new Error(`${label} ${row.id} intersection names differ from City`);
  };
  let checkedIds = 0;
  for (const segment of segments) {
    if (segment.constituents) {
      if (!same(segment.constituents.map((x) => x.centrelineId), segment.centrelineIds.map(String))) throw new Error(`corridor ${segment.road} constituents differ from centrelineIds`);
      segment.centrelineIds.forEach((id, index) => {
        const row = city(id, segment.road);
        if (!same(segment.geometry[index], row.coords)) throw new Error(`corridor ${segment.road} geometry differs from City row ${id}`);
        checkEnds(`corridor ${segment.road}`, row, segment.constituents[index]);
        checkedIds += 1;
      });
      for (const [node, name] of [[segment.anchors.from, segment.fromRoad], [segment.anchors.to, segment.toRoad]]) {
        if (!namesAt.get(node)?.has(segment.road) || !namesAt.get(node)?.has(name)) throw new Error(`corridor ${segment.road} anchor ${node} is not ${segment.road} x ${name}`);
      }
      const chain = chainIds([...byId.values()], segment.road, segment.anchors.from, segment.anchors.to);
      if (!same([...chain.ids].sort(), segment.centrelineIds.map(String).sort())) throw new Error(`corridor ${segment.road} is not the City chain between its anchors`);
    } else {
      const row = city(segment.centrelineId, segment.linearName);
      if (!same(segment.coordinates, row.coords)) throw new Error(`segment ${row.id} geometry differs from City row`);
      checkEnds('segment', row, segment);
      checkedIds += 1;
    }
  }

  const roadFeatures = new Set(['Local', 'Collector', 'Major Arterial', 'Minor Arterial', 'Laneway', 'Access Road']);
  const excludedName = /trl|trail|gardiner|ramp|bridge|shoreline/i;
  const nonCore = new Set(['King St W', 'Strachan Ave', 'Dufferin St', 'Lake Shore Blvd W', 'C N R', 'Douro St']);
  const expectedCore = segments.filter((x) => x.locality === 'core').map((x) => x.centrelineId).sort();
  const derivedCore = [...byId.values()].filter((row) => roadFeatures.has(row.feature) && !nonCore.has(row.name) && !excludedName.test(row.name) && inside(row.coords, ring)).map((row) => row.id).sort();
  if (!same(expectedCore, derivedCore)) {
    throw new Error(`core membership differs: committed-only ${expectedCore.filter((id) => !derivedCore.includes(id))} / City-only ${derivedCore.filter((id) => !expectedCore.includes(id))}`);
  }
  const douroInside = [...byId.values()].filter((row) => row.name === 'Douro St' && roadFeatures.has(row.feature) && inside(row.coords, ring)).length;

  const node = (a, b) => [...namesAt].filter(([, names]) => names.has(a) && names.has(b)).map(([id]) => id);
  const one = (a, b) => {
    const nodes = node(a, b);
    if (nodes.length !== 1) throw new Error(`expected one City node ${a} x ${b}, found ${nodes.length}`);
    return nodes[0];
  };
  const rows = [...byId.values()];
  const legs = [
    ['C N R', one('Strachan Ave', 'C N R'), one('Dufferin St', 'C N R')],
    ['Dufferin St', one('Dufferin St', 'C N R'), one('Dufferin St', 'Saskatchewan Rd')],
    ['British Columbia Rd', one('Dufferin St', 'Saskatchewan Rd'), one('Lake Shore Blvd W', 'British Columbia Rd')],
    ['Lake Shore Blvd W', one('Lake Shore Blvd W', 'British Columbia Rd'), one('Lake Shore Blvd W', 'Strachan Ave')],
    ['Strachan Ave', one('Lake Shore Blvd W', 'Strachan Ave'), one('Strachan Ave', 'C N R')],
  ].map(([road, from, to]) => chainIds(rows, road, from, to));
  const exhibitionRing = legs.flatMap((leg, index) => (index ? leg.coords.slice(1) : leg.coords));
  exhibitionRing[exhibitionRing.length - 1] = exhibitionRing[0];
  const legIds = new Set(legs.flatMap((leg) => leg.ids));
  const expectedInternal = segments.filter((x) => x.group === 'exhibition-place-internal').map((x) => x.centrelineId).sort();
  const derivedInternal = rows.filter((row) => (row.name === 'British Columbia Rd' && legIds.has(row.id)) || (!legIds.has(row.id) &&
    !nonCore.has(row.name) && [...roadFeatures, 'Other', 'Pending'].includes(row.feature) && !excludedName.test(row.name) && inside(row.coords, exhibitionRing)))
    .map((row) => row.id).sort();
  if (!same(expectedInternal, derivedInternal)) {
    throw new Error(`Exhibition internal membership differs: committed-only ${expectedInternal.filter((id) => !derivedInternal.includes(id))} / City-only ${derivedInternal.filter((id) => !expectedInternal.includes(id))}`);
  }
  if (segments.some((x) => x.locality === 'core' && nonCore.has(x.linearName))) throw new Error('core table contains an A1 banned road');
  console.log(`verified inputs=sha256-pinned ring=${ring.length} addressPairs=${foundAddresses.size} segmentRows=${segments.length} cityIds=${checkedIds} core=${expectedCore.length} douroInsideExcluded=${douroInside} corridors=${segments.filter((x) => x.constituents).length} exhibitionInternal=${expectedInternal.length}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
