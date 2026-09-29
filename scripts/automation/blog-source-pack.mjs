// Bounded first-party evidence for one directory-backed blog intent. No I/O.
import { extractReferencedBusinesses, operationalPremisesIn, recordSupportsPremise } from '../lib/referenced-businesses.mjs';
import { lintPost } from '../blog-lint.mjs';

export const SOURCE_PACK_SCHEMA = Object.freeze({
  schemaVersion: 'cq-blog-source-pack/v1',
  fields: Object.freeze({
    schemaVersion: 'string', topic: 'string', fingerprint: 'string', generatedAt: 'ISO-8601 string', reserve: 'boolean',
    sources: '[{kind:"business",id:string,name:string,provenance:{dataset:"businesses",recordSlug:string,capturedAt:string},claims:[{claim:string,field:string,verbatim:string}],premiseClaims:[{claim:string,field:string,verbatim:string}]}]',
    internal: '{directorySlugs:string[],postSlugs:string[],serviceSlugs:string[],topicSlugs:string[],images:string[]}',
    external: '[]',
  }),
  maxSources: 12,
  maxVerbatimCharacters: 1500,
  maxSerializedCharacters: 64000,
});

const FACT_FIELDS = ['address', 'description', 'hours', 'phone', 'website', 'proTip', 'answerBlock', 'tags'];
const NOISE = new Set(['liberty', 'village', 'toronto', 'best', 'guide', 'near', 'the', 'and', 'for', 'with', 'in', 'to', 'a', 'of', 'restaurants', 'restaurant']);
const array = (value) => Array.isArray(value) ? value : [];
const slugs = (items) => [...new Set(array(items).map((item) => typeof item === 'string' ? item : item?.slug).filter((item) => typeof item === 'string' && item))].sort();
const tokens = (value) => [...new Set(String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length > 2 && !NOISE.has(word)).map((word) => word.replace(/s$/, '')))];
const fingerprint = (topic) => `topic:${String(topic).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const isIso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fieldSpan = (record, field) => {
  const value = record?.[field];
  const text = field === 'tags' && Array.isArray(value) ? JSON.stringify(value) : typeof value === 'string' ? value.trim() : '';
  return text.slice(0, SOURCE_PACK_SCHEMA.maxVerbatimCharacters);
};
const claimRows = (record) => FACT_FIELDS.map((field) => ({ claim: field, field, verbatim: fieldSpan(record, field) })).filter((claim) => claim.verbatim);
const premiseRows = (record, premises) => premises.map((premise) => {
  const field = FACT_FIELDS.find((candidate) => premise.support.test(fieldSpan(record, candidate)));
  return field ? { claim: premise.label, field, verbatim: fieldSpan(record, field) } : null;
}).filter(Boolean);

export function canonicalJson(value) {
  const ordered = (part) => Array.isArray(part) ? part.map(ordered) : part && typeof part === 'object'
    ? Object.fromEntries(Object.keys(part).sort().map((key) => [key, ordered(part[key])])) : part;
  return JSON.stringify(ordered(value));
}

export function buildSourcePack({ topic, businesses, posts = [], services = [], topics = [], images = [], now = new Date(), reserve = false }) {
  if (typeof topic !== 'string' || !topic.trim() || fingerprint(topic) === 'topic:' || !Array.isArray(businesses)) return { ok: false, reason: 'missing-topic-or-businesses' };
  if (array(posts).some((post) => fingerprint(post?.title ?? '') === fingerprint(topic) || fingerprint(post?.slug ?? '') === fingerprint(topic))) return { ok: false, reason: 'duplicate-topic' };
  const premises = operationalPremisesIn(topic);
  const words = tokens(topic);
  const selectedSlugs = new Set();
  const candidates = businesses.filter((record) => record && typeof record.slug === 'string' && typeof record.name === 'string')
    .filter((record) => premises.every((premise) => recordSupportsPremise(record, premise)) && premiseRows(record, premises).length === premises.length)
    .map((record) => {
      const haystack = tokens([record.name, record.category, record.subcategory, ...array(record.tags), record.description].join(' '));
      const score = premises.length ? premises.length + words.filter((word) => haystack.includes(word)).length : words.filter((word) => haystack.includes(word)).length;
      return { record, score };
    }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.record.slug.localeCompare(b.record.slug))
    .filter(({ record }) => {
      if (selectedSlugs.has(record.slug)) return false;
      selectedSlugs.add(record.slug);
      return true;
    })
    .slice(0, SOURCE_PACK_SCHEMA.maxSources);
  const capturedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const sources = candidates.map(({ record }) => ({
    kind: 'business', id: record.slug, name: record.name,
    provenance: { dataset: 'businesses', recordSlug: record.slug, capturedAt },
    claims: claimRows(record), premiseClaims: premiseRows(record, premises),
  }));
  const factCount = sources.reduce((total, source) => total + source.claims.length, 0);
  if (sources.length < (reserve ? 3 : 2) || (reserve && factCount < 6)) {
    return { ok: false, reason: premises.length ? 'unsupported-operational-premise' : 'insufficient-directory-evidence', premise: premises.map((item) => item.label), supportingRecords: sources.length, factCount };
  }
  const pack = {
    schemaVersion: SOURCE_PACK_SCHEMA.schemaVersion, topic: topic.trim(), fingerprint: fingerprint(topic), generatedAt: capturedAt, reserve: Boolean(reserve),
    sources,
    internal: { directorySlugs: slugs(sources.map((source) => source.id)), postSlugs: slugs(posts), serviceSlugs: slugs(services), topicSlugs: slugs(topics), images: [...new Set(array(images).filter((item) => typeof item === 'string'))].sort() },
    external: [],
  };
  if (canonicalJson(pack).length > SOURCE_PACK_SCHEMA.maxSerializedCharacters) return { ok: false, reason: 'source-pack-size-limit' };
  return { ok: true, pack };
}

// Recheck copied source spans against the current exported records; a pack is evidence,
// never authority to amend the records. Returns explicit failures for trusted wiring.
export function verifySourcePack(pack, { businesses, posts = [], services = [], topics = [] } = {}) {
  const errors = [];
  if (!pack || pack.schemaVersion !== SOURCE_PACK_SCHEMA.schemaVersion || typeof pack.topic !== 'string' || pack.fingerprint !== fingerprint(pack.topic) || !isIso(pack.generatedAt) || typeof pack.reserve !== 'boolean') errors.push('invalid-pack-header');
  if (!Array.isArray(businesses)) errors.push('missing-businesses');
  if (!Array.isArray(pack?.sources) || pack.sources.length < (pack?.reserve ? 3 : 2) || pack.sources.length > SOURCE_PACK_SCHEMA.maxSources) errors.push('invalid-source-count');
  if (!pack?.internal || !Array.isArray(pack.internal.directorySlugs) || !Array.isArray(pack.internal.postSlugs) || !Array.isArray(pack.internal.serviceSlugs) || !Array.isArray(pack.internal.topicSlugs) || !Array.isArray(pack.internal.images) || !Array.isArray(pack.external) || pack.external.length) errors.push('invalid-source-inventory');
  const same = (a, b) => canonicalJson(a) === canonicalJson(b);
  const bySlug = new Map(array(businesses).map((record) => [record?.slug, record]));
  const seen = new Set();
  for (const source of array(pack?.sources)) {
    const record = bySlug.get(source?.id);
    if (!record || seen.has(source.id) || source.kind !== 'business' || source.name !== record.name || source.provenance?.dataset !== 'businesses' || source.provenance?.recordSlug !== source.id || source.provenance?.capturedAt !== pack.generatedAt) { errors.push(`invalid-source:${source?.id ?? 'unknown'}`); continue; }
    seen.add(source.id);
    if (!same(source.claims, claimRows(record))) errors.push(`invalid-claims:${source.id}`);
    if (!same(source.premiseClaims, premiseRows(record, operationalPremisesIn(pack?.topic)))) errors.push(`invalid-premise-claims:${source.id}`);
  }
  if (!same(pack?.internal?.directorySlugs, [...seen].sort()) || !same(pack?.internal?.postSlugs, slugs(posts)) || !same(pack?.internal?.serviceSlugs, slugs(services)) || !same(pack?.internal?.topicSlugs, slugs(topics))) errors.push('stale-internal-inventory');
  if (array(pack?.internal?.images).some((image) => !image.startsWith('/images/blog/') || !image.endsWith('.jpg'))) errors.push('invalid-image-inventory');
  for (const premise of operationalPremisesIn(pack?.topic)) if (!array(pack?.sources).every((source) => recordSupportsPremise(bySlug.get(source.id), premise))) errors.push(`unsupported-premise:${premise.id}`);
  if (pack?.reserve && array(pack?.sources).reduce((total, source) => total + array(source.claims).length, 0) < 6) errors.push('reserve-fact-floor');
  if (pack && canonicalJson(pack).length > SOURCE_PACK_SCHEMA.maxSerializedCharacters) errors.push('source-pack-size-limit');
  return { ok: errors.length === 0, errors };
}

export function checkDraftAgainstPack(post, pack, { businesses, posts = [], services = [], topics = [], imagePaths = [], now } = {}) {
  const errors = [...verifySourcePack(pack, { businesses, posts, services, topics }).errors];
  if (!post || typeof post !== 'object') return { ok: false, errors: [...errors, 'missing-draft'] };
  const packed = new Set(array(pack?.sources).map((source) => source.id));
  const referenced = extractReferencedBusinesses(post, businesses);
  if (!referenced.length) errors.push('no-attributed-business');
  for (const record of referenced) if (!packed.has(record.slug)) errors.push(`business-outside-pack:${record.slug}`);
  const allText = `${post.title ?? ''} ${post.slug ?? ''}`.toLowerCase();
  const topicWords = tokens(pack?.topic);
  if (topicWords.length && topicWords.filter((word) => allText.includes(word)).length < Math.ceil(topicWords.length / 2)) errors.push('draft-changed-topic');
  for (const premise of operationalPremisesIn(pack?.topic)) if (!premise.core.test(allText)) errors.push(`draft-dropped-premise:${premise.id}`);
  for (const [field, allowed] of [['relatedPosts', pack?.internal?.postSlugs], ['relatedServices', pack?.internal?.serviceSlugs], ['relatedTopics', pack?.internal?.topicSlugs], ['relatedBusinesses', pack?.internal?.directorySlugs]]) {
    for (const slug of array(post[field])) if (!array(allowed).includes(slug)) errors.push(`invalid-${field}:${slug}`);
  }
  for (const match of String(post.content ?? '').matchAll(/\]\((\/(?:blog|guide|best|directory)\/[^)]+)\)/g)) {
    const [kind, slug] = match[1].slice(1).split('/');
    const allowed = kind === 'directory' ? pack?.internal?.directorySlugs : kind === 'blog' ? pack?.internal?.postSlugs : kind === 'best' ? pack?.internal?.serviceSlugs : pack?.internal?.topicSlugs;
    if (!array(allowed).includes(slug)) errors.push(`invalid-internal-link:${match[1]}`);
  }
  if (typeof post.image !== 'string' || !/^\/images\/blog\/[a-z0-9-]+\.jpg$/.test(post.image) || !imagePaths.includes(post.image)) errors.push('missing-or-invalid-hero-image');
  const lint = lintPost(post, { businesses, now });
  for (const finding of lint.findings.filter((finding) => ['high', 'critical'].includes(finding.severity))) errors.push(`blog-lint:${finding.rule}:${finding.claim}`);
  return { ok: errors.length === 0, errors };
}
