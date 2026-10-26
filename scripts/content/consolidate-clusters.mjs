#!/usr/bin/env node
// Deploy redirects first. This content-only command never deploys or notifies.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDb } from './db.mjs';
import { registry, hash } from './canonical.mjs';
import { readLive, createSubmission, findSubmissionByIdempotencyKey, getSubmission, adminAction } from './store.mjs';
import { gateContent } from './gate.mjs';

export const defaultPlan = new URL('./consolidation-clusters.json', import.meta.url);
export function routeRow(url) {
  for (const dataset of ['posts', 'topics', 'services']) {
    const prefix = registry[dataset].route.replace(':key', '');
    if (url.startsWith(prefix) && /^[a-z0-9][a-z0-9-]{0,127}$/.test(url.slice(prefix.length)))
      return { dataset, key: url.slice(prefix.length) };
  }
  throw new Error(`unsupported content URL: ${url}`);
}
export function validatePlan(plan) {
  if (plan.version !== 1 || !plan.clusters?.length) throw new Error('invalid cluster plan');
  const seen = new Set(); const ids = new Set();
  for (const c of plan.clusters) {
    if (!c.id || ids.has(c.id) || c.members.length < 2 || !c.members.some(m => m.url === c.primary)) throw new Error('invalid cluster');
    if (c.confirmed !== undefined && typeof c.confirmed !== 'boolean') throw new Error(`invalid confirmation: ${c.id}`);
    if (c.imageFrom && !c.members.some(m => m.url === c.imageFrom)) throw new Error('image source must be a cluster member');
    ids.add(c.id);
    for (const m of c.members) {
      routeRow(m.url);
      if (seen.has(m.url) || /world-cup|fifa/i.test(m.url) || plan.protectedUrls?.includes(m.url)) throw new Error(`duplicate or protected URL: ${m.url}`);
      seen.add(m.url);
      if (!m.keepSections?.length) throw new Error(`content selection missing: ${m.url}`);
    }
  }
  return plan;
}
export const redirectsFor = (plan) => validatePlan(plan).clusters.filter(c => c.confirmed === true).flatMap(c => c.members.filter(m => m.url !== c.primary)
  .map(m => ({ source: m.url, destination: c.primary, statusCode: 301 })));
