# Cluster consolidation

`consolidation-clusters.json` owns membership, the primary and the useful sections
to retain from every member. Every cluster starts with `confirmed: false`, so
this PR ships zero cluster redirects. `next.config.ts` derives exact 301s only
from clusters with `confirmed: true`. Changing a primary is a data-file edit;
the matching redirects change with it once confirmed. Tests check both states,
destination existence and absence of chains.
Directory category hubs with listed businesses remain primaries or stay outside
clusters: restaurants, gyms and coworking keep their `/best/*` hubs. Confirmation
must preserve that intent boundary even if an editorial URL has more clicks.
The optional `imageFrom` can select an existing image from another member.

Candidate text rewrites links from retired URLs to their primaries and unlinks
self-links, including links already in the primary. Query strings and fragments
on rewritten links are retained. Service records use plain prose because their
renderer does not support Markdown: link labels remain, raw URL suffixes are
removed, and table rows become readable header/value sentences.

The initial choices are **PROVISIONAL**. Obtain `source-data.json` from the
read-only VM run. Confirm or replace each primary using 28-day page clicks first,
impressions second, and shared query intent. Fill the per-member metrics and
update the plan's evidence/status. A small follow-up PR flips `confirmed: true`
for the verified choices; deploy those redirects while the originals remain live.
Missing GSC rows are unknown, not zero. World Cup posts remain live.

Apply refuses the entire selected plan if any cluster is unconfirmed (including
a missing confirmation field), before DB reads or snapshot writes. A custom
`--plan` can select only confirmed clusters for an incremental operation. Dry-run
can preview unconfirmed candidates and emits no redirects for them. Rollback is
exempt from confirmation, so a saved operation can always be recovered.

Use a single operator per run directory. Keep that directory outside the checkout
and retain it with the parent’s operational evidence. The snapshot binds to the
database name, target and exact plan digest. Reuse the same plan and directory to
resume a partial run or roll back. The rollback CLI reads the plan from the saved
snapshot unless `--plan` is explicit. A new plan requires a new dry-run and directory.

With `CONTENT_DATABASE_URL` already set to the intended environment, run:

```sh
LC_ALL=C LANG=C ~/.pi/agent/bin/memguard -- node scripts/content/consolidate-clusters.mjs --run-dir /tmp/lv-consolidation-staging
LC_ALL=C LANG=C ~/.pi/agent/bin/memguard -- node scripts/content/consolidate-clusters.mjs --run-dir /tmp/lv-consolidation-staging --apply
LC_ALL=C LANG=C ~/.pi/agent/bin/memguard -- node scripts/content/consolidate-clusters.mjs --run-dir /tmp/lv-consolidation-staging --rollback
LC_ALL=C LANG=C ~/.pi/agent/bin/memguard -- node scripts/content/consolidate-clusters.mjs --run-dir /tmp/lv-consolidation-staging --rollback --apply
```

Default execution and `--rollback` without `--apply` write nothing, including no
files. Dry-run prints candidate payloads and redirects for inspection. Apply saves
all affected entries and their revision history before any DB write, publishes
each primary through the existing `gateContent` API, then uses `adminAction` to
unpublish its secondaries. Gate rejection stops the operation while keeping that
cluster's secondary rows published. Earlier completed clusters remain applied and
can be restored with the same rollback command. Store revision checks reject
intervening edits. Repeated apply/rollback reuse store idempotency keys.

Rollback restores exact live JSON payloads, visibility and ordering through the
store. It preserves immutable revision/submission/action history and advances
revision counters; it does not erase the audit trail. A rolled-back run cannot be
applied again: start a new directory. The snapshot includes the original entries
and revisions for inspection.

The tool deliberately supplies an empty propagation environment to the gate:
model review/repair and all content checks run, while deploy hooks and Slack are
deferred. Published gate submissions remain propagation-pending. The tool itself
does not rebuild the site, deploy or contact Slack. Do not use `--gate-script`
outside local tests; the gate itself refuses that seam on production.

Parent sequence, staging first:

1. Get `source-data.json` from the read-only VM run.
2. Confirm or replace each primary using 28-day clicks/impressions and shared
   query intent; record the metrics in the data file.
3. Flip `confirmed: true` in a small follow-up PR, rerun tests, then deploy the
   redirects while all originals are still live. Check each confirmed source is
   a 301 and its primary is a 200. If confirming fitness retires
   `/guide/fitness-guide`, re-point the existing running-routes blog redirect to
   the confirmed fitness primary in that same follow-up PR to avoid a chain.
   Until then its target stays `/guide/fitness-guide`, which has running routes.
4. Pause automated content writers/reconcilers, inspect dry-run candidates and
   run the tool on staging. Rebuild/export with redirects deployed and verify
   retained content, exports and sitemap. Reconcile propagation-pending
   submissions through the normal parent deployment flow. Exercise rollback on
   staging, then repeat on production only with John's exact-action go, matched
   production credentials and a separate retained directory such as
   `/tmp/lv-consolidation-production`.

For recovery, restore DB rows first, rebuild/export with redirects still deployed,
then remove cluster redirects and redeploy. This keeps every old URL reachable.
Production script invocations are the same four commands above with the separate
production directory and production-bound environment.

Local acceptance uses throwaway `lv_test_*` databases created through
`postgres://postgres@127.0.0.1:55432/postgres`, because the existing `openDb` target
binder intentionally refuses the admin database itself. Run:

```sh
CONTENT_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres LC_ALL=C LANG=C ~/.pi/agent/bin/memguard -- node --test --test-concurrency=1 tests/content/consolidate-clusters.test.mjs
```

The project verify script runs this suite with a local site URL: unconfirmed
sources must return no redirect, confirmed sources must return a 301, and every
primary must return 200. Isolated Next config fixtures exercise one confirmed
cluster and all confirmed clusters without changing the deployed plan. Operational
fixture clusters are synthetic and independent of the editorial choices.
