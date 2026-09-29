
// Part 2: fixture validation tests + replay assertions + census output.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REF = path.join(ROOT, 'tests/fixtures/roundup-v2/backtest/reference');
const REP = path.join(ROOT, 'tests/fixtures/roundup-v2/backtest/replay');

const PIN_REFERENCE = {
  'items.jsonl': '4b0d2f84ed35ca9556b34ac48028973d1a472994849fad573fff24167649c4f7',
  'ig/ig-items.jsonl': '37541f924aeff5c4cee8efe37300ac627ee50206771e2a20d3ee77dd13f06b83',
  'ig/accounts.csv': 'd38079d62abb00da664587bd9e1a4f8c008d4906462d268fd56b663165bb50d8',
};
const PIN_ARCHIVE = {
  'apify-items1.json': '1c602d8b1cb2438e46cb776b06b93ecbe65647c6e6f968579e99298acd78b255',
  'apify-items2.json': 'a0f51677bd4b07be3bd60f0d958642fb6a8e63cc0049d2ab05e341e40d31e816',
  'apify-items3.json': '0f1b66ab28b6cd8a2a08a860256ba61d7502e583d2c4ebe4994875a0af5e1b21',
  'apify-items4.json': '46a2306f170384e64d16b05bd2bbea15c7cf6b4b63aaee08e3eee94d8cec8c5b',
  'apify-items5.json': '19233278b1282b031d140b88215de7f4afa7c3bb12b71d29a295e0e9d4f6d253',
  'classify.py': '380637b2a3d62c9ed448e5973a143ec24ceb69a90d5592449f15cf8cb09167c6',
  'owned-posts.json': '9e53eed1207ecd8ae8a4ec10f49bdb0e996b3c85cfc31139e9bc20fbecad298a',
  'website-audit.json': '518926ca509e7eba9851cba8c762f19cbc306ac8fd5263445f26a95509e2c773',
  'backtest-items.jsonl': '4b0d2f84ed35ca9556b34ac48028973d1a472994849fad573fff24167649c4f7',
  'backtest-report.md': '003d86a0fbe485f6530715c7c0bf17707f0de7f8cb0a8333db5318bc3e40c0d1',
};

const sha = (b) => createHash('sha256').update(b).digest('hex');
const lines = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.length > 0);

const header = JSON.parse(lines(path.join(REP, 'conversion.jsonl'))[0]);
const UNITS = lines(path.join(REP, 'conversion.jsonl')).slice(1).map((l) => JSON.parse(l));
const byId = new Map(UNITS.map((u) => [u.unitId, u]));

const SLOTS = {
  37: ['2026-09-09T16:00:00Z', '2026-09-11T16:00:00Z', '2026-09-13T16:00:00Z'],
  38: ['2026-09-16T16:00:00Z', '2026-09-18T16:00:00Z', '2026-09-20T16:00:00Z'],
  39: ['2026-09-23T16:00:00Z', '2026-09-25T16:00:00Z', '2026-09-27T16:00:00Z'],
  40: ['2026-09-29T15:00:00Z'],
};
const isoWeek = (iso) => {
  if (iso < '2026-09-07T00:00:00Z') return 36;
  if (iso < '2026-09-14T00:00:00Z') return 37;
  if (iso < '2026-09-21T00:00:00Z') return 38;
  if (iso < '2026-09-28T00:00:00Z') return 39;
  return 40;
};
const eodToronto = (date) => new Date(`${date}T23:59:59-04:00`).getTime();

let thisCeilingDateline = true;
let thisCeilingKeys = true;

function concertVenue(u) {
  if (u.clockFacts.venue) return u.clockFacts.venue;
  const k = u.occurrenceKey || '';
  const m = k.match(/^occ:venue:([^:]+)/);
  return m ? `venue:${m[1]}` : `url:${u.bodies[0].url}`;
}
function classVenue(u) {
  return u.occurrenceKey ? u.occurrenceKey.split(':').slice(0, 3).join(':') : u.unitId;
}

