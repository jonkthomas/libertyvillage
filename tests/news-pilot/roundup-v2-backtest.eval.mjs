// Roundup v2 backtest replay eval (docs/specs/weekly-roundup-v2.md sections 7, A4).
//
// No model calls, no network. Replays the archived September 2026 backtest +
// Instagram trial through the REAL product stack — verifyRoundupForms (with
// its own production roundup-records.mjs extractor; NO recordExtractor is
// injected), planRoundupV2, roundup-geo.mjs, ROUNDUP_SOURCES and
// ROUNDUP_PUBLISHER_TIERS — resolved from the product directory itself.
// RV_PRODUCT_DIR overrides the product directory for validation runs against
// another checkout; it defaults to this repo's scripts/news-pilot.
//
// Offline inputs only (the seams a replay cannot avoid):
//   - fetcher: read-only; serves the committed FULL raw capture of a URL that
//     the §7 availability rule selects for the clock (replay/captures.json),
//     or a unit's frozen fragment for rows that were never fully captured
//     (labelled `fragment`; negative controls only), or the backtest's own
//     403/404 verdicts for walled/truncated rows. Never concatenates bodies;
//   - signal.post: the archived Instagram provider row (ig-posts.jsonl: raw
//     caption with line breaks, timestamp, owner, shortcode);
//   - signal.records: the collection-time records the production extractor
//     emits for the served body, restricted to reference-row records (§7).
//
// Availability is §7's ONE POOL replayed in sequence: IG posts at their
// provider timestamp, news at its dateline, listing/feed/org/project records
// at the latest capture at or before the clock; an after-clock capture is
// used only in the unit's assigned week and only for events starting after
// the clock (`capturedAfterClock`). Held weeks roll everything forward;
// published coverage removes keys. Feed createdTime is never availability.
//
// Tests assert evidence binding, availability, coverage, publish rule arithmetic,
// negative controls and the independently reviewed MEASURED captured-evidence
// table. The original projected §7 table is printed only as a comparison;
// these incomplete captures cannot establish actual historical decisions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROD = process.env.RV_PRODUCT_DIR || path.join(ROOT, 'scripts', 'news-pilot');
const prodMod = (name) => import(pathToFileURL(path.join(PROD, name)).href);
const REF = path.join(ROOT, 'tests/fixtures/roundup-v2/backtest/reference');
const REP = path.join(ROOT, 'tests/fixtures/roundup-v2/backtest/replay');
const IG_ARCHIVE = process.env.RV_IG_ARCHIVE ||
  path.join(ROOT, '.state/archive/2026-09-29-ig-trial');

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
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
const conversion = jsonl(path.join(REP, 'conversion.jsonl'));
const header = conversion[0];
assert.equal(header.kind, 'header');
const UNITS = conversion.slice(1);
const byId = new Map(UNITS.map((u) => [u.unitId, u]));
const bySignal = new Map(UNITS.map((u) => [u.form.signalId, u]));
const MANIFEST = JSON.parse(readFileSync(path.join(REP, 'captures.json'), 'utf8'));
const CAPTURES = MANIFEST.captures;
const capById = new Map(CAPTURES.map((c) => [c.captureId, c]));
const IG_ROWS = new Map(jsonl(path.join(REP, 'ig-posts.jsonl')).map((r) => [r.shortCode, r]));

const bodyCache = new Map();
function readBody(rel) {
  if (!bodyCache.has(rel)) {
    let text = readFileSync(path.join(REP, rel), 'utf8');
    if (rel.startsWith('bodies/') && rel.endsWith('.json')) {
      try { const v = JSON.parse(text); if (typeof v === 'string') text = v; } catch { /* raw */ }
    }
    bodyCache.set(rel, text);
  }
  return bodyCache.get(rel);
}

// Toronto wall-clock helpers (harness-side only: availability gating).
const tzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const tzParts = (at) => Object.fromEntries(tzFmt.formatToParts(new Date(at)).filter((p) => p.type !== 'literal')
  .map((p) => [p.type, Number(p.value)]));
const dayOf = (at) => { const p = tzParts(at); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
function torontoInstant(day, time = '00:00') {
  if (!/^\d{4}-\d\d-\d\d$/.test(day || '') || !/^\d\d:\d\d$/.test(time)) return NaN;
  const wall = Date.parse(`${day}T${time}:00Z`);
  let at = wall + 5 * 3600000;
  for (let i = 0; i < 3; i++) { const p = tzParts(at); at += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); }
  return at;
}

const SLOTS = {
  37: ['2026-09-09T16:00:00Z', '2026-09-11T16:00:00Z', '2026-09-13T16:00:00Z'],
  38: ['2026-09-16T16:00:00Z', '2026-09-18T16:00:00Z', '2026-09-20T16:00:00Z'],
  39: ['2026-09-23T16:00:00Z', '2026-09-25T16:00:00Z', '2026-09-27T16:00:00Z'],
  40: ['2026-09-29T15:00:00Z'],
};
// Backtest verdicts for rows that cannot be re-captured (A4): walled -> 403,
// truncated article_ URLs -> 404.
const BLOCKED = new Set(['R10x', 'R11x', 'R25x', 'R30x']);
const GONE = new Set(['R12x', 'R13x']);
// §7 conditional spans: the floor scenario models none of them verifying.
const FLOOR_DROP = new Set(['R22b', 'R57b-ii', 'R59c', 'R61']);

