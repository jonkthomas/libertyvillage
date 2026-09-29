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
import { buildSourcePack, verifySourcePack, canonicalJson } from '../../scripts/automation/blog-source-pack.mjs';
import { roundupPackDigest } from '../../scripts/news-pilot/roundup-evidence.mjs';
import { isoWeekOf, roundupSlug } from '../../scripts/news-pilot/roundup.mjs';

export const modules = Object.freeze({ weekStartUtc, checkTopicGroundability, reserveGuideEligibility, buildSourcePack, verifySourcePack, canonicalJson, roundupPackDigest, isoWeekOf, roundupSlug });

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
]);
export const topic = (key, title, extra = {}) => ({ key, kind: 'blog', title, source: 'gsc', rationale: 'test', addedAt: '2026-09-01T00:00:00.000Z', attempts: 0, branchPrefix: 'blog/auto-', ...extra });
export const TOPICS = Object.freeze({
  pet: topic('k-pet', 'Pet-Friendly Restaurants in Liberty Village'),
  happy: topic('k-happy', 'Liberty Village Happy Hour'),
  coffee: topic('k-coffee', 'Coffee Shops'),
  fitness: topic('k-fitness', 'Fitness Classes'),
  reserve: topic('k-reserve', 'Bars Cafes and Gyms', { reserve: true }),
});
export const WED = new Date('2026-09-30T11:00:00.000Z');
export const FRI = new Date('2026-10-02T11:00:00.000Z');
export const SUN = new Date('2026-10-04T16:00:00.000Z');

