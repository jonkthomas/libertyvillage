import { registrableDomain } from './sources.mjs';

const aggregators = ['msn.com', 'yahoo.com', 'news.google.com', 'newsbreak.com', 'flipboard.com', 'ground.news', 'inkl.com'];
const strongTiers = ['official', 'primary', 'government'];
const syndication = /originally published|first published|appeared originally|republished (?:with permission|from)|this article is from|(?:content|story|article|report)\s+provided by\b|©\s*Toronto Star/i;

export function isAggregatorUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return aggregators.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

// Read canonical-origin hints from the page head and attribution only from the
// extracted article text. Site terms/scripts cannot establish syndication.
export function reportingOrigin(html, url, articleText) {
  const tag = String(html).match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["']/i);
  let originUrl = url;
  try { if (tag) originUrl = new URL(tag[1], url).href; } catch { /* retain fetched URL */ }
  return { originUrl, syndicated: syndication.test(String(articleText || '')) };
}

function shingles(text) {
  const words = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return new Set(words.slice(0, -4).map((_, i) => words.slice(i, i + 5).join(' ')));
}
function nearDuplicate(a, b) {
  const smaller = a.size < b.size ? a : b;
  const larger = a.size < b.size ? b : a;
  return smaller.size > 0 && [...smaller].filter((part) => larger.has(part)).length / smaller.size >= 0.65;
}

// Recompute at every gate rather than trusting a serialized publisher count.
// Independent reporting requires a substantive fetched body, an original
// publisher and distinct text. Different URLs/domains alone prove none of this.
export function independentReporting(sources, { primaryTiers = strongTiers } = {}) {
  const accepted = [];
  const candidates = (sources || []).filter((source) => source?.extractionSubstantive && source.fetchOk !== false)
    .sort((a, b) => Number(primaryTiers.includes(String(b.sourceTier).toLowerCase())) - Number(primaryTiers.includes(String(a.sourceTier).toLowerCase())));
  for (const source of candidates) {
    const url = source.url || source.canonicalUrl;
    const domain = url ? registrableDomain(url) : '';
    const origin = url ? registrableDomain(source.originUrl || source.canonicalUrl || url) : '';
    const tier = String(source.sourceTier || 'lead').toLowerCase();
    const text = source.bodyExcerpt || (source.passages || []).join(' ');
    const parts = shingles(text);
    if (!domain || !origin || domain !== origin || !parts.size || isAggregatorUrl(url) || source.syndicated
      || syndication.test(text) || ['wire', 'social', 'aggregator'].includes(tier)) continue;
    if (accepted.some((entry) => entry.domain === domain || nearDuplicate(entry.parts, parts))) continue;
    accepted.push({ source, domain, parts, primary: primaryTiers.includes(tier) });
  }
  return { publisherCount: accepted.length, hasStrong: accepted.some((entry) => entry.primary), sources: accepted.map((entry) => entry.source) };
}
