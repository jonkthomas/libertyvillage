import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  detectImageType, gitBlobId, MAX_IMAGE_BYTES, MEDIA_PATH_PATTERN, prepareImages, sanitizeMediaName,
} from '../../scripts/content/images.mjs';

const registry = JSON.parse(fs.readFileSync(new URL('./fixtures/registry.json', import.meta.url), 'utf8'));
const JPEG = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]);
const PNG = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);
const WEBP = (tag) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from(tag)]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-images-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(root, 'public/images/neighborhoods'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/images/neighborhoods/parkdale.jpg'), JPEG('parkdale-v1'));
  fs.writeFileSync(path.join(root, 'public/images/neighborhoods/tracked-only.jpg'), JPEG('tracked-only'));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'base');
  // The deploy-hook ref the submit fetched (origin/staging for a staging target).
  git(root, 'update-ref', 'refs/remotes/origin/staging', 'HEAD');
  fs.rmSync(path.join(root, 'public/images/neighborhoods/tracked-only.jpg'));
  return root;
}

function fakeAssets(existing = {}) {
  const lookups = [];
  return {
    lookups,
    resolveAssets: async (list) => list.map(({ sha256: sha }) => { lookups.push(sha); return { sha256: sha, path: existing[sha] ?? null }; }),
    assetExists: async (assetPath) => Object.values(existing).includes(assetPath),
  };
}

const hood = (slug, image) => ({ dataset: 'neighborhoods', key: slug, op: 'update', payload: { slug, name: slug, image, vibe: 'v' } });

test('magic bytes, size and name sanitisation', () => {
  assert.equal(detectImageType(JPEG('x')), 'image/jpeg');
  assert.equal(detectImageType(PNG('x')), 'image/png');
  assert.equal(detectImageType(WEBP('x')), 'image/webp');
  assert.equal(detectImageType(Buffer.from('GIF89a......')), null);
  assert.equal(detectImageType(Buffer.from('RIFF0000WAVE')), null);
  assert.equal(sanitizeMediaName('/images/x/My Photo (1).JPEG', 'image/jpeg'), 'my-photo-1.jpg');
  assert.equal(sanitizeMediaName('__Café_Été.png', 'image/png'), 'caf-_-t.png');
  assert.equal(sanitizeMediaName('....webp', 'image/webp'), 'image.webp');
  assert.match(`/media/${'a'.repeat(16)}/${sanitizeMediaName(`${'x'.repeat(300)}.jpg`, 'image/jpeg')}`, MEDIA_PATH_PATTERN);
});

