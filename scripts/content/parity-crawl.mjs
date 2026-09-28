import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, hash, registry, fromFile, keyOf } from './canonical.mjs';
const repo=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
function args(argv){const [command,...rest]=argv;const options={};const positional=[];for(let i=0;i<rest.length;i++){if(!rest[i].startsWith('--')){positional.push(rest[i]);continue;}const key=rest[i].slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());options[key]=rest[i+1]&&!rest[i+1].startsWith('--')?rest[++i]:true;}return {command,options,positional};}
function cleanHtml(html,remapOrigin){let text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();if(remapOrigin)text=text.replaceAll(remapOrigin,'https://libertyvillage.co');return text;}
async function get(url,header){const response=await fetch(url,{headers:header});if(!response.ok)return {status:response.status,bytes:Buffer.alloc(0)};return {status:response.status,bytes:Buffer.from(await response.arrayBuffer())};}
export async function crawl({base,manifestFile,media=false,bypassEnv,remapOrigin,root=repo}={}){
  if(!base)throw Error('--base required');
  const manifest=manifestFile?JSON.parse(await readFile(manifestFile,'utf8')):null;
  if(media&&!manifest)throw Error('--media requires --manifest');
  const headers=bypassEnv&&process.env[bypassEnv]?{'x-vercel-protection-bypass':process.env[bypassEnv]}:{};
  const routes=new Map([['/','home']]);
  for(const d of ALL){const route=registry[d].route;if(!route)continue;const records=fromFile(d,JSON.parse(await readFile(path.join(root,'data',`${d}.json`),'utf8')));for(const record of records){const key=keyOf(d,record);routes.set(route.replace(':key',key),d);}}
  const pages={};
  for(const [route,dataset] of routes){const response=await get(new URL(route,base),headers);const html=response.bytes.toString('utf8');const title=html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]??'';pages[route]={dataset,status:response.status,title,textSha256:hash('sha256',cleanHtml(html,remapOrigin))};}
  const mediaResults={};
  if(media)for(const entry of manifest.media){const response=await get(new URL(entry.path,base),headers);const sha256=hash('sha256',response.bytes);mediaResults[entry.path]={status:response.status,sha256,byte_size:response.bytes.length};if(response.status!==200||sha256!==entry.sha256||response.bytes.length!==entry.byte_size)throw Error(`media mismatch: ${entry.path}`);}
  return {base,snapshot_id:manifest?.snapshot_id??null,deployment_url:manifest?.deployment_url??null,pages,media:mediaResults};
}
export function compare(a,b){const diffs=[];for(const route of new Set([...Object.keys(a.pages),...Object.keys(b.pages)]))if(JSON.stringify(a.pages[route])!==JSON.stringify(b.pages[route]))diffs.push({route,source:a.pages[route]??null,target:b.pages[route]??null});for(const item of new Set([...Object.keys(a.media),...Object.keys(b.media)]))if(JSON.stringify(a.media[item])!==JSON.stringify(b.media[item]))diffs.push({media:item,source:a.media[item]??null,target:b.media[item]??null});return {match:diffs.length===0,diffs};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const {command,options,positional}=args(process.argv.slice(2));try{let result;if(command==='crawl'){result=await crawl({base:options.base,manifestFile:options.manifest,media:!!options.media,bypassEnv:options.bypassEnv,remapOrigin:options.remapOrigin});if(options.out)await writeFile(options.out,`${JSON.stringify(result,null,2)}\n`);}else if(command==='compare'){result=compare(JSON.parse(await readFile(positional[0],'utf8')),JSON.parse(await readFile(positional[1],'utf8')));if(!result.match)process.exitCode=1;}else throw Error('expected crawl or compare');console.log(JSON.stringify(result));}catch(error){console.error(error.message);process.exitCode=1;}}
