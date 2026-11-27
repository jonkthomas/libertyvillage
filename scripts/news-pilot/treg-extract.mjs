import { assertSafePublicHttpUrl } from './url-guard.mjs';
import { registrableDomain } from './sources.mjs';

// Contract: treg catalog_get treg.web.extract. Its pages are provider-native;
// accept only observed Markdown page responses, never generated summaries.
export function articleMarkdownText(markdown) {
  return String(markdown || '')
    .split('\n')
    .filter((line) => !/^\s*(?:[-*]\s*)?(?:!?\[[^\]]*\]\([^)]*\)|<https?:[^>]+>|Advertisement|Copy link)\s*$/i.test(line))
    .filter((line) => !/^\s*(?:Read more|Related):?\s*\[[^\]]+\]\([^)]*\)\s*$/i.test(line))
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<https?:[^>]+>/g, ' ')
    .trim();
}
export function createTregExtractor({ env = process.env, fetchFn = fetch, dnsLookup } = {}) {
  const configured = Number(env.LV_NEWS_TREG_MAX_CALLS ?? 20);
  const limit = Number.isFinite(configured) ? Math.max(0, Math.min(20, Math.floor(configured))) : 0;
  let calls = 0;
  let costMicro = 0;
  const cache = new Map();
  return {
    get calls() { return calls; },
    get costMicro() { return costMicro; },
    async extract(url) {
      if (!env.TREG_TOKEN) return null;
      if (cache.has(url)) return cache.get(url);
      if (calls >= limit) return null;
      try {
        await assertSafePublicHttpUrl(url, { lookup: dnsLookup });
      } catch { return null; }
      calls += 1;
      // Cache failures too: corroboration can rebuild the same evidence pack.
      cache.set(url, null);
      try {
        const endpoint = new URL('https://treg.to/call/treg.web.extract');
        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers: { 'X-Treg-Token': env.TREG_TOKEN, 'Content-Type': 'application/json',
            'X-Treg-Route-Max-Cost': '0.02' },
          body: JSON.stringify({ url }),
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        });
        costMicro += Math.max(0, Number(response.headers.get('X-Treg-Cost-Micro')) || 0);
        if (!response.ok) return null;
        const data = await response.json();
        const article = data.output?.pages?.find((item) => item.ok !== false && typeof item.markdown === 'string');
        if (!article) return null;
        const finalUrl = article.final_url || url;
        await assertSafePublicHttpUrl(finalUrl, { lookup: dnsLookup });
        // A relay must not silently substitute another publisher's reporting.
        if (registrableDomain(finalUrl) !== registrableDomain(url)) return null;
        const text = articleMarkdownText(article.markdown);
        const result = { ok: true, status: 200, rawText: text,
          articleText: text, finalUrl, extractionProvider: 'treg:web.extract',
          contentType: 'text/plain' };
        cache.set(url, result);
        return result;
      } catch { return null; } // Never serialize relay errors (may echo credentials).
    },
  };
}
