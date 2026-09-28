import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validatePaths } from '../../scripts/automation/policy.mjs';
import {
  appendSeenRegistry, buildDedupeState, fetchImage, isDiscoveryLocation, isDuplicate,
  norm, readSeenRegistry, selectBatch, slugify, toRecord,
} from '../../scripts/discover-businesses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Frozen historical input: unlike data/businesses.json, a later directory append
// cannot rewrite the expected outcome of the PR #57 incident replay.
const PR57 = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests', 'automation', 'fixtures', 'discovery', 'pr57-replay.json'),
  'utf8',
));

function business(name, address, overrides = {}) {
  return { slug: slugify(name), name, address, ...overrides };
}

function candidate(partial) {
  return { slug: slugify(partial.name), category: 'restaurants', reviewCount: 0, ...partial };
}

function tmpFile(basename) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-discovery-'));
  return { dir, file: path.join(dir, basename), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a discovered name stays rejected after its record is deleted from businesses.json', () => {
  const { file, cleanup } = tmpFile('discovery-seen.json');
  try {
    const brodflour = business('Brodflour', '8 Pardee Ave, Toronto, ON M6K 3H1, Canada');
    const again = candidate({ name: 'Brodflour', address: '8 Pardee Ave, Toronto, ON M6K 3H1, Canada' });

    // Run 1: the record is live, so the candidate is a duplicate and the run records it.
    assert.equal(isDuplicate(buildDedupeState([brodflour], readSeenRegistry(file)), again), true);
    appendSeenRegistry([brodflour.name], '2026-08-16', file);
    assert.equal(readSeenRegistry(file)[norm(brodflour.name)], '2026-08-16');

    // Run 2: the record has been curated out of the directory (PR #8 removed 86 of them).
    // Directory-only dedupe re-discovers it; the registry keeps it rejected.
    assert.equal(isDuplicate(buildDedupeState([], {}), again), false);
    assert.equal(isDuplicate(buildDedupeState([], readSeenRegistry(file)), again), true);
  } finally {
    cleanup();
  }
});

test('the seen registry is append-only, sorted, and degrades to empty on a bad read', () => {
  const { dir, file, cleanup } = tmpFile('discovery-seen.json');
  try {
    appendSeenRegistry(['Zebra Cafe', 'Brodflour'], '2026-08-16', file);
    const second = appendSeenRegistry(['Brodflour', 'Caffino'], '2026-09-01', file);

    assert.equal(second.brodflour, '2026-08-16', 'first-seen date is never rewritten');
    assert.equal(second.caffino, '2026-09-01');
    assert.deepEqual(Object.keys(second), ['brodflour', 'caffino', 'zebracafe']);
    assert.equal(fs.readFileSync(file, 'utf8').endsWith('\n'), true);

    fs.writeFileSync(file, 'not json');
    assert.deepEqual(readSeenRegistry(file), {});
    fs.writeFileSync(file, '["array-is-not-a-registry"]');
    assert.deepEqual(readSeenRegistry(file), {});
    assert.deepEqual(readSeenRegistry(path.join(dir, 'missing.json')), {});
  } finally {
    cleanup();
  }
});

test('a slug collision skips the candidate instead of appending a numbered suffix', () => {
  const existing = [business('Kinton Ramen Liberty Village', '153 Liberty St, Toronto, ON M6K 3G3, Canada')];
  const found = [
    candidate({ name: 'KINTON RAMEN LIBERTY VILLAGE', address: '153 Liberty St, Toronto, ON M6K 3G3, Canada' }),
    candidate({ name: 'Genuinely New Cafe', address: '1 Atlantic Ave, Toronto, ON M6K 1X9, Canada' }),
  ];

  const batch = selectBatch(found, buildDedupeState(existing, {}), 15);

  assert.deepEqual(batch.map((b) => b.slug), ['genuinely-new-cafe']);
  assert.equal(batch.some((b) => /-\d+$/.test(b.slug)), false);
});

