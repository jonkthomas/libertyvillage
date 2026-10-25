#!/usr/bin/env node
// Writer self-check: run the pipeline's pre-submit pack check on the post just
// appended to data/posts.json. Usage: node scripts/automation/check-blog-draft.mjs <source-pack.json>
// Read-only; prints {"ok":bool,"errors":[...]} and exits 1 on any error.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { checkDraftAgainstPack } from './blog-source-pack.mjs';

const { listBlogImages } = createRequire(import.meta.url)('../weekly-blog-agent.js');
const root = process.cwd();
const read = (rel) => JSON.parse(fs.readFileSync(path.resolve(root, rel), 'utf8'));
const posts = read('data/posts.json');
const result = checkDraftAgainstPack(posts.at(-1), read(process.argv[2]), {
  businesses: read('data/businesses.json'), posts: posts.slice(0, -1), services: read('data/services.json'), topics: read('data/topics.json'),
  imagePaths: listBlogImages(root), now: new Date(), requireRealDate: true,
});
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
