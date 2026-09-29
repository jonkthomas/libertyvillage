import { generateDraftWithModel, parseModelJson, resolveModelProvider } from './draft-model.mjs';
import { ROUNDUP_SOURCES } from './sources.mjs';

const KINDS = new Set(['news-update', 'event', 'restriction', 'alert']);
const TYPES = new Set(['event', 'class', 'concert', 'sports', 'expo', 'community', 'opening', 'closure', 'road', 'transit', 'project', 'news']);
const ROLES = new Set(['performer', 'athlete', 'team', 'organisation', 'business', 'public-official', 'private-person', 'unclear']);
const VERDICTS = new Set(['core', 'adjacent', 'not-LV']);
const RISKS = ['crime', 'election', 'private_individual', 'development_application', 'civic_controversy'];
const bounded = (x, n) => typeof x === 'string' && x.length <= n;
const date = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T12:00:00Z`));
const time = (x) => x === null || (typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x));

/** Model output is data, never evidence. Every citation must point at a supplied signal record. */
export function validateRoundupForm(form, signal) {
  if (!form || !signal || form.signalId !== signal.signalId ||
      !signal.records?.some((record) => record.recordId === form.recordId)) return false;
  if (!bounded(form.subject, 120) || !form.subject.trim() || !bounded(form.what, 200) ||
      !bounded(form.where_it_happens, 200) || !bounded(form.who_is_affected, 200) ||
      !bounded(form.relevance_reason, 300) || !VERDICTS.has(form.verdict) || !TYPES.has(form.item_type)) return false;
  const w = form.when;
  if (!w || !KINDS.has(w.kind) || !date(w.date) || !(w.endDate === null || date(w.endDate)) ||
      !time(w.startTime) || !time(w.endTime)) return false;
  if (!Array.isArray(form.evidence) || form.evidence.length < 1 || form.evidence.length > 3 ||
      form.evidence[0].recordId !== form.recordId) return false;
  for (const e of form.evidence) {
    if (typeof e?.url !== 'string' || !e.url.startsWith('https://') || !bounded(e.recordId, 200) ||
        !bounded(e.subject_quote, 300) || !e.subject_quote ||
        !(e.place_quote === null || bounded(e.place_quote, 300)) ||
        !(e.date_quote === null || bounded(e.date_quote, 200))) return false;
  }
  if (!form.risk || RISKS.some((k) => typeof form.risk[k] !== 'boolean') ||
      !Array.isArray(form.people) || form.people.some((p) => !bounded(p.name, 120) || !ROLES.has(p.role)) ||
      !(form.exclude_reason === null || bounded(form.exclude_reason, 300))) return false;
  return true;
}

const SYSTEM = `You are a cautious Toronto local-news signal analyst. Return ONLY JSON {"forms":[...]}, exactly one form per supplied signal. The form shape is signalId,recordId,subject,what,where_it_happens,when:{kind,date,endDate,startTime,endTime},who_is_affected,relevance_reason,verdict,evidence:[{url,recordId,subject_quote,place_quote,date_quote}],item_type,people:[{name,role}],risk:{crime,election,private_individual,development_application,civic_controversy},exclude_reason. EXACT enums: when.kind="event"|"news-update"|"restriction"|"alert" (never "single"); verdict="core"|"adjacent"|"not-LV"; item_type="event"|"class"|"concert"|"sports"|"expo"|"community"|"opening"|"closure"|"road"|"transit"|"project"|"news"; people.role="performer"|"athlete"|"team"|"organisation"|"business"|"public-official"|"private-person"|"unclear". All five risk values must be booleans; exclude_reason is null or a brief string. Dates are Toronto-local YYYY-MM-DD relative to referenceNow; a yearless Oct 03 just after referenceNow 2026-09-29 means 2026-10-03, not 2025-10-03. endDate/startTime/endTime are null when unstated; clock times use HH:mm. Quote VERBATIM from one item-bound record; the subject MUST be a verbatim substring of subject_quote (not a paraphrase). The place_quote and date_quote must also be literal substrings of that SAME record; use null when a trusted typed feed field proves the fact without a textual quote. Do not combine page sections or records; recordId must be supplied. Do not use a search snippet, page navigation, images, or another source for missing facts. If uncertain, set exclude_reason and conservative verdict. A person's private life, finances, health or residential opinions are excluded. Crime, elections and development applications are excluded. Your judgement does not establish locality, source quality or evidence: a deterministic verifier decides those.`;

export async function reasonRoundupSignals(signals, { env = process.env, resolved, callModel = generateDraftWithModel,
  now = new Date().toISOString(), deadline = Date.now() + 600_000 } = {}) {
  if (!Array.isArray(signals)) throw new Error('signals_not_array');
  if (!signals.length) return { forms: [], excluded: [] };
  const model = resolved || await resolveModelProvider(env);
  if (!model.ok) throw new Error(`roundup_reason_model_unavailable:${model.error}`);
  // Preserve each source family when a large road feed would otherwise consume
  // all six calls before any venue, Instagram, or news lead reaches reasoning.
  const familyOf = (signal) => {
    const source = ROUNDUP_SOURCES.find((entry) => entry.id === signal.sourceId);
    return source?.identityKind === 'road-feed' ? 'road' : source?.identityKind === 'transit-feed' ? 'transit'
      : source?.parse === 'ig-post' ? 'ig' : source?.identityKind === 'news-discovery' ? 'news' : 'other';
  };
  const quotas = { road: 12, transit: 6, ig: 16, news: 12, other: 14 };
  const selected = new Set();
  for (const [family, cap] of Object.entries(quotas)) {
    const bySource = new Map();
    for (const signal of signals) if (familyOf(signal) === family)
      bySource.set(signal.sourceId, [...(bySource.get(signal.sourceId) || []), signal]);
    let remaining = cap;
    while (remaining > 0 && [...bySource.values()].some((rows) => rows.length)) {
      for (const rows of bySource.values()) if (rows.length && remaining > 0) { selected.add(rows.shift()); remaining--; }
    }
  }
  for (const signal of signals) if (selected.size < 60) selected.add(signal);
  const queue = [...selected];
  const forms = [], excluded = signals.filter((s) => !selected.has(s))
    .map((s) => ({ signalId: s.signalId, reason: 'reason-budget' }));
  for (let at = 0; at < queue.length; at += 10) {
    const batch = queue.slice(at, at + 10);
    const input = batch.map((s) => ({ signalId: s.signalId, sourceId: s.sourceId, url: s.url,
      records: (s.records || []).map((r) => ({ recordId: r.recordId, text: r.text, typed: r.typed })) }));
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('roundup_model_wall_clock_exceeded');
    const answer = await callModel({ resolved: model, system: SYSTEM,
      userText: JSON.stringify({ referenceNow: now, signals: input }).slice(0, 32_000),
      maxTokens: 9000, timeoutMs: Math.min(90_000, remaining) });
    if (!answer.ok) { for (const s of batch) excluded.push({ signalId: s.signalId, reason: 'reason-failed' }); continue; }
    let parsed;
    try { const result = parseModelJson(answer.text); parsed = result.ok ? result.value : null; } catch { parsed = null; }
    const proposed = Array.isArray(parsed?.forms) ? parsed.forms : [];
    for (const signal of batch) {
      const matches = proposed.filter((f) => f?.signalId === signal.signalId);
      if (matches.length === 1 && validateRoundupForm(matches[0], signal)) forms.push(matches[0]);
      else excluded.push({ signalId: signal.signalId, reason: 'form-invalid' });
    }
  }
  return { forms, excluded };
}