// ------------------------------------------------------------ product stack ---
const V = await (async () => {
  try {
    const [v, r, e, rec, src] = await Promise.all(['roundup-verify.mjs', 'roundup.mjs', 'roundup-evidence.mjs',
      'roundup-records.mjs', 'sources.mjs'].map(prodMod));
    await prodMod('roundup-geo.mjs');
    if ([v.verifyRoundupForms, r.planRoundupV2, e.roundupSourceQuality, rec.extractRoundupRecords,
      rec.normalizeRecordText].every((f) => typeof f === 'function') && Array.isArray(src.ROUNDUP_SOURCES)) {
      console.log(`    product stack: ${PROD}`);
      return { integrated: true, verify: v.verifyRoundupForms, plan: r.planRoundupV2, quality: e.roundupSourceQuality,
        extract: rec.extractRoundupRecords, normalize: rec.normalizeRecordText, sources: src.ROUNDUP_SOURCES };
    }
  } catch (error) { console.log(`    product stack failed to load: ${error.message}`); }
  return { integrated: false };
})();

const sourceOf = (u) => V.sources.find((s) => s.id === u.sourceId) || null;
const postOf = (u) => {
  const row = IG_ROWS.get(u.bodies[0].shortCode);
  return row && { shortcode: row.shortCode, caption: row.caption, timestamp: row.timestamp, ownerUsername: row.ownerUsername };
};
const recordCache = new Map();
/** Production records of one committed body (capture, fragment or IG caption). */
function recordsOf(key, u, body, post = null) {
  const source = sourceOf(u);
  const cacheKey = `${key}|${u.sourceId}|${u.form.evidence[0].url}`;
  if (!recordCache.has(cacheKey)) {
    recordCache.set(cacheKey, source ? V.extract({ source, url: u.form.evidence[0].url, body, post }) : []);
  }
  return recordCache.get(cacheKey);
}
function boundRecords(u) {
  if (u.bodyKind === 'ig-caption') { const post = postOf(u); return recordsOf(`ig:${post.shortcode}`, u, post.caption, post); }
  if (u.bodyKind === 'full-capture') { const c = capById.get(u.bodies[0].captureId); return recordsOf(c.captureId, u, readBody(c.file)); }
  return recordsOf(u.bodies[0].file, u, readBody(u.bodies[0].file));
}

// Availability lane per §7, from the product registry's parse kind.
function laneOf(u) {
  if (u.bodyKind === 'ig-caption') return 'ig';
  const s = sourceOf(u);
  if (s && (['html-listing', 'jsonld-event', 'json-feed'].includes(s.parse) ||
    s.parse === 'html-page' && ['org', 'project'].includes(s.identityKind))) return 'record';
  return 'news';
}
const snapshotsFor = (url) => CAPTURES.filter((c) => c.url === url)
  .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
function eventStartOf(u) {
  const typed = u.recordBinding?.typed || {};
  if (sourceOf(u)?.parse === 'json-feed' && Number.isFinite(typed.startTime)) return typed.startTime;
  return torontoInstant(u.form.when?.date, u.form.when?.startTime || '00:00');
}

/** §7 availability of one unit at one clock. Never reads feed createdTime. */
function availability(u, clock, week) {
  const at = Date.parse(clock);
  const lane = laneOf(u);
  if (lane === 'ig') {
    const ts = Date.parse(postOf(u)?.timestamp || '');
    return ts <= at ? { ok: true, lane, served: { kind: 'ig' }, labels: [] } : { ok: false, lane, why: 'posted-after-clock' };
  }
  if (lane === 'news') {
    const dateline = u.clockFacts.dateline;
    const labels = [];
    if (dateline) { if (dateline > dayOf(at)) return { ok: false, lane, why: 'dateline-after-clock' }; }
    else { if (week < u.expected.week) return { ok: false, lane, why: 'dateline-unknown:before-assigned-week' }; labels.push('datelineUnknown'); }
    const served = u.bodyKind === 'full-capture' ? { kind: 'capture', captureId: u.bodies[0].captureId }
      : { kind: 'fragment', file: u.bodies[0].file };
    if (served.kind === 'capture' && Date.parse(capById.get(served.captureId).capturedAt) > at) labels.push('capturedAfterClock');
    if (served.kind === 'fragment') labels.push('fragment');
    return { ok: true, lane, served, labels };
  }
  const snaps = snapshotsFor(u.form.evidence[0].url);
  const pre = snaps.filter((c) => Date.parse(c.capturedAt) <= at).pop();
  if (pre && recordsOf(pre.captureId, u, readBody(pre.file)).some((r) => r.recordId === u.form.recordId)) {
    return { ok: true, lane, served: { kind: 'capture', captureId: pre.captureId }, labels: [] };
  }
  if (u.bodyKind !== 'full-capture') return { ok: false, lane, why: 'no-capture' };
  const bound = capById.get(u.bodies[0].captureId);
  if (Date.parse(bound.capturedAt) <= at) return { ok: false, lane, why: pre ? 'absent-from-latest-capture' : 'no-capture' };
  if (week !== u.expected.week) return { ok: false, lane, why: 'captured-after-clock:not-assigned-week' };
  if (!(eventStartOf(u) > at)) return { ok: false, lane, why: 'captured-after-clock:event-started-before-clock' };
  return { ok: true, lane, served: { kind: 'capture', captureId: bound.captureId }, labels: ['capturedAfterClock'] };
}

