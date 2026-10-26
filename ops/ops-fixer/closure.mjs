#!/usr/bin/env node
// Every file the fixer loads, so install-vm.sh copies exactly that and cannot
// drift when a dependency gains an import. Follows static relative imports only
// (the fixer's tree has no dynamic or package imports besides node: builtins).
//
//   node closure.mjs   -> paths relative to ops/, one per line
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IMPORT = /^\s*(?:import|export)\s[^;]*?\sfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gm;

export function moduleClosure(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(path.resolve(entry));
  return [...seen];
}

// realpath: a symlinked install path (e.g. macOS /var -> /private/var) must still run main.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ops = path.dirname(here);
  for (const file of moduleClosure(path.join(here, 'fixer.mjs'))) console.log(path.relative(ops, file));
}
