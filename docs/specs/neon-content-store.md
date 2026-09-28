# Spec: Neon content store for libertyvillage.co (r1)

Status: r1. It resolves the independent review of e709fa9 (REJECT) under owner decisions D1–D3 (2026-09-28). This is a builder contract.
Repo `jonkthomas/libertyvillage`, build base `origin/staging` @ `1a651b3`, Next.js 16.1.6 on Vercel. Plan only: no code, DB or settings change.

## 1. Outcome, decisions, non-goals

**Outcome.** Content publishes with a DB transaction after the existing automated gate: Opus review, pass = numeric `overall ≥ SCORE_THRESHOLD` (8) and no critical/high finding, plus the bounded fixer (`MAX_REPAIRS`=3). There is no PR, merge or promotion. The page is live within minutes via a Vercel deploy hook. Gate failures stay unpublished and notify Slack. Every successful publish posts one Slack line (title + URL).

**Binding decisions**
- **D1, read path = build-time export.** Publish = DB transaction + `POST CONTENT_DEPLOY_HOOK_URL` of the target. `prebuild` (`scripts/content/build-export.mjs`) writes live DB content into the build workspace as canonical `data/*.json`, plus `public/media/**` and `public/content-snapshot/**`.
  - **`lib/data.ts`, `lib/links.ts`, pages and components stay unchanged and synchronous.** There is no runtime DB read, `unstable_cache`, `revalidateTag`, revalidate route or media route.
  - DB down → the prebuild fails → the previous deployment keeps serving.