export function createWorld({ now = WED, queue = [TOPICS.happy, TOPICS.coffee, TOPICS.fitness], posts = [{ slug: 'existing-post', title: 'Existing Post', category: 'lifestyle' }] } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cadence-repo-'));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cadence-state-'));
  fs.mkdirSync(path.join(repo, 'data'), { recursive: true });
  const world = {
    repo, stateRoot, now, queue, posts, snapshotId: 'a'.repeat(40),
    slots: new Map(), attempts: [], submissions: new Map(), nextId: 100, live: new Set(),
    calls: [], logs: [], generated: [], sources: [],
    heldByOther: new Set(), gatePlan: [], deployCode: 0, submitPlan: [], generatorPlan: [], deadlineCalls: 0, alertsCalled: 0,
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
    const roundup = rows.filter((sub) => sub.kind === 'roundup').map((sub) => ({ slug: sub.slug, submissionId: sub.id }));
    return { content, roundup, contentCount: content.length, roundupCount: roundup.length, met: content.length >= 2 && roundup.length >= 1, dbOnly: { contentCount: content.length, roundupCount: roundup.length } };
  };
  const cadence = (sub, f) => {
    const week = f['week-start'];
    const target = f.target;
    const n = Number(f['slot-number']);
    switch (sub) {
      case 'count': return count(week);
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
      case 'attempt': {
        const slot = slotFor(week, f.lane, n);
        if (slot.token !== f.token) throw cliError('cli-claim', 1);
        for (const name of ['intent-fingerprint', 'topic-key', 'source-pack-digest']) if (typeof f[name] !== 'string' || !f[name].trim()) throw cliError('cli-validation');
        const prior = world.attempts.filter((a) => a.week_start_utc === week && a.lane === f.lane && a.slot_number === slot.slot_number).sort((a, b) => b.ordinal - a.ordinal);
        const latest = prior[0];
        if (latest && [null, 'published', 'smoked'].includes(latest.outcome)) return { ordinal: latest.ordinal, idempotencyKey: latest.idempotency_key, existing: true };
        if (latest?.outcome === 'consumed') throw cliError('cli-state', 1);
        if (prior.some((a) => a.intent_fingerprint === f['intent-fingerprint'])) throw cliError('cli-validation');
        const ordinal = slot.attempt_ordinal + 1;
        const attempt = { target, week_start_utc: week, lane: f.lane, slot_number: slot.slot_number, ordinal, intent_fingerprint: f['intent-fingerprint'], topic_key: f['topic-key'], idempotency_key: keyFor(target, week, f.lane, slot.slot_number, ordinal), source_pack_digest: f['source-pack-digest'], submission_id: null, outcome: null };
        world.attempts.push(attempt);
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
        if (attempt.outcome === 'smoked' && outcome !== 'consumed') throw cliError('cli-state', 1);
        if (outcome === 'consumed' && (attempt.outcome !== 'smoked' || !world.live.has(attempt.submission_id))) throw cliError('cli-state', 1);
        attempt.outcome = outcome;
        slot.state = FAILED.has(outcome) ? 'ready' : outcome;
        return attempt;
      }
      case 'deadline': world.deadlineCalls += 1; return { due: false, alerts: [] };
      case 'deliver-alerts': world.alertsCalled += 1; return { delivered: 0 };
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
        sourcePack: f['source-pack'] ? fs.readFileSync(f['source-pack'], 'utf8') : null, roundupOut: f['roundup-out'] ?? null,
      });
      return ok({ submissionId: id, existing: false });
    }
    if (command === 'gate') {
      const sub = world.submissions.get(Number(f.submission));
      if (sub.state === 'published') return ok({}, sub.smokedAt ? 0 : 3);
      const plan = world.gatePlan.shift() ?? 'pass';
      if (plan === 'reject' || plan === 'block') { sub.state = plan === 'reject' ? 'rejected' : 'blocked'; if (!allowExit.includes(2)) throw cliError('cli-operation'); return ok({}, 2); }
      sub.state = 'published';
      if (plan === 'pending') return ok({}, 3);
      sub.smokedAt = world.now.toISOString();
      world.live.add(sub.id);
      return ok({});
    }
    if (command === 'deploy') {
      if (world.deployCode === 0) for (const sub of world.submissions.values()) if (sub.state === 'published' && !sub.smokedAt) { sub.smokedAt = world.now.toISOString(); world.live.add(sub.id); }
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
    cli: world.cli,
    log: (event, details = {}) => world.logs.push({ event, ...details }),
    exportSnapshot: () => {
      fs.writeFileSync(path.join(repo, 'data', 'posts.json'), JSON.stringify(world.posts));
      return { businesses: BUSINESSES.map((b) => ({ ...b })), posts: world.posts.map((p) => ({ ...p })), services: [], topics: [], queue: { version: 1, topics: world.queue }, snapshotId: world.snapshotId };
    },
    // Fake untrusted generator: behaves like scripts/weekly-blog-agent.js given
    // TOPIC_OVERRIDE, unless the plan asks it to misbehave.
    generate: (title) => {
      const plan = world.generatorPlan.shift() ?? 'ok';
      world.generated.push({ title, plan });
      if (plan === 'no-post') throw new Error('blog generated no post');
      const built = buildSourcePack({ topic: title, businesses: BUSINESSES, posts: world.posts, services: [], topics: [], now: world.now });
      const dir = path.join(repo, 'tasks', 'auto-blog-runs');
      fs.mkdirSync(dir, { recursive: true });
      const rel = `tasks/auto-blog-runs/${world.now.toISOString().slice(0, 10)}-${built.pack.intentKey}-source-pack.json`;
      const file = path.join(repo, rel);
      let pack = built.pack;
      if (plan === 'mismatch') pack = { ...pack, fingerprint: 'f'.repeat(64) };
      if (plan === 'tampered') pack = { ...pack, sources: pack.sources.map((source, index) => index ? source : { ...source, claims: [{ claim: 'hours', field: 'hours', verbatim: 'Open 24 hours with free beer' }] }) };
      if (plan === 'symlink') fs.symlinkSync('/etc/hosts', file);
      else if (plan !== 'no-sidecar') fs.writeFileSync(file, `${canonicalJson(pack)}\n`);
      const changed = ['data/posts.json', ...(plan === 'no-sidecar' ? [] : [rel])];
      if (plan === 'fake-smoke') {
        fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify({ smoke: 'passed', submissionId: 1, contentCount: 2 }));
        changed.push('tasks/auto-blog-runs/receipt.json');
      }
      fs.writeFileSync(path.join(repo, 'data', 'posts.json'), JSON.stringify([...world.posts, { slug: built.pack.intentKey, title, category: 'lifestyle' }]));
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
      if (script === 'scripts/news-pilot/roundup-run.mjs') {
        const writer = world.roundupPlan.shift();
        fs.mkdirSync(arg('out'), { recursive: true });
        writer({ out: arg('out'), root: arg('root'), now: arg('now'), world });
        return { code: 0 };
      }
      throw new Error(`unexpected source ${script}`);
    },
  };
  world.roundupPlan = [];
  return world;
}

export const attemptsOf = (world, lane = 'content') => world.attempts.filter((a) => a.lane === lane).sort((a, b) => a.slot_number - b.slot_number || a.ordinal - b.ordinal);
export const submitCalls = (world) => world.calls.filter((args) => args[0] === 'submit');
