// g2 review document (§4.6): the exact bytes the gate scores for one round.
//
//   content submission <id> round <n> kind <kind> target <target>
//   --- a/data/<dataset>.json#<key>
//   +++ b/data/<dataset>.json#<key>
//   @@ -s,l +s,l @@            3-context unified diff of JSON.stringify(x, null, 2)
//
// Items are emitted in (dataset, key) order and an insert diffs against an empty
// base, so the same round vector always yields the same document and contentSha.
import { createHash } from 'node:crypto';

export const REVIEW_DOCUMENT_MAX_BYTES = 500_000;
export const DIFF_CONTEXT = 3;

// Same formula as canonical.blobSha1 (§4.1): the git blob id of the document.
export function blobSha1(text) {
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(text)}\0`), Buffer.from(text)]))
    .digest('hex');
}

// Myers O(ND) shortest edit script over lines -> [{op:' '|'-'|'+', line}].
function editScript(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let done = false;
  for (let d = 0; d <= max && !done; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]))
        ? v[offset + k + 1]
        : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[offset + k] = x;
      if (x >= n && y >= m) { done = true; break; }
    }
  }
  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const vd = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ op: ' ', line: a[x - 1] }); x -= 1; y -= 1; }
    if (d > 0) {
      if (x === prevX) ops.push({ op: '+', line: b[y - 1] });
      else ops.push({ op: '-', line: a[x - 1] });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

const range = (start, count) => (count === 1 ? `${start}` : `${count === 0 ? start - 1 : start},${count}`);

export function unifiedDiffLines(aText, bText, context = DIFF_CONTEXT) {
  const a = aText === '' ? [] : aText.split('\n');
  const b = bText === '' ? [] : bText.split('\n');
  const ops = editScript(a, b);
  const changed = ops.map((entry, index) => (entry.op === ' ' ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return [];
  // Merge change runs whose context windows touch into one hunk.
  const groups = [];
  for (const index of changed) {
    const last = groups.at(-1);
    if (last && index - last.end <= 2 * context) last.end = index;
    else groups.push({ start: index, end: index });
  }
  // Line numbers before each op index.
  const aBefore = new Int32Array(ops.length + 1);
  const bBefore = new Int32Array(ops.length + 1);
  for (let i = 0; i < ops.length; i += 1) {
    aBefore[i + 1] = aBefore[i] + (ops[i].op === '+' ? 0 : 1);
    bBefore[i + 1] = bBefore[i] + (ops[i].op === '-' ? 0 : 1);
  }
  const lines = [];
  for (const group of groups) {
    const from = Math.max(0, group.start - context);
    const to = Math.min(ops.length - 1, group.end + context);
    const slice = ops.slice(from, to + 1);
    const aCount = slice.filter((entry) => entry.op !== '+').length;
    const bCount = slice.filter((entry) => entry.op !== '-').length;
    lines.push(`@@ -${range(aBefore[from] + 1, aCount)} +${range(bBefore[from] + 1, bCount)} @@`);
    for (const entry of slice) lines.push(`${entry.op}${entry.line}`);
  }
  return lines;
}

const compareItems = (left, right) => (left.dataset === right.dataset
  ? (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
  : (left.dataset < right.dataset ? -1 : 1));

// items: [{dataset, key, base (null for insert), candidate}]
export function buildReviewDocument({ submissionId, round, kind, target, items }) {
  if (!Number.isInteger(Number(submissionId)) || !Number.isInteger(round) || !kind || !target) {
    throw new Error('review document requires submissionId, round, kind and target');
  }
  if (!Array.isArray(items) || items.length === 0) throw new Error('review document requires at least one item');
  const lines = [`content submission ${submissionId} round ${round} kind ${kind} target ${target}`];
  const seen = new Set();
  for (const item of [...items].sort(compareItems)) {
    const id = `${item.dataset}#${item.key}`;
    if (seen.has(id)) throw new Error(`duplicate review document item: ${id}`);
    seen.add(id);
    if (item.candidate === undefined || item.candidate === null) throw new Error(`review document item has no candidate: ${id}`);
    const path = `data/${item.dataset}.json#${item.key}`;
    lines.push(`--- a/${path}`, `+++ b/${path}`);
    const baseText = item.base === undefined || item.base === null ? '' : JSON.stringify(item.base, null, 2);
    lines.push(...unifiedDiffLines(baseText, JSON.stringify(item.candidate, null, 2)));
  }
  const document = `${lines.join('\n')}\n`;
  const bytes = Buffer.byteLength(document);
  if (bytes > REVIEW_DOCUMENT_MAX_BYTES) throw new Error(`review document budget exceeded: ${bytes} bytes`);
  return { document, contentSha: blobSha1(document), bytes };
}

// g4: "cut finding paths at '#'" so preflightDecision/classifyFindings see repo
// paths (data/<dataset>.json) exactly as the PR-mode gate did.
export function cutFindingPaths(verdict) {
  if (!verdict || typeof verdict !== 'object' || !Array.isArray(verdict.findings)) return verdict;
  return {
    ...verdict,
    findings: verdict.findings.map((finding) => (finding && typeof finding.path === 'string'
      ? { ...finding, path: finding.path.split('#')[0] }
      : finding)),
  };
}
