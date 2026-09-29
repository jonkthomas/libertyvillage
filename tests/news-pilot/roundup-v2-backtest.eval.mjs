// Roundup v2 backtest replay eval (docs/specs/weekly-roundup-v2.md sections 7, A4).
//
// No model calls, no network. Replays the archived September 2026 backtest +
// Instagram trial through the REAL pipeline — verifyRoundupForms (item-bound
// evidence, dates, time proof, tiers, temporal windows, risk, coverage) and
// planRoundupV2 (dedupe, concert/class caps, cap 12, >=3 units / >=1 anchor) —
// with test-scope doubles only at the designed seams, exactly as the
// verifier's own unit tests do:
//   - fetcher: serves the frozen captured bodies by URL (403 for walled,
//     404 for truncated rows — the backtest's own verdicts);
//   - recordExtractor: returns the reviewed record for a recordId; record
//     TEXT always comes from the body files, typed feed/JSON-LD fields are
//     parsed from that text at runtime;
//   - sources/publisherTiers: the replay registry (tiers per section 4.1;
//     discovery rows stay leads);
//   - geography: primitives that check the captured text itself (venue alias
//     present, address token present, segment-table match). A stub that cannot
//     find evidence fails closed (unverifiable), never parrots the fixture.
//
// Every exclusion reason below is produced by the verifier, never asserted
// from the fixture. The fixture's expected.class is the reviewed label; where
// the real reason differs by rule-ordering it is reported, not hidden.
//
// Reviewed-table updates baked in (see replay/REVIEW.md): fact (ii) R37
// verifies; R61 has no visible dateline; R59c has no captured record text;
// IG193's day-first date does not resolve in the verifier grammar, so W39
// holds in both scenarios. If scripts/news-pilot/roundup-verify.mjs is
// absent, the eval runs the documented interim replay instead and reports
// pending-integration (spec A7).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { roundupSourceQuality } from '../../scripts/news-pilot/roundup-evidence.mjs';

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

// ---------------------------------------------------------------- registry ---
const SOURCES = [
  { id: 'rv2-bmo-field', identityKind: 'venue', identityId: 'venue:bmo-field', url: 'https://www.bmofield.com/events', parse: 'html-listing', tier: 'official', locality: 'adjacent', canonicalVenueId: 'venue:bmo-field' },
  { id: 'rv2-coliseum', identityKind: 'venue', identityId: 'venue:coca-cola-coliseum', url: 'https://www.coca-colacoliseum.com/events', parse: 'html-listing', tier: 'official', locality: 'adjacent', canonicalVenueId: 'venue:coca-cola-coliseum' },
  { id: 'rv2-explace', identityKind: 'venue', identityId: 'venue:exhibition-place', url: 'https://www.explace.on.ca/events/', parse: 'html-listing', tier: 'official', locality: 'adjacent', canonicalVenueId: 'venue:exhibition-place' },
  { id: 'rv2-enercare', identityKind: 'venue', identityId: 'venue:enercare-centre', url: 'https://www.explace.on.ca/events/', parse: 'html-listing', tier: 'official', locality: 'adjacent', canonicalVenueId: 'venue:enercare-centre' },
  { id: 'rv2-rbc', identityKind: 'venue', identityId: 'venue:rbc-amphitheatre', url: 'https://www.rbcamphitheatre.com/shows', parse: 'jsonld-event', tier: 'official', locality: 'adjacent', canonicalVenueId: 'venue:rbc-amphitheatre' },
  { id: 'rv2-road-restrictions', identityKind: 'road-feed', parse: 'json-feed', tier: 'official', url: 'https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json' },
  { id: 'rv2-lv-bia-events', identityKind: 'org', parse: 'html-page', tier: 'official', url: 'https://www.libertyvillagebia.com/events', geography: 'Toronto' },
  { id: 'rv2-city-projects', identityKind: 'project', parse: 'html-page', tier: 'official', geography: 'Toronto' },
  { id: 'rv2-canada-soccer', identityKind: 'org', parse: 'html-page', tier: 'official', url: 'https://news.canadasoccer.com/canmnt-to-play-202627-concacaf-nations-league-quarterfinal-home-leg-in-toronto', geography: 'Toronto' },
  { id: 'rv2-serper-news', identityKind: 'news-discovery', parse: 'html-page', tier: 'lead' },
];
const TIERS = {
  'blogto.com': 'lead', 'tfcrepublic.ca': 'lead', 'thestar.com': 'reputable', 'cbc.ca': 'reputable',
  'toronto.citynews.ca': 'lead', 'citynews.ca': 'lead', '6ixretail.com': 'lead', 'newswire.ca': 'lead',
  'torontosun.com': 'lead', 'narcity.com': 'lead', 'cp24.com': 'lead', 'torontotoday.ca': 'lead',
  'torontolife.com': 'lead', 'nowtoronto.com': 'lead', 'theglobeandmail.com': 'lead',
  'globalnews.ca': 'reputable', 'nationalpost.com': 'lead', 'streetsoftoronto.com': 'lead',
  'showpass.com': 'lead', 'toronto.com': 'lead', 'durhamregion.com': 'lead', 'ontarioplace.com': 'lead',
};
// Watch-list entries are read from the pinned reference file, not invented.
const BRANDWIDE = new Set(['impactkitchen', 'balzacscoffee', 'yogatreestudios', 'sweetflourbakeshop',
  'localpubliceatery', 'kintonramen', 'arvocoffee', 'kitchenhub', 'risecycle', 'burgerdrops',
  'mildredstemplekitchen', 'jimmys_coffee', 'strongpilates_ca', 'sundayspastalab']);