function servedBody(served, u) {
  if (served.kind === 'capture') return readBody(capById.get(served.captureId).file);
  if (served.kind === 'fragment') return readBody(served.file);
  return postOf(u)?.caption ?? '';
}

function buildInputs(entries, { floor }) {
  const signals = [], forms = [];
  for (const { u, avail } of entries) {
    const form = JSON.parse(JSON.stringify(u.form));
    // Excluded rows carry the reviewer's label; clearing it tests the
    // verifier's own judgment.
    form.exclude_reason = null;
    if (floor && u.unitId === 'R37') {
      form.when = { ...form.when, date: null, startTime: null, endTime: null };
      form.evidence = form.evidence.map((e) => ({ ...e, date_quote: null }));
    }
    const url = form.evidence[0].url;
    const post = avail.served.kind === 'ig' ? postOf(u) : null;
    const key = avail.served.kind === 'capture' ? avail.served.captureId : avail.served.kind === 'ig' ? `ig:${post.shortcode}` : avail.served.file;
    const fresh = recordsOf(key, u, servedBody(avail.served, u), post);
    // Collection-time snapshot: reference-row records only (§7). Feed typed
    // fields come from the conversion's snapshot so the verifier's feed
    // projection check compares against what was collected.
    const records = fresh.filter((r) => r.recordId === form.recordId).map((r) => ({ recordId: r.recordId,
      typed: sourceOf(u)?.parse === 'json-feed' && u.recordBinding?.typed ? u.recordBinding.typed : r.typed }));
    const signal = { signalId: form.signalId, sourceId: u.sourceId, url, records,
      replay: { unitId: u.unitId, served: avail.served } };
    if (post) signal.post = post;
    signals.push(signal);
    forms.push(form);
  }
  return { signals, forms };
}

/** Read-only replay fetcher bound to one clock. */
function makeFetcher(clock) {
  const at = Date.parse(clock);
  const log = [];
  const fetcher = async (url, context = {}) => {
    const replay = context.signal?.replay;
    const unitId = replay?.unitId;
    log.push({ url, unitId: unitId || null });
    if (BLOCKED.has(unitId)) return { status: 403 };
    if (GONE.has(unitId)) return { status: 404 };
    if (replay?.served?.kind === 'capture' || replay?.served?.kind === 'fragment') {
      return { status: 200, body: servedBody(replay.served) };
    }
    // Any other URL (e.g. a syndication original): latest capture at/before the clock.
    const pre = snapshotsFor(url).filter((c) => Date.parse(c.capturedAt) <= at).pop();
    return pre ? { status: 200, body: readBody(pre.file) } : { status: 404 };
  };
  return { fetcher, log };
}

const unitIdsOf = (item) => [...new Set((item.constituents || [item]).map((m) => bySignal.get(m.signalId)?.unitId || m.signalId))];

async function runReplay(verify, plan, { floor = false } = {}) {
  const weeks = {};
  const posts = [];
  for (const week of [37, 38, 39, 40]) {
    weeks[week] = [];
    for (const clock of SLOTS[week]) {
      const entries = [], unavailable = [];
      for (const u of UNITS) {
        if (floor && FLOOR_DROP.has(u.unitId)) continue;
        const avail = availability(u, clock, week);
        if (avail.ok) entries.push({ u, avail }); else unavailable.push({ unitId: u.unitId, why: avail.why });
      }
      const { signals, forms } = buildInputs(entries, { floor });
      const { fetcher, log } = makeFetcher(clock);
      const args = { signals, forms, now: clock, posts: [...posts], fetcher };
      assert.ok(!('recordExtractor' in args) && !('recordTools' in args), 'no extractor seam');
      const result = await verify(args);
      const p = plan(result.items, { now: clock, posts: [...posts] });
      const slot = {
        clock, decision: p.decision, reasons: p.reasons, units: p.units, core: p.coreUnits, anchors: p.coreAnchorUnits,
        counted: p.countedItems.map((i) => ({ unitIds: unitIdsOf(i), subject: i.subject, key: i.identityKey,
          keys: i.keys, locality: i.locality || i.verdict, itemType: i.item_type })),
        cut: p.excluded.filter((e) => e.reason === 'cap').map((e) => unitIdsOf(e.item).join('+')),
        still: p.stillInEffect.map((i) => unitIdsOf(i).join('+')),
        planExcluded: p.excluded.map((e) => ({ unitIds: unitIdsOf(e.item), reason: e.reason })),
        verifyExcluded: result.excluded.map((e) => ({ unitId: bySignal.get(e.signalId)?.unitId, reason: e.reason })),
        verified: result.items.map((i) => bySignal.get(i.signalId)?.unitId),
        pool: entries.map(({ u, avail }) => ({ unitId: u.unitId, lane: avail.lane, served: avail.served, labels: avail.labels })),
        unavailable, fetches: log, digest: result.verifyDigest, postsBefore: posts.length,
      };
      weeks[week].push(slot);
      if (p.decision === 'publish') {
        posts.push({ roundupCoverage: { version: 1, isoWeek: p.isoWeek, planningCutoff: clock,
          keys: [...new Set([...p.countedItems.flatMap((i) => i.keys), ...p.stillInEffect.map((i) => i.identityKey)])] } });
        break;
      }
    }
  }
  return weeks;
}

