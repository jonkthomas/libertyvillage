// Synthetic weekly roundup v2 fixtures (synthetic: true; code-path tests only,
// never A4 replay data). The stub verifier/planner honours the agreed sibling
// contract — verifyRoundupForms({signals,forms,now,posts,fetcher?,igRefetch?}) =>
// {items,excluded,verifyDigest}, planRoundupV2(items,{now,posts}) =>
// {decision,units,coreUnits,coreAnchorUnits,reasons,stillInEffect},
// roundupCoverageFromPack(pack) — so content submit, gate and the runner can be
// exercised before the real verifier is cherry-picked. Each form carries its
// test unit; the stub never fetches.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../scripts/automation/blog-source-pack.mjs';
import { roundupPackDigest } from '../../../scripts/news-pilot/roundup-evidence.mjs';
import { isoWeekOf, roundupSlug } from '../../../scripts/news-pilot/roundup.mjs';

export const synthetic = true;
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const humanDate = (date) => { const [y, m, d] = date.split('-').map(Number); return `${LONG[m - 1]} ${d}, ${y}`; };
const torontoDate = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
const unitKeys = (unit) => [unit.identityKey, ...(unit.keys ?? [])];

export function unit(id, { verdict = 'core', itemType = 'event', date, url, feed = false, recordId = `rec-${id}`, sourceId = 'rv2-venue', quote } = {}) {
  const citationUrl = url ?? `https://example.org/roundup/${id}`;
  return {
    unitId: id, identityKey: `occ:addr:${id}:${date}:all-day`, keys: [], label: `Community event ${id}`, verdict, itemType, date,
    citations: [{ url: citationUrl, publisher: 'Example Org', recordId, sourceId, tier: 'official', feed, listing: feed }],
    evidence: [{ url: citationUrl, recordId, snapshotSha256: sha(id), typed: { name: `Community event ${id}` }, subject_quote: quote ?? `Community event ${id}`,
      place_quote: '40 Hanna Ave', date_quote: humanDate(date), tier: 'official', fetchStatus: 200, verifyStatus: 200, verifiedAt: '2026-09-30T11:00:00.000Z' }],
  };
}

// An Instagram-cited unit: its signal carries the post the re-fetch file must match.
export function igUnit(id, date, shortcode = `SC${id}`) {
  const base = unit(id, { date, sourceId: 'rv2-instagram', url: `https://www.instagram.com/p/${shortcode}/`, recordId: `ig:${shortcode}` });
  return { ...base, instagram: { shortcode, ownerUsername: 'lvbusiness', timestamp: '2026-09-29T15:00:00.000Z', caption: `Join us ${humanDate(date)} at 40 Hanna Ave` } };
}

export function buildFixture({ now, units, stillInEffect = [], image = '/images/og/og-home.jpg', mutatePost = null } = {}) {
  const week = isoWeekOf(now);
  const isoWeek = week.isoWeek;
  const slug = roundupSlug(isoWeek);
  const signals = units.map((entry) => ({
    signalId: sha(`signal:${entry.unitId}`), sourceId: entry.citations[0].sourceId, url: entry.citations[0].url,
    records: [{ recordId: entry.citations[0].recordId, text: entry.evidence[0].subject_quote }], fetchedAt: now,
    ...(entry.instagram ? { post: entry.instagram } : {}),
  }));
  const forms = units.map((entry, index) => ({ signalId: signals[index].signalId, recordId: entry.citations[0].recordId, unit: entry }));
  const pack = { isoWeek, now, units, stillInEffect, signals, forms };
  const coverage = { version: 1, isoWeek, planningCutoff: now, keys: [...units, ...stillInEffect].flatMap(unitKeys) };
  const start = new Date(week.weekStartUtc);
  const end = new Date(start.getTime() + 6 * 86400000);
  const span = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const sections = units.map((entry, index) => {
    const place = entry.verdict === 'core' ? 'in Liberty Village' : 'near Liberty Village';
    const citations = entry.citations.map((citation) => `[${citation.publisher}](${citation.url})`).join(', ');
    return `## ${index + 1}. ${entry.label}\n\n${entry.label} takes place ${place} on ${humanDate(entry.date)}.\n\nSource: ${citations}`;
  });
  const still = stillInEffect.length
    ? [`### Still in effect\n\n${stillInEffect.map((entry) => `- ${entry.label} (${humanDate(entry.date)}): [${entry.citations[0].publisher}](${entry.citations[0].url})`).join('\n')}`]
    : [];
  const day = now.slice(0, 10);
  const post = {
    slug, title: `Liberty Village + Exhibition Place this week: ${span(start)}–${span(end)}, ${end.getUTCFullYear()}`,
    description: 'What is happening in and near Liberty Village and Exhibition Place this week.',
    content: [...sections, ...still].join('\n\n'), publishedAt: day, updatedAt: day, category: 'news',
    tags: ['liberty village', 'exhibition place', 'news'], answerBlock: 'What is happening in and near Liberty Village this week.',
    faqs: [], keyTakeaways: units.map((entry) => entry.label), relatedServices: [], relatedTopics: [], relatedPosts: [],
    author: 'LibertyVillage.co', image, roundupCoverage: coverage,
  };
  mutatePost?.(post);
  const verified = stubApi().verifyRoundupFormsSync({ signals, forms, now, posts: [] });
  const result = {
    pipeline: 'structured-v2', isoWeek, slug, now, packDigest: roundupPackDigest(pack), verifyDigest: verified.verifyDigest,
    decision: 'publish', units: units.length, coreUnits: units.filter((entry) => entry.verdict === 'core').length,
    coreAnchorUnits: units.filter((entry) => entry.verdict === 'core' && entry.itemType !== 'class').length, published: true,
    census: { signals: units.length, admitted: units.length },
  };
  return { isoWeek, slug, pack, post, result, coverage };
}

