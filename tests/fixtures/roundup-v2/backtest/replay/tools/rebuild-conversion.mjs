// Rebuilds replay/conversion.jsonl record bindings from the PRODUCTION
// extractor (scripts/news-pilot/roundup-records.mjs) over the committed full
// bodies. Deterministic and idempotent:
//
//   node tests/fixtures/roundup-v2/backtest/replay/tools/rebuild-conversion.mjs
//
// For every unit it (1) binds the unit to one committed body — a full capture
// (captures.json), an archived Instagram caption (ig-posts.jsonl), or, for
// rows with no full capture, the existing frozen fragment (labelled
// `fragment`); (2) runs extractRoundupRecords on that body; (3) selects the
// record carrying the unit's subject quote; (4) keeps each quote verbatim when
// it is contiguous in the normalized record, re-derives it ONLY when the same
// word tokens occur contiguously with different punctuation (e.g. R22
// "Friday / Sep 18 , 2026" -> the record's "Friday | Sep 18, 2026"), and
// otherwise leaves it untouched and lists the field in `unavailable` so the
// verifier fails on it. Nothing is synthesized, no text is wrapped to force a
// parse, and no fixture record id is copied back into a record.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(REP, '../../../../..');
const PROD = process.env.RV_PRODUCT_DIR || path.join(ROOT, 'scripts', 'news-pilot');
const { extractRoundupRecords, normalizeRecordText } = await import(pathToFileURL(path.join(PROD, 'roundup-records.mjs')).href);
const { ROUNDUP_SOURCES } = await import(pathToFileURL(path.join(PROD, 'sources.mjs')).href);

const lines = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const conv = lines(path.join(REP, 'conversion.jsonl'));
const header = conv[0];
const units = conv.slice(1);
const { captures } = JSON.parse(fs.readFileSync(path.join(REP, 'captures.json'), 'utf8'));
const capById = new Map(captures.map((c) => [c.captureId, c]));
const igRows = new Map(lines(path.join(REP, 'ig-posts.jsonl')).map((r) => [r.shortCode, r]));

// Harness mapping of each unit to its product registry source (unchanged
// from the previous eval; the registry itself is always product data).
function sourceIdFor(u) {
  const id = u.unitId;
  if (/^(R07|R22|R38|R57)/.test(id)) return 'rv2-coliseum';
  if (/^(R55|R56)/.test(id)) return 'rv2-bmo-field';
  if (/^(R08|R24|R39|R58)/.test(id)) return 'rv2-rbc-amphitheatre';
  if (/^(R09|R52|R53|R54|R62x|R63x|R64x)/.test(id)) return 'rv2-road-restrictions';
  if (id === 'R20') return 'rv2-lv-bia-events';
  if (id === 'R50') return 'rv2-city-project-34-hanna-park';
  if (/^R59/.test(id)) return 'rv2-explace';
  if (id.startsWith('IG')) return `ig:${String(u.clockFacts.owner || '').toLowerCase()}`;
  if (/^R(17|18|19|49)x$/.test(id)) return 'rv2-reddit-dropped';
  return 'rv2-serper-news';
}
// Unit -> the full capture the prior conversion cited for it (same source
// URL and capture instant). Units absent here keep their frozen fragment.
function captureFor(u) {
  const id = u.unitId;
  if (/^(R07|R22|R38)/.test(id)) return 'coliseum-2026-08-28-wayback';
  if (/^(R08|R24)/.test(id)) return 'rbc-2026-08-31-wayback';
  if (/^R39/.test(id)) return 'rbc-2026-09-24-wayback';
  if (/^(R09|R52|R53|R54|R62x|R63x|R64x)$/.test(id)) return 'roads-2026-09-29-live';
  if (id === 'R20') return 'bia-events-2026-09-29-live';
  if (id === 'R50') return 'hanna-park-2026-09-29-live';
  if (/^(R55|R56)/.test(id)) return 'bmo-field-2026-09-29-live';
  if (/^R57/.test(id)) return 'coliseum-2026-09-29-live';
  if (/^R58/.test(id)) return 'rbc-2026-09-29-live';
  if (/^R59/.test(id)) return 'explace-2026-09-29-live';
  if (id === 'R61') return 'pwhl-sceptres-opener-2026-09-29-live';
  if (id === 'R37') return 'canadasoccer-r37-2026-09-29-live';
  return null;
}

