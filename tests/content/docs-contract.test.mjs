import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (name) => readFile(new URL(`../../${name}`, import.meta.url), 'utf8');

test('L2 instructions force-add verified media while regular writer media stays ignored', async () => {
  const [ignore, spec, runbook] = await Promise.all([
    source('.gitignore'), source('docs/specs/neon-content-store.md'), source('docs/runbooks/content-store.md'),
  ]);
  assert.match(ignore, /^\/public\/media\/$/m);
  assert.match(spec, /git add -f public\/media\//);
  assert.match(runbook, /git add -f public\/media\//);
});
