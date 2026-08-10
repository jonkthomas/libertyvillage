/**
 * Model credential resolution + grounded draft generation.
 * Secrets only from process.env (optionally hydrated from vault file).
 * Never logs or persists key values.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseVaultEnvText } from './fetch.mjs';

/**
 * Vault path comes only from env or an explicit --vault flag.
 * No hardcoded personal filesystem path fallback.
 */
export const DEFAULT_VAULT = process.env.PI_TOOL_VAULT_PATH || null;

const KIMI_CODE_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const KIMI_OAUTH_HOST = 'https://auth.kimi.com';
const KIMI_PI_AUTH_PATH = path.join(os.homedir(), '.pi', 'agent', 'auth.json');
const KIMI_CLI_CRED_PATH = path.join(
  os.homedir(),
  '.kimi',
  'credentials',
  'kimi-code.json',
);

/**
 * Ordered preference for drafting credentials.
 *
 * Anthropic is first because the failure mode that matters here is fabricating a
 * quote, number or closure about a real local business, and faithfulness to the
 * evidence pack outweighs cost at roughly 1-3 published stories per week. The
 * remaining providers are fallbacks so a single provider outage or quota
 * exhaustion degrades the run rather than failing it.
 */
export const MODEL_PROVIDERS = Object.freeze([
  {
    id: 'anthropic',
    envVars: ['ANTHROPIC_API_KEY'],
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-6',
    headers: {
      'x-api-key': null, // filled from the resolved credential at call time
      'anthropic-version': '2023-06-01',
    },
  },
  {
    id: 'kimi-coder',
    envVars: ['KIMI_CODER_API_KEY', 'KIMI_API_KEY'],
    api: 'anthropic-messages',
    baseUrl: 'https://api.kimi.com/coding/v1/messages',
    model: 'k3',
    headers: {
      'User-Agent': 'KimiCLI/1.5',
      'anthropic-version': '2023-06-01',
    },
  },
  {
    id: 'byteplus-ark',
    envVars: ['BYTEPLUS_API_KEY'],
    api: 'openai-completions',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3/chat/completions',
    model: 'glm-5.2',
    headers: {},
  },
  {
    id: 'deepseek',
    envVars: ['DEEPSEEK_API_KEY'],
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    headers: {},
  },
  {
    id: 'openai',
    envVars: ['OPENAI_API_KEY'],
    api: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    headers: {},
  },
  {
    id: 'google-gemini',
    envVars: ['GOOGLE_API_KEY'],
    api: 'google-generate-content',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    model: 'gemini-2.0-flash',
    headers: {},
  },
  {
    id: 'venice',
    envVars: ['VENICE_API_KEY'],
    api: 'openai-completions',
    baseUrl: 'https://api.venice.ai/api/v1/chat/completions',
    model: 'llama-3.3-70b',
    headers: {},
  },
]);

/**
 * Hydrate process.env from vault for known model keys only (in-memory).
 * Does not print values. Does not overwrite non-empty env.
 * @param {string} [vaultPath]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function hydrateModelEnvFromVault(vaultPath = DEFAULT_VAULT, env = process.env) {
  const wanted = new Set(MODEL_PROVIDERS.flatMap((p) => p.envVars));
  /** @type {string[]} */
  const loaded = [];
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { loaded, vaultPath, vaultPresent: false };
  }
  let parsed = {};
  try {
    parsed = parseVaultEnvText(fs.readFileSync(vaultPath, 'utf8'));
  } catch {
    return { loaded, vaultPath, vaultPresent: true, vaultReadable: false };
  }
  for (const key of wanted) {
    if (env[key] && String(env[key]).trim()) continue;
    if (parsed[key] && String(parsed[key]).trim()) {
      env[key] = parsed[key];
      loaded.push(key);
    }
  }
  return { loaded, vaultPath, vaultPresent: true, vaultReadable: true };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function listAvailableModelCredentials(env = process.env) {
  return MODEL_PROVIDERS.map((p) => {
    const presentVar = p.envVars.find((k) => env[k] && String(env[k]).trim());
    return {
      id: p.id,
      model: p.model,
      api: p.api,
      present: Boolean(presentVar),
      envVar: presentVar || p.envVars[0],
    };
  });
}

