#!/usr/bin/env node
/** Structured-source weekly roundup. No DB access, protected actions, or tool-enabled model calls. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRoundup } from './roundup-collect.mjs';
import { reasonRoundupSignals } from './roundup-reason.mjs';
import { verifyRoundupForms, roundupCoverageFromPack } from './roundup-verify.mjs';
import { planRoundupV2, isoWeekOf, roundupSlug } from './roundup.mjs';
import { roundupPackDigest } from './roundup-evidence.mjs';
import { writeRoundup, assembleRoundupPost } from './roundup-write.mjs';
import { appendPostToPostsJson } from './publish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeLines = (file, lines) => fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 });
const readLines = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];

export function parseRoundupV2Args(argv) {
  const args = { root: ROOT, dryRun: false, collect: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--collect') args.collect = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else {
      const match = /^--(run|out|root|now|image)=(.*)$/.exec(arg);
      if (match) args[match[1]] = match[2];
      else if (/^--(run|out|root|now|image)$/.test(arg) && argv[i + 1]) args[arg.slice(2)] = argv[++i];
      else throw new Error(`unknown_argument:${arg}`);
    }
  }
  if (!args.help && (!args.out || (args.collect && args.run) || (!args.collect && !args.run))) throw new Error('roundup requires --out and --collect or --run');
  if (args.collect && args.dryRun) throw new Error('collect does not publish');
  return args;
}

export async function collectRoundupV2(args, { collector = collectRoundup } = {}) {
  const now = args.now ? new Date(args.now).toISOString() : new Date().toISOString();
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const collected = await collector({ out, now, env: process.env });
  const signals = Array.isArray(collected?.signals) ? collected.signals : [];
  writeLines(path.join(out, 'signals.jsonl'), signals);
  json(path.join(out, 'census.json'), collected.census || {});
  return { signals: signals.length, census: collected.census || {}, snapshots: collected.snapshots || [] };
}

export async function runRoundupV2(args, deps = {}) {
  const now = args.now ? new Date(args.now).toISOString() : new Date().toISOString();
  const week = isoWeekOf(now);
  const slug = roundupSlug(week.isoWeek);
  const root = path.resolve(args.root || ROOT);
  const run = path.resolve(args.run);
  const out = path.resolve(args.out);
  if (out === path.join(root, 'data') || out.startsWith(path.join(root, 'data') + path.sep)) throw new Error('roundup output may not be under data/');
  const postsFile = path.join(root, 'data', 'posts.json');
  const originalPosts = fs.readFileSync(postsFile, 'utf8');
  const posts = JSON.parse(originalPosts);
  if (!Array.isArray(posts)) throw new Error('posts_json_not_array');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const signals = deps.signals || readLines(path.join(run, 'signals.jsonl'));
  const modelDeadline = Date.now() + 600_000;
  let reasoned = deps.reasoned;
  if (!reasoned) {
    try { reasoned = await (deps.reason || reasonRoundupSignals)(signals, { now, deadline: modelDeadline }); }
    catch { reasoned = { forms: [], technicalFailure: true,
      excluded: signals.map((s) => ({ signalId: s.signalId, sourceId: s.sourceId,
        reason: 'reason-failed', modelFailure: 'model-error' })) }; }
  }
  const forms = reasoned.forms || [];
  writeLines(path.join(out, 'forms.jsonl'), forms);
  const verified = await (deps.verify || verifyRoundupForms)({ signals, forms, now, posts, ...deps.verifyOptions });
  const plan = (deps.plan || planRoundupV2)(verified.items, { now, posts });
  const census = { ...(readIf(path.join(run, 'census.json')) || {}), signalCount: signals.length,
    formCount: forms.length, admitted: verified.items.length, excluded: [...(reasoned.excluded || []), ...(verified.excluded || [])],
    units: plan.units, coreUnits: plan.coreUnits, coreAnchorUnits: plan.coreAnchorUnits, reasons: plan.reasons || [] };
  const technicalFailure = Boolean(reasoned.technicalFailure || (reasoned.excluded || []).some((e) => e.reason === 'reason-failed'));
  if (technicalFailure) census.reasons = [...new Set([...census.reasons, 'reason-model-failed'])];
  json(path.join(out, 'verify-report.json'), { admitted: verified.items.map((i) => i.identityKey), excluded: census.excluded });
  json(path.join(out, 'plan.json'), plan);
  let pack = { isoWeek: week.isoWeek, now, signals, forms, units: plan.countedItems || [], stillInEffect: plan.stillInEffect || [], verifyDigest: verified.verifyDigest };
  let decision = technicalFailure ? 'technical-failure' : plan.decision;
  let draft = null, reviewFindings = [];
  if (decision === 'publish') {
    try {
      // Fail-closed trusted business export for the §9.2 writer lint retry.
      const writerBusinesses = deps.writerBusinesses !== undefined ? deps.writerBusinesses : readBusinesses(root);
      if (!Array.isArray(writerBusinesses)) throw new Error('roundup_businesses_unavailable:business export must be an explicit array');
      const written = await (deps.write || writeRoundup)(pack, { deadline: modelDeadline, businesses: writerBusinesses });
      draft = written.draft;
      reviewFindings = written.findings;
      if (written.refused?.length) {
        // Replan after risk review: a private individual may not remain as an uncounted
        // citation, nor in the retained pack that submit re-verifies (§9.2).
        const refusal = withoutRefusedUnits({ pack, items: verified.items, refused: written.refused });
        if (!refusal) throw new Error('roundup_refused_unit_unknown');
        const revised = (deps.plan || planRoundupV2)(refusal.items, { now, posts });
        decision = revised.decision;
        pack = { ...pack, signals: refusal.signals, forms: refusal.forms, units: revised.countedItems || [],
          stillInEffect: revised.stillInEffect || [], refusedKeyDigests: refusal.keyDigests };
        census.units = revised.units; census.coreUnits = revised.coreUnits; census.coreAnchorUnits = revised.coreAnchorUnits;
        census.reasons = [...new Set([...census.reasons, ...(revised.reasons || [])])];
        census.excluded.push(...refusal.dropped.map((form) => ({ signalId: form.signalId, recordId: form.recordId, reason: 'private-individual' })));
        reviewFindings = redactFindings(reviewFindings, refusal.keys);
        writeLines(path.join(out, 'forms.jsonl'), refusal.forms);
        json(path.join(out, 'verify-report.json'), { admitted: refusal.items.map((i) => i.identityKey), excluded: census.excluded });
        json(path.join(out, 'plan.json'), revised);
      }
    } catch (error) { decision = 'hold'; census.reasons.push('writer-failed'); census.writerError = error.message; }
  }
  let post = null;
  if (decision === 'publish') {
    try {
      post = (deps.assemble || assembleRoundupPost)({ pack, draft, root, image: args.image || '/images/og/og-home.jpg' });
      // Apply the same post-content policy before a runner reserves a submit
      // attempt; invalid copy is a writer-failed HOLD, not a failed submission.
      if (!deps.skipPolicy) {
        const { checkRoundupRecordV2 } = await import('../content/submit.mjs');
        const errors = checkRoundupRecordV2({ item: { key: slug }, record: post,
          ctx: { pipeline: 'structured-v2', isoWeek: week.isoWeek, weekStartUtc: week.weekStartUtc,
            now, units: pack.units, stillInEffect: pack.stillInEffect },
          news: { imageExists: (image) => fs.existsSync(path.join(root, 'public', image.slice(1))) } });
        if (errors.length) throw new Error(`roundup_post_policy:${errors.join('; ')}`);
        // Inherited lint (minus the directory address/price comparisons, which
        // are not event-fact grounding for a roundup) runs on the final
        // assembly too; any failure is a writer-failed HOLD here (the writer's
        // single lint retry is spent inside writeRoundup, and there is no
        // second model budget). The retained message carries rule + field +
        // count only, never the generated claim text.
        const { lintPost } = await import('../blog-lint.mjs');
        const lint = lintPost(post, { businesses: readBusinesses(root), now: new Date(now), roundup: true });
        if (!lint.ok) {
          const groups = new Map();
          for (const finding of lint.findings.slice(0, 12)) {
            const field = String(finding.detail || '').split(':')[0].trim() || 'post';
            const key = `${finding.rule} in ${field}`;
            groups.set(key, (groups.get(key) || 0) + 1);
          }
          const summary = [...groups].slice(0, 3).map(([key, count]) => `lint ${key} (${count})`).join('; ');
          throw new Error(`roundup_post_policy:${summary}`);
        }
      }
    } catch (error) { decision = 'hold'; census.reasons.push('writer-failed'); census.writerError = error.message; post = null; }
  }
  if (draft) json(path.join(out, 'draft.json'), draft);
  json(path.join(out, 'review-findings.json'), reviewFindings);
  const result = { pipeline: 'structured-v2', isoWeek: week.isoWeek, slug, now,
    packDigest: roundupPackDigest(pack), verifyDigest: verified.verifyDigest, decision,
    units: census.units, coreUnits: census.coreUnits, coreAnchorUnits: census.coreAnchorUnits,
    published: false, technicalFailure: decision === 'technical-failure', reasons: census.reasons, census };
  json(path.join(out, 'pack.json'), pack);
  if (decision === 'publish' && post) {
    if (posts.some((p) => p.slug === slug)) throw new Error('roundup slug already exists');
    if (JSON.stringify(post.roundupCoverage) !== JSON.stringify(roundupCoverageFromPack(pack))) throw new Error('coverage mismatch');
    if (!args.dryRun) {
      if (fs.readFileSync(postsFile, 'utf8') !== originalPosts) throw new Error('posts changed before append');
      (deps.appendPost || appendPostToPostsJson)(root, post);
      result.published = true;
    }
  }
  json(path.join(out, 'result.json'), result);
  return { result, pack, post };
}

const keyDigest = (key) => createHash('sha256').update(key).digest('hex');
const recordRef = (url, recordId) => `${url}\n${recordId}`;
const formRef = (form) => `${form?.signalId}\n${form?.recordId}\n${form?.subject}`;

/**
 * Remove round-2 refused units from the pack. Every form citing a record behind a
 * refused unit (including merged duplicates) is dropped, with the admitted items
 * those forms produced; the refused records leave their signals, and a signal only
 * the dropped forms cited leaves the pack. Refused keys persist as sha256 digests
 * so submit excludes them without retaining the identifiers. Returns null when a
 * refused ID names no counted unit (fail closed).
 */
