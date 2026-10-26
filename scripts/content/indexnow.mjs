// Public ownership key, also served verbatim from public/<key>.txt.
export const INDEXNOW_KEY = '0f21be7a52664dbaae2fa2c782608b18';
export const INDEXNOW_RUN_CAP = 20;
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

// Always opt in, including on production. Local/preview remain inert by default.
export async function pingIndexNow({ urls, env = process.env, fetchImpl = globalThis.fetch,
  budget = { remaining: INDEXNOW_RUN_CAP }, log = console.info } = {}) {
  if (env.INDEXNOW_ENABLED !== '1') return { skipped: 'disabled' };
  try {
    const site = new URL(env.CONTENT_SITE_URL);
    const urlList = [...new Set(urls)].filter((url) => new URL(url).origin === site.origin).slice(0, budget.remaining);
    if (!urlList.length) return { skipped: 'empty-or-capped' };
    budget.remaining -= urlList.length;
    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ host: site.host, key: INDEXNOW_KEY, keyLocation: `${site.origin}/${INDEXNOW_KEY}.txt`, urlList }),
    });
    log(`IndexNow: HTTP ${response.status}; ${urlList.length} URL(s)`);
    return { status: response.status, count: urlList.length };
  } catch {
    log('IndexNow: request failed; deploy remains successful');
    return { failed: true };
  }
}
