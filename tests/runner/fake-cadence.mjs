// In-memory stand-in for `node scripts/content/cli.mjs` used by the runner
// cadence tests. It mirrors scripts/content/cadence.mjs semantics that the runner
// relies on: fenced reservations, repeated-intent refusal, the existing open
// attempt returned by `attempt`, outcome transitions, deterministic keys, and
// consumed only for a current-live submission. No DB, network or model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { weekStartUtc, roundupSlug as cadenceRoundupSlug } from '../../scripts/content/cadence.mjs';
import { checkTopicGroundability, reserveGuideEligibility } from '../../scripts/automation/topic-queue.mjs';
import { buildSourcePack, verifySourcePack, canonicalJson, checkDraftAgainstPack } from '../../scripts/automation/blog-source-pack.mjs';
import { roundupPackDigest } from '../../scripts/news-pilot/roundup-evidence.mjs';
import { isoWeekOf, roundupSlug } from '../../scripts/news-pilot/roundup.mjs';
import { ROUNDUP_PUBLICATION } from '../../scripts/content/roundup-mode.mjs';
import { roundupCoverageErrors } from '../../scripts/content/validate.mjs';

export const modules = Object.freeze({ weekStartUtc, checkTopicGroundability, reserveGuideEligibility, buildSourcePack, verifySourcePack, canonicalJson, checkDraftAgainstPack, roundupPackDigest, isoWeekOf, roundupSlug,
  roundupPublication: ROUNDUP_PUBLICATION, roundupCoverageErrors });

const FAILED = new Set(['failed-before-submit', 'rejected', 'blocked', 'error']);
const cliError = (reason, exit = 2) => Object.assign(new Error(`node scripts/content/cli.mjs exit ${exit}`), { cliFailure: { reason, action: 'x', exit } });

const business = (slug, name, category, description, n) => ({
  slug, name, category, description, address: `${n} Liberty Street, Toronto`, hours: 'Mon-Sun 9am-9pm', phone: `416-555-01${String(n).padStart(2, '0')}`, website: `https://${slug}.example`,
});
export const BUSINESSES = Object.freeze([
  business('bar-one', 'Bar One', 'Bar', 'Craft cocktails with a daily happy hour.', 1),
  business('bar-two', 'Bar Two', 'Bar', 'Neighbourhood pub with happy hour pints.', 2),
  business('cafe-one', 'Cafe One', 'Cafe', 'Espresso coffee and pastries.', 3),
  business('cafe-two', 'Cafe Two', 'Cafe', 'Single origin coffee roaster.', 4),
  business('gym-one', 'Gym One', 'Gym', 'Fitness classes and personal training.', 5),
  business('gym-two', 'Gym Two', 'Gym', 'Group fitness classes every morning.', 6),
  // Two directory categories with >=3 records each: the only sources of Sunday reserves.
  business('bakery-one', 'Bakery One', 'bakery', 'Sourdough bread baked daily.', 7),
  business('bakery-two', 'Bakery Two', 'bakery', 'French pastries and croissants.', 8),
  business('bakery-three', 'Bakery Three', 'bakery', 'Custom cakes and cookies.', 9),
  business('salon-one', 'Salon One', 'salon', 'Hair cuts and colour.', 10),
  business('salon-two', 'Salon Two', 'salon', 'Nail and hair styling.', 11),
  business('salon-three', 'Salon Three', 'salon', 'Barber and beard trims.', 12),
]);

// A post the trusted pack grounds: names every pack record with a directory link.
export function groundedPost(pack, title, day) {
  const slug = `liberty-village-${pack.intentKey}-notes`;
  return {
    slug, title: `${title} notes`, description: 'A short neighbourhood guide.',
    content: `## Where to go\n\n${pack.sources.map((source) => `[${source.name}](/directory/${source.id}) is listed in the Liberty Village directory.`).join('\n\n')}\n`,
    publishedAt: day, updatedAt: day, category: 'lifestyle', tags: ['food', 'liberty village', 'guide', 'local'],
    answerBlock: 'Several places are listed in the Liberty Village directory.', faqs: [1, 2, 3, 4].map((n) => ({ question: `Question ${n}?`, answer: `Answer ${n}.` })),
    image: `/images/blog/${slug}.jpg`, relatedServices: [], relatedTopics: [], relatedPosts: [], relatedBusinesses: pack.sources.map((source) => source.id),
    keyTakeaways: ['One', 'Two', 'Three', 'Four'], author: 'LibertyVillage.co',
  };
}
export const topic = (key, title, extra = {}) => ({ key, kind: 'blog', title, source: 'gsc', rationale: 'test', addedAt: '2026-09-01T00:00:00.000Z', attempts: 0, branchPrefix: 'blog/auto-', ...extra });
export const TOPICS = Object.freeze({
  pet: topic('k-pet', 'Pet-Friendly Restaurants in Liberty Village'),
  happy: topic('k-happy', 'Liberty Village Happy Hour'),
  coffee: topic('k-coffee', 'Coffee Shops'),
  fitness: topic('k-fitness', 'Fitness Classes'),
});
export const WED = new Date('2026-09-30T11:00:00.000Z');
export const FRI = new Date('2026-10-02T11:00:00.000Z');
export const SUN = new Date('2026-10-04T16:00:00.000Z');

