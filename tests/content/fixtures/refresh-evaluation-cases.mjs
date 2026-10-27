const metric = (clicks, impressions = 1000, position = 8) => ({ clicks, impressions, position });
export const baseline = metric(20);
export const siteBefore = metric(200, 10000);
export const cases = [
  { name: 'winner', page: metric(24), siteAfter: siteBefore, verdict: 'won' },
  { name: 'loser', page: metric(16), siteAfter: siteBefore, verdict: 'lost' },
  { name: 'floor', page: metric(1, 199), siteAfter: siteBefore, verdict: 'inconclusive' },
  { name: 'position moved', page: metric(10, 1000, 10.1), siteAfter: siteBefore, verdict: 'inconclusive' },
  { name: 'exactly ten percent is kept', page: metric(18), siteAfter: siteBefore, verdict: 'inconclusive' },
  { name: 'seasonal decline protects page', page: metric(16), siteAfter: metric(140, 10000), verdict: 'won' },
  { name: 'seasonal rise exposes loser', page: metric(20), siteAfter: metric(240, 10000), verdict: 'lost' },
  { name: 'position boundary and floor inclusive', page: metric(2, 200, 10), siteAfter: siteBefore, verdict: 'lost' },
];
