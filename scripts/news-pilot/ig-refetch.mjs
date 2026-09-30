#!/usr/bin/env node
/**
 * Source-only submit helper (spec §4.4 "Submit re-fetch", N1).
 *
 * The runner calls this through deps.source(...) under sourceEnv('weekly-roundup')
 * immediately before `content submit`:
 *
 *   node scripts/news-pilot/ig-refetch.mjs --pack <attemptDir>/pack.json --out <attemptDir>/ig-refetch.json
 *
 * It asks the provider for EXACTLY the pack's Instagram shortcodes and writes
 * {fetchedAt, provider, rows:[{shortcode, ownerUsername, timestamp, caption, status}]}
 * with mode 0600. `content submit` validates that file deterministically and never
 * holds APIFY_API_TOKEN. On any provider failure no file is written and the exit
 * code is non-zero; submit then refuses only the Instagram units.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createIgProvider, IgProviderError } from './ig-provider.mjs';

const MAX_PACK_BYTES = 25 * 1024 * 1024;

export const isInstagramSignal = (signal) => typeof signal?.sourceId === 'string'
  && (signal.sourceId === 'rv2-instagram' || signal.sourceId.startsWith('ig:'));

/** Sorted distinct shortcodes of the pack's Instagram signals (same rule as content submit). */
export function packInstagramShortcodes(pack) {
  const signals = Array.isArray(pack?.signals) ? pack.signals : [];
  return [...new Set(signals.filter(isInstagramSignal).map((s) => s?.post?.shortcode)
    .filter((code) => typeof code === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(code)))].sort();
}

export function parseIgRefetchArgs(argv) {
  const args = { pack: null, out: null, provider: 'apify' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack' || a === '--out' || a === '--provider') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} requires a value`);
      args[a.slice(2)] = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!args.pack || !args.out) throw new Error('ig-refetch requires --pack and --out');
  return args;
}

/**
 * @param {{pack: string, out: string, provider?: string}} args
 * @param {{env?: object, igProvider?: object, clock?: () => number}} [deps]
 */
export async function runIgRefetch(args, { env = process.env, igProvider, clock = Date.now } = {}) {
  const stat = fs.statSync(args.pack);
  if (stat.size > MAX_PACK_BYTES) throw new Error('pack too large');
  const pack = JSON.parse(fs.readFileSync(args.pack, 'utf8'));
  const shortcodes = packInstagramShortcodes(pack);
  const provider = igProvider || createIgProvider({ provider: args.provider || 'apify', token: env.APIFY_API_TOKEN || '' });
  const fetched = shortcodes.length ? await provider.getPosts(shortcodes) : [];
  const fetchedAt = new Date(clock()).toISOString();
  const byCode = new Map((fetched || []).map((row) => [row?.shortcode, row]));
  const rows = shortcodes.map((shortcode) => {
    const row = byCode.get(shortcode);
    const status = ['ok', 'missing', 'private'].includes(row?.status) ? row.status : 'missing';
    return status === 'ok'
      ? { shortcode, ownerUsername: row.ownerUsername ?? null, timestamp: row.timestamp ?? null, caption: row.caption ?? null, status }
      : { shortcode, ownerUsername: null, timestamp: null, caption: null, status };
  });
  const result = { fetchedAt, provider: provider.name || args.provider || 'apify', rows };
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  const tmp = `${args.out}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, args.out);
  return { file: args.out, shortcodes: shortcodes.length, statuses: rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const summary = await runIgRefetch(parseIgRefetchArgs(process.argv.slice(2)));
    console.log(JSON.stringify(summary));
  } catch (error) {
    // Never echo provider payloads or credentials; only a stable code.
    const code = error instanceof IgProviderError ? error.code : 'failed';
    console.error(JSON.stringify({ error: 'ig-refetch-failed', code }));
    process.exitCode = 1;
  }
}