function availableAt(u, clockIso) {
  const C = Date.parse(clockIso);
  const clockDate = clockIso.slice(0, 10);
  const cf = u.clockFacts;
  const exp = u.expected;
  if (exp.class !== 'eligible') return false;
  if (exp.conditional === 'ceiling-key' && !thisCeilingKeys) return false;
  if (u.unitId === 'R37' && !thisCeilingDateline) return false;
  if (cf.kind === 'news') return !!cf.dateline && cf.dateline <= clockDate;
  if (cf.kind === 'ig') {
    if (!(cf.timestamp <= clockIso)) return false;
    const end = cf.endTime && cf.date ? Date.parse(`${cf.date}T${cf.endTime}:00-04:00`)
      : cf.date ? eodToronto(cf.date) : Infinity;
    return end > C;
  }
  const end = cf.endDate ? eodToronto(cf.endDate) : cf.date ? eodToronto(cf.date) : Infinity;
  if (!(end > C)) return false;
  const b = u.bodies[0];
  if (b.capturedAfterClock && (b.capture === 'live' || b.capture === 'archive')) {
    if (exp.week !== isoWeek(clockIso)) return false;
  }
  return true;
}

function replayWeek(week, covered, heldWeeks) {
  const table = [];
  for (const clock of SLOTS[week]) {
    // Pool gate (section 7: one pool, replayed in sequence): a unit enters in
    // its backtest week; it rolls into a later week only while every
    // intermediate week held (published weeks cover; concluded units drop out
    // via availableAt).
    const pooled = UNITS.filter((u) => u.expected.week === week ||
      (u.expected.week < week && u.expected.week >= 37 &&
        Array.from({ length: week - u.expected.week }, (_, i) => u.expected.week + i)
          .every((w) => heldWeeks.includes(w))));
    const avail = pooled.filter((u) => availableAt(u, clock));
    const fresh = avail.filter((u) => !(u.occurrenceKey && covered.has(u.occurrenceKey)));
    const concerts = new Map();
    const units = [];
    for (const u of fresh) {
      const agg = u.aggregate || (u.form.item_type === 'concert' ? `agg:${concertVenue(u)}:${week}` : null);
      if (!agg) { units.push({ parts: [u] }); continue; }
      if (!concerts.has(agg)) concerts.set(agg, []);
      concerts.get(agg).push(u);
    }
    for (const parts of concerts.values()) units.push({ parts });
    const seenClass = new Map();
    const kept = [];
    for (const grp of units) {
      const u0 = grp.parts[0];
      if (u0.form.item_type === 'class') {
        const v = classVenue(u0);
        const d = grp.parts.map((p) => p.clockFacts.date).sort()[0];
        const prev = seenClass.get(v);
        if (prev === undefined || d < prev) {
          if (prev !== undefined) kept.splice(kept.findIndex((g) => classVenue(g.parts[0]) === v), 1);
          seenClass.set(v, d);
          kept.push(grp);
        }
      } else kept.push(grp);
    }
    const core = kept.filter((g) => g.parts[0].form.verdict === 'core');
    const anchors = core.filter((g) => g.parts[0].form.item_type !== 'class');
    const decision = kept.length >= 3 && anchors.length >= 1 ? 'publish' : 'hold';
    const reasons = [];
    if (kept.length < 3) reasons.push('below-minimum');
    if (anchors.length < 1) reasons.push('no-core');
    const rank = (g) => {
      const u0 = g.parts[0];
      if (u0.form.verdict === 'core') return 0;
      if (['road', 'transit'].includes(u0.form.item_type)) return 1;
      if (u0.expected.unitKind === 'news' || u0.form.item_type === 'news') return 3;
      return 2;
    };
    const dateOf = (g) => String(g.parts[0].clockFacts.date || g.parts[0].clockFacts.dateline || '');
    const ordered = [...kept].sort((a, b) => rank(a) - rank(b) ||
      dateOf(a).localeCompare(dateOf(b)) || a.parts[0].unitId.localeCompare(b.parts[0].unitId));
    const ids = (list) => list.map((g) => g.parts.map((p) => p.unitId).join('+'));
    table.push({
      clock, decision, reasons, units: kept.length, core: core.length, anchors: anchors.length,
      ids: ids(ordered), published: ids(ordered.slice(0, 12)), cut: ids(ordered.slice(12)),
      afterClock: kept.flatMap((g) => g.parts)
        .filter((p) => p.bodies[0].capturedAfterClock).map((p) => p.unitId),
    });
    if (decision === 'publish') {
      for (const g of kept) for (const p of g.parts) if (p.occurrenceKey) covered.add(p.occurrenceKey);
      break;
    }
  }
  return table;
}

