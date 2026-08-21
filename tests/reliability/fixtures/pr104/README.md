# PR #104 canary fixtures (evaluator-owned)

Frozen evidence for `tests/automation/canary104-grounding.eval.mjs`.
Do not expand these into full `data/businesses.json` or image binaries.
No secrets.

## What failed

Live canary PR [#104](https://github.com/jonkthomas/libertyvillage/pull/104)
(`blog/auto-1787342297` → `staging`). Trajectory **3.5 → 4.5 → 5.5 → 3.5**,
terminal `automation-blocked` / `automation-repair-3` / exhausted.

1. Generation asserted pet-friendly / dog-policy facts no `data/businesses.json`
   record supports. The pre-PR claim linter still returned `ok: true`.
2. Three repair rounds deleted the pet premise from repairable fields
   (`title`, `content`, `tags`, …) while immutable `slug` and `image` stayed
   `pet-friendly-restaurants-patios-cafes-liberty-village-2026`.
   Preflight classified the identity mismatch as repairable, so the ladder
   burned `MAX_REPAIRS` instead of abandoning.
3. Final gate (`3850da18`) received **5** reference records and called six
   repository-backed address/hour claims unsupported. The linter had attributed
   those unbolded names. Gate `selectReferenceRecords` only scans `**bold**`
   names and literal slugs in the serialized input; the fixer payload is
   `JSON.stringify([{ file, records }])`, the Opus review is a git unified
   diff. That is the linter/gate reference-extraction mismatch.

## Evidence commands

```bash
# PR metadata, labels, head SHA, files
gh pr view 104 --repo jonkthomas/libertyvillage --comments
gh pr view 104 --repo jonkthomas/libertyvillage \
  --json commits,files,labels,headRefOid,baseRefOid,title

# Generation + four coordinator rounds
gh api repos/jonkthomas/libertyvillage/actions/runs/32520547728
gh api repos/jonkthomas/libertyvillage/actions/runs/32521194011/artifacts
gh api repos/jonkthomas/libertyvillage/actions/runs/32521917915/artifacts
gh api repos/jonkthomas/libertyvillage/actions/runs/32522675980/artifacts
gh api repos/jonkthomas/libertyvillage/actions/runs/32523454965/artifacts

# Appended post at each SHA (work from a checkout that can see the PR ref)
git show e82a89d6c7020d4d335d83822a440a73de1e116f:data/posts.json
git show 4bde753e5fdc0d126628d01fea547ee121ea5aaa:data/posts.json
git show e729465adc48a5411c563e3e2fa6ce533ca6307f:data/posts.json
git show 3850da18a6744f86cb24793b5e9235d9a6b20a32:data/posts.json
```

Coordinator artifacts (gate-verdict / repair-audit / blocked-audit):

| SHA      | run id       | score | refs | blocking | decision    |
|----------|--------------|-------|------|----------|-------------|
| e82a89d6 | 32521194011  | 3.5   | 12   | 3        | repairing   |
| 4bde753e | 32521917915  | 4.5   | 12   | 1        | repairing   |
| e729465a | 32522675980  | 5.5   | 12   | 1        | repairing   |
| 3850da18 | 32523454965  | 3.5   | **5**| 2        | exhausted   |

Final gate reference slugs (the five that survived bold/slug matching):
`liberty-commons-big-rock-brewery`, `balzacs-coffee-liberty-village`,
`louie-coffee-bar`, `left-field-brewery`, `left-field-brewery-liberty-village`.

Six records the final gate called missing, all present in `businesses-excerpts.json`:
`brazen-head-irish-pub`, `local-public-eatery`,
`local-public-eatery-liberty-village`, `school-restaurant`, `arvo-coffee`,
`jimmys-coffee-liberty-village`.

## Expected RED baseline (current origin/main)

```bash
node --test tests/automation/canary104-grounding.eval.mjs
```

Recorded against `origin/main` at `4684846` (merge of PR #103):

- **4 fail [RED]**, **3 pass [GREEN]**
- RED tests fail because:
  - `scripts/blog-lint.mjs` does not export `extractReferencedBusinesses`
  - `selectReferenceRecords` on the final post / unified-diff / fixer payload
    misses the six unbolded businesses
  - `lintPost` accepts a pet-friendly (and other operational-attribute) premise
    with no supporting record field
  - `classifyFindings` / `preflightDecision` treat the slug/image identity
    mismatch as repairable; `isUnrepairablePremiseAbandonment` is not exported
- GREEN tests already hold: fixture integrity, grounded outdoor-dining lint,
  record-supported pet-friendly lint

Implementation must turn the four RED tests green without weakening GREEN ones.
Maker != checker: do not edit this directory, the eval, or
`evals/canary104-grounding.sha256` from the builder worktree.
