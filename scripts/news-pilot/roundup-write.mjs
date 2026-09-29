import fs from 'node:fs';
import path from 'node:path';
import { generateDraftWithModel, parseModelJson, resolveModelProvider } from './draft-model.mjs';
import { roundupCoverageFromPack } from './roundup-verify.mjs';
import { roundupSlug } from './roundup.mjs';

const unsafeImpact = /\b(?:crowd(?:s|ing)?|congestion|detours?|traffic disruption|parking restrictions?|road closures?)\b/i;
const unsafeCopy = /\b(?:crime|murder|stabbing|robbery|election|candidate|vote for)\b/i;
// Fail-closed copy guard (Fable L1): bidi overrides/isolates, zero-width and
// C0/C1 controls must never reach public Markdown. Supported whitespace
// (space, tab, newline) and ordinary glyphs are untouched; rejection, not mutation.
const unsafeControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\uFFF9-\uFFFB\uFFFE\uFFFF\u061C]/;
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
const compact = (unit) => ({ unitId: unit.identityKey, subject: unit.subject, what: unit.what,
  verdict: unit.verdict, when: unit.when, date: unit.date, itemType: unit.itemType,
  evidence: unit.evidence, citations: unit.citations,
  people: unit.people });

export function checkRoundupDraft(draft, units) {
  const errors = [];
  if (!text(draft?.intro, 450) || !Array.isArray(draft?.units) || draft.units.length !== units.length) errors.push('draft-shape');
  if (typeof draft?.intro === 'string' && unsafeControls.test(draft.intro)) errors.push('unsafe-control-chars');
  const ids = new Set();
  for (const entry of draft?.units || []) {
    const unit = units.find((u) => u.identityKey === entry?.unitId);
    if (!unit || ids.has(entry.unitId) || !text(entry.heading, 120) || !text(entry.body, 650)) { errors.push('unit-shape'); continue; }
    ids.add(entry.unitId);
    if (unsafeControls.test(`${entry.heading} ${entry.body}`)) errors.push('unsafe-control-chars');
    if (/https?:\/\/|\]\(/.test(`${entry.heading} ${entry.body}`)) errors.push('writer-link');
    if (unsafeCopy.test(`${entry.heading} ${entry.body}`)) errors.push('risk-wording');
    if (unsafeImpact.test(entry.body) && !unit.verifiedImpact && !['road', 'transit'].includes(unit.itemType) &&
        !units.some((u) => ['road', 'transit'].includes(u.itemType) && u.date === unit.date)) errors.push('unsupported-impact');
    if (unit.verdict === 'adjacent' && /\bin Liberty Village\b/i.test(entry.body)) errors.push('wrong-place');
    if (unit.verdict === 'core' && /\bnear Liberty Village\b/i.test(entry.body)) errors.push('wrong-place');
  }
  return errors;
}

export async function selectRoundupReviewer({ author, env = process.env, callModel = generateDraftWithModel,
  deadline = Date.now() + 600_000, resolve = resolveModelProvider } = {}) {
  const candidates = [...new Set([env.ROUNDUP_REVIEW_PROVIDER, 'google-gemini', 'deepseek', 'anthropic'].filter(Boolean))];
  for (const id of candidates) {
    if (id === author.provider?.id) continue;
    const selected = await resolve(env, { prefer: id });
    if (!selected.ok || selected.provider.id !== id) continue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const probe = await callModel({ resolved: selected, system: 'Return only valid JSON with quoted keys: {"ok":true}.',
        userText: '{}', maxTokens: 256, timeoutMs: Math.min(20_000, remaining) });
      if (probe.ok && parseModelJson(probe.text).value?.ok === true) return selected;
    } catch { /* failed probe: try another distinct provider, never reuse it */ }
  }
  throw new Error('roundup_independent_reviewer_unavailable');
}

async function jsonCall(callModel, resolved, system, user, maxTokens = 7000) {
  const result = await callModel({ resolved, system, userText: JSON.stringify(user), maxTokens, timeoutMs: 90_000 });
  if (!result?.ok) throw new Error(`roundup_model_failed:${result?.error || 'unknown'}`);
  const parsed = parseModelJson(result.text);
  if (!parsed.ok) throw new Error('roundup_model_invalid_json');
  return parsed.value;
}

const findingString = (value) => typeof value === 'string' && Boolean(value.trim());
const findingObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const factProblems = new Set(['unsupported', 'wrong-date', 'wrong-place', 'overclaim', 'missing-attribution']);
const riskProblems = new Set(['wrong-place', 'unsupported-impact', 'wrong-date', 'tone']);
const validFactFinding = (finding, known) => findingObject(finding) && known.has(finding.unitId) &&
  findingString(finding.sentence) && factProblems.has(finding.problem) && findingString(finding.fix);
