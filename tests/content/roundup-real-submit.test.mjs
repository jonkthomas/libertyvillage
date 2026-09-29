// Weekly roundup v2 real-pipeline submit boundary (docs/specs/weekly-roundup-v2.md
// §7, §9.2, §9.4). Everything is the production module: source registry, HTML
// extractor, verifier, geography, planner, assembler, post policy, submit and
// the local PostgreSQL store. Only HTTP bodies, the writer/reviewer model and
// the clock are injected. Event bodies are synthetic code-path fixtures, never
// historical or live evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hasTestDb, seededDb } from './fixtures/content-db.mjs';
import { submitContent } from '../../scripts/content/submit.mjs';
import { runRoundupV2 } from '../../scripts/news-pilot/roundup-v2-run.mjs';
import { extractRoundupRecords } from '../../scripts/news-pilot/roundup-records.mjs';
import { ROUNDUP_SOURCES } from '../../scripts/news-pilot/sources.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
const now = '2026-09-29T15:00:00.000Z';
const submitClock = Date.parse(now) + 60_000;
const CHANGED = /roundup source evidence changed or unreachable; rebuild before submit/;
const PRIVATE = 'Jane Resident';
const sha = (value) => createHash('sha256').update(value).digest('hex');

const bia = ROUNDUP_SOURCES.find((source) => source.id === 'rv2-lv-bia-events');
const park = ROUNDUP_SOURCES.find((source) => source.id === 'rv2-city-project-34-hanna-park');
const street = ROUNDUP_SOURCES.find((source) => source.id === 'rv2-city-project-liberty-st');

const section = (n, extra = '') => `<section><h2>Autumn Market ${n}</h2><p>Date: October ${n}, 2026</p>` +
  `<p>Location: 171 East Liberty St, Toronto.</p><p>A public community market with local makers.${extra}</p></section>`;

// Three official pages, one market each (a page URL may back only one unit).
// Optionally the BIA page also holds a fourth market whose record names a
// private resident, so the refused unit shares its signal with a safe unit.
function edition({ privateUnit = false } = {}) {
  const bodies = {
    [bia.url]: `<main>${section(1)}${privateUnit ? section(4, ` Hosted by neighbour ${PRIVATE} from her home.`) : ''}</main>`,
    [park.url]: `<main>${section(2)}</main>`,
    [street.url]: `<main>${section(3)}</main>`,
  };
  const signal = (id, source) => ({ signalId: id, sourceId: source.id, url: source.url,
    records: extractRoundupRecords({ source, url: source.url, body: bodies[source.url] }),
    snapshotSha256: sha(bodies[source.url]), fetchedAt: now,
    fetchStatus: 200 }); // Synthetic captured HTTP fixture returns 200; not historical evidence.
  const signals = [signal('sig-bia', bia), signal('sig-park', park), signal('sig-street', street)];
  const form = (signalRef, record, n) => ({ signalId: signalRef.signalId, recordId: record.recordId, subject: `Autumn Market ${n}`,
    what: 'Public community market', where_it_happens: '171 East Liberty St', item_type: 'event', people: [], risk: {}, verdict: 'core',
    exclude_reason: null, when: { kind: 'event', date: `2026-10-0${n}`, endDate: null, startTime: null, endTime: null },
    evidence: [{ url: signalRef.url, recordId: record.recordId, subject_quote: `Autumn Market ${n}`,
      place_quote: 'Location: 171 East Liberty St, Toronto.', date_quote: `October ${n}, 2026` }] });
  const [biaSignal, parkSignal, streetSignal] = signals;
  const forms = [form(biaSignal, biaSignal.records[0], 1), form(parkSignal, parkSignal.records[0], 2), form(streetSignal, streetSignal.records[0], 3)];
  if (privateUnit) forms.push(form(biaSignal, biaSignal.records[1], 4));
  return { bodies, signals, forms, fetcher: fetcherFor(bodies) };
}
const fetcherFor = (bodies) => async (url) => (bodies[url] ? { body: bodies[url], status: 200 } : { body: '', status: 404 });

