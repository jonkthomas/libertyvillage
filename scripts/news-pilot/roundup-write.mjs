import fs from 'node:fs';
import path from 'node:path';
import { generateDraftWithModel, parseModelJson, resolveModelProvider } from './draft-model.mjs';
import { roundupCoverageFromPack } from './roundup-verify.mjs';
import { roundupSlug } from './roundup.mjs';

const unsafeImpact = /\b(?:crowd(?:s|ing)?|congestion|detours?|traffic disruption|parking restrictions?|road closures?)\b/i;
const unsafeCopy = /\b(?:crime|murder|stabbing|robbery|election|candidate|vote for)\b/i;
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
const compact = (unit) => ({ unitId: unit.identityKey, subject: unit.subject, what: unit.what,
  verdict: unit.verdict, when: unit.when, date: unit.date, itemType: unit.itemType,
  evidence: unit.evidence, citations: unit.citations,
  people: unit.people });

export function checkRoundupDraft(draft, units) {
  const errors = [];
  if (!text(draft?.intro, 450) || !Array.isArray(draft?.units) || draft.units.length !== units.length) errors.push('draft-shape');
  const ids = new Set();
  for (const entry of draft?.units || []) {
    const unit = units.find((u) => u.identityKey === entry?.unitId);
    if (!unit || ids.has(entry.unitId) || !text(entry.heading, 120) || !text(entry.body, 650)) { errors.push('unit-shape'); continue; }
    ids.add(entry.unitId);
    if (/https?:\/\/|\]\(/.test(`${entry.heading} ${entry.body}`)) errors.push('writer-link');
    if (unsafeCopy.test(`${entry.heading} ${entry.body}`)) errors.push('risk-wording');
    if (unsafeImpact.test(entry.body) && !unit.verifiedImpact) errors.push('unsupported-impact');
    if (unit.verdict === 'adjacent' && /\bin Liberty Village\b/i.test(entry.body)) errors.push('wrong-place');
    if (unit.verdict === 'core' && /\bnear Liberty Village\b/i.test(entry.body)) errors.push('wrong-place');
  }
  return errors;
}

async function jsonCall(callModel, resolved, system, user, maxTokens = 7000) {
  const result = await callModel({ resolved, system, userText: JSON.stringify(user), maxTokens, timeoutMs: 90_000 });
  if (!result?.ok) throw new Error(`roundup_model_failed:${result?.error || 'unknown'}`);
  const parsed = parseModelJson(result.text);
  if (!parsed.ok) throw new Error('roundup_model_invalid_json');
  return parsed.value;
}

/** Model calls have no tools; only verified items enter the copywriter. Two separate review roles run before assembly. */
export async function writeRoundup(pack, { env = process.env, resolved, reviewer, callModel = generateDraftWithModel } = {}) {
  const units = pack.units || [];
  if (!units.length) throw new Error('roundup_no_units');
  const author = resolved || await resolveModelProvider(env);
  if (!author.ok) throw new Error(`roundup_writer_unavailable:${author.error}`);
  const critic = reviewer || await resolveModelProvider(env, { prefer: author.provider?.id === 'anthropic' ? 'google-gemini' : 'anthropic' });
  const material = units.map(compact);
  const instructions = 'Return JSON {intro:string,units:[{unitId,heading,body}]}. Neutral, useful Liberty Village voice. 1–3 sentences per unit; 1–2 intro sentences. Say in Liberty Village only for core; near Liberty Village for adjacent. State actual dates, not this week for old news. Only facts in the supplied verified evidence. No new people, figures, links, claims of congestion, detours or crowding without explicit verified evidence. Do not reproduce Instagram captions; paraphrase.';
  let draft = await jsonCall(callModel, author, instructions, { units: material }, 9000);
  const findings = [];
  let errors = checkRoundupDraft(draft, units);
  if (errors.length) {
    draft = await jsonCall(callModel, author, `Repair only these deterministic errors: ${errors.join(', ')}. ${instructions}`, { draft, units: material }, 9000);
    errors = checkRoundupDraft(draft, units);
    if (errors.length) throw new Error(`roundup_writer_failed:${errors.join(',')}`);
  }
  const fact = await jsonCall(callModel, critic.ok ? critic : author,
    'Independent fact reviewer. Return ONLY {findings:[{unitId,sentence,problem,fix}]} with problem unsupported|wrong-date|wrong-place|overclaim|missing-attribution. Compare every statement with its own quoted record. No new sources.',
    { draft, units: material });
  if (!Array.isArray(fact?.findings)) throw new Error('roundup_fact_review_invalid');
  findings.push({ round: 1, findings: fact.findings });
  if (fact.findings.length) draft = await jsonCall(callModel, author, `Revise only flagged sentences; keep IDs and all other text. ${instructions}`, { draft, findings: fact.findings, units: material }, 9000);
  errors = checkRoundupDraft(draft, units);
  if (errors.length) throw new Error(`roundup_writer_failed:${errors.join(',')}`);
  const risk = await jsonCall(callModel, critic.ok ? critic : author,
    'Independent locality, private-person, impact and tone reviewer. Assess named people in EACH quoted record and draft; a private individual includes a resident’s home, finances, relationships, health, victimhood or opinions. Return ONLY {findings:[{unitId,person,problem,fix}]}; problem private-individual|wrong-place|unsupported-impact|wrong-date|tone. Flag crime/election and ungrounded impact too.',
    { draft, units: material });
  if (!Array.isArray(risk?.findings)) throw new Error('roundup_risk_review_invalid');
  findings.push({ round: 2, findings: risk.findings });
  const refused = new Set(risk.findings.filter((f) => f?.problem === 'private-individual').map((f) => f.unitId));
  const safeUnits = units.filter((unit) => !refused.has(unit.identityKey));
  if (risk.findings.some((f) => f?.problem !== 'private-individual')) {
    draft = await jsonCall(callModel, author, `Revise only flagged sentences; preserve surviving IDs. ${instructions}`,
      { draft, findings: risk.findings, units: safeUnits.map(compact) }, 9000);
  }
  draft = { ...draft, units: (draft.units || []).filter((entry) => !refused.has(entry.unitId)) };
  errors = checkRoundupDraft(draft, safeUnits);
  if (errors.length) throw new Error(`roundup_writer_failed:${errors.join(',')}`);
  return { draft, findings, refused: [...refused], units: safeUnits };
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