// Original projected §7 table (docs/specs/weekly-roundup-v2.md @ 5590d7c),
// printed for comparison only — never asserted against incomplete captures.
const ORIGINAL_PROJECTION = {
  ceiling: { 37: 'publish Wed 8 (3/1)', 38: 'HOLD below-minimum (Wed 2 (1/1); Fri/Sun 1 (0/0))',
    39: 'publish Fri 3 (1/1)', 40: 'publish 16 (4/3) -> cap 12' },
  floor: { 37: 'publish Wed 8 (3/1)', 38: 'HOLD below-minimum (Wed 2 (1/1); Fri/Sun 1 (0/0))',
    39: 'HOLD below-minimum (Fri/Sun 2 (1/1))', 40: 'publish 15 (5/4) -> cap 12' },
};
const ORIGINAL_UNITS = {
  37: ['IG084', 'IG069', 'IG065', 'R07a', 'R07b', 'R22b', 'R22a', 'R22c', 'R08-i', 'R24-i', 'R09'],
  38: ['R20', 'R38'],
  39: ['R39-i', 'IG193', 'R37'],
  40: ['R50', 'R52', 'IG214', 'IG215', 'R53', 'R54', 'R58-i', 'R59a', 'R59b', 'R59c', 'R55', 'R57a'],
};
// Captured-evidence exercise after the reviewed real-body conversion, exact
// IG214 location-line witness and same-record day-first/Lakeshore parsers. These
// are not claims that the archived bodies existed at earlier historical clocks.
// Group strings retain each aggregate's constituent reference IDs in plan order.
const MEASURED = {
  ceiling: {
    37: [
      ['hold', 5, 0, 0, 'R09|R08-iii+R08-iv+R08-v+R08-vi+R24-i+R24-ii+R24-iii+R24-iv|R07a+R07b+R22b|R22a|R22c'],
      ['hold', 4, 0, 0, 'R07a+R07b+R22b+R38|R08-v+R08-vi+R24-i+R24-ii+R24-iii+R24-iv|R22a|R22c'],
      ['hold', 4, 0, 0, 'R07b+R22b+R38|R08-vi+R24-i+R24-ii+R24-iii+R24-iv+R39-i+R39-ii|R22a|R22c'],
    ],
    38: [['publish', 5, 1, 1, 'R20|R24-iii+R24-iv+R39-i+R39-ii+R39-iii|R22a|R22b+R38|R22c']],
    39: [
      ['hold', 3, 0, 0, 'R58-i+R58-ii+R58-iii|R57a|R57b-i'],
      ['hold', 3, 0, 0, 'R58-i+R58-ii+R58-iii|R57a|R57b-i'],
      ['hold', 3, 0, 0, 'R58-i+R58-ii+R58-iii|R57a|R57b-i+R57b-ii'],
    ],
    40: [['publish', 10, 2, 2, 'IG214|R50|R58-i+R58-ii+R58-iii|R59a|R59b|R55|R57a|R57b-i+R57b-ii|R56a|R56b']],
  },
  floor: {
    37: [
      ['hold', 5, 0, 0, 'R09|R08-iii+R08-iv+R08-v+R08-vi+R24-i+R24-ii+R24-iii+R24-iv|R07a+R07b|R22a|R22c'],
      ['hold', 4, 0, 0, 'R07a+R07b+R38|R08-v+R08-vi+R24-i+R24-ii+R24-iii+R24-iv|R22a|R22c'],
      ['hold', 4, 0, 0, 'R07b+R38|R08-vi+R24-i+R24-ii+R24-iii+R24-iv+R39-i+R39-ii|R22a|R22c'],
    ],
    38: [['publish', 5, 1, 1, 'R20|R24-iii+R24-iv+R39-i+R39-ii+R39-iii|R22a|R22c|R38']],
    39: [
      ['hold', 3, 0, 0, 'R58-i+R58-ii+R58-iii|R57a|R57b-i'],
      ['hold', 3, 0, 0, 'R58-i+R58-ii+R58-iii|R57a|R57b-i'],
      ['hold', 3, 0, 0, 'R58-i+R58-ii+R58-iii|R57a|R57b-i'],
    ],
    40: [['publish', 10, 2, 2, 'IG214|R50|R58-i+R58-ii+R58-iii|R59a|R59b|R55|R57a|R57b-i|R56a|R56b']],
  },
};
const fmtSlot = (s) => `${s.decision} ${s.units} (${s.core}/${s.anchors})${s.reasons.length ? ' ' + s.reasons.join('+') : ''}`;