export function withoutRefusedUnits({ pack, items, refused }) {
  const units = pack.units.filter((unit) => refused.includes(unit.identityKey));
  if (units.length !== new Set(refused).size) return null;
  const keys = new Set(units.flatMap((unit) => [unit.identityKey, ...(unit.keys || [])]));
  const hit = (item) => [item.identityKey, ...(item.keys || [])].some((key) => keys.has(key));
  const records = new Set(items.filter(hit).flatMap((item) => (item.evidence || []).map((entry) => recordRef(entry.url, entry.recordId))));
  const signalUrl = new Map(pack.signals.map((signal) => [signal.signalId, signal.url]));
  const touches = (form) => records.has(recordRef(signalUrl.get(form?.signalId), form?.recordId)) ||
    (form?.evidence || []).some((claim) => records.has(recordRef(claim?.url, claim?.recordId)));
  const dropped = pack.forms.filter(touches);
  const forms = pack.forms.filter((form) => !touches(form));
  const droppedRefs = new Set(dropped.map(formRef));
  const cites = (list, signal) => list.some((form) => form?.signalId === signal.signalId || (form?.evidence || []).some((claim) => claim?.url === signal.url));
  const signals = pack.signals
    .filter((signal) => cites(forms, signal) || !cites(dropped, signal))
    .map((signal) => ({ ...signal, records: (signal.records || []).filter((record) => !records.has(recordRef(signal.url, record.recordId))) }));
  return { forms, signals, dropped, keys, keyDigests: [...keys].map(keyDigest).sort(),
    items: items.filter((item) => !hit(item) && !droppedRefs.has(formRef(item))) };
}