// The injected writer/reviewer model: a verbatim draft per counted unit, and a
// round-2 private-individual finding for any unit whose subject is `refuse`.
const writer = ({ refuse = null } = {}) => async (pack) => {
  const refused = pack.units.filter((unit) => unit.subject === refuse).map((unit) => unit.identityKey);
  const units = pack.units.filter((unit) => !refused.includes(unit.identityKey));
  return {
    draft: { intro: 'Community markets are scheduled in Liberty Village this week.',
      units: units.map((unit) => ({ unitId: unit.identityKey, heading: unit.subject, body: `${unit.subject} is a public market in Liberty Village on ${unit.date}.` })) },
    findings: [{ round: 1, findings: [] }, { round: 2, findings: refused.map((unitId) => ({ unitId, person: PRIVATE, problem: 'private-individual',
      fix: `Remove ${PRIVATE}` })) }],
    refused, units,
  };
};

async function pipeline(input, { refuse, at = now } = {}) {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-roundup-real-run-'));
  const out = path.join(run, 'out');
  const built = await runRoundupV2({ run, out, root: ROOT, now: at, dryRun: true }, {
    signals: input.signals, reasoned: { forms: input.forms, excluded: [] }, verifyOptions: { fetcher: input.fetcher }, write: writer({ refuse }),
  });
  if (built.post) fs.writeFileSync(path.join(out, 'post.json'), JSON.stringify(built.post));
  fs.writeFileSync(path.join(out, 'baseline.json'), JSON.stringify({ datasets: { posts: { entries: {} } } }));
  return { ...built, out };
}

const submitOpts = (out, idempotencyKey) => ({ kind: 'roundup', actor: 'uat:roundup-real', idempotencyKey, recordFile: path.join(out, 'post.json'),
  dataset: 'posts', baseline: path.join(out, 'baseline.json'), root: ROOT, roundupOut: out });
const submit = (db, out, key, fetcher, at = submitClock) =>
  submitContent(db, submitOpts(out, key), { checkout: ROOT, clock: () => at, roundup: { fetcher } });

