const DAY = 86400000;
const weekMonday = (isoWeek) => {
  const [year, week] = isoWeek.split('-W').map(Number);
  const jan4 = Date.UTC(year, 0, 4);
  return new Date(jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (week - 1) * 7 * DAY).toISOString().slice(0, 10);
};
const nextDay = (day, count = 1) => new Date(Date.parse(day + 'T00:00:00Z') + count * DAY).toISOString().slice(0, 10);
const identityKey = (item) => item?.identityKey || item?.key || item?.occurrenceKey;

/** Live export is the only coverage history used by planning. */
export function roundupCoveredKeys(posts = []) {
  const keys = new Set();
  for (const post of posts || []) {
    if (!post || (!post.roundupCoverage && post.kind !== 'roundup' && !/^liberty-village-news-week-/.test(post.slug || ''))) continue;
    if (post.roundupCoverage?.version === 1 && Array.isArray(post.roundupCoverage.keys)) {
      for (const key of post.roundupCoverage.keys) if (typeof key === 'string') keys.add(key);
    } else {
      for (const url of String(post.content || post.body || '').match(/https:\/\/[^\s)\]>'"]+/g) || []) keys.add('news:' + url);
    }
  }
  return keys;
}

export function roundupCoverageFromPack(pack) {
  const now = pack?.now || pack?.planningCutoff;
  const isoWeek = pack?.isoWeek || isoWeekOf(now).isoWeek;
  const selected = Array.isArray(pack?.units) ? pack.units : pack?.countedItems || pack?.items || [];
  const still = pack?.stillInEffect || [];
  const keys = [...new Set([...selected, ...still].flatMap((item) =>
    Array.isArray(item?.keys) ? item.keys : (item?.constituents || item?.items || [item]).map(identityKey).filter(Boolean)))].sort();
  if (keys.length > 64 || keys.some((key) => key.length > 200)) throw new Error('roundup coverage exceeds key limit');
  return { version: 1, isoWeek, planningCutoff: new Date(now).toISOString(), keys };
}

const rank = (item) => item.locality === 'core' || item.verdict === 'core' ? 0
  : ['road', 'transit'].includes(item.item_type) ? 1
    : ['concert', 'sports', 'expo', 'event', 'class'].includes(item.item_type) ? 2 : 3;
const itemDate = (item) => item.when?.date || '9999-12-31';
const tierRank = { official: 4, primary: 3, reputable: 2, lead: 1 };

/** Count verified items after occurrence, concert and class caps. */
export function planRoundupV2(items, { now, posts = [] } = {}) {
  const at = new Date(now);
  if (!Number.isFinite(at.getTime())) throw new Error('roundup plan requires now');
  const isoWeek = isoWeekOf(at).isoWeek;
  const covered = roundupCoveredKeys(posts);
  const accepted = [], stillInEffect = [], dropped = [];
  const byKey = new Map();
  for (const item of items || []) {
    const key = identityKey(item);
    if (!key) { dropped.push({ item, reason: 'unverifiable' }); continue; }
    if (covered.has(key)) {
      if (item.active !== false && ['road', 'transit', 'project', 'restriction', 'alert'].includes(item.item_type || item.when?.kind)) stillInEffect.push(item);
      dropped.push({ item, reason: 'previously-covered' });
      continue;
    }
    const prior = byKey.get(key);
    if (prior) {
      if (String(prior.subject || '').toLowerCase() !== String(item.subject || '').toLowerCase()) {
        dropped.push({ item, reason: 'duplicate-ambiguous' });
      } else {
        prior.constituents = [...(prior.constituents || [prior]), item];
        prior.evidence = [...(prior.evidence || []), ...(item.evidence || [])]
          .sort((a, b) => (tierRank[b.tier] || 0) - (tierRank[a.tier] || 0));
        prior.citations = [...(prior.citations || []), ...(item.citations || [])];
        if ((tierRank[item.tier] || 0) > (tierRank[prior.tier] || 0)) prior.tier = item.tier;
        dropped.push({ item, reason: 'duplicate' });
      }
      continue;
    }
    byKey.set(key, { ...item, constituents: item.constituents || [item] });
  }
  const byVenueDay = new Map();
  for (const item of byKey.values()) {
    const venue = item.canonicalVenueId;
    const date = itemDate(item);
    if (!venue || !date) { accepted.push(item); continue; }
    const matchKey = venue + ':' + date;
    const peers = byVenueDay.get(matchKey) || [];
    const ambiguous = peers.find((peer) => {
      const a = identityKey(peer).endsWith(':all-day');
      const b = identityKey(item).endsWith(':all-day');
      return a !== b || (identityKey(peer) === identityKey(item) && peer.subject !== item.subject);
    });
    if (ambiguous) {
      const score = (entry) => (tierRank[entry.tier] || 0) * 10 + (identityKey(entry).endsWith(':all-day') ? 0 : 1);
      if (score(item) > score(ambiguous) || score(item) === score(ambiguous) &&
        String(item.publishedAt || item.post?.timestamp || '').localeCompare(String(ambiguous.publishedAt || ambiguous.post?.timestamp || '')) < 0) {
        accepted.splice(accepted.indexOf(ambiguous), 1, item);
        peers.splice(peers.indexOf(ambiguous), 1, item);
        dropped.push({ item: ambiguous, reason: 'duplicate-ambiguous' });
      } else dropped.push({ item, reason: 'duplicate-ambiguous' });
    } else { accepted.push(item); peers.push(item); }
    byVenueDay.set(matchKey, peers);
  }
  accepted.sort((a, b) => rank(a) - rank(b) || itemDate(a).localeCompare(itemDate(b)) || identityKey(a).localeCompare(identityKey(b)));
  const unitList = [], classes = new Set(), concerts = new Map();
  for (const item of accepted) {
    if (item.item_type === 'class') {
      const venue = item.canonicalVenueId;
      if (!venue || classes.has(venue)) { dropped.push({ item, reason: 'class-cap' }); continue; }
      classes.add(venue);
    }
    if (item.item_type === 'concert' && item.venueId) {
      const prior = concerts.get(item.venueId);
      if (prior) {
        prior.constituents.push(...item.constituents);
        prior.citations = [...(prior.citations || []), ...(item.citations || [])];
        prior.evidence = [...(prior.evidence || []), ...(item.evidence || [])];
        dropped.push({ item, reason: 'concert-aggregate' }); continue;
      }
      concerts.set(item.venueId, item);
    }
    unitList.push(item);
  }
  const capped = unitList.slice(0, 12);
  for (const item of unitList.slice(12)) dropped.push({ item, reason: 'cap' });
  const coreUnits = capped.filter((item) => (item.locality || item.verdict) === 'core').length;
  const coreAnchorUnits = capped.filter((item) => (item.locality || item.verdict) === 'core' && item.item_type !== 'class').length;
  const reasons = [];
  if (capped.length < 3) reasons.push('below-minimum');
  if (!coreAnchorUnits) reasons.push('no-core');
  const countedItems = capped.map((item) => {
    const members = item.item_type === 'concert' && item.venueId
      ? [...new Map((item.constituents || [item]).map((member) => [identityKey(member), {
        identityKey: identityKey(member), label: member.subject, date: member.when?.date || member.date,
        startTime: member.when?.startTime || null,
      }])).values()] : item.members || [];
    const aggregateLabel = members.length > 1
      ? `${item.venueName || item.venueId}: ${members.map((member) => `${member.label} (${member.date})`).join('; ')}` : null;
    return { ...item, subject: aggregateLabel || item.subject, what: aggregateLabel || item.what,
      members, keys: [...new Set((item.constituents || [item]).flatMap((member) => member.keys || [identityKey(member)]).filter(Boolean))],
      verdict: item.verdict || item.locality, itemType: item.itemType || item.item_type,
      date: item.date || item.when?.date, citations: item.citations?.length ? item.citations : (item.evidence || []).map((entry) => ({
        url: entry.url, publisher: entry.publisher, sourceId: entry.sourceId, recordId: entry.recordId,
        feed: entry.feed, listing: entry.listing })) };
  });
  return { decision: reasons.length ? 'hold' : 'publish', units: countedItems.length, coreUnits, coreAnchorUnits,
    reasons, stillInEffect, countedItems, excluded: dropped, isoWeek, now: at.toISOString(),
    weekStart: weekMonday(isoWeek), weekEnd: nextDay(weekMonday(isoWeek), 7) };
}

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