const validRiskFinding = (finding, known) => findingObject(finding) && known.has(finding.unitId) &&
  (finding.problem === 'private-individual' ? findingString(finding.person) :
    riskProblems.has(finding.problem) && findingString(finding.fix) &&
      (finding.person == null || findingString(finding.person)));

/** Writer budget (§9.2): reviewer probes count inside the six-call writer ceiling. */
export const WRITER_MAX_CALLS = 6;

/** Model calls have no tools; only verified items enter the copywriter. Two separate review roles run before assembly. */
export async function writeRoundup(pack, { env = process.env, resolved, reviewer, callModel = generateDraftWithModel,
  deadline = Date.now() + 600_000 } = {}) {
  const units = pack.units || [];
  if (!units.length) throw new Error('roundup_no_units');
  const author = resolved || await resolveModelProvider(env);
  if (!author.ok) throw new Error(`roundup_writer_unavailable:${author.error}`);
  let modelCalls = 0;
  const countingCall = async (args) => {
    modelCalls += 1;
    if (modelCalls > WRITER_MAX_CALLS) throw new Error('roundup_writer_failed:writer-budget');
    return callModel(args);
  };
  const critic = reviewer || await selectRoundupReviewer({ author, env, callModel: countingCall, deadline });
  if (!critic.ok || critic.provider.id === author.provider.id) throw new Error('roundup_independent_reviewer_unavailable');
  const material = units.map(compact);
  const known = new Set(units.map((unit) => unit.identityKey));
  const cappedCall = (args) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('roundup_model_wall_clock_exceeded');
    return countingCall({ ...args, timeoutMs: Math.min(args.timeoutMs, remaining) });
  };
  const instructions = 'Return JSON {intro:string,units:[{unitId,heading,body}]}. Neutral, useful Liberty Village voice. 1–3 sentences per unit; 1–2 intro sentences. Say in Liberty Village only for core; near Liberty Village for adjacent. State actual dates, not this week for old news. Only facts in the supplied verified evidence. No new people, figures, links, claims of congestion, detours or crowding without explicit verified evidence. Do not reproduce Instagram captions; paraphrase.';
  let draft = await jsonCall(cappedCall, author, instructions, { units: material }, 9000);
  const findings = [];
  let errors = checkRoundupDraft(draft, units);
  if (errors.length) {
    draft = await jsonCall(cappedCall, author, `Repair only these deterministic errors: ${errors.join(', ')}. ${instructions}`, { draft, units: material }, 9000);
    errors = checkRoundupDraft(draft, units);
    if (errors.length) throw new Error(`roundup_writer_failed:${errors.join(',')}`);
  }
  const fact = await jsonCall(cappedCall, critic.ok ? critic : author,
    'Independent fact reviewer. Return ONLY strict RFC 8259 JSON with double-quoted keys and strings: {"findings":[{"unitId":"...","sentence":"...","problem":"unsupported|wrong-date|wrong-place|overclaim|missing-attribution","fix":"..."}]}. An empty array is valid. Compare each statement against verified unit.when, unit.what, unit.subject and its evidence; feed dates and location are verified typed facts even if not literal quote text. No new sources.',
    { draft, units: material });
  if (!Array.isArray(fact?.findings) || !fact.findings.every((finding) => validFactFinding(finding, known)))
    throw new Error('roundup_fact_review_invalid');
  findings.push({ round: 1, findings: fact.findings });
  if (fact.findings.length) draft = await jsonCall(cappedCall, author, `Revise only flagged sentences; keep IDs and all other text. ${instructions}`, { draft, findings: fact.findings, units: material }, 9000);
  errors = checkRoundupDraft(draft, units);
  if (errors.length) throw new Error(`roundup_writer_failed:${errors.join(',')}`);
  const risk = await jsonCall(cappedCall, critic.ok ? critic : author,
    'Independent locality, private-person, impact and tone reviewer. Assess named people in EACH quoted record and draft; a private individual includes a resident’s home, finances, relationships, health, victimhood or opinions. Return ONLY strict RFC 8259 JSON with double-quoted keys and strings: {"findings":[{"unitId":"...","person":"...","problem":"private-individual|wrong-place|unsupported-impact|wrong-date|tone","fix":"..."}]}. An empty array is valid. Flag crime/election and ungrounded impact too.',
    { draft, units: material });
  if (!Array.isArray(risk?.findings)) throw new Error('roundup_risk_review_invalid');
  // Preserve the explicit unknown-private-person refusal; invalid or opaque
  // review entries otherwise HOLD rather than becoming an editorial approval.
  for (const f of risk.findings) {
    if (f?.problem === 'private-individual' && !known.has(f?.unitId))
      throw new Error('roundup_writer_failed:unknown-private-individual-unit');
  }
  if (!risk.findings.every((finding) => validRiskFinding(finding, known)))
    throw new Error('roundup_risk_review_invalid');
  findings.push({ round: 2, findings: risk.findings });
  const refused = new Set(risk.findings.filter((f) => f.problem === 'private-individual').map((f) => f.unitId));
  const safeUnits = units.filter((unit) => !refused.has(unit.identityKey));
  if (risk.findings.some((f) => f?.problem !== 'private-individual')) {
    draft = await jsonCall(cappedCall, author, `Revise only flagged sentences; preserve surviving IDs. ${instructions}`,
      { draft, findings: risk.findings, units: safeUnits.map(compact) }, 9000);
  }
  draft = { ...draft, units: (draft.units || []).filter((entry) => !refused.has(entry.unitId)) };
  errors = checkRoundupDraft(draft, safeUnits);
  if (errors.length) throw new Error(`roundup_writer_failed:${errors.join(',')}`);
  return { draft, findings, refused: [...refused], units: safeUnits, modelCalls };
}