// ------------------------------------------------------------------ tests ---
test('reference fixtures are immutable byte copies with pinned hashes', () => {
  for (const [rel, pin] of Object.entries(PIN_REFERENCE)) {
    assert.equal(sha(readFileSync(path.join(REF, rel))), pin, `reference/${rel} changed`);
    assert.equal(header.reference[rel], pin, `header must pin reference/${rel}`);
  }
});

test('conversion header pins its archives and does not claim fact (ii) verified', () => {
  for (const [name, pin] of Object.entries(PIN_ARCHIVE)) {
    const h = name.startsWith('backtest-') ? header.archiveBacktest[name.slice('backtest-'.length)] : header.archive[name];
    assert.equal(h, pin, `header archive hash mismatch: ${name}`);
  }
  assert.equal(header.unresolvedFact.id, 'ii');
  // R37's only capture is the post-cutoff revision; (ii) is unavailable.
  assert.equal(header.unresolvedFact.status, 'unavailable');
  const r37 = byId.get('R37');
  assert.ok(r37.unavailable.includes('dateline-pre-cutoff-revision'), 'R37 lists the missing pre-cutoff revision');
  assert.ok(!/datePublished/.test(r37.form.evidence[0].date_quote || ''), 'R37 no longer quotes serialized JSON-LD');
});