const WATCH = new Map();
for (const line of lines(path.join(REF, 'ig/accounts.csv')).slice(1)) {
  const [handle, business, addr, url] = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  WATCH.set(handle.toLowerCase(), { business, addr: addr.replace(/^"|"$/g, ''), url });
}
const REQUIRES_VENUE = new Set(['greenlibertyvillage', 'libertyresident']);
for (const u of UNITS) {
  if (!u.unitId.startsWith('IG') || !u.clockFacts?.owner) continue;
  const h = u.clockFacts.owner.toLowerCase();
  if (!SOURCES.some((s) => s.id === `ig:${h}`)) {
    const w = WATCH.get(h) || { business: h, addr: '' };
    SOURCES.push({ id: `ig:${h}`, identityKind: 'ig', parse: 'ig-post', tier: 'primary',
      handle: h, verifiedAddress: w.addr, requiresVenue: REQUIRES_VENUE.has(h),
      singleLocation: !BRANDWIDE.has(h) });
  }
}

// ------------------------------------------------- geography doubles (real) ---
// Each classifier below checks the captured record text (or typed fields) and
// fails closed. None of them read the fixture's verdict or expected class.
const CORE_STREETS = ['hanna ave', 'atlantic ave', 'liberty st', 'east liberty st', 'jefferson ave',
  'mowat ave', 'fraser ave', 'pirandello st', 'snooker st', 'lynn williams st', 'western battery rd'];
const ADJ_VENUES = ['BMO Field', 'Coca-Cola Coliseum', 'Exhibition Place', 'Enercare Centre',
  'Beanfield Centre', 'Queen Elizabeth Building', 'RBC Amphitheatre', 'Lamport Stadium'];
