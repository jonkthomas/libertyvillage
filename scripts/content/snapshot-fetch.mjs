import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ALL, datasetDigest, fromFile, hash } from './canonical.mjs';
export class SnapshotError extends Error { constructor(message) { super(message); this.code='SnapshotError'; } }
async function get(fetchImpl,url,headers) {
  const response = await fetchImpl(url,{headers,redirect:'follow'});
  if (!response.ok) throw new SnapshotError(`HTTP ${response.status}: ${url.pathname}`);
  return Buffer.from(await response.arrayBuffer());
}
const resource = (base,rel) => new URL(rel,`${base.replace(/\/$/,'')}/`);
async function manifestAt(fetchImpl,from,headers) {
  const bytes = await get(fetchImpl,resource(from,'content-snapshot/manifest.json'),headers);
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new SnapshotError('invalid-manifest'); }
}
function verifyManifest(manifest) {
  if (!manifest || !/^[0-9a-f]{40}$/.test(manifest.snapshot_id ?? '') || !Object.hasOwn(manifest,'deployment_url') || !manifest.datasets || !manifest.files || !Array.isArray(manifest.media)) throw new SnapshotError('invalid-manifest');
  if (Object.keys(manifest.files).length !== ALL.length) throw new SnapshotError('invalid-file-list');
}
export async function fetchPinnedSnapshot({ from, root, fetchImpl = fetch, headers = {}, retries = 3 } = {}) {
  if (!from || !root) throw new SnapshotError('source and root required');
  for (let attempt=0;attempt<retries;attempt++) {
    const first = await manifestAt(fetchImpl,from,headers);
    verifyManifest(first);
    const temp = await mkdtemp(path.join(tmpdir(),'lv-content-snapshot-'));
    try {
      await mkdir(path.join(temp,'data'),{recursive:true});
      for (const d of ALL) {
        const file = `${d}.json`;
        const bytes = await get(fetchImpl,resource(from,`content-snapshot/${file}`),headers);
        if (hash('sha256',bytes) !== first.files[file]) throw new SnapshotError(`file-hash-mismatch:${file}`);
        let records;
        try { records = fromFile(d,JSON.parse(bytes.toString('utf8'))); } catch { throw new SnapshotError(`invalid-json:${file}`); }
        if (datasetDigest(d,records) !== first.datasets[d]?.digest || records.length !== first.datasets[d]?.count) throw new SnapshotError(`dataset-digest-mismatch:${file}`);
        await writeFile(path.join(temp,'data',file),bytes);
      }
      for (const media of first.media) {
        if (!/^\/media\/[0-9a-f]{16}\/[a-z0-9][a-z0-9._-]{0,120}\.(jpg|png|webp)$/.test(media.path)) throw new SnapshotError('invalid-media-path');
        const bytes = await get(fetchImpl,resource(from,media.path.slice(1)),headers);
        if (hash('sha256',bytes) !== media.sha256 || bytes.length !== media.byte_size) throw new SnapshotError(`media-mismatch:${media.path}`);
        const dest = path.join(temp,'public',media.path.slice(1));
        await mkdir(path.dirname(dest),{recursive:true}); await writeFile(dest,bytes);
      }
      const second = await manifestAt(fetchImpl,from,headers);
      if (first.deployment_url !== second.deployment_url || first.snapshot_id !== second.snapshot_id) {
        if (attempt === retries-1) throw new SnapshotError('identity-unstable');
        continue;
      }
      await mkdir(path.dirname(root),{recursive:true});
      await rm(root,{recursive:true,force:true});
      await rename(temp,root);
      return { manifest:first, root };
    } finally { await rm(temp,{recursive:true,force:true}); }
  }
  throw new SnapshotError('identity-unstable');
}
export const readVerifiedFile = async (root,file) => readFile(path.join(root,'data',file));
