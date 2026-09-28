// Fixer plan validator for the content-store gate (§4.7).
//
// planRecordRepair calls validate(plan) on every fixer attempt and feeds the errors
// back into the retry prompt, so this must reject exactly what the next round
// would reject: non-candidate targets, contract breaks (validateRowRepair) and the
// same §4.4 kind policy the submission passed, evaluated with submissions.context.
import { isRecordRepairPlan } from '../automation/record-repair.mjs';
import { datasetOfFile, fileOf, validateRowRepair } from './repair-rules.mjs';
import { checkRecordPolicy } from './submit.mjs';

// candidates: round n's vector [{dataset, key, op, payload}]; ctx: submissions.context;
// live/deps: the live records and bindings checkRecordPolicy needs (validateRecord, news).
export function makeRowRepairValidator({ kind, candidates, ctx = {}, live = {}, deps = {} }) {
  const byId = new Map((Array.isArray(candidates) ? candidates : []).map((item) => [`${fileOf(item.dataset)}\t${item.key}`, item]));
  const files = new Set([...byId.values()].map((item) => fileOf(item.dataset)));
  // Images are immutable under every repair contract, so the repair path never
  // re-resolves assets; everything else is the submission's own policy.
  const policyDeps = { ...deps };
  delete policyDeps.checkImages;

  return (plan) => {
    const errors = [];
    const repaired = [];
    if (!isRecordRepairPlan(plan) || !Array.isArray(plan.files)) {
      return { ok: false, errors: ['repair plan must be a record-repair plan with a files array'], repaired };
    }
    if (typeof plan.reason !== 'string' || plan.reason.trim().length === 0) errors.push('repair plan reason is required');
    if (plan.files.length === 0) errors.push('repair plan must contain at least one file');
    const seen = new Set();
    for (const [fileIndex, entry] of plan.files.entries()) {
      const file = entry?.file;
      if (typeof file !== 'string' || !files.has(file)) {
        errors.push(`${String(file)}: repair plan file ${fileIndex} is not a candidate file`);
        continue;
      }
      if (!Array.isArray(entry.records) || entry.records.length === 0) {
        errors.push(`${file}: repair plan entry must contain records`);
        continue;
      }
      for (const [index, row] of entry.records.entries()) {
        const key = row?.key;
        if (!row || typeof row !== 'object' || Array.isArray(row) || typeof key !== 'string' || key.length === 0) {
          errors.push(`${file}: repaired entry ${index} must be an object with a key`);
          continue;
        }
        const id = `${file}\t${key}`;
        if (seen.has(id)) { errors.push(`${file}: ${key}: duplicate repaired key`); continue; }
        seen.add(id);
        const candidate = byId.get(id);
        if (!candidate) { errors.push(`${file}: ${key}: not a candidate key of this submission`); continue; }
        const dataset = datasetOfFile(file);
        const check = validateRowRepair(dataset, candidate.payload, row.record);
        if (!check.ok) { errors.push(...check.errors.map((error) => `${file}: ${key}: ${error}`)); continue; }
        const item = { dataset, key, op: candidate.op, payload: row.record };
        const policy = checkRecordPolicy({ kind, item, ctx, live, deps: policyDeps });
        const failures = [...policy.errors, ...policy.lint];
        if (failures.length) { errors.push(...failures.map((error) => `${file}: ${key}: ${error}`)); continue; }
        repaired.push({ dataset, key, payload: row.record });
      }
    }
    return errors.length === 0 ? { ok: true, errors, repaired } : { ok: false, errors, repaired: [] };
  };
}
