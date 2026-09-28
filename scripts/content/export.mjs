import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ALL, serialize, hash } from './canonical.mjs';
import { readLive, ValidationError } from './store.mjs';
import { validateRecord } from './validate.mjs';
export function publicManifest(snapshot) {
  return { ...snapshot, datasets:Object.fromEntries(Object.entries(snapshot.datasets).map(([d,value]) => [d,{count:value.count,digest:value.digest,entries:value.entries}])) };
}
export async function exportContent(db, { root, withAssets = false, publicSnapshot = false, build = null } = {}) {
  if (!root) throw new ValidationError('export root required');
  const snapshot = await readLive(db);
  for (const d of ALL) {
    if (d !== 'discovery-seen' && !snapshot.datasets[d].count) throw new ValidationError(`empty dataset: ${d}`);
    for (const [key, entry] of Object.entries(snapshot.datasets[d].entries)) {
      if (d === 'discovery-seen') continue;
      const record = snapshot.datasets[d].records.find((r) => d === 'guide-hub' || (d === 'topic-queue' ? r.key : r.slug) === key);
      const valid = validateRecord(d,key,record);
      if (!valid.ok) throw new ValidationError(`${d}/${key}: ${valid.errors.join('; ')}`);
      if (!entry.sha) throw new ValidationError('missing record hash');
    }
  }
  const files = Object.fromEntries(ALL.map((d) => [`${d}.json`, serialize(d,snapshot.datasets[d].records)]));
  const media = [];
  if (withAssets || publicSnapshot) for (const a of snapshot.media) {
    const row = (await db.query('select bytes from content.assets where sha256=$1', [a.sha256])).rows[0];
    if (!row || hash('sha256',row.bytes) !== a.sha256 || row.bytes.length !== a.byte_size) throw new ValidationError(`asset mismatch: ${a.path}`);
    media.push({ path:a.path, bytes:row.bytes });
  }
  await mkdir(path.join(root,'data'),{recursive:true});
  for (const [file,text] of Object.entries(files)) await writeFile(path.join(root,'data',file),text);
  const manifest = { ...publicManifest(snapshot), ...(build ?? {}), files:Object.fromEntries(Object.entries(files).map(([file,text]) => [file,hash('sha256',text)])) };
  if (publicSnapshot) {
    const dest = path.join(root,'public','content-snapshot');
    await mkdir(dest,{recursive:true});
    for (const [file,text] of Object.entries(files)) await writeFile(path.join(dest,file),text);
    await writeFile(path.join(dest,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
  } else {
    await mkdir(path.join(root,'.content-export'),{recursive:true});
    await writeFile(path.join(root,'.content-export','manifest.json'),`${JSON.stringify(publicManifest(snapshot),null,2)}\n`);
  }
  if (withAssets || publicSnapshot) for (const a of media) {
    const dest = path.join(root,'public',a.path.slice(1));
    await mkdir(path.dirname(dest),{recursive:true});
    await writeFile(dest,a.bytes);
  }
  return { snapshotId:snapshot.snapshot_id, liveSeq:snapshot.live_seq, files:Object.keys(files), manifest };
}
