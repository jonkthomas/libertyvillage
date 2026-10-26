import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://libertyvillage.co';
const sections = [
  ['Neighbourhood Guides', 'topics', 'guide'],
  ['Blog Posts', 'posts', 'blog'],
  ['Service Directories', 'services', 'best'],
  ['Local Businesses', 'businesses', 'directory'],
  ['Neighbourhood Comparisons', 'neighborhoods', 'vs'],
  ['Buildings', 'buildings', 'buildings'],
];
const plain = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[#*`\[\]]/g, '').replace(/\s+/g, ' ').trim();
const words = (value, limit) => plain(value).split(' ').slice(0, limit).join(' ');

// Read the same JSON datasets Next renders: prebuild exports the DB first.
// Never read topic queues, drafts, or operational metadata into public summaries.
export async function generateLlms({ rootDir = process.cwd() } = {}) {
  const intro = '# libertyvillage.co\n\n> A neighbourhood guide to Liberty Village, Toronto: local businesses, transit, housing, community news and practical guides.\n';
  const core = '\n## Core Pages\n\n- [Homepage](https://libertyvillage.co/): Neighbourhood overview and featured guides.\n- [About](https://libertyvillage.co/about): About this site and its sources.\n- [World Cup Hub](https://libertyvillage.co/world-cup): World Cup 2026 coverage near BMO Field.\n';
  let short = intro + '\n[Full page summaries](https://libertyvillage.co/llms-full.txt)\n' + core;
  let full = intro + core;
  for (const [heading, dataset, route] of sections) {
    const records = JSON.parse(await readFile(path.join(rootDir, 'data', `${dataset}.json`), 'utf8'));
    short += `\n## ${heading}\n\n`;
    full += `\n## ${heading}\n\n`;
    for (const record of records) {
      const title = plain(record.title || record.pluralName || record.name);
      const url = `${BASE}/${route}/${encodeURIComponent(record.slug)}`;
      const description = record.description || record.answerSummary || record.answerBlock || record.verdict || '';
      short += `- [${title}](${url}): ${words(description, 30)}\n`;
      const detail = [description, record.answerSummary, record.answerBlock, record.content, ...(record.keyTakeaways ?? [])]
        .filter((value) => typeof value === 'string' && value.trim());
      const summary = words([...new Set(detail)].join(' '), 100);
      full += `### [${title}](${url})\n\n${summary}\n\n`;
      const updated = record.updatedAt || record.lastUpdated || record.publishedAt;
      if (updated) full += `Content date: ${plain(updated)}\n\n`;
    }
  }
  await mkdir(path.join(rootDir, 'public'), { recursive: true });
  await writeFile(path.join(rootDir, 'public', 'llms.txt'), short);
  await writeFile(path.join(rootDir, 'public', 'llms-full.txt'), full);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateLlms().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
