/**
 * Shared SSRF / public-HTTP URL guard for news-pilot fetches.
 * Single implementation used by evidence drafting and fetchWithRetry.
 *
 * Residual limit (TOCTOU): we resolve DNS then fetch by hostname. A DNS rebind
 * between check and connect can still race. We intentionally do not pin the
 * connect IP via a custom agent — this blocks names that currently resolve to
 * non-public addresses and fails closed on DNS errors/timeouts.
 */

import dns from 'node:dns';

const dnsLookupAll = dns.promises.lookup;

export const URL_GUARD_DEFAULTS = Object.freeze({
  /** Bound DNS so a hung resolver cannot stall a run. */
  dnsTimeoutMs: 2_500,
});

/**
 * @param {string} host
 * @returns {string|null} dotted-quad IPv4 or null
 */
export function ipv4MappedToDotted(host) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h.startsWith('::ffff:')) return null;
  const tail = h.slice('::ffff:'.length);

  // Dotted-quad form: ::ffff:127.0.0.1
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tail)) return tail;

  // Hex form produced by WHATWG URL serialization: ::ffff:7f00:1
  const m = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!m) return null;
  const hi = Number.parseInt(m[1], 16);
  const lo = Number.parseInt(m[2], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi > 0xffff || lo > 0xffff) {
    return null;
  }
  const a = (hi >> 8) & 0xff;
  const b = hi & 0xff;
  const c = (lo >> 8) & 0xff;
  const d = lo & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

/**
 * True when the host string is a private/loopback/link-local/ULA/metadata IP.
 * @param {string} host
 */
export function isPrivateOrLocalIp(host) {
  let h = String(host || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h) return true;

  const mapped = ipv4MappedToDotted(h);
  if (mapped) h = mapped;

  // IPv4 dotted quad.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split('.').map((p) => Number(p));
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this" network
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  // IPv6: loopback, link-local, unique-local, unspecified.
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;
    if (h.startsWith('fe80:')) return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    // Other ::ffff: forms that did not decode above — treat as unusable.
    if (h.startsWith('::ffff:')) return true;
  }

  return false;
}

/**
 * True when host is an IP literal (v4 or v6), not a DNS name.
 * @param {string} host
 */
export function isIpLiteral(host) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return true;
  if (ipv4MappedToDotted(h)) return true;
  // IPv6 contains colons; DNS names do not.
  if (h.includes(':')) return true;
  return false;
}

/**
 * Reject URLs that must never be fetched (lexical / parser checks only).
 * Fast pre-filter — pair with assertSafePublicHttpUrl for DNS-resolved checks.
 * @param {string} url
 */
export function isUnusableUrl(url) {
  const u = String(url || '').trim();
  if (!u || u === '#' || /^javascript:/i.test(u) || /^data:/i.test(u) || /^file:/i.test(u)) {
    return true;
  }
  if (/google\.com\/goto/i.test(u)) return true;
  if (!/^https?:\/\//i.test(u)) return true;

  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return true;
  }

  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return true;

  const host = String(parsed.hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!host) return true;

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === 'metadata.google.internal' || host === 'metadata') return true;

  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isPrivateOrLocalIp(bare)) return true;

  return false;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} code
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs, code = 'dns_timeout') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(code);
      err.code = code;
      reject(err);
    }, Math.max(1, Number(timeoutMs) || URL_GUARD_DEFAULTS.dnsTimeoutMs));
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Resolve hostname to all addresses. Injectable for offline tests.
 * @param {string} hostname bare hostname (no brackets)
 * @param {object} [opts]
 * @param {(hostname: string, options: object) => Promise<object[]|object>} [opts.lookup]
 * @param {number} [opts.dnsTimeoutMs]
 * @returns {Promise<{address: string, family?: number}[]>}
 */
export async function resolveHostnameAddresses(hostname, opts = {}) {
  const lookup = opts.lookup || dnsLookupAll;
  const dnsTimeoutMs = opts.dnsTimeoutMs ?? URL_GUARD_DEFAULTS.dnsTimeoutMs;
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!host) {
    const err = new Error('empty_hostname');
    err.code = 'empty_hostname';
    throw err;
  }

  const result = await withTimeout(
    Promise.resolve().then(() => lookup(host, { all: true, verbatim: true })),
    dnsTimeoutMs,
  );

  if (Array.isArray(result)) {
    return result
      .map((row) =>
        typeof row === 'string'
          ? { address: row }
          : { address: String(row?.address || ''), family: row?.family },
      )
      .filter((row) => row.address);
  }
  if (result && typeof result === 'object' && result.address) {
    return [{ address: String(result.address), family: result.family }];
  }
  return [];
}

/**
 * Full public-HTTP safety check: lexical pre-filter + DNS resolution.
 * Fail-closed: DNS errors/timeouts/empty results block the URL.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {(hostname: string, options: object) => Promise<object[]|object>} [opts.lookup]
 * @param {number} [opts.dnsTimeoutMs]
 * @returns {Promise<boolean>} true when the URL must be blocked
 */
export async function isBlockedPublicHttpUrl(url, opts = {}) {
  if (isUnusableUrl(url)) return true;

  let hostname;
  try {
    hostname = new URL(String(url || '')).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return true;
  }
  const bare = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (!bare) return true;

  // IP literals are fully covered by the lexical private-IP checks.
  if (isIpLiteral(bare)) {
    return isPrivateOrLocalIp(bare);
  }

  try {
    const addrs = await resolveHostnameAddresses(bare, opts);
    if (!addrs.length) return true;
    for (const row of addrs) {
      if (isPrivateOrLocalIp(row.address)) return true;
    }
    return false;
  } catch {
    // Fail closed on resolution failure or timeout.
    return true;
  }
}

/**
 * Throw unusable_url when the candidate is not safe for public HTTP fetch.
 * @param {string} candidateUrl
 * @param {object} [opts]
 */
export async function assertSafePublicHttpUrl(candidateUrl, opts = {}) {
  if (await isBlockedPublicHttpUrl(candidateUrl, opts)) {
    const err = new Error('unusable_url');
    err.code = 'unusable_url';
    throw err;
  }
  return true;
}
