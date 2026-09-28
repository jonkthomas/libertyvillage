# Spec: Neon content store for libertyvillage.co (r2)

Status: r3, awaiting focused independent recheck. r2 at 29740db was REJECTED for one `json` trigger blocker and three bounded harness/cutover/L2 runbook gaps (report: `/private/tmp/lv-neon-review/spec-recheck-r2.md`). This revision corrects those contracts under owner decisions D1–D3; it is not approved until the recheck covers these exact bytes.
Repo `jonkthomas/libertyvillage`, build base `origin/staging` @ `1a651b3`, Next.js 16.1.6 on Vercel. Plan only: no code, DB or settings change.

## 1. Outcome, decisions, non-goals

**Outcome.** Content publishes with a DB transaction after the existing automated gate: Opus review, pass = numeric `overall ≥ SCORE_THRESHOLD` (8) and no critical/high finding, plus the bounded fixer (`MAX_REPAIRS`=3). There is no PR, merge or promotion. The page goes live within minutes via a Vercel deploy hook. Gate failures stay unpublished and notify Slack. Each successful publish posts a Slack line (title + URL). Delivery is at-least-once, keyed by a stable `#<submissionId>` (§4.6 g8).

**Binding decisions**

- **D1, read path = build-time export.** Publish = DB transaction + `POST CONTENT_DEPLOY_HOOK_URL` of the target. `prebuild` (`scripts/content/build-export.mjs`) writes live DB content into the build workspace as canonical `data/*.json`, plus `public/media/**` and `public/content-snapshot/**`.
  - **`lib/data.ts`, `lib/links.ts`, pages and components stay unchanged and synchronous.** There is no runtime DB read, `unstable_cache`, `revalidateTag`, revalidate route or media route.
  - DB down → the prebuild fails → the previous deployment keeps serving.
  - In json mode the prebuild opens no DB connection. It writes only `public/content-snapshot/build.json` (deployment identity, §4.3).
