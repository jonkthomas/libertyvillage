import { createHash } from 'node:crypto';

function hashLowerHex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeTitle(title) {
  return String(title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeBranchPrefix(prefix) {
  return String(prefix ?? '').trim().toLowerCase();
}

export function topicKey(kind, title, branchPrefix) {
  return hashLowerHex(`${kind}|${normalizeTitle(title)}|${normalizeBranchPrefix(branchPrefix)}`);
}

