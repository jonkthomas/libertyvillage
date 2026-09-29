import { generateDraftWithModel, parseModelJson, resolveModelProvider } from './draft-model.mjs';
import { ROUNDUP_SOURCES } from './sources.mjs';
import { resolveCaptionDates } from './roundup-records.mjs';

const KINDS = new Set(['news-update', 'event', 'restriction', 'alert']);
const TYPES = new Set(['event', 'class', 'concert', 'sports', 'expo', 'community', 'opening', 'closure', 'road', 'transit', 'project', 'news']);
const ROLES = new Set(['performer', 'athlete', 'team', 'organisation', 'business', 'public-official', 'private-person', 'unclear']);
const VERDICTS = new Set(['core', 'adjacent', 'not-LV']);
const RISKS = ['crime', 'election', 'private_individual', 'development_application', 'civic_controversy'];
const bounded = (x, n) => typeof x === 'string' && x.length <= n;
const date = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T12:00:00Z`));
const time = (x) => x === null || (typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x));
const norm = (value) => String(value ?? '').normalize('NFC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

/** Repair model paraphrases only with verbatim, same-record spans (never synthesize evidence). */
function anchoredForm(form, signal) {
  const evidence = form?.evidence?.[0];
  const record = signal.records?.find((row) => row.recordId === form?.recordId);
  if (!record || !evidence) return form;
  let anchored = form;
  const quote = evidence.subject_quote;
  if (bounded(quote, 120) && quote?.trim() && norm(record.text).includes(norm(quote)) &&
      !norm(quote).includes(norm(form.subject))) anchored = { ...anchored, subject: quote };
  // A model may omit the literal "Location:" prefix from a valid quote. The
  // relation is proven only if that entire line is present in the same record.
  const place = evidence.place_quote;
  if (typeof place === 'string' && place.trim() && norm(record.text).includes(norm(place))) {
    const line = record.text.split(/\r?\n/).find((row) =>
      /^\s*(?:location|venue|address|where)\s*:/i.test(row) && norm(row).includes(norm(place)));
    if (line && bounded(line.trim(), 300) && line.trim() !== place)
      anchored = { ...anchored, evidence: [{ ...evidence, place_quote: line.trim() }, ...form.evidence.slice(1)] };
  }
  return anchored;
}

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

const SYSTEM = `You are a cautious Toronto local-news signal analyst. Return ONLY JSON {"forms":[...]}, exactly one form per supplied signal. The form shape is signalId,recordId,subject,what,where_it_happens,when:{kind,date,endDate,startTime,endTime},who_is_affected,relevance_reason,verdict,evidence:[{url,recordId,subject_quote,place_quote,date_quote}],item_type,people:[{name,role}],risk:{crime,election,private_individual,development_application,civic_controversy},exclude_reason. EXACT enums: when.kind="event"|"news-update"|"restriction"|"alert" (never "single"); verdict="core"|"adjacent"|"not-LV"; item_type="event"|"class"|"concert"|"sports"|"expo"|"community"|"opening"|"closure"|"road"|"transit"|"project"|"news"; people.role="performer"|"athlete"|"team"|"organisation"|"business"|"public-official"|"private-person"|"unclear". All five risk values must be booleans; exclude_reason is null or a brief string. Dates are Toronto-local YYYY-MM-DD relative to referenceDateToronto (not the UTC calendar day in referenceNow); a yearless Oct 03 just after referenceDateToronto 2026-09-29 means 2026-10-03, not 2025-10-03. endDate/startTime/endTime are null when unstated; clock times use HH:mm. Quote VERBATIM from one item-bound record; the subject MUST be a verbatim substring of subject_quote (not a paraphrase). The place_quote and date_quote must also be literal substrings of that SAME record; use null when a trusted typed feed field proves the fact without a textual quote. Do not combine page sections or records; recordId must be supplied. Do not use a search snippet, page navigation, images, or another source for missing facts. If uncertain, set exclude_reason and conservative verdict. A person's private life, finances, health or residential opinions are excluded. Crime, elections and development applications are excluded. A City public park-design open house (for example the approved 34 Hanna Avenue project event at 171 East Liberty St) is NOT a development application merely because it is on a project page; that exclusion is for actual planning/rezoning/permit applications. For an address-bearing official event give a provisional locality verdict from its own event location rather than the project site's location; the deterministic verifier independently decides locality, source quality and evidence.`;

export async function reasonRoundupSignals(signals, { env = process.env, resolved, callModel = generateDraftWithModel,
  now = new Date().toISOString(), deadline = Date.now() + 600_000 } = {}) {
  if (!Array.isArray(signals)) throw new Error('signals_not_array');
  if (!signals.length) return { forms: [], excluded: [] };
  const model = resolved || await resolveModelProvider(env, { prefer: env.ROUNDUP_REASON_PROVIDER || null });
  if (!model.ok) throw new Error(`roundup_reason_model_unavailable:${model.error}`);
  const torontoParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  const referenceDateToronto = `${torontoParts.year}-${torontoParts.month}-${torontoParts.day}`;
  // Offer dated near-term first-party IG, BIA and City-project records first;
  // stale or undated first-party records may yield to current official venue/feed
  // leads. Priority only orders reasoning; verification still proves place/time.
  const sources = new Map(ROUNDUP_SOURCES.map((source) => [source.id, source]));
  const priority = (signal) => {
    const source = sources.get(signal.sourceId);
    return source?.parse === 'ig-post' || ['org', 'project'].includes(source?.identityKind) ? 'first-party-core-lead' : 'other';
  };
  const maxCalls = 6, batchSize = 5, maxSignals = maxCalls * batchSize;
  const selected = new Set();
  const horizon = new Date(Date.parse(`${referenceDateToronto}T00:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
  const urgency = (signal) => {
    const source = sources.get(signal.sourceId);
    if (source?.identityKind === 'road-feed' || source?.identityKind === 'transit-feed')
      return (signal.records || []).some((record) => {
        const start = Number(record.typed?.startTime ?? record.typed?.activeStart);
        const end = Number(record.typed?.endTime ?? record.typed?.activeEnd);
        return Number.isFinite(end) && end > Date.parse(now) &&
          (!Number.isFinite(start) || start <= Date.parse(`${horizon}T23:59:59Z`));
      }) ? 1 : 0;
    const dates = (signal.records || []).flatMap((record) => record.typed?.date
      ? [record.typed.date] : resolveCaptionDates(record.text, signal.post?.timestamp || now));
    return dates.some((day) => day >= referenceDateToronto && day <= horizon) ? 1 : 0;
  };
  const tier = (signal) => `${priority(signal)}-${urgency(signal) ? 'current' : 'other'}`;
  const groups = ['first-party-core-lead-current', 'other-current', 'first-party-core-lead-other', 'other-other'];
  for (const group of groups) {
    if (selected.size >= maxSignals) break;
    const bySource = new Map();
    for (const signal of signals) if (tier(signal) === group)
      bySource.set(signal.sourceId, [...(bySource.get(signal.sourceId) || []), signal]);
    for (const [sourceId, rows] of bySource) {
      rows.sort((a, b) => (Date.parse(b.post?.timestamp || '') || 0) -
        (Date.parse(a.post?.timestamp || '') || 0) || a.signalId.localeCompare(b.signalId));
      // Search is a lead, never a way to crowd out official or first-party rows.
      if (sources.get(sourceId)?.identityKind === 'news-discovery' && rows.length > 12) rows.splice(12);
    }
    while (selected.size < maxSignals && [...bySource.values()].some((rows) => rows.length)) {
      for (const rows of bySource.values()) if (rows.length && selected.size < maxSignals) selected.add(rows.shift());
    }
  }
  const queue = [...selected];
  const forms = [], excluded = signals.filter((s) => !selected.has(s))
    .map((s) => ({ signalId: s.signalId, sourceId: s.sourceId, reason: 'reason-budget', priority: tier(s) }));
  let calls = 0, technicalFailure = false;
  for (let at = 0; at < queue.length; at += batchSize) {
    const batch = queue.slice(at, at + batchSize);
    if (calls >= maxCalls) {
      for (const s of batch) excluded.push({ signalId: s.signalId, sourceId: s.sourceId,
        reason: 'reason-budget', priority: tier(s) });
      if (batch.some((s) => tier(s) === 'first-party-core-lead-current')) technicalFailure = true;
      continue;
    }
    const input = batch.map((s) => ({ signalId: s.signalId, sourceId: s.sourceId, url: s.url,
      records: (s.records || []).map((r) => ({ recordId: r.recordId, text: r.text, typed: r.typed })) }));
    const request = { resolved: model, system: SYSTEM,
      userText: JSON.stringify({ referenceNow: now, referenceDateToronto, signals: input }).slice(0, 32_000),
      maxTokens: 9000 };
    const attempt = async () => {
      const remaining = deadline - Date.now();
      if (remaining < 180_000) return { ok: false, error: 'model-deadline' };
      calls++;
      try { return await callModel({ ...request, timeoutMs: 180_000 }); }
      catch { return { ok: false, error: 'model-exception' }; }
    };
    let answer = await attempt();
    if (!answer.ok && /^timeout_after_\d+ms$/.test(answer.error || '') && calls < maxCalls) answer = await attempt();
    if (!answer.ok) {
      technicalFailure = true;
      const failure = /^(?:http_\d{3}|timeout_after_\d+ms)$/.test(answer.error || '') ? answer.error : 'model-error';
      for (const s of batch) excluded.push({ signalId: s.signalId, sourceId: s.sourceId,
        reason: 'reason-failed', priority: tier(s), modelFailure: failure });
      continue;
    }
    let parsed;
    try { const result = parseModelJson(answer.text); parsed = result.ok ? result.value : null; } catch { parsed = null; }
    const proposed = Array.isArray(parsed?.forms) ? parsed.forms : [];
    for (const signal of batch) {
      const matches = proposed.filter((f) => f?.signalId === signal.signalId);
      const anchored = matches.length === 1 ? anchoredForm(matches[0], signal) : null;
      if (anchored && validateRoundupForm(anchored, signal)) forms.push(anchored);
      else excluded.push({ signalId: signal.signalId, reason: 'form-invalid' });
    }
  }
  return { forms, excluded, technicalFailure, modelCalls: calls };
}