test('full captures are committed raw bytes with pinned hashes and provenance', () => {
  assert.ok(CAPTURES.length >= 12);
  for (const c of CAPTURES) {
    const bytes = readFileSync(path.join(REP, c.file));
    assert.equal(sha(bytes), c.sha256, `${c.captureId} sha256`);
    assert.equal(bytes.length, c.bytes, `${c.captureId} byte length`);
    assert.equal(path.basename(c.file).split('.')[0], c.sha256, `${c.captureId} content-addressed`);
    assert.match(c.url, /^https:\/\//, `${c.captureId} canonical https url`);
    assert.ok(!/web\.archive\.org/.test(c.url), `${c.captureId} url is the canonical source, not Wayback`);
    if (c.capture === 'wayback') {
      // The capture instant is embedded in the response itself.
      assert.ok(bytes.toString('utf8').includes(c.waybackMarker), `${c.captureId} embedded Wayback timestamp`);
      const stamp = c.waybackUrl.match(/\/web\/(\d{14})\//)[1];
      assert.equal(stamp, c.capturedAt.replace(/[-:TZ]/g, ''), `${c.captureId} capturedAt matches Wayback stamp`);
    } else {
      assert.equal(c.capture, 'live');
      assert.match(c.capturedAtBasis, /declared/, `${c.captureId} live instant is declared, never upgraded`);
      for (const clock of Object.values(SLOTS).flat()) {
        assert.ok(Date.parse(c.capturedAt) > Date.parse(clock), `${c.captureId} live capture is after every clock`);
      }
    }
  }
});

test('Instagram provider rows are minimal and match the archived raw rows', (t) => {
  for (const r of IG_ROWS.values()) {
    assert.deepEqual(Object.keys(r).sort(), ['archiveFile', 'caption', 'captionSha256', 'ownerUsername', 'shortCode', 'timestamp', 'type'].sort());
    assert.equal(sha(r.caption), r.captionSha256);
  }
  if (!existsSync(IG_ARCHIVE)) { t.diagnostic(`archive absent at ${IG_ARCHIVE}; archive cross-check skipped (captions pinned by sha)`); return; }
  for (const [name, pin] of Object.entries(PIN_ARCHIVE)) {
    if (name.startsWith('backtest-')) continue;
    assert.equal(sha(readFileSync(path.join(IG_ARCHIVE, name))), pin, `archive ${name}`);
  }
  const raw = ['owned-posts.json', ...[1, 2, 3, 4, 5].map((i) => `apify-items${i}.json`)]
    .flatMap((f) => { const j = JSON.parse(readFileSync(path.join(IG_ARCHIVE, f), 'utf8')); return Array.isArray(j) ? j : []; });
  for (const r of IG_ROWS.values()) {
    const row = raw.find((x) => x.shortCode === r.shortCode);
    assert.ok(row, `${r.shortCode} in archive`);
    assert.equal(row.caption ?? '', r.caption, `${r.shortCode} raw caption (line breaks intact)`);
    assert.equal(row.timestamp, r.timestamp);
    assert.equal(row.ownerUsername, r.ownerUsername);
  }
});

test('every conversion line is schema-valid with honest body provenance', () => {
  const VERDICTS = new Set(['core', 'adjacent', 'not-LV']);
  const ITYPES = new Set(['event', 'class', 'concert', 'sports', 'expo', 'community', 'opening', 'closure', 'road',
    'transit', 'project', 'news']);
  const cp = (s) => [...s].length;
  assert.ok(UNITS.length > 100, `expected >100 units, got ${UNITS.length}`);
  for (const u of UNITS) {
    const f = u.form;
    for (const k of ['signalId', 'recordId', 'subject', 'what', 'where_it_happens', 'when', 'who_is_affected',
      'relevance_reason', 'verdict', 'evidence', 'item_type', 'people', 'risk', 'exclude_reason']) assert.ok(k in f, `${u.unitId} form.${k}`);
    assert.ok(cp(f.subject) <= 120 && cp(f.what) <= 200 && cp(f.where_it_happens) <= 200 &&
      cp(f.who_is_affected) <= 200 && cp(f.relevance_reason) <= 300, `${u.unitId} lengths`);
    assert.ok(VERDICTS.has(f.verdict) && ITYPES.has(f.item_type), `${u.unitId} enums`);
    assert.ok(f.evidence.length >= 1 && f.evidence.length <= 3, `${u.unitId} evidence`);
    assert.ok(['ig-caption', 'full-capture', 'fragment'].includes(u.bodyKind), `${u.unitId} bodyKind`);
    assert.equal(u.bodies.length, 1, `${u.unitId} one bound body (never concatenated)`);
    const b = u.bodies[0];
    if (u.bodyKind === 'full-capture') assert.ok(capById.has(b.captureId), `${u.unitId} capture in manifest`);
    if (u.bodyKind === 'ig-caption') assert.ok(IG_ROWS.has(b.shortCode), `${u.unitId} provider row`);
    if (u.bodyKind === 'fragment') {
      assert.equal(sha(readFileSync(path.join(REP, b.file))), path.basename(b.file).split('.')[0], `${u.unitId} fragment hash`);
      assert.ok(u.unavailable.includes('record-text-fragment'), `${u.unitId} fragment is labelled`);
      assert.notEqual(u.expected.class, 'eligible', `${u.unitId} eligible units never rest on fragments`);
    }
  }
});

if (V.integrated) {
  test('record ids, typed snapshots and spans come from the production extractor', () => {
    let bound = 0;
    for (const u of UNITS) {
      const records = boundRecords(u);
      if (u.recordBinding.recordId === null) {
        assert.ok(u.unavailable.includes('record'), `${u.unitId} unbound record is listed unavailable`);
        assert.ok(!records.some((r) => r.recordId === u.form.recordId), `${u.unitId} no fixture id masquerades as a record`);
        continue;
      }
      const rec = records.find((r) => r.recordId === u.form.recordId);
      assert.ok(rec, `${u.unitId} ${u.form.recordId} is emitted by extractRoundupRecords on its bound body`);
      assert.equal(u.form.evidence[0].recordId, rec.recordId, `${u.unitId} evidence recordId`);
      assert.deepEqual(u.recordBinding.typed, JSON.parse(JSON.stringify(rec.typed)), `${u.unitId} typed snapshot`);
      const n = V.normalize(rec.text);
      for (const s of u.spans) {
        assert.equal(s.recordId, rec.recordId, `${u.unitId} span record`);
        assert.equal(n.slice(s.start, s.end), s.text, `${u.unitId} ${s.field} span offsets resolve in the normalized record`);
      }
      const e = u.form.evidence[0];
      for (const [qk, field] of [['subject_quote', 'subject'], ['place_quote', 'place'], ['date_quote', 'date']]) {
        if (e[qk] == null) continue;
        const f = field === 'date' && u.form.when?.kind === 'news-update' ? 'dateline' : field;
        const contiguous = n.includes(V.normalize(e[qk]));
        assert.equal(contiguous, !u.unavailable.includes(f), `${u.unitId} ${qk} contiguity matches its unavailable list`);
      }
      bound++;
    }
    assert.ok(bound >= 80, `bound ${bound}`);
    for (const u of UNITS.filter((x) => x.expected.class === 'eligible')) {
      assert.notEqual(u.bodyKind, 'fragment', `${u.unitId} eligible unit uses a full body`);
      assert.ok(u.spans.some((s) => s.field === 'subject'), `${u.unitId} subject span`);
    }
    // F1: R22 punctuation comes from the real row, not the fragment.
    assert.equal(byId.get('R22a').form.evidence[0].date_quote, 'Friday | Sep 18, 2026');
    // F3: R59 rows are the genuine captured rows.
    assert.equal(byId.get('R59a').form.recordId, 'row:7c5442462325e6b189bffd5b65f54675');
    assert.equal(byId.get('R59b').form.recordId, 'row:40f104176844a06a2551b8b3d969ef66');
    assert.equal(byId.get('R59c').form.recordId, 'row:3fdaa0679cffa3b219cbef9290b1bba8');
    // IG214's whole-block inherited quote obscured the caption's actual
    // pinned-location line. Preserve its exact same-record place witness.
    const ig214 = byId.get('IG214');
    assert.equal(ig214.form.evidence[0].place_quote, '116 Atlantic Ave. Patio');
    assert.ok(ig214.spans.some((s) => s.field === 'place' && s.text === '116 Atlantic Ave. Patio'));
    assert.ok(boundRecords(ig214).find((r) => r.recordId === ig214.form.recordId).text
      .split('\n').some((line) => /^\s*📍\s*116 Atlantic Ave\. Patio\s*$/.test(line)));
  });

  test('REAL captured-record geography controls are not historical clock admissions', async () => {
    // These roads exist only in the Sep 29 18:30Z captured feed, after the
    // 15:00Z replay clock. Exercise their real records separately rather
    // than bypassing the replay's availability guard or calling them counted.
    const clock = '2026-09-29T19:00:00Z';
    for (const id of ['R62x', 'R63x', 'R64x']) {
      const u = byId.get(id);
      const avail = { served: { kind: 'capture', captureId: u.bodies[0].captureId } };
      const { signals, forms } = buildInputs([{ u, avail }], { floor: false });
      const { fetcher } = makeFetcher(clock);
      const result = await V.verify({ signals, forms, now: clock, posts: [], fetcher });
      assert.equal(result.items.length, 0, `${id} must not count even in a post-capture control`);
      assert.equal(result.excluded.find((e) => e.signalId === u.form.signalId)?.reason, 'not-LV',
        `${id} real bound feed record excludes an off-site street`);
    }
  });

  const REPLAY = {};
  const replay = async (floor) => (REPLAY[floor] ??= await runReplay(V.verify, V.plan, { floor }));

  test('REAL replay: availability follows §7 one-pool capture-time rules', async () => {
    for (const floor of [false, true]) {
      const w = await replay(floor);
      const seen = new Map();
      for (const week of [37, 38, 39, 40]) {
        for (const s of w[week]) {
          const at = Date.parse(s.clock);
          for (const p of s.pool) {
            const u = byId.get(p.unitId);
            if (p.lane === 'ig') assert.ok(Date.parse(postOf(u).timestamp) <= at, `${p.unitId} posted by ${s.clock}`);
            if (p.lane === 'news' && u.clockFacts.dateline) assert.ok(u.clockFacts.dateline <= dayOf(at), `${p.unitId} dateline by ${s.clock}`);
            if (p.served.kind === 'capture' && p.lane === 'record') {
              const c = capById.get(p.served.captureId);
              if (Date.parse(c.capturedAt) > at) {
                assert.ok(p.labels.includes('capturedAfterClock'), `${p.unitId} labelled capturedAfterClock`);
                assert.equal(week, u.expected.week, `${p.unitId} after-clock record only in its assigned week`);
                assert.ok(eventStartOf(u) > at, `${p.unitId} after-clock record only for a later event`);
              } else {
                // Served snapshot is the LATEST capture at or before the clock.
                const later = snapshotsFor(c.url).filter((x) => Date.parse(x.capturedAt) <= at && Date.parse(x.capturedAt) > Date.parse(c.capturedAt));
                assert.equal(later.length, 0, `${p.unitId} served the latest pre-clock capture`);
              }
            }
            // One pool: IG and dated news, once available, stay available.
            if (p.lane !== 'record') seen.set(p.unitId, s.clock);
          }
          for (const [id] of seen) {
            if (floor && FLOOR_DROP.has(id)) continue;
            assert.ok(s.pool.some((p) => p.unitId === id), `${id} rolls forward to ${s.clock}`);
          }
          // Every unit fetched through its own served body; no concatenation.
          for (const f of s.fetches) if (f.unitId) assert.ok(s.pool.some((p) => p.unitId === f.unitId), 'fetch belongs to a pooled unit');
        }
      }
    }
  });

  test('REAL replay: publish rule, cap and sequential coverage invariants', async () => {
    for (const floor of [false, true]) {
      const w = await replay(floor);
      const publishedKeys = new Set();
      for (const week of [37, 38, 39, 40]) {
        const slots = w[week];
        slots.forEach((s, i) => {
          assert.equal(s.decision === 'publish', s.units >= 3 && s.anchors >= 1, `W${week} ${s.clock} publish rule`);
          assert.ok(s.units <= 12, 'cap 12');
          assert.equal(s.units, s.counted.length);
          if (s.decision === 'publish') assert.equal(i, slots.length - 1, 'a week stops at its first publishing slot');
          for (const c of s.counted) for (const k of c.keys) {
            assert.ok(!publishedKeys.has(k), `W${week} ${k} was already published`);
          }
        });
        const last = slots[slots.length - 1];
        if (last.decision === 'publish') for (const c of last.counted) for (const k of c.keys) publishedKeys.add(k);
      }
    }
  });

  test('REAL replay: reviewed measured captured-evidence slots, group IDs and cap cuts', async () => {
    for (const floor of [false, true]) {
      const name = floor ? 'floor' : 'ceiling';
      const w = await replay(floor);
      for (const week of [37, 38, 39, 40]) {
        assert.equal(w[week].length, MEASURED[name][week].length, `${name} W${week} deciding slot`);
        w[week].forEach((s, i) => {
          const [decision, units, core, anchors, groups] = MEASURED[name][week][i];
          assert.equal(s.clock, SLOTS[week][i], `${name} W${week} slot clock`);
          assert.deepEqual([s.decision, s.units, s.core, s.anchors], [decision, units, core, anchors],
            `${name} W${week} ${s.clock} measured result`);
          assert.equal(s.counted.map((c) => c.unitIds.join('+')).join('|'), groups,
            `${name} W${week} ${s.clock} measured source-bound unit groups`);
          assert.deepEqual(s.cut, [], `${name} W${week} ${s.clock} no cap cut on these captured bodies`);
        });
      }
    }
  });

  test('REAL replay: no trap, lead or reviewer-excluded row is ever counted', async () => {
    for (const floor of [false, true]) {
      const w = await replay(floor);
      for (const week of [37, 38, 39, 40]) for (const s of w[week]) for (const c of s.counted) for (const id of c.unitIds) {
        assert.equal(byId.get(id)?.expected.class, 'eligible', `W${week} ${s.clock} counted non-eligible ${id} (${c.subject})`);
      }
      // Floor: fact (ii) and the conditional spans never count.
      if (floor) for (const week of [37, 38, 39, 40]) for (const s of w[week]) for (const c of s.counted) {
        assert.ok(!c.unitIds.some((id) => id === 'R37' || FLOOR_DROP.has(id)), `floor counted ${c.unitIds}`);
      }
    }
  });

  test('REAL harness integrity: outcomes follow the injected verifier, not the fixtures', async () => {
    const empty = await runReplay(async () => ({ items: [], excluded: [], verifyDigest: 'empty-stub' }), V.plan);
    assert.equal(empty[37][0].digest, 'empty-stub');
    for (const week of [37, 38, 39, 40]) for (const s of empty[week]) assert.equal(s.units, 0);
    const acceptAll = async ({ forms }) => ({
      items: forms.map((f) => ({ ...f, identityKey: 'stub:' + f.signalId, keys: ['stub:' + f.signalId], locality: 'core',
        verdict: 'core', item_type: 'event', when: { date: '2026-10-30', kind: 'event' }, date: '2026-10-30', active: true,
        tier: 'official' })),
      excluded: [], verifyDigest: 'accept-stub' });
    const all = await runReplay(acceptAll, V.plan);
    for (const week of [37, 38, 39, 40]) assert.equal(all[week][0].decision, 'publish', `evidence-blind mock publishes W${week}`);
  });

  test('REAL replay census (measured outcome asserted above; original projection diagnostic only)', async () => {
    const out = {};
    for (const floor of [false, true]) {
      const name = floor ? 'floor' : 'ceiling';
      const w = await replay(floor);
      out[name] = w;
      console.log(`    ---- scenario ${name} (real verifier + planner + production extractor) ----`);
      for (const week of [37, 38, 39, 40]) {
        for (const s of w[week]) {
          const after = s.pool.filter((p) => p.labels.includes('capturedAfterClock')).map((p) => p.unitId);
          console.log(`    W${week} ${s.clock} ${fmtSlot(s)} pool=${s.pool.length} verified=${s.verified.length} digest=${s.digest.slice(0, 12)}`);
          console.log(`      counted: ${s.counted.map((c) => `${c.unitIds.join('+')}[${c.locality}${c.itemType === 'class' ? ',class' : ''}]`).join(' ') || '-'}`);
          if (s.cut.length) console.log(`      cap cut: ${s.cut.join(' ')}`);
          if (s.still.length) console.log(`      still in effect: ${s.still.join(' ')}`);
          if (after.length) console.log(`      capturedAfterClock: ${after.join(' ')}`);
          const ex = s.verifyExcluded.filter((e) => byId.get(e.unitId)?.expected.class === 'eligible');
          if (ex.length) console.log(`      eligible excluded by verifier: ${ex.map((e) => `${e.unitId}:${e.reason}`).join(' ')}`);
          const px = s.planExcluded.filter((e) => e.reason !== 'cap');
          if (px.length) console.log(`      planner dropped: ${px.map((e) => `${e.unitIds.join('+')}:${e.reason}`).join(' ')}`);
        }
        const last = w[week][w[week].length - 1];
        const observed = new Set(w[week].flatMap((s) => s.counted.flatMap((c) => c.unitIds)));
        const original = ORIGINAL_UNITS[week].filter((id) => !(floor && (id === 'R37' || FLOOR_DROP.has(id))));
        console.log(`      original projection: ${ORIGINAL_PROJECTION[name][week]} | observed deciding: ${last.clock} ${fmtSlot(last)}`);
        console.log(`      original units absent: ${original.filter((id) => !observed.has(id)).join(' ') || '-'}; ` +
          `extra: ${[...observed].filter((id) => !ORIGINAL_UNITS[week].includes(id)).join(' ') || '-'}`);
      }
    }
    if (process.env.RV_CENSUS_OUT) writeFileSync(process.env.RV_CENSUS_OUT, JSON.stringify(out, null, 1));
  });

  test('REAL source-quality predicate on fixture evidence tiers', () => {
    const entry = (tier, domain) => ({ itemBound: true, extractionSubstantive: true, fetchOk: true, tier, publisherDomain: domain });
    assert.equal(V.quality([entry('official', 'canadasoccer.com')]), true);
    assert.equal(V.quality([entry('primary', 'nrghaus.com')]), true);
    assert.equal(V.quality([entry('lead', 'blogto.com')]), false);
    assert.equal(V.quality([entry('reputable', 'thestar.com')]), false);
    assert.equal(V.quality([entry('lead', 'blogto.com'), entry('lead', 'cbc.ca')]), true);
  });
}

// No surrogate: without the full product stack every REAL test above is
// skipped by its guard, so this gate fails loudly instead of passing.
test('product stack present (no surrogate)', () => {
  assert.ok(V.integrated, `real product stack absent in ${PROD} (needs verify/plan/evidence/geo/records/sources)`);
});
