// Transient candidate patches live on the one scratch record; they are never content.
import { canonicalJson, refreshTitleWords } from '../automation/blog-source-pack.mjs';
import { checkRefreshPreSubmission, RefreshRefused } from './refresh-precheck.mjs';
import { refreshPage } from './refresh-pages.mjs';
import { splitIntro } from './refresh-lint.mjs';

export const CANDIDATE_FIELD = 'refreshCandidates';
export function parseRefreshCandidates({ before, after, slug, dataset = 'posts' }) {
  const original = Array.isArray(before) ? before.find((row) => row?.slug === slug) : null;
  const target = Array.isArray(after) ? after.find((row) => row?.slug === slug) : null;
  const candidates = target?.[CANDIDATE_FIELD];
  if (!original || !Array.isArray(candidates) || candidates.length < 3 || candidates.length > 5) {
    throw new RefreshRefused('refresh-candidate-format', 'Snippet refresh needs 3–5 candidate patches on the target record.');
  }
  const base = { ...target };
  delete base[CANDIDATE_FIELD];
  if (canonicalJson(base) !== canonicalJson(original)) throw new RefreshRefused('refresh-candidate-format', 'Keep the target unchanged outside its candidate list.');
  const page = refreshPage(dataset);
  const allowed = new Set(page.fields.includes('title') ? ['title', 'description', 'intro'] : ['description']);
  return candidates.map((patch, index) => {
    const valid = patch && typeof patch === 'object' && !Array.isArray(patch)
      && Object.keys(patch).every((key) => allowed.has(key) && typeof patch[key] === 'string')
      && typeof patch.description === 'string' && (!allowed.has('title') || typeof patch.title === 'string');
    if (!valid) return { id: index + 1, codes: ['refresh-candidate-fields'] };
    const record = { ...original, ...patch };
    delete record.intro;
    if (page.intro === 'description') record.description = patch.description + splitIntro(original.description).rest;
    else if (Object.hasOwn(patch, 'intro')) record.content = patch.intro + splitIntro(original.content).rest;
    return { id: index + 1, record };
  });
}

// Compare both source headings and the metadata forms used by lib/meta.ts.
// Branding suffixes do not make an otherwise duplicate title unique.
function titleVariants(record, dataset) {
  const title = record.title ?? '';
  if (dataset === 'services') return [record.pluralName, `Best ${record.pluralName} in Liberty Village Toronto (2026)`];
  if (dataset === 'businesses') {
    const name = record.name ?? '';
    const full = `${name} — Reviews, Hours & Location | libertyvillage.co`;
    const suffix = ' — Liberty Village';
    const short = `${name}${suffix}`;
    return [name, full.length <= 60 ? full : short.length <= 60 ? short : `${name.slice(0, 60 - suffix.length - 1).trimEnd()}…${suffix}`];
  }
  if (dataset === 'topics') return [title, title.toLowerCase().includes('liberty village') ? title : `${title} — Liberty Village`];
  if (dataset === 'buildings') return [record.name, (record.metaTitle || `${record.name} — Liberty Village Condos, Reviews & Rent 2026`).slice(0, 60)];
  return [title, record.name];
}

export async function filterRefreshCandidates({ before, after, slug, dataset = 'posts', query = '', live = {}, deps = {}, now }) {
  const parsed = parseRefreshCandidates({ before, after, slug, dataset });
  const original = before.find((row) => row.slug === slug);
  const page = refreshPage(dataset);
  const survivors = [], dropped = [];
  const norm = (text) => String(text ?? '').replace(/\s*\|\s*libertyvillage\.co$/i, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const queryWords = refreshTitleWords(query);
  // The binding tokenizer deliberately ignores broad subjects like restaurants
  // and guide. They are still the main term of an otherwise location-only query.
  if (!queryWords.length) queryWords.push(...norm(query).split(' ').filter((word) => word.length > 2
    && !['liberty', 'village', 'toronto', 'best', 'near', 'the', 'and', 'for', 'with'].includes(word)).map((word) => word.replace(/s$/, '')));
  const mainTerm = [...queryWords].sort((a, b) => b.length - a.length)[0] ?? norm(query);
  for (const candidate of parsed) {
    const codes = [...(candidate.codes ?? [])];
    let checked;
    if (candidate.record) {
      const record = candidate.record;
      const projected = after.map((row) => row?.slug === slug ? record : row);
      checked = await checkRefreshPreSubmission({ item: { dataset, key: slug, op: 'update', payload: record }, before, after: projected,
        ctx: { ...(now ? { now } : {}), refresh: { dataset, mode: 'snippet', original } }, live, deps });
      if (!checked.ok) codes.push(...(checked.findings.length ? checked.findings.map((finding) => finding.rule) : ['refresh-precheck']));
      // Identity-derived metadata on best/directory pages is immutable. Apply
      // title constraints only where the snippet lane actually owns the title.
      if (page.fields.includes('title')) {
        if (!record.title?.trim() || record.title.length > 60) codes.push('refresh-title-length');
        if (mainTerm && !norm(record.title.slice(0, 40)).split(' ').map((word) => word.replace(/s$/, '')).includes(mainTerm)
          && !(` ${norm(record.title.slice(0, 40))} `).includes(` ${norm(mainTerm)} `)) codes.push('refresh-query-late');
        for (const [otherDataset, rows] of Object.entries(live)) {
          if (!['posts', 'topics', 'services', 'businesses', 'buildings', 'neighborhoods'].includes(otherDataset)) continue;
          const titles = titleVariants(record, dataset).filter(Boolean).map(norm);
          if (rows.some((row) => !(otherDataset === dataset && row.slug === slug)
            && titleVariants(row, otherDataset).filter(Boolean).some((title) => titles.includes(norm(title))))) {
            codes.push('refresh-title-duplicate'); break;
          }
        }
      }
      const description = page.intro === 'description' ? splitIntro(record.description).intro : record.description;
      if (description.length < 140 || description.length > 160) codes.push('refresh-description-length');
    }
    const warnings = [...new Set((checked?.warnings ?? []).map((finding) => finding.rule))];
    if (codes.length) dropped.push({ id: candidate.id, codes: [...new Set(codes)], ...(warnings.length ? { warnings } : {}) });
    else survivors.push({ id: candidate.id, record: candidate.record, warnings });
  }
  return { survivors, dropped };
}