test('selectBatch stops at the max and never emits a duplicate slug within a run', () => {
  const found = [
    candidate({ name: 'Alpha Bar', address: '1 King St W' }),
    candidate({ name: 'Alpha Bar', address: '2 King St W' }),
    candidate({ name: 'Beta Bar', address: '3 King St W' }),
    candidate({ name: 'Gamma Bar', address: '4 King St W' }),
  ];

  const batch = selectBatch(found, buildDedupeState([], {}), 2);

  assert.deepEqual(batch.map((b) => b.slug), ['alpha-bar', 'beta-bar']);
});

test('discovery requires coordinates and a numbered Liberty Village street address', () => {
  const gps_coordinates = { latitude: 43.638, longitude: -79.42 };
  const result = (address, name = 'A Business') => ({ title: name, address, gps_coordinates });

  assert.equal(isDiscoveryLocation(result('51 Hanna Ave #2, Toronto, ON M6K 1X1')), true);
  assert.equal(isDiscoveryLocation(result('171 E Liberty St, Toronto, ON M6K 3P6')), true);
  assert.equal(isDiscoveryLocation(result('1118 King St W, Toronto, ON M6K 1E4')), true);
  assert.equal(isDiscoveryLocation(result('1205 Queen St W, Toronto, ON M6K 0B9', 'Parkdale Barbers Liberty Village')), false);
  assert.equal(isDiscoveryLocation(result('Liberty Village, Toronto, ON M6K')), false);
  assert.equal(isDiscoveryLocation({ ...result('51 Hanna Ave, Toronto'), gps_coordinates: { latitude: 43.65, longitude: -79.42 } }), false);
});

test('batch dedupes differently named listings at the same unit and phone after sorting', () => {
  const address = '51 Hanna Ave #2, Toronto, ON M6K 1X1, Canada';
  const alternate = '51 Hanna Avenue Unit 2, Toronto, ON M6K 1X1, Canada';
  const found = [
    candidate({ name: 'Pearle Vision', address, phone: '+1 416-555-0199', reviewCount: 250 }),
    candidate({ name: 'Dr Rehana Manji', address: alternate, phone: '(416) 555-0199', reviewCount: 100 }),
    candidate({ name: 'Different Shop', address: '51 Hanna Ave #3, Toronto, ON M6K 1X1', phone: '(416) 555-0188', reviewCount: 80 }),
  ];
  assert.deepEqual(selectBatch(found, buildDedupeState([], {}), 15).map((b) => b.name),
    ['Pearle Vision', 'Different Shop']);

  const state = buildDedupeState([business('Pearle Vision', address, { phone: '+1 416-555-0199' })], {});
  assert.equal(isDuplicate(state, { name: 'Dr Rehana Manji', address: alternate, phone: '(416) 555-0199' }), true);
  assert.equal(isDuplicate(state, { name: 'Different Shop', address: '51 Hanna Ave #3, Toronto', phone: '(416) 555-0188' }), false);
});

test('batch rejects a shared address and phone without a unit but keeps distinct tenants', () => {
  const found = [
    candidate({ name: 'First Clinic', address: '51 Hanna Ave, Toronto, ON', phone: '+1 416-555-0199' }),
    candidate({ name: 'Second Clinic', address: '51 Hanna Avenue, Toronto, ON', phone: '(416) 555-0199' }),
    candidate({ name: 'Unrelated Tenant', address: '51 Hanna Ave, Toronto, ON', phone: '(416) 555-0188' }),
  ];
  assert.deepEqual(selectBatch(found, buildDedupeState([], {}), 15).map((b) => b.name),
    ['First Clinic', 'Unrelated Tenant']);
});

test('generated records omit transient hours and identify the source of review facts', () => {
  const record = toRecord({
    title: 'Example Cafe', type: 'Cafe', address: '51 Hanna Ave, Toronto, ON M6K 1X1',
    rating: 4.5, reviews: 80, hours: 'Open · Closes 5 PM', open_state: 'Open',
  }, 'coffee-shops');

  assert.equal(record.hours, '');
  assert.equal(record.priceRange, '');
  for (const copy of [record.description, record.answerBlock, record.reviewExcerpt, record.reviewFaqs[0].answer]) {
    assert.match(copy, /Google Maps listed a 4\.5-star average from 80 reviews/);
    assert.doesNotMatch(copy, /locals and visitors|Open|Closes/);
  }
});