const escapeMarkdown = (value) => String(value || '').replace(/[\[\]()]/g, '');
const citation = (source) => {
  const url = source.url || source.canonicalUrl;
  if (!/^https:\/\//.test(url || '')) throw new Error('roundup citation requires https URL');
  const label = [source.publisher || source.sourceId || 'Source', source.recordId && (source.feed || source.listing) ? `record ${source.recordId}` : '']
    .filter(Boolean).join(', ');
  return `[${escapeMarkdown(label)}](${url})`;
};

/** URLs, ordering and coverage are assembled by trusted code, not by a model. */
export function assembleRoundupPost({ pack, draft, image = '/images/og/og-home.jpg', root = process.cwd(), imageExists }) {
  const units = pack.units || [];
  if (checkRoundupDraft(draft, units).length) throw new Error('roundup draft invalid');
  if (typeof image !== 'string' || !/^\/images\/[\w/-]+\.[\w]+$/.test(image) ||
      !(imageExists ? imageExists(image) : fs.existsSync(path.join(root, 'public', image.slice(1)))))
    throw new Error('roundup image missing');
  const isoWeek = pack.isoWeek;
  const start = new Date(`${isoWeek.slice(0, 4)}-01-04T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) + (Number(isoWeek.slice(6)) - 1) * 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const title = `Liberty Village + Exhibition Place this week: ${fmt(start)}–${fmt(end)}, ${end.getUTCFullYear()}`;
  const sections = units.map((unit, i) => {
    const entry = draft.units.find((u) => u.unitId === unit.identityKey);
    const sources = unit.citations || unit.evidence || [];
    if (!entry || !sources.length) throw new Error('roundup unit missing copy/citation');
    const dates = unit.members?.length ? unit.members.map((member) => member.date) : [unit.date || unit.when?.date];
    if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date || ''))) throw new Error('roundup unit actual date missing');
    // The verified dates are assembled independently of whatever wording the model chose.
    return `## ${i + 1}. ${entry.heading}\n\nDates: ${[...new Set(dates)].join(', ')}. ${entry.body}\n\nSource: ${sources.map(citation).join('; ')}`;
  });
  if (pack.stillInEffect?.length) sections.push('### Still in effect\n\n' + pack.stillInEffect.map((u) =>
    `- ${escapeMarkdown(u.subject)} (${u.date || u.when?.date}): ${(u.citations || []).map(citation).join('; ')}`).join('\n'));
  const date = new Date(pack.now).toISOString().slice(0, 10);
  const description = `Liberty Village + Exhibition Place this week. ${draft.intro}`;
  return { slug: roundupSlug(isoWeek), title, description, content: `${draft.intro}\n\n${sections.join('\n\n')}`,
    publishedAt: date, updatedAt: date, category: 'news', tags: ['liberty village', 'exhibition place', 'news'],
    answerBlock: draft.intro, faqs: [], keyTakeaways: units.map((u) => u.subject || u.identityKey),
    relatedServices: [], relatedTopics: [], relatedPosts: [], author: 'LibertyVillage.co', image,
    roundupCoverage: roundupCoverageFromPack(pack) };
}