- **D2.** The 4 businesses, 7 topic-queue entries, 7 discovery-seen entries and 4 images stranded on `staging` already passed the Opus gate (#168, #170, #171). They go live with the code promotion staging→main and are seeded from that exact main SHA, with **no re-gate**.
- **D3.** Cut the `content-mirror` branch, `content-admin.yml` and a generic events table. The VM keeps its GitHub transport and reads the public `/content-snapshot/*`. SEO v1 is data-only via the DB, with a separate code-only PR lane; mixed output is blocked. The legacy path stays behind `LV_CONTENT_STORE=git|db` until cutover. Locked evals (`evals/*.sha256`) stay byte-identical; DB-mode acceptance evals are new files.

**History scope.** Every site-dataset and topic-queue record has revision history (`content.revisions` + `content.actions`). `discovery_seen` is insert-only operational memory: its only mutable field, `outcome`, records the submission that set it, and it has no revision history by design.

**Non-goals (v1):** admin UI or workflow (the CLI is the surface); changes to URLs, templates, `lib/meta.ts` or `lib/schema.ts`; moving `public/images/**` (it stays in git); retiring the legacy machinery (§7.4).

## 2. Verified current state (authoritative for builders)

**Readers.** `lib/data.ts` `loadJSON` reads 7 files: services, topics, neighborhoods, businesses, posts, buildings and guide-hub. No other code under `app/`, `lib/` or `components/` reads `data/`.

**Canonical form.** Files already in `JSON.stringify(x,null,2)+'\n'` form: businesses, posts, topics, topic-queue, discovery-seen. Neighborhoods is canonical but lacks the trailing `\n`. Services, buildings and guide-hub are not canonical. **A normalizes all 9** in one code-flow commit, with a `JSON.parse` deep-equal proof, so "export == source" is byte equality everywhere.

**Keys.** Site arrays use `slug`; `guide-hub` is a slug-less singleton (`lib/types.ts:144`). topic-queue is `{version:1,topics}`, keyed by `topics[].key` = `topicKey(kind,title,branchPrefix)` (`topic-queue.mjs:57`, 64-hex). discovery-seen is a key-sorted map `norm(name)→"YYYY-MM-DD"` (`discover-businesses.mjs:101-109`).

**Gate functions (exact)**

| function | contract |
|---|---|
| `preflightDecision` | `({verdict, contentSha, attempts, maxRepairs, kind, changedFiles}) → 'go'\|'block'\|'unrepairable'\|'repair'`. It calls `evaluateVerdict` then `classifyFindings`; repairability comes from `KIND_POLICIES[kind].repairablePaths`; topic-discovery is `noFixer`. |
| `validateRecordRepair` | `(file, orig, repaired, {maxBytes}) → {ok, errors, changedFields}`. Explicit rules only for posts, businesses and topics (`RECORD_FILES`, asserted by `record-repair.test.mjs:78`); others get the default (slug immutable). |
| `review-agent.planRecordRepair` (not exported) | `({kind, gateVerdict, payload:[{file,records}], validate, references, inventory, lintFindings}) → {plan, check, attempts, bytes}`. `validate(plan)` must return `{ok, errors}`; schema file enum = `RECORD_FILES`. |
| `evaluateRepairProgress` | `({history:[{attempt, overall, blockingCount}]}) → {decision:'continue'\|'abandon', reason}` |
| `evaluateVerdict` | `(raw, sha) → {ok, passed, errors, hasBlocking}`. `overall` is any number 0–10 (fractional). |
| `lintPost` | `(post, {businesses, now}) → {ok, findings}`. `resolveLintMode(env)` gives fail\|warn. |
| news checks | `validateDraft({post, newsArticleStructuredData, evidencePack, siteIndex, nowMs, imageExists})` then `evaluatePublishReadyDraft({validation, post, root, nowMs, posts, imageExists, config: AUTO_PUBLISH_CONFIG})`. `siteIndex = loadSiteLinkIndex(root)` reads `root/data/*.json`. News images must be `/images/…`. |
| `inventoryFromData` | `({services, topics, posts, blogImages, neighborhoodImages, ogImages, images})`. `selectReferenceRecords(source, businesses)` is in `scripts/lib/referenced-businesses.mjs`. |

`review-agent.mjs` has no main guard (lines 540-555 run the CLI on import), and `MAX_FIXER_ATTEMPTS`=4 is at line 67. Locked evals slice its source between `function recordRepairPrompt`…`async function planRecordRepair` and `async function review(`…`async function reviewContent`, and forbid the literal `>= 8`.

**Ingest and VM.** `validateIngestPayload` allows only `kind, data_sha, data_branch, topic_key, regenerations`. `supervisor-ingest.yml` is repository_dispatch only, checks out `main`, lacks `statuses: write`, maps no Anthropic secret and has a 10 min timeout. `host-run` diffs against `origin/staging`; its history is `branchPublicationHistory(git,'origin/main')`, consumed as `[{sha, posts, parentPosts}]` by `findQualifyingPublication`. Locked evals regex `host-run.mjs`, `supervisor-ingest.yml` (`blog-live`, `origin/main`, `--base main`), `autonomous-coordinator.yml` and `weekly-blog.yml`, so all edits to them are additive.

**Dispatch.** `main` already has `workflow_dispatch` on discover-businesses, weekly-topic-discovery, news-autopublish, weekly-seo-improvements and weekly-blog.

## 3. Schema (A: `scripts/content/migrations/0001_content.sql`)

Neon project `lib_village`, PG 18. `neondb` = production and `lv_staging` = staging, with an identical `content` schema applied by `content migrate` over `CONTENT_DATABASE_URL_UNPOOLED`. Payloads are `json`, not `jsonb`, to keep key order; nothing queries inside them.

```sql
create schema if not exists content;
create table content.schema_migrations (version text primary key, applied_at timestamptz not null default now());
create table content.meta (id boolean primary key default true check (id), live_seq bigint not null default 0);
insert into content.meta default values;
create table content.entries (
  dataset text not null check (dataset in ('businesses','posts','buildings','neighborhoods','services','topics','guide-hub','topic-queue')),
  key text not null, position integer,              -- position NULL until first publish; max+1 under the dataset lock
  live_rev integer, head_rev integer not null default 0,   -- live_rev is the ONLY visibility bit
  first_published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (dataset, key),
  constraint entries_key_shape check ((dataset='guide-hub' and key='guide-hub') or (dataset='topic-queue' and key ~ '^[0-9a-f]{64}$')
    or (dataset not in ('guide-hub','topic-queue') and key ~ '^[a-z0-9][a-z0-9-]{0,127}$')),
  constraint entries_position unique (dataset, position) deferrable initially deferred,
  check (live_rev is null or position is not null));
create table content.submissions (
  id bigserial primary key,
  kind text not null check (kind in ('seed','business','blog','blog-live','news','seo','topic-discovery','manual')),
  target text not null check (target in ('production','staging','test')),
  actor text not null, idempotency_key text not null unique, request_sha256 text not null,
  base_snapshot_id text,            -- export manifest the writer generated from (§4.3)
  state text not null check (state in ('open','gating','published','rejected','blocked','error','compensated')),
  decision text,  -- go|validation|lint|conflict|unrepairable|exhausted|not-converging|block|mixed-blocked|smoke-failed|error
  round integer not null default 0, repairs integer not null default 0, claim_token uuid, claimed_until timestamptz,
  live_seq bigint, deploy_requested_at timestamptz, smoke_passed_at timestamptz, notified_at timestamptz,
  created_at timestamptz not null default now(), closed_at timestamptz);
create table content.revisions (
  dataset text not null, key text not null, rev integer not null,
  payload json not null, payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('seed','writer','fixer','rollback','manual')),
  actor text not null, submission_id bigint references content.submissions(id),
  parent_rev integer, published_at timestamptz,   -- rollback targets require published_at NOT NULL
  created_at timestamptz not null default now(),
  primary key (dataset, key, rev), foreign key (dataset, key) references content.entries (dataset, key));
alter table content.entries add constraint entries_live_fk foreign key (dataset, key, live_rev)
  references content.revisions (dataset, key, rev) deferrable initially deferred;
create table content.submission_items (
  submission_id bigint not null references content.submissions(id), dataset text not null, key text not null,
  op text not null check (op in ('insert','update')),
  expected_live_rev integer,   -- from the base snapshot; NULL = insert; compared IS NOT DISTINCT FROM
  published_rev integer,       -- set by publish; compensation compares against it
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
-- Triggers: BEFORE UPDATE OR DELETE on revisions, gate_rounds, round_items, actions -> raise;
-- BEFORE DELETE on entries, discovery_seen -> raise (only `content reset` drops the schema).
```

**Derived states**
- An entry is *live* iff `live_rev is not null`; *unpublished* iff it is not live but has a revision with `published_at`; otherwise *never published*.
- Submission states: `open→gating→published(→compensated)` or `gating→rejected|blocked|error`.
- A live entry's `live_rev` changes only at publish. A rejected edit leaves the old revision live and is listed by `content list --submissions --state rejected,blocked`, not by entry listings.

**Registry** `lib/content/datasets.json` (scripts only, `with {type:'json'}`). Columns: file · key · route · smoke marker (HTML-escaped) · image fields:

| dataset | file | key | route | smoke marker | image fields |
|---|---|---|---|---|---|
| businesses | businesses.json | slug | `/directory/:key` | `name` | `image` |
| posts | posts.json | slug | `/blog/:key` | `title` | `image` |
| buildings | buildings.json | slug | `/buildings/:key` | `name` | `image` |
| neighborhoods | neighborhoods.json | slug | `/vs/:key` | `name` | — |
| services | services.json | slug | `/best/:key` | `pluralName` | `image` |
| topics | topics.json | slug | `/guide/:key` | `title` | `image` |
| guide-hub | guide-hub.json | singleton `guide-hub` | `/guide` | first 60 chars of `answerSummary` | — |
| topic-queue | topic-queue.json | `key` in wrapper `{version:1,topics}` | — | — | — |
| discovery-seen | discovery-seen.json | map key (sorted) | — | — | — |

## 4. Contracts

### 4.1 Canonical helpers and validators (A: `canonical.mjs`, `validate.mjs`)
- `recordSha(r)=sha256(JSON.stringify(r))`.
- `datasetDigest(d,records)=sha256(records.map(r=>keyOf(d,r)+':'+recordSha(r)).join('\n'))`; for discovery-seen it is computed over sorted `name:date` pairs.
- `blobSha1(t)=sha1("blob "+byteLen+"\0"+t)`.
- `serialize(d,records)` returns the canonical file text in its original shape.

**`validateRecord(dataset, key, record) → {ok, errors}`** checks storage validity only:
- **Identity:** `record.slug===key`. guide-hub must have no `slug` and key `guide-hub`. topic-queue requires `record.key===key` and, for inserts, `key===topicKey(kind,title,branchPrefix)`.
- **Fields:** required fields and types from `lib/types.ts`, plus the queue schema `key, kind∈{blog,seo}, title, source, rationale, addedAt, attempts, branchPrefix`.
- **Allowlist:** type fields plus keys observed at seed (`_discoveredAt`, `_needsEnrichment`); an unknown field fails.
- **Budget and safety:** ≤ 200 KB; the `SECRET_FINGERPRINT` check from `pi-session.mjs`.

Generation policy (dates, author, counts) lives per kind in §4.4.

### 4.2 Store API (A: `scripts/content/store.mjs`, `pg`; each mutator = one transaction)
```js
openDb({unpooled=false, expectDb}) -> {query, tx(fn,{isolation}), close, dbName, target}
  // TargetError unless current_database()===expectDb and dbName ∈ {neondb→production, lv_staging→staging,
  // lv_test_* on 127.0.0.1|localhost→test}. Never reads DATABASE_URL/POSTGRES_*/PG*. connect 10s, statement_timeout 30s.
readLive(db, {datasets=ALL}) -> Snapshot        // one REPEATABLE READ READ ONLY tx
  // {schema:1, db, target, live_seq, snapshot_id:<40-hex sha1(live_seq+digests)>, generated_at,
  //  datasets:{[d]:{count, digest, entries:{[key]:{rev, sha}}, records}}, media:[paths referenced by live payloads]}
resolveAssets(db, [{sha256}]) -> [{sha256, path|null}]
createSubmission(db, {kind, target, actor, idempotencyKey, baseSnapshotId,
    items:[{dataset,key,op,payload,expectedLiveRev}], assets:[{sha256,path,contentType,bytes}], discoverySeen:[{nameKey,firstSeen}]})
  -> {submissionId, existing, items:[{dataset,key,op,rev,expectedLiveRev}], discoverySeenAdded}
  // Same key + same request_sha256 -> existing:true, no writes; different sha -> StateError('idempotency-mismatch').
  // Entries inserted if absent, then SELECT … ORDER BY dataset,key FOR UPDATE; rev=head_rev+1.
  // Precheck live_rev IS NOT DISTINCT FROM expectedLiveRev, else ConflictError{conflicts}, nothing written.
  // Writes revisions (source writer|manual, parent_rev=expected), submission_items, round-0 round_items;
  // assets ON CONFLICT (sha256) DO NOTHING; discovery_seen ON CONFLICT DO NOTHING.
claimSubmission(db, id, {owner, leaseSeconds=2700}) -> {token}      // ClaimError if held and unexpired
releaseClaim(db, id, token)
getSubmission(db, id) -> {submission, items, rounds:[{…, items:[{dataset,key,rev,payload,payload_sha256}]}]}
recordRound(db, id, token, {round, contentSha, candidateDigest, verdict, overall, passed, blockingCount, lint, decision, scripted})
  // round===submissions.round; open->gating; StateError if the row exists.
addRepairRound(db, id, token, {fromRound, repairs:[{dataset,key,payload}]}) -> {round, items}
  // needs gate_rounds(fromRound).decision==='repair' and fromRound===current; fixer revisions; next round vector = previous
  // with the repaired entries replaced; round+=1, repairs+=1.
publishSubmission(db, id, token, {actor}) -> {liveSeq, published:[{dataset,key,op,rev}]}
  // Idempotent when already published. Otherwise: (1) submission row FOR UPDATE, state gating, claim matches;
  // (2) latest round passed && decision 'go' && candidate_digest recomputed from round_items matches;
  // (3) pg_advisory_xact_lock(hashtext('content:'||dataset)) sorted, then entries ORDER BY dataset,key FOR UPDATE;
  // (4) every live_rev IS NOT DISTINCT FROM expected_live_rev, else ConflictError (tx rolls back);
  // (5) live_rev:=round rev, insert position=coalesce(max,-1)+1, published_at, published_rev, meta.live_seq+=1, state published.
rejectSubmission(db, id, token, {state:'rejected'|'blocked'|'error', decision})   // discovery_seen outcome 'rejected'
markPhase(db, id, 'deploy_requested'|'smoke_passed'|'notified')
compensateSubmission(db, id, {actor, reason}) -> {liveSeq, reverted:[{dataset,key,fromRev,toRev}]}
  // publish's locks; only if EVERY item live_rev===published_rev: restore expected_live_rev (NULL for insert),
  // actions('compensate'), live_seq+=1, state compensated. Else ConflictError{conflicts}, nothing changes.
unpublish(db, {dataset,key,actor,reason}) -> {liveSeq, fromRev}
rollback(db, {dataset,key,toRev,actor,reason}) -> {liveSeq, rev}   // toRev.published_at NOT NULL; new rev source 'rollback'
  // copies the payload and publishes ungated (already gated/seeded); refused for topic-queue
history(db, {dataset,key}) -> {entry, revisions:[{rev,source,actor,submissionId,payloadSha256,publishedAt,createdAt,live}], actions}
listSubmissions(db, {state, kind, target, dataset, key, since}) -> [{id,kind,state,decision,round,repairs,createdAt,closedAt,items:[{dataset,key,op}]}]
listEntries(db, {dataset, visibility:'live'|'unpublished'|'never'|'all'}) -> [{dataset,key,liveRev,headRev,position}]
markDiscoverySeen(db, nameKeys, {outcome:'added'|'rejected', submissionId})   // seen -> added|rejected only
stats(db) -> {databases:{[name]:bytes}, assets:{count, bytes, unreferenced}}
```
Error classes carry `.code`: `TargetError`, `ConflictError`, `StateError`, `ClaimError`, `ValidationError`. The CLI exits 2 for Conflict/Validation and 1 for the others.

### 4.3 Export, build-export, snapshot (A)

`content export --root <dir> --expect-db D` writes one `readLive` snapshot:
```
<dir>/data/{businesses,posts,buildings,neighborhoods,services,topics,guide-hub,topic-queue,discovery-seen}.json  (canonical)
<dir>/.content-export/manifest.json          (Snapshot minus records: the submit baseline, §4.4)
<dir>/public/media/<sha16>/<file>            (only with --with-assets)
```

**Build export.** `package.json` gets `"prebuild": "node scripts/content/build-export.mjs"`; Vercel's `npm run build` runs it. It is a no-op unless `CONTENT_SOURCE=db`. Otherwise:
- It reads pooled `CONTENT_DATABASE_URL` and binds the target: `VERCEL_ENV=production` requires `neondb`, `preview`/`development` require `lv_staging`, and a mismatch exits 1.
- 3 attempts total (waits 2s, 5s), each with a 10s connect timeout and a 30s statement timeout, and no cache.
- Any error, empty site dataset or `validateRecord` failure exits 1, so the build fails.
- It writes `data/*.json` (all 9), `public/media/<sha16>/<file>` for `snapshot.media`, and `public/content-snapshot/manifest.json` (the Snapshot without records, plus `files` and `media`).
- It also writes `public/content-snapshot/<file>` for all 9, byte-identical to `data/<file>`. This is the public, live-only L2 backup: no drafts, verdicts or evidence.

Media is served as static files by the Vercel CDN. The existing `vercel.json` immutable browser caching is safe because paths are content-addressed.

### 4.4 `content submit` (B: `submit.mjs`, `images.mjs`)

**Input modes**
- **`--dir <root>`** diffs `data/*` against `<root>/.content-export/manifest.json`, the immutable baseline and never the DB's current state. An unchanged `recordSha` is **skipped** (no spurious updates). A changed sha becomes `update` with `expectedLiveRev` = the manifest rev; a new key becomes `insert` with NULL. A manifest key missing from the workspace → `ValidationError` (no deletes). DB keys absent from the manifest (concurrent inserts) are ignored. `baseSnapshotId` = the manifest's `snapshot_id`.
- **`--record-file f --dataset d`** is a single record; `--baseline <manifest>` supplies the expected rev and is required for updates.

**Kind policy** (checked before any write; the same deterministic checks run at round 0 and after every repair):

| kind | datasets / ops | limits | deterministic checks |
|---|---|---|---|
| business | businesses insert, plus discovery-seen rows `outcome='seen'` | 1–25 | validators, images |
| blog, blog-live | posts insert | exactly 1 | validators, `lintPost` (mode from `resolveLintMode`), images |
| news | posts insert | exactly 1 | validators, `lintPost`, `validateDraft` + `evaluatePublishReadyDraft` with evidence; image must be `/images/…` (no conversion) |
| topic-discovery | topic-queue insert | 1–25 | validators, duplicate key/title against the live queue |
| seo | services, topics, neighborhoods, buildings, guide-hub, businesses, posts; insert/update | ≤ 15 records, ≤ 2 inserts (**new DB policy**; the legacy rail caps files) | validators, images |
| manual | one site record, insert/update | exactly 1 | validators, images |

**Images** (each registry image field; `deployedRef` = `origin/main` for production, `origin/staging` for staging):
1. `/media/<sha16>/<f>` must exist in `content.assets`.
2. `/images/<p>` with a workspace file: the realpath must stay inside `<root>/public/images`. Tracked at `deployedRef` with an identical git blob → unchanged. Otherwise it becomes an asset: magic bytes JPEG `FFD8FF` / PNG `89504E47` / WebP `RIFF…WEBP`, size 1..2,000,000, name sanitized to `[a-z0-9._-]`, path `/media/<sha256[0:16]>/<name>` (or the existing path from `resolveAssets`), and the field is rewritten.
3. `/images/<p>` with no workspace file must be tracked at `deployedRef`, else `ValidationError('image-missing')`.

**Output:** `{"submissionId":17,"existing":false,"items":[{"dataset":"businesses","key":"wilbur-s-taco-shop","op":"insert","rev":1,"expectedLiveRev":null}],"assets":[{"sha256":"…","path":"/media/3f2a…/wilbur-s-taco-shop.jpg","deduped":false}],"discoverySeenAdded":1}`. Nothing to submit gives `{"submissionId":null,"reason":"no-changes"}` with exit 0.

### 4.5 CLI (A: `cli.mjs`; `submit|gate|deploy|resubmit` dynamic-import B's modules)

- `node scripts/content/cli.mjs <cmd>` writes one JSON line to stdout; stderr starts with `{"target":{"db":"…","host":"…"}}`.
- Exit codes: 0 ok; 2 expected negative (rejected, blocked, conflict, validation, compensated); 3 published but propagation pending; 1 error.
- Mutators require `--expect-db`.
- `CONTENT_SITE_URL` must equal `https://libertyvillage.co` iff target=production, else TargetError.

| cmd | args | stdout (exit 0) |
|---|---|---|
| `migrate` | `--expect-db` | `{"applied":["0001"]}` |
| `seed` | `--from-ref <sha>`\|`--from <dir>`, `--apply` (else dry-run), `--prune` | `{"inserted":n,"updated":n,"unchanged":n,"unpublished":[…],"repositioned":n,"refused":[…],"liveSeq":n}` |
| `verify-parity` | `--from-ref <sha>`\|`--from <dir>` | `{"match":true,"datasets":{"posts":{"count":70,"digest":"…","match":true},…}}`; exit 1 on mismatch |
| `export` | `--root <dir> [--with-assets]` | `{"snapshotId":"…","liveSeq":n,"files":[…]}` |
| `submit` | §4.4 + `--kind --actor --idempotency-key --target` | §4.4 |
| `gate` | `--submission N [--evidence f] [--script f]` | §4.6 |
| `deploy` | `--target T` | re-POSTs the hook, then smokes every published submission of T with `smoke_passed_at` NULL: `{"submissions":[{"id":17,"smoke":"passed"}]}` |
| `resubmit` | `--dataset d --key k --payload-file f --baseline <manifest> --actor S` | kind `manual` submission; then `gate` |
| `unpublish`, `rollback` | `--dataset d --key k [--to-rev n] --reason S --actor S` | `{"liveSeq":n,…}`, then deploy + smoke |
| `history` / `show` | `--dataset d --key k` / `--submission N` | store `history` / `getSubmission` minus payloads, plus `url` per item |
| `list` | `--submissions [--state a,b] [--kind k]` \| `--entries --dataset d [--visibility v]` | arrays per §4.2 |
| `stats`, `gc-assets [--apply]` | gc deletes assets referenced by no revision whose submission closed unpublished > 14 days ago | `{"deleted":n,"bytes":n}` |
| `reset` | `--confirm-reset <dbName>` | drop + re-migrate; **refused unless `lv_staging` or `lv_test_*`** |
| `restore-snapshot` | `--from <siteUrl> --root <dir>` | L2: fetch `/content-snapshot/*` + media, verify digests; no DB |

### 4.6 `content gate` (B: `gate.mjs`, `review-document.mjs`, `repair-rules.mjs`, `repair-adapter.mjs`, `lenses.mjs`, `deploy.mjs`, `smoke.mjs`, `notify.mjs`)

Resumable from DB state; concurrent runs are serialized by `claimSubmission`.
- **g0 claim:** held elsewhere → exit 1 `claimed`. Terminal state → re-notify if `notified_at` is NULL, exit 2. `published` → g6.
- **g1 deterministic** (round n = `submissions.round`): the §4.4 checks on the round vector. Context is a temp export root (`readLive`); for news, `siteIndex=loadSiteLinkIndex(tmp)` minus the candidate slug and `imageExists=createLocalImageExists(checkout)`. Failure → `recordRound(decision validation|lint)` → `rejected`, notify, exit 2.
- **g2 document:** header `content submission <id> round <n> kind <kind> target <target>`, then per item in `(dataset,key)` order `--- a/data/<dataset>.json#<key>` / `+++ b/data/<dataset>.json#<key>` and a 3-context unified diff of `JSON.stringify(base,null,2)` (empty for insert) against the candidate. `contentSha=blobSha1(doc)`; ≤ 500,000 bytes.
- **g3 review:** reuse an existing `gate_rounds(n)` (never re-review). Otherwise `reviewRows` (§4.7) with `lenses = kind==='manual' ? MANUAL_LENSES[dataset] : LENSES[kind]`. Grounded kinds (blog, blog-live, news) add `references=selectReferenceRecords(doc, liveBusinesses)` and `inventory=inventoryFromData({services,topics,posts,blogImages,neighborhoodImages,ogImages, images: liveMediaPaths})`, with listings from the checkout. News adds `evidence`.
- **g4 decision:** cut finding paths at `#`, then `d=preflightDecision({verdict: normalized, contentSha, attempts: repairs, maxRepairs: MAX_REPAIRS, kind: POLICY_KIND[kind], changedFiles: distinct 'data/<dataset>.json'})`. `POLICY_KIND` maps each automated kind to itself and `manual→'seo'`.
  - For n ≥ 1, also run `evaluateRepairProgress({history: rounds.map(r=>({attempt:r.round, overall:Number(r.overall), blockingCount:r.blocking_count}))})`; `abandon` → `blocked/not-converging`.
  - `recordRound` stores the raw verdict and a numeric overall.
  - Routing: `go`→g5; `repair`→fixer; `unrepairable`→`blocked/unrepairable`; `block`→`blocked/exhausted` if `repairs===MAX_REPAIRS`, else `blocked/block`.
- **Fixer:** `planRecordRepair({kind: POLICY_KIND[kind], gateVerdict: raw, payload: [{file:'data/<dataset>.json', records}] per file, validate: makeRowRepairValidator(…), references, inventory, lintFindings, schema: rowRepairSchema(files), describeContract: describeRowContract})`. Consume `result.plan` → `addRepairRound` → g1 (the checks rerun after every repair). A fixer exception → `blocked/unrepairable`.
- **g5 publish:** `publishSubmission`. `ConflictError` → `rejected/conflict`, notify, exit 2.
- **g6 deploy:** if `deploy_requested_at` is NULL, POST `CONTENT_DEPLOY_HOOK_URL` (2 attempts, 10s timeout, 2xx), then `markPhase`.
- **g7 smoke** (`x-vercel-protection-bypass: $CONTENT_SITE_BYPASS` when set):
  1. Freshness: poll `$CONTENT_SITE_URL/content-snapshot/manifest.json` every 20s for ≤ 15 min until `live_seq ≥ submission.live_seq` (coalesced builds satisfy it).
  2. Per item: skip if `manifest…entries[key].rev` ≠ the DB's current `live_rev` (superseded by a later publish). Otherwise require `entries[key].sha === recordSha(published payload)`; `GET route` → 200 containing the marker; `/sitemap.xml` contains `https://libertyvillage.co<route>` (slug datasets); each image URL → 200 `image/*`. Each GET gets 3 tries, 10s apart.
  3. Pass → `markPhase('smoke_passed')`.
  4. Hook failure or freshness timeout = **propagation** failure: content stays published, Slack warns, exit 3, resume with `content deploy`.
  5. Fresh data plus a failing page = **proven bad render** → `compensateSubmission`. Ok → deploy + smoke of the prior state (insert → 404), exit 2 `smoke-failed`. `ConflictError` → keep the newer content, Slack `compensation-conflict`, exit 2.
- **g8 notify** (`SLACK_WEBHOOK_URL`, idempotent via `notified_at`): success = `✅ <target> published: <title> — <url>` (one line per item, ≤ 10) + `(#id, kind, score, repairs)`; failure = kind, id, decision, score, top 3 findings, `content show --submission <id>`.

**stdout:** `{"submissionId":17,"state":"published","decision":"go","overall":8.5,"repairs":1,"liveSeq":42,"published":[{"dataset":"businesses","key":"wilbur-s-taco-shop","rev":2,"url":"https://…/directory/wilbur-s-taco-shop"}],"deploy":"requested","smoke":"passed","notified":true}`.

**`--script f` seam:** `{"reviews":[{overall,findings}],"fixes":[{files,reason}]}`, **refused unless dbName ∈ {lv_staging, lv_test_*}**. `model`/`commit_sha` are filled with `GATE_MODEL` and the real `contentSha`; `evaluateVerdict` and all deterministic checks still apply. Rounds are stored `scripted=true`; Slack lines are prefixed `[scripted]`.

### 4.7 Review/fixer adapters (B)

**`scripts/automation/review-agent.mjs`**: additive only, nothing inside the eval-sliced ranges, no literal `>= 8`.
- **Main guard** around lines 540-555: `if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))`.
- **`planRecordRepair` params:** optional `schema = RECORD_REPAIR_SCHEMA` and `describeContract = describeRepairContract`. The latter is passed to `recordRepairPrompt` as an optional param with an unchanged default; only its `payload.map(({file}) => describeContract(file))` call site changes.
- **New after `fixContent`:** `export async function reviewRows({kind, lenses, document, contentSha, references=[], inventory=null, evidence=null}) → raw`. It uses `reviewContent`'s prompt structure (`GROUNDING_LENS`/`INVENTORY_LENS` when present, `GATE_BAR`, the model/commit_sha line, DATA markers) and `runStructured(GATE_MODEL, VERDICT_SCHEMA, budget 4)`, and throws unless `evaluateVerdict(raw, contentSha).ok`.
- **New `rowRepairSchema(files)`:** RECORD_REPAIR_SCHEMA with file `enum=files`, `maxItems=files.length`, and records `{key, record}`.
- **Also export** `planRecordRepair`, `LENSES`, `VERDICT_SCHEMA` and `MAX_FIXER_ATTEMPTS`.
- **Unchanged:** `review()`, `fix()`, `fixRecords()`, `RECORD_FILES`, `RECORD_REPAIR_RULES`.

**`repair-rules.mjs`**: `CONTENT_REPAIR_RULES[file]`:

| file | immutable | repairable |
|---|---|---|
| posts, businesses, topics | **exactly** the legacy `RECORD_REPAIR_RULES` (not weakened) | legacy |
| services | `slug, name, pluralName, icon, image, searchVolume, competitiveness` | the rest |
| buildings | `slug, name, alternateNames, address, postalCode, latitude, longitude, yearBuilt, units, image` | the rest |
| neighborhoods | `slug, name` + every numeric stat (`avgRent1BR, avgRent2BR, transitScore, walkScore, bikeScore, population, medianAge, medianIncome`) | the rest |
| guide-hub | `population, medianRent, walkScore, transitScore`; identity = singleton key | `boundaries, history, prosCons, quickFacts, answerSummary` |
| topic-queue | no fixer | — |

Builders re-check these lists against `lib/types.ts` in the file header. `validateRowRepair(dataset, o, r)` delegates to `validateRecordRepair` for the legacy three (keeping the premise check) and runs the same algorithm over `CONTENT_REPAIR_RULES` for the others. `describeRowContract` renders `describeRepairContract`'s sentence shape.

**`repair-adapter.mjs`**: `makeRowRepairValidator({kind, candidates, ctx}) → (plan) → {ok, errors, repaired:[{dataset,key,payload}]}`.
The plan must be `isRecordRepairPlan`, target only candidate files and keys, and have no duplicate `(file,key)`. Per entry: `validateRowRepair`, then `validateRecord`; posts also get `lintPost`; news also gets `validateDraft` + `evaluatePublishReadyDraft`. Errors are prefixed `file: key:`; `ok` iff zero errors (never object truthiness).

**`lenses.mjs`**: `MANUAL_LENSES` for each of the 7 site datasets (DATA: supportable facts; CONTENT: neutral, no unsupported claims; SHAPE: fields and links match the dataset). Automated kinds reuse `LENSES[kind]` verbatim.

### 4.8 Workflows: writers (C), ingest (D)

**`route` job** (bash, no secrets), prepended to the 5 writers:
- store = `inputs.store` if it is `git|db`, else `vars.LV_CONTENT_STORE||'git'`.
- ref `refs/heads/main` → target = `inputs.content_target||'production'`.
- ref `refs/heads/staging` → target **must** be `staging` and store `db`, else fail. Any other ref fails.
- `content-staging` has no GitHub branch policy, so this is the hard restriction; `content-production`'s main-only policy is a second guard.

The existing steps move byte-for-byte into job `legacy` (`if: store=='git'`). Each writer's `workflow_dispatch` gains `store` (`auto|git|db`) and `content_target` (`production|staging`). The new job:
```yaml
  db:
    needs: route
    if: needs.route.outputs.store == 'db'
    environment: content-${{ needs.route.outputs.target }}
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions: { contents: read }
    env:
      CONTENT_DATABASE_URL: ${{ secrets.CONTENT_DATABASE_URL }}
      CONTENT_DATABASE_URL_UNPOOLED: ${{ secrets.CONTENT_DATABASE_URL_UNPOOLED }}
      CONTENT_DEPLOY_HOOK_URL: ${{ secrets.CONTENT_DEPLOY_HOOK_URL }}
      CONTENT_SITE_BYPASS: ${{ secrets.CONTENT_SITE_BYPASS }}   # absent in content-production
      CONTENT_DB_NAME: ${{ vars.CONTENT_DB_NAME }}
      CONTENT_SITE_URL: ${{ vars.CONTENT_SITE_URL }}
      CONTENT_TARGET: ${{ needs.route.outputs.target }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
    steps:
      - uses: actions/checkout@v4
        with: { ref: "${{ github.sha }}", fetch-depth: 0, persist-credentials: false }
      - run: git fetch --no-tags origin main staging
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - run: node scripts/content/cli.mjs export --root . --expect-db "$CONTENT_DB_NAME"   # all 9 datasets
      - run: <unchanged generator + its existing env>
      - run: node scripts/content/cli.mjs submit --dir . --kind <k> --target "$CONTENT_TARGET" --actor "gha:<wf>#${{ github.run_id }}" --idempotency-key "gha:<wf>:${{ github.run_id }}:${{ github.run_attempt }}" --expect-db "$CONTENT_DB_NAME" > submit.json
      - run: ID=$(jq -r .submissionId submit.json); [ "$ID" = null ] || node scripts/content/cli.mjs gate --submission "$ID" --expect-db "$CONTENT_DB_NAME"
```

**Per writer.**
- discover-businesses: `submissionId:null` = success (zero results); after the gate, `markDiscoverySeen` sets added/rejected.
- weekly-topic-discovery: `topic-queue.mjs discover` runs on the exported queue.
- news-autopublish: `publish.mjs` unchanged; `submit --kind news`, then `gate --evidence <out_dir>/evidence-<cluster>.json`; `news-preflight` skipped in DB mode; the open-`news/auto-*`-PR guard becomes `content list --submissions --kind news --state open,gating` = [].
- weekly-blog: only when owner=`gha`.
- weekly-seo-improvements: `seo-improve-agent.js --mode data` (new flag, C). Any changed path outside `data/` → exit 2 `mixed-blocked`, Slack, no submit. The code-only lane is the legacy PR job with `data/` excluded.

**supervisor-ingest.yml (D, additive).**
- Top-level `permissions` += `statuses: write`; `on:` += `workflow_dispatch: {inputs: {payload: {type: string, required: true}}}`.
- New `route` job validates `client_payload` or `fromJSON(inputs.payload)` with `validateIngestPayload` from the checked-out ref. repository_dispatch requires ref main, and store=db requires target production. workflow_dispatch requires `refs/heads/staging` and target staging.
- Legacy `ingest` gains `&& needs.route.outputs.store != 'db'`, otherwise unchanged.
- New `ingest-db`: same env block, `environment: content-<target>`, `timeout-minutes: 45`, `permissions: {contents: read, statuses: write, issues: write}`. Steps:
  1. Fetch `DATA_BRANCH`; require `FETCH_HEAD==DATA_SHA`.
  2. `git diff --name-only origin/staging...$DATA_SHA` must pass `validateDbIngestDiff`.
  3. `git show $DATA_SHA:candidate/post.json > candidate.json`; `export --root .`.
  4. `submit --kind blog-live --record-file candidate.json --dataset posts --baseline .content-export/manifest.json --target <t> --idempotency-key vm:<DATA_SHA>`, then `gate`.
  5. Status `content/publish` on `DATA_SHA` (`gh api repos/$REPO/statuses/$DATA_SHA`): exit 0 → `success` with `target_url` = live URL; exit 3 → `success` "published; propagation pending"; exit 2 → `failure` `decision=<d> submission=<id>`. An `if: failure()` step posts `failure` `ingest-error:<step>` for any earlier failure.
  6. Rejections run `coordinator.mjs record-candidate-outcome` as today.

**`ingest-contract.mjs` (D).** `allowedKeys` += `store` (optional `git|db`) and `target` (required for db: `production|staging`). New `validateDbIngestDiff(files)`: exactly `candidate/post.json`. `repositoryDispatchBody` refuses target staging. New `workflowDispatchBody(p)` = `{ref:'staging', inputs:{payload: JSON.stringify(p)}}`.

### 4.9 VM / host-run DB mode (D)
**Selection:** non-secret `LV_CONTENT_STORE=db`, `LV_CONTENT_TARGET=production|staging`, `LV_SITE_URL`. target=staging requires `LV_SITE_BYPASS`, allowed only on a local host-run and never in `/etc/lv-supervisor.env`; host-run refuses it for production. An unset store keeps legacy byte-for-byte.

**Steps**
1. Worktree from `origin/staging` (code).
2. `content-snapshot.mjs fetchSnapshot({siteUrl, bypass})` GETs the manifest and 9 files, verifies each `datasetDigest`, and writes them to `<worktree>/data/` (uncommitted).
3. `readPublicationHistory=()=>[{sha: manifest.snapshot_id, posts, parentPosts: []}]`, so `findQualifyingPublication` counts any snapshot post published this ISO week.
4. Generation and `blog-lint` as today. The image must be tracked at `origin/main` (production) or `origin/staging` (staging), else `BLOCKED_VALIDATION`.
5. Commit only `candidate/post.json` on `supervisor/blog-data-<ms>`; push via the proxy.
6. Dispatch: production `repositoryDispatchBody({…, store:'db', target:'production'})`; staging `POST /repos/{repo}/actions/workflows/supervisor-ingest.yml/dispatches` with `workflowDispatchBody`.
7. `content-monitor.mjs` polls `content/publish` for ≤ 60 min (creator `github-actions[bot]` only). On success it GETs `target_url` for ≤ 30 min, requiring 200 + title.
8. Terminals: new `PUBLISHED_LIVE`; existing `BLOCKED_*` by decision; new `BLOCKED_PROPAGATION` (published, never visible). Then `consumeIntent` and branch cleanup as today. `ledger.mjs` `TERMINALS` gains both new states.

### 4.10 Staging-ref entrypoints (B6)
- **Writers:** `gh workflow run <wf>.yml --ref staging -f store=db -f content_target=staging [-f max=2]` runs the **staging** version of a file that already exists on main with `workflow_dispatch`, checking out the staging code (`github.sha`) in `content-staging`.
- **Ingest:** `supervisor-ingest.yml` exists on main without `workflow_dispatch`; staging adds it.
  - **Hour-0 probe (C):** confirm `gh workflow run supervisor-ingest.yml --ref <throwaway branch>` starts, then delete the branch.
  - If GitHub refuses, staging ingest acceptance runs the `ingest-db` steps from the operator CLI (§9 S11b), and production ingest is first proven by the first live post-cutover run. There is no early promotion.
- **Production** DB runs only from `main` (schedule, repository_dispatch, or `--ref main`).
- **Operator staging runs** use an uncommitted `.env.content-staging.local` with no prod credentials: lv_staging URLs, the staging hook, `CONTENT_SITE_URL`, `CONTENT_SITE_BYPASS`, `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL`.

## 5. Seeding and reconciliation (A)

`content seed` is dry-run by default. Each run is one kind-`seed` submission with idempotency key `seed:<target>:<sha>`. Per source record:

| source record vs live DB | action |
|---|---|
| key absent | rev 1, source seed, published |
| same sha | no-op |
| different | new seed rev, published — **refused** if the entry has a non-seed revision newer than its last seed (exit 2, listed in `refused`) |

- **`--prune`** unpublishes live **seed-owned** keys (all revisions seed) absent from the source; it never deletes.
- **Positions** are rewritten to source order in the same transaction; the deferrable unique constraint makes swaps safe.
- **State datasets:** topic-queue keeps `key` and order. discovery-seen rows get `outcome='added'` if the name maps to a business, else `seen`.
- **Audit:** each change writes `actions('reconcile')`, and `live_seq` increments once per run.
- **`verify-parity`** compares count, ordered keys, per-record sha and digest for all 9 datasets, then byte-compares the serialized files; exit 1 on mismatch.

**Authorized now (N1).** Migrating and seeding both DBs before cutover needs no further go:
```
content migrate --expect-db lv_staging && content seed --from-ref <origin/staging sha> --apply --expect-db lv_staging && content verify-parity --from-ref <same>
content migrate --expect-db neondb     && content seed --from-ref <origin/main sha>    --apply --expect-db neondb     && content verify-parity --from-ref <same>
```
The production cutover reconciliation (§7.2 step 4) needs John's go.

## 6. Secrets and bindings (infra live; exact names)

| where | names / values | status |
|---|---|---|
| Vercel Production | `CONTENT_DATABASE_URL[_UNPOOLED]`→neondb; `CONTENT_SOURCE` unset until cutover, then `db` | set / cutover |
| Vercel Preview + Development | `CONTENT_DATABASE_URL[_UNPOOLED]`→lv_staging; Preview `CONTENT_SOURCE=db` | set / P1 |
| Vercel deploy hooks | `content-publish-production` (ref main), `content-publish-staging` (ref staging); the staging alias always tracks the latest staging deployment, hook builds included | exist |
| GH env `content-production` (main only) | secrets `CONTENT_DATABASE_URL`, `CONTENT_DATABASE_URL_UNPOOLED`, `CONTENT_DEPLOY_HOOK_URL`; vars `CONTENT_DB_NAME=neondb`, `CONTENT_SITE_URL=https://libertyvillage.co` | exists |
| GH env `content-staging` (no branch policy → §4.8 route guard) | same 3 secrets (lv_staging, staging hook) + `CONTENT_SITE_BYPASS`; vars `CONTENT_DB_NAME=lv_staging`, `CONTENT_SITE_URL=https://libertyvillage-git-staging-voxtur.vercel.app` | exists |
| GH repo | `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL`, `SERPAPI_API_KEY`, `PEXELS_API_KEY`; var `LV_CONTENT_STORE=git` until cutover | var new |
| VM `/etc/lv-supervisor.env` | `LV_CONTENT_STORE=db`, `LV_CONTENT_TARGET=production`, `LV_SITE_URL=https://libertyvillage.co` (non-secret) | cutover |
| tests | `CONTENT_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres` | harness refuses non-localhost |

Rules:
- Environment secrets reach a process only via an explicit job `env:`.
- Nothing reads the integration's `DATABASE_URL`, `POSTGRES_*` or `PG*` (`tests/content/env-guard.test.mjs` greps `app lib scripts components`).
- Prod credentials reach a laptop only via an explicit `vercel env pull --environment=production`.
- Every prod mutation after P0 (cutover steps, prod unpublish/rollback, Vercel env) needs John's go for that action.

## 7. Phases, cutover, rollback

**Phases**
- **P0:** seed both DBs (authorized).
- **P1:** A–D land via PRs into `staging`; Preview `CONTENT_SOURCE=db`; run §9 on staging; prod writers stay `git`.
- **P2:** cutover on John's go.
- **P3:** retirement.

**7.2 Cutover** (the whole runbook needs John's go; ⚠ = prod-mutating)
1. **Freeze and drain.** `gh workflow disable` the 5 writers. VM: `sudo systemctl disable --now lv-supervisor.timer`, then wait until `systemctl is-active lv-supervisor.service` ≠ active. Require no `in_progress` runs of the writers, `supervisor-ingest` or `autonomous-coordinator`, and no open PR into main/staging with head `auto/*`, `blog/auto-*`, `news/auto-*`, `seo/auto-*` or `supervisor/*`.
2. ⚠ **Merge staging→main.** Production `CONTENT_SOURCE` is unset, so the prebuild is a no-op. Per D2 the stranded businesses, queue and seen entries and images go live here via JSON.
3. **Baseline A.** `MAIN_SHA=$(git rev-parse origin/main)`; `node scripts/content/parity-crawl.mjs --base https://libertyvillage.co --out /tmp/cutover-A.json`.
4. ⚠ **Reconcile.** `content seed --from-ref $MAIN_SHA --apply --prune --expect-db neondb`, then `content verify-parity --from-ref $MAIN_SHA` → PASS, output pasted (includes the 7 seen entries).
5. **SHA recheck.** Require `origin/main == $MAIN_SHA`, else go back to step 4.
6. ⚠ **Flip.** Set Production `CONTENT_SOURCE=db` (check with `vercel env ls production | grep CONTENT_`) and trigger `content-publish-production`. Require the live manifest `live_seq` = the step-4 `liveSeq`, and every `/content-snapshot/<file>` byte-equal to `git show $MAIN_SHA:data/<file>`.
7. **Parity B.** Crawl B and compare with A: titles, meta, canonical, JSON-LD, `<main>` text, hrefs and the sitemap set are identical.
8. ⚠ **Switch writers.** Set `LV_CONTENT_STORE=db` and the VM env (§6); re-enable workflows and the timer; observe the first automated publish end to end.

**7.3 Rollback**

| level | trigger | action |
|---|---|---|
| L1 | bad record | `unpublish` / `rollback --to-rev n` (prod needs a go); deploy + smoke automatic |
| L2 | read path broken or DB down | freeze writers; `content restore-snapshot --from https://libertyvillage.co --root .` on a branch from main (no DB; digests verified); commit `data/` + `public/media/` via the code flow; ⚠ Production `CONTENT_SOURCE=json` + redeploy; ⚠ `LV_CONTENT_STORE=git`, VM store unset. The DB side is covered by Neon PITR. |
| L3 | JSON path regression | revert the reader PR via the code flow |

**7.4 Retirement (P3).** All must hold:
- ≥ 14 days in prod on db;
- one DB publish per active writer kind;
- the L1 and L2 drills passed (§9 S5, S13);
- no prod L2.

Then retire `data/*.json` as the source and the legacy PR paths. Locked evals are re-frozen or retired by the **eval owner only**. `docs/autonomous-promotion-acceptance-spec.md` B1 is superseded by John's decision, recorded by the eval owner.

## 8. Build packages

**All packages pass:** `npm run lint`; `npm run build` with `CONTENT_SOURCE` unset; `test:automation`, `test:supervisor`, `test:supervisor:acceptance`, `test:news-pilot`, `test:content`; `shasum -a 256 -c evals/*.sha256`. Content tests use `tests/content/helpers/db.mjs`: create `lv_test_<pid>_<rand>` on local `postgres:18`, migrate, drop on exit, refuse non-localhost.

**Parallelism:** at hour 0 A starts and B/C/D do only their DB-free work (listed below). **Milestone A1 "store landed"** = migration + `db.mjs` + `canonical.mjs` + `validate.mjs` + a **fully working** `store.mjs` with its concurrency tests, merged to the feature branch. B, C and D rebase on A1 before any DB-touching code; no stubs. No file has two owners.

**Package A: foundation.**
- Owns: `scripts/content/{migrations/0001_content.sql, db, canonical, validate, store, cli, seed, parity, export, build-export, restore-snapshot, parity-crawl}.mjs`; `lib/content/datasets.json`; the `data/*.json` canonicalization; `package.json` + `package-lock.json` (dep `pg`; scripts `prebuild`, `content`, `test:content`); `.github/workflows/content-ci.yml` (pull_request, `postgres:18` service); `tests/content/{helpers/db.mjs, store, store-concurrency, seed-parity, export, build-export, validate, env-guard}.test.mjs`; `docs/runbooks/content-store.md`.
- A1: every §4.2 function's I/O and errors; immutability triggers; the rollback-target rule; topic-queue insert-only; no deletes.
- A2 concurrency (two real connections): a double publish → one publish; a repair added after review → the stale publish fails the digest check; publish A then B on one key, then compensate A → `ConflictError` and B stays live; parallel inserts get unique positions; a crash after commit resumes at deploy.
- A3 interleaving (B3): export → another publish updates X → submit from the old export touching X → `ConflictError`; not touching X → X is not updated.
- A4 seed: idempotent; add/update/delete/reorder reconcile with `--prune`; parity PASSes for `origin/main` and `origin/staging`, fails on a 1-byte mutation.
- A5 export: byte-equal for all 9; `CONTENT_SOURCE=db npm run build` on local PG succeeds with the route table unchanged from json mode (● for the 6 param routes); an unreachable DB (`postgres://127.0.0.1:1/x`) fails the build within timeouts, cold and with a warm `.next/cache`; `VERCEL_ENV=production` + lv_staging fails; manifest schema checked.
- A6: paste the real lv_staging and neondb `verify-parity` output.

**Package B: submit, gate, deploy/smoke, notify.**
- Owns: `scripts/content/{submit, images, gate, review-document, repair-rules, repair-adapter, lenses, deploy, smoke, notify, resubmit}.mjs`; `scripts/automation/review-agent.mjs` (additive, §4.7); `tests/content/{submit, images, gate, gate-resume, review-document, repair-adapter, smoke}.test.mjs`; `tests/content/fixtures/**` (§9 candidates and scripts).
- Hour 0: document, repair rules/adapter, lenses, review-agent changes, image checks, smoke (fake HTTP), notify.
- B1: every §4.4 kind, including refusal of a deletion, 2 post inserts, a queue mutation, an unknown field and a bad image; unchanged-row skip; idempotent replay and mismatch; asset dedupe.
- B2 real-function adapter tests (`preflightDecision`, `validateRecordRepair`, `evaluateRepairProgress`; only `runStructured` mocked): a non-candidate key is rejected; a guide-hub repair validates; a news publish-ready failure blocks; 7.2→6.5 gives `not-converging`; fractional overall round-trips.
- B3 scripted gate: pass → publish → deploy → smoke → one Slack line (not repeated on re-run); repair→pass; unrepairable / exhausted / not-converging; conflict; propagation (hook 500; freshness timeout) → exit 3, then `deploy` → 0; bad render → compensate; resume after each phase.
- B4: `review-agent.mjs` imports with no side effects; its CLI and every locked eval stay green. B5: one real-model lv_staging gate; paste the `gate_rounds` row.

**Package C: GHA writers + staging entrypoints.**
- Owns: `.github/workflows/{discover-businesses, weekly-topic-discovery, news-autopublish, weekly-seo-improvements, weekly-blog}.yml`; `scripts/seo-improve-agent.js` (`--mode data`); new `tests/automation/content-workflows.test.mjs`.
- Hour 0: route job, YAML, §4.10 probe.
- Acceptance: workflow tests (staging ref + production target fails; unknown ref fails; env bindings present; legacy steps byte-identical; mixed SEO blocked); §9 S9/S10 run URLs.

**Package D: VM + supervisor-ingest DB mode.**
- Owns: `scripts/supervisor/{host-run, ingest-contract, content-snapshot, content-monitor, ledger}.mjs`; `.github/workflows/supervisor-ingest.yml`; `ops/exedev-supervisor/{lv-supervisor.env.example, README.md}`; `tests/supervisor/content-store-mode.test.mjs`. All edits are additive; legacy is unchanged when `LV_CONTENT_STORE` is unset.
- Hour 0: snapshot fetch/verify, contract, monitor, ledger states.
- Unit tests: a digest mismatch refuses; history adapter; `candidate/post.json`-only diff; store/target validation (staging cannot use repository_dispatch); only `github-actions[bot]` statuses count; `if: failure()` status; `PUBLISHED_LIVE` needs GET 200 + title; no secret in the env example (`sentinel-ops.test.mjs` green).
- Acceptance: legacy acceptance evals unchanged and green; §9 S11. **Prerequisite for D's done: a new eval-owner-authored DB-mode acceptance eval (new files + manifest).**

## 9. Integrated UAT (staging alias on lv_staging; run in order)

Evidence per scenario: command, stdout JSON, HTTP status + marker, `show`/`history`. Runs use the operator env (§4.10) unless marked GHA. Revisions come from command output, never assumed. Each scenario deploys itself; nothing relies on warm caches.
- **S0 Reset:** `content reset --confirm-reset lv_staging --expect-db lv_staging`; `content seed --from-ref $STAGING_SHA --apply --expect-db lv_staging`; `content deploy --target staging`; poll until `manifest.live_seq` = the seed `liveSeq`.
- **S1 Parity:** each alias `/content-snapshot/<file>` is byte-equal to `git show $STAGING_SHA:data/<file>`. `parity-crawl` of the alias (bypass header; sitemap URLs remapped from `https://libertyvillage.co` to the alias origin) against a local `next start` at `$STAGING_SHA` in json mode → zero diffs.
- **S2 Insert (scripted):** `content submit --kind manual --record-file tests/content/fixtures/uat-business.json --dataset businesses --target staging …` (untracked JPEG), then `gate --script tests/content/fixtures/pass.json` → exit 0. Record `R1=published[0].rev`. Page 200 with the name, sitemap URL, `/media/…` 200 `image/jpeg`, one `[scripted]` success line.
- **S3 Rejected edit (scripted):** `resubmit` with a changed description, then `gate --script fixtures/unrepairable.json` → exit 2 `blocked/unrepairable`. The manifest rev is still R1 and the page shows the R1 marker; `list --submissions --state blocked` includes it; failure Slack.
- **S4 Repair (scripted):** resubmit with a fabricated claim, then `gate --script fixtures/repair-then-pass.json` → exit 0, `repairs:1`. Record R3; `history` shows a `manual` rev then a `fixer` rev.
- **S5 Unpublish/rollback:** `unpublish` → 404 and gone from the sitemap; `rollback --to-rev $R1` → 200 with the R1 marker, new rev `source rollback`; `history` lists every revision and action.
- **S6 Conflict:** `export --root /tmp/a`; resubmit+gate on the key; `submit --dir /tmp/a` editing that key → exit 2 `conflict`, live rev unchanged.
- **S7 Propagation:** `gate` with `CONTENT_DEPLOY_HOOK_URL=https://127.0.0.1:9/x` → exit 3, published, Slack warning; `content deploy --target staging` → exit 0.
- **S8 Fail-closed:** A5, run locally cold and warm. A failed Vercel build keeping the prior deployment is platform behavior.
- **S9 Discovery (GHA, real model):** `gh workflow run discover-businesses.yml --ref staging -f store=db -f content_target=staging -f max=2`. Pass = `submissionId:null` (zero results, recorded) or a recorded gate outcome; if published, page 200 + image.
- **S10 Topics (GHA):** `gh workflow run weekly-topic-discovery.yml --ref staging -f store=db -f content_target=staging` → recorded outcome.
- **S11 Blog:** (a) local host-run with `LV_CONTENT_STORE=db LV_CONTENT_TARGET=staging LV_SITE_URL=<alias> LV_SITE_BYPASS=…` → staging-ref ingest → `content/publish` success → `PUBLISHED_LIVE`; (b) if the probe failed, the `ingest-db` steps run from the operator CLI.
- **S12 Isolation:** `--ref staging -f content_target=production` → route fails; `gate --expect-db neondb` in the staging env → TargetError; `CONTENT_SITE_URL=https://libertyvillage.co` with lv_staging → TargetError; env-guard green; `vercel env ls preview | grep CONTENT_` shows names only.
- **S13 L2 drill** (with `CONTENT_DATABASE_URL*` unset): `restore-snapshot --from <alias> --root /tmp/l2` verifies digests; `CONTENT_SOURCE=json npm run build && next start` in `/tmp/l2`; parity-crawl against the alias → zero diffs, including `/media`.
- **Cleanup:** repeat S0.

## 10. Findings disposition (review of e709fa9)

| finding | disposition |
|---|---|
| B1 stranded content before gate | Resolved by D2. Already gated (#168/#170/#171); it goes live with the code promotion (§7.2 step 2) and is seeded from that exact `MAIN_SHA` (step 4). The re-gate step is deleted; seen entries are counted in parity. |
| B2 publish not bound to reviewed bytes; unsafe revert | Resolved in §3 (immutable `round_items`, `candidate_digest`, triggers) and §4.2 (claim lease; publish verifies passing round + digest + expected revs under ordered row locks and advisory locks; rev/position allocated under locks; conditional compensation). Resumable phases in §4.6. Tests: A2, B3. |
| B3 stale whole-file edits | Resolved in §4.3/§4.4: manifest baseline with per-key rev+sha, unchanged rows skipped, expected revs carried, conflicts rejected at submit and publish, concurrent inserts ignored. Test: A3. |
| B4 adapters not drop-in | Resolved in §2 (real signatures) and §4.7 (`{ok,errors}` validator adapter; `result.plan` consumed; `rowRepairSchema`; `CONTENT_REPAIR_RULES` for all 7 site datasets incl. the singleton, legacy rules verbatim; `MANUAL_LENSES`; `numeric(4,2)`; round→attempt / blocking_count→blockingCount). Real-function tests: B2. |
| B5 invalidation vs stale-on-outage | Moot by D1: no runtime DB reads or `revalidateTag`; an outage fails only the build. |
| B6 staging refs can't run workflows | Resolved in §4.8/§4.10: the route job hard-restricts `--ref staging` to staging; checkout of `github.sha`; production only from main; staging `workflow_dispatch` ingest with an hour-0 probe and a CLI fallback (no early promotion); target threaded through CLI, snapshot, ingest, status and VM. |
| M1 warm cache defeats fail-closed | Moot by D1 (no data cache). Uncached prebuild with a target binding check; cold and warm tested (A5). |
| M2 async conversion hazards | Moot by D1: readers unchanged and synchronous. |
| M3 validators / skipped news checks | Resolved in §4.1 (per-dataset identity incl. guide-hub and queue `key`; storage validity split from generation policy) and §4.4/§4.6 (checks rerun after every repair; news `validateDraft` + `evaluatePublishReadyDraft` on a DB-exported context; `/media` validation). |
| M4 L2 depends on the DB | Resolved by D3 and §4.3: every deployment carries the full live snapshot + media from one `readLive` boundary; `restore-snapshot` needs no DB; Neon PITR. Drill: S13. |
| M5 tracked filename ≠ deployed bytes | Resolved in §4.4: blob compare against `deployedRef`, content-addressing, sha dedupe to the existing path, magic/size/containment checks; images in smoke. |
| M6 smoke can't prove the revision | Resolved in §4.6 g7: `live_seq` freshness + per-key rev/sha from the deployed manifest, per-dataset markers (guide-hub defined), sitemap and image checks; propagation (exit 3, resumable) is distinct from a bad render (conditional compensation). |
| M7 VM/GHA contracts incomplete | Resolved in §4.8 (ingest-contract `store`/`target`, `validateDbIngestDiff`, `statuses: write`, explicit env bindings, 45 min timeout, `if: failure()` status) and §4.9 (60 min monitor; staging via local host-run with bypass; no VM secrets). |
| M8 seed-to-flip window | Resolved in §7.2 (drain jobs, services and PRs, then `MAIN_SHA`, `--prune` reconcile, SHA recheck before the flip) and §5 (deferrable unique positions). Test: A4. |
| M9 exports don't hydrate; mixed SEO | Resolved in §4.8: every writer exports all 9 datasets before generating; SEO `--mode data` blocks mixed output; the code lane is separate. |
| M10 UAT not repeatable; test wiring | Resolved in §9 (reset/seed freeze, lv_staging-only `--script` fixtures, recorded revs, zero-result discovery accepted, bypass + sitemap remap, negative binding checks) and §8 (`lv_test_*` localhost harness, `content-ci.yml`). |
| M11 media caching/storage | Mostly moot by D1 (static CDN files, no media route). `stats` + `gc-assets` purge unpublished-candidate assets after 14 days. The capacity decision (upgrade vs retention) is flagged in Slack when the project exceeds 350 MB of the 512 MB free limit. |
| M12 rejected edits; success notice; seen history | Resolved in §3 (submissions listed apart from entries), §4.6 g8 (idempotent success line, D2) and §1 (discovery-seen scoped as audited insert-only memory). |
| N1 seed authorization | Resolved in §5/§6: P0 seeding is authorized; the cutover reconciliation and later prod mutations need a go. |
| N2 inaccurate "unchanged" claims | Resolved in §2 (verified inventory; `MAX_FIXER_ATTEMPTS` location), §4.4 (SEO record cap stated as new policy) and §4.3 (3 total attempts, per-attempt timeouts). |
| N3 ambiguous CLI/export | Resolved in §4.3 (exact `--root` layout), §4.4–4.6 (JSON I/O), §4.5 (list/show; `resubmit --payload-file`; admin workflow cut) and §8 (A owns package.json + lock). |
| S1 mirror branch | Accepted cut (D3): the VM reads the public `/content-snapshot/*`. |
| S2 duplicate bookkeeping; stubs | Accepted cut (D3): only `actions` (unpublish/rollback/compensate/reconcile); history from revisions; milestone A1 lands a working store before dependents. |
| S3 transition/manual surface | Accepted cut (D3): CLI only; SEO data/code lanes; legacy behind `LV_CONTENT_STORE`; retirement by criteria and a drill (§7.4). |
