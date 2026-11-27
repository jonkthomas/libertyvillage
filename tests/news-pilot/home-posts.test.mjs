import test from 'node:test';
import assert from 'node:assert/strict';
import { getNewsPosts, getRecentPosts, selectHomePosts, selectNewsPosts } from '../../lib/data.ts';

const now = Date.parse('2026-11-27T12:00:00Z');
const day = 24 * 60 * 60 * 1000;
const post = (slug, category, publishedAt) => ({ slug, category, publishedAt });
const recent = [
  post('latest-guide', 'lifestyle', '2026-11-26'),
  post('food-guide', 'food-drink', '2026-11-25'),
  post('transit-guide', 'transit', '2026-11-24'),
];

test('stale news falls back to recent articles without duplicating editorial cards', () => {
  const news = [post('old-news', 'news', '2026-08-15')];
  const result = selectHomePosts(news, recent, now);
  assert.equal(result.hasFreshNews, false);
  assert.deepEqual(result.latestPosts, recent);
  assert.deepEqual(result.editorialPosts, []);
  assert.equal(result.latestPosts[0].category, 'lifestyle');
  assert.equal(news[0].publishedAt, '2026-08-15');
});

test('fresh news keeps the news collection and separate editorial cards', () => {
  const news = [post('new-news', 'news', '2026-11-26'), post('old-news', 'news', '2026-08-15')];
  const result = selectHomePosts(news, recent, now);
  assert.equal(result.hasFreshNews, true);
  assert.deepEqual(result.latestPosts, news);
  assert.deepEqual(result.editorialPosts, recent.slice(0, 2));
});

test('news is fresh at exactly 30 days and stale immediately after', () => {
  const news = [post('boundary-news', 'news', new Date(now - 30 * day).toISOString())];
  assert.equal(selectHomePosts(news, recent, now).hasFreshNews, true);
  assert.equal(selectHomePosts(news, recent, now + 1).hasFreshNews, false);
});

test('fresh news appearing in recent posts is not repeated in editorial cards', () => {
  const news = [post('new-news', 'news', '2026-11-27')];
  const result = selectHomePosts(news, [news[0], ...recent.slice(0, 2)], now);
  assert.deepEqual(result.editorialPosts, recent.slice(0, 2));
});

test('missing news falls back to articles; empty collections leave no cards', () => {
  assert.deepEqual(selectHomePosts([], recent, now).latestPosts, recent);
  assert.deepEqual(selectHomePosts([], [], now), {
    hasFreshNews: false, latestPosts: [], editorialPosts: [],
  });
});

test('exported collections fall back after news expires without changing the news-only selector', () => {
  const news = getNewsPosts(3);
  const articles = getRecentPosts(3);
  const afterNewsExpires = Math.max(now, ...news.map((item) => Date.parse(item.publishedAt))) + 31 * day;
  const result = selectHomePosts(news, articles, afterNewsExpires);
  assert.equal(result.hasFreshNews, false);
  assert.deepEqual(result.latestPosts, articles);
  assert.ok(news.every((item) => item.category === 'news'));
  assert.deepEqual(selectNewsPosts([...recent, ...news], 3), news);
});