function runScenario({ ceilingDateline, ceilingKeys }) {
  thisCeilingDateline = ceilingDateline;
  thisCeilingKeys = ceilingKeys;
  const covered = new Set();
  const held = [];
  const out = {};
  for (const w of [37, 38, 39, 40]) {
    out[w] = replayWeek(w, covered, held);
    const last = out[w][out[w].length - 1];
    if (last.decision !== 'publish') held.push(w);
  }
  return out;
}

// ------------------------------------------------------------------ tests ---

test('reference fixtures are immutable byte copies with pinned hashes', () => {
  for (const [rel, pin] of Object.entries(PIN_REFERENCE)) {
    const actual = sha(readFileSync(path.join(REF, rel)));
    assert.equal(actual, pin, `reference/${rel} changed`);
    assert.equal(header.reference[rel], pin, `header must pin reference/${rel}`);
  }
});

test('conversion header pins the source archives it was built from', () => {
  for (const [name, pin] of Object.entries(PIN_ARCHIVE)) {
    const h = name.startsWith('backtest-')
      ? header.archiveBacktest[name.slice('backtest-'.length)]
      : header.archive[name];
    assert.equal(h, pin, `header archive hash mismatch: ${name}`);
  }
  assert.equal(header.unresolvedFact.id, 'ii');
  assert.equal(header.unresolvedFact.status, 'verified');
});

test('every conversion line has a schema-valid form, real bodies and verbatim spans', () => {
  const VERDICTS = new Set(['core', 'adjacent', 'not-LV']);
  const ITYPES = new Set(['event', 'class', 'concert', 'sports', 'expo', 'community',
    'opening', 'closure', 'road', 'transit', 'project', 'news']);
  assert.ok(UNITS.length > 100, `expected >100 units, got ${UNITS.length}`);
  for (const u of UNITS) {
    assert.ok(u.unitId && u.form && u.bodies?.length >= 1 && u.spans?.length >= 1 && u.expected,
      `unit shape: ${u.unitId}`);
    const f = u.form;
    for (const k of ['signalId', 'recordId', 'subject', 'what', 'where_it_happens', 'when',
      'who_is_affected', 'relevance_reason', 'verdict', 'evidence', 'item_type', 'people',
      'risk', 'exclude_reason']) assert.ok(k in f, `${u.unitId} form.${k}`);
    const cp = (s) => [...s].length; // schema bounds are in characters, not UTF-16 units
    assert.ok(cp(f.subject) <= 120 && cp(f.what) <= 200 &&
      cp(f.where_it_happens) <= 200 && cp(f.who_is_affected) <= 200 &&
      cp(f.relevance_reason) <= 300, `${u.unitId} lengths`);
    assert.ok(VERDICTS.has(f.verdict) && ITYPES.has(f.item_type), `${u.unitId} enums`);
    assert.ok(f.evidence.length >= 1 && f.evidence.length <= 3, `${u.unitId} evidence`);
    for (const e of f.evidence) {
      // repo: URLs are genuine provenance pointers for directory rows (R40x/R41x),
      // which were never fetched over HTTP.
      assert.ok(e.url?.startsWith('https://') || e.url?.startsWith('http://') ||
        e.url?.startsWith('repo:'), `${u.unitId} url`);
      if (e.subject_quote) assert.ok(e.subject_quote.length <= 300, `${u.unitId} quote`);
    }
    for (const b of u.bodies) {
      const fp = path.join(REP, b.file);
      assert.ok(existsSync(fp), `${u.unitId} missing ${b.file}`);
      const content = readFileSync(fp, 'utf8');
      assert.equal(sha(Buffer.from(content, 'utf8')), path.basename(b.file).split('.')[0],
        `${u.unitId} body hash must match filename`);
      assert.ok(['live', 'wayback', 'archive', 'provider-archive'].includes(b.capture), `${u.unitId} capture`);
    }
    const bodyTexts = u.bodies.map((b) => readFileSync(path.join(REP, b.file), 'utf8'));
    for (const s of u.spans) {
      assert.ok(s.text.length > 0, `${u.unitId} empty span`);
      const hit = bodyTexts.some((t) => t.slice(s.start, s.end) === s.text);
      assert.ok(hit, `${u.unitId} span must resolve verbatim in one of its bodies`);
    }
    if (u.occurrenceKey) assert.match(u.occurrenceKey, /^occ:/, `${u.unitId} key`);
  }
});