const VENUE_ALIAS = {
  'venue:bmo-field': ['BMO Field'],
  'venue:coca-cola-coliseum': ['Coca-Cola Coliseum'],
  'venue:exhibition-place': ['Exhibition Place', 'Beanfield Centre', 'Queen Elizabeth Building'],
  'venue:enercare-centre': ['Enercare Centre'],
  'venue:rbc-amphitheatre': ['RBC Amphitheatre'],
};
const NAMED_CORE = new Map([
  ['liberty village park', 'addr:70-east-liberty-st'],
  ['lamport stadium', 'addr:75-fraser-ave'],
  ['quest xo chocolate creative lab', 'addr:25-liberty-st'],
  ['nrg haus', 'addr:171-east-liberty-st#113'],
  ['deltatrain liberty village', 'addr:37a-mowat-ave'],
]);
const OFF_SITE = ['downsview park', 'montreal', 'la spada'];
const canonAddr = (n, s) => `addr:${n}-${s.replace(/\s+(ave|avenue|st|street|rd|road)$/, '').replace(/\s+/g, '-')}`;
const GEO = {
  classifyVenueName(name, { source, record } = {}) {
    const text = String(record?.text ?? '');
    if (source?.identityKind === 'venue') {
      const hit = (VENUE_ALIAS[source.identityId] || []).some((a) => text.includes(a));
      if (!hit) {
        // Listing rows belong to the venue page by construction: accept the
        // registry venue only when the record is bound to the source URL.
        const page = record?.typed?.pageUrl || '';
        let same = false;
        try {
          const a = new URL(page), b = new URL(source.url || '');
          same = a.hostname === b.hostname && a.pathname === b.pathname;
        } catch { same = false; }
        if (!same) return null;
      }
      return { locality: source.locality, venueId: source.identityId, canonicalVenueId: source.canonicalVenueId };
    }
    if (source?.parse === 'ig-post') {
      const low = text.toLowerCase();
      for (const [venue, id] of NAMED_CORE) {
        if (low.includes(venue)) {
          if (id === 'addr:70-east-liberty-st' || venue === 'lamport stadium') return { locality: 'core', canonicalVenueId: id };
          const mine = watchId(source);
          if (mine && id === mine) return { locality: 'core', canonicalVenueId: id };
        }
      }
      const h = (source.handle || '').toLowerCase();
      const bizParts = String(WATCH.get(h)?.business || '').toLowerCase().split('|').map((s) => s.trim()).filter(Boolean);
      const bizHit = bizParts.some((p) => p.length > 3 && low.includes(p));
      const addrHit = hasAddressToken(low, WATCH.get(h)?.addr || '');
      if ((h && low.includes(`@${h}`)) || bizHit || addrHit) {
        const mine = watchId(source);
        // Multi-location brands must show the LV address; the name alone is not enough.
        if (mine && (source.singleLocation || addrHit)) return { locality: 'core', canonicalVenueId: mine };
      }
      return null;
    }
    if (source?.parse === 'jsonld-event') {
      const loc = record?.typed?.location;
      const lname = typeof loc === 'object' ? loc?.name : loc;
      const hit = (VENUE_ALIAS[source.identityId] || []).some((a) => String(lname || '').includes(a));
      if (!hit) return null;
      return { locality: source.locality, venueId: source.identityId, canonicalVenueId: source.canonicalVenueId };
    }
    return null;
  },
  classifyAddress(addr, { source, record } = {}) {
    if (source?.parse !== 'ig-post') return null;
    const low = String(record?.text ?? '').toLowerCase();
    if (OFF_SITE.some((p) => low.includes(p))) return null;
    const mine = watchId(source);
    const found = [...low.matchAll(/\b(\d+)\s+([a-z]+(?:\s+[a-z]+)?\s+(?:ave|avenue|st|street|rd|road))\b/gi)]
      .map((m) => `${m[1]} ${m[2]}`.replace(/\s+/g, ' '));
    const mineNorm = String(source.verifiedAddress || '').toLowerCase().replace(/\s+/g, ' ');
    const mineHit = found.some((a) => mineNorm.includes(a));
    const mismatch = found.some((a) => !mineNorm.includes(a) && CORE_STREETS.some((s) => a.includes(s)));
    if (mismatch) return null;
    if (source.requiresVenue && !mineHit && ![...NAMED_CORE.keys()].some((v) => low.includes(v))) return null;
    if (!source.singleLocation && !mineHit) return null;
    if (!mine) return null;
    return { locality: 'core', canonicalVenueId: mine };
  },
  classifySectionPlace(text, { source } = {}) {
    const t = String(text ?? '');
    const low = t.toLowerCase();
    const torontoCtx = low.includes('toronto') || low.includes('exhibition place') || source?.geography === 'Toronto';
    const addr = low.match(/\b(\d+)\s+(hanna ave|atlantic ave|liberty st|east liberty st|jefferson ave|mowat ave|fraser ave|pirandello st|snooker st|lynn williams st|western battery rd)\b/);
    if (addr && torontoCtx) return { locality: 'core', canonicalVenueId: canonAddr(addr[1], addr[2]) };
    for (const v of ADJ_VENUES) {
      if (low.includes(v.toLowerCase()) && torontoCtx) {
        if (v === 'Lamport Stadium') return { locality: 'core', canonicalVenueId: 'addr:75-fraser-ave' };
        return { locality: 'adjacent' };
      }
    }
    return null;
  },
  classifySegment(typed = {}) {
    const road = String(typed.road || '').toLowerCase();
    const span = `${typed.fromRoad || ''} ${typed.toRoad || ''}`.toLowerCase();
    if (!road) return null;
    if (/(hanna ave|atlantic ave|liberty st|jefferson ave|mowat ave|fraser ave|snooker st)/.test(road)) return { locality: 'core' };
    if (/strachan ave/.test(road) && /king|fleet|lake shore/.test(span)) return { locality: 'adjacent' };
    if (/king st/.test(road) && /strachan/.test(span)) return { locality: 'adjacent' };
    if (/lake shore/.test(road) && /newfoundland|martin goodman|strachan|dufferin|exhibition/.test(span)) return { locality: 'adjacent' };
    return { locality: 'not-LV' };
  },
};
function watchId(source) {
  const h = (source?.handle || '').toLowerCase();
  const addr = String(WATCH.get(h)?.addr || source?.verifiedAddress || '').toLowerCase();
  const m = addr.match(/(\d+[a-z]?)\s+([a-z]+(?:\s+[a-z]+)*)/);
  const expand = (s) => s.replace(/\be\b/g, 'east').replace(/\bw\b/g, 'west').replace(/\bn\b/g, 'north').replace(/\bs\b/g, 'south');
  if (!m) {
    if (/liberty village park/.test(addr)) return 'addr:70-east-liberty-st';
    return null;
  }
  let street = expand(m[2].replace(/,.*$/, '').trim());
  const unit = addr.match(/#\s*(\S+)/);
  return `addr:${m[1]}-${street.replace(/\s+/g, '-')}${unit ? `#${unit[1]}` : ''}`;
}
function hasAddressToken(low, addr) {
  const m = String(addr || '').toLowerCase().match(/(\d+)\s+([a-z]+(?:\s+[a-z]+)*)/);
  return !!m && low.includes(`${m[1]} ${m[2]}`.split(',')[0]);
}

// ------------------------------------------------------- harness (real path) ---
// Maps each conversion unit to its registry source. Discovery/blogTO-class
// rows go through rv2-serper-news (leads by design); dropped sources
// (reddit) are intentionally unregistered.
function sourceIdFor(u) {
  const id = u.unitId;
  if (/^(R07|R22|R38)/.test(id)) return 'rv2-coliseum';
  if (/^(R55|R56)/.test(id)) return 'rv2-bmo-field';
  if (/^R57/.test(id)) return 'rv2-coliseum';
  if (/^(R08|R24|R39|R58)/.test(id)) return 'rv2-rbc';
  if (/^(R09|R52|R53|R54|R62x|R63x|R64x)/.test(id)) return 'rv2-road-restrictions';
  if (id === 'R20') return 'rv2-lv-bia-events';
  if (id === 'R50') return 'rv2-city-projects';
  if (id === 'R37') return 'rv2-canada-soccer';
  if (/^R59/.test(id)) return 'rv2-enercare';
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
    if (u.unitId === 'R59c') continue; // review-held: no captured record text
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
      signal.post = { shortCode: shortCodeOf(u), caption: bodyTextOf(u.bodies[0].file),
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

// A4 capture-time availability guard (owner-approved over the record-metadata
// alternative, which would publish W38/W39 early): a unit enters in its
// backtest week; it rolls into a later week only while every intermediate
// week held AND its capture is clock-independent (wayback/provider-archive).
// Live/archive bodies captured after the clock are pinned to their week.
function gatePass(u, week, held, coveredKeys) {
  const exp = u.expected;
  if (exp.week === week) return true;
  // Already-covered keys pass so long-running items (R09) can be verified,
  // excluded as previously-covered, and named under Still in effect (sec 7).
  if (coveredKeys?.has(u.occurrenceKey)) return true;
  if (exp.week < week && exp.week >= 37 &&
    Array.from({ length: week - exp.week }, (_, i) => exp.week + i).every((w) => held.includes(w))) {
    const b = u.bodies[0];
    if ((b.capture === 'live' || b.capture === 'archive') && b.capturedAfterClock) return false;
    return true;
  }
  return false;
}

async function runRealScenario(verify, plan, { floorR37 }) {
  const weeks = {};
  const posts = [];
  const held = [];
  // Fixture occurrenceKeys predate the §6.6 key format the product emits, so
  // the product's covered keys never match them. Bridge: once a week
  // publishes, the occurrenceKeys of its counted/still units re-enter later
  // pools for still-in-effect evaluation (coverage semantics, fixture keys).
  const coveredOcc = new Set();
  for (const week of [37, 38, 39, 40]) {
    weeks[week] = [];
    for (const clock of SLOTS[week]) {
      const coveredKeys = new Set(typeof V.covered === 'function' ? V.covered(posts) : []);
      for (const k of coveredOcc) coveredKeys.add(k);
      const pool = UNITS.filter((u) => gatePass(u, week, held, coveredKeys));
      const { signals, forms } = buildInputs(pool, { floorR37 });
      const result = await verify({ signals, forms, now: clock, posts,
        fetcher, recordExtractor, geography: GEO, sources: SOURCES, publisherTiers: TIERS });
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
        const named = new Set([...p.countedItems.map((i) => i.subject),
          ...p.stillInEffect.map((i) => i.subject)]);
        for (const u of pool) if (named.has(u.form.subject) && u.occurrenceKey) coveredOcc.add(u.occurrenceKey);
        break;
      }
    }
    if (weeks[week][weeks[week].length - 1].decision !== 'publish') held.push(week);
  }
  return weeks;
}

// ------------------------------------------------------------------ tests ---
const V = await (async () => {
  try {
    const v = await import('../../scripts/news-pilot/roundup-verify.mjs');
    const r = await import('../../scripts/news-pilot/roundup.mjs');
    if (typeof v.verifyRoundupForms === 'function' && typeof r.planRoundupV2 === 'function') {
      return { integrated: true, verify: v.verifyRoundupForms, plan: r.planRoundupV2, covered: r.roundupCoveredKeys };
    }
  } catch { /* interim path below */ }
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
    R23x: 'duplicate', R04x: 'crime', R42x: 'election',
    R01x: 'weak-source', R05x: 'weak-source', R06x: 'weak-source', R21x: 'weak-source',
    R32x: 'weak-source', R33x: 'weak-source', R36x: 'weak-source',
    R51x: 'weak-source', R60x: 'weak-source',
    R10x: 'unverifiable', R25x: 'unverifiable', R11x: 'unverifiable', R30x: 'unverifiable',
    R12x: 'unverifiable', R13x: 'unverifiable',
    R16x: 'not-LV', R17x: 'weak-source', R18x: 'weak-source', R19x: 'stale',
    R31x: 'not-LV', R40x: 'undated', R48x: 'not-LV', R49x: 'weak-source',
    R61: 'undated', R34x: 'undated', R35x: 'undated', R59c: 'unverifiable',
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
    const w = await runRealScenario(V.verify, V.plan, { floorR37: false });
    const first = (t) => t[0];
    assert.equal(first(w[37]).decision, 'publish');
    assert.deepEqual([first(w[37]).units, first(w[37]).core, first(w[37]).anchors], [8, 3, 1]);
    assert.ok(first(w[37]).ids.includes('Eco-Fair'), 'IG084 anchors W37');
    for (const slot of w[38]) {
      assert.equal(slot.decision, 'hold');
      assert.ok(slot.reasons.includes('below-minimum'));
    }
    assert.deepEqual([w[38][0].units, w[38][0].core, w[38][0].anchors], [2, 1, 1]);
    // R09 re-presents via coverage and is excluded previously-covered at the
    // verify layer. End-to-end still stays empty because the verifier filters
    // covered items before the planner sees them; the planner's stillInEffect
    // path is proven separately below with post-free items.
    const r09sig = byId.get('R09').form.signalId;
    assert.ok(w[38][0].verifyExcluded.some((e) => e.signalId === r09sig &&
      e.reason === 'previously-covered'), 'R09 previously-covered at W38');
    assert.deepEqual(w[38][0].still, [], 'no post-free items reach the planner end-to-end');
    // IG117 verifies (dated LV post) but shares R20's venue-day with a
    // different subject, so the planner holds it duplicate-ambiguous.
    assert.ok(w[38][0].excluded.some((e) => e.subject.includes('BURGER DROPS') &&
      e.reason === 'duplicate-ambiguous'), 'IG117 venue-day ambiguous vs R20');
    // W39 holds in both scenarios: IG193 day-first date cannot resolve and
    // R37's DD/MM/YYYY dateline is outside the record grammar (plus the
    // frozen revision post-dates the clock), so no core anchor verifies.
    for (const slot of w[39]) assert.equal(slot.decision, 'hold');
    assert.deepEqual([w[39][1].units, w[39][1].core, w[39][1].anchors], [1, 0, 0]);
    assert.ok(w[39][1].ids.includes('Shaboozey - Outlaws Never Die Tour'));
    const r37sig = byId.get('R37').form.signalId;
    for (const slot of w[39]) assert.ok(slot.verifyExcluded.some((e) =>
      e.signalId === r37sig && e.reason === 'undated'), 'R37 undated in ceiling too');
    assert.ok(w[39][1].verifyExcluded.some((e) => e.reason === 'undated' &&
      unitsOf(e).includes('IG193')), 'IG193 excluded undated by the real verifier');
    assert.equal(first(w[40]).decision, 'publish');
    assert.deepEqual([first(w[40]).units, first(w[40]).core, first(w[40]).anchors], [12, 4, 3]);
    assert.deepEqual(new Set(first(w[40]).cut),
      new Set([byId.get('R56a').form.subject, byId.get('R56b').form.subject]));
    assert.ok(first(w[40]).ids.includes(byId.get('IG215').form.subject), 'IG215 core class');
  });

  test('REAL replay: floor holds W39 and publishes W40 without R37', async () => {
    const w = await runRealScenario(V.verify, V.plan, { floorR37: true });
    assert.equal(w[37][0].decision, 'publish');
    for (const slot of w[38]) assert.equal(slot.decision, 'hold');
    for (const slot of w[39]) {
      assert.equal(slot.decision, 'hold');
      assert.ok(slot.reasons.includes('below-minimum'));
    }
    assert.deepEqual([w[39][1].units, w[39][1].core, w[39][1].anchors], [1, 0, 0]);
    assert.equal(w[40][0].decision, 'publish');
    assert.deepEqual([w[40][0].units, w[40][0].core, w[40][0].anchors], [12, 4, 3]);
  });

  test('REAL planner names covered roads still in effect (product pattern)', async () => {
    // Mirrors the product's own plan test: items verified against older posts
    // are re-planned against current coverage. R09 verifies post-free, then
    // the W37 coverage post moves it to stillInEffect (road, active).
    const u = byId.get('R09');
    const r = await V.verify({ ...buildInputs([u]), now: SLOTS[38][0], posts: [],
      fetcher, recordExtractor, geography: GEO, sources: SOURCES, publisherTiers: TIERS });
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
    // GREEN with the product verifier+planner.
    const green = await runRealScenario(V.verify, V.plan, { floorR37: false });
    assert.equal(green[37][0].decision, 'publish');
    assert.deepEqual([green[37][0].units, green[37][0].core, green[37][0].anchors], [8, 3, 1]);
    // RED-1: a verifier that returns nothing flips W37 to hold/no-core.
    const emptyVerify = async () => ({ items: [], excluded: [], verifyDigest: 'empty-stub' });
    const red1 = await runRealScenario(emptyVerify, V.plan, { floorR37: false });
    assert.equal(red1[37][0].digest, 'empty-stub', 'empty stub really ran');
    assert.equal(red1[37][0].decision, 'hold', 'empty verifier cannot publish');
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

  test('REAL planner drops the ambiguous duplicate and the capped class', async () => {
    const w = await runRealScenario(V.verify, V.plan, { floorR37: false });
    const w37drop = w[37][0].excluded;
    assert.ok(w37drop.some((e) => e.reason === 'duplicate-ambiguous' &&
      e.subject.includes('Eco-Fair')), `IG074 dropped: ${JSON.stringify(w37drop)}`);
    const w40drop = w[40][0].excluded;
    assert.ok(w40drop.some((e) => e.reason === 'class-cap'), `IG223 capped: ${JSON.stringify(w40drop)}`);
  });

  test('REAL sensitivity: W37 core depends on the Eco-Fair evidence', async () => {
    const pool37 = UNITS.filter((u) => gatePass(u, 37, [], new Set()));
    const run = async (drop) => {
      const keep = pool37.filter((u) => !drop.includes(u.unitId) && u.unitId !== 'R59c');
      const { signals, forms } = buildInputs(keep);
      const clock = SLOTS[37][0];
      const result = await V.verify({ signals, forms, now: clock, posts: [],
        fetcher, recordExtractor, geography: GEO, sources: SOURCES, publisherTiers: TIERS });
      return V.plan(result.items, { now: clock, posts: [] });
    };
    // Without IG084 the all-day IG074 record still anchors: a singleton
    // counts, because ambiguity needs a rival. This documents the §6.6
    // boundary; the spec's sensitivity line predates it.
    const a = await run(['IG084']);
    assert.equal(a.decision, 'publish');
    assert.ok(a.countedItems.some((i) => i.subject.includes('Eco-Fair') &&
      (i.locality || i.verdict) === 'core'), 'IG074 singleton anchors');
    // Without the whole Eco-Fair evidence the week holds for no core.
    const b = await run(['IG084', 'IG074x']);
    assert.equal(b.decision, 'hold');
    assert.ok(b.reasons.includes('no-core'));
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
      ['R61', '2026-09-29T15:00:00Z', 'undated'],
      ['IG221x', '2026-09-29T15:00:00Z', 'unverifiable'],
      // IG117x is evidence-admissible solo (dated LV post, verifies) and is
      // planner-dropped duplicate-ambiguous in the W38 pool instead; both
      // are asserted in the ceiling test, so it is not a must-not-verify.
      ['IG042x', '2026-09-09T16:00:00Z', 'source-swapped'],
      ['IG124x', '2026-09-16T16:00:00Z', 'retrospective'],
      ['IG227x', '2026-09-29T15:00:00Z', 'retrospective'],
      ['IG158x', '2026-09-20T16:00:00Z', 'concluded'],
      ['IG200x', '2026-09-27T16:00:00Z', 'concluded'],
      ['R10x', '2026-09-09T16:00:00Z', 'unverifiable'],
      ['R12x', '2026-09-09T16:00:00Z', 'record-missing'],
    ];
    for (const [id, clock, reason] of controls) {
      const { signals, forms } = buildInputs([byId.get(id)]);
      const r = await V.verify({ signals, forms, now: clock, posts: [],
        fetcher, recordExtractor, geography: GEO, sources: SOURCES, publisherTiers: TIERS });
      assert.equal(r.items.length, 0, `${id} must not verify`);
      assert.equal(r.excluded[0]?.reason, reason, `${id} real reason`);
    }
  });

  test('REAL source-quality predicate on fixture evidence tiers', () => {
    const entry = (tier, domain) => ({ itemBound: true, extractionSubstantive: true, fetchOk: true, tier, publisherDomain: domain });
    assert.equal(roundupSourceQuality([entry('official', 'canadasoccer.com')]), true);
    assert.equal(roundupSourceQuality([entry('primary', 'nrghaus.com')]), true);
    assert.equal(roundupSourceQuality([entry('lead', 'blogto.com')]), false);
    assert.equal(roundupSourceQuality([entry('reputable', 'thestar.com')]), false);
    assert.equal(roundupSourceQuality([entry('lead', 'blogto.com'), entry('lead', 'cbc.ca')]), true);
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

function unitsOf(e) {
  return UNITS.filter((u) => u.form.signalId === e.signalId).map((u) => u.unitId);
}

// ------------------------------------------- interim path (verifier absent) ---
// Deterministic local implementation of the section 6/7 rules over the
// reviewed conversion. Used only when roundup-verify.mjs is absent (spec A7:
// no implementation until accepted). The review exclusions below mirror the
// real pipeline's outputs (IG193 undated, R59c/R61 excluded by review);
// any divergence from the real path is a defect, not a bypass.
const REVIEW_EXCLUDED = new Set(['IG193', 'R59c', 'R61']);
const isoWeekOfClock = (iso) => {
  if (iso < '2026-09-14T00:00:00Z') return 37;
  if (iso < '2026-09-21T00:00:00Z') return 38;
  if (iso < '2026-09-28T00:00:00Z') return 39;
  return 40;
};
const eodT = (date) => new Date(`${date}T23:59:59-04:00`).getTime();
let simDateline = true;
function simAvailable(u, clockIso) {
  const C = Date.parse(clockIso);
  const clockDate = clockIso.slice(0, 10);
  const cf = u.clockFacts, exp = u.expected;
  if (exp.class !== 'eligible' || REVIEW_EXCLUDED.has(u.unitId)) return false;
  if (exp.conditional === 'ceiling-key') return false;
  if (u.unitId === 'R37' && !simDateline) return false;
  if (cf.kind === 'news') return !!cf.dateline && cf.dateline <= clockDate;
  if (cf.kind === 'ig') {
    if (!(cf.timestamp <= clockIso)) return false;
    const end = cf.endTime && cf.date ? Date.parse(`${cf.date}T${cf.endTime}:00-04:00`)
      : cf.date ? eodT(cf.date) : Infinity;
    return end > C;
  }
  const end = cf.endDate ? eodT(cf.endDate) : cf.date ? eodT(cf.date) : Infinity;
  if (!(end > C)) return false;
  const b = u.bodies[0];
  if (b.capturedAfterClock && (b.capture === 'live' || b.capture === 'archive')) {
    if (exp.week !== isoWeekOfClock(clockIso)) return false;
  }
  return true;
}
function simVenue(u) {
  if (u.clockFacts.venue) return u.clockFacts.venue;
  const m = (u.occurrenceKey || '').match(/^occ:venue:([^:]+)/);
  return m ? `venue:${m[1]}` : `url:${u.bodies[0].url}`;
}
function simReplayWeek(week, covered, held) {
  const table = [];
  for (const clock of SLOTS[week]) {
    const pooled = UNITS.filter((u) => u.expected.week === week ||
      (u.expected.week < week && u.expected.week >= 37 &&
        Array.from({ length: week - u.expected.week }, (_, i) => u.expected.week + i)
          .every((w) => held.includes(w))));
    const avail = pooled.filter((u) => simAvailable(u, clock));
    const fresh = avail.filter((u) => !(u.occurrenceKey && covered.has(u.occurrenceKey)));
    const concerts = new Map(), units = [];
    for (const u of fresh) {
      const agg = u.aggregate || (u.form.item_type === 'concert' ? `agg:${simVenue(u)}:${week}` : null);
      if (!agg) { units.push({ parts: [u] }); continue; }
      if (!concerts.has(agg)) concerts.set(agg, []);
      concerts.get(agg).push(u);
    }
    for (const parts of concerts.values()) units.push({ parts });
    const seenClass = new Map(), kept = [];
    for (const grp of units) {
      const u0 = grp.parts[0];
      if (u0.form.item_type === 'class') {
        const v = u0.occurrenceKey ? u0.occurrenceKey.split(':').slice(0, 3).join(':') : u0.unitId;
        const d = grp.parts.map((p) => p.clockFacts.date).sort()[0];
        const prev = seenClass.get(v);
        if (prev === undefined || d < prev) {
          if (prev !== undefined) kept.splice(kept.findIndex((g) => g.parts[0].unitId === u0.unitId), 1);
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
    table.push({ clock, decision, reasons, units: kept.length, core: core.length,
      anchors: anchors.length, ids: ids(ordered), published: ids(ordered.slice(0, 12)),
      cut: ids(ordered.slice(12)) });
    if (decision === 'publish') {
      for (const g of kept) for (const p of g.parts) if (p.occurrenceKey) covered.add(p.occurrenceKey);
      break;
    }
  }
  return table;
}
function simScenario({ dateline }) {
  simDateline = dateline;
  const covered = new Set(), held = [], out = {};
  for (const w of [37, 38, 39, 40]) {
    out[w] = simReplayWeek(w, covered, held);
    if (out[w][out[w].length - 1].decision !== 'publish') held.push(w);
  }
  return out;
}

if (!V.integrated) {
  // INTERIM PATH — A7 fallback only, NOT A4 acceptance. When the verifier
  // is absent this surrogate replays the reviewed table; a green run here
  // must never be reported as an A4 pass.
  test('INTERIM (A7, not A4): replay equals the reviewed table while the verifier is absent', () => {
    assert.ok(!V.integrated, 'interim only');
    console.log('    INTEGRATION verifier+plan: pending-integration (interim replay, NOT an A4 pass)');
    for (const dateline of [true, false]) {
      const w = simScenario({ dateline });
      const first = (t) => t[0];
      assert.equal(first(w[37]).decision, 'publish');
      assert.deepEqual([first(w[37]).units, first(w[37]).core, first(w[37]).anchors], [8, 3, 1]);
      for (const slot of w[38]) assert.equal(slot.decision, 'hold');
      for (const slot of w[39]) {
        assert.equal(slot.decision, 'hold');
        assert.ok(slot.reasons.includes('below-minimum'));
      }
      assert.equal(first(w[40]).decision, 'publish');
      assert.deepEqual([first(w[40]).units, first(w[40]).core, first(w[40]).anchors], [14, 4, 3]);
      assert.equal(first(w[40]).published.length, 12);
    }
  });
} else {
  test('verifier+plan integration is live (no interim surrogate)', () => {
    console.log('    INTEGRATION verifier+plan: integrated');
    assert.ok(V.integrated);
  });
}