test('a changed AND a new neighbourhood image become /media assets; unchanged tracked files stay', async () => {
  const root = workspace();
  const changed = JPEG('parkdale-v2');
  const added = PNG('new-hood');
  fs.writeFileSync(path.join(root, 'public/images/neighborhoods/parkdale.jpg'), changed);
  fs.writeFileSync(path.join(root, 'public/images/neighborhoods/New Hood.PNG'), added);
  const assets = fakeAssets();
  const items = [
    hood('parkdale', '/images/neighborhoods/parkdale.jpg'),
    hood('new-hood', '/images/neighborhoods/New Hood.PNG'),
    hood('trinity', '/images/neighborhoods/tracked-only.jpg'),
  ];
  const before = JSON.stringify(items);
  const result = await prepareImages({ items, root, sourceRef: 'origin/staging', registry, ...assets });
  assert.equal(JSON.stringify(items), before, 'input payloads are not mutated');
  const [parkdale, newHood, trinity] = result.items;
  assert.equal(parkdale.payload.image, `/media/${sha256(changed).slice(0, 16)}/parkdale.jpg`);
  assert.equal(newHood.payload.image, `/media/${sha256(added).slice(0, 16)}/new-hood.png`);
  assert.equal(trinity, items[2], 'tracked at sourceRef with no workspace file: unchanged');
  assert.deepEqual(Object.keys(parkdale.payload), Object.keys(items[0].payload), 'field rewritten in place');
  assert.deepEqual(result.assets.map((asset) => [asset.path, asset.contentType, asset.bytes.length]), [
    [parkdale.payload.image, 'image/jpeg', changed.length],
    [newHood.payload.image, 'image/png', added.length],
  ]);
  assert.deepEqual(result.report.map((entry) => entry.deduped), [false, false]);
  for (const asset of result.assets) assert.match(asset.path, MEDIA_PATH_PATTERN);

  // Restore the tracked bytes: identical git blob at sourceRef => unchanged, no asset.
  fs.writeFileSync(path.join(root, 'public/images/neighborhoods/parkdale.jpg'), JPEG('parkdale-v1'));
  const same = await prepareImages({ items: [items[0]], root, sourceRef: 'origin/staging', registry, ...fakeAssets() });
  assert.equal(same.items[0], items[0]);
  assert.deepEqual(same.assets, []);
  assert.equal(gitBlobId(JPEG('parkdale-v1')), git(root, 'rev-parse', 'origin/staging:public/images/neighborhoods/parkdale.jpg'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('assets dedupe against content.assets and within one submission', async () => {
  const root = workspace();
  const bytes = WEBP('shared');
  fs.writeFileSync(path.join(root, 'public/images/neighborhoods/a.webp'), bytes);
  fs.writeFileSync(path.join(root, 'public/images/neighborhoods/b.webp'), bytes);
  const items = [hood('a', '/images/neighborhoods/a.webp'), hood('b', '/images/neighborhoods/b.webp')];
  const fresh = fakeAssets();
  const once = await prepareImages({ items, root, sourceRef: 'origin/staging', registry, ...fresh });
  assert.equal(fresh.lookups.length, 1);
  assert.equal(once.assets.length, 1);
  assert.equal(once.items[0].payload.image, once.items[1].payload.image);
  const existingPath = `/media/${sha256(bytes).slice(0, 16)}/earlier-name.webp`;
  const stored = await prepareImages({ items, root, sourceRef: 'origin/staging', registry, ...fakeAssets({ [sha256(bytes)]: existingPath }) });
  assert.deepEqual(stored.assets.map((asset) => asset.path), [existingPath], 'deduped assets are still sent (stable request hash)');
  assert.deepEqual(stored.report, [{ sha256: sha256(bytes), path: existingPath, deduped: true }]);
  assert.equal(stored.items[1].payload.image, existingPath);
  fs.rmSync(root, { recursive: true, force: true });
});

test('refusals: missing, outside the images root, wrong type, oversize, bad /media and non-image paths', async () => {
  const root = workspace();
  const run = (image, extra = {}) => prepareImages({ items: [hood('x', image)], root, sourceRef: 'origin/staging', registry, ...fakeAssets(extra) });
  await assert.rejects(run('/images/neighborhoods/nowhere.jpg'), (error) => error.code === 'ValidationError' && error.reason === 'image-missing' && /^image-missing: /.test(error.message));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.jpg'), JPEG('outside'));
  fs.symlinkSync(path.join(outside, 'secret.jpg'), path.join(root, 'public/images/neighborhoods/link.jpg'));
  await assert.rejects(run('/images/neighborhoods/link.jpg'), { code: 'ValidationError', reason: 'image-outside-root' });
  fs.writeFileSync(path.join(root, 'public/images/neighborhoods/text.jpg'), 'not an image');
  await assert.rejects(run('/images/neighborhoods/text.jpg'), { code: 'ValidationError', reason: 'image-type' });
  fs.writeFileSync(path.join(root, 'public/images/neighborhoods/huge.jpg'), Buffer.concat([JPEG(''), Buffer.alloc(MAX_IMAGE_BYTES)]));
  await assert.rejects(run('/images/neighborhoods/huge.jpg'), { code: 'ValidationError', reason: 'image-size' });
  await assert.rejects(run(`/media/${'a'.repeat(16)}/x.jpg`), { code: 'ValidationError', reason: 'image-missing' });
  await run(`/media/${'a'.repeat(16)}/x.jpg`, { ['a'.repeat(64)]: `/media/${'a'.repeat(16)}/x.jpg` });
  await assert.rejects(run('https://example.com/x.jpg'), { code: 'ValidationError', reason: 'image-invalid' });
  await assert.rejects(run('/images/../../etc/passwd'), { code: 'ValidationError', reason: 'image-invalid' });
  // Empty image fields (six live businesses) and datasets without image fields are skipped.
  const empty = await prepareImages({ items: [{ dataset: 'businesses', key: 'b', op: 'insert', payload: { slug: 'b', image: '' } }, { dataset: 'guide-hub', key: 'guide-hub', op: 'update', payload: { image: 'ignored' } }], root, sourceRef: 'origin/staging', registry, ...fakeAssets() });
  assert.deepEqual(empty.assets, []);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