export function createWorld({ now = WED, queue = [TOPICS.happy, TOPICS.coffee, TOPICS.fitness], posts = [{ slug: 'existing-post', title: 'Existing Post', category: 'lifestyle' }], businesses = BUSINESSES } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cadence-repo-'));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cadence-state-'));
  fs.mkdirSync(path.join(repo, 'data'), { recursive: true });
  const world = {
    repo, stateRoot, now, queue, posts, businesses, snapshotId: 'a'.repeat(40),
    cadenceStartWeek: '2026-09-21',
    slots: new Map(), attempts: [], evidence: new Map(), submissions: new Map(), nextId: 100, live: new Set(),
    calls: [], logs: [], generated: [], sources: [],
    heldByOther: new Set(), gatePlan: [], deployCode: 0, submitPlan: [], generatorPlan: [], deadlineCalls: [], alerts: new Map(), deliverCalls: 0, deliverFails: false, deadlineFails: false, alertsEnabled: true, smokeAt: null,
    cleanup() { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(stateRoot, { recursive: true, force: true }); },
  };
  const slotKey = (week, lane, n) => lane === 'roundup' ? `${week}|roundup` : `${week}|${lane}|${n}`;
  const keyFor = (target, week, lane, n, ordinal) => `cadence:${createHash('sha256').update(`${target}|${week}|${lane}|${n}|${ordinal}`).digest('hex')}`;
  const flags = (args) => {
    const out = {};
    for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) { out[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; }
    return out;
  };
  const slotFor = (week, lane, n) => {
    const key = slotKey(week, lane, n);
    if (!world.slots.has(key)) world.slots.set(key, { week_start_utc: week, lane, slot_number: lane === 'roundup' ? 1 : n, state: 'ready', attempt_ordinal: 0, token: null, owner: null, submission_id: null, roundup_slug: lane === 'roundup' ? cadenceRoundupSlug(week) : null });
    return world.slots.get(key);
  };
  const publicSlot = (slot) => { const copy = { ...slot }; delete copy.token; return copy; };
  const locked = (attempt, token) => {
    const slot = slotFor(attempt.week_start_utc, attempt.lane, attempt.slot_number);
    if (!token || slot.token !== token) throw cliError('cli-claim', 1);
    return slot;
  };
  const inWeek = (sub, week) => sub.smokedAt && weekStartUtc(sub.smokedAt) === week;
  const count = (week) => {
    const rows = [...world.submissions.values()].filter((sub) => world.live.has(sub.id) && inWeek(sub, week));
    const content = rows.filter((sub) => sub.kind === 'blog').map((sub) => ({ slug: sub.slug, submissionId: sub.id }));
    const roundup = rows.filter((sub) => sub.kind === 'roundup' && sub.slug === cadenceRoundupSlug(week)).map((sub) => ({ slug: sub.slug, submissionId: sub.id }));
    return { content, roundup, contentCount: content.length, roundupCount: roundup.length, met: content.length >= 2 && roundup.length >= 1, dbOnly: { contentCount: content.length, roundupCount: roundup.length } };
  };
  const cadence = (sub, f) => {
    const week = f['week-start'];
    const target = f.target;
    const n = Number(f['slot-number']);
    switch (sub) {
      case 'evidence-list': return [...world.evidence.values()].filter((item) => item.week_start_utc === week && !['closed','empty'].includes(item.state));
      case 'evidence-unresolved': return [...world.evidence.values()].filter((item) => !['closed','empty','retry'].includes(item.state));
      case 'evidence-claim': {
        const id = `${target}|${week}|${f['intent-fingerprint']}`;
        if (world.evidence.has(id)) return { claimed: false, evidence: world.evidence.get(id) };
        const original = world.attempts.find((item) => item.idempotency_key === f['original-key'] && item.outcome === 'failed-before-submit' && item.submission_id == null);
        if (!original) throw cliError('cli-state', 1);
        const evidence = { target, week_start_utc: week, intent_fingerprint: f['intent-fingerprint'], original_key: original.idempotency_key,
          original_digest: original.source_pack_digest, original_title: f['original-title'], category: f.category ?? null,
          discovery_key: `evidence:${id}`, claim_token: randomUUID(), state: 'claimed', retry_key: null, retry_slot: null, retry_digest: null };
        world.evidence.set(id, evidence);
        return { claimed: true, evidence };
      }
      case 'evidence-state': {
        const evidence = world.evidence.get(`${target}|${week}|${f['intent-fingerprint']}`);
        if (!evidence || evidence.claim_token !== f.token) throw cliError('cli-claim', 1);
        evidence.state = f.state;
        return evidence;
      }
      case 'count': return count(week);
      case 'unresolved': return world.attempts.filter((a) => a.target === target && a.lane === (f.lane ?? 'content') && [null,'published','smoked'].includes(a.outcome))
        .sort((a, b) => a.week_start_utc.localeCompare(b.week_start_utc) || a.slot_number - b.slot_number || a.ordinal - b.ordinal).slice(0, Number(f.limit ?? 3)).map((a) => ({ ...a }));
      case 'current-live': {
        const sub = world.submissions.get(Number(f['submission-id']));
        return { submissionId: sub?.id ?? null, slug: sub?.slug ?? null, live: Boolean(sub && sub.smokedAt && world.live.has(sub.id)) };
      }
      case 'status': return {
        slots: [...world.slots.values()].filter((slot) => slot.week_start_utc === week).map(publicSlot),
        attempts: world.attempts.filter((a) => a.week_start_utc === week).map((a) => ({ ...a })), alerts: [],
      };
      case 'reserve': {
        const slot = slotFor(week, f.lane, n);
        if (world.heldByOther.has(slotKey(week, f.lane, n)) || slot.token) return { slot: publicSlot(slot), token: null, reserved: false, holder: slot.owner === f.owner ? 'self' : 'other' };
        slot.token = randomUUID();
        slot.owner = f.owner;
        return { slot: publicSlot(slot), token: slot.token, reserved: true, holder: 'self' };
      }
      case 'renew': { const slot = slotFor(week, f.lane, n); if (slot.token !== f.token) throw cliError('cli-claim', 1); return publicSlot(slot); }
      case 'release': { const slot = slotFor(week, f.lane, n); if (slot.token !== f.token) throw cliError('cli-claim', 1); slot.token = null; slot.owner = null; return publicSlot(slot); }
      case 'evidence-retry':
      case 'attempt': {
        const slot = slotFor(week, f.lane, n);
        if (slot.token !== f.token) throw cliError('cli-claim', 1);
        const evidence = sub === 'evidence-retry' ? world.evidence.get(`${target}|${week}|${f['intent-fingerprint']}`) : null;
        if (sub === 'evidence-retry' && (!evidence || evidence.claim_token !== f['evidence-token'] || evidence.state !== 'verified'
          || evidence.retry_key || evidence.original_digest === f['source-pack-digest']
          || world.attempts.some((a) => a.week_start_utc === week && a.lane === 'content' && a.slot_number === n))) throw cliError('cli-claim', 1);
        for (const name of ['intent-fingerprint', 'topic-key', 'source-pack-digest']) if (typeof f[name] !== 'string' || !f[name].trim()) throw cliError('cli-validation');
        const prior = world.attempts.filter((a) => a.week_start_utc === week && a.lane === f.lane && a.slot_number === slot.slot_number).sort((a, b) => b.ordinal - a.ordinal);
        const latest = prior[0];
        if (latest && [null, 'published', 'smoked'].includes(latest.outcome)) return { ordinal: latest.ordinal, idempotencyKey: latest.idempotency_key, existing: true };
        if (latest?.outcome === 'consumed') throw cliError('cli-state', 1);
        if (prior.some((a) => a.intent_fingerprint === f['intent-fingerprint'])) throw cliError('cli-validation');
        const ordinal = slot.attempt_ordinal + 1;
        const attempt = { target, week_start_utc: week, lane: f.lane, slot_number: slot.slot_number, ordinal, intent_fingerprint: f['intent-fingerprint'], topic_key: f['topic-key'], idempotency_key: keyFor(target, week, f.lane, slot.slot_number, ordinal), source_pack_digest: f['source-pack-digest'], submission_id: null, outcome: null };
        world.attempts.push(attempt);
        if (evidence) { evidence.state = 'retry'; evidence.retry_slot = n; evidence.retry_key = attempt.idempotency_key; evidence.retry_digest = attempt.source_pack_digest; }
        slot.attempt_ordinal = ordinal;
        slot.state = 'attempting';
        return { ordinal, idempotencyKey: attempt.idempotency_key, existing: false };
      }
      case 'attach': {
        const attempt = world.attempts.find((a) => a.idempotency_key === f['idempotency-key']);
        const slot = locked(attempt, f.token);
        const submission = world.submissions.get(Number(f['submission-id']));
        if (!submission || submission.key !== attempt.idempotency_key) throw cliError('cli-validation');
        if (attempt.submission_id && attempt.submission_id !== submission.id) throw cliError('cli-state', 1);
        if (attempt.outcome && FAILED.has(attempt.outcome)) throw cliError('cli-state', 1);
        attempt.submission_id = submission.id;
        slot.submission_id = submission.id;
        slot.state = 'submitted';
        return attempt;
      }
      case 'outcome': {
        const attempt = world.attempts.find((a) => a.idempotency_key === f['idempotency-key']);
        const slot = locked(attempt, f.token);
        const outcome = f.outcome;
        if (attempt.outcome === outcome) return attempt;
        if (attempt.outcome && !['published', 'smoked'].includes(attempt.outcome)) throw cliError('cli-state', 1);
        if (attempt.outcome === 'smoked' && !['consumed','late-smoked'].includes(outcome)) throw cliError('cli-state', 1);
        // Like cadence.mjs: consumed only if current-live AND counted in the ATTEMPT's week.
        if (outcome === 'consumed' && (attempt.outcome !== 'smoked' || !count(attempt.week_start_utc)[attempt.lane === 'roundup' ? 'roundup' : 'content'].some((item) => item.submissionId === attempt.submission_id))) throw cliError('cli-state', 1);
        if (outcome === 'late-smoked' && (attempt.outcome !== 'smoked' || ![...world.submissions.values()].some((sub) => sub.id === attempt.submission_id && sub.smokedAt && weekStartUtc(sub.smokedAt) > attempt.week_start_utc
          && (attempt.lane === 'roundup'
            // Like cadence.mjs currentLiveSubmission: the OLD week's own slug, current-live.
            ? sub.kind === 'roundup' && sub.slug === cadenceRoundupSlug(attempt.week_start_utc) && world.live.has(sub.id)
            : count(weekStartUtc(sub.smokedAt)).content.some((item) => item.submissionId === sub.id))))) throw cliError('cli-state', 1);
        attempt.outcome = outcome;
        slot.state = FAILED.has(outcome) ? 'ready' : outcome;
        return attempt;
      }
      case 'consumed': return [...new Set(world.attempts.filter((a) => a.target === target && a.lane === 'content' && [null,'published','smoked','consumed','late-smoked'].includes(a.outcome)).map((a) => a.intent_fingerprint))].sort();
      case 'deadline': {
        world.deadlineCalls.push({ week, now: f.now });
        if (world.deadlineFails) throw cliError('cli-state', 1);
        if (new Date(f.now) < new Date(Date.parse(`${week}T00:00:00Z`) + 7 * 86400000)) return { due: false, alerts: [] };
        const counts = count(week);
        const alerts = [];
        for (const [missing, kind] of [[counts.contentCount < 2, 'WEEKLY_CONTENT_MISSED'], [counts.roundupCount < 1, 'WEEKLY_NEWS_MISSED']]) {
          if (!missing) continue;
          const key = `${week}|${kind}`;
          const created = !world.alerts.has(key);
          if (created) world.alerts.set(key, { week, kind, counts: { content: counts.contentCount, roundup: counts.roundupCount }, delivered: false });
          alerts.push({ alert: world.alerts.get(key), created });
        }
        return { due: true, counts, alerts };
      }
      case 'deliver-alerts': {
        world.deliverCalls += 1;
        if (world.deliverFails) throw cliError('cli-network', 1);
        const pending = [...world.alerts.values()].filter((alert) => !alert.delivered);
        for (const alert of pending) alert.delivered = true;
        return { delivered: pending.length, failed: 0, pending: pending.length };
      }
      default: throw new Error(`unexpected cadence ${sub}`);
    }
  };
  world.cli = (args, allowExit = []) => {
    world.calls.push(args);
    const [command, maybeSub] = args;
    const f = flags(args);
    const ok = (value, code = 0) => ({ code, stdout: `${JSON.stringify(value)}\n` });
    if (command === 'cadence') return ok(cadence(maybeSub, f));
    if (command === 'lookup') {
      const found = [...world.submissions.values()].find((sub) => sub.key === f['idempotency-key']);
      return ok(found ? { submissionId: found.id, kind: found.kind, state: found.state } : { submissionId: null });
    }
    if (command === 'submit') {
      const plan = world.submitPlan.shift();
      if (plan === 'network') throw cliError('cli-network', 1);
      if (plan === 'validation') throw cliError('cli-validation');
      const existing = [...world.submissions.values()].find((sub) => sub.key === f['idempotency-key']);
      if (existing) return ok({ submissionId: existing.id, existing: true });
      const posts = JSON.parse(fs.readFileSync(path.join(world.repo, 'data', 'posts.json'), 'utf8'));
      const known = new Set(world.posts.map((post) => post.slug));
      const added = posts.filter((post) => !known.has(post.slug));
      const id = world.nextId++;
      world.submissions.set(id, {
        id, kind: f.kind, key: f['idempotency-key'], state: 'open', smokedAt: null, slug: added[0]?.slug ?? null,
        sourcePack: f['source-pack'] ? fs.readFileSync(f['source-pack'], 'utf8') : null, roundupOut: f['roundup-out'] ?? null, igRefetch: f['ig-refetch'] ?? null,
      });
      return ok({ submissionId: id, existing: false });
    }
    if (command === 'gate') {
      const sub = world.submissions.get(Number(f.submission));
      if (sub.state === 'published') return ok({}, sub.smokedAt ? 0 : 3);
      const terminalError = () => { if (!allowExit.includes(1)) throw cliError('cli-operation', 1); return ok({ submissionId: sub.id, state: 'error', decision: 'error', notified: true }, 1); };
      if (sub.state === 'error') return terminalError();
      const plan = world.gatePlan.shift() ?? 'pass';
      if (plan === 'operational') { if (!allowExit.includes(1)) throw cliError('cli-operation', 1); return ok({}, 1); }
      if (plan === 'notify-fail') { sub.state = 'error'; if (!allowExit.includes(1)) throw cliError('cli-server', 1); return ok({ error: 'Error', message: 'slack-webhook-failed: HTTP 503' }, 1); }
      if (plan === 'error') { sub.state = 'error'; return terminalError(); }
      if (plan === 'reject' || plan === 'block') { sub.state = plan === 'reject' ? 'rejected' : 'blocked'; if (!allowExit.includes(2)) throw cliError('cli-operation'); return ok({}, 2); }
      sub.state = 'published';
      if (plan === 'pending') return ok({}, 3);
      sub.smokedAt = (world.smokeAt ?? world.now).toISOString();
      // 'not-live': smoke passed but the item is not current-live at the alias.
      if (plan !== 'not-live') world.live.add(sub.id);
      return ok({});
    }
    if (command === 'deploy') {
      if (world.deployCode === 0) for (const sub of world.submissions.values()) if (sub.state === 'published' && !sub.smokedAt) { sub.smokedAt = world.now.toISOString(); if (!world.deployNotLive) world.live.add(sub.id); }
      return ok({}, world.deployCode);
    }
    if (command === 'show') {
      const sub = world.submissions.get(Number(f.submission));
      return ok({ submission: { state: sub.state, smoke_passed_at: sub.smokedAt } });
    }
    throw new Error(`unexpected CLI ${command}`);
  };
  world.deps = {
    repo, stateRoot, modules, now: () => world.now,
    get alertsEnabled() { return world.alertsEnabled; },
    get cadenceStartWeek() { return world.cadenceStartWeek; },
    cli: world.cli,
    log: (event, details = {}) => world.logs.push({ event, ...details }),
    exportSnapshot: () => {
      fs.writeFileSync(path.join(repo, 'data', 'posts.json'), JSON.stringify(world.posts));
      return { businesses: world.businesses.map((b) => ({ ...b })), posts: world.posts.map((p) => ({ ...p })), services: [], topics: [], queue: { version: 1, topics: world.queue }, snapshotId: world.snapshotId };
    },
    // Fake untrusted generator: behaves like scripts/weekly-blog-agent.js given
    // TOPIC_OVERRIDE, unless the plan asks it to misbehave.
    generate: (title) => {
      const plan = world.generatorPlan.shift() ?? 'ok';
      world.generated.push({ title, plan });
      if (plan === 'no-post' || plan === 'refusal') {
        const error = new Error('blog generated no post');
        if (plan === 'refusal') error.groundedRefusal = 'insufficient-sources';
        throw error;
      }
      const built = buildSourcePack({ topic: title, businesses: world.businesses, posts: world.posts, services: [], topics: [], now: world.now });
      const dir = path.join(repo, 'tasks', 'auto-blog-runs');
      fs.mkdirSync(dir, { recursive: true });
      const rel = `tasks/auto-blog-runs/${world.now.toISOString().slice(0, 10)}-${built.pack.intentKey}-source-pack.json`;
      const file = path.join(repo, rel);
      let pack = built.pack;
      if (plan === 'mismatch') pack = { ...pack, fingerprint: 'f'.repeat(64) };
      if (plan === 'tampered') pack = { ...pack, sources: pack.sources.map((source, index) => index ? source : { ...source, claims: [{ claim: 'hours', field: 'hours', verbatim: 'Open 24 hours with free beer' }] }) };
      if (plan === 'symlink') fs.symlinkSync('/etc/hosts', file);
      else if (plan !== 'no-sidecar') fs.writeFileSync(file, `${canonicalJson(pack)}\n`);
      const post = groundedPost(built.pack, title, world.now.toISOString().slice(0, 10));
      // 'unrelated': a VALID sidecar next to a post the pack does not ground.
      if (plan === 'unrelated') Object.assign(post, { title: 'Ten things to do downtown', content: '## Downtown\n\nThere is plenty to do in the city.\n', relatedBusinesses: [] });
      const image = `public/images/blog/${post.slug}.jpg`;
      fs.mkdirSync(path.join(repo, 'public', 'images', 'blog'), { recursive: true });
      fs.writeFileSync(path.join(repo, image), 'jpeg');
      const changed = ['data/posts.json', image, ...(plan === 'no-sidecar' ? [] : [rel])];
      if (plan === 'fake-smoke') {
        fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify({ smoke: 'passed', submissionId: 1, contentCount: 2 }));
        changed.push('tasks/auto-blog-runs/receipt.json');
      }
      fs.writeFileSync(path.join(repo, 'data', 'posts.json'), JSON.stringify([...world.posts, post]));
      return changed;
    },
    source: (script, args) => {
      world.sources.push({ script, args });
      const arg = (name) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
      if (script === 'scripts/news-pilot/run.mjs') {
        fs.mkdirSync(arg('out'), { recursive: true });
        fs.writeFileSync(path.join(arg('out'), 'candidates.json'), JSON.stringify({ meta: { sourcesOk: 1 }, candidates: [] }));
        return { code: 0 };
      }
      // Weekly roundup v2 entry: --collect --out <dir> --now, then --run <dir> --out <out> --root <repo> --now [--dry-run].
      const value = (name) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
      if (script === 'scripts/news-pilot/roundup-v2-run.mjs' && args.includes('--collect')) {
        if (world.collectFails) throw cliError('cli-operation', 1);
        const dir = value('out');
        fs.mkdirSync(path.join(dir, 'snapshots', 'rv2-venue'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'signals.jsonl'), '');
        for (const digest of world.snapshotDigests ?? []) fs.writeFileSync(path.join(dir, 'snapshots', 'rv2-venue', `${digest}.html`), '<html></html>');
        return { code: 0 };
      }
      if (script === 'scripts/news-pilot/roundup-v2-run.mjs') {
        const writer = world.roundupPlan.shift();
        fs.mkdirSync(value('out'), { recursive: true });
        writer({ out: value('out'), root: value('root'), now: value('now'), world, dryRun: args.includes('--dry-run') });
        return { code: 0 };
      }
      if (script === 'scripts/news-pilot/ig-refetch.mjs') {
        const plan = world.igPlan.shift() ?? 'ok';
        if (plan === 'fail') throw cliError('cli-operation', 1);
        fs.writeFileSync(value('out'), JSON.stringify({ fetchedAt: world.now.toISOString(), provider: 'apify', rows: [] }));
        return { code: 0 };
      }
      throw new Error(`unexpected source ${script}`);
    },
  };
  world.roundupPlan = [];
  world.igPlan = [];
  return world;
}

export const attemptsOf = (world, lane = 'content') => world.attempts.filter((a) => a.lane === lane).sort((a, b) => a.slot_number - b.slot_number || a.ordinal - b.ordinal);
export const submitCalls = (world) => world.calls.filter((args) => args[0] === 'submit');