async function allowRoundupKind(db) {
  const constraint = (await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='content.submissions'::regclass and conname='submissions_kind_check'")).rows[0]?.definition || '';
  if (constraint.includes("'roundup'")) return;
  await db.query('alter table content.submissions drop constraint submissions_kind_check');
  await db.query("alter table content.submissions add constraint submissions_kind_check check (kind in ('seed','business','blog','blog-live','news','roundup','seo','topic-discovery','manual','admin'))");
}
async function setup(t) {
  const handle = await seededDb();
  await allowRoundupKind(handle.db);
  t.after(() => handle.close());
  return handle;
}
const roundupRows = async (db) => (await db.query("select count(*)::int as n from content.submissions where kind='roundup'")).rows[0].n;

test('real pipeline plans a 3/1 edition that the real planner reports as a count plus counted items', async () => {
  const built = await pipeline(edition());
  assert.equal(built.result.decision, 'publish', JSON.stringify(built.result.reasons));
  assert.equal(built.result.units, 3);
  assert.equal(built.result.coreAnchorUnits, 3);
  assert.equal(built.pack.units.length, 3);
  assert.ok(built.post, 'assembled post passed the real post policy');
});

test('round-2 refusal below 3/1 holds, and a refusal naming no counted unit holds as writer-failed', async () => {
  const below = await pipeline(edition(), { refuse: 'Autumn Market 1' });
  assert.equal(below.result.decision, 'hold');
  assert.ok(below.result.reasons.includes('below-minimum'));
  assert.equal(below.post, null);
  const input = edition({ privateUnit: true });
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-roundup-real-run-'));
  for (const unitId of ['2', null]) {
    const unknown = await runRoundupV2({ run, out: path.join(run, `out-${unitId}`), root: ROOT, now, dryRun: true }, {
      signals: input.signals, reasoned: { forms: input.forms, excluded: [] }, verifyOptions: { fetcher: input.fetcher },
      write: async (pack) => ({ ...(await writer()(pack)), refused: [unitId] }),
    });
    assert.equal(unknown.result.decision, 'hold', String(unitId));
    assert.equal(unknown.result.census.writerError, 'roundup_refused_unit_unknown');
    assert.equal(unknown.post, null);
  }
});

test('real extractor -> verifier -> planner -> assembler -> DB submit accepts the edition and stores real evidence', { skip }, async (t) => {
  const ctx = await setup(t);
  const input = edition();
  const built = await pipeline(input);
  const accepted = await submit(ctx.db, built.out, 'real-accept', input.fetcher);
  assert.ok(accepted.result.submissionId, JSON.stringify(accepted.result));
  const stored = (await ctx.db.query('select context from content.submissions where id=$1', [accepted.result.submissionId])).rows[0].context;
  assert.equal(stored.pipeline, 'structured-v2');
  assert.equal(stored.packDigest, built.result.packDigest);
  assert.equal(stored.now, now);
  assert.equal(stored.temporalValidationNow, new Date(submitClock).toISOString());
  assert.deepEqual(stored.counts, { units: 3, coreUnits: 3, coreAnchorUnits: 3 });
  assert.deepEqual(stored.units.map((unit) => unit.identityKey).sort(), built.pack.units.map((unit) => unit.identityKey).sort());
  assert.deepEqual(stored.units.map((unit) => unit.date).sort(), ['2026-10-01', '2026-10-02', '2026-10-03']);
  for (const unit of stored.units) {
    assert.equal(unit.verdict, 'core');
    assert.ok(unit.citations.length >= 1 && unit.citations.every((citation) => [bia.url, park.url, street.url].includes(citation.url)));
    assert.match(unit.evidence[0].subject_quote, /^Autumn Market [123]$/);
    assert.match(unit.evidence[0].date_quote, /^October [123], 2026$/);
    const entry = unit.evidence[0];
    assert.ok(entry.typed && typeof entry.typed === 'object', 'typed fields survive real verification and DB projection');
    assert.equal(entry.snapshotSha256, sha(input.bodies[entry.url]), 'freshly re-fetched body, not merely an old capture hash');
    assert.equal(entry.fetchStatus, 200, 'the captured fixture response code survives the real submit projection');
    assert.equal(entry.verifyStatus, 200, 'the independent submit refetch records its actual HTTP status');
    assert.ok(Number.isFinite(Date.parse(entry.verifiedAt)), 'verification wall-clock provenance is durable');
  }
  assert.deepEqual(stored.roundupCoverage, built.post.roundupCoverage);
  // Idempotent replay returns the stored context without re-verifying.
  const replay = await submit(ctx.db, built.out, 'real-accept', fetcherFor({}));
  assert.equal(replay.result.submissionId, accepted.result.submissionId);
  assert.equal(await roundupRows(ctx.db), 1);
});

test('real DB submit still refuses changed, unreachable or stale evidence and a sub-3/1 edition', { skip }, async (t) => {
  const ctx = await setup(t);
  const input = edition();
  const built = await pipeline(input);
  const moved = { ...input.bodies, [street.url]: input.bodies[street.url].replace('October 3, 2026', 'October 4, 2026') };
  await assert.rejects(submit(ctx.db, built.out, 'real-moved', fetcherFor(moved)), CHANGED, 'changed date');
  await assert.rejects(submit(ctx.db, built.out, 'real-gone', fetcherFor({ [bia.url]: input.bodies[bia.url], [park.url]: input.bodies[park.url] })), CHANGED, 'unreachable page');
  const cancelled = { ...input.bodies, [park.url]: input.bodies[park.url].replace('Autumn Market 2</h2>', 'Autumn Market 2 cancelled</h2>') };
  await assert.rejects(submit(ctx.db, built.out, 'real-cancelled', fetcherFor(cancelled)), /below 3 units \/ 1 core anchor at submit/, 'unit concluded at T_submit');
  await assert.rejects(submit(ctx.db, built.out, 'real-stale', input.fetcher, Date.parse(now) + 6 * 3600_000 + 1), /must be revalidated before submit/);
  const tampered = JSON.parse(fs.readFileSync(path.join(built.out, 'pack.json'), 'utf8'));
  tampered.units = tampered.units.slice(0, 2);
  fs.writeFileSync(path.join(built.out, 'pack.json'), JSON.stringify(tampered));
  await assert.rejects(submit(ctx.db, built.out, 'real-tampered', input.fetcher), /packDigest mismatch/);
  assert.equal(await roundupRows(ctx.db), 0);
});

test('round-2 private-person refusal: four units -> three safe units -> submit succeeds without retaining the refused record', { skip }, async (t) => {
  const ctx = await setup(t);
  const input = edition({ privateUnit: true });
  const built = await pipeline(input, { refuse: 'Autumn Market 4' });
  assert.equal(built.result.decision, 'publish', JSON.stringify(built.result.reasons));
  assert.equal(built.result.units, 3);
  assert.deepEqual(built.pack.units.map((unit) => unit.subject).sort(), ['Autumn Market 1', 'Autumn Market 2', 'Autumn Market 3']);
  const refusedRecord = input.forms[3].recordId;
  assert.ok(!built.pack.forms.some((form) => form.recordId === refusedRecord), 'refused form removed from the pack');
  assert.ok(!built.pack.signals.some((signal) => signal.records.some((record) => record.recordId === refusedRecord)), 'refused record removed from its signal');
  assert.equal(built.pack.refusedKeyDigests.length, 1);
  assert.match(built.pack.refusedKeyDigests[0], /^[0-9a-f]{64}$/);
  for (const file of fs.readdirSync(built.out)) {
    assert.ok(!fs.readFileSync(path.join(built.out, file), 'utf8').includes(PRIVATE), `${file} retains the private person`);
    assert.ok(!fs.readFileSync(path.join(built.out, file), 'utf8').includes('Autumn Market 4'), `${file} retains the refused unit`);
  }
  const accepted = await submit(ctx.db, built.out, 'real-refused', input.fetcher);
  assert.ok(accepted.result.submissionId, JSON.stringify(accepted.result));
  const stored = (await ctx.db.query('select context from content.submissions where id=$1', [accepted.result.submissionId])).rows[0].context;
  assert.equal(stored.counts.units, 3);
  assert.ok(!JSON.stringify(stored).includes(PRIVATE) && !JSON.stringify(stored).includes('Autumn Market 4'));
});

test('submit never re-admits a refused key, even when a pack still carries a form for it', { skip }, async (t) => {
  const ctx = await setup(t);
  const input = edition({ privateUnit: true });
  const built = await pipeline(input, { refuse: 'Autumn Market 4' });
  // A pack that kept the refused form and record (the pre-fix runner shape), with
  // its digest recomputed: submit must exclude the refused key, not publish it.
  const pack = JSON.parse(fs.readFileSync(path.join(built.out, 'pack.json'), 'utf8'));
  pack.signals = input.signals;
  pack.forms = input.forms;
  const { roundupPackDigest } = await import('../../scripts/news-pilot/roundup-evidence.mjs');
  const result = JSON.parse(fs.readFileSync(path.join(built.out, 'result.json'), 'utf8'));
  fs.writeFileSync(path.join(built.out, 'pack.json'), JSON.stringify(pack));
  fs.writeFileSync(path.join(built.out, 'result.json'), JSON.stringify({ ...result, packDigest: roundupPackDigest(pack) }));
  const accepted = await submit(ctx.db, built.out, 'real-readmit', input.fetcher);
  const stored = (await ctx.db.query('select context from content.submissions where id=$1', [accepted.result.submissionId])).rows[0].context;
  assert.deepEqual(stored.units.map((unit) => unit.label).sort(), ['Autumn Market 1', 'Autumn Market 2', 'Autumn Market 3']);
  // Without the refusal record, the same pack re-admits market 4 and is refused as changed.
  delete pack.refusedKeyDigests;
  fs.writeFileSync(path.join(built.out, 'pack.json'), JSON.stringify(pack));
  fs.writeFileSync(path.join(built.out, 'result.json'), JSON.stringify({ ...result, packDigest: roundupPackDigest(pack) }));
  await assert.rejects(submit(ctx.db, built.out, 'real-readmit-unmarked', input.fetcher), CHANGED);
  // A malformed refusal record is refused outright.
  pack.refusedKeyDigests = ['not-a-digest'];
  fs.writeFileSync(path.join(built.out, 'pack.json'), JSON.stringify(pack));
  fs.writeFileSync(path.join(built.out, 'result.json'), JSON.stringify({ ...result, packDigest: roundupPackDigest(pack) }));
  await assert.rejects(submit(ctx.db, built.out, 'real-readmit-malformed', input.fetcher), /refusedKeyDigests/);
  assert.equal(await roundupRows(ctx.db), 1);
});

// B2-R1: `when.kind` is a model field. The same three official event sections,
// relabelled away from `event`, must not reach a roundup row once concluded.
const b2Now = '2026-10-03T21:00:00.000Z'; // Sat 17:00 Toronto: Oct 1 16:00, Oct 2 10:00 and Oct 3 16:00 have started
function relabelled(kind, { posted = false } = {}) {
  const input = edition();
  const clock = (n) => (posted ? `${3 + n}pm` : n === 2 ? '10am' : '4pm');
  const day = (n) => (posted ? 1 : n);
  input.bodies = Object.fromEntries([bia, park, street].map((source, i) => [source.url, `<main><section><h2>Autumn Market ${i + 1}</h2>` +
    `${posted ? `<p>Posted October 1, 2026</p>` : ''}<p>Date: October ${day(i + 1)}, 2026. Starts at ${clock(i + 1)}.</p>` +
    '<p>Location: 171 East Liberty St, Toronto.</p><p>A public community market with local makers.</p></section></main>']));
  input.signals.forEach((signal) => {
    const source = [bia, park, street].find((s) => s.url === signal.url);
    signal.records = extractRoundupRecords({ source, url: signal.url, body: input.bodies[signal.url] });
    signal.snapshotSha256 = sha(input.bodies[signal.url]);
  });
  input.forms.forEach((form, i) => {
    form.recordId = input.signals[i].records[0].recordId;
    form.when = { ...form.when, kind, date: `2026-10-0${day(i + 1)}` };
    form.evidence[0] = { ...form.evidence[0], recordId: form.recordId,
      date_quote: posted ? 'Posted October 1, 2026' : `October ${day(i + 1)}, 2026` };
  });
  input.fetcher = fetcherFor(input.bodies);
  return input;
}

test('B2-R1: concluded event sections relabelled news-update, restriction or alert hold and leave 0 roundup rows', { skip }, async (t) => {
  const ctx = await setup(t);
  for (const kind of ['event', 'news-update', 'restriction', 'alert']) {
    const input = relabelled(kind);
    const built = await pipeline(input, { at: b2Now });
    if (built.post) await submit(ctx.db, built.out, `b2r-${kind}`, input.fetcher, Date.parse(b2Now) + 60_000);
    assert.equal(await roundupRows(ctx.db), 0, `${kind} persisted a concluded edition`);
    assert.equal(built.result.decision, 'hold', kind);
    assert.equal(built.result.units, 0, kind);
    assert.ok(built.result.reasons.includes('below-minimum'), kind);
    assert.equal(built.post, null, kind);
  }
});

test('B2-R1: a posted news-update for a same-day event section is refused at T_submit once the stated start passes', { skip }, async (t) => {
  const ctx = await setup(t);
  const input = relabelled('news-update', { posted: true });
  const planned = '2026-10-01T16:00:00.000Z'; // Thu 12:00 Toronto, before the 16:00, 17:00 and 18:00 starts
  const built = await pipeline(input, { at: planned });
  assert.equal(built.result.decision, 'publish', JSON.stringify(built.result.reasons));
  assert.equal(built.result.units, 3);
  await assert.rejects(submit(ctx.db, built.out, 'b2r-started', input.fetcher, Date.parse('2026-10-01T20:01:00.000Z')),
    /below 3 units \/ 1 core anchor at submit|rebuild before submit/);
  assert.equal(await roundupRows(ctx.db), 0);
  const accepted = await submit(ctx.db, built.out, 'b2r-before-start', input.fetcher, Date.parse('2026-10-01T19:59:00.000Z'));
  assert.ok(accepted.result.submissionId, JSON.stringify(accepted.result));
  assert.equal(await roundupRows(ctx.db), 1);
});