/**
 * Decode JWT exp without verifying signature (expiry gate only).
 * @param {string} token
 * @returns {number|null} exp seconds, or null
 */
export function jwtExpSeconds(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(payload + pad, 'base64').toString('utf8');
    const data = JSON.parse(json);
    return Number.isFinite(data.exp) ? Number(data.exp) : null;
  } catch {
    return null;
  }
}

function readKimiRefreshToken() {
  try {
    if (fs.existsSync(KIMI_PI_AUTH_PATH)) {
      const auth = JSON.parse(fs.readFileSync(KIMI_PI_AUTH_PATH, 'utf8'));
      const kc = auth['kimi-coder'];
      if (kc?.refresh) return String(kc.refresh);
      if (kc?.access && kc?.expires > Date.now() + 60_000) {
        return { accessOnly: String(kc.access), refresh: kc.refresh || null };
      }
    }
  } catch {
    // ignore
  }
  try {
    if (fs.existsSync(KIMI_CLI_CRED_PATH)) {
      const data = JSON.parse(fs.readFileSync(KIMI_CLI_CRED_PATH, 'utf8'));
      if (data.refresh_token) return String(data.refresh_token);
    }
  } catch {
    // ignore
  }
  return null;
}

function persistKimiToken(token) {
  try {
    let auth = {};
    if (fs.existsSync(KIMI_PI_AUTH_PATH)) {
      auth = JSON.parse(fs.readFileSync(KIMI_PI_AUTH_PATH, 'utf8'));
    }
    auth['kimi-coder'] = {
      type: 'oauth',
      refresh: token.refresh_token,
      access: token.access_token,
      expires: Math.floor(token.expires_at * 1000),
    };
    fs.mkdirSync(path.dirname(KIMI_PI_AUTH_PATH), { recursive: true });
    fs.writeFileSync(KIMI_PI_AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // non-fatal
  }
  try {
    fs.mkdirSync(path.dirname(KIMI_CLI_CRED_PATH), { recursive: true });
    fs.writeFileSync(
      KIMI_CLI_CRED_PATH,
      JSON.stringify({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at,
        scope: token.scope || 'kimi-code',
        token_type: token.token_type || 'Bearer',
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch {
    // non-fatal
  }
}

/**
 * Refresh Kimi coding OAuth access token via auth.kimi.com (device-flow client).
 * Never logs token values.
 * @param {string} refreshToken
 * @param {typeof fetch} [fetchFn]
 */
export async function refreshKimiAccessToken(
  refreshToken,
  fetchFn = globalThis.fetch,
  opts = {},
) {
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs))
    ? Number(opts.timeoutMs)
    : 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${KIMI_OAUTH_HOST}/api/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: KIMI_CODE_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: controller.signal,
    });
    const rawText = await res.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = {};
    }
    if (!res.ok || !data.access_token) {
      const err = new Error(
        data.error_description || data.error || `kimi_refresh_failed_${res.status}`,
      );
      err.code = 'kimi_refresh_failed';
      throw err;
    }
    const expiresIn = Number(data.expires_in || 900);
    const token = {
      access_token: String(data.access_token),
      refresh_token: data.refresh_token ? String(data.refresh_token) : refreshToken,
      expires_at: Date.now() / 1000 + expiresIn,
      scope: String(data.scope || 'kimi-code'),
      token_type: String(data.token_type || 'Bearer'),
    };
    persistKimiToken(token);
    return token;
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(`kimi_refresh_timeout_after_${timeoutMs}ms`);
      err.code = 'kimi_refresh_timeout';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ensure process.env has a non-expired KIMI_CODER_API_KEY when OAuth refresh is available.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {typeof fetch} [fetchFn]
 */
export async function ensureKimiAccessToken(env = process.env, fetchFn = globalThis.fetch, opts = {}) {
  const current = env.KIMI_CODER_API_KEY || env.KIMI_API_KEY || '';
  const exp = jwtExpSeconds(current);
  const stillValid = current && exp != null && exp > Date.now() / 1000 + 60;
  if (stillValid) {
    return { ok: true, refreshed: false, envVar: env.KIMI_CODER_API_KEY ? 'KIMI_CODER_API_KEY' : 'KIMI_API_KEY' };
  }

  // Prefer valid access already stored by pi auth without refresh when possible.
  try {
    if (fs.existsSync(KIMI_PI_AUTH_PATH)) {
      const auth = JSON.parse(fs.readFileSync(KIMI_PI_AUTH_PATH, 'utf8'));
      const kc = auth['kimi-coder'];
      if (kc?.access && Number(kc.expires) > Date.now() + 60_000) {
        env.KIMI_CODER_API_KEY = String(kc.access);
        return { ok: true, refreshed: false, envVar: 'KIMI_CODER_API_KEY', source: 'pi-auth-access' };
      }
    }
  } catch {
    // continue to refresh
  }

  const refresh = (() => {
    const r = readKimiRefreshToken();
    if (!r) return null;
    if (typeof r === 'string') return r;
    return r.refresh || null;
  })();
  if (!refresh) {
    if (current) {
      return { ok: true, refreshed: false, envVar: 'KIMI_CODER_API_KEY', warning: 'kimi_token_maybe_expired_no_refresh' };
    }
    return { ok: false, error: 'kimi_no_refresh_token' };
  }

  try {
    const token = await refreshKimiAccessToken(refresh, fetchFn, opts);
    env.KIMI_CODER_API_KEY = token.access_token;
    return { ok: true, refreshed: true, envVar: 'KIMI_CODER_API_KEY' };
  } catch (e) {
    return {
      ok: false,
      error: e?.code || 'kimi_refresh_failed',
      message: safeErrorSnippet(String(e?.message || e)),
    };
  }
}

/**
 * Pick the first usable provider.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ prefer?: string|null, fetchFn?: typeof fetch }} [opts]
 */
export async function resolveModelProvider(env = process.env, opts = {}) {
  hydrateModelEnvFromVault(opts.vaultPath ?? DEFAULT_VAULT, env);

  const prefer = opts.prefer || null;
  // Skip Kimi OAuth refresh only when another preferred provider is actually present.
  // If the preferred provider is missing, fallback may still select Kimi — refresh then.
  let available = listAvailableModelCredentials(env);
  const preferredReady = Boolean(
    prefer && available.find((a) => a.id === prefer)?.present,
  );
  const skipKimiRefresh = preferredReady && prefer !== 'kimi-coder';
  if (!skipKimiRefresh) {
    await ensureKimiAccessToken(env, opts.fetchFn || globalThis.fetch, {
      timeoutMs: opts.kimiRefreshTimeoutMs,
    });
    available = listAvailableModelCredentials(env);
  }

  if (prefer) {
    const pref = MODEL_PROVIDERS.find((p) => p.id === prefer);
    const cred = available.find((a) => a.id === prefer);
    if (pref && cred?.present) {
      const key = env[cred.envVar];
      return { ok: true, provider: pref, envVar: cred.envVar, apiKey: key, available };
    }
  }
  for (const p of MODEL_PROVIDERS) {
    const cred = available.find((a) => a.id === p.id);
    if (!cred?.present) continue;
    return {
      ok: true,
      provider: p,
      envVar: cred.envVar,
      apiKey: env[cred.envVar],
      available,
    };
  }
  return {
    ok: false,
    error: 'no_model_credential',
    message:
      'No usable model API credential in process.env (checked KIMI_CODER_API_KEY, BYTEPLUS_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, VENICE_API_KEY).',
    available,
  };
}

/**
 * @param {object} args
 * @param {object} args.evidencePack
 * @param {object[]} args.internalLinkSuggestions
 * @param {object} [args.relatedPost]
 * @param {number} args.nowMs
 * @param {string} [args.siteOrigin]
 */
export function buildDraftPrompt({
  evidencePack,
  internalLinkSuggestions,
  relatedPost = null,
  nowMs,
  siteOrigin = 'https://libertyvillage.co',
}) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const evidenceForModel = {
    clusterId: evidencePack.clusterId,
    title: evidencePack.title,
    coverageRelation: evidencePack.coverageRelation,
    relatedPostSlug: evidencePack.relatedPostSlug,
    sources: (evidencePack.sources || [])
      .filter((s) => s.extractionSubstantive)
      .map((s) => ({
        url: s.canonicalUrl || s.url,
        publisher: s.publisher,
        publisherDomain: s.publisherDomain,
        publishDate: s.publishDate,
        sourceTier: s.sourceTier,
        // bodyExcerpt is truncated source text; include it so details present in the
        // extraction (e.g. named teams) are usable even when not selected into passages[].
        bodyExcerpt: s.bodyExcerpt || '',
        passages: s.passages,
        supports: s.supports,
      })),
    claimSupport: evidencePack.claimSupport || [],
  };

  const system = [
    'You are a careful Liberty Village neighbourhood news editor.',
    'You draft ORIGINAL local news articles grounded STRICTLY in the provided evidence pack.',
    'You may NOT introduce facts, numbers, dates, names, quotes, statistics, or events that are not explicitly present in the evidence pack (passages or bodyExcerpt).',
    'If sources disagree or a fact is uncertain, say so plainly rather than resolving it silently.',
    'NO fabricated quotes. Verbatim quotes must be ≤ 25 words and always attributed to a named source/publisher from the evidence.',
    'Do not copy article phrasing — write original prose with local Liberty Village framing.',
    'Only link to URLs that appear in the evidence pack, plus internal site paths from the allowed internal link list.',
    'Never invent internal slugs.',
    'Output ONLY valid JSON (no markdown fences) matching the schema described by the user.',
  ].join(' ');

  const user = {
    instruction: 'Draft one grounded Liberty Village news article from the evidence pack only.',
    todayIsoDate: today,
    siteOrigin,
    requiredStructure: {
      frontmatterFields: {
        slug: 'kebab-case unique slug ending conceptually as a news post',
        title: 'string',
        description: 'string SEO description',
        content: 'markdown body string',
        publishedAt: `MUST be exactly todayIsoDate (${today}) — the draft run date, NOT the source article date`,
        updatedAt: `MUST be exactly todayIsoDate (${today}) — the draft run date, NOT the source article date`,
        category:
          'one of: news | development | food-drink | events | transit | real-estate | lifestyle | community',
        tags: 'string[]',
        answerBlock: 'answer-first summary: what happened and what it means (2-4 sentences)',
        faqs: '{question, answer}[] (2-4 items, grounded only)',
        keyTakeaways: 'string[] (3-5)',
        relatedServices: 'string[] of allowed service slugs only',
        relatedTopics: 'string[] of allowed topic slugs only',
        relatedPosts: 'string[] of allowed post slugs only',
        author: 'LibertyVillage.co',
        image: 'MUST be null (human supplies image later). Never invent an image path or URL.',
        crossLinks: 'optional {type:"service"|"guide", slug, label?}[]',
        exploreCta: 'optional {label, href, description}',
        canonicalUrl: 'optional; omit for local drafts',
      },
      contentMustInclude: [
        'Answer-first framing near the top (may mirror answerBlock in prose)',
        'A markdown section exactly titled: ## Why this matters in Liberty Village',
        'Inline source attribution with markdown links to primary evidence URLs',
        `Body must state the site publish/update as ${today} (run date)`,
        'Body must also include an "originally reported {source date}" line using evidence publishDate(s), plus current-state framing when timelines advanced (e.g. "as of August 2026, the timeline stands at Fall 2029")',
        'If coverageRelation is follow-up, reference/update the related existing post rather than restating it',
      ],
      alsoReturn: {
        newsArticleStructuredData: `schema.org NewsArticle object; datePublished and dateModified MUST equal todayIsoDate (${today})`,
        citations: '{claim, sourceUrl}[] every factual claim mapped to an evidence URL',
        ungroundedRiskNotes:
          'string[] any place you felt thin on evidence (should be empty if solid). Do not claim evidence is missing when the fact appears in bodyExcerpt or passages.',
      },
    },
    editorialHardRules: [
      'No fabricated quotes, statistics, names, or events',
      'Verbatim quotes capped at roughly 25 words, always attributed',
      'Original phrasing and original local framing — do not copy source articles',
      'Where sources disagree or a fact is uncertain, say so',
      'Follow-ups must reference the existing post, not restate it wholesale',
      `Frontmatter publishedAt/updatedAt and NewsArticle datePublished/dateModified MUST be ${today} (run date). Never backdate to the source article date.`,
      'Source reporting dates belong only in the body as originally-reported context.',
      'Set image to null. Never invent /images/... paths.',
      'Facts present in bodyExcerpt count as grounded evidence, not only passages[].',
    ],
    allowedInternalLinks: internalLinkSuggestions,
    relatedExistingPost: relatedPost
      ? {
          slug: relatedPost.slug,
          title: relatedPost.title,
          description: relatedPost.description,
          publishedAt: relatedPost.publishedAt,
          updatedAt: relatedPost.updatedAt,
        }
      : null,
    evidencePack: evidenceForModel,
    outputJsonSchemaHint: {
      post: {
        slug: 'string',
        title: 'string',
        description: 'string',
        content: 'string markdown',
        publishedAt: 'YYYY-MM-DD',
        updatedAt: 'YYYY-MM-DD',
        category: 'news',
        tags: ['string'],
        answerBlock: 'string',
        faqs: [{ question: 'string', answer: 'string' }],
        keyTakeaways: ['string'],
        relatedServices: ['string'],
        relatedTopics: ['string'],
        relatedPosts: ['string'],
        author: 'LibertyVillage.co',
      },
      newsArticleStructuredData: { '@context': 'https://schema.org', '@type': 'NewsArticle' },
      citations: [{ claim: 'string', sourceUrl: 'string' }],
      ungroundedRiskNotes: ['string'],
    },
  };

  return {
    system,
    userText: JSON.stringify(user, null, 2),
  };
}

