// Roundup v2 backtest replay eval (docs/specs/weekly-roundup-v2.md sections 7, A4).
//
// No model calls, no network. Replays the archived September 2026 backtest +
// Instagram trial through the REAL product stack — verifyRoundupForms,
// planRoundupV2, roundup-geo.mjs classifiers, ROUNDUP_SOURCES and
// ROUNDUP_PUBLISHER_TIERS — resolved from the product directory itself, so
// the verifier's own relative imports (geo, records, sources) load product
// code, never eval doubles. RV_PRODUCT_DIR overrides the product directory
// for validation runs against another checkout; it defaults to this repo's
// scripts/news-pilot. Test-scope seams that remain:
//   - fetcher: serves the frozen captured bodies by URL (403 for walled,
//     404 for truncated rows — the backtest's own verdicts). Pinned bytes,
//     no network, deterministic;
//   - recordExtractor (TEMPORARY seam, see replay/REVIEW.md): returns the
//     reviewed record for a recordId because most frozen bodies are
//     tag-stripped fragments the real extractor cannot segment. Record TEXT
//     always comes from the body files. R59 rows already carry product
//     rid() recordIds verified byte-identical against the live page;
//   - signal.post: pinned trial provider rows (shortcode, caption,
//     timestamp, owner) for ig-post sources.
//
// Every exclusion reason below is produced by the verifier, never asserted
// from the fixture. The fixture's expected.class is the reviewed label; where
// the real reason differs it is reported, not hidden. Nothing here forces a
// table: pins assert observed product behavior, and honest divergences from
// the printed spec table are recorded in replay/REVIEW.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Product directory: this repo's scripts/news-pilot by default; override for
// validation runs against another checkout (which must contain the full
// stack: verify, plan, geo, records, sources, data).
const PROD = process.env.RV_PRODUCT_DIR || path.join(ROOT, 'scripts', 'news-pilot');
const prodMod = (name) => import(pathToFileURL(path.join(PROD, name)).href);
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
assert.equal(header.kind, 'header');
const UNITS = lines(path.join(REP, 'conversion.jsonl')).slice(1).map((l) => JSON.parse(l));
const byId = new Map(UNITS.map((u) => [u.unitId, u]));

// Body text: .json files holding a JSON string decode losslessly (trailing
// whitespace preserved); every other body file is used as raw text.
function bodyTextOf(rel) {
  const raw = readFileSync(path.join(REP, rel), 'utf8');
  if (rel.endsWith('.json')) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed;
    } catch { /* record object: fall through to raw */ }
  }
  return raw;
}

