// Public-safe model input. Never spread objects from the private digest.
// Redact before truncating, so a cut cannot expose a partial credential.
export function redact(value, secrets = []) {
  let text = typeof value === 'string' ? value : '';
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED]')
    .replace(/\b(?:GH_TOKEN|GITHUB_TOKEN|[A-Z_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ACCOUNT|API_KEY|DATABASE_URL)[A-Z_]*)\b["']?\s*[=:][^\n]*/gi, '[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[REDACTED]')
    .replace(/\b(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@[^\s)]+/gi, '[REDACTED]')
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[REDACTED]');
}
const short = (s, max = 160) => redact(s).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, max);
const date = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null;
const rows = (v) => Array.isArray(v) ? v.filter((r) => r && typeof r === 'object').slice(0, 200) : [];

export function agentInput(digest) {
  return {
    generatedAt: date(digest?.generatedAt),
    window: { from: date(digest?.window?.from), to: date(digest?.window?.to) },
    failures: rows(digest?.failures).map((r) => ({
      job: short(r.job), timestamp: date(r.timestamp ?? r.startedAt),
      refusalCode: short(r.refusalCode ?? r.code), reason: short(r.reason),
    })),
    queue: {
      held: typeof digest?.queue?.held === 'boolean' ? digest.queue.held : null,
      timers: rows(digest?.queue?.timers).map((t) => ({
        unit: short(t.unit), next: short(t.next), schedule: short(t.schedule),
      })),
    },
    posted: { items: rows(digest?.posted?.items).map((p) => ({
      title: short(p.title), url: publicUrl(p.url),
    })) },
    gsc: digest?.gsc === 'ok' || ['treg', 'vm', 'treg (google-search-console)', 'vm googleapis (runner GSA, read-only)'].includes(digest?.gsc?.source) ? 'ok' : 'unavailable',
  };
}
function publicUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'libertyvillage.co' || url.username || url.password) return '';
    return short(`${url.origin}${url.pathname}`, 300);
  } catch { return ''; }
}