const tokenRe = /[\p{L}\p{N}]+/gu;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Verbatim if contiguous; else the unique punctuation/zero-padding variant; else null. */
function locate(quote, recNorm) {
  const q = normalizeRecordText(quote);
  if (q && recNorm.includes(q)) return { text: q, how: 'verbatim' };
  const toks = q.match(tokenRe) || [];
  if (!toks.length) return null;
  // Word tokens must match exactly; digit-only tokens match by value (a
  // zero-padded "03" is the row's "3"). Only non-alphanumerics may differ.
  const tok = (t) => /^\d+$/.test(t) ? `0*${Number(t)}` : esc(t);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${toks.map(tok).join('[^\\p{L}\\p{N}]{0,4}')}(?![\\p{L}\\p{N}])`, 'gu');
  const hits = [...new Set([...recNorm.matchAll(re)].map((m) => m[0]))];
  return hits.length === 1 ? { text: hits[0], how: 'rederived' } : null;
}

const readBody = (rel) => {
  const raw = fs.readFileSync(path.join(REP, rel), 'utf8');
  if (rel.startsWith('bodies/') && rel.endsWith('.json')) {
    try { const v = JSON.parse(raw); if (typeof v === 'string') return v; } catch { /* raw */ }
  }
  return raw;
};
const FIELD = { subject_quote: 'subject', place_quote: 'place', date_quote: 'date' };
const referenced = new Set();
const report = [];

for (const u of units) {
  const sourceId = sourceIdFor(u);
  const source = ROUNDUP_SOURCES.find((s) => s.id === sourceId) || null;
  const url = u.form.evidence[0].url;
  const prev = u.recordBinding || {};
  const priorId = prev.priorFixtureRecordId || u.form.recordId;
  const priorUnavailable = (u.unavailable || []).filter((f) => !['record', 'subject', 'place', 'date', 'dateline',
    'record-text-fragment', 'dateline-pre-cutoff-revision', 'dateline-grammar'].includes(f));
  let bodies, body, post = null, bodyKind;
  const capId = captureFor(u);
  if (u.clockFacts.kind === 'ig') {
    const code = u.bodies[0].url.match(/\/p\/([^/]+)\//)[1];
    const row = igRows.get(code);
    post = { shortcode: row.shortCode, caption: row.caption, timestamp: row.timestamp, ownerUsername: row.ownerUsername };
    body = row.caption;
    bodyKind = 'ig-caption';
    bodies = [{ url: u.bodies[0].url, file: 'ig-posts.jsonl', shortCode: code, capturedAt: row.timestamp,
      capture: 'provider-archive', capturedAfterClock: false }];
  } else if (capId) {
    const c = capById.get(capId);
    body = fs.readFileSync(path.join(REP, c.file), 'utf8');
    bodyKind = 'full-capture';
    bodies = [{ url: c.url, file: c.file, captureId: c.captureId, capturedAt: c.capturedAt, capture: c.capture,
      capturedAfterClock: null }];
    referenced.add(c.file);
  } else {
    const b = u.bodies[0];
    body = readBody(b.file);
    bodyKind = 'fragment';
    bodies = [{ ...b, fragment: true }];
    referenced.add(b.file);
  }
  const records = source ? extractRoundupRecords({ source, url, body, post }) : [];
  const ev = u.form.evidence[0];
  let chosen = null;
  let binding = 'subject-quote';
  if (u.clockFacts.feedId) binding = 'feed-id';
  if (u.clockFacts.feedId) chosen = records.find((r) => r.recordId === u.clockFacts.feedId) || null;
  if (!chosen) {
    const scored = records.map((r) => {
      const n = normalizeRecordText(r.text);
      const subj = ev.subject_quote && locate(ev.subject_quote, n);
      const score = Object.keys(FIELD).filter((f) => ev[f] && locate(ev[f], n)).length;
      return { r, n, subj, score };
    }).filter((x) => x.subj);
    scored.sort((a, b) => b.score - a.score || a.n.length - b.n.length || (a.r.recordId < b.r.recordId ? -1 : 1));
    chosen = scored[0]?.r || null;
    // A caption/page yielding exactly one record binds to it even when the
    // reviewer's subject quote is not in it; the quote is then unavailable
    // and the verifier fails the unit on it.
    if (!chosen && records.length === 1) { chosen = records[0]; binding = 'sole-record'; }
  }
  const unavailable = [...priorUnavailable];
  const spans = [];
  const quoteNotes = { ...(prev.quoteNotes || {}) };
  if (chosen) {
    const n = normalizeRecordText(chosen.text);
    u.form.recordId = chosen.recordId;
    for (const e of u.form.evidence) if (e.url === url) e.recordId = chosen.recordId;
    for (const [qk, field] of Object.entries(FIELD)) {
      if (ev[qk] == null) continue;
      const hit = locate(ev[qk], n);
      const spanField = field === 'date' && u.form.when?.kind === 'news-update' ? 'dateline' : field;
      if (!hit) { unavailable.push(spanField); quoteNotes[qk] = 'absent-from-record'; continue; }
      if (hit.how !== 'verbatim') { quoteNotes[qk] = `rederived-from:${ev[qk]}`; ev[qk] = hit.text; }
      const start = n.indexOf(hit.text);
      spans.push({ recordId: chosen.recordId, field: spanField, start, end: start + hit.text.length, text: hit.text });
    }
  } else {
    unavailable.push('record');
  }
  if (bodyKind === 'fragment') unavailable.push('record-text-fragment');
  u.sourceId = sourceId;
  u.bodyKind = bodyKind;
  u.bodies = bodies;
  u.spans = spans;
  u.unavailable = [...new Set(unavailable)];
  u.recordBinding = chosen ? {
    recordId: chosen.recordId, kind: chosen.kind, extractedRecords: records.length, binding,
    priorFixtureRecordId: priorId === chosen.recordId ? undefined : priorId,
    typed: chosen.typed, quoteNotes: Object.keys(quoteNotes).length ? quoteNotes : undefined,
  } : { recordId: null, extractedRecords: records.length, priorFixtureRecordId: priorId };
  report.push([u.unitId, bodyKind, records.length, chosen?.recordId || '-', u.unavailable.join('|')]);
}

// ---- unit-specific evidence corrections (facts, not table tuning) ----
const byId = new Map(units.map((u) => [u.unitId, u]));
const r37 = byId.get('R37');
if (r37) {
  // The committed capture is the 2026-09-29 revision (dateModified
  // 2026-09-28T13:38:52Z): its visible <time>24/09/2026</time> sits in the
  // subject's section record, but no capture of the page as it stood at the
  // W39 clocks exists, and the product date grammar does not resolve
  // DD/MM/YYYY. Fact (ii) is therefore UNAVAILABLE, not verified.
  const rec =extractRoundupRecords({ source: ROUNDUP_SOURCES.find((s) => s.id === 'rv2-serper-news'), url: r37.form.evidence[0].url,
    body: fs.readFileSync(path.join(REP, capById.get('canadasoccer-r37-2026-09-29-live').file), 'utf8') })
    .find((r) => r.recordId === r37.form.recordId);
  const recNorm = normalizeRecordText(rec.text);
  const visible = '24/09/2026';
  r37.form.evidence[0].date_quote = recNorm.includes(visible) ? visible : null;
  r37.spans = r37.spans.filter((s) => s.field !== 'dateline');
  if (recNorm.includes(visible)) {
    const start = recNorm.indexOf(visible);
    r37.spans.push({ recordId: rec.recordId, field: 'dateline', start, end: start + visible.length, text: visible });
  }
  r37.unavailable = [...new Set([...r37.unavailable.filter((f) => f !== 'dateline'), 'dateline-pre-cutoff-revision', 'dateline-grammar'])];
  r37.clockFacts.datelineSource = 'visible <time dateTime="2026-09-24T13:00:00.000Z">24/09/2026</time> in the SAME section record as the subject, ' +
    'but only in the 2026-09-29 revision (dateModified 2026-09-28T13:38:52Z); no capture at or before the W39 clocks; DD/MM/YYYY is outside the product date grammar';
  r37.recordBinding.quoteNotes = { ...(r37.recordBinding.quoteNotes || {}),
    date_quote: 'replaced serialized JSON-LD datePublished (not in any section record) with the visible same-record dateline' };
}
const r59a = byId.get('R59a');
if (r59a) r59a.form.relevance_reason = 'Exhibition Place (Enercare Centre) listing row captured in full from the ExPlace events page on 2026-09-29; adjacent venue grounds.';

header.unresolvedFact = { id: 'ii', status: 'unavailable',
  detail: 'Canada Soccer R37 dateline: the only capture is the 2026-09-29 revision (dateModified 2026-09-28T13:38:52Z). ' +
    'Its visible <time>24/09/2026</time> is in the subject section record, but the page as it stood at the W39 clocks was never captured, ' +
    'and DD/MM/YYYY is outside the product date grammar. Not verified; needs a <=2026-09-25 capture or an owner ruling under 6.4.' };
header.honestDifferences = [
  'Record ids, typed snapshots and spans are derived by the production extractRoundupRecords over committed full bodies (captures/, ig-posts.jsonl); see recordBinding per unit.',
  'Rows with no full capture keep their frozen fragment body (bodyKind fragment, unavailable record-text-fragment); they are negative controls, not production-record evidence.',
  'R37 fact (ii) is unavailable (see unresolvedFact); R61 remains undated (empty <time dateTime>).',
  'Live capture instants are declared, not logged; they are all after every replay clock and are never upgraded to pre-clock snapshots.',
];
header.captureManifest = 'captures.json';
header.igProviderRows = 'ig-posts.jsonl';
header.builder = 'tools/rebuild-conversion.mjs';

fs.writeFileSync(path.join(REP, 'conversion.jsonl'), [header, ...units].map((l) => JSON.stringify(l, (k, v) => v === undefined ? undefined : v)).join('\n') + '\n');
// Drop frozen bodies no unit references any more (IG captions and fragments
// superseded by full captures). Hash-named, so nothing else points at them.
for (const f of fs.readdirSync(path.join(REP, 'bodies'))) {
  if (!referenced.has(`bodies/${f}`)) fs.rmSync(path.join(REP, 'bodies', f));
}
for (const r of report) console.log(r.join('\t'));