test('fetchImage returns the existing image without overwriting it', async () => {
  const { dir, cleanup } = tmpFile('images');
  try {
    const existing = Buffer.from('original-hero-image-bytes');
    fs.writeFileSync(path.join(dir, 'brodflour.jpg'), existing);

    const result = await fetchImage('brodflour', 'coffee-shops', dir);

    assert.equal(result, '/images/businesses/brodflour.jpg');
    assert.deepEqual(fs.readFileSync(path.join(dir, 'brodflour.jpg')), existing);
    assert.deepEqual(fs.readdirSync(dir), ['brodflour.jpg']);

    // Without a Pexels key a missing image stays blank (records render fine blank).
    if (!process.env.PEXELS_API_KEY) {
      assert.equal(await fetchImage('no-such-business', 'coffee-shops', dir), '');
      assert.deepEqual(fs.readdirSync(dir), ['brodflour.jpg']);
    }
  } finally {
    cleanup();
  }
});

test('PR #57 frozen replay: 14 historical duplicates are rejected and the new candidate survives', () => {
  const state = buildDedupeState(PR57.existingBusinesses, PR57.seenRegistry);
  const accepted = [];
  const rejected = [];
  for (const c of PR57.candidates) {
    const rec = candidate(c);
    if (isDuplicate(state, rec)) {
      rejected.push(rec.name);
      continue;
    }
    state.seen.add(norm(rec.name));
    accepted.push(rec);
  }
  const batch = selectBatch(accepted, state, 15);

  assert.equal(rejected.length, 14, `expected exactly 14 duplicates rejected, got: ${rejected.join(', ')}`);
  assert.equal(rejected.includes(PR57.genuinelyNew), false);
  assert.deepEqual(batch.map((b) => b.name), [PR57.genuinelyNew]);
  for (const name of ['Brodflour', 'Caffino', 'KINTON RAMEN LIBERTY VILLAGE']) {
    assert.ok(rejected.includes(name), `${name} must be rejected`);
  }
});

test('PR #57 historical duplicates remain rejected by the current directory and seen registry', () => {
  const existing = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'businesses.json'), 'utf8'));
  const registry = readSeenRegistry(path.join(ROOT, 'data', 'discovery-seen.json'));
  const state = buildDedupeState(existing, registry);
  const historicalDuplicates = PR57.candidates.filter((entry) => entry.name !== PR57.genuinelyNew);

  assert.equal(historicalDuplicates.length, 14);
  for (const entry of historicalDuplicates) {
    assert.equal(isDuplicate(state, candidate(entry)), true,
      `${entry.name} escaped current businesses.json + discovery-seen.json dedupe`);
  }
});

test('the seeded registry covers the 86 records PR #8 removed from the directory', () => {
  const existing = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'businesses.json'), 'utf8'));
  const registry = readSeenRegistry(path.join(ROOT, 'data', 'discovery-seen.json'));

  for (const b of existing) assert.ok(registry[norm(b.name)], `${b.name} missing from registry`);
  // 130 live + 86 purged, minus names that appear on both sides of the purge.
  assert.ok(Object.keys(registry).length >= 214, 'registry seeded with live + purged names');
  for (const [key, date] of Object.entries(registry)) {
    assert.equal(key, norm(key), `${key} is not a normalized name`);
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('the business generator policy allows the registry file it now writes', () => {
  assert.equal(validatePaths('business', [
    'data/businesses.json', 'data/discovery-seen.json',
    'public/images/businesses/new-cafe.jpg',
  ]).ok, true);
  assert.equal(validatePaths('business', ['data/posts.json']).ok, false);
  // Ticket 1a/1d: provenance the fixer cannot repair stays out of the scored diff.
  assert.equal(validatePaths('business', ['tasks/discovery-runs/2026-08-17.json']).ok, false);
});
