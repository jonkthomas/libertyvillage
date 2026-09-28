# Content store operations

## Bind the target

Use `CONTENT_DATABASE_URL` for pooled reads and writes and `CONTENT_DATABASE_URL_UNPOOLED` for migration or reset. Set `CONTENT_DB_NAME` and `CONTENT_TARGET` to the same database and target as the URL (`neondb`/`production` or `lv_staging`/`staging`). The CLI refuses a mismatched database. For production, set `CONTENT_SITE_URL=https://libertyvillage.co`. Keep credentials in the environment, never in a shell command or log.

For staging UAT in zsh, load the local env file on every invocation and supply an operator actor:

```zsh
content() { local verb=$1; shift; node --env-file=.env.content-staging.local scripts/content/cli.mjs "$verb" --actor uat:operator "$@"; }
export CONTENT_TARGET=staging CONTENT_DB_NAME=lv_staging
```

The CLI prints a target header to stderr and a single JSON result to stdout. Exit 0 means success, 2 means validation/conflict or another expected negative outcome, 3 means published with propagation pending, and 1 means an operational error. `--actor` is required outside GitHub Actions. All mutating submission commands require `--idempotency-key`.

## Migrate, seed, and compare

```
npm run content -- migrate --expect-db lv_staging --target staging
npm run content -- seed --from-ref <staging-sha> --apply --prune --expect-db lv_staging --target staging --actor operator
npm run content -- verify-parity --from-ref <staging-sha> --expect-db lv_staging --target staging
npm run content -- export --root /tmp/lv-content-export --with-assets --expect-db lv_staging --target staging
```

`seed` without `--apply` is a dry run. A seed never overwrites a key with a newer non-seed revision. Review `refused` before continuing. `--prune` unpublishes absent keys only when all their revisions are seed-owned. `verify-parity` compares all nine datasets, ordered record hashes, digests, and serialized bytes. To seed production, bind `neondb`/`production`, use the main SHA, and have the integration owner coordinate the operation. Do not run a production reset; it is rejected by the CLI.

`CONTENT_SOURCE=db` builds must bind to the environment: production Vercel to `neondb`, staging preview to `lv_staging`, or local `CONTENT_BUILD_TARGET=test` to a local `lv_test_*` database. A failed read or validation stops the build; the previous deployment remains. JSON mode writes only `public/content-snapshot/build.json` and makes no DB connection. DB mode writes nine canonical data files, public snapshot copies, a manifest, and verified content-addressed media. `public/content-snapshot/` and local export/restore manifests are ignored by git.

## Recovery and audit

```
npm run content -- list --submissions --state rejected,blocked --expect-db lv_staging
npm run content -- history --dataset businesses --key <slug> --expect-db lv_staging
npm run content -- stats --alert --expect-db lv_staging
npm run content -- gc-assets --expect-db lv_staging
```

`gc-assets` is a dry run unless `--apply`. It reclaims only assets referenced solely by never-published terminal revisions older than 14 days, and never an asset referenced by a published revision or current live record. Run `stats --alert` weekly; the alert threshold is 350 MB of a 512 MB budget. Published revisions are immutable and remain rollback targets. Unpublish and rollback create audit actions and an admin submission for propagation. They require an actor, reason, and idempotency key. Unpublish refuses to empty a dataset, and guide-hub/topic-queue unpublish is forbidden.

## L2 pinned snapshot drill

Fetch a deployment's public manifest, all nine files, and its media through the pinned fetch. It verifies each file hash and dataset digest, every media hash and byte size, then re-reads the manifest. If deployment or snapshot identity changed it retries up to three times; a failed fetch installs nothing. Restore preserves the source manifest locally at `.content-restore/manifest.json`.

```
# Run in a fresh worktree with DB URL variables unset.
env -u CONTENT_DATABASE_URL -u CONTENT_DATABASE_URL_UNPOOLED node scripts/content/cli.mjs restore-snapshot --from "$ALIAS" --root /tmp/lv-content-restore
L2_MANIFEST=/tmp/lv-content-restore/.content-restore/manifest.json
L2_SOURCE=$(jq -r .deployment_url "$L2_MANIFEST")
env -u CONTENT_DATABASE_URL -u CONTENT_DATABASE_URL_UNPOOLED CONTENT_SOURCE=json npm run build
node scripts/content/parity-crawl.mjs crawl --base http://localhost:3200 --media --manifest "$L2_MANIFEST" --out /tmp/l2-local.json
node scripts/content/parity-crawl.mjs crawl --base "$L2_SOURCE" --bypass-env CONTENT_SITE_BYPASS --remap-origin https://libertyvillage.co --media --manifest "$L2_MANIFEST" --out /tmp/l2-source.json
node scripts/content/parity-crawl.mjs compare /tmp/l2-source.json /tmp/l2-local.json
```

For a local restore build, set `CONTENT_SOURCE=json`; never use the DB build flag during the L2 drill. The manifest is live-only and carries no draft, verdict, gate context, or private evidence. A media hash failure or identity drift invalidates the drill.

For a real L2 rollback, restore into the fresh rollback worktree and stage the verified files with `git add data/` and `git add -f public/media/` before committing. `/public/media/` remains ignored so normal writer checkouts cannot commit generated build output.
