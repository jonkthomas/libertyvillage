import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PI_TOOL_ALLOWLIST = Object.freeze(['context_read', 'context_grep', 'context_find', 'submit_candidate']);
export const PI_SDK_VERSION = '0.84.2';
const SECRET_FINGERPRINT = /(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----)/i;

function sdkRoot() {
  if (process.env.PI_SDK_PATH) return process.env.PI_SDK_PATH;
  const globalRoot = execFileSync('npm', ['root', '--global'], { encoding: 'utf8' }).trim();
  return path.join(globalRoot, '@earendil-works/pi-coding-agent');
}

export async function loadPiSdk() {
  let result;
  try {
    result = {
      sdk: await import('@earendil-works/pi-coding-agent'),
      typebox: await import('typebox'),
    };
  } catch {
    const root = sdkRoot();
    result = {
      sdk: await import(pathToFileURL(path.join(root, 'dist/index.js')).href),
      typebox: await import(pathToFileURL(path.join(root, 'node_modules/typebox/build/index.mjs')).href),
    };
  }
  if (result.sdk.VERSION !== PI_SDK_VERSION) throw new Error(`pi SDK version mismatch: expected ${PI_SDK_VERSION}, received ${String(result.sdk.VERSION)}`);
  return result;
}

export function validateSubmittedPost(post, topic, submittedTopicKey, { now = new Date() } = {}) {
  const requiredStrings = ['slug', 'title', 'description', 'content', 'publishedAt', 'updatedAt', 'category', 'answerBlock', 'image', 'author'];
  const requiredArrays = ['tags', 'faqs', 'relatedServices', 'relatedTopics', 'relatedPosts', 'keyTakeaways'];
  const allowedFields = new Set([...requiredStrings, ...requiredArrays]);
  const categories = ['news', 'development', 'food-drink', 'events', 'transit', 'real-estate', 'lifestyle', 'community'];
  const errors = [];
  if (!post || typeof post !== 'object' || Array.isArray(post)) return { ok: false, errors: ['candidate must be an object'] };
  if (SECRET_FINGERPRINT.test(JSON.stringify(post))) errors.push('candidate contains a credential or private-key fingerprint');
  for (const field of Object.keys(post)) if (!allowedFields.has(field)) errors.push(`unknown BlogPost field: ${field}`);
  for (const field of requiredStrings) if (typeof post[field] !== 'string' || !post[field].trim()) errors.push(`${field} is required`);
  for (const field of requiredArrays) if (!Array.isArray(post[field])) errors.push(`${field} must be an array`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug ?? '')) errors.push('slug must be lowercase kebab-case');
  if (!categories.includes(post.category)) errors.push('category is outside the canonical blog enum');
  if (post.author !== 'LibertyVillage.co') errors.push('author must be LibertyVillage.co');
  if (!/^\/[^\s]+$/.test(post.image ?? '')) errors.push('image must be an existing site-root path');
  const runDate = now.toISOString().slice(0, 10);
  if (post.publishedAt !== runDate || post.updatedAt !== runDate) errors.push(`publishedAt/updatedAt must equal the run date ${runDate}`);
  if (!Array.isArray(post.tags) || post.tags.length < 4 || post.tags.length > 6) errors.push('tags must contain 4-6 entries');
  if (!Array.isArray(post.faqs) || post.faqs.length < 4 || post.faqs.length > 5
    || post.faqs.some((faq) => typeof faq?.question !== 'string' || typeof faq?.answer !== 'string')) errors.push('faqs must contain 4-5 question/answer entries');
  if (!Array.isArray(post.keyTakeaways) || post.keyTakeaways.length < 4 || post.keyTakeaways.length > 6) errors.push('keyTakeaways must contain 4-6 entries');
  if (topic?.key && submittedTopicKey !== topic.key) errors.push('submitted topic_key must match the eligible coordinator topic');
  return { ok: errors.length === 0, errors };
}