const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const markdownLink = /\[([^\]]+)\]\(\(?([^)]+?)\)?\)/g;
function mapText(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(item => mapText(item, transform));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapText(item, transform)]));
  return value;
}
function rewriteLinks(text, primary, redirects) {
  const destinations = new Map(redirects.map(r => [r.source, r.destination]));
  return text.replace(markdownLink, (match, label, href) => {
    let url;
    try { url = new URL(href, `https://libertyvillage.co${primary}`); } catch { return match; }
    if (!['libertyvillage.co', 'www.libertyvillage.co'].includes(url.hostname)) return match;
    const destination = destinations.get(url.pathname) ?? url.pathname;
    if (destination === primary) return label;
    return destination === url.pathname ? match : `[${label}](${destination}${url.search}${url.hash})`;
  });
}
function plain(text) {
  // Service sections render as plain <p> text, so preserve labels without URL suffixes.
  const lines = text.replace(markdownLink, '$1').replace(/^#{1,6}\s+/gm, '').replace(/\*\*/g, '').split('\n');
  const cellValues = line => line.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
  const output = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|') && lines[i + 1]?.includes('|') && cellValues(lines[i + 1]).every(s => /^:?-+:?$/.test(s))) {
      const headers = cellValues(lines[i]);
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        output.push(cellValues(lines[i]).map((cell, j) => `${headers[j]}: ${cell}`).join('; ') + '.');
        i++;
      }
      i--;
    } else output.push(lines[i].replace(/^\s*[-*]\s+/, ''));
  }
  return output.join(' ').replace(/\s+/g, ' ').trim();
}
export function sectionsOf(record) {
  if (record.definition) return [{ heading: 'Overview', content: record.definition }, ...(record.sections ?? [])];
  const matches = [...(record.content ?? '').matchAll(/^(#{2,3}) (.+)$/gm)];
  return matches.map((m, i) => {
    let end = i + 1;
    while (end < matches.length && matches[end][1].length > m[1].length) end++;
    return { heading: m[2], content: record.content.slice(m.index + m[0].length, matches[end]?.index ?? record.content.length).trim() };
  });
}
export function mergeCluster(cluster, records, redirects, now) {
  const primary = structuredClone(records.get(cluster.primary));
  if (!primary) throw new Error(`missing primary: ${cluster.primary}`);
  if (cluster.imageFrom) {
    const image = records.get(cluster.imageFrom)?.image;
    if (!image) throw new Error(`missing image source: ${cluster.imageFrom}`);
    primary.image = image;
  }
  const retired = new Set(redirects.map(r => r.source));
  const original = primary.content ?? primary.sections?.map(s => s.content).join('\n\n') ?? '';
  const seen = new Set(original.split(/\n\s*\n/).map(normalize));
  const additions = [];
  const faqs = [...(primary.faqs ?? primary.specificFaqs ?? [])];
  const takes = [...(primary.keyTakeaways ?? [])];
  for (const member of cluster.members.filter(m => m.url !== cluster.primary)) {
    const source = records.get(member.url);
    if (!source) throw new Error(`missing secondary: ${member.url}`);
    // D2 also protects event posts whose slugs omit "world-cup".
    if (/world.cup|fifa/i.test(source.title ?? source.name ?? '') || source.category === 'world-cup') throw new Error(`protected event post: ${member.url}`);
    const sections = sectionsOf(source);
    for (const heading of member.keepSections) {
      const section = sections.find(s => normalize(s.heading) === normalize(heading));
      if (!section) throw new Error(`selected section changed: ${member.url}: ${heading}`);
      const paragraphs = section.content.split(/\n\s*\n/).filter(p => {
        const key = normalize(p);
        if (!key || seen.has(key) || normalize(original).includes(key)) return false;
        seen.add(key); return true;
      });
      if (paragraphs.length) additions.push({ heading: section.heading, content: paragraphs.join('\n\n') });
    }
    for (const faq of source.faqs ?? source.specificFaqs ?? []) if (!faqs.some(f => normalize(f.question) === normalize(faq.question))) faqs.push(faq);
    for (const take of source.keyTakeaways ?? []) if (!takes.some(t => normalize(t) === normalize(take))) takes.push(take);
  }
  if (routeRow(cluster.primary).dataset === 'services') {
    primary.sections = [...(primary.sections ?? []), ...additions];
    primary.specificFaqs = faqs;
  } else {
    primary.content += additions.map(s => `\n\n## ${s.heading}\n\n${s.content}`).join('');
    primary.faqs = faqs;
    primary.updatedAt = now.slice(0, 10);
  }
  if (takes.length) primary.keyTakeaways = takes;
  for (const [field, prefix] of [['relatedPosts', '/blog/'], ['relatedTopics', '/guide/'], ['relatedServices', '/best/']]) {
    if (primary[field]) primary[field] = primary[field].filter(key => !retired.has(prefix + key) && prefix + key !== cluster.primary);
  }
  if (primary.canonicalUrl) primary.canonicalUrl = `https://libertyvillage.co${cluster.primary}`;
  const linked = mapText(primary, text => rewriteLinks(text, cluster.primary, redirects));
  return routeRow(cluster.primary).dataset === 'services' ? mapText(linked, plain) : linked;
}
async function current(db, row) {
  return (await db.query(`select e.*,r.payload,r.payload_sha256 from content.entries e left join content.revisions r
    on r.dataset=e.dataset and r.key=e.key and r.rev=e.live_rev where e.dataset=$1 and e.key=$2`, [row.dataset, row.key])).rows[0];
}
function expectRev(row, rev) {
  if (!row || row.live_rev !== rev) throw new Error('content changed since snapshot; refusing to overwrite');
}
// The store's admin API has no expected-rev parameter. Check under its transaction/row lock.
function guardedAdminDb(db, row, expectedRev) {
  return { ...db, tx: (fn) => db.tx(async c => {
    await c.query("select pg_advisory_xact_lock(hashtext('content:' || $1))", [row.dataset]);
    const entry = (await c.query('select live_rev from content.entries where dataset=$1 and key=$2 for update', [row.dataset, row.key])).rows[0];
    expectRev(entry, expectedRev);
    return fn(c);
  }) };
}
async function save(file, value) {
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}
async function load(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function lookup(db, key) {
  const found = await findSubmissionByIdempotencyKey(db, key);
  return found.submissionId == null ? null : { id: found.submissionId };
}
export async function consolidate(db, { plan, apply = false, rollback = false, runDir, actor = 'seo-consolidation', gateScript, checkout = process.cwd() } = {}) {
  validatePlan(plan);
  if (apply && !rollback) {
    const unconfirmed = plan.clusters.filter(c => c.confirmed !== true).map(c => c.id);
    if (unconfirmed.length) throw new Error(`unconfirmed clusters: ${unconfirmed.join(', ')}; confirm primaries from GSC before apply`);
  }
  const digest = hash('sha256', JSON.stringify(plan));
  const redirects = redirectsFor(plan);
  const file = runDir && path.join(path.resolve(runDir), 'snapshot.json');
  let journal = file && await load(file);
  if (journal && (journal.planDigest !== digest || journal.db !== db.dbName || journal.target !== db.target)) throw new Error('snapshot binding mismatch');
  if (rollback && !journal) throw new Error('rollback requires the original run directory');
  if (apply && !file) throw new Error('--run-dir required for apply');
  if (apply && !rollback && journal?.state === 'rolled-back') throw new Error('run already rolled back; use a new run directory');
  if (!journal) {
    const live = await readLive(db, { datasets: ['posts', 'topics', 'services'] });
    const records = new Map(); const snapshots = [];
    for (const c of plan.clusters) for (const member of c.members) {
      const row = routeRow(member.url);
      const payload = live.datasets[row.dataset].records.find(r => r.slug === row.key);
      if (!payload) throw new Error(`URL is not live: ${member.url}`);
      records.set(member.url, payload);
      const entry = await current(db, row);
      expectRev(entry, live.datasets[row.dataset].entries[row.key].rev);
      const revisions = (await db.query('select * from content.revisions where dataset=$1 and key=$2 order by rev', [row.dataset, row.key])).rows;
      snapshots.push({ url: member.url, row, entry, revisions });
    }
    const now = new Date().toISOString();
    journal = { version: 1, id: randomUUID(), db: db.dbName, target: db.target, planDigest: digest, plan,
      createdAt: now, actor, state: 'prepared', redirects, snapshots,
      merges: plan.clusters.map(c => ({ id: c.id, primary: c.primary, payload: mergeCluster(c, records, redirects, now) })) };
  }
  const summary = { mode: rollback ? 'rollback' : 'consolidate', dryRun: !apply, clusters: plan.clusters.length, redirects, runDir };
  if (!apply) return { ...summary, candidates: journal.merges }; // No files or writes.
  if (!await load(file)) {
    await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
    await save(file, journal); // Every affected entry + revision BEFORE any DB mutation.
    await save(path.join(runDir, 'redirects.json'), redirects);
  }
  const snapshotFor = (url) => journal.snapshots.find(s => s.url === url);
  const idem = (suffix) => `consolidation:${journal.id}:${suffix}`;
  const admin = async (snapshot, op, expectedRev, suffix) => {
    const idempotencyKey = idem(suffix);
    const prior = await lookup(db, idempotencyKey);
    if (prior) {
      const state = await getSubmission(db, prior.id);
      const rev = state.items[0].published_rev;
      expectRev(await current(db, snapshot.row), rev);
      return rev;
    }
    const result = await adminAction(guardedAdminDb(db, snapshot.row, expectedRev), {
      ...snapshot.row, op, toRev: snapshot.entry.live_rev, actor: journal.actor,
      reason: `SEO cluster ${journal.id} ${op}`, owner: journal.actor, idempotencyKey,
    });
    return result.rev;
  };
  if (rollback) {
    // Restore sources before the primary. Keep redirects until the rebuilt site serves originals.
    for (const c of [...plan.clusters].reverse()) {
      for (const m of c.members.filter(m => m.url !== c.primary)) {
        if (await lookup(db, idem(`unpublish:${m.url}`)))
          await admin(snapshotFor(m.url), 'rollback', null, `restore:${m.url}`);
      }
      const submission = await lookup(db, idem(`merge:${c.id}`));
      if (submission) {
        const state = await getSubmission(db, submission.id);
        if (state.submission.state === 'published') await admin(snapshotFor(c.primary), 'rollback', state.items[0].published_rev, `restore:${c.primary}`);
      }
    }
    journal.state = 'rolled-back';
    await save(file, journal);
    return { ...summary, state: journal.state };
  }
  for (const c of plan.clusters) {
    const snap = snapshotFor(c.primary);
    const idempotencyKey = idem(`merge:${c.id}`);
    let submission = await lookup(db, idempotencyKey);
    if (!submission) {
      expectRev(await current(db, snap.row), snap.entry.live_rev);
      for (const m of c.members.filter(m => m.url !== c.primary)) expectRev(await current(db, routeRow(m.url)), snapshotFor(m.url).entry.live_rev);
      const created = await createSubmission(db, { kind: 'seo', target: db.target, actor: journal.actor, idempotencyKey,
        items: [{ ...snap.row, op: 'update', payload: journal.merges.find(m => m.id === c.id).payload, expectedLiveRev: snap.entry.live_rev }] });
      submission = { id: created.submissionId };
    }
    let state = await getSubmission(db, submission.id);
    if (state.submission.state !== 'published') {
      // Existing deterministic checks, model review and repair; empty env defers propagation.
      let gated;
      try {
        gated = await gateContent(db, { submission: submission.id, actor: journal.actor, owner: journal.actor, script: gateScript }, { env: {}, checkout });
      } catch (error) {
        const failed = await getSubmission(db, submission.id);
        if (['rejected', 'blocked', 'error', 'compensated'].includes(failed.submission.state))
          throw new Error(`content gate did not publish ${c.id}: ${failed.submission.decision}`, { cause: error });
        throw error;
      }
      if (gated.result.state !== 'published' || gated.result.decision !== 'go') throw new Error(`content gate did not publish ${c.id}: ${gated.result.message ?? gated.result.decision}`);
      state = await getSubmission(db, submission.id);
    }
    expectRev(await current(db, snap.row), state.items[0].published_rev);
    for (const member of c.members.filter(m => m.url !== c.primary))
      await admin(snapshotFor(member.url), 'unpublish', snapshotFor(member.url).entry.live_rev, `unpublish:${member.url}`);
  }
  if (journal.state !== 'applied') { journal.state = 'applied'; await save(file, journal); }
  return { ...summary, state: 'applied', propagation: 'deferred: parent rebuild required' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let db;
  try {
    const args = process.argv.slice(2); const opts = {};
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (['--apply', '--rollback'].includes(key)) opts[key.slice(2)] = true;
      else if (['--plan', '--run-dir', '--actor', '--gate-script'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) opts[key.slice(2)] = args[++i];
      else throw new Error(`unknown or incomplete argument: ${key}`);
    }
    // Recovery remains bound to the saved plan even if a later release changes the defaults.
    const recovery = opts.rollback && opts['run-dir'] && !opts.plan
      ? await load(path.join(path.resolve(opts['run-dir']), 'snapshot.json')) : null;
    const plan = recovery?.plan ?? JSON.parse(await fs.readFile(opts.plan ?? defaultPlan, 'utf8'));
    db = await openDb();
    console.log(JSON.stringify(await consolidate(db, { plan, apply: opts.apply, rollback: opts.rollback, runDir: opts['run-dir'], actor: opts.actor, gateScript: opts['gate-script'] }), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await db?.close(); }
}