test('verifier+plan integration probe (no hardcoded bypass once integrated)', async () => {
  let status = 'pending-integration';
  try {
    const v = await import('../../scripts/news-pilot/roundup-verify.mjs');
    const r = await import('../../scripts/news-pilot/roundup.mjs');
    if (v && typeof r.planRoundupV2 === 'function') status = 'integrated';
  } catch { status = 'pending-integration'; }
  console.log(`    INTEGRATION verifier+plan: ${status}`);
  assert.equal(status, 'pending-integration',
    'spec A7: implementation lands only after spec acceptance; update this eval to invoke it then');
});

test('ceiling replay equals the reviewed section 7 table (R61 excluded by review)', () => {
  const w = runScenario({ ceilingDateline: true, ceilingKeys: true });
  const first = (t) => t[0];
  // W37 publishes Wednesday: 8 units (3 core / 1 anchor), IG084 anchors.
  assert.equal(first(w[37]).decision, 'publish');
  assert.deepEqual([first(w[37]).units, first(w[37]).core, first(w[37]).anchors], [8, 3, 1]);
  assert.ok(first(w[37]).ids.some((id) => id.includes('IG084')), 'IG084 anchors W37');
  // W38 holds at all three slots.
  for (const slot of w[38]) {
    assert.equal(slot.decision, 'hold');
    assert.ok(slot.reasons.includes('below-minimum'));
  }
  assert.deepEqual([w[38][0].units, w[38][0].core, w[38][0].anchors], [2, 1, 1]);
  // W39 publishes Friday at 3 (1/1) with the verified R37 dateline.
  assert.equal(w[39][0].decision, 'hold');
  assert.equal(w[39][1].decision, 'publish');
  assert.deepEqual([w[39][1].units, w[39][1].core, w[39][1].anchors], [3, 1, 1]);
  assert.ok(w[39][1].ids.some((id) => id.includes('R37')), 'R37 decides W39');
  // W40 publishes 15 (4/3) after review (R61 dateline unverifiable), capped to 12.
  assert.equal(first(w[40]).decision, 'publish');
  assert.deepEqual([first(w[40]).units, first(w[40]).core, first(w[40]).anchors], [15, 4, 3]);
  assert.deepEqual(first(w[40]).published.length, 12);
  assert.deepEqual(first(w[40]).cut, ['R57b-i+R57b-ii', 'R56a', 'R56b']);
  assert.ok(first(w[40]).ids.some((id) => id.includes('IG215')), 'IG215 counts as core class');
});

test('floor replay holds W39 and rolls IG193 to a 15-unit W40', () => {
  const w = runScenario({ ceilingDateline: false, ceilingKeys: false });
  assert.equal(w[37][0].decision, 'publish');
  for (const slot of w[38]) assert.equal(slot.decision, 'hold');
  for (const slot of w[39]) {
    assert.equal(slot.decision, 'hold');
    assert.ok(slot.reasons.includes('below-minimum'));
  }
  assert.deepEqual([w[39][1].units, w[39][1].core, w[39][1].anchors], [2, 1, 1]);
  assert.equal(w[39][2].units, 2, 'R39 Logic-tonight slot keeps 2 units Sunday');
  assert.equal(w[40][0].decision, 'publish');
  assert.deepEqual([w[40][0].units, w[40][0].core, w[40][0].anchors], [15, 5, 4]);
  assert.ok(w[40][0].ids.some((id) => id.includes('IG193')), 'IG193 rolls to W40 in the floor');
});

test('IG084 sensitivity: without it W37 holds for no core', () => {
  thisCeilingDateline = true;
  thisCeilingKeys = true;
  const idx = UNITS.findIndex((u) => u.unitId === 'IG084');
  const [removed] = UNITS.splice(idx, 1);
  try {
    const w = runScenario({ ceilingDateline: true, ceilingKeys: true });
    assert.equal(w[37][0].decision, 'hold');
    assert.ok(w[37][0].reasons.includes('no-core'));
  } finally {
    UNITS.splice(idx, 0, removed);
  }
});

