// Preload for spawned discover-businesses runs: replaces global fetch so no
// test can reach SerpApi or Pexels. Every request URL is appended to FAKE_FETCH_LOG.
import fs from 'node:fs';

const LV = (title, extra = {}) => ({
  title, rating: 4.6, reviews: 120, type: 'Coffee shop',
  address: `${title.length} Liberty St, Toronto, ON M6K 3G3, Canada`,
  gps_coordinates: { latitude: 43.638, longitude: -79.42 }, ...extra,
});

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (process.env.FAKE_FETCH_LOG) fs.appendFileSync(process.env.FAKE_FETCH_LOG, `${url}\n`);
  if (url.startsWith('https://serpapi.com/')) {
    const mode = process.env.FAKE_SERP_MODE || 'results';
    if (mode === 'http-503') return json(503, { error: 'upstream https://serpapi.com/search.json?api_key=test-serp-key' });
    if (mode === 'hang') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
    }
    if (mode === 'none') return json(200, { search_metadata: { status: 'Success' }, error: "Google hasn't returned any results for this query." });
    return json(200, {
      search_metadata: { status: 'Success' },
      local_results: [LV('Scoped Fake Cafe Alpha', { reviews: 900 }), LV('Scoped Fake Cafe Beta', { reviews: 800 }),
        LV('Scoped Fake Cafe Gamma', { reviews: 700 }), LV('Scoped Fake Cafe Delta', { reviews: 600 })],
    });
  }
  if (url.startsWith('https://api.pexels.com/')) {
    if (process.env.FAKE_PEXELS_MODE === 'throw') throw new TypeError('fetch failed https://api.pexels.com secret-pexels-key');
    return json(500, { error: 'pexels down' });
  }
  throw new Error(`unexpected network access in test: ${url.slice(0, 40)}`);
};