export function writeCandidateArtifact({ postsFile, post }) {
  const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
  if (!Array.isArray(posts)) throw new Error('canonical posts file must be an array');
  if (posts.some((current) => current?.slug === post.slug)) throw new Error(`candidate slug already exists: ${post.slug}`);
  const temporary = `${postsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify([...posts, post], null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, postsFile);
}

export function buildGeneratorPrompt({ topic, contextFiles = [], now = new Date() } = {}) {
  const runDate = now.toISOString().slice(0, 10);
  return [
    'Generate exactly one grounded Liberty Village blog post for the eligible topic below.',
    `Topic key: ${topic.key}`,
    `Topic title: ${topic.title}`,
    `Topic source: ${topic.source || 'read from the selected entry in data/topic-queue.json'}`,
    `Topic rationale: ${topic.rationale || 'read from the selected entry in data/topic-queue.json'}`,
    `Trusted local context: ${contextFiles.join(', ') || 'data/businesses.json and existing data/posts.json'}`,
    'Read data/topic-queue.json, locate the selected entry by the exact topic key, confirm the source and rationale above match it, and use that entry\'s source and rationale as the grounding for why this topic was selected. Do not substitute a different topic or claim evidence beyond that rationale.',
    'Ground local claims in data/businesses.json and data/posts.json, and follow the canonical blog prompt at scripts/prompts/sections/03-blog-generation.md.',
    'Use context_read, context_grep, and context_find only inside the supplied working tree. Do not invent current facts, prices, hours, addresses, or business claims.',
    'Read data/businesses.json with context_read before naming any venue. Identify a venue ONLY as a markdown directory link whose href is /directory/ plus that record\'s exact slug field. Never write a bare display name: two records are both named Cibo Wine Bar, and naming it in prose attributes both, including cibo-wine-bar which does not contain happy hour.',
    'If the slug or title contains happy hour, pet-friendly, reservations, or accessibility, every linked slug\'s record must contain that same phrase. For a happy-hour topic the only safe Liberty Village slugs are local-public-eatery and cibo-liberty-village. Do not link or name cibo-wine-bar. If you cannot satisfy that, write a neighbourhood guide with zero business names and do not put those policy words in the slug or title.',
    'Write zero clock ranges, zero a.m./p.m. times, zero dollar amounts, zero civic addresses, and zero opening hours anywhere in the post, including keyTakeaways and FAQs. Happy-hour times in proTip are not the hours field the linter checks.',
    `Set publishedAt and updatedAt to the exact UTC run date ${runDate}. Both publishedAt and updatedAt must equal ${runDate}.`,
    'Return the complete post by calling submit_candidate exactly once. Pass the eligible topic key in the tool topic_key parameter.',
    'Follow the trusted BlogPost interface file exactly and select an image path that already exists under public/.',
    'You cannot write files or run commands. The host validates and writes the sole allowed artifact.',
  ].join('\n');
}

function containedPath(cwd, requested = '.') {
  const root = fs.realpathSync(path.resolve(cwd));
  const lexical = path.resolve(root, requested);
  if (lexical !== root && !lexical.startsWith(`${root}${path.sep}`)) throw new Error(`path escapes the constrained context root: ${requested}`);
  const resolved = fs.realpathSync(lexical);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`path escapes the constrained context root: ${requested}`);
  return resolved;
}

function textResult(text) {
  return { content: [{ type: 'text', text }], details: {} };
}

export function createConstrainedTools({ sdk, Type, cwd, onSubmit }) {
  const read = sdk.defineTool({
    name: 'context_read', label: 'Read context file', description: 'Read one UTF-8 file inside the constrained working tree.',
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, params) => {
      try {
        const file = containedPath(cwd, params.path);
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > 1_000_000) throw new Error('file must be a regular file no larger than 1 MB');
        return textResult(fs.readFileSync(file, 'utf8'));
      } catch (error) { return textResult(`Rejected: ${error.message}`); }
    },
  });
  const grep = sdk.defineTool({
    name: 'context_grep', label: 'Search context', description: 'Search UTF-8 context files inside the constrained working tree.',
    parameters: Type.Object({ pattern: Type.String(), path: Type.String() }),
    execute: async (_id, params) => {
      try {
        const target = containedPath(cwd, params.path);
        const output = execFileSync('grep', ['-rInE', '--', params.pattern, target], { encoding: 'utf8', maxBuffer: 1_000_000, timeout: 5_000 });
        return textResult(output.slice(0, 100_000));
      } catch (error) {
        if (error?.status === 1) return textResult('No matches.');
        return textResult(`Rejected: ${error.message}`);
      }
    },
  });
  const find = sdk.defineTool({
    name: 'context_find', label: 'List context files', description: 'List files under a directory inside the constrained working tree.',
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, params) => {
      try {
        const target = containedPath(cwd, params.path);
        const output = execFileSync('find', [target, '-type', 'f'], { encoding: 'utf8', maxBuffer: 1_000_000, timeout: 5_000 });
        return textResult(output.split('\n').slice(0, 1000).join('\n'));
      } catch (error) { return textResult(`Rejected: ${error.message}`); }
    },
  });
  const submit = sdk.defineTool({
    name: 'submit_candidate', label: 'Submit candidate', description: 'Submit the one complete blog post as JSON for host validation.',
    parameters: Type.Object({ topic_key: Type.String(), post_json: Type.String() }),
    execute: onSubmit,
  });
  return [read, grep, find, submit];
}

export function piSessionOptions({ cwd, agentDir, model, modelRuntime, resourceLoader, settingsManager, sessionManager, customTools }) {
  return {
    cwd, agentDir, model, modelRuntime, thinkingLevel: 'off', resourceLoader,
    tools: [...PI_TOOL_ALLOWLIST], customTools, settingsManager, sessionManager,
  };
}

export function createPersistentSessionManager({ sdk, cwd, sessionsDir }) {
  if (!path.isAbsolute(sessionsDir)) throw new Error(`pi sessions directory must be absolute: ${sessionsDir}`);
  const expectedDir = path.resolve(sessionsDir);
  const sessionManager = sdk.SessionManager.create(cwd, expectedDir);
  if (path.resolve(sessionManager.getSessionDir()) !== expectedDir) {
    throw new Error(`pi SDK refused the supervisor sessions directory: ${sessionManager.getSessionDir()}`);
  }
  return sessionManager;
}

export function sessionFileForReport(session, sessionsDir) {
  const sessionFile = session.sessionFile && path.resolve(session.sessionFile);
  const expectedDir = path.resolve(sessionsDir);
  if (!sessionFile || path.dirname(sessionFile) !== expectedDir) {
    throw new Error(`pi session file escaped the supervisor sessions directory: ${sessionFile || 'missing'}`);
  }
  return sessionFile;
}

function constrainedResourceLoader(sdk) {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => 'You are a constrained blog content generator. Use only context_read, context_grep, context_find, and submit_candidate.',
    getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => {}, reload: async () => {},
  };
}

export async function smokePiSession({ cwd, agentDir }) {
  const { sdk, typebox } = await loadPiSdk();
  const tools = createConstrainedTools({ sdk, Type: typebox.Type, cwd, onSubmit: async () => textResult('offline stub accepted') });
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json'),
  });
  modelRuntime.registerProvider('openai', { baseUrl: 'http://127.0.0.1:9/v1' });
  await modelRuntime.setRuntimeApiKey('openai', 'offline-smoke-placeholder');
  const model = modelRuntime.getModel('openai', 'gpt-5.6-sol');
  if (!model) throw new Error('offline pi stub model could not be resolved');
  const { session } = await sdk.createAgentSession(piSessionOptions({
    cwd, agentDir, model, modelRuntime, resourceLoader: constrainedResourceLoader(sdk), customTools: tools,
    settingsManager: sdk.SettingsManager.inMemory(), sessionManager: sdk.SessionManager.inMemory(cwd),
  }));
  try {
    const active = session.getActiveToolNames();
    if (JSON.stringify(active) !== JSON.stringify(PI_TOOL_ALLOWLIST)) throw new Error(`pi active tool drift: ${active.join(',')}`);
    if (!session.getToolDefinition('submit_candidate')) throw new Error('pi submit_candidate tool is not registered');
    return { active };
  } finally { session.dispose(); }
}

export async function generateWithPi({ cwd, agentDir, sessionsDir, topic, contextFiles, provider, modelId, baseUrl }) {
  const hiddenCredentials = new Map();
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) {
    if (process.env[name] !== undefined) hiddenCredentials.set(name, process.env[name]);
    delete process.env[name];
  }
  try {
  const { sdk, typebox } = await loadPiSdk();
  const { Type } = typebox;
  let submitted = null;
  const constrainedTools = createConstrainedTools({ sdk, Type, cwd, onSubmit: async (_id, params) => {
      if (submitted) return { content: [{ type: 'text', text: 'Rejected: a candidate was already submitted.' }], details: {} };
      try {
        const candidate = JSON.parse(params.post_json);
        const checked = validateSubmittedPost(candidate, topic, params.topic_key);
        if (!checked.ok) return { content: [{ type: 'text', text: `Rejected: ${checked.errors.join('; ')}` }], details: {} };
        submitted = candidate;
        return { content: [{ type: 'text', text: 'Accepted. End the session.' }], details: {} };
      } catch (error) {
        return { content: [{ type: 'text', text: `Rejected: invalid JSON (${error.message})` }], details: {} };
      }
    } });
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json'),
  });
  modelRuntime.registerProvider(provider, { baseUrl });
  await modelRuntime.setRuntimeApiKey(provider, process.env.PI_API_KEY || 'implicit');
  const model = modelRuntime.getModel(provider, modelId);
  if (!model) throw new Error(`pi model is unavailable: ${provider}/${modelId}`);
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } });
  const resourceLoader = constrainedResourceLoader(sdk);
  const { session } = await sdk.createAgentSession(piSessionOptions({
    cwd, agentDir, model, modelRuntime, resourceLoader, customTools: constrainedTools, settingsManager,
    sessionManager: createPersistentSessionManager({ sdk, cwd, sessionsDir }),
  }));
  try {
    await session.prompt(buildGeneratorPrompt({ topic, contextFiles }));
    if (!submitted) throw new Error('pi session ended without submit_candidate');
    return { post: submitted, sessionFile: sessionFileForReport(session, sessionsDir) };
  } finally {
    session.dispose();
  }
  } finally {
    for (const [name, value] of hiddenCredentials) process.env[name] = value;
  }
}