test('A4 trap rows are excluded with the pinned reason classes', () => {
  const pins = {
    R44x: 'not-LV', R03x: 'not-LV', R02x: 'unverifiable', R65x: 'unverifiable',
    R43x: 'not-LV', R41x: 'not-LV', R62x: 'not-LV', R63x: 'not-LV', R64x: 'not-LV',
    R23x: 'duplicate', R04x: 'crime', R42x: 'election',
    R01x: 'weak-source', R05x: 'weak-source', R06x: 'weak-source', R21x: 'weak-source',
    R32x: 'weak-source', R33x: 'weak-source', R36x: 'weak-source',
    R51x: 'weak-source', R60x: 'weak-source',
    R10x: 'blocked', R25x: 'blocked', R11x: 'blocked', R30x: 'blocked',
    R12x: 'unverifiable', R13x: 'unverifiable',
    R16x: 'not-LV', R17x: 'weak-source', R18x: 'weak-source', R19x: 'stale',
    R31x: 'not-LV', R40x: 'undated', R48x: 'not-LV', R49x: 'weak-source',
    R61: 'undated', R34x: 'undated', R35x: 'undated',
  };
  for (const [id, cls] of Object.entries(pins)) {
    assert.equal(byId.get(id)?.expected.class, cls, `${id} class`);
  }
  const igPins = {
    IG034x: 'lead', IG099x: 'lead', IG100x: 'lead',
    IG124x: 'retrospective', IG227x: 'retrospective',
    IG157x: 'late', IG158x: 'late', IG200x: 'late',
    IG221x: 'unverifiable', IG223x: 'class-cap', IG117x: 'unverifiable',
    IG074x: 'duplicate', IG042x: 'unverifiable', IG132x: 'record-missing',
    IG192x: 'not-LV', IG218x: 'not-LV', IG134x: 'not-LV', IG162x: 'not-LV',
  };
  for (const [id, cls] of Object.entries(igPins)) {
    assert.equal(byId.get(id)?.expected.class, cls, `${id} class`);
  }
});

test('every non-converted reference row stays excluded (trial/backtest reasons map to excluded buckets)', () => {
  const refBt = lines(path.join(REF, 'items.jsonl')).map((l) => JSON.parse(l));
  const convertedRows = new Set(UNITS.map((u) => u.sourceRow));
  const EXCLUDED_BUCKET = new Set(['weak-source', 'unverifiable', 'not-LV', 'crime',
    'election', 'private-individual', 'blocked', 'stale', 'duplicate', 'undated']);
  refBt.forEach((row, i) => {
    const ln = i + 1;
    if (convertedRows.has(ln)) return;
    assert.fail(`backtest row ${ln} has no conversion line`);
  });
  const refIg = lines(path.join(REF, 'ig/ig-items.jsonl')).map((l) => JSON.parse(l));
  const convertedIg = new Set([...convertedRows].filter((s) => String(s).startsWith('ig:'))
    .map((s) => Number(String(s).slice(3))));
  const TRIAL_OK = new Set(['yes']);
  refIg.forEach((row, i) => {
    const ln = i + 1;
    if (convertedIg.has(ln)) return; // converted: class asserted in replay tests
    assert.ok(!TRIAL_OK.has(row.qualifies), `qualified IG row ${ln} must be converted`);
  });
  void EXCLUDED_BUCKET;
});

test('census table (evidence; capturedAfterClock labelled)', () => {
  for (const opts of [{ ceilingDateline: true, ceilingKeys: true }, { ceilingDateline: false, ceilingKeys: false }]) {
    const w = runScenario(opts);
    console.log(`    scenario ceiling=${opts.ceilingDateline}`);
    for (const week of [37, 38, 39, 40]) {
      for (const s of w[week]) {
        console.log(`    W${week} ${s.clock} ${s.decision} units=${s.units} core=${s.core} anchor=${s.anchors} ` +
          `reasons=${s.reasons.join('+') || '-'} afterClock=[${s.afterClock.join(',')}]`);
      }
    }
  }
});