// ------------------------------------------------------- harness (real path) ---
// Maps each conversion unit to its product registry source id. The registry
// itself (fields, tiers, watch list) always comes from the product directory.
// Discovery rows go through rv2-serper-news; dropped sources (reddit) are
// intentionally unregistered so the verifier fails them closed. Enercare
// rows use rv2-explace: the registry covers Enercare Centre as a building
// alias of Exhibition Place (venueAliases), registered at the final URL.
function sourceIdFor(u) {
  const id = u.unitId;
  if (/^(R07|R22|R38)/.test(id)) return 'rv2-coliseum';
  if (/^(R55|R56)/.test(id)) return 'rv2-bmo-field';
  if (/^R57/.test(id)) return 'rv2-coliseum';
  if (/^(R08|R24|R39|R58)/.test(id)) return 'rv2-rbc-amphitheatre';
  if (/^(R09|R52|R53|R54|R62x|R63x|R64x)/.test(id)) return 'rv2-road-restrictions';
  if (id === 'R20') return 'rv2-lv-bia-events';
  if (id === 'R50') return 'rv2-city-project-34-hanna-park';
  if (id === 'R37') return 'rv2-serper-news';
  if (/^R59/.test(id)) return 'rv2-explace';
  if (id.startsWith('IG')) {
    const code = (u.bodies[0].url.match(/\/p\/([^/]+)\//) || [])[1] || '';
    return `ig:${(u.clockFacts.owner || '').toLowerCase()}`;
  }
  if (/^R(17|18|19|49)x$/.test(id)) return 'rv2-reddit-dropped';
  return 'rv2-serper-news';
}

const shortCodeOf = (u) => (u.bodies[0].url.match(/\/p\/([^/]+)\//) || [])[1] || '';

// Records keyed by recordId; TEXT always comes from the body files at
// runtime. Typed feed/JSON-LD fields are parsed from that same text.
const RECORDS = new Map();
const URL_RECORDS = new Map();
const URL_TEXT = new Map();
// Keyed by the form's evidence URL (the canonical source URL per F2), not by
// the capture URL in bodies[] (which may be a Wayback snapshot for provenance).
const EVIDENCE_URL = new Map(UNITS.map((u) => [u.unitId, u.form.evidence[0].url]));
for (const u of UNITS) {
  for (const b of u.bodies) {
    const text = bodyTextOf(b.file);
    const key = EVIDENCE_URL.get(u.unitId);
    URL_TEXT.set(key, (URL_TEXT.get(key) || '') + (URL_TEXT.has(key) ? '\n' : '') + text);
  }
}
for (const u of UNITS) {
  const text = bodyTextOf(u.bodies[0].file);
  let typed = {};
  const kind = u.clockFacts.kind;
  if (kind === 'feed' || kind === 'listing-jsonld') {
    try { typed = JSON.parse(text); } catch { typed = {}; }
    // The live feed serves epoch millis as strings; the collector coerces
    // them to numbers (dayOf/torontoInstant require numeric input) and
    // derives the ISO end day the line-298 check reads.
    for (const k of ['startTime', 'endTime', 'lastUpdated', 'createdTime']) {
      if (typed[k] != null && !Number.isNaN(Number(typed[k]))) typed[k] = Number(typed[k]);
    }
    if (Number.isFinite(typed.endTime)) {
      typed.endDate = new Date(typed.endTime).toISOString().slice(0, 10);
    }
  } else if (u.form.item_type === 'concert' || u.form.item_type === 'sports' || u.form.item_type === 'expo') {
    // Listing rows belong to their venue page by construction; bind the
    // record to the source URL (the row text itself rarely names the venue).
    typed = { pageUrl: EVIDENCE_URL.get(u.unitId) };
  }
  for (const s of u.spans) {
    if (!RECORDS.has(s.recordId)) {
      RECORDS.set(s.recordId, { recordId: s.recordId, text, typed });
      const key = EVIDENCE_URL.get(u.unitId);
      const arr = URL_RECORDS.get(key) || [];
      arr.push(RECORDS.get(s.recordId));
      URL_RECORDS.set(key, arr);
    }
  }
  if (!u.spans.length) {
    const rid = `${u.unitId}-record`;
    RECORDS.set(rid, { recordId: rid, text, typed });
  }
}
const recordExtractor = ({ url }) => URL_RECORDS.get(url) || [];

const BLOCKED = new Set(UNITS.filter((u) => u.expected.class === 'unverifiable' &&
  ['R10x', 'R11x', 'R25x', 'R30x'].includes(u.unitId)).map((u) => EVIDENCE_URL.get(u.unitId)));
const GONE = new Set(['R12x', 'R13x'].map((id) => EVIDENCE_URL.get(id)).filter(Boolean));
const fetcher = async (url) => {
  if (BLOCKED.has(url)) return { status: 403 };
  if (GONE.has(url)) return { status: 404 };
  if (URL_TEXT.has(url)) return { body: URL_TEXT.get(url), status: 200 };
  return { status: 404 };
};

function buildInputs(units, { floorR37 = false } = {}) {
  const signals = [], forms = [];
  for (const u of units) {
    const form = JSON.parse(JSON.stringify(u.form));
    if (u.unitId === 'R37' && floorR37) {
      // Floor models fact (ii) unknown: no dateline, no date.
      form.when = { ...form.when, date: null, startTime: null, endTime: null };
      form.evidence = form.evidence.map((e) => ({ ...e, date_quote: null }));
    }
    // Excluded rows carry the reviewer's label; clearing it here tests the
    // verifier's independent judgment (with it set they fail not-news
    // by construction).
    form.exclude_reason = null;
    const url = EVIDENCE_URL.get(u.unitId);
    const recs = (URL_RECORDS.get(url) || []).filter((r) =>
      u.spans.some((s) => s.recordId === r.recordId));
    const signal = { signalId: form.signalId, sourceId: sourceIdFor(u), url,
      records: recs.map((r) => ({ recordId: r.recordId, typed: r.typed })) };
    if (u.clockFacts.kind === 'ig') {
      signal.post = { shortcode: shortCodeOf(u), caption: bodyTextOf(u.bodies[0].file),
        timestamp: u.clockFacts.timestamp, ownerUsername: u.clockFacts.owner };
    }
    signals.push(signal);
    forms.push(form);
  }
  return { signals, forms };
}

const SLOTS = {
  37: ['2026-09-09T16:00:00Z', '2026-09-11T16:00:00Z', '2026-09-13T16:00:00Z'],
  38: ['2026-09-16T16:00:00Z', '2026-09-18T16:00:00Z', '2026-09-20T16:00:00Z'],
  39: ['2026-09-23T16:00:00Z', '2026-09-25T16:00:00Z', '2026-09-27T16:00:00Z'],
  40: ['2026-09-29T15:00:00Z'],
};

// Pool model: each trial row belongs to exactly one backtest week, its
// evidence week (A4 capture-time availability guard, owner-approved over
// the record-metadata alternative, which would publish W38/W39 early). A
// week's pool is that week's rows only; the product's coverage (published
// keys via posts) is the sole cross-week state. An earlier held-roll
// re-presentation was a harness invention that inflated W38 to publish
// (R22a/R22c rolling in); it is removed — see REVIEW.md.
function gatePass(u, week) {
  return u.expected.week === week;
}

async function runRealScenario(verify, plan, { floorR37 }) {
  const weeks = {};
  const posts = [];
  for (const week of [37, 38, 39, 40]) {
    weeks[week] = [];
    for (const clock of SLOTS[week]) {
      const pool = UNITS.filter((u) => gatePass(u, week));
      const { signals, forms } = buildInputs(pool, { floorR37 });
      const result = await verify({ signals, forms, now: clock, posts,
        fetcher, recordExtractor });
      const p = plan(result.items, { now: clock, posts });
      const ids = p.countedItems.map((i) => i.subject);
      weeks[week].push({ clock, decision: p.decision, reasons: p.reasons,
        units: p.units, core: p.coreUnits, anchors: p.coreAnchorUnits,
        ids, keys: p.countedItems.map((i) => i.identityKey),
        cut: p.excluded.filter((e) => e.reason === 'cap').map((e) => e.item.subject),
        still: p.stillInEffect.map((i) => i.subject),
        excluded: p.excluded.map((e) => ({ subject: e.item.subject, reason: e.reason })),
        verifyExcluded: result.excluded, digest: result.verifyDigest });
      if (p.decision === 'publish') {
        posts.push({ roundupCoverage: { version: 1, isoWeek: p.isoWeek,
          planningCutoff: clock,
          keys: [...new Set([...p.countedItems.flatMap((i) => i.keys),
            ...p.stillInEffect.map((i) => i.identityKey)])] } });
        break;
      }
    }
  }
  return weeks;
}

// ------------------------------------------------------------------ tests ---
const V = await (async () => {
  try {
    const v = await prodMod('roundup-verify.mjs');
    const r = await prodMod('roundup.mjs');
    const e = await prodMod('roundup-evidence.mjs');
    await prodMod('roundup-geo.mjs');
    await prodMod('roundup-records.mjs');
    if (typeof v.verifyRoundupForms === 'function' && typeof r.planRoundupV2 === 'function' &&
      typeof e.roundupSourceQuality === 'function' && typeof r.roundupCoveredKeys === 'function') {
      console.log(`    product stack: ${PROD}`);
      return { integrated: true, verify: v.verifyRoundupForms, plan: r.planRoundupV2,
        quality: e.roundupSourceQuality, covered: r.roundupCoveredKeys, dir: PROD };
    }
  } catch { /* not integrated: REAL tests fail below, no surrogate */ }
  return { integrated: false };
})();

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
  const cp = (s) => [...s].length;
  for (const u of UNITS) {
    assert.ok(u.unitId && u.form && u.bodies?.length >= 1 && u.spans?.length >= 1 && u.expected,
      `unit shape: ${u.unitId}`);
    const f = u.form;
    for (const k of ['signalId', 'recordId', 'subject', 'what', 'where_it_happens', 'when',
      'who_is_affected', 'relevance_reason', 'verdict', 'evidence', 'item_type', 'people',
      'risk', 'exclude_reason']) assert.ok(k in f, `${u.unitId} form.${k}`);
    assert.ok(cp(f.subject) <= 120 && cp(f.what) <= 200 && cp(f.where_it_happens) <= 200 &&
      cp(f.who_is_affected) <= 200 && cp(f.relevance_reason) <= 300, `${u.unitId} lengths`);
    assert.ok(VERDICTS.has(f.verdict) && ITYPES.has(f.item_type), `${u.unitId} enums`);
    assert.ok(f.evidence.length >= 1 && f.evidence.length <= 3, `${u.unitId} evidence`);
    for (const e of f.evidence) {
      assert.ok(e.url?.startsWith('https://') || e.url?.startsWith('http://') ||
        e.url?.startsWith('repo:'), `${u.unitId} url`);
      for (const [qk, lim] of [['subject_quote', 300], ['place_quote', 300], ['date_quote', 200]]) {
        if (e[qk] != null) assert.ok([...e[qk]].length <= lim, `${u.unitId} ${qk}`);
      }
    }
    const texts = u.bodies.map((b) => bodyTextOf(b.file));
    for (const b of u.bodies) {
      const fp = path.join(REP, b.file);
      assert.ok(existsSync(fp), `${u.unitId} missing ${b.file}`);
      assert.equal(sha(readFileSync(fp)), path.basename(b.file).split('.')[0],
        `${u.unitId} body hash must match filename`);
      assert.ok(['live', 'wayback', 'archive', 'provider-archive'].includes(b.capture), `${u.unitId} capture`);
    }
    for (const s of u.spans) {
      assert.ok(s.text.length > 0, `${u.unitId} empty span`);
      assert.ok(texts.some((t) => t.slice(s.start, s.end) === s.text),
        `${u.unitId} span must resolve verbatim in one of its bodies`);
    }
    if (u.occurrenceKey) assert.match(u.occurrenceKey, /^(occ:|road:|news:)/, `${u.unitId} key`);
  }
});

test('A4 trap rows carry the reviewed reason classes', () => {
  const pins = {
    R44x: 'not-LV', R03x: 'not-LV', R02x: 'unverifiable', R65x: 'unverifiable',
    R43x: 'not-LV', R41x: 'not-LV', R62x: 'not-LV', R63x: 'not-LV', R64x: 'not-LV',
    R23x: 'duplicate', R04x: 'risky', R42x: 'risky',
    R01x: 'weak-source', R05x: 'weak-source', R06x: 'weak-source', R21x: 'weak-source',
    R32x: 'weak-source', R33x: 'weak-source', R36x: 'weak-source',
    R51x: 'weak-source', R60x: 'weak-source',
    R10x: 'unverifiable', R25x: 'unverifiable', R11x: 'unverifiable', R30x: 'unverifiable',
    R12x: 'unverifiable', R13x: 'unverifiable',
    R16x: 'not-LV', R17x: 'weak-source', R18x: 'weak-source', R19x: 'stale',
    R31x: 'not-LV', R40x: 'undated', R48x: 'not-LV', R49x: 'weak-source',
    R61: 'undated', R34x: 'undated', R35x: 'undated', R59c: 'eligible',
  };
  for (const [id, cls] of Object.entries(pins)) {
    assert.equal(byId.get(id)?.expected.class, cls, `${id} class`);
  }
  const igPins = {
    IG034x: 'lead', IG099x: 'lead', IG100x: 'lead',
    IG124x: 'retrospective', IG227x: 'retrospective',
    IG157x: 'unverifiable', IG158x: 'concluded', IG200x: 'concluded',
    IG221x: 'unverifiable', IG223x: 'class-cap', IG117x: 'unverifiable',
    IG074x: 'duplicate-ambiguous', IG042x: 'unverifiable', IG132x: 'record-missing',
    IG192x: 'not-LV', IG218x: 'not-LV', IG134x: 'not-LV', IG162x: 'not-LV',
    IG001x: 'stale',
  };
  for (const [id, cls] of Object.entries(igPins)) {
    assert.equal(byId.get(id)?.expected.class, cls, `${id} class`);
  }
});

if (V.integrated) {
  test('REAL replay: ceiling table from verifyRoundupForms+planRoundupV2', async () => {
    // Honest table on the integrated stack (no forcing): the trial IG
    // captions lack the Toronto context and bindable venue spans the
    // product requires (U1/U3), the RBC JSON-LD writes one-word
    // 'Lakeshore', and the watch list lacks deltatrainlv — so W37 has no
    // anchor, W39 is empty, and R20/R50/IG214 carry W38/W40.
    const w = await runRealScenario(V.verify, V.plan, { floorR37: false });
    const first = (t) => t[0];
    for (const slot of w[37]) {
      assert.equal(slot.decision, 'hold');
      assert.ok(slot.reasons.includes('no-core'));
    }
    assert.deepEqual([first(w[37]).units, first(w[37]).core, first(w[37]).anchors], [5, 1, 0]);
    // W38 holds below-minimum at every slot: single-week pools admit only
    // W38 evidence (R20 + Tove Lo). The earlier publish was a harness
    // artifact of rolling W37's Tempo games forward.
    for (const slot of w[38]) {
      assert.equal(slot.decision, 'hold');
      assert.ok(slot.reasons.includes('below-minimum'));
    }
    assert.deepEqual([first(w[38]).units, first(w[38]).core, first(w[38]).anchors], [2, 1, 1]);
    assert.ok(first(w[38]).ids.includes('Give Me Liberty'), 'R20 anchors W38');
    // IG117's caption states the Lamport lot but carries no Toronto
    // context, so it fails at verify under the U1 rule (like IG084) and
    // never reaches the venue-day tiebreak against R20.
    const ig117sig = byId.get('IG117x').form.signalId;
    assert.ok(first(w[38]).verifyExcluded.some((e) => e.signalId === ig117sig &&
      e.reason === 'unverifiable'), 'IG117 unverifiable (U1 Toronto context)');
    // W39 is empty in both scenarios: the RBC rows fail on the 'Lakeshore'
    // spelling, R37's DD/MM/YYYY dateline is outside the record grammar
    // (plus the frozen revision post-dates the clock), and IG193 fails on
    // the NRG alias gap.
    for (const slot of w[39]) {
      assert.equal(slot.decision, 'hold');
      assert.deepEqual([slot.units, slot.core, slot.anchors], [0, 0, 0]);
    }
    const r37sig = byId.get('R37').form.signalId;
    for (const slot of w[39]) assert.ok(slot.verifyExcluded.some((e) =>
      e.signalId === r37sig && e.reason === 'undated'), 'R37 undated in ceiling too');
    // IG193 never verifies; the recorded reason is clock-relative (NRG
    // alias gap at Wed, day-first date grammar at Fri/Sun).
    const ig193sig = byId.get('IG193').form.signalId;
    assert.ok(w[39][0].verifyExcluded.some((e) =>
      e.signalId === ig193sig && e.reason === 'unverifiable'), 'IG193 Wed unverifiable');
    for (const slot of w[39].slice(1)) assert.ok(slot.verifyExcluded.some((e) =>
      e.signalId === ig193sig && e.reason === 'undated'), 'IG193 Fri/Sun undated');
    assert.equal(first(w[40]).decision, 'publish');
    assert.deepEqual([first(w[40]).units, first(w[40]).core, first(w[40]).anchors], [12, 3, 3]);
    assert.deepEqual(first(w[40]).cut, [], 'no cap cut at 12');
    assert.ok(first(w[40]).ids.includes(byId.get('IG214').form.subject), 'IG214 anchors W40');
    assert.ok(first(w[40]).ids.includes('Open House'), 'R50 anchors W40');
    // R59c verifies solo but shares R59b's venue-day with a different
    // subject, so the planner holds it duplicate-ambiguous (F3 resolved by
    // mechanism, not by label).
    assert.ok(first(w[40]).excluded.some((e) => e.subject.includes('Baby Show') &&
      e.reason === 'duplicate-ambiguous'), 'R59c held as ambiguous vs R59b');
  });

  test('REAL replay: floor holds W39 and publishes W40 without R37', async () => {
    // R37 is undated-by-construction in both scenarios, so floor and
    // ceiling agree exactly (identical digests in the census run).
    const w = await runRealScenario(V.verify, V.plan, { floorR37: true });
    for (const slot of w[37]) assert.equal(slot.decision, 'hold');
    for (const slot of w[38]) assert.equal(slot.decision, 'hold');
    assert.deepEqual([w[38][0].units, w[38][0].core, w[38][0].anchors], [2, 1, 1]);
    for (const slot of w[39]) {
      assert.equal(slot.decision, 'hold');
      assert.deepEqual([slot.units, slot.core, slot.anchors], [0, 0, 0]);
    }
    assert.equal(w[40][0].decision, 'publish');
    assert.deepEqual([w[40][0].units, w[40][0].core, w[40][0].anchors], [12, 3, 3]);
  });

  test('REAL planner names covered roads still in effect (product pattern)', async () => {
    // Mirrors the product's own plan test: items verified against older posts
    // are re-planned against current coverage. R09 verifies post-free, then
    // the W37 coverage post moves it to stillInEffect (road, active).
    const u = byId.get('R09');
    const r = await V.verify({ ...buildInputs([u]), now: SLOTS[38][0], posts: [],
      fetcher, recordExtractor });
    assert.equal(r.items.length, 1, 'R09 verifies post-free');
    const post = { roundupCoverage: { version: 1, isoWeek: 37,
      planningCutoff: SLOTS[37][0], keys: [r.items[0].identityKey] } };
    const p = V.plan(r.items, { now: SLOTS[38][0], posts: [post] });
    assert.ok(p.stillInEffect.some((i) => i.subject === u.form.subject), 'R09 still in effect');
    assert.ok(p.excluded.some((e) => e.reason === 'previously-covered'), 'covered drop recorded');
  });

  test('REAL harness integrity: the census follows the injected verifier, not the fixtures', async () => {
    assert.equal(V.verify.name, 'verifyRoundupForms', 'real verifier wired');
    assert.equal(V.plan.name, 'planRoundupV2', 'real planner wired');
    // GREEN with the product verifier+planner (honest table, not the
    // printed spec table: W37 holds for no core on the integrated stack).
    const green = await runRealScenario(V.verify, V.plan, { floorR37: false });
    assert.equal(green[37][0].decision, 'hold');
    assert.deepEqual([green[37][0].units, green[37][0].core, green[37][0].anchors], [5, 1, 0]);
    // RED-1: a verifier that returns nothing empties W37 (0 units vs 5).
    const emptyVerify = async () => ({ items: [], excluded: [], verifyDigest: 'empty-stub' });
    const red1 = await runRealScenario(emptyVerify, V.plan, { floorR37: false });
    assert.equal(red1[37][0].digest, 'empty-stub', 'empty stub really ran');
    assert.equal(red1[37][0].units, 0, 'empty verifier admits nothing');
    assert.ok(red1[37][0].reasons.includes('no-core'));
    // RED-2: an evidence-blind mock admitting every form as core publishes
    // the held weeks. If the eval read expectations off the fixtures, the
    // mock would still print the pinned table; instead the holds flip.
    const acceptAll = async ({ forms }) => ({
      items: forms.map((f) => ({ subject: f.subject, identityKey: 'stub:' + f.signalId,
        keys: ['stub:' + f.signalId], locality: 'core', verdict: 'core', item_type: 'event',
        when: { date: '2026-09-16', kind: 'event' }, active: true, tier: 'official' })),
      excluded: [], verifyDigest: 'accept-stub',
    });
    const red2 = await runRealScenario(acceptAll, V.plan, { floorR37: false });
    assert.equal(red2[38][0].digest, 'accept-stub', 'mock really ran');
    assert.equal(red2[38][0].decision, 'publish', 'evidence-blind mock publishes held weeks');
    assert.equal(red2[39][0].decision, 'publish', 'evidence-blind mock publishes held weeks');
  });

  test('REAL planner drops the ambiguous duplicate and aggregates concerts', async () => {
    const w = await runRealScenario(V.verify, V.plan, { floorR37: false });
    const w40drop = w[40][0].excluded;
    assert.ok(w40drop.some((e) => e.reason === 'duplicate-ambiguous' &&
      e.subject.includes('Baby Show')), `R59c dropped: ${JSON.stringify(w40drop)}`);
    assert.ok(w40drop.some((e) => e.reason === 'concert-aggregate'),
      `concert parts aggregated: ${JSON.stringify(w40drop)}`);
    assert.ok(w[37][0].excluded.some((e) => e.reason === 'concert-aggregate'),
      'W37 concert parts aggregated');
  });

  test('REAL sensitivity: W37 holds for no core with or without IG084', async () => {
    // The spec's sensitivity scenario assumed the Eco-Fair posts anchor.
    // Under the product's U1/U3 rules neither IG084 (no Toronto context in
    // caption) nor IG074 (no relation marker) verifies, so W37 holds
    // without them too — removing IG084 only shrinks the pool 5 to 4.
    const pool37 = UNITS.filter((u) => gatePass(u, 37));
    const run = async (drop) => {
      const keep = pool37.filter((u) => !drop.includes(u.unitId));
      const { signals, forms } = buildInputs(keep);
      const clock = SLOTS[37][0];
      const result = await V.verify({ signals, forms, now: clock, posts: [],
        fetcher, recordExtractor });
      return V.plan(result.items, { now: clock, posts: [] });
    };
    const a = await run([]);
    assert.equal(a.decision, 'hold');
    assert.ok(a.reasons.includes('no-core'));
    assert.equal(a.units, 5);
    const b = await run(['IG084']);
    assert.equal(b.decision, 'hold');
    assert.ok(b.reasons.includes('no-core'));
    assert.deepEqual(b.countedItems.map((i) => i.subject), a.countedItems.map((i) => i.subject),
      'IG084 never verifies, so removing it changes nothing');
  });

  test('REAL negative controls: exact verifier reasons where deterministic', async () => {
    // Discovery rows can never reach the tier check (dateFromRecord returns
    // null for news-discovery), so their real reasons are date/identity
    // outcomes; the weak-source substance is covered by the predicate test.
    const controls = [
      ['R05x', '2026-09-10T16:00:00Z', 'undated'],
      ['R06x', '2026-09-12T16:00:00Z', 'undated'],
      ['R36x', '2026-09-27T12:00:00Z', 'undated'],
      ['R04x', '2026-09-09T16:00:00Z', 'unverifiable'],
      ['R02x', '2026-09-13T16:00:00Z', 'unverifiable'],
      ['R61', '2026-09-29T15:00:00Z', 'unverifiable'],  // no place evidence: identity precedes temporal; 'undated' unreachable
      ['IG221x', '2026-09-29T15:00:00Z', 'unverifiable'],
      ['IG117x', '2026-09-16T16:00:00Z', 'unverifiable'],
      ['IG042x', '2026-09-09T16:00:00Z', 'source-swapped'],
      ['IG124x', '2026-09-16T16:00:00Z', 'retrospective'],
      ['IG227x', '2026-09-29T15:00:00Z', 'unverifiable'],  // recap but venue-free caption + multi-location: no identity, no fallback
      ['IG158x', '2026-09-20T16:00:00Z', 'unverifiable'],  // quest multi-location: no fallback without quotable place
      ['IG200x', '2026-09-27T16:00:00Z', 'unverifiable'],  // deltatrainlv absent from product watch list (registry gap)
      ['R10x', '2026-09-09T16:00:00Z', 'unverifiable'],
      ['R12x', '2026-09-09T16:00:00Z', 'record-missing'],
    ];
    for (const [id, clock, reason] of controls) {
      const { signals, forms } = buildInputs([byId.get(id)]);
      const r = await V.verify({ signals, forms, now: clock, posts: [],
        fetcher, recordExtractor });
      assert.equal(r.items.length, 0, `${id} must not verify`);
      assert.equal(r.excluded[0]?.reason, reason, `${id} real reason`);
    }
  });

  test('REAL source-quality predicate on fixture evidence tiers', () => {
    const entry = (tier, domain) => ({ itemBound: true, extractionSubstantive: true, fetchOk: true, tier, publisherDomain: domain });
    assert.equal(V.quality([entry('official', 'canadasoccer.com')]), true);
    assert.equal(V.quality([entry('primary', 'nrghaus.com')]), true);
    assert.equal(V.quality([entry('lead', 'blogto.com')]), false);
    assert.equal(V.quality([entry('reputable', 'thestar.com')]), false);
    assert.equal(V.quality([entry('lead', 'blogto.com'), entry('lead', 'cbc.ca')]), true);
  });

  test('REAL census table (evidence)', async () => {
    for (const floorR37 of [false, true]) {
      const w = await runRealScenario(V.verify, V.plan, { floorR37 });
      console.log(`    scenario ceiling=${!floorR37} (real verifier+planner)`);
      for (const week of [37, 38, 39, 40]) {
        for (const s of w[week]) {
          console.log(`    W${week} ${s.clock} ${s.decision} units=${s.units} core=${s.core} anchor=${s.anchors} ` +
            `reasons=${s.reasons.join('+') || '-'} digest=${s.digest.slice(0, 12)}`);
        }
      }
    }
  });
}

// No surrogate: without the full product stack every REAL test below is
// skipped by its guard, so this gate fails loudly instead of passing.
test('product stack present (no surrogate)', () => {
  assert.ok(V.integrated, `real product stack absent in ${PROD} (needs verify/plan/evidence/geo/records)`);
});
