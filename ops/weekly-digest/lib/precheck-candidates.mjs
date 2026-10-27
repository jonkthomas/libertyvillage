import { normalizeCode, codesInErrors } from './plain-english.mjs';

const safeCode = (code) => /^(?:refresh-[a-z-]+|blog-lint(?::[a-z-]+)?|unsupported-grounding|business-outside-pack|draft-changed-topic|draft-dropped-premise|exhausted|unrepairable|not-converging|validation|block|unsupported-(?:address|price|hours|date|operational-premise)|invalid-internal-link|invalid-related(?:Posts|Services|Topics|Businesses))$/.test(code);

// One rejection can carry a broad outcome and more useful mechanical subcodes.
// Count each code once per snapshot/submission (or attempt when no id exists).
export function rejectionEvent(ev, job) {
  if (ev?.event === 'refresh-outcome' && ev.state === 'failed') {
    return { id: ev.snapshotId == null ? null : `snapshot:${ev.snapshotId}`,
      codes: [ev.reasonCode, ...(Array.isArray(ev.refusalDetail?.failures) ? ev.refusalDetail.failures : []).map((f) => f?.code)]
        .filter((c) => typeof c === 'string' && safeCode(c)) };
  }
  if (job && !['weekly-blog', 'october-blog-backfill', 'blog', 'seo-improvements', 'refresh'].includes(job)) return null;
  if (['failure', 'submit-refused', 'cadence-attempt-failed', 'gate'].includes(ev?.event)) {
    if (ev.event === 'gate' && ev.exit !== 2) return null;
    const values = [ev.reasonCode, ev.reason, ev.error, ev.message, ev.decision];
    const codes = [...values.filter((v) => typeof v === 'string').map(normalizeCode),
      ...codesInErrors(values)];
    return { id: ev.id == null && ev.submissionId == null ? null : `submission:${ev.id ?? ev.submissionId}`,
      codes: [...new Set(codes.filter(safeCode))] };
  }
  return null;
}

export function precheckCandidates(runs) {
  const codes = new Map();
  for (const run of runs ?? []) {
    for (const [i, row] of (run.rejections ?? []).entries()) {
      const id = `${run.target}:${row.id ?? `${run.file}:${i}`}`;
      for (const code of row.codes) {
        const ids = codes.get(code) ?? new Set();
        ids.add(id);
        codes.set(code, ids);
      }
    }
  }
  return [...codes].map(([code, ids]) => ({ code, count: ids.size, candidatePrecheck: ids.size >= 2 }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export function renderPrecheckDiagnostics(model) {
  // Fixed-vocabulary codes only; tolerate older saved digest models.
  const rows = (model.precheckCandidates ?? []).filter((row) => safeCode(row.code));
  const warnings = (model.runs?.list ?? []).flatMap((r) => r.voiceWarnings ?? []);
  if (!rows.length && !warnings.length) return '';
  const warningCodes = new Set(warnings.flatMap((w) => w.ruleCodes));
  const allowed = ['voice-banned-phrase', 'voice-framing', 'voice-em-dash-density'];
  return `<details><summary>Writer diagnostics</summary><p>Rejections this week (each snapshot or submission counted once per code):</p><ul>${rows.map((r) =>
    `<li>${r.code}: ${r.count}${r.candidatePrecheck ? ' — candidate precheck (check existing coverage first)' : ''}</li>`).join('')}</ul>${warnings.length ?
    `<p>Voice warnings in ${warnings.length} run event(s), warn-only since 2026-10-27: ${allowed.filter((c) => warningCodes.has(c)).join(', ')}. No draft was blocked by these warnings.</p>` : ''}</details>`;
}