export function writeOut(fixture, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-roundup-v2-'))) {
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(fixture.pack));
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(fixture.result));
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify(fixture.post));
  fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ datasets: { posts: { entries: {} } } }));
  return dir;
}

export function writeIgRefetch(dir, fixture, { fetchedAt, override = {} } = {}) {
  const rows = fixture.pack.signals.filter((signal) => signal.post).map((signal) => ({
    shortcode: signal.post.shortcode, ownerUsername: signal.post.ownerUsername, timestamp: signal.post.timestamp,
    caption: signal.post.caption, status: 'ok', ...(override[signal.post.shortcode] ?? {}),
  }));
  const file = path.join(dir, 'ig-refetch.json');
  fs.writeFileSync(file, JSON.stringify({ fetchedAt, provider: 'apify', rows }));
  return file;
}

// controls: {changed:Set<identityKey>, expiresAt:{[identityKey]: iso}, calls:[]}.
export function stubApi(controls = {}) {
  const changed = controls.changed ?? new Set();
  const expires = controls.expiresAt ?? {};
  const covered = (posts) => new Set((posts ?? []).flatMap((post) => post?.roundupCoverage?.keys ?? []));
  const verifyRoundupFormsSync = ({ signals, forms, now, posts, igRefetch }) => {
    controls.calls?.push({ now, posts: (posts ?? []).map((post) => post.slug), igRefetch: igRefetch ?? null });
    const bySignal = new Map(signals.map((signal) => [signal.signalId, signal]));
    const items = [];
    const excluded = [];
    for (const form of forms) {
      const signal = bySignal.get(form.signalId);
      const entry = form.unit;
      let reason = null;
      if (!signal) reason = 'record-missing';
      else if (changed.has(entry.identityKey)) reason = 'record-missing';
      else if (expires[entry.identityKey] && Date.parse(now) >= Date.parse(expires[entry.identityKey])) reason = 'concluded';
      else if (signal.post && igRefetch !== undefined) {
        const row = igRefetch?.rows?.find((candidate) => candidate.shortcode === signal.post.shortcode);
        if (!row || row.status !== 'ok' || row.ownerUsername !== signal.post.ownerUsername || row.timestamp !== signal.post.timestamp
          || !String(row.caption).includes(signal.post.caption)) reason = 'record-missing';
      }
      if (reason) excluded.push({ signalId: form.signalId, reason });
      else items.push(entry);
    }
    return { items, excluded, verifyDigest: sha({ items, now: torontoDate(now) }) };
  };
  return {
    verifyRoundupFormsSync,
    verifyRoundupForms: async (args) => verifyRoundupFormsSync(args),
    planRoundupV2: (items, { posts }) => {
      const done = covered(posts);
      const units = items.filter((entry) => !unitKeys(entry).some((key) => done.has(key)));
      const coreAnchorUnits = units.filter((entry) => entry.verdict === 'core' && entry.itemType !== 'class').length;
      const reasons = [...(units.length < 3 ? ['below-minimum'] : []), ...(coreAnchorUnits < 1 ? ['no-core'] : [])];
      return { decision: reasons.length ? 'hold' : 'publish', units, coreUnits: units.filter((entry) => entry.verdict === 'core').length,
        coreAnchorUnits, reasons, stillInEffect: controls.stillInEffect ?? [] };
    },
    roundupCoverageFromPack: (pack) => ({ version: 1, isoWeek: pack.isoWeek, planningCutoff: pack.now,
      keys: [...pack.units, ...(pack.stillInEffect ?? [])].flatMap(unitKeys) }),
    roundupPackDigest,
  };
}