// A refused unit's review findings keep only the finding type: the person, the
// sentence and the fix may name the private individual.
function redactFindings(rounds, keys) {
  return (rounds || []).map((round) => ({ ...round, findings: (round?.findings || []).map((finding) =>
    keys.has(finding?.unitId) ? { unitId: keyDigest(finding.unitId), problem: finding.problem, redacted: true } : finding) }));
}

function readIf(file) { try { return read(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

// Trusted business export for the inherited lint post-check; a missing file,
// malformed JSON or a non-array export fails closed to HOLD (never silent []).
// Probe only the authoritative business export.
function readBusinesses(root) {
  let records;
  try {
    records = JSON.parse(fs.readFileSync(path.join(root, 'data', 'businesses.json'), 'utf8'));
  } catch (error) {
    throw new Error(`roundup_businesses_unavailable:business export unreadable (${error.code || 'parse failed'})`);
  }
  if (!Array.isArray(records)) throw new Error('roundup_businesses_unavailable:business export must be an explicit array');
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseRoundupV2Args(process.argv.slice(2));
    if (args.help) console.log('Usage: roundup-v2-run.mjs --collect --out DIR [--now ISO] | --run DIR --out DIR --root DIR [--now ISO] [--dry-run]');
    else console.log(JSON.stringify(args.collect ? await collectRoundupV2(args) : (await runRoundupV2(args)).result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
