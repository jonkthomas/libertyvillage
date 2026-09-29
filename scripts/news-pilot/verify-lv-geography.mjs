/** Read-only independent check of committed LV geography against City WGS84 CSVs. */
import { createReadStream, readFileSync } from 'node:fs';
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

async function main() {
  const { centreline, addresses } = argumentsFrom(process.argv.slice(2));
  const ring = data('lv-core.geojson').features?.[0]?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) throw new Error('core ring is missing or open');
  const expectedAddresses = new Set(data('lv-address-points.json').addresses.map((x) => `${x.number.toLowerCase()}|${x.street.toLowerCase()}`));
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

  const segments = data('lv-segments.json').segments;
  const expectedIds = new Map();
  for (const segment of segments) {
    for (const id of segment.centrelineIds ?? [segment.centrelineId]) {
      if (!id) throw new Error('segment missing City ID');
      expectedIds.set(String(id), segment.road ?? segment.linearName);
    }
  }
  const foundIds = new Set();
  const cityBoundaryEdges = new Set();
  // Adjacent City rows can differ by sub-centimetre floating-point noise at shared nodes.
  const edgeKey = (a, b) => [a, b].map((point) => point.map((coordinate) => coordinate.toFixed(6)).join(',')).sort().join('|');
  const boundaryNames = new Set(['King St W', 'Strachan Ave', 'Dufferin St', 'C N R']);
  await eachCsvRow(centreline, (row) => {
    if (boundaryNames.has(row.LINEAR_NAME_FULL)) {
      let geometry;
      try { geometry = JSON.parse(row.geometry); } catch { geometry = null; }
      const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
      for (const line of lines) {
        for (let i = 1; i < line.length; i += 1) cityBoundaryEdges.add(edgeKey(line[i - 1], line[i]));
      }
    }
    const name = expectedIds.get(row.CENTRELINE_ID);
    if (!name) return;
    if (name !== row.LINEAR_NAME_FULL) throw new Error(`segment ${row.CENTRELINE_ID} name mismatch: ${name} / ${row.LINEAR_NAME_FULL}`);
    foundIds.add(row.CENTRELINE_ID);
  });
  const absentIds = [...expectedIds.keys()].filter((id) => !foundIds.has(id));
  if (absentIds.length) throw new Error(`City Centreline IDs absent: ${absentIds.slice(0, 5)}`);
  const unmatchedEdges = [];
  for (let i = 1; i < ring.length; i += 1) {
    if (!cityBoundaryEdges.has(edgeKey(ring[i - 1], ring[i]))) unmatchedEdges.push(i - 1);
  }
  if (unmatchedEdges.length) throw new Error(`ring edges absent from named City boundary roads: ${unmatchedEdges.slice(0, 8)}`);
  if (segments.some((x) => x.locality === 'core' && ['Douro St', 'King St W', 'Strachan Ave', 'Dufferin St', 'Lake Shore Blvd W'].includes(x.linearName))) throw new Error('core table contains an A1 banned road');
  console.log(`verified ring=${ring.length} addressPairs=${foundAddresses.size} centrelineIds=${foundIds.size} segments=${segments.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