/**
 * @param {object} args
 * @param {{ provider: object, apiKey: string, envVar: string }} args.resolved
 * @param {string} args.system
 * @param {string} args.userText
 * @param {number} [args.maxTokens]
 * @param {number} [args.timeoutMs]
 * @param {typeof fetch} [args.fetchFn]
 */
export async function generateDraftWithModel({
  resolved,
  system,
  userText,
  maxTokens = 4500,
  timeoutMs = 120_000,
  fetchFn = globalThis.fetch,
}) {
  const { provider, apiKey } = resolved;
  if (provider.api === 'anthropic-messages') {
    return callAnthropicMessages({
      baseUrl: provider.baseUrl,
      apiKey,
      model: provider.model,
      system,
      userText,
      maxTokens,
      timeoutMs,
      headers: provider.headers || {},
      fetchFn,
      providerId: provider.id,
    });
  }
  if (provider.api === 'openai-completions') {
    return callOpenAiCompletions({
      baseUrl: provider.baseUrl,
      apiKey,
      model: provider.model,
      system,
      userText,
      maxTokens,
      timeoutMs,
      headers: provider.headers || {},
      fetchFn,
      providerId: provider.id,
    });
  }
  if (provider.api === 'google-generate-content') {
    return callGoogleGenerateContent({
      baseUrl: provider.baseUrl,
      apiKey,
      model: provider.model,
      system,
      userText,
      maxTokens,
      timeoutMs,
      fetchFn,
      providerId: provider.id,
    });
  }
  return {
    ok: false,
    error: `unsupported_provider_api:${provider.api}`,
    providerId: provider.id,
    model: provider.model,
  };
}

