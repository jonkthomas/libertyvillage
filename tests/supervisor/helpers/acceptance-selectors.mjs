// Eval-owned EXACT selectors over the parent-owned spawn log. FROZEN by
// evals/local-supervisor-acceptance.sha256 (maker != checker).
//
// SIXTH eval-owner correction — SELECTOR AMBIGUITY UNDER BASELINE NOISE.
// The spawn log is SHARED by everything the child tree launches, and the five
// baseline gates run the repository's own suites: `npm run test:automation`
// alone drives fifteen fixture `record-candidate-outcome` coordinator children
// (tests/automation/*.eval.mjs) before the supervisor ever reaches its own
// terminal, and `npm run test:supervisor` drives fixture `blog-lint` children
// (tests/supervisor/contracts.test.mjs), one of them with ABSOLUTE data paths.
// A selector that takes the FIRST (`.find`) or the LAST (`.at(-1)`) entry
// matching a coarse predicate therefore inspects fixture noise, not the run:
//
//   - N4-reason/N4-durable used `.find(e => e.argv.includes('record-candidate-outcome'))`
//     and selected record 0 (`--reason "fixture candidate failed"`, 24 chars, no
//     --topic-key) instead of the run's own record 15 (511 chars, ending in the
//     literal `…[truncated]`). Both checks went RED while production was right.
//   - M138-shape used `.at(-1)` over every blog-lint child. When that scenario
//     ends GENERATION_FAILED_PRE_PR (a terminal M138-red explicitly allows) the
//     supervisor never lints, so the last entry is a FIXTURE lint whose
//     `--posts` is absolute — and the "pre-#138 shape" assertion passes on
//     evidence the run never produced. That direction is a false GREEN.
//
// Every selector here therefore identifies the run's OWN child by exact
// identity, and fails loudly on zero matches AND on more than one.
import { assertTrue, pathContains, samePath, spawnEntriesFor } from './acceptance-evidence.mjs';

// Pairwise `--flag value` parse of a coordinator argv, starting after argv[2]
// (node, script, subcommand). The value is CONSUMED, so a value that is itself
// spelled like a flag (a diagnostic reason of `--key`) can never be re-read as
// one — which a bare indexOf('--key') would do. Production appends `--repo`
// after `--reason`, so trailing flags parse exactly like leading ones.
export function coordinatorFlags(argv, { from = 3 } = {}) {
  const parts = (argv || []).map(String);
  const flags = {};
  for (let index = from; index < parts.length; index += 1) {
    if (!parts[index].startsWith('--')) continue;
    flags[parts[index].slice(2)] = index + 1 < parts.length ? parts[index + 1] : null;
    index += 1;
  }
  return flags;
}

// Every observed `record-candidate-outcome` coordinator child, with its parsed
// flags. The subcommand is read POSITIONALLY (argv[2]); an entry that merely
// CARRIES the string somewhere in a `--reason` is not a candidate.
export function candidateOutcomeEntries(entries) {
  return spawnEntriesFor(entries || [], 'coordinator.mjs')
    .filter((entry) => String((entry.argv || [])[2]) === 'record-candidate-outcome')
    .map((entry) => ({ entry, flags: coordinatorFlags(entry.argv) }));
}

const describeCandidates = (all) => (all.length
  ? all.map(({ flags }) => `${flags.outcome ?? '?'} key=${flags.key ?? '?'} topic=${flags['topic-key'] ?? '?'}`).join(' | ')
  : 'none');

// THE run's own durable-ladder record: the entry whose `--key` is exactly this
// run's run_id AND whose `--topic-key` is exactly this run's persisted
// topic_key (and, when given, whose `--outcome` is the terminal under test).
// Zero matches and multiple matches are both failures, by name.
export function candidateOutcomeRecord(entries, { runId, topicKey, outcome = null, label = 'candidate outcome' }) {
  assertTrue(typeof runId === 'string' && runId.trim().length > 0,
    `${label}: the run row carries no run_id to select on (observed ${JSON.stringify(runId ?? null)})`);
  assertTrue(typeof topicKey === 'string' && topicKey.trim().length > 0,
    `${label}: the run row carries no topic_key to select on (observed ${JSON.stringify(topicKey ?? null)}) — the ladder key is unformable`);
  const all = candidateOutcomeEntries(entries);
  const matches = all.filter(({ flags }) => flags.key === runId && flags['topic-key'] === topicKey
    && (outcome === null || flags.outcome === outcome));
  assertTrue(matches.length > 0,
    `${label}: no record-candidate-outcome child had --key ${runId} AND --topic-key ${topicKey}${outcome ? ` AND --outcome ${outcome}` : ''}; observed ${all.length} candidate(s): ${describeCandidates(all)}`);
  assertTrue(matches.length === 1,
    `${label}: ${matches.length} record-candidate-outcome children share this run/topic key, so the selection is ambiguous: ${describeCandidates(matches)}`);
  const [{ entry, flags }] = matches;
  return { entry, flags, argv: entry.argv, reason: flags.reason ?? null };
}

// THE supervisor's own trusted-linter child: the blog-lint entry that ran the
// exact repoRoot script the host invokes (`path.join(repoRoot, 'scripts/blog-lint.mjs')`
// — unchanged by the #138 fix, which moved only the cwd and the data paths).
// Fixture linters launched by the baseline suites run the WORKTREE copy from a
// temporary directory, so they can never be mistaken for the run's own lint.
// `workRoot`, when given, additionally requires canonical containment.
export function supervisorLintInvocation(entries, { script, workRoot = null, label = 'supervisor lint' }) {
  const all = spawnEntriesFor(entries || [], 'scripts/blog-lint.mjs');
  const matches = all.filter((entry) => samePath((entry.argv || [])[1], script)
    && (workRoot === null || pathContains(workRoot, entry.cwd)));
  const described = all.length ? all.map((entry) => `${(entry.argv || [])[1]} @ ${entry.cwd}`).join(' | ') : 'none';
  assertTrue(matches.length > 0,
    `${label}: no blog-lint child ran the trusted script ${script}${workRoot ? ` from within ${workRoot}` : ''}; observed ${all.length} blog-lint child(ren): ${described}`);
  assertTrue(matches.length === 1,
    `${label}: ${matches.length} blog-lint children ran the trusted script, so the selection is ambiguous: ${described}`);
  return matches[0];
}
