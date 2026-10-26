# Cluster consolidation

`consolidation-clusters.json` owns membership, the primary and the useful sections
to retain from every member. `next.config.ts` derives exact 301s from it. Changing
a primary is a data-file edit; the matching redirects change with it. The HTTP
test checks every source, destination existence and absence of chains.
The optional `imageFrom` selects an existing image from another cluster member;
the restaurant primary uses this because its legacy image file is absent.

The initial choices are **PROVISIONAL**. Confirm primaries from
`source-data.json` (GSC 28d) before the post-merge apply. That evidence must also
be checked before deploying redirects: compare page clicks first, impressions
second, and inspect the shared query rows for matching intent. Fill the per-member
28-day metrics and update the plan's evidence/status. Missing GSC rows are unknown,
not zero. World Cup posts remain live.

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

1. Confirm the provisional choices/metrics, rerun tests, and deploy redirects while
   all original content is still published. Check each source is a 301 and each
   primary is a 200. Keep automated content writers/reconcilers paused throughout
   the operational window.
2. Inspect dry-run candidates, apply, then rebuild/export from that database with
   the redirects still deployed. Check the retained content on each primary and
   absence of secondaries from the fresh content export/sitemap. Reconcile the
   propagation-pending submissions through the normal parent content deploy flow.
3. Exercise rollback on staging: restore DB rows first, rebuild/export while
   redirects remain deployed, then remove cluster redirects and redeploy. This
   ordering keeps every old URL reachable throughout recovery.
4. Only after staging passes, obtain John's exact production-action approval and
   repeat with production credentials and a separate retained run directory (for
   example `/tmp/lv-consolidation-production`). Never substitute credentials across
   environments. Production script invocations are the same four commands above
   with that directory and the production-bound environment.

Local acceptance uses throwaway `lv_test_*` databases created through
`postgres://postgres@127.0.0.1:55432/postgres`, because the existing `openDb` target
binder intentionally refuses the admin database itself. Run:

```sh
CONTENT_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres LC_ALL=C LANG=C ~/.pi/agent/bin/memguard -- node --test --test-concurrency=1 tests/content/consolidate-clusters.test.mjs
```

The project verify script also runs this suite with a local site URL so every
configured 301 and 200 destination is exercised. Operational fixture clusters are
synthetic and independent of the editorial choices.