- **D2.** The 4 businesses, 7 topic-queue entries, 7 discovery-seen entries and 4 images stranded on `staging` already passed the Opus gate (#168, #170, #171). They go live with the code promotion staging→main and are seeded from that exact main SHA, with **no re-gate**.
- **D3.** Cut the `content-mirror` branch, `content-admin.yml` and a generic events table. The VM keeps its GitHub transport and reads the public `/content-snapshot/*`. SEO v1 is data-only via the DB, with a separate code-only lane; mixed output is blocked. The legacy path stays behind `LV_CONTENT_STORE=git|db` until cutover. Locked evals (`evals/*.sha256`) stay byte-identical; DB-mode acceptance evals are new files.
- **No production-main change for UAT.** Nothing is merged to `main` only to enable staging acceptance. Pre-cutover staging ingest acceptance uses the host-local harness (§4.10), and the GitHub-transport leg is checked at cutover gate S11c.

**History scope.** Every site-dataset and topic-queue record has revision history (`content.revisions` + `content.actions`). `discovery_seen` is insert-only operational memory. Its only mutable field, `outcome`, records the submission that set it. It has no revision history by design.

**Non-goals (v1):** admin UI or workflow (the CLI is the surface); changes to URLs, templates, `lib/meta.ts` or `lib/schema.ts`; moving `public/images/**` (it stays in git); retiring the legacy machinery (§7.4).

## 2. Verified current state (authoritative for builders; rechecked at 3144e3e)

**Readers.** `lib/data.ts` `loadJSON` reads 7 files: services, topics, neighborhoods, businesses, posts, buildings and guide-hub. No other code under `app/`, `lib/` or `components/` reads `data/`. `Neighborhood.image?` (`lib/types.ts:86`) is rendered by `app/vs/[neighborhood]/page.tsx:83-85`.

**Canonical form.** Files already in `JSON.stringify(x,null,2)+'\n'` form: businesses, posts, topics, topic-queue, discovery-seen. Neighborhoods is canonical but lacks the trailing `\n`. Services, buildings and guide-hub are not canonical. **A normalizes all 9** in one code-flow commit with a `JSON.parse` deep-equal proof, so "export == source" is byte equality everywhere.

**Keys.** Site arrays use `slug`. `guide-hub` is a slug-less singleton (`lib/types.ts:144`). topic-queue is `{version:1,topics}`, keyed by `topics[].key` = `topicKey(kind,title,branchPrefix)` (`scripts/automation/topic-queue.mjs:57`, 64-hex). discovery-seen is a key-sorted map `norm(name)→"YYYY-MM-DD"` (`discover-businesses.mjs:101-111`). Zero results write nothing (`:286-289`).

**Gate functions (exact)**

| function                                                   | contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflightDecision` (`preflight.mjs:142`)                  | `({verdict, contentSha, attempts, maxRepairs, kind, changedFiles}) → 'go'\|'block'\|'unrepairable'\|'repair'`. Calls `evaluateVerdict`, then `classifyFindings` (`:118`). Repairability comes from `KIND_POLICIES[kind].repairablePaths`. topic-discovery is `noFixer`.                                                                                                                                                                                                                                                                                                           |
| `validateRecordRepair` (`preflight.mjs:39`)                | `(file, orig, repaired, {maxBytes=60_000}) → {ok, errors, changedFields}`. Explicit rules only for posts, businesses and topics (`RECORD_FILES`). Others get the default (slug immutable).                                                                                                                                                                                                                                                                                                                                                                                        |
| `review-agent.planRecordRepair` (`:426`, not exported)     | `({kind, gateVerdict, payload:[{file,records}], validate, references, inventory, lintFindings}) → {plan, check, attempts, bytes}`. `validate(plan)` returns `{ok, errors}`. `isRecordRepairPlan` checks only `plan_type` (`record-repair.mjs:84`).                                                                                                                                                                                                                                                                                                                                |
| `evaluateRepairProgress` (`recovery.mjs:182`)              | `({history:[{attempt, overall, blockingCount}]}) → {decision, reason}`. It compares the last two rounds only, so the **current** round must be in `history`.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `evaluateVerdict` (`policy.mjs:275`)                       | `(raw, sha) → {ok, passed, errors, hasBlocking}`. `overall` is any number 0–10.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `lintPost` / `resolveLintMode` (`blog-lint.mjs:405`/`:25`) | `(post, {businesses, now}) → {ok, findings}` / `(env) → fail\|warn`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `validateSubmittedPost` (`pi-session.mjs:35`)              | `(post, topic, submittedTopicKey, {now})`: field allowlist, author, `publishedAt=updatedAt=`UTC run date, tags 4–6, faqs 4–5, takeaways 4–6, topic binding. Its only caller is the VM (`:402`).                                                                                                                                                                                                                                                                                                                                                                                   |
| news checks                                                | `validateDraft({post, newsArticleStructuredData, evidencePack, siteIndex, nowMs, imageExists})` (`draft-validate.mjs:509`), then `evaluatePublishReadyDraft({validation, post, root, nowMs, posts, imageExists, config: AUTO_PUBLISH_CONFIG})` (`publish-gate.mjs:465`). `news-preflight.mjs:176` passes `newsArticleStructuredData: structuredData(post)` (private, `:68-74`) and trims evidence with private `trimEvidence` (`:53`). `publish.mjs` writes `<out>/result.json` (`now`, `clusterId`, `slug`, `published`) and `<out>/evidence-<clusterId>.json` (`:300`, `:410`). |
| `inventoryFromData` (`review-agent.mjs:173`)               | `({services, topics, posts, blogImages, neighborhoodImages, ogImages, images})`. `selectReferenceRecords` is in `scripts/lib/referenced-businesses.mjs`.                                                                                                                                                                                                                                                                                                                                                                                                                          |

`review-agent.mjs` runs its CLI on import (`:540-555`). `MAX_FIXER_ATTEMPTS`=4 is at `:67`. Locked eval `full-autonomous-loop.eval.mjs` checks these invariants:

- `recordRepairPrompt`…`planRecordRepair` matches `/remov|delet/`, a never-substitute phrase and `UNTRUSTED_REFERENCE_DATA` (`:399-408`).
- `review(`…`reviewContent` matches `merge_base|mergeBase` (`:741-744`).
- There is no literal `>= 8` in the file (`:287`).

These are invariants, not byte locks. `SECRET_FINGERPRINT` (`pi-session.mjs:9`) is not exported.

**Ingest and VM.**

- `validateIngestPayload` allows only `kind, data_sha, data_branch, topic_key, regenerations`.
- On main **and** staging, `supervisor-ingest.yml` is repository_dispatch only, with top-level permissions contents/pull-requests/issues/actions write.
- Job `ingest` has `needs: resolve-owner`, `if: owner=='exedev'` (`:35-37`), checks out `main`, runs `promotion-control.mjs --content-ship` (`:66-70`), binds `GH_TOKEN: ${{ github.token }}` per step (`:96,131,136`), has a 10 min timeout and no `record-candidate-outcome` step.
- Candidate outcomes are recorded **VM-side** (`host-run.mjs:137-143`; `consumeIntent` `:418-424` records `PUBLISHED_MAIN`).
- The VM is started by `node scripts/supervisor/cli.mjs run` (`systemd/lv-supervisor.service`), with `LV_STATE_DIR`, `LV_LEDGER` and `LV_GITHUB_REPOSITORY`.
- `host-run` diffs against `origin/staging`. Its history is `branchPublicationHistory(git,'origin/main')` (`:402`).
- `ops/exedev-supervisor/owner.txt` = `exedev` on main and staging, so the weekly-blog DB lane is dormant.
- Locked evals regex `host-run.mjs`, `supervisor-ingest.yml`, `autonomous-coordinator.yml` and `weekly-blog.yml`, so all edits to them are additive.

**Dispatch.** `main` has `workflow_dispatch` on discover-businesses, weekly-topic-discovery, news-autopublish, weekly-seo-improvements and weekly-blog. It has **none** on supervisor-ingest. GitHub requires a workflow's `workflow_dispatch` trigger on the default branch, so staging-ref dispatch of ingest is impossible before cutover promotion. [GitHub events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)

**SEO.**

- The existing guard excludes `^tasks/seo-(improve-(summary\.md|runs/)|scores\.json)` (`weekly-seo-improvements.yml:137`).
- It forbids `next.config.ts|vercel.json|package(-lock)?.json|tsconfig*|eslint*|.github/|scripts/`.
- It counts only `app|components|data|lib|public`.
- The orchestrator always writes `tasks/seo-improve-summary.md` and `tasks/seo-improve-runs/<date>.json` (`seo-improve-agent.js:233-240`).

## 3. Schema (A: `scripts/content/migrations/0001_content.sql`)

Neon project `lib_village`, PG 18. `neondb` = production and `lv_staging` = staging, with an identical `content` schema applied by `content migrate` over `CONTENT_DATABASE_URL_UNPOOLED`. Payloads are `json`, not `jsonb`, to keep key order.

```sql
create schema if not exists content;
create table content.schema_migrations (version text primary key, applied_at timestamptz not null default now());
create table content.meta (id boolean primary key default true check (id), live_seq bigint not null default 0);
insert into content.meta default values;
create table content.entries (
  dataset text not null check (dataset in ('businesses','posts','buildings','neighborhoods','services','topics','guide-hub','topic-queue')),
  key text not null, position integer,              -- NULL until first publish; max+1 under the dataset lock
  live_rev integer, head_rev integer not null default 0,   -- live_rev is the ONLY visibility bit
  first_published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (dataset, key),
  constraint entries_key_shape check ((dataset='guide-hub' and key='guide-hub') or (dataset='topic-queue' and key ~ '^[0-9a-f]{64}$')
    or (dataset not in ('guide-hub','topic-queue') and key ~ '^[a-z0-9][a-z0-9-]{0,127}$')),
  constraint entries_position unique (dataset, position) deferrable initially deferred,
  check (live_rev is null or position is not null));
create table content.submissions (
  id bigserial primary key,
  kind text not null check (kind in ('seed','business','blog','blog-live','news','seo','topic-discovery','manual','admin')),
  target text not null check (target in ('production','staging','test')),
  actor text not null, idempotency_key text not null unique, request_sha256 text not null,
  base_snapshot_id text,            -- export manifest the writer generated from (§4.3)
  context json,                     -- PRIVATE gate inputs (§4.4); never exported
  state text not null check (state in ('open','gating','published','rejected','blocked','error','compensated')),
  decision text,  -- go|validation|lint|conflict|unrepairable|exhausted|not-converging|block|smoke-failed|error|admin
  round integer not null default 0, repairs integer not null default 0, claim_token uuid, claimed_until timestamptz,
  live_seq bigint, deploy_requested_at timestamptz, smoke_passed_at timestamptz, notified_at timestamptz,
  created_at timestamptz not null default now(), closed_at timestamptz);
create table content.revisions (
  dataset text not null, key text not null, rev integer not null,
  payload json not null, payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('seed','writer','fixer','rollback','manual')),
  actor text not null, submission_id bigint references content.submissions(id),
  parent_rev integer, published_at timestamptz,   -- set once (NULL -> ts) by the publishing tx; rollback targets need NOT NULL
  created_at timestamptz not null default now(),
  primary key (dataset, key, rev), foreign key (dataset, key) references content.entries (dataset, key));
alter table content.entries add constraint entries_live_fk foreign key (dataset, key, live_rev)
  references content.revisions (dataset, key, rev) deferrable initially deferred;
create table content.submission_items (
  submission_id bigint not null references content.submissions(id), dataset text not null, key text not null,
  op text not null check (op in ('insert','update','unpublish','rollback','compensate')),
  expected_live_rev integer,   -- base-snapshot rev (NULL = insert); compared IS NOT DISTINCT FROM
  published_rev integer,       -- live_rev this submission set; NULL for unpublish / compensation of an insert
  smoke text check (smoke in ('passed','superseded')),
  primary key (submission_id, dataset, key));
create table content.gate_rounds (
  submission_id bigint not null references content.submissions(id), round integer not null,
  candidate_digest text not null,  -- sha256 of sorted "dataset\tkey\trev\tpayload_sha256" lines
  content_sha text not null check (content_sha ~ '^[0-9a-f]{40}$'),
  verdict json, overall numeric(4,2), passed boolean not null, blocking_count integer not null default 0,
  lint json, decision text not null, scripted boolean not null default false,
  created_at timestamptz not null default now(), primary key (submission_id, round));
create table content.round_items (  -- immutable candidate vector per round
  submission_id bigint not null, round integer not null, dataset text not null, key text not null,
  rev integer not null, payload_sha256 text not null, primary key (submission_id, round, dataset, key),
  foreign key (dataset, key, rev) references content.revisions (dataset, key, rev));
create table content.actions (      -- only what revisions cannot express
  id bigserial primary key, at timestamptz not null default now(), actor text not null,
  action text not null check (action in ('unpublish','rollback','compensate','reconcile')),
  dataset text not null, key text not null, from_rev integer, to_rev integer,
  submission_id bigint, reason text not null, live_seq bigint not null);
create table content.discovery_seen (
  name_key text primary key, first_seen date not null,
  outcome text not null default 'seen' check (outcome in ('seen','added','rejected')),
  outcome_submission_id bigint references content.submissions(id), created_at timestamptz not null default now());
create table content.assets (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  path text not null unique check (path ~ '^/media/[0-9a-f]{16}/[a-z0-9][a-z0-9._-]{0,120}\.(jpg|png|webp)$'),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  bytes bytea not null, byte_size integer not null check (byte_size between 1 and 2000000),
  submission_id bigint references content.submissions(id), created_at timestamptz not null default now());
```

**Triggers (A, `0001`)**

- `revisions` BEFORE UPDATE allows exactly one change:
  - `OLD.published_at IS NULL AND NEW.published_at IS NOT NULL`;
  - `current_setting('content.publishing', true) = 'on'`;
  - `NEW.payload::text IS NOT DISTINCT FROM OLD.payload::text` (the `json` type has no equality operator; text equality preserves key order and bytes), and each other non-`published_at` column is explicitly compared with `IS NOT DISTINCT FROM OLD`.

  Anything else raises `revision-immutable`. BEFORE DELETE raises. Real-trigger tests include a reordered-key payload with the session flag on; `jsonb` comparison is forbidden.

- Only `publishSubmission` sets `SET LOCAL content.publishing = 'on'`. Seed and rollback **insert** revisions with `published_at` already set.
- `gate_rounds`, `round_items` and `actions`: BEFORE UPDATE OR DELETE raises.
- `entries` and `discovery_seen`: BEFORE DELETE raises. Only `content reset` drops the schema.

**Derived states**

- An entry is _live_ iff `live_rev is not null`. It is _unpublished_ iff it is not live but has a revision with `published_at`. Otherwise it is _never published_.
- Submission states: `open→gating→published(→compensated)` or `gating→rejected|blocked|error`. `admin` submissions are created `published`.
- A live entry's `live_rev` changes only at publish, admin action or compensation. A rejected edit leaves the old revision live and is listed by `content list --submissions --state rejected,blocked`.

**Registry** `lib/content/datasets.json` (scripts only, `with {type:'json'}`):

| dataset        | file                | key                           | route             | smoke adapter / marker (HTML-escaped)    | image fields |
| -------------- | ------------------- | ----------------------------- | ----------------- | ---------------------------------------- | ------------ |
| businesses     | businesses.json     | slug                          | `/directory/:key` | page / `name`                            | `image`      |
| posts          | posts.json          | slug                          | `/blog/:key`      | page / `title`                           | `image`      |
| buildings      | buildings.json      | slug                          | `/buildings/:key` | page / `name`                            | `image`      |
| neighborhoods  | neighborhoods.json  | slug                          | `/vs/:key`        | page / `name`                            | `image`      |
| services       | services.json       | slug                          | `/best/:key`      | page / `pluralName`                      | `image`      |
| topics         | topics.json         | slug                          | `/guide/:key`     | page / `title`                           | `image`      |
| guide-hub      | guide-hub.json      | singleton `guide-hub`         | `/guide`          | page / first 60 chars of `answerSummary` | —            |
| topic-queue    | topic-queue.json    | `key` in `{version:1,topics}` | —                 | snapshot                                 | —            |
| discovery-seen | discovery-seen.json | map key (sorted)              | —                 | snapshot                                 | —            |

## 4. Contracts

### 4.1 Canonical helpers and validators (A: `canonical.mjs`, `validate.mjs`)

- `recordSha(r)=sha256(JSON.stringify(r))`.
- `datasetDigest(d,records)=sha256(records.map(r=>keyOf(d,r)+':'+recordSha(r)).join('\n'))`. For discovery-seen it runs over sorted `name:date` pairs.
- `blobSha1(t)=sha1("blob "+byteLen+"\0"+t)`.
- `serialize(d,records)` returns the canonical file text in its original shape.

**`validateRecord(dataset, key, record) → {ok, errors}`** checks storage validity only. It applies to every write, including historical manual/SEO edits.

- **Identity:** `record.slug===key`. guide-hub must have no `slug` and key `guide-hub`. topic-queue requires `record.key===key` and, for inserts, `key===topicKey(kind,title,branchPrefix)`.
- **Fields:** required fields and types from `lib/types.ts`, plus the queue schema `key, kind∈{blog,seo}, title, source, rationale, addedAt, attempts, branchPrefix`.
- **Allowlist:** type fields plus keys observed at seed (`_discoveredAt`, `_needsEnrichment`). An unknown field fails.
- **Budget and safety:** ≤ 200 KB. `validate.mjs` exports `SECRET_FINGERPRINT` as a byte copy of `pi-session.mjs:9`. `validate.test` asserts that the regex source equals the one parsed from `pi-session.mjs` text.

### 4.2 Store API (A: `scripts/content/store.mjs`, `pg`; each mutator = one transaction)

Every claimed mutator first runs `SELECT … FROM submissions WHERE id=$1 FOR UPDATE` and requires `claim_token=$token AND claimed_until>now()` (else `ClaimError('lease-lost')`) and its state/round preconditions (else `StateError`).

```js
openDb({unpooled=false, expectDb}) -> {query, tx(fn,{isolation}), close, dbName, target}
  // TargetError unless current_database()===expectDb and dbName ∈ {neondb→production, lv_staging→staging,
  // lv_test_* on host 127.0.0.1|localhost (any port)→test}. Never reads DATABASE_URL/POSTGRES_*/PG*. connect 10s, statement_timeout 30s.
readLive(db, {datasets=ALL}) -> Snapshot        // one REPEATABLE READ READ ONLY tx
  // {schema:1, db, target, live_seq, snapshot_id:<40-hex sha1(live_seq+digests)>, generated_at,
  //  datasets:{[d]:{count, digest, entries:{[key]:{rev, sha}}, records}}, media:[{path, sha256, byte_size}]}
resolveAssets(db, [{sha256}]) -> [{sha256, path|null}]
createSubmission(db, {kind, target, actor, idempotencyKey, baseSnapshotId, context,
    items:[{dataset,key,op,payload,expectedLiveRev}], assets:[{sha256,path,contentType,bytes}], discoverySeen:[{nameKey,firstSeen}]})
  -> {submissionId, existing, items:[{dataset,key,op,rev,expectedLiveRev}], discoverySeenAdded}
  // Same key + same request_sha256 -> existing:true, no writes; different sha -> StateError('idempotency-mismatch').
  // Entries inserted if absent, then SELECT … ORDER BY dataset,key FOR UPDATE; rev=head_rev+1.
  // Precheck live_rev IS NOT DISTINCT FROM expectedLiveRev, else ConflictError{conflicts}, nothing written.
  // Writes revisions (source writer|manual, parent_rev=expected, published_at NULL), submission_items, round-0 round_items;
  // assets ON CONFLICT (sha256) DO NOTHING; discovery_seen ON CONFLICT DO NOTHING.
claimSubmission(db, id, {owner, leaseSeconds=900}) -> {token}      // ClaimError if held and unexpired
renewClaim(db, id, token, {leaseSeconds=900})                       // called at every phase boundary and every 5 min while waiting
releaseClaim(db, id, token)
getSubmission(db, id) -> {submission, items, rounds:[{…, items:[{dataset,key,rev,payload,payload_sha256}]}]}
recordRound(db, id, token, {round, contentSha, candidateDigest, verdict, overall, passed, blockingCount, lint, decision, scripted})
  // Preconditions: state open|gating, round===submissions.round, row absent (else StateError('round-recorded')).
  // open->gating. If decision is terminal (validation|lint → rejected; unrepairable|exhausted|not-converging|block → blocked)
  // the SAME tx sets state, submissions.decision, closed_at and discovery_seen outcome 'rejected'.
addRepairRound(db, id, token, {fromRound, repairs:[{dataset,key,payload}]}) -> {round, items}
  // Needs gate_rounds(fromRound).decision==='repair', fromRound===submissions.round, and no rows for fromRound+1.
  // Writes fixer revisions and round fromRound+1's vector = previous with repaired entries replaced; round+=1, repairs+=1.
publishSubmission(db, id, token, {actor}) -> {liveSeq, published:[{dataset,key,op,rev}], existing}
  // state published -> {existing:true}, no writes. Otherwise: (1) state gating, claim valid;
  // (2) latest round passed && decision 'go' && candidate_digest recomputed from round_items matches;
  // (3) pg_advisory_xact_lock(hashtext('content:'||dataset)) sorted, then entries ORDER BY dataset,key FOR UPDATE;
  // (4) every live_rev IS NOT DISTINCT FROM expected_live_rev, else ConflictError (tx rolls back);
  // (5) SET LOCAL content.publishing='on'; revisions.published_at=now() WHERE published_at IS NULL; live_rev:=round rev;
  //     insert position=coalesce(max,-1)+1; published_rev; meta.live_seq+=1 -> submissions.live_seq; state published.
rejectSubmission(db, id, token, {state:'rejected'|'error', decision})   // conflict at publish, or error; discovery_seen 'rejected'
markPhase(db, id, token, 'deploy_requested'|'smoke_passed'|'notified')  // sets the timestamp once; replay is a no-op
markItemSmoke(db, id, token, [{dataset,key,smoke:'passed'|'superseded'}])
compensateSubmission(db, id, token, {actor, reason}) -> {adminSubmissionId, adminToken, liveSeq, reverted:[{dataset,key,fromRev,toRev}]}
  // Publish's locks; only if EVERY item live_rev===published_rev: restore expected_live_rev (NULL for insert),
  // actions('compensate'), live_seq+=1, state compensated, and an 'admin' submission (op compensate,
  // published_rev = restored rev) that carries propagation. Else ConflictError{conflicts}, nothing changes.
adminAction(db, {op:'unpublish'|'rollback', dataset, key, toRev, actor, reason, idempotencyKey, owner})
  -> {submissionId, token, existing, liveSeq, fromRev, rev}
  // Same idempotency rules as createSubmission. Locks as publish. unpublish: entry live; refused for topic-queue and guide-hub,
  // and ValidationError('dataset-would-be-empty') if it would leave 0 live entries. rollback: toRev.published_at NOT NULL,
  // refused for topic-queue; inserts a copy as a new rev (source 'rollback', published_at=now()).
  // Writes actions row, admin submission (state published, decision 'admin', claimed by owner), one item, live_seq+=1.
history(db, {dataset,key}) -> {entry, revisions:[{rev,source,actor,submissionId,payloadSha256,publishedAt,createdAt,live}], actions}
listSubmissions(db, {state, kind, target, dataset, key, since}) -> [{id,kind,state,decision,round,repairs,createdAt,closedAt,items:[{dataset,key,op}]}]
listPending(db, {target}) -> [ids]   // state published AND (smoke_passed_at IS NULL OR notified_at IS NULL), oldest first
listEntries(db, {dataset, visibility:'live'|'unpublished'|'never'|'all'}) -> [{dataset,key,liveRev,headRev,position}]
markDiscoverySeen(db, nameKeys, {outcome:'added'|'rejected', submissionId})   // seen -> added|rejected only
stats(db) -> {databases:{[name]:bytes}, projectBytes, assets:{count, bytes, reclaimable}}
```

Error classes carry `.code`: `TargetError`, `ConflictError`, `StateError`, `ClaimError`, `ValidationError`. The CLI exits 2 for Conflict/Validation and 1 for the others.

### 4.3 Export, build-export, snapshot (A)

`content export --root <dir>` writes one `readLive` snapshot:

```
<dir>/data/{businesses,posts,buildings,neighborhoods,services,topics,guide-hub,topic-queue,discovery-seen}.json  (canonical)
<dir>/.content-export/manifest.json          (Snapshot minus records: the submit baseline, §4.4; .gitignore'd by A)
<dir>/public/media/<sha16>/<file>            (only with --with-assets)
```

**Build export.** `package.json` gets `"prebuild": "node scripts/content/build-export.mjs"`, and Vercel's `npm run build` runs it.

- **Identity, always.** It writes `public/content-snapshot/build.json` = `{deployment_url:"https://"+VERCEL_URL|null, git_sha:VERCEL_GIT_COMMIT_SHA|null, git_ref:VERCEL_GIT_COMMIT_REF|null, vercel_env, content_source}`. With `CONTENT_SOURCE≠db` it stops here and opens no connection. `public/content-snapshot/` is .gitignore'd.
- **Target binding** (`CONTENT_SOURCE=db`), else exit 1 before connecting:
  - `VERCEL=1` + `VERCEL_ENV=production` → `neondb`.
  - `VERCEL=1` + `VERCEL_ENV=preview` + `VERCEL_GIT_COMMIT_REF=staging` → `lv_staging`. A db-mode preview on any other branch exits 1.
  - `VERCEL` unset + `CONTENT_BUILD_TARGET=test` → an `lv_test_*` DB on 127.0.0.1|localhost.
  - Anything else (unset/unknown `VERCEL_ENV`, `development`, `CONTENT_BUILD_TARGET` with `VERCEL=1`) exits 1.
- **Reads:** pooled `CONTENT_DATABASE_URL`. 3 attempts total (waits 2s, 5s), each with a 10s connect and 30s statement timeout. No cache.
- **Failures:** any error, an empty site dataset or a `validateRecord` failure exits 1, so the build fails.
- **Writes:** `data/*.json` (all 9); `public/media/<sha16>/<file>` for `snapshot.media` (each byte sha256-checked); `public/content-snapshot/<file>` for all 9, byte-identical to `data/<file>`; and `public/content-snapshot/manifest.json` = Snapshot without records + build.json fields + `files:{[file]:sha256}`.
- The manifest is the public, live-only L2 backup. It carries no drafts, verdicts, evidence or `context`.

Media is served as static files by the Vercel CDN. The existing `vercel.json` immutable caching is safe because paths are content-addressed.

**Pinned fetch** (`scripts/content/snapshot-fetch.mjs`, A; used by VM, restore and smoke):

1. GET manifest M1, then each file and each `media` entry. Every file's sha256 must equal `M1.files`, and each dataset's `datasetDigest` must equal M1.
2. Media bytes must match `sha256` and `byte_size`.
3. GET manifest M2. Require `M2.deployment_url===M1.deployment_url && M2.snapshot_id===M1.snapshot_id`, else restart. At most 3 attempts, then `SnapshotError('identity-unstable')`.
4. Output goes to a temp dir and is renamed into place only when complete.

`parity-crawl crawl --media --manifest <verified-manifest-file>` uses that manifest's exact media path/sha256/byte_size inventory for either a JSON-mode local site or the pinned source deployment. It hashes bytes fetched from **both** origins, refuses a missing/mismatched asset, and includes snapshot/deployment identity in the crawl output. JSON-mode builds do not manufacture a DB manifest.

### 4.4 `content submit` (B: `submit.mjs`, `images.mjs`)

**Input modes**

- **`--dir <root>`** diffs `data/*` against `<root>/.content-export/manifest.json`, the immutable baseline, never the DB's current state.
  - An unchanged `recordSha` is **skipped**.
  - A changed sha becomes `update` with `expectedLiveRev` = the manifest rev. A new key becomes `insert` with NULL.
  - A manifest key missing from the workspace → `ValidationError` (no deletes). DB keys absent from the manifest are ignored.
  - `baseSnapshotId` = the manifest `snapshot_id`.
- **`--record-file f --dataset d --baseline <manifest>`** is a single record. The expected rev comes from the baseline (absent key = insert).

**Gate context.** Stored in `submissions.context` so every round and every resume uses identical inputs:

- `now`: `--generated-at` for blog-live, `result.now` for news, else submit wall time.
- blog-live: `topicKey`.
- news: `{clusterId, evidence}`.

**Kind policy** (checked before any write; the same checks rerun at round 0 of the gate and after every repair; generation checks apply only to kinds that create new automated posts):

| kind            | datasets / ops                                                                          | limits                                                                    | deterministic checks                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| business        | businesses insert, plus discovery-seen rows `outcome='seen'`                            | 1–25                                                                      | `validateRecord`, images                                                                                                                                                                                                     |
| blog            | posts insert                                                                            | exactly 1                                                                 | `validateRecord`, `lintPost(post,{businesses: live, now})` in `resolveLintMode` mode (today's `weekly-blog.yml:165` check), images                                                                                           |
| blog-live       | posts insert                                                                            | exactly 1                                                                 | as blog, plus `validateSubmittedPost(post, {key:topicKey}, topicKey, {now})`. Requires `--topic-key` and `--generated-at` (= commit time of `DATA_SHA`, `git show -s --format=%cI`), which must be within 36 h before submit |
| news            | posts insert                                                                            | exactly 1                                                                 | `validateRecord`, `lintPost`, `validateDraft` + `evaluatePublishReadyDraft` as below; image must be `/images/…` (no conversion)                                                                                              |
| topic-discovery | topic-queue insert                                                                      | 1–25                                                                      | `validateRecord`, duplicate key/title against the live queue                                                                                                                                                                 |
| seo             | services, topics, neighborhoods, buildings, guide-hub, businesses, posts; insert/update | ≤ 15 records, ≤ 2 inserts (**new DB policy**; the legacy rail caps files) | `validateRecord`, images                                                                                                                                                                                                     |
| manual          | one site record, insert/update                                                          | exactly 1                                                                 | `validateRecord`, images                                                                                                                                                                                                     |

**News inputs.** `--news-out <out_dir>` is required for news. Submit reads `<out_dir>/result.json`, which needs `published===1` and `slug` = the candidate slug, and `<out_dir>/evidence-<clusterId>.json`. The call is `validateDraft({post, newsArticleStructuredData: structuredData(post), evidencePack: evidence, siteIndex, nowMs: Date.parse(now), imageExists})`, then `evaluatePublishReadyDraft({validation, post, root, nowMs, posts: livePosts, imageExists, config: AUTO_PUBLISH_CONFIG})`, requiring `validation.ok && validation.publishReady && ready.ok`. Inputs:

- `root`: a temp `export --root` of the current live DB.
- `siteIndex`: `loadSiteLinkIndex(root)` minus the candidate slug.
- `imageExists`: `createLocalImageExists(<checkout>)`.
- `structuredData` and `trimEvidence` are the existing functions, made `export`ed in `news-preflight.mjs` (B; the keyword is the only edit).

**Images.** Checked for each registry image field. `sourceRef` = `origin/main` (production) or `origin/staging` (staging), which is the ref the target's deploy hook rebuilds. It is fetched immediately before submit. This proves the next rebuild contains the file, not what is deployed now; smoke checks the deployed bytes.

1. `/media/<sha16>/<f>` must exist in `content.assets`.
2. `/images/<p>` with a workspace file:
   - Its realpath must stay inside `<root>/public/images`.
   - If tracked at `sourceRef` with an identical git blob, it is unchanged.
   - Otherwise it becomes an asset:
     - magic bytes must be JPEG `FFD8FF`, PNG `89504E47` or WebP `RIFF…WEBP`, and size 1..2,000,000;
     - the name is sanitized to `[a-z0-9._-]`;
     - the path is `/media/<sha256[0:16]>/<name>`, or the existing path from `resolveAssets`;
     - the field is rewritten.
3. `/images/<p>` with no workspace file must be tracked at `sourceRef`, else `ValidationError('image-missing')`.

**Output:** `{"submissionId":17,"existing":false,"items":[{"dataset":"businesses","key":"wilbur-s-taco-shop","op":"insert","rev":1,"expectedLiveRev":null}],"assets":[{"sha256":"…","path":"/media/3f2a…/wilbur-s-taco-shop.jpg","deduped":false}],"discoverySeenAdded":1}`. Nothing to submit gives `{"submissionId":null,"reason":"no-changes"}` with exit 0.

### 4.5 CLI (A: `cli.mjs`; `submit|gate|deploy|unpublish|rollback` dynamic-import B's modules)

- `node scripts/content/cli.mjs <cmd>` writes one JSON line to stdout. stderr starts with `{"target":{"db":"…","host":"…"}}`.
- Exit codes: 0 ok; 2 expected negative (rejected, blocked, conflict, validation, compensated, smoke-failed); 3 published but propagation pending; 1 error.
- **Defaults:**
  - `--expect-db` defaults to `$CONTENT_DB_NAME`; mutators without either → exit 1.
  - `--target` defaults to `$CONTENT_TARGET`, and must equal `openDb().target`.
  - `--actor` defaults to `gha:$GITHUB_WORKFLOW#$GITHUB_RUN_ID` when `GITHUB_ACTIONS=true`; otherwise it is required.
  - `--idempotency-key` is always required for `submit`, `unpublish` and `rollback`.
- `CONTENT_SITE_URL` must equal `https://libertyvillage.co` iff target=production, else TargetError.

| cmd                      | args                                                                                 | stdout (exit 0)                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrate`                | —                                                                                    | `{"applied":["0001"]}`                                                                                                                                                                                                                                                                                                      |
| `seed`                   | `--from-ref <sha>`\|`--from <dir>`, `--apply` (else dry-run), `--prune`              | `{"inserted":n,"updated":n,"unchanged":n,"unpublished":[…],"repositioned":n,"refused":[…],"liveSeq":n,"snapshotId":"…"}`                                                                                                                                                                                                    |
| `verify-parity`          | `--from-ref <sha>`\|`--from <dir>`                                                   | `{"match":true,"datasets":{"posts":{"count":70,"digest":"…","match":true},…}}`; exit 1 on mismatch                                                                                                                                                                                                                          |
| `export`                 | `--root <dir> [--with-assets]`                                                       | `{"snapshotId":"…","liveSeq":n,"files":[…]}`                                                                                                                                                                                                                                                                                |
| `submit`                 | §4.4 + `--kind --idempotency-key [--topic-key --generated-at] [--news-out]`          | §4.4 (submit only; never gates)                                                                                                                                                                                                                                                                                             |
| `gate`                   | `--submission N [--script f]`                                                        | §4.6                                                                                                                                                                                                                                                                                                                        |
| `deploy`                 | — (uses `--target`)                                                                  | POSTs the hook once, then runs g7–g8 for each `listPending`: `{"submissions":[{"id":17,"smoke":"passed"}]}`; exit 3 if any stays pending                                                                                                                                                                                    |
| `unpublish` / `rollback` | `--dataset d --key k [--to-rev n] --reason S --idempotency-key K`                    | `adminAction`, then g6–g8 on the admin submission: `{"submissionId":n,"liveSeq":n,"fromRev":n,"rev":n\|null,"smoke":"passed"}`                                                                                                                                                                                              |
| `history` / `show`       | `--dataset d --key k` / `--submission N`                                             | store `history` / `getSubmission` minus payloads and `context`, plus `url` per item                                                                                                                                                                                                                                         |
| `list`                   | `--submissions [--state a,b] [--kind k]` \| `--entries --dataset d [--visibility v]` | arrays per §4.2                                                                                                                                                                                                                                                                                                             |
| `stats`                  | `[--alert]`                                                                          | `{"projectBytes":n,"warn":bool,…}`; `--alert` posts Slack `⚠ Neon content storage <MB> MB > 350 MB of 512 MB` when warn                                                                                                                                                                                                     |
| `gc-assets`              | `[--apply]`                                                                          | deletes an asset only if every revision referencing its path is never-published (`published_at` NULL), its submission is rejected/blocked/error and closed > 14 days ago, and no live payload references it: `{"deleted":n,"bytes":n}`. Such revisions are never rollback targets; `show` of them reports `image-reclaimed` |
| `reset`                  | `--confirm-reset <dbName>`                                                           | drop + re-migrate, carrying `meta.live_seq` forward (never recycled); **refused unless `lv_staging` or `lv_test_*`**                                                                                                                                                                                                        |
| `restore-snapshot`       | `--from <siteUrl> --root <dir>`                                                      | L2: pinned fetch (§4.3; `CONTENT_SITE_BYPASS` header when set), writes `data/*.json` + `public/media/**` and the verified source manifest to `<root>/.content-restore/manifest.json` (local, ignored, never committed): `{"deploymentUrl":"…","snapshotId":"…","files":9,"media":n}`; no DB variable read                   |

### 4.6 `content gate` (B: `gate.mjs`, `review-document.mjs`, `repair-rules.mjs`, `repair-adapter.mjs`, `lenses.mjs`, `deploy.mjs`, `smoke.mjs`, `notify.mjs`)

**g0 claim and resume.** The gate is driven only by DB state; every step's mutation carries the claim token (§4.2).

- A claim held elsewhere → exit 1 `claimed`.
- `published` → g6. Each propagation phase is skipped when its timestamp is set.
- `rejected|blocked|error|compensated` → g8 if `notified_at` is NULL, then exit 2.
- `open|gating` with `n = submissions.round`:
  - If `gate_rounds(n)` exists, skip g1–g4 and branch on its stored `decision`: `go` → g5; `repair` → fixer. A terminal decision here is impossible because `recordRound` closes atomically, so it is exit 1 `corrupt`.
  - Otherwise → g1.

**Rounds**

- **g1 deterministic:** the §4.4 checks on round n's vector, using `submissions.context`. Context is a temp export root (`readLive`). Failure → `recordRound(decision validation|lint)` (closes `rejected`) → g8, exit 2.
- **g2 document:**
  - Header: `content submission <id> round <n> kind <kind> target <target>`.
  - Then, per item in `(dataset,key)` order: `--- a/data/<dataset>.json#<key>` / `+++ b/data/<dataset>.json#<key>`, and a 3-context unified diff of `JSON.stringify(base,null,2)` (empty for insert) against the candidate.
  - `contentSha=blobSha1(doc)`, ≤ 500,000 bytes.
- **g3 review:** `reviewRows` (§4.7) with `lenses = kind==='manual' ? MANUAL_LENSES[dataset] : LENSES[kind]`.
  - Grounded kinds (blog, blog-live, news) add `references=selectReferenceRecords(doc, liveBusinesses)` and `inventory=inventoryFromData({services,topics,posts,blogImages,neighborhoodImages,ogImages, images: liveMediaPaths})`, with listings from the checkout.
  - News adds `evidence=trimEvidence(context.evidence)`.
- **g4 decision:**
  1. Cut finding paths at `#`, then compute `d=preflightDecision({verdict, contentSha, attempts: repairs, maxRepairs: MAX_REPAIRS, kind: POLICY_KIND[kind], changedFiles: distinct 'data/<dataset>.json'})`. `POLICY_KIND` maps automated kinds to themselves and `manual→'seo'`.
  2. If `d==='repair'` and `n≥1`, evaluate `evaluateRepairProgress({history: [...priorRounds.map(r=>({attempt:r.round, overall:Number(r.overall), blockingCount:r.blocking_count})), {attempt:n, overall:Number(verdict.overall), blockingCount: current}]})`, where `current` = findings with severity in `BLOCKING_SEVERITIES`. `abandon` → `not-converging`.
  3. Route: `go`→g5; `repair`→fixer; `unrepairable`→`unrepairable`; `block`→`exhausted` if `repairs===MAX_REPAIRS`, else `block`.
  4. **Persist once:** `recordRound(n, {…, decision: final})`. Terminal decisions close `blocked` in that same tx → g8, exit 2.
- **Fixer:** `planRecordRepair({kind: POLICY_KIND[kind], gateVerdict: raw, payload: [{file:'data/<dataset>.json', records}] per file, validate: makeRowRepairValidator(…), references, inventory, lintFindings, schema: rowRepairSchema(files), describeContract: describeRowContract})`.
  - `result.plan` → `addRepairRound(fromRound:n)` → g1 on round n+1.
  - A fixer exception writes no rows. The submission stays `gating` at round n (decision `repair`), so a rerun retries the fixer. A second consecutive fixer exception in the same process → `rejectSubmission(error, 'error')`.

**Publication**

- **g5 publish:** `publishSubmission`. `ConflictError` → `rejectSubmission(rejected, conflict)` → g8, exit 2.
- **g6 deploy:** if `deploy_requested_at` is NULL, POST `CONTENT_DEPLOY_HOOK_URL` (2 attempts, 10s timeout, 2xx), then `markPhase('deploy_requested')`. A crash between POST and mark re-POSTs on resume; a duplicate build is harmless.
- **g7 smoke** (`x-vercel-protection-bypass: $CONTENT_SITE_BYPASS` when set) loops every 20s, for ≤ 15 min, over the unresolved items:
  1. **Freshness.** M1 = GET alias manifest. Continue while `M1.live_seq < submissions.live_seq`.
  2. **Classify.** Read the DB's current `live_rev` L (and its sha) per item. The item is **own** iff `L IS NOT DISTINCT FROM published_rev`, else **superseded**. The expected manifest entry is L's `{rev, sha}`, or absent when L is NULL. A missing or different entry is a freshness condition: keep waiting and never compare against the older payload.
  3. **Adapters** (own items):
     - page present: route 200 containing the marker; `/sitemap.xml` contains `https://libertyvillage.co<route>`; each image URL 200 `image/*`, and `/media` bytes' sha256 = the manifest media sha.
     - page absent (unpublish, or compensation of an insert): route 404 and the sitemap lacks the URL.
     - snapshot (topic-queue, discovery-seen): `/content-snapshot/<file>` sha256 = `M1.files[file]`.

     Superseded items only need the manifest to show L. The successor's own submission carries its page checks. Each GET gets 3 tries, 10s apart.

  4. **Identity.** M2 = GET alias manifest. If `M2.deployment_url≠M1.deployment_url`, discard this pass's results and repeat.
  5. **All resolved** → `markItemSmoke`, then `markPhase('smoke_passed')`.
  6. **Timeout, or hook failure in g6** = **propagation** failure. Content stays published, Slack warns `#id`, exit 3. Resume with `content deploy`.
  7. **Proven bad render** = an own item whose manifest entry matches `published_rev`'s sha, and whose page check fails on a stable deployment identity.
     - Non-admin: `compensateSubmission`, then g6–g8 on the returned admin submission (prior state; insert → 404), exit 2 `smoke-failed`. `ConflictError` → keep the newer content, Slack `compensation-conflict`, exit 2.
     - Admin: Slack alert only, exit 2 (no automatic undo of an operator action).
- **g8 notify** (`SLACK_WEBHOOK_URL`). Skipped when `notified_at` is set. Otherwise post, then `markPhase('notified')`.
  - Success: `✅ <target> published: <title> — <url>` (one line per item, ≤ 10) + `(#id, kind, score, repairs)`.
  - Admin: `🔁 <target> <op> <dataset>/<key> (#id)`.
  - Failure: kind, `#id`, decision, score, top 3 findings, `content show --submission <id>`.
  - **At-least-once:** a crash after the webhook returns and before `markPhase` repeats the line with the same `#id` on resume. There is no exactly-once claim, because Slack incoming webhooks have no idempotency key.

**stdout:** `{"submissionId":17,"state":"published","decision":"go","overall":8.5,"repairs":1,"liveSeq":42,"published":[{"dataset":"businesses","key":"wilbur-s-taco-shop","rev":2,"url":"https://…/directory/wilbur-s-taco-shop"}],"deploy":"requested","smoke":"passed","notified":true}`.

**`--script f` seam:** `{"reviews":[{overall,findings}],"fixes":[{files,reason}]}`, **refused unless dbName ∈ {lv_staging, lv_test\_*}**.

- Review i answers round i. Fix j answers the j-th fixer call.
- `model`/`commit_sha` are filled with `GATE_MODEL` and the real `contentSha`. `evaluateVerdict` and all deterministic checks still apply.
- Rounds are stored `scripted=true`, and Slack lines are prefixed `[scripted]`.

### 4.7 Review/fixer adapters (B)

**`scripts/automation/review-agent.mjs`** (edits are minimal, and the §2 eval invariants must still match; locked eval files stay byte-identical and green):

- **Main guard** around `:540-555`: `if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))`.
- **Inside the sliced `recordRepairPrompt`:** only an added optional param `describeContract = describeRepairContract` and its `payload.map(({file}) => describeContract(file))` call site. `planRecordRepair` gains optional `schema = RECORD_REPAIR_SCHEMA` and `describeContract` and forwards them. Legacy defaults produce byte-identical prompts (test: legacy prompt text is unchanged for a posts payload).
- **New after `fixContent`:** `export async function reviewRows({kind, lenses, document, contentSha, references=[], inventory=null, evidence=null}) → raw`. It uses `reviewContent`'s prompt structure (`GROUNDING_LENS`/`INVENTORY_LENS` when present, `GATE_BAR`, the model/commit_sha line, DATA markers) and `runStructured(GATE_MODEL, VERDICT_SCHEMA, budget 4)`, and throws unless `evaluateVerdict(raw, contentSha).ok`.
- **New `rowRepairSchema(files)`:** RECORD_REPAIR_SCHEMA with file `enum=files`, `maxItems=files.length`, and records `{key, record}`.
- **Also export** `planRecordRepair`, `LENSES`, `VERDICT_SCHEMA` and `MAX_FIXER_ATTEMPTS`.
- **Unchanged:** `review()`, `fix()`, `fixRecords()`, `RECORD_FILES`, `RECORD_REPAIR_RULES`.

**`repair-rules.mjs`**: `CONTENT_REPAIR_RULES[file]`:

| file                      | immutable                                                                                                                                                    | repairable                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| posts, businesses, topics | **exactly** the legacy `RECORD_REPAIR_RULES` (not weakened)                                                                                                  | legacy                                                     |
| services                  | `slug, name, pluralName, icon, image, searchVolume, competitiveness`                                                                                         | the rest                                                   |
| buildings                 | `slug, name, alternateNames, address, postalCode, latitude, longitude, yearBuilt, units, image`                                                              | the rest                                                   |
| neighborhoods             | `slug, name, image` + every numeric stat (`avgRent1BR, avgRent2BR, transitScore, walkScore, bikeScore, population, medianAge, medianIncome, distanceFromLV`) | the rest                                                   |
| guide-hub                 | `population, medianRent, walkScore, transitScore`; identity = singleton key                                                                                  | `boundaries, history, prosCons, quickFacts, answerSummary` |
| topic-queue               | no fixer                                                                                                                                                     | —                                                          |

Builders re-check these lists against `lib/types.ts` in the file header. `validateRowRepair(dataset, o, r)` delegates to `validateRecordRepair` for the legacy three (keeping the premise check) and runs the same algorithm over `CONTENT_REPAIR_RULES` for the others.

**`repair-adapter.mjs`**: `makeRowRepairValidator({kind, candidates, ctx}) → (plan) → {ok, errors, repaired:[{dataset,key,payload}]}`.

- The plan must be `isRecordRepairPlan`, target only candidate files and keys, and have no duplicate `(file,key)`.
- Per entry: `validateRowRepair`, then the **same §4.4 kind-policy checks for that kind** with `ctx = submissions.context`. `lintPost` runs for blog/blog-live/news only; seo/manual post edits get storage validation only.
- Errors are prefixed `file: key:`. `ok` iff zero errors (never object truthiness).

**`lenses.mjs`**: `MANUAL_LENSES` for each of the 7 site datasets (DATA: supportable facts; CONTENT: neutral, no unsupported claims; SHAPE: fields and links match the dataset). Automated kinds reuse `LENSES[kind]` verbatim.

### 4.8 Workflows: writers (C), ingest (D)

**`route` job** (bash, no secrets), prepended to the 5 writers:

- store = `inputs.store` if it is `git|db`, else `vars.LV_CONTENT_STORE||'git'`.
- ref `refs/heads/main` → target = `inputs.content_target||'production'`.
- ref `refs/heads/staging` → target **must** be `staging` and store `db`, else fail. Any other ref fails.
- SEO only: lane = `inputs.seo_lane` (`data|code`, default `data`). With store=git, the lane is ignored.
- `content-staging` has no GitHub branch policy, so this route is the hard restriction. `content-production`'s main-only policy is a second guard.
- When repo var `LV_CONTENT_CUTOVER_HOLD=1`, all five writer routes exit before side effects except `workflow_dispatch` on `refs/heads/staging` with store=db and content_target=staging; any schedule, repository_dispatch, main ref or production target is refused even if a workflow is temporarily enabled. D's ingest route enforces the identical hold. Unset/0 leaves legacy behavior unchanged. Test the hold in C and D before cutover.

The existing steps move byte-for-byte into job `legacy` (`if: store=='git'`, plus SEO `|| lane=='code'`). Each writer's `workflow_dispatch` gains `store` (`auto|git|db`) and `content_target` (`production|staging`); SEO also gains `seo_lane`. The new job:

```yaml
db:
  needs: route
  if: needs.route.outputs.store == 'db' && needs.route.outputs.lane != 'code'
  environment: content-${{ needs.route.outputs.target }}
  runs-on: ubuntu-latest
  timeout-minutes: 45
  permissions: { contents: read }
  env:
    CONTENT_DATABASE_URL: ${{ secrets.CONTENT_DATABASE_URL }}
    CONTENT_DATABASE_URL_UNPOOLED: ${{ secrets.CONTENT_DATABASE_URL_UNPOOLED }}
    CONTENT_DEPLOY_HOOK_URL: ${{ secrets.CONTENT_DEPLOY_HOOK_URL }}
    CONTENT_SITE_BYPASS: ${{ secrets.CONTENT_SITE_BYPASS }} # absent in content-production
    CONTENT_DB_NAME: ${{ vars.CONTENT_DB_NAME }}
    CONTENT_SITE_URL: ${{ vars.CONTENT_SITE_URL }}
    CONTENT_TARGET: ${{ needs.route.outputs.target }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
  steps:
    - uses: actions/checkout@v4
      with:
        { ref: "${{ github.sha }}", fetch-depth: 0, persist-credentials: false }
    - run: git fetch --no-tags origin main staging
    - uses: actions/setup-node@v4
      with: { node-version: "20" }
    - run: npm ci
    - run: node scripts/content/cli.mjs export --root . # all 9 datasets + manifest
    - run: <unchanged generator + its existing env>
    - run: node scripts/content/cli.mjs submit --dir . --kind <k> --idempotency-key "gha:<wf>:${{ github.run_id }}:${{ github.run_attempt }}" > submit.json
    - run: ID=$(jq -r .submissionId submit.json); [ "$ID" = null ] || node scripts/content/cli.mjs gate --submission "$ID"
```

**Per writer.**

- **discover-businesses:** `submissionId:null` = success (zero results). After the gate, `markDiscoverySeen` sets added/rejected. The final step is `content stats --alert`, which is the weekly storage check.
- **weekly-topic-discovery:** `topic-queue.mjs discover` runs on the exported queue.
- **news-autopublish:** `publish.mjs` is unchanged. Then `submit --kind news --news-out <out_dir>` and `gate`. `news-preflight` is skipped in DB mode. The open-`news/auto-*`-PR guard becomes `content list --submissions --kind news --state open,gating` = [].
- **weekly-blog:** only when owner=`gha` (dormant; §2).
- **weekly-seo-improvements**, data lane:
  1. `node scripts/content/seo-guard.mjs capture > /tmp/seo-base.json` right after export records `{path: sha256}` for every path in `git status --porcelain -uall`.
  2. The generator runs as `SEO_MODE=data node scripts/seo-improve-agent.js` (C reads `SEO_MODE`; prompt restriction only).
  3. `seo-guard.mjs check /tmp/seo-base.json` computes changed = new or re-hashed paths. It ignores the runner artifacts `^tasks/seo-(improve-(summary\.md|runs/)|scores\.json)` and untracked root-level files (as the legacy guard does).
     - Only `data/*.json` → submit.
     - Empty → `{"mode":"data","changed":[]}`, exit 0, no submit.
     - Anything under `app|components|lib|public|scripts|.github` or a legacy-forbidden root file → exit 2 `mixed-blocked`, Slack, no submit.
- **weekly-seo-improvements**, code lane (store=db, `-f seo_lane=code`): job-level `env: {SEO_MODE: code}` is added to `legacy`, whose steps stay byte-identical. One new step before the legacy guard, `seo-guard.mjs code-only`, fails if any `data/` path changed. The lane stays reachable after `LV_CONTENT_STORE=db`.

**supervisor-ingest.yml (D, additive; lands on staging, reaches main only via the cutover promotion).**

- Top-level `permissions` += `statuses: write`. `on:` += `workflow_dispatch: {inputs: {payload: {type: string, required: true}}}` (post-promotion staging runs only; §4.10).
- New `route` job validates `client_payload` or `fromJSON(inputs.payload)` with `validateIngestPayload` from the checked-out ref.
  - repository_dispatch requires ref main; store=db there requires target production.
  - workflow_dispatch requires `refs/heads/staging` and target staging.
  - With `vars.LV_CONTENT_CUTOVER_HOLD == '1'`, only the staging workflow_dispatch path may pass; all other events fail before ingest side effects, matching the writer guard (§4.8).
- Legacy `ingest`: `needs: [resolve-owner, route]`, `if:` gains `&& needs.route.outputs.store != 'db'`; otherwise unchanged.
- New `ingest-db`: `needs: [resolve-owner, route]`, with `if: needs.resolve-owner.outputs.owner == 'exedev' && needs.route.outputs.store == 'db'`.
  - `environment: content-<target>`, `timeout-minutes: 45`, `permissions: {contents: read, statuses: write}`.
  - Env is the writer `db` env block plus **`GH_TOKEN: ${{ github.token }}`** and `GITHUB_REPOSITORY`.
  - Steps: checkout `github.sha` (fetch-depth 0); setup-node 20; `npm ci`; the content-ship control step (as `:66-70`); then `node scripts/supervisor/ingest-db.mjs --payload "$PAYLOAD"`. A final `if: failure()` step posts `failure` `ingest-error:workflow` when the script could not start.
  - There is no candidate-outcome step; the VM records outcomes (§2).

**`scripts/supervisor/ingest-db.mjs` (D).** This is the single implementation that both GHA and the §4.10 harness run.

1. Validate the payload.
2. Post status `content/publish` = `pending` on `DATA_SHA`.
3. `git fetch origin $DATA_BRANCH` and require `FETCH_HEAD==DATA_SHA`.
4. `git diff --name-only origin/staging...$DATA_SHA` must pass `validateDbIngestDiff`.
5. `git show $DATA_SHA:candidate/post.json > candidate.json`, then `export --root .`.
6. Run `submit --kind blog-live --record-file candidate.json --dataset posts --baseline .content-export/manifest.json --idempotency-key vm:<DATA_SHA> --actor ingest:<DATA_SHA> --topic-key <topic_key> --generated-at $(git show -s --format=%cI $DATA_SHA)`, then `gate`.
7. Post the terminal status via `gh api repos/$GITHUB_REPOSITORY/statuses/$DATA_SHA`:
   - exit 0 → `success`, `description='published:<submissionId>:seq:<liveSeq>'`, `target_url` = live URL (the monitor parses the sequence);
   - exit 3 → `success`, the same published description and target URL, with propagation still pending; monitor continues freshness checks;
   - exit 2 → `failure` `decision=<d> submission=<id>`;
   - any thrown error → `failure` `ingest-error:<step>`.

**`ingest-contract.mjs` (D).**

- `allowedKeys` += `store` (optional `git|db`) and `target` (required for db: `production|staging`).
- New `validateDbIngestDiff(files)`: exactly `candidate/post.json`.
- `repositoryDispatchBody` refuses target staging.
- New `workflowDispatchBody(p)` = `{ref:'staging', inputs:{payload: JSON.stringify(p)}}`.

### 4.9 VM / host-run DB mode (D)

**Selection:**

- Non-secret `LV_CONTENT_STORE=db`, `LV_CONTENT_TARGET=production|staging`, `LV_SITE_URL`, `LV_INGEST_TRANSPORT=github|local` (default github).
- target=staging requires `LV_SITE_BYPASS`. It is allowed only on an operator-host run and never in `/etc/lv-supervisor.env`.
- `LV_INGEST_TRANSPORT=local` and `LV_STATUS_CREATOR` are refused unless target=staging. host-run refuses the bypass for production.
- An unset store keeps legacy byte-for-byte.

**Steps**

1. Worktree from `origin/staging` (code).
2. The pinned fetch (§4.3) writes the 9 files to `<worktree>/data/` (uncommitted). `readSelectedTopic` then reads the hydrated queue.
3. `readPublicationHistory=()=>[{sha: manifest.snapshot_id, posts, parentPosts: []}]`, so `findQualifyingPublication` counts any snapshot post published this ISO week.
4. Generation, `validateSubmittedPost` and `blog-lint` run as today. The image must be tracked at `origin/main` (production) or `origin/staging` (staging), else `BLOCKED_VALIDATION`.
5. Commit only `candidate/post.json` on `supervisor/blog-data-<ms>`; push via the proxy.
6. Dispatch:
   - github transport: production uses `repositoryDispatchBody({…, store:'db', target:'production'})`; staging (post-promotion only) uses `POST /repos/{repo}/actions/workflows/supervisor-ingest.yml/dispatches` with `workflowDispatchBody`.
   - local transport (staging only): resolve `CODE_SHA=git rev-parse origin/staging` after `git fetch origin staging`; clone trusted origin into `$LV_STATE_DIR/ingest-<ms>`, `git checkout --detach $CODE_SHA`, run `npm ci` there, then spawn detached `node scripts/supervisor/ingest-db.mjs --payload '<json>'` from that directory. The setup and child log the exact 40-hex `CODE_SHA` to `ingest-<ms>.log` without credentials; host-run awaits setup but not the ingest. The child inherits only the explicit operator env below. Test from a fresh default-branch clone lacking `ingest-db.mjs` and `pg`: the pinned staging checkout and install must still execute the DB-mode child.
7. `content-monitor.mjs` exports `monitorContentPublish({dataSha,title,siteUrl,allowedCreator,getStatuses,getManifest,getPage,now,wait,statusDeadlineMs=3600000,renderDeadlineMs=1800000}) → {state,reason?,targetUrl?,liveSeq?}`. The production adapter binds `gh api`, HTTP and real clock; injected functions make the acceptance eval deterministic: `getStatuses(dataSha)` returns GitHub-like statuses with `context,state,creator.login,description,target_url,created_at`; `getManifest(siteUrl)` returns the public manifest; `getPage(targetUrl)` returns `{status,text}`; `now()` returns epoch ms and `wait(ms)` is async. On the exact data SHA, only the latest `content/publish` status from `github-actions[bot]` (or `$LV_STATUS_CREATOR` under local staging transport) counts. Ingest posts success with `description='published:<submissionId>:seq:<liveSeq>'` and the page `target_url`; pending resets nothing. The monitor waits ≤ 60 min for terminal status, then ≤ 30 min for a stable manifest with `live_seq≥liveSeq` and a GET of `target_url` returning 200 with the expected title. An `ingest-error:*` failure gives `INGEST_FAILED`; status timeout gives `MONITOR_TIMEOUT`; published but not fresh/rendered gives `BLOCKED_PROPAGATION`. Wrong-SHA/creator/older statuses cannot complete it. Tests use a virtual clock and fake getters, not 30–60-minute waits.
8. Terminals: new `PUBLISHED_LIVE`; existing `BLOCKED_*` by decision; `INGEST_FAILED` for `ingest-error:*`; `MONITOR_TIMEOUT` as today; new `BLOCKED_PROPAGATION` (published, never visible). `ledger.mjs` `TERMINALS` gains both new states.
   - `PUBLISHED_LIVE` calls `consumeIntent({topicKey, contained:true})`, which records `PUBLISHED_MAIN` through the unchanged `recordSupervisorOutcome`. Other terminals record as today.
   - Branch cleanup is unchanged.

### 4.10 Staging entrypoints and the S11 harness (B6)

- **Writers:** `gh workflow run <wf>.yml --ref staging -f store=db -f content_target=staging [-f max=2]` runs the **staging** version of a file that has `workflow_dispatch` on main. S9 first records whether GitHub accepts the new inputs for the staging-ref file. If it refuses, S9/S10 move unchanged to the post-promotion gate (§7.2 step 7) and are recorded as blocked pre-cutover, not passed.
- **Ingest, pre-cutover = host-local harness (S11a).** No main change is made for UAT, so the GitHub trigger cannot be exercised before promotion (§2). The harness runs the real VM code and the same `ingest-db.mjs` (payload validation, SHA/diff checks, real `content/publish` statuses on the real commit, submit, real-model gate, deploy, smoke) plus the real `content-monitor`. Operator host commands:
  ```
  set -a; . ./.env.content-staging.local; set +a        # lv_staging URLs, staging hook, CONTENT_SITE_URL/BYPASS, ANTHROPIC_API_KEY, SLACK_WEBHOOK_URL
  export GH_TOKEN=$(gh auth token) LV_STATUS_CREATOR=$(gh api user --jq .login) LV_GITHUB_REPOSITORY=jonkthomas/libertyvillage
  export GITHUB_REPOSITORY="$LV_GITHUB_REPOSITORY" CONTENT_DB_NAME=lv_staging CONTENT_TARGET=staging
  export LV_STATE_DIR=$(mktemp -d) LV_LEDGER=$LV_STATE_DIR/ledger.json
  git fetch origin staging; export LV_INGEST_CODE_SHA=$(git rev-parse origin/staging) # host-run verifies the same SHA before child checkout
  LV_CONTENT_STORE=db LV_CONTENT_TARGET=staging LV_SITE_URL="$CONTENT_SITE_URL" LV_SITE_BYPASS="$CONTENT_SITE_BYPASS" \
    LV_INGEST_TRANSPORT=local node scripts/supervisor/cli.mjs run
  ```
  - The detached child receives `GITHUB_REPOSITORY`, `GH_TOKEN` (`repo:status`), `CONTENT_DB_NAME`, `CONTENT_TARGET`, `CONTENT_DATABASE_URL`, `CONTENT_DATABASE_URL_UNPOOLED`, `CONTENT_DEPLOY_HOOK_URL`, `CONTENT_SITE_URL`, `CONTENT_SITE_BYPASS`, `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL` from this staging-only operator environment; refuse any missing binding before setup. The token is the operator's login, never a VM secret. S11a logs the child code SHA and status creator, not credentials.
  - Not covered: the GitHub event trigger, `ingest-db` YAML env binding and `github-actions[bot]` creator. Workflow unit tests (C/D) cover these; they are **proven live only at S11c**.
- **Ingest, post-promotion (S11c, cutover step 7):** `supervisor-ingest.yml` on main then has `workflow_dispatch`. A local host-run with `LV_INGEST_TRANSPORT=github LV_CONTENT_TARGET=staging` dispatches `--ref staging` and must reach `PUBLISHED_LIVE`, with the status creator `github-actions[bot]`. The production repository_dispatch leg is first proven by the first automated run after step 9, which is watched live.
- **Production** DB runs only from `main` (schedule, repository_dispatch, or `--ref main`).
- **Operator staging runs** load `.env.content-staging.local` (covered by `.gitignore` `.env*`; no prod credentials) explicitly. Every command in §9 is either prefixed with `set -a; . ./.env.content-staging.local; set +a` or run as `node --env-file=.env.content-staging.local scripts/content/cli.mjs …` (`C` below).

## 5. Seeding and reconciliation (A)

`content seed` is dry-run by default. Each run is one kind-`seed` submission with idempotency key `seed:<target>:<sha>`. Per source record:

| source record vs live DB | action                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| key absent               | rev 1, source seed, `published_at` set, live                                                                                 |
| same sha                 | no-op                                                                                                                        |
| different                | new seed rev, live — **refused** if the entry has a non-seed revision newer than its last seed (exit 2, listed in `refused`) |

- **`--prune`** unpublishes live **seed-owned** keys (all revisions seed) absent from the source. It never deletes.
- **Positions** are rewritten to source order in the same transaction. The deferrable unique constraint makes swaps safe.
- **State datasets:** topic-queue keeps `key` and order. discovery-seen rows get `outcome='added'` if the name maps to a business, else `seen`.
- **Audit:** each change writes `actions('reconcile')`, and `live_seq` increments once per run.
- **`verify-parity`** compares count, ordered keys, per-record sha and digest for all 9 datasets, then byte-compares the serialized files. Exit 1 on mismatch.

**Authorized now (N1).** Migrating and seeding both DBs before cutover needs no further go:

```
C migrate --expect-db lv_staging && C seed --from-ref <origin/staging sha> --apply --expect-db lv_staging && C verify-parity --from-ref <same> --expect-db lv_staging
content migrate --expect-db neondb && content seed --from-ref <origin/main sha> --apply --expect-db neondb && content verify-parity --from-ref <same> --expect-db neondb
```

The production cutover reconciliation (§7.2 step 5) needs John's go.

## 6. Secrets and bindings (infra live; exact names)

| where                                                          | names / values                                                                                                                                                                                                                                                  | status                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Vercel Production                                              | `CONTENT_DATABASE_URL[_UNPOOLED]`→neondb; `CONTENT_SOURCE` **unset until John's go**, then `db`                                                                                                                                                                 | set / cutover                 |
| Vercel Preview                                                 | `CONTENT_DATABASE_URL[_UNPOOLED]`→lv_staging (all previews; unused without `CONTENT_SOURCE`); **`CONTENT_SOURCE=db` branch-scoped to `staging` only** (`vercel env add CONTENT_SOURCE preview staging`). Other PR previews stay json                            | set / P1                      |
| Vercel Development                                             | `CONTENT_DATABASE_URL[_UNPOOLED]`→lv_staging; no `CONTENT_SOURCE` (db-mode `development` builds exit 1)                                                                                                                                                         | set                           |
| Vercel deploy hooks                                            | `content-publish-production` (ref main), `content-publish-staging` (ref staging); the staging alias tracks the latest staging deployment, hook builds included                                                                                                  | exist                         |
| GH env `content-production` (main only)                        | secrets `CONTENT_DATABASE_URL`, `CONTENT_DATABASE_URL_UNPOOLED`, `CONTENT_DEPLOY_HOOK_URL`; vars `CONTENT_DB_NAME=neondb`, `CONTENT_SITE_URL=https://libertyvillage.co`                                                                                         | exists                        |
| GH env `content-staging` (no branch policy → §4.8 route guard) | same 3 secrets (lv_staging, staging hook) + `CONTENT_SITE_BYPASS`; vars `CONTENT_DB_NAME=lv_staging`, `CONTENT_SITE_URL=https://libertyvillage-git-staging-voxtur.vercel.app`                                                                                   | exists                        |
| GH repo                                                        | `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL`, `SERPAPI_API_KEY`, `PEXELS_API_KEY`; var `LV_CONTENT_STORE=git` until cutover; `LV_CONTENT_CUTOVER_HOLD` absent/0 normally, set to 1 only inside the approved cutover window, snapshot/restore its prior value (§7.2) | vars guarded                  |
| VM `/etc/lv-supervisor.env`                                    | `LV_CONTENT_STORE=db`, `LV_CONTENT_TARGET=production`, `LV_SITE_URL=https://libertyvillage.co` (non-secret)                                                                                                                                                     | cutover                       |
| operator host                                                  | `.env.content-staging.local` (§4.10); `gh` login with `repo:status`                                                                                                                                                                                             | operator                      |
| tests                                                          | `CONTENT_TEST_DATABASE_URL` (required; any `127.0.0.1\|localhost` port, e.g. `postgres://postgres:postgres@127.0.0.1:55432/postgres` for container `lv-neon-test-a`)                                                                                            | harness refuses non-localhost |

Rules:

- Environment secrets reach a process only via an explicit job `env:`.
- Nothing reads the integration's `DATABASE_URL`, `POSTGRES_*` or `PG*` (`tests/content/env-guard.test.mjs` greps `app lib scripts components`).
- Prod credentials reach a laptop only via an explicit `vercel env pull --environment=production`.
- Every prod mutation after P0 (cutover steps, prod unpublish/rollback, Vercel Production env) needs John's go for that action.

## 7. Phases, cutover, rollback

**Phases**

- **P0:** seed both DBs (authorized).
- **P1:** A–D land via PRs into `staging`.
  - Set the branch-scoped Preview `CONTENT_SOURCE=db`, then verify the scope:
    - `vercel env ls preview staging | grep CONTENT_SOURCE` lists it;
    - `vercel env ls preview <other-branch> | grep CONTENT_SOURCE` lists nothing;
    - `GET /v10/projects/<projectId>/env` shows `CONTENT_SOURCE` with `target:["preview"]` and `gitBranch:"staging"`.
  - Verify the build env:
    - the staging alias `/content-snapshot/build.json` has `content_source:"db"`, `git_ref:"staging"` and `vercel_env:"preview"`;
    - any other PR preview's `build.json` has `content_source:"json"`.
  - Run §9 on staging. Prod writers stay `git`; Production `CONTENT_SOURCE` stays unset.
- **P2:** cutover on John's go.
- **P3:** retirement.

**7.2 Cutover** (the whole runbook needs John's go; ⚠ = prod-mutating)

1. **Freeze and drain.**
   - Save state with `gh workflow list --all --json name,path,state > /tmp/wf-before.json` and record whether repo var `LV_CONTENT_CUTOVER_HOLD` exists and its exact value in `/tmp/hold-before.json` (restore it, including absence, on resume/abort).
   - ⚠ Set repo var `LV_CONTENT_CUTOVER_HOLD=1`, verify every writer and ingest route refuses a non-staging event under the guard (§4.8), then `gh workflow disable` the 5 writers, `supervisor-ingest` and `autonomous-coordinator`. `disable` is repo-wide, so staging runs stop too, and no §9 run happens before step 7.
   - VM: `sudo systemctl disable --now lv-supervisor.timer`, then wait until `systemctl is-active lv-supervisor.service` ≠ active.
   - Require `gh run list --workflow <wf> --status <s>` to be empty for each of those workflows and each `s` ∈ {queued, in_progress, waiting, pending, requested}.
   - Require no open PR into main/staging with head `auto/*`, `blog/auto-*`, `news/auto-*`, `seo/auto-*` or `supervisor/*`.
2. ⚠ **Merge staging→main.** Production `CONTENT_SOURCE` is unset, so the prebuild writes only `build.json`. Per D2 the stranded businesses, queue and seen entries and images go live here via JSON.
3. **Wait for the JSON deployment.** `git fetch origin main`; `MAIN_SHA=$(git rev-parse origin/main)`. Poll `https://libertyvillage.co/content-snapshot/build.json` until `git_sha==MAIN_SHA` and `content_source=="json"`, and record `DEP_A=deployment_url`.
4. **Baseline A.** `node scripts/content/parity-crawl.mjs crawl --base https://libertyvillage.co --out /tmp/cutover-A.json`.
5. ⚠ **Reconcile.** `content seed --from-ref $MAIN_SHA --apply --prune --expect-db neondb`, then `content verify-parity --from-ref $MAIN_SHA --expect-db neondb` → PASS, output pasted (includes the 7 seen entries). Record `SEED_SEQ=liveSeq`.
6. **Recheck.** `git fetch origin main`, then require `origin/main == $MAIN_SHA` and repeat the step-1 drain check. Otherwise go back to step 3.
7. ⚠ **Flip.**
   - Set Production `CONTENT_SOURCE=db`, checking with `vercel env ls production | grep CONTENT_`, and trigger `content-publish-production`.
   - Poll `build.json`/manifest until: `content_source=="db"`, `git_sha==MAIN_SHA`, `deployment_url≠DEP_A`, `live_seq==SEED_SEQ`, and every `/content-snapshot/<file>` is byte-equal to `git show $MAIN_SHA:data/<file>`.
   - With `LV_CONTENT_CUTOVER_HOLD=1` verified, temporarily enable `supervisor-ingest` and run **S11c** on staging; re-disable it. For each deferred S9/S10 writer, enable that workflow **alone**, dispatch only `--ref staging -f store=db -f content_target=staging`, verify the staging run and re-disable it. Before and after each enable, assert the guard refuses production/scheduled events and no production writer run is queued or active; failure aborts cutover. Repo-wide enablement without the tested route hold is forbidden. Record each run URL or failure; never mark a deferred scenario passed from a mere enablement.
8. **Parity B.** `parity-crawl crawl --base https://libertyvillage.co --out /tmp/cutover-B.json && parity-crawl compare /tmp/cutover-A.json /tmp/cutover-B.json`. Titles, meta, canonical, JSON-LD, `<main>` text hash, hrefs and the sitemap set must be identical.
9. ⚠ **Switch and resume.**
   - Set `LV_CONTENT_STORE=db` and the VM env (§6).
   - `gh workflow enable` every workflow whose `/tmp/wf-before.json` state was `active`, then verify with `gh workflow list --all --json name,state` that it equals the saved states. Restore `LV_CONTENT_CUTOVER_HOLD` to the exact saved value/absence only **after** DB bindings and workflow states are verified; check the variable and route behavior.
   - `sudo systemctl enable --now lv-supervisor.timer`, and verify with `systemctl is-enabled lv-supervisor.timer`.
   - Observe the first automated publish end to end.

- **Abort** at any step: if step 7 ran, unset Production `CONTENT_SOURCE` (⚠) and redeploy main; restore legacy writer/VM bindings. Restore workflow states from `/tmp/wf-before.json`, verify them, then restore `LV_CONTENT_CUTOVER_HOLD` to its saved value/absence and verify. Restore the timer last. Never clear the hold while the production reader/writers are in mixed modes.

**7.3 Rollback**

| level | trigger                     | action                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1    | bad record                  | `unpublish` / `rollback --to-rev n` (prod needs a go); deploy + smoke automatic, resumable via `content deploy`                                                                                                                                                                                                                                                                                                                                |
| L2    | read path broken or DB down | Freeze writers (§7.2 step 1). `git switch -c l2-restore origin/main && content restore-snapshot --from https://libertyvillage.co --root .` (no DB; pinned and digest/byte-verified). Commit `data/` + `public/media/` via the code flow. ⚠ Production `CONTENT_SOURCE=json` + redeploy. ⚠ `LV_CONTENT_STORE=git`, VM store unset. It restores the last **deployed** live state; DB publishes that never deployed are recovered from Neon PITR. |
| L3    | JSON path regression        | revert the reader PR via the code flow                                                                                                                                                                                                                                                                                                                                                                                                         |

**7.4 Retirement (P3).** All must hold:

- ≥ 14 days in prod on db;
- one DB publish per active writer kind;
- the L1 and L2 drills passed (§9 S5, S13);
- no prod L2.

Then retire `data/*.json` as the source and the legacy PR paths. Locked evals are re-frozen or retired by the **eval owner only**. `docs/autonomous-promotion-acceptance-spec.md` B1 is superseded by John's decision, recorded by the eval owner.

## 8. Build packages

**All packages pass:**

- `npm run lint`;
- `npm run build` with `CONTENT_SOURCE` unset;
- `test:automation`, `test:supervisor`, `test:supervisor:acceptance`, `test:news-pilot` and `test:content`;
- `shasum -a 256 -c evals/*.sha256`.

Content tests use `tests/content/helpers/db.mjs`: it reads `CONTENT_TEST_DATABASE_URL` (no default port), creates `lv_test_<pid>_<rand>`, migrates, drops on exit and refuses non-localhost. CI uses a `postgres:18` service.

**Parallelism:** at hour 0, A starts, and B/C/D do only their DB-free work (listed below). **Milestone A1 "store landed"** = migration + `db.mjs` + `canonical.mjs` + `validate.mjs` + a **fully working** `store.mjs` with its concurrency tests, merged to the feature branch. B, C and D rebase on A1 before any DB-touching code; there are no stubs. No file has two owners.

**Package A: foundation.**

- **Owns:**
  - `scripts/content/{migrations/0001_content.sql, db, canonical, validate, store, cli, seed, parity, export, build-export, snapshot-fetch, restore-snapshot, parity-crawl}.mjs` and `lib/content/datasets.json`;
  - the `data/*.json` canonicalization;
  - `package.json` + `package-lock.json` (dep `pg`; scripts `prebuild`, `content`, `test:content`) and `.gitignore` (`.content-export/`, `.content-restore/`, `public/content-snapshot/`);
  - `.github/workflows/content-ci.yml`;
  - `tests/content/{helpers/db.mjs, store, store-concurrency, seed-parity, export, build-export, snapshot-fetch, validate, env-guard}.test.mjs`;
  - `docs/runbooks/content-store.md`.
- **A1:**
  - Every §4.2 function's I/O and errors.
  - Real triggers: first publish sets `published_at` once; replay changes nothing; a payload/sha/`published_at` re-update raises; an update without the session flag raises; a reordered-key `json` payload with the flag on raises (no `jsonb` equality); rollback to a published rev succeeds; rollback to a never-published rev fails.
  - Topic-queue insert-only; no deletes; claim/lease-lost on every mutator; `adminAction` emptying/guide-hub refusals; `reset` keeps `live_seq` monotonic.
- **A2 concurrency** (two real connections):
  - a double publish → one publish;
  - a repair added after review → the stale publish fails the digest check;
  - publish A then B on one key, then compensate A → `ConflictError` and B stays live;
  - parallel inserts get unique positions;
  - an expired claim cannot mutate.
- **A3 interleaving (B3):** export → another publish updates X → submit from the old export touching X → `ConflictError`; not touching X → X is not updated.
- **A4 seed:** idempotent; add/update/delete/reorder reconcile with `--prune`; parity PASSes for `origin/main` and `origin/staging` and fails on a 1-byte mutation.
- **A5 export/build:**
  - Byte-equal for all 9.
  - `CONTENT_BUILD_TARGET=test CONTENT_SOURCE=db npm run build` on the test DB succeeds, with the route table unchanged from json mode (● for the 6 param routes).
  - An unreachable DB (`postgres://127.0.0.1:1/x`) fails the build within timeouts, both cold and with a warm `.next/cache`.
  - Binding refusals, each exit 1: `VERCEL=1 VERCEL_ENV=production` + lv_staging; `VERCEL=1 VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=feature-x`; `VERCEL_ENV` unset with no test binding; `VERCEL=1 CONTENT_BUILD_TARGET=test`.
  - json mode writes `build.json` only and makes no connection.
  - Manifest schema, including media sha/size.
- **A6 snapshot-fetch** (fake HTTP): identity switch between M1/M2 → retry → success; 3 switches → `identity-unstable`; media byte mismatch refuses; nothing is installed on failure.
- **A7:** paste the real lv_staging and neondb `verify-parity` output.

**Package B: submit, gate, deploy/smoke, notify.**

- **Owns:**
  - `scripts/content/{submit, images, gate, review-document, repair-rules, repair-adapter, lenses, deploy, smoke, notify}.mjs`;
  - `scripts/automation/review-agent.mjs` (§4.7) and `scripts/automation/news-preflight.mjs` (`export` on `structuredData` and `trimEvidence` only);
  - `tests/content/{submit, images, gate, gate-resume, review-document, repair-adapter, smoke}.test.mjs` and `tests/content/fixtures/**` (§9 candidates and scripts).
- **Hour 0:** document, repair rules/adapter, lenses, review-agent changes, image checks, smoke (fake HTTP), notify.
- **B1 submit:**
  - Every §4.4 kind, including refusal of a deletion, 2 post inserts, a queue mutation, an unknown field and a bad image.
  - A changed **and** a new neighborhood image → `/media` rewrite → export → page smoke.
  - blog-live date/author/topic policy, including a stale `--generated-at`.
  - news uses `result.now`/evidence/`structuredData`, and a missing `--news-out` fails.
  - A historical manual post edit is not subject to generation checks.
  - Unchanged-row skip; idempotent replay and mismatch; asset dedupe.
- **B2 real-function adapter tests** (`preflightDecision`, `validateRecordRepair`, `evaluateRepairProgress`; only `runStructured` mocked):
  - a non-candidate key is rejected;
  - a guide-hub repair validates;
  - a news repair that fails publish-ready blocks;
  - round 0 7.2 `repair` → round 1 6.5 gives `not-converging`, and a regression test shows prior-rounds-only history would have returned `continue`;
  - fractional overall round-trips;
  - the legacy fixer prompt is byte-identical.
- **B3 scripted gate:**
  - pass → publish → deploy → smoke → one Slack line, not repeated on re-run;
  - repair→pass; unrepairable / exhausted / not-converging; conflict;
  - propagation (hook 500; freshness timeout) → exit 3, then `deploy` → 0;
  - bad render → compensate → admin submission smoked absent.
- **B3 crash/resume:** a process kill injected **after** each of `recordRound` (go, repair, terminal), `addRepairRound`, `publishSubmission`, hook POST before `markPhase`, and Slack delivery before `markPhase('notified')`. Rerun resumes without a second `recordRound`/review. Only the last case repeats one Slack line with the same `#id`.
- **B4 smoke** (fake HTTP + real store):
  - A and B on the same key, coalesced (A `superseded`, B `passed`, no compensation);
  - independent keys in one build;
  - a still-pending successor (A waits, then exit 3, never compensates);
  - an unpublish successor (absent entry);
  - an identity change mid-check (retry);
  - queue/seen snapshot adapter;
  - admin unpublish/rollback: hook failure → exit 3 → `content deploy` resumes → passed;
  - `content deploy` replays all pending.
- **B5:** `review-agent.mjs` imports with no side effects; its CLI and every locked eval stay green.
- **B6:** one real-model lv_staging gate; paste the `gate_rounds` row.

**Package C: GHA writers + staging entrypoints.**

- **Owns:** `.github/workflows/{discover-businesses, weekly-topic-discovery, news-autopublish, weekly-seo-improvements, weekly-blog}.yml`, `scripts/seo-improve-agent.js` (`SEO_MODE`), `scripts/content/seo-guard.mjs`, and new `tests/automation/content-workflows.test.mjs`.
- **Hour 0:** route job, YAML, seo-guard.
- **Acceptance:**
  - Workflow tests: staging ref + production target fails; unknown ref fails; env bindings present; legacy steps byte-identical; SEO code lane reachable with `LV_CONTENT_STORE=db`. A repo variable `LV_CONTENT_CUTOVER_HOLD=1` permits only `workflow_dispatch` with `--ref staging`, `store=db`, `content_target=staging` in all writer route jobs (and D's ingest route); schedules, repository_dispatch and other refs/targets terminate before writer side effects. Unset/0 preserves normal behavior.
  - seo-guard: data edit + summary/run log → submit; no-op → exit 0; mixed data+template → `mixed-blocked`; code lane with a `data/` change fails.
  - §9 S9/S10 run URLs **or** the exact recorded staging-ref dispatch refusal and a pending cutover gate; neither refusal is a pass. `LV_CONTENT_CUTOVER_HOLD=1` route guard tests reject all non-staging events even while a workflow is temporarily enabled.

**Package D: VM + supervisor-ingest DB mode.**

- **Owns:** `scripts/supervisor/{host-run, ingest-contract, ingest-db, content-monitor, ledger}.mjs`, `.github/workflows/supervisor-ingest.yml`, `ops/exedev-supervisor/{lv-supervisor.env.example, README.md}`, and `tests/supervisor/content-store-mode.test.mjs`. All edits are additive; legacy is unchanged when `LV_CONTENT_STORE` is unset.
- **Hour 0:** contract, `ingest-db.mjs` with fake `gh`/CLI, monitor, ledger states.
- **Unit tests:**
  - host-run pinned fetch; history adapter; `candidate/post.json`-only diff;
  - store/target validation (staging cannot use repository_dispatch; local transport refused for production);
  - status lifecycle pending→success|failure (`published:<id>:seq:<liveSeq>` on both gate exits 0 and 3), and `ingest-error:<step>`; deterministic `monitorContentPublish` tests inject status/manifest/page getters and virtual clock to distinguish stale/spoofed success, fresh 200+title, ingest error, status timeout and propagation timeout;
  - creator allowlist (bot, or `LV_STATUS_CREATOR` for local staging only);
  - workflow YAML has `GH_TOKEN` on `ingest-db`, and `needs: [resolve-owner, route]` on both ingest jobs;
  - `PUBLISHED_LIVE` needs GET 200 + title and calls `consumeIntent`;
  - no secret in the env example (`sentinel-ops.test.mjs` green).
- **Acceptance:** legacy acceptance evals unchanged and green; §9 S11a; S11c at cutover. **Prerequisite for D's done: a new eval-owner-authored DB-mode acceptance eval (new files + manifest).**

## 9. Integrated UAT (staging alias on lv_staging; run in order)

Setup on the operator host:

- In zsh, define `content() { local verb=$1; shift; node --env-file=.env.content-staging.local scripts/content/cli.mjs "$verb" --actor uat:operator "$@"; }` and use `content` below (not a scalar command string). `export CONTENT_TARGET=staging CONTENT_DB_NAME=lv_staging RUN=$(date +%s)`; this wrapper supplies the mandatory operator actor for every mutator, including submit/admin/seed.
- `ALIAS=https://libertyvillage-git-staging-voxtur.vercel.app`;
- `STAGING_SHA=$(git fetch origin staging && git rev-parse origin/staging)`.

Evidence per scenario: command, stdout JSON, HTTP status + marker, `show`/`history`. Revisions come from command output and are never assumed. Each scenario deploys itself and waits on deployment identity, never on warm caches.

- **S0 Reset:**
  1. Record `DEP0=$(curl -sH "x-vercel-protection-bypass: $CONTENT_SITE_BYPASS" $ALIAS/content-snapshot/build.json | jq -r .deployment_url)`.
  2. `content reset --confirm-reset lv_staging --expect-db lv_staging`; then `content seed --from-ref $STAGING_SHA --apply --expect-db lv_staging`, recording `liveSeq` and `snapshotId`.
  3. `content deploy --target staging`.
  4. Poll the manifest until `deployment_url≠DEP0`, `live_seq==liveSeq` and `snapshot_id==snapshotId`.
- **S1 Parity:**
  - Each alias `/content-snapshot/<file>` is byte-equal to `git show $STAGING_SHA:data/<file>`.
  - Crawl the alias: `parity-crawl crawl --base $ALIAS --bypass-env CONTENT_SITE_BYPASS --remap-origin https://libertyvillage.co --out /tmp/s1-alias.json`.
  - Crawl a local `next start -p 3100` at `$STAGING_SHA` in json mode (`--out /tmp/s1-local.json`).
  - `parity-crawl compare` → zero diffs.
- **S2 Insert (scripted):**
  1. `content export --root /tmp/s2`.
  2. `content submit --kind manual --record-file tests/content/fixtures/uat-business.json --dataset businesses --baseline /tmp/s2/.content-export/manifest.json --idempotency-key uat:s2:$RUN` (untracked JPEG), recording `ID`.
  3. `content gate --submission $ID --script tests/content/fixtures/pass.json` → exit 0. Record `R1=published[0].rev`.
  4. Page 200 with the name, sitemap URL, `/media/…` 200 `image/jpeg`, one `[scripted]` success line.
- **S3 Rejected edit (scripted):** fresh export; `content submit --kind manual` with a changed description → `ID`; `content gate --submission $ID --script fixtures/unrepairable.json` → exit 2 `blocked/unrepairable`. The manifest rev is still R1 and the page shows the R1 marker. `list --submissions --state blocked` includes it; failure Slack.
- **S4 Repair (scripted):** fresh export; `content submit` with a fabricated claim → `ID`; `content gate --submission $ID --script fixtures/repair-then-pass.json` → exit 0, `repairs:1`. Record R3. `history` shows a `manual` rev then a `fixer` rev.
- **S5 Unpublish/rollback:**
  - `content unpublish --dataset businesses --key <k> --reason uat --idempotency-key uat:s5a:$RUN` → `smoke:"passed"`, with 404 and gone from the sitemap.
  - `content rollback --dataset businesses --key <k> --to-rev $R1 --reason uat --idempotency-key uat:s5b:$RUN` → 200 with the R1 marker, new rev `source rollback`.
  - Rerunning either command → `existing:true`, no new rev. `history` lists every revision and action.
  - Separately, `unpublish --dataset guide-hub` → exit 2.
- **S6 Conflict:** `content export --root /tmp/a`; submit+gate an edit on the key; `content submit --dir /tmp/a --kind manual --idempotency-key uat:s6:$RUN` editing that key → exit 2 `conflict`, live rev unchanged.
- **S7 Propagation:**
  - `CONTENT_DEPLOY_HOOK_URL=https://127.0.0.1:9/x content gate --submission $ID` → exit 3, published, Slack warning; `content deploy --target staging` → exit 0.
  - The same with `unpublish` → exit 3, then `deploy` → 0.
- **S8 Fail-closed:** A5, run locally cold and warm. A failed Vercel build keeping the prior deployment is platform behavior.
- **S9 Discovery (GHA, real model):**
  - `gh workflow run discover-businesses.yml --ref staging -f store=db -f content_target=staging -f max=2`.
  - First record whether dispatch is accepted (§4.10).
  - Pass = `submissionId:null` (zero results, recorded) or a recorded gate outcome; if published, page 200 + image.
- **S10 Topics (GHA):** `gh workflow run weekly-topic-discovery.yml --ref staging -f store=db -f content_target=staging` → recorded outcome. If published, snapshot adapter passed.
- **S11a Blog via host-local harness (§4.10 commands):**
  - Positive: ledger terminal `PUBLISHED_LIVE`; statuses on `DATA_SHA` read `pending` then `success` with `target_url` 200 + title; `ingest-<ms>.log` shows validation, fetch/SHA, diff, submit, gate.
  - Negative (the harness with a payload whose data branch adds a second file) → `failure` `ingest-error:diff` → `INGEST_FAILED`.
  - GitHub transport is **not** accepted here (S11c).
- **S12 Isolation:**
  - `--ref staging -f content_target=production` → route fails;
  - `content gate --expect-db neondb --submission $ID` → TargetError;
  - `CONTENT_SITE_URL=https://libertyvillage.co` with lv_staging → TargetError;
  - `LV_INGEST_TRANSPORT=local LV_CONTENT_TARGET=production` → refused;
  - env-guard green; `vercel env ls preview | grep CONTENT_` shows names only.
- **S13 L2 drill:**
  ```
  git worktree add /tmp/l2 $STAGING_SHA && cd /tmp/l2 && npm ci
  env -u CONTENT_DATABASE_URL -u CONTENT_DATABASE_URL_UNPOOLED CONTENT_SITE_BYPASS=$CONTENT_SITE_BYPASS \
    node scripts/content/cli.mjs restore-snapshot --from $ALIAS --root /tmp/l2
  # restore saved the verified manifest locally; the JSON-mode build does not create one
  L2_MANIFEST=/tmp/l2/.content-restore/manifest.json
  L2_SOURCE=$(jq -r .deployment_url "$L2_MANIFEST")   # immutable deployed URL, not the mutable staging alias
  env -u CONTENT_DATABASE_URL -u CONTENT_DATABASE_URL_UNPOOLED CONTENT_SOURCE=json npm run build
  (env -u CONTENT_DATABASE_URL -u CONTENT_DATABASE_URL_UNPOOLED npx next start -p 3200 &) # verify ready before crawling
  node scripts/content/parity-crawl.mjs crawl --base http://localhost:3200 --media --manifest "$L2_MANIFEST" --out /tmp/l2-local.json
  node scripts/content/parity-crawl.mjs crawl --base "$L2_SOURCE" --bypass-env CONTENT_SITE_BYPASS --remap-origin https://libertyvillage.co --media --manifest "$L2_MANIFEST" --out /tmp/l2-source.json
  node scripts/content/parity-crawl.mjs compare /tmp/l2-source.json /tmp/l2-local.json   # zero diffs; --media hashes every manifest.media path on both origins
  ```
- **Cleanup:** repeat S0; `git worktree remove /tmp/l2`.
- **S11c (cutover step 7, not P1):** GitHub-transport staging ingest via `workflow_dispatch --ref staging` → `PUBLISHED_LIVE` with creator `github-actions[bot]`.

## 10. Findings disposition

"Recheck r1" is the independent verdict on 3144e3e; "r2 change" records the first revision's response. The independent r2 check at 29740db REJECTED it. The following r3 changes are pending a focused independent recheck; this table is not an approval.

| finding                           | recheck r1         | r2 change (section)                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 stranded content               | RESOLVED           | none (D2; §7.2 steps 2–5)                                                                                                                                                                                                                                                                                     |
| B2 reviewed bytes, races, resume  | NOT RESOLVED       | Controlled `published_at` NULL→ts trigger (§3). `recordRound` closes terminal decisions atomically. The resume table branches on the stored decision without re-recording. Claim/state checks sit on every mutator with a renewable lease (§4.2, §4.6 g0). Crash tests after each phase (B3).                 |
| B3 stale submissions              | RESOLVED           | none                                                                                                                                                                                                                                                                                                          |
| B4 adapters                       | NOT RESOLVED       | Convergence evaluated on `[...prior, current]` before persisting (§4.6 g4; B2 test). The sliced-range edit is limited to an invariant-preserving param/call-site change (§2, §4.7).                                                                                                                           |
| B5 invalidation vs outage         | RESOLVED (moot D1) | none                                                                                                                                                                                                                                                                                                          |
| B6 staging execution              | NOT RESOLVED       | Dispatch probe removed. S11a = host-local harness running the real `ingest-db.mjs` + monitor with real statuses (§4.10). Its gaps are stated. GitHub transport is checked at S11c after promotion, with no main change for UAT. S9/S10 are deferred if staging-ref inputs are refused.                        |
| M1 warm cache                     | RESOLVED           | binding hardened (M10)                                                                                                                                                                                                                                                                                        |
| M2 async conversion               | RESOLVED (moot D1) | none                                                                                                                                                                                                                                                                                                          |
| M3 validation / generation / news | NOT RESOLVED       | Generation checks apply only to new automated posts (blog lint; blog-live `validateSubmittedPost` with `--topic-key`/`--generated-at`). News `--news-out` supplies `now`/evidence and the exported `structuredData`. Inputs persist in `submissions.context` for every round (§4.4, §4.7).                    |
| M4 L2 backup                      | RESOLVED           | media sha/size + pinned fetch (NEW-N1)                                                                                                                                                                                                                                                                        |
| M5 images                         | NOT RESOLVED       | neighborhoods `image` in the registry and repair rules; `sourceRef` described as the rebuild source; changed/new neighborhood image test (§3, §4.4, B1)                                                                                                                                                       |
| M6 freshness/smoke                | NOT RESOLVED       | see NEW-M1, NEW-M2                                                                                                                                                                                                                                                                                            |
| M7 VM/GHA transport               | NOT RESOLVED       | `GH_TOKEN` on `ingest-db`; both ingest jobs `needs: [resolve-owner, route]`; owner/content-ship gates kept. The false "record-candidate-outcome in ingest" reference is corrected to VM-side (§2, §4.8, §4.9).                                                                                                |
| M8 seed-to-flip                   | NOT RESOLVED       | Disable ingest/coordinator too, drain all queued/pending states, fetch, wait for the MAIN_SHA JSON deployment via `build.json`, then A. Re-fetch + re-drain before the flip; explicit resume/abort verification (§7.2).                                                                                       |
| M9 hydration / mixed SEO          | NOT RESOLVED       | see NEW-M3                                                                                                                                                                                                                                                                                                    |
| M10 UAT/test wiring               | NOT RESOLVED       | Explicit build binding including localhost test and a staging-only preview (§4.3). `--env-file`/`set -a` loading (§4.10, §9). `resubmit` removed; submit-then-scripted-gate. Executable S13 with media hashes. S0 waits on deployment identity; `live_seq` never recycles. Configurable test DB URL (§6, §8). |
| M11 storage                       | NOT RESOLVED       | gc reclaims only never-published terminal candidates (not rollback targets), documented. `stats --alert` runs weekly in discover-businesses (§4.5, §4.8).                                                                                                                                                     |
| M12 notices                       | NOT RESOLVED       | Replay skips when `notified_at` is set; at-least-once with stable `#id` stated; delivery-before-mark crash test (§1, §4.6 g8, B3)                                                                                                                                                                             |
| N1 seed authorization             | RESOLVED           | none                                                                                                                                                                                                                                                                                                          |
| N2 claims                         | RESOLVED           | §2 re-verified with line refs                                                                                                                                                                                                                                                                                 |
| N3 CLI ambiguity                  | NOT RESOLVED       | `resubmit` removed; `--expect-db`/`--target`/`--actor` defaults defined; ingest recipe passes every argument (§4.5, §4.8)                                                                                                                                                                                     |
| S1–S3 scope cuts                  | RESOLVED           | none                                                                                                                                                                                                                                                                                                          |
| NEW-B1 immutable first publish    | new                | §3 trigger + session flag; A1 trigger tests                                                                                                                                                                                                                                                                   |
| NEW-M1 coalesced smoke            | new                | Own/superseded classification against the current DB rev, freshness waits, and M1/M2 identity sandwich (§4.6 g7); B4 tests                                                                                                                                                                                    |
| NEW-M2 queue/admin smoke          | new                | Dataset adapters (page/absent/snapshot). Admin submissions carry durable propagation for unpublish/rollback/compensate; emptying/guide-hub refusal (§3, §4.2, §4.6); B4 tests                                                                                                                                 |
| NEW-M3 SEO guard                  | new                | `seo-guard.mjs` post-export baseline + runner-artifact exclusions; `seo_lane` independent of the store (§4.8); C tests                                                                                                                                                                                        |
| NEW-N1 multi-request snapshot     | new                | Pinned fetch with identity retry; media `{path,sha256,byte_size}` (§4.3); A6 tests                                                                                                                                                                                                                            |
| Owner r2: Preview scope           | new                | Branch-scoped `CONTENT_SOURCE` + build guard + P1 verification (§4.3, §6, §7)                                                                                                                                                                                                                                 |
| Owner r2: repo-wide disable       | new                | Saved states, explicit enable/verify and abort path (§7.2)                                                                                                                                                                                                                                                    |

**r2 findings pending recheck at r3:** NEW-B1 → `json` payload uses byte-preserving `payload::text` equality, other columns null-safe, with a real reordered-key trigger test (§3, A1). R2-M1 → local S11a pins staging code SHA in a fresh clone, runs `npm ci` there and explicitly maps all child credentials/target/repository variables; `monitorContentPublish` has a virtual-clock injection seam (§4.9–4.10, D). R2-M2 → `LV_CONTENT_CUTOVER_HOLD=1` in every route forbids production events while deferred staging writer workflows are temporarily enabled, re-disabled and state-restored (§4.8, §7.2, C/D). R2-M3 → restore preserves verified manifest locally and `parity-crawl --manifest` hashes media on both JSON-mode and pinned DB-mode origins; operator commands use the zsh function with mandatory actor and DB variables unset for the L2 drill (§4.3, §4.5, §9).

**Known residual (not claimed resolved):** before promotion, the GitHub-event leg of staging ingest (trigger, YAML env, bot creator) is covered only by workflow unit tests. It is proven at S11c, and production repository_dispatch at the first watched post-cutover run.
