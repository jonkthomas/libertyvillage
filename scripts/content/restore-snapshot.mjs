import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ALL } from './canonical.mjs';
import { fetchPinnedSnapshot } from './snapshot-fetch.mjs';
export async function restoreSnapshot({ from, root, fetchImpl = fetch, bypass = process.env.CONTENT_SITE_BYPASS } = {}) {
  const stage = await mkdtemp(path.join(tmpdir(),'lv-content-restore-'));
  try {
    const headers = bypass ? { 'x-vercel-protection-bypass':bypass } : {};
    const { manifest } = await fetchPinnedSnapshot({from,root:path.join(stage,'verified'),fetchImpl,headers});
    await mkdir(path.join(root,'data'),{recursive:true});
    for (const d of ALL) await copyFile(path.join(stage,'verified','data',`${d}.json`),path.join(root,'data',`${d}.json`));
    for (const a of manifest.media) {
      const dest = path.join(root,'public',a.path.slice(1));
      await mkdir(path.dirname(dest),{recursive:true});
      await copyFile(path.join(stage,'verified','public',a.path.slice(1)),dest);
    }
    await mkdir(path.join(root,'.content-restore'),{recursive:true});
    await writeFile(path.join(root,'.content-restore','manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
    return { deploymentUrl:manifest.deployment_url,snapshotId:manifest.snapshot_id,files:ALL.length,media:manifest.media.length };
  } finally { await rm(stage,{recursive:true,force:true}); }
}