async function callAnthropicMessages({
  baseUrl,
  apiKey,
  model,
  system,
  userText,
  maxTokens,
  timeoutMs,
  headers,
  fetchFn,
  providerId,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Anthropic authenticates with x-api-key; Kimi's Anthropic-shaped endpoint
    // uses bearer auth. Send whichever the provider declares, never both.
    const usesApiKeyHeader =
      headers && Object.prototype.hasOwnProperty.call(headers, 'x-api-key');
    const resolvedHeaders = { ...headers };
    if (usesApiKeyHeader) resolvedHeaders['x-api-key'] = apiKey;

    const res = await fetchFn(baseUrl, {
      method: 'POST',
      headers: {
        ...(usesApiKeyHeader ? {} : { Authorization: `Bearer ${apiKey}` }),
        'Content-Type': 'application/json',
        ...resolvedHeaders,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userText }],
      }),
      signal: controller.signal,
    });
    const rawText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `http_${res.status}`,
        providerId,
        model,
        // never include raw body if it might echo auth; keep short safe snippet
        detail: safeErrorSnippet(rawText),
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { ok: false, error: 'invalid_json_response', providerId, model };
    }
    const text = extractAnthropicText(parsed);
    return {
      ok: true,
      providerId,
      model: parsed.model || model,
      text,
      usage: parsed.usage || null,
      rawStop: parsed.stop_reason || null,
    };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? `timeout_after_${timeoutMs}ms`
        : safeErrorSnippet(String(e?.message || e)),
      providerId,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiCompletions({
  baseUrl,
  apiKey,
  model,
  system,
  userText,
  maxTokens,
  timeoutMs,
  headers,
  fetchFn,
  providerId,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
      }),
      signal: controller.signal,
    });
    const rawText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `http_${res.status}`,
        providerId,
        model,
        detail: safeErrorSnippet(rawText),
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { ok: false, error: 'invalid_json_response', providerId, model };
    }
    const text = parsed.choices?.[0]?.message?.content || '';
    return {
      ok: true,
      providerId,
      model: parsed.model || model,
      text,
      usage: parsed.usage || null,
    };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? `timeout_after_${timeoutMs}ms`
        : safeErrorSnippet(String(e?.message || e)),
      providerId,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callGoogleGenerateContent({
  baseUrl,
  apiKey,
  model,
  system,
  userText,
  maxTokens,
  timeoutMs,
  fetchFn,
  providerId,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${system}\n\n${userText}` }],
          },
        ],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
      }),
      signal: controller.signal,
    });
    const rawText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `http_${res.status}`,
        providerId,
        model,
        detail: safeErrorSnippet(rawText),
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { ok: false, error: 'invalid_json_response', providerId, model };
    }
    const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    return { ok: true, providerId, model, text, usage: parsed.usageMetadata || null };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? `timeout_after_${timeoutMs}ms`
        : safeErrorSnippet(String(e?.message || e)),
      providerId,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractAnthropicText(parsed) {
  const content = parsed?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function safeErrorSnippet(text) {
  return String(text || '')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer <redacted>')
    .replace(/key=[^&\s]+/gi, 'key=<redacted>')
    .slice(0, 240);
}

/**
 * Parse model JSON output; tolerate optional ``` fences.
 * @param {string} text
 */
export function parseModelJson(text) {
  let s = String(text || '').trim();
  if (!s) return { ok: false, error: 'empty_model_text' };
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // If model added preamble, try first { ... last }
  if (!s.startsWith('{')) {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
  }
  try {
    const value = JSON.parse(s);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: 'json_parse_failed', detail: String(e?.message || e) };
  }
}
