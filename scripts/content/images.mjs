// Submit-time image checks and asset conversion (§4.4 Images).
//
// For every registry image field of every item:
//   /media/<sha16>/<f>          must already exist in content.assets;
//   /images/<p> + workspace file  realpath inside <root>/public/images; unchanged when the
//                                 git blob at sourceRef is identical, else converted into a
//                                 content-addressed /media asset and the field rewritten;
//   /images/<p>, no workspace file must be tracked at sourceRef, else image-missing.
// sourceRef (origin/main or origin/staging) is what the target's deploy hook rebuilds:
// this proves the next build contains the file, smoke proves the deployed bytes.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ValidationError } from './store.mjs';

export const MAX_IMAGE_BYTES = 2_000_000;
export const MEDIA_PATH_PATTERN = /^\/media\/[0-9a-f]{16}\/[a-z0-9][a-z0-9._-]{0,120}\.(jpg|png|webp)$/;
const EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });

// A store ValidationError (CLI exit 2) whose message starts with the reason code.
export class ImageValidationError extends ValidationError {
  constructor(reason, message) {
    super(`${reason}: ${message}`);
    this.reason = reason;
  }
}

export function detectImageType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Lowercased basename reduced to [a-z0-9._-], leading alphanumeric, extension set
// from the detected content type (a .jpeg upload becomes .jpg).
export function sanitizeMediaName(fileName, contentType) {
  const extension = EXTENSIONS[contentType];
  if (!extension) throw new ImageValidationError('image-type', `unsupported content type ${contentType}`);
  const base = path.basename(String(fileName)).toLowerCase();
  const stem = base.replace(/\.[^.]*$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/[._-]+$/, '').slice(0, 121);
  return `${stem || 'image'}.${extension}`;
}

export const mediaPathFor = (sha256, name) => `/media/${sha256.slice(0, 16)}/${name}`;
export const gitBlobId = (bytes) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');

// Blob id of <file> at <ref> in the checkout, or null when it is not tracked there.
export function trackedBlob(root, ref, file) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

// items: [{dataset, key, op, payload}]. resolveAssets([{sha256}]) -> [{sha256, path|null}]
// and assetExists(path) -> boolean bind content.assets. Returns rewritten items
// (payloads are copied, never mutated), every converted asset (deduped ones too:
// createSubmission hashes the asset list into request_sha256, so a replay must send
// the same list; storage is ON CONFLICT DO NOTHING) and a report.
// verifyOnly (gate re-checks): /images must be tracked at sourceRef; the workspace is ignored.
export async function prepareImages({
  items, root, sourceRef, registry, resolveAssets, assetExists, readTracked = trackedBlob, verifyOnly = false,
}) {
  if (!root || !sourceRef) throw new Error('image checks require the workspace root and sourceRef');
  const imagesRoot = path.join(root, 'public', 'images');
  const realImagesRoot = fs.existsSync(imagesRoot) ? fs.realpathSync(imagesRoot) : null;
  const bySha = new Map();
  const report = [];
  const out = [];
  for (const item of items) {
    const fields = registry?.[item.dataset]?.imageFields || [];
    let payload = item.payload;
    for (const field of fields) {
      const value = payload?.[field];
      if (value === undefined || value === null || value === '') continue;
      const where = `data/${item.dataset}.json: ${item.key}: ${field}`;
      if (typeof value !== 'string') throw new ImageValidationError('image-invalid', `${where} must be a string path`);
      if (value.startsWith('/media/')) {
        if (!MEDIA_PATH_PATTERN.test(value) || !(await assetExists(value))) {
          throw new ImageValidationError('image-missing', `${where} ${value} is not a stored asset`);
        }
        continue;
      }
      if (!value.startsWith('/images/') || value.split('/').some((part) => part === '..')) {
        throw new ImageValidationError('image-invalid', `${where} ${value} must be an /images/ or /media/ path`);
      }
      const repoPath = `public${value}`;
      const workspaceFile = path.join(root, repoPath);
      if (verifyOnly || !fs.existsSync(workspaceFile)) {
        if (!readTracked(root, sourceRef, repoPath)) {
          throw new ImageValidationError('image-missing', `${where} ${value} is neither in the workspace nor tracked at ${sourceRef}`);
        }
        continue;
      }
      const real = fs.realpathSync(workspaceFile);
      if (!realImagesRoot || !(real === realImagesRoot || real.startsWith(`${realImagesRoot}${path.sep}`)) || !fs.statSync(real).isFile()) {
        throw new ImageValidationError('image-outside-root', `${where} ${value} resolves outside public/images`);
      }
      const bytes = fs.readFileSync(real);
      if (readTracked(root, sourceRef, repoPath) === gitBlobId(bytes)) continue;
      if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) {
        throw new ImageValidationError('image-size', `${where} ${value} is ${bytes.length} bytes (1..${MAX_IMAGE_BYTES})`);
      }
      const contentType = detectImageType(bytes);
      if (!contentType) throw new ImageValidationError('image-type', `${where} ${value} is not a JPEG, PNG or WebP file`);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      let asset = bySha.get(sha256);
      if (!asset) {
        const [existing] = await resolveAssets([{ sha256 }]);
        const deduped = Boolean(existing?.path);
        const assetPath = deduped ? existing.path : mediaPathFor(sha256, sanitizeMediaName(value, contentType));
        if (!MEDIA_PATH_PATTERN.test(assetPath)) throw new ImageValidationError('image-invalid', `${where} derived path ${assetPath} is invalid`);
        asset = { sha256, path: assetPath, contentType, bytes, deduped };
        bySha.set(sha256, asset);
        report.push({ sha256, path: assetPath, deduped });
      }
      payload = { ...payload, [field]: asset.path };
    }
    out.push(payload === item.payload ? item : { ...item, payload });
  }
  const assets = [...bySha.values()]
    .map(({ sha256, path: assetPath, contentType, bytes }) => ({ sha256, path: assetPath, contentType, bytes }));
  return { items: out, assets, report };
}
