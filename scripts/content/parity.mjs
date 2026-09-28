import { ALL, datasetDigest, serialize } from './canonical.mjs';
import { readLive } from './store.mjs';
import { loadSource } from './seed.mjs';
export async function verifyParity(db, sourceArgs) {
  const source = await loadSource(sourceArgs);
  const live = await readLive(db);
  const datasets = {};
  let match = true;
  for (const d of ALL) {
    const actual = live.datasets[d], expected = source.datasets[d];
    const expectedDigest = datasetDigest(d,expected);
    const equal = actual.count === expected.length && actual.digest === expectedDigest && serialize(d,actual.records) === serialize(d,expected);
    datasets[d] = { count:actual.count, digest:actual.digest, match:equal };
    match &&= equal;
  }
  return { match, datasets };
}
