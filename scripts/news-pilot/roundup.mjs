import fs from 'node:fs';
import path from 'node:path';
import { validateRoundupPack } from './roundup-evidence.mjs';

export function isoWeekOf(date) {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) throw new Error('invalid ISO week date');
  const day = (value.getUTCDay() + 6) % 7;
  const start = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - day);
  const year = new Date(start + 3 * 86400000).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const firstMonday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000;
  const week = Math.floor((start - firstMonday) / 604800000) + 1;
  return { isoWeek: year + '-W' + String(week).padStart(2, '0'),
    weekStartUtc: new Date(start).toISOString(), weekEndUtc: new Date(start + 604800000).toISOString() };
}

export function roundupSlug(isoWeek) {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(isoWeek)) throw new Error('invalid ISO week');
  const year = Number(isoWeek.slice(0, 4));
  const jan4 = Date.UTC(year, 0, 4);
  const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000;
  if (isoWeekOf(monday + (Number(isoWeek.slice(6)) - 1) * 604800000).isoWeek !== isoWeek)
    throw new Error('invalid ISO week');
  return 'liberty-village-news-week-' + isoWeek.slice(0, 4) + '-w' + isoWeek.slice(6);
}

export function planRoundup(pack, opts = {}) {
  const isoWeek = opts.isoWeek ?? pack?.isoWeek;
  const nowMs = opts.nowMs ?? Date.parse(pack?.now ?? '');
  if (!Number.isFinite(nowMs)) throw new Error('roundup requires nowMs');
  const week = isoWeekOf(nowMs);
  if (isoWeek !== week.isoWeek || (opts.weekStartUtc && opts.weekStartUtc !== week.weekStartUtc)) throw new Error('roundup week mismatch');
  const checked = validateRoundupPack(pack, { ...opts, nowMs, weekStartUtc: week.weekStartUtc });
  const items = checked.accepted.map((entry) => entry.item);
  const decision = items.length >= 2 ? 'roundup' : items.length === 1 ? 'single-update' : 'missed';
  const slug = roundupSlug(isoWeek);
  return { decision, items, slug, isoWeek, weekStartUtc: week.weekStartUtc, now: new Date(nowMs).toISOString(), census: checked.census,
    ...(decision === 'missed' ? { alert: { kind: 'WEEKLY_NEWS_MISSED', isoWeek, census: checked.census } } : {}) };
}

export function buildRoundupPost(plan, { image, root = process.cwd(), imageExists } = {}) {
  if (!plan || plan.decision === 'missed' || !Array.isArray(plan.items) || !plan.items.length) throw new Error('no eligible roundup items');
  if (typeof image !== 'string' || !/^\/images\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(image) ||
    !(typeof imageExists === 'function' ? imageExists(image) : fs.existsSync(path.join(root, 'public', image.slice(1)))))
    throw new Error('roundup image must be an existing /images/ path');
  const single = plan.items.length === 1;
  const label = single ? 'weekly update' : 'news roundup';
  const title = 'Liberty Village ' + label + ': ' + plan.isoWeek;
  const description = 'Liberty Village ' + label + ' for ' + plan.isoWeek + ': ' + plan.items.map((item) => item.title).join('; ') + '.';
  const content = plan.items.map((item, index) => {
    const sources = item.sources.map((source) => '[' + source.publisher + '](' + source.canonicalUrl + ')').join(', ');
    const claims = item.claims.map((claim) => claim.text + ' [Source](' + claim.sourceUrl + ').').join(' ');
    return '## ' + (index + 1) + '. ' + item.title + '\n\n' + claims + '\n\nSources: ' + sources;
  }).join('\n\n');
  const date = new Date(plan.now).toISOString().slice(0, 10);
  return { slug: plan.slug, title, description, content, publishedAt: date, updatedAt: date, category: 'news',
    tags: ['liberty village', 'news'], answerBlock: description, faqs: [], keyTakeaways: plan.items.map((item) => item.title),
    relatedServices: [], relatedTopics: [], relatedPosts: [], author: 'LibertyVillage.co', image };
}
