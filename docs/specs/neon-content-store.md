# Spec: Neon content store for libertyvillage.co

Status: DRAFT for one independent review, then 5 parallel build packages.
Repo: `jonkthomas/libertyvillage`. Base for build: `origin/staging` @ `1a651b3`.
Author role: plan only. This doc changes no code or DB.

---

## 1. Outcome and non-goals

### Outcome
1. The site reads all runtime content from Neon Postgres. That means 7 site datasets: businesses, posts, buildings, neighborhoods, services, topics and guide-hub.
2. Automation state also lives in the DB: topic-queue and discovery-seen.
3. Content publishes with one DB transaction after the existing automated gate. The gate is Opus review, pass = score ≥ 8 and no critical/high findings, plus the bounded Sonnet fixer. There is no PR, merge, promotion or deploy for content.
4. A publish is visible on the live site within minutes, via on-demand `revalidateTag`.
5. Every record has revision history. Unpublish and rollback are single CLI commands.
6. SEO does not regress. URLs, HTML/metadata/JSON-LD and the sitemap URL set stay identical. Pages stay prerendered (ISR); none become dynamic.
7. Code changes keep the staging→main PR flow. It is untouched.

### Non-goals (v1)
- No admin web UI. The CLI plus one `workflow_dispatch` wrapper is the manual surface (§4.9).
- No `cacheComponents` / `"use cache"` migration.
- No change to URL structure, page templates, `lib/meta.ts` or `lib/schema.ts`.
- Existing images under `public/images/**` do not move.
- The candidate-ladder state stays in its GitHub issue (`scripts/automation/candidate-state.mjs`).
- No retries, rate limits or scale work beyond what correctness needs.
- Retiring the dead PR machinery is a later phase (§7.4). v1 is additive, and the legacy git path stays runnable behind a flag until then.

---

## 2. Current state (evidence)

### 2.1 Readers
- `lib/data.ts:1-150`: a synchronous `readFileSync` loader. It is the only place that reads `data/*.json` (`loadJSON`, lines 7-10).
- Importers (20):
  - `app/page.tsx`
  - `app/sitemap.ts`
  - `app/{best,blog,buildings,directory,guide,vs}/page.tsx`
  - `app/{best/[service],blog/[slug],buildings/[slug],directory/[slug],guide/[topic],vs/[neighborhood]}/page.tsx`
  - `app/news/page.tsx`
  - `app/world-cup/page.tsx`
  - `components/Header.tsx` (server component, rendered on every page)
  - `lib/links.ts:1-11` (9 importers of its own)
- Six dynamic routes use `generateStaticParams`. None sets `revalidate` or `dynamicParams`. Pages are fully static today, and `dynamicParams` defaults to true.
- There are no RSS/feed routes. `app/sitemap.ts` reads 6 datasets and uses `now` for most `lastModified` values.
- `tests/news-pilot/publish.test.mjs:531-532` regex-asserts `export function getNewsPosts` / `selectNewsPosts` in `lib/data.ts`.

### 2.2 Data

| file | shape | count main / staging | key | canonical `JSON.stringify(x,null,2)`? |
|---|---|---|---|---|
| businesses | array | 215 / 219 | slug | yes + `\n` |
| posts | array | 70 / 70 | slug | yes + `\n` |
| services | array | 60 | slug | **no** |
| topics | array | 24 | slug | yes + `\n` |
| neighborhoods | array | 15 | slug | yes, no `\n` |
| buildings | array | 20 | slug | **no** |
| guide-hub | object (singleton) | 1 | — | **no** |
| topic-queue | `{version:1,topics:[]}` | 16 / 23 | `topics[].key` | yes + `\n` |
| discovery-seen | map `normName → "YYYY-MM-DD"` | 214 / 221 | map key | yes + `\n` |

- Records carry fields outside `lib/types.ts`: `_discoveredAt`, `_needsEnrichment`. Key order must be preserved (§3.1).
- `origin/main..origin/staging` differs only in content: +4 businesses and their images, +7 discovery-seen entries, +7 topic-queue entries. This is the "stranded" content.

### 2.3 Writers today
All writers rewrite whole files, open a PR, and then run `autonomous-coordinator.yml`.

| writer | trigger | files | PR base |
|---|---|---|---|
| `scripts/discover-businesses.mjs` via `discover-businesses.yml` | Mon 13:00 UTC | businesses, discovery-seen, `public/images/businesses/<slug>.jpg` (Pexels) | staging, `--kind business` |
| exe.dev VM `scripts/supervisor/host-run.mjs`, then `supervisor-ingest.yml` (`blog-live`) | Sun/Wed 11:00 UTC timer | posts only; image must already exist | **main**, the only kind that ships while `owner.txt=exedev` |
| `weekly-blog.yml` / `weekly-blog-agent.js` | Sun/Wed, only when owner=`gha` (currently skipped) | posts, `public/images/blog/` | staging |
| `seo-improve-agent.js` via `weekly-seo-improvements.yml` | Mon | any `data/*.json` plus `app/ components/ lib/ public/images/` | staging, `--kind seo` (mixed code+content) |
| `topic-queue.mjs discover` via `weekly-topic-discovery.yml` | Mon | topic-queue (append-only, `policy.mjs:162-193`) | staging |
| news: `publish.mjs` + `news-preflight.mjs` via `news-autopublish.yml` | after daily discovery | posts | staging |
| manual one-offs (`generate-*-aeo.js`, `capture-*.js`, `populate-empty-categories.js`, `fix-broken-refs.js`, `generate-images.js`, `generate-service-faqs.js`, `generate-blog-*.js`, `generate-placeholder-images.mjs`) | manual | various | none |

Under exedev, cumulative promotion is off (`promotion-control.mjs:6-10`). Business, seo, topic and news PRs therefore stop at staging.

### 2.4 Gate and fixer building blocks to reuse
- `review-agent.mjs review-content` (lines 364-385) is already PR-free. It takes a diff file, an evidence file and a 40-hex content SHA. It is hard-coded to `kind=news`.
- `planRecordRepair` (426-445) is PR-agnostic. It takes a payload `[{file,records}]` and an injected `validate`.
- `news-preflight.mjs runPreflight` (76-184) is the working PR-free review→repair loop, capped at `MAX_REPAIRS`=3. It is the template.
- Pure functions to reuse:
  - `policy.evaluateVerdict`
  - `preflight.{preflightDecision,classifyFindings,validateRecordRepair}`
  - `record-rules.RECORD_REPAIR_RULES`
  - `recovery.evaluateRepairProgress`
  - `constants.{GATE_MODEL,FIXER_MODEL,SCORE_THRESHOLD,BLOCKING_SEVERITIES,MAX_REPAIRS}`
- Import hazard: `review-agent.mjs:540-555` runs its CLI at module top level with no main guard.

### 2.5 Locked evaluator artifacts
These must stay byte-identical and green in v1:
- `evals/full-autonomous-content-loop.sha256`
- `evals/weekly-grounded-publication-loop.sha256`
- `evals/canary104-grounding.sha256`
- `evals/topic-rotation.sha256`
- `evals/local-supervisor-acceptance.sha256` (16 files)
- `evals/weekly-growth-resilience.sha256`

They assert the git/PR mechanics this project replaces. v1 therefore **adds** the DB path next to the legacy path and does not edit them. Retiring them is §7.4 and belongs to the eval owner.

`docs/autonomous-promotion-acceptance-spec.md:199-200` (B1, "no new databases") is superseded by John's decision; the eval owner records that at retirement.

---

## 3. Schema

Target: the Neon project `lib_village` (PG 18).
- Database `neondb` holds production content.
- Database `lv_staging` holds staging content.
- The schema is identical in both. Everything lives in a dedicated schema `content`, away from `public` and `neon_auth`.
- Migrations live in `scripts/content/migrations/NNNN_*.sql`. They are applied by `content migrate` over `CONTENT_DATABASE_URL_UNPOOLED`.

### 3.1 Payload type decision
Record bodies are stored as **`json`, not `jsonb`**.
- `jsonb` reorders object keys. `json` keeps the exact key order, so a DB→JSON export round-trips and per-record hashes match the files.
- Nothing queries inside the payload. Filtering (category, featured, …) stays in app code, exactly as `lib/data.ts` does today.
- Indexed identity and state live in typed columns.

### 3.2 DDL (contract: Package A owns it; everyone codes against it)

```sql
create schema if not exists content;

create table content.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- Dataset registry is also in lib/content/datasets.json (§3.4).
create table content.entries (
  dataset     text not null check (dataset in
               ('businesses','posts','buildings','neighborhoods','services','topics','guide-hub','topic-queue')),
  key         text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,127}$'),  -- slug | 'guide-hub' | 64-hex topic key
  position    integer not null,          -- array order from JSON; new entries = max+1 (append semantics)
  status      text not null check (status in ('draft','in_review','published','rejected','unpublished')),
  head_rev    integer not null,          -- newest revision
  live_rev    integer,                   -- revision the site serves; NULL = not on site
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  first_published_at timestamptz,
  primary key (dataset, key),
  check ((status = 'published') = (live_rev is not null))
);
create unique index entries_dataset_position on content.entries (dataset, position);

create table content.submissions (
  id              bigserial primary key,
  kind            text not null check (kind in
                   ('seed','business','blog','blog-live','news','seo','topic-discovery','manual')),
  actor           text not null,         -- e.g. 'gha:discover-businesses#<run_id>', 'vm:blog-live:<data_sha>', 'cli:john'
  idempotency_key text not null unique,
  state           text not null check (state in
                   ('draft','in_review','published','rejected','blocked','error')),
  decision        text,                  -- go|block|unrepairable|exhausted|not-converging|validation|lint|conflict|smoke-failed|error
  content_sha     text,                  -- 40-hex binding of the CURRENT round (§4.3)
  repairs         integer not null default 0,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);

create table content.revisions (
  dataset        text not null,
  key            text not null,
  rev            integer not null,
  payload        json not null,
  payload_sha256 text not null,          -- sha256(JSON.stringify(payload)) — compact, key order preserved
  state          text not null check (state in ('draft','in_review','published','rejected','superseded')),
  source         text not null check (source in ('seed','writer','fixer','rollback','manual')),
  actor          text not null,
  submission_id  bigint references content.submissions(id),
  parent_rev     integer,                -- live_rev at creation time (base for diff/CAS)
  published_at   timestamptz,            -- set when it went live; rollback targets require NOT NULL
  note           text,
  created_at     timestamptz not null default now(),
  primary key (dataset, key, rev),
  foreign key (dataset, key) references content.entries (dataset, key)
);
alter table content.entries
  add constraint entries_live_fk foreign key (dataset, key, live_rev)
  references content.revisions (dataset, key, rev) deferrable initially deferred;

create table content.submission_items (
  submission_id bigint not null references content.submissions(id),
  dataset text not null, key text not null,
  rev integer not null,                  -- current candidate revision (advances with fixer rounds)
  base_live_rev integer,                 -- entries.live_rev when submitted; CAS on publish
  op text not null check (op in ('insert','update')),
  primary key (submission_id, dataset, key),
  foreign key (dataset, key, rev) references content.revisions (dataset, key, rev)
);

create table content.gate_rounds (
  submission_id  bigint not null references content.submissions(id),
  round          integer not null,       -- 0 = first review, n = after n-th repair
  content_sha    text not null,
  verdict        json,                   -- raw VERDICT_SCHEMA output
  overall        integer,
  passed         boolean not null,
  blocking_count integer not null default 0,
  lint           json,                   -- deterministic findings (blog-lint / validators)
  decision       text not null,          -- output of preflightDecision or a validation/lint code
  created_at     timestamptz not null default now(),
  primary key (submission_id, round)
);

create table content.discovery_seen (
  name_key   text primary key,           -- norm(name) exactly as scripts/discover-businesses.mjs computes it
  first_seen date not null,
  outcome    text not null default 'seen' check (outcome in ('seen','added','rejected')),
  submission_id bigint references content.submissions(id),
  created_at timestamptz not null default now()
);

create table content.assets (
  path          text primary key check (path ~ '^/media/[0-9a-f]{16}/[a-z0-9][a-z0-9._-]{0,120}$'),
  sha256        text not null unique,
  content_type  text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  bytes         bytea not null,
  byte_size     integer not null check (byte_size between 1 and 2000000),
  submission_id bigint references content.submissions(id),
  created_at    timestamptz not null default now()
);

create table content.events (           -- append-only audit trail for manual + automated actions
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null check (action in
    ('seed','submit','gate_round','publish','reject','unpublish','rollback','revalidate','smoke_failed','auto_revert')),
  submission_id bigint, dataset text, key text, rev integer,
  detail json
);
```

### 3.3 Status model (entries) and revision states

```
entry:    (new) ─submit→ draft ─gate start→ in_review ─pass→ published ─unpublish→ unpublished
                                             └─fail→ rejected          └─rollback→ published (new rev)
revision: draft → in_review → published → superseded
                           ↘ rejected       (fixer: old in_review rev → superseded, new rev in_review)
```

- **Site visibility is only `entries.live_rev IS NOT NULL`**, which is equivalent to `status='published'`.
- An edit to an already-published entry (seo kind, manual resubmit) creates a revision with `rev > live_rev`. The entry stays `published`, so the site keeps serving `live_rev` until the edit passes. A rejected edit leaves the entry `published` on its old revision.
- An `unpublished` entry keeps all revisions. Re-publishing it is `rollback --to-rev <n>`.
- Rollback creates a new revision (`source='rollback'`) that copies the payload of a revision with `published_at IS NOT NULL`. It publishes without a gate: that content was already gated or seeded.
- `topic-queue` entries are insert-only. `submit` refuses a new revision of an existing topic key, which replaces `validateTopicQueueAppendOnly`.
- `guide-hub` is a single entry with key `guide-hub`.
- No automated path ever DELETEs rows. Deletion-style intent is `unpublish`. This replaces `validateDestructiveDiff`.
- All state transitions happen inside one transaction per operation in `scripts/content/store.mjs`.

### 3.4 Dataset registry (shared file, Package A)
`lib/content/datasets.json` is imported by the app (TS `resolveJsonModule`) and by scripts (`import … with {type:'json'}`):

```json
{
  "site": {
    "businesses":    {"route": "/directory/:key", "titleField": "name",  "file": "data/businesses.json"},
    "posts":         {"route": "/blog/:key",      "titleField": "title", "file": "data/posts.json"},
    "buildings":     {"route": "/buildings/:key", "titleField": "name",  "file": "data/buildings.json"},
    "neighborhoods": {"route": "/vs/:key",        "titleField": "name",  "file": "data/neighborhoods.json"},
    "services":      {"route": "/best/:key",      "titleField": "pluralName", "file": "data/services.json"},
    "topics":        {"route": "/guide/:key",     "titleField": "title", "file": "data/topics.json"},
    "guide-hub":     {"route": "/guide",          "titleField": null,    "file": "data/guide-hub.json", "singleton": true}
  },
  "state": {
    "topic-queue":    {"file": "data/topic-queue.json", "wrapper": {"version": 1, "arrayField": "topics"}, "keyField": "key"},
    "discovery-seen": {"file": "data/discovery-seen.json", "table": "discovery_seen"}
  }
}
```

---

## 4. Contracts

### 4.1 App data-access layer (Package B)

**Files:**
- `lib/content/db.ts` (`import "server-only"`): one lazily created `pg.Pool` from `process.env.CONTENT_DATABASE_URL`, with `max: 3`.
  - Code must never read `DATABASE_URL` or `POSTGRES_*`. Those are the Neon integration's variables, shared across Vercel envs. A test greps for this.
- `lib/content/source.ts` (`server-only`):

  ```ts
  export type SiteDataset = 'businesses'|'posts'|'buildings'|'neighborhoods'|'services'|'topics'|'guide-hub';
  export class ContentUnavailableError extends Error {}
  export async function loadSiteDataset<T>(name: SiteDataset): Promise<T[]>;
  ```

  - `CONTENT_SOURCE` is read at call time: `json` (the default when unset) or `db`.
  - In `json` mode it reads `data/<file>` with `readFileSync`, exactly as today. Singletons come back as a 1-element array.
  - In `db` mode:

    ```sql
    select r.payload from content.entries e
      join content.revisions r on (r.dataset,r.key,r.rev)=(e.dataset,e.key,e.live_rev)
     where e.dataset=$1 and e.live_rev is not null order by e.position
    ```

    - Wrapped in `unstable_cache(fn, ['content', name, 'v1'], { tags: ['content:'+name, 'content:all'], revalidate: 3600 })`, then in React `cache()` for per-render dedupe.
    - DB errors: 3 attempts with 0.5s / 2s / 5s backoff (this covers Neon scale-to-zero wake), then throw `ContentUnavailableError`.
    - **Zero rows for any site dataset throws.** An empty result is never cached or rendered.
- `lib/data.ts`: **same export names and parameters. Every accessor becomes `async` and returns `Promise<…>`.**
  - Exceptions: `selectNewsPosts` stays a pure sync function, and `getGuideHubData` keeps its fallback object only in `json` mode.
  - Filtering and sorting logic is copied unchanged.
- `lib/links.ts`: every exported function becomes `async` (same names and params).
- All 20 importers add `await`, including `generateStaticParams`, `generateMetadata`, `components/Header.tsx` (async server component) and `app/sitemap.ts` (async default export). Templates are otherwise untouched.
- `tests/news-pilot/publish.test.mjs:531-532`: the regex becomes `/export (async )?function getNewsPosts/`. This file is not locked.

**Caching and revalidation:**
- The 3600s `revalidate` is only a self-healing backstop. The primary path is on-demand invalidation.
- Pages stay prerendered at build via `generateStaticParams`. New slugs render on first request (`dynamicParams` default) and are then cached.
- Build output must still show the six `[param]` routes as SSG/ISR (●), not dynamic (ƒ).
- Data-cache entries are per dataset. posts at ~857KB fits under Vercel's ~2MB per-item cache limit. If a dataset ever exceeds it, the result goes uncached but stays correct; that is noted for the future.

**DB-unavailable behaviour (chosen):**
- **Build:** after retries, the build fails loudly. Vercel keeps serving the previous deployment, so there is no outage, only a blocked deploy.
- **Runtime ISR regeneration:** the error propagates and Next keeps serving the last good page.
- **Never:** render or cache an empty or partial list.
- Escape hatch during the transition: `CONTENT_SOURCE=json` (§7.3).

### 4.2 Revalidate route (Package B)
`app/api/content/revalidate/route.ts`, `runtime='nodejs'`, POST only:

- Request:
  - Header `Authorization: Bearer <CONTENT_REVALIDATE_SECRET>`, compared with `crypto.timingSafeEqual`.
  - Body `{"datasets": ["businesses", ...]}`, a non-empty subset of the site datasets.
- Action: `revalidateTag('content:'+d, { expire: 0 })` for each dataset. Immediate expiry means the next request renders fresh data. Every page that read a dataset carries its tag, including the sitemap, and all pages carry `content:services` through the Header.
- Responses:
  - `200 {"ok":true,"revalidated":["content:businesses"],"at":"<iso>"}`
  - `401` on a bad token
  - `400` on an unknown dataset
  - `503` if the secret is unset
- The route revalidates only the deployment it runs on. The prod domain maps to the prod deployment; the staging alias maps to the staging preview.

### 4.3 Media route (Package B) and images decision
**Decision:** new images are stored in `content.assets` (bytea) and served by `app/media/[...path]/route.ts` at content-addressed URLs `/media/<sha256[0:16]>/<slug>.<ext>`.
- Response: `200` with the stored `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`, or `404`.
- The existing `vercel.json` immutable rule for `*.jpg` also matches these paths, which is safe because the URLs are content-addressed.
- `next/image` already handles local paths, and no config change is needed. Package B verifies this in UAT.

**Why this option:**
- Committing images still needs a deploy before the page image exists, which defeats the goal.
- Vercel Blob needs a new store plus a `BLOB_READ_WRITE_TOKEN` on every writer, and its upload is not atomic with the record.
- The DB asset is written in the same transaction as the submission. It adds no vendor and no secret.
- Volume is about 6 business images per week at roughly 100-200KB, well within Neon storage.
- **Tradeoff:** a cold image miss costs a function call plus a DB read, but the edge caches it forever. Blob stays a drop-in later option: only the URL prefix changes.
- Existing `public/images/**` stay in git with unchanged URLs.

### 4.4 Script-side store API (Package A): `scripts/content/store.mjs`
ESM, uses `pg`. Every function takes `db` (a client from `scripts/content/db.mjs`) first, and every mutating function runs in one transaction.

```js
openDb({ unpooled=false, expectDb })          // reads CONTENT_DATABASE_URL[_UNPOOLED]; asserts current_database()===expectDb when given; returns {query, tx, close, dbName}
liveDataset(db, dataset)                      // → records[] in position order (state datasets: topic-queue → entries[]; discovery-seen → {name:date})
exportAll(db, outDir, {datasets})             // writes data/<file> canonical JSON.stringify(x,null,2)+'\n', original shapes (§2.2)
createSubmission(db, {kind, actor, idempotencyKey, items:[{dataset,key,payload,op}], discoverySeen:[{nameKey,firstSeen}], assets:[{path,sha256,contentType,bytes}]})
                                              // idempotent on idempotencyKey (returns existing); inserts entries/revisions(state 'draft', parent_rev=live_rev)
                                              // → {submissionId, items:[{dataset,key,rev,op,baseLiveRev}], existing:boolean}
beginReview(db, submissionId, contentSha)     // draft→in_review (submission, revisions, new entries)
addRepairRevision(db, submissionId, {dataset,key,payload,round})   // old rev→superseded, new rev (source 'fixer') in_review; updates submission_items.rev, submissions.repairs
recordGateRound(db, submissionId, {round, contentSha, verdict, overall, passed, blockingCount, lint, decision})
publishSubmission(db, submissionId, actor)    // CAS: entries.live_rev === item.base_live_rev for every item, else throw ConflictError (no partial publish)
                                              // sets live_rev, status 'published', revisions.published_at, prior live rev→superseded, events
rejectSubmission(db, submissionId, {state:'rejected'|'blocked', decision})
revertSubmission(db, submissionId, actor)     // smoke-failure auto-revert: restore each item's base_live_rev (or unpublish if insert)
unpublish(db, {dataset,key,actor,reason})
rollback(db, {dataset,key,toRev,actor,reason}) // toRev must have published_at not null
history(db, {dataset,key})                    // revisions + events
listEntries(db, {status, dataset, kind, since})
putAsset / getAsset
markDiscoverySeen(db, rows, {outcome, submissionId})  // insert-only; never overwrites first_seen; may upgrade outcome seen→added|rejected
```

`scripts/content/canonical.mjs`:
- `recordSha(record)` = `sha256(JSON.stringify(record))`
- `datasetDigest(records, keyOf)` = `sha256(records.map(r => keyOf(r)+':'+recordSha(r)).join('\n'))`
- `blobSha1(text)` = git-blob-style `sha1("blob "+len+"\0"+text)`, used for the 40-hex binding.

### 4.5 CLI contract (Package A shell; C implements `submit`/`gate`): `node scripts/content/cli.mjs <cmd>`

**General rules:**
- stdout carries exactly one final JSON line.
- stderr starts with `{"target":{"db":"<current_database()>","host":"<host>"}}`.
- Exit codes: `0` ok; `2` expected negative (rejected, blocked, validation, conflict); `1` error.
- Every mutating command requires `--expect-db <neondb|lv_staging>` and aborts if it differs from `current_database()`.
- Workflows pass `--expect-db ${{ vars.CONTENT_DB_NAME }}` from their GitHub Environment.

| cmd | args | result |
|---|---|---|
| `migrate` | `--expect-db` | applied versions |
| `seed` | `--from <dir>` \| `--from-ref <gitref>`; `--apply` (default: dry-run plan); `--prune` | see §5 |
| `verify-parity` | `--from <dir>` \| `--from-ref <ref>` | per-dataset `{count, digest, match}`; exit 1 on any mismatch |
| `export` | `--out <dir> [--datasets a,b] [--with-assets]` | writes files; `--with-assets` also writes `public/media/<hash>/<file>` |
| `submit` | `--kind K --actor S --idempotency-key S --expect-db D` plus one of: `--dir <workspace>` (diffs workspace `data/*` vs DB live, §4.6); `--record-file <f> --dataset posts`; `--from-ref <ref> --only-new` | `{submissionId, items, discoverySeenAdded, assets}`; `submissionId:null` if there is nothing to submit |
| `gate` | `--submission N --expect-db D [--evidence <file>] [--site-url URL]` | `{submissionId, state, decision, overall, repairs, published:[{dataset,key,rev,url}], revalidated, smoke:[{url,status}]}`; exit 0 = published, 2 = rejected/blocked/smoke-failed; resumable if re-run |
| `resubmit` | `--dataset d --key k --payload-file f --actor S` | a kind-`manual` submission; then run `gate` |
| `unpublish` / `rollback` | `--dataset d --key k [--to-rev n] --reason S --actor S` | performs the change, then revalidates |
| `history` / `list` / `show` | read-only | JSON |
| `revalidate` | `--datasets a,b [--site-url URL]` | calls the §4.2 route |

The site URL comes from `CONTENT_SITE_URL`. The optional `CONTENT_SITE_BYPASS` sends `x-vercel-protection-bypass` if staging previews are protected.

### 4.6 `submit` semantics (Package C)

**`--dir` mode:**
- For each dataset the kind allows, it reads the workspace file, fetches the DB live set, and matches records by key.
  - A new key becomes `insert`.
  - A changed `recordSha` becomes `update`.
  - A key present in the DB but **missing from the workspace fails with exit 2** (`decision:'validation'`). No deletes.
- Discovery-seen: keys in the workspace but not in the DB are inserted immediately with outcome `seen`. That is ops memory; it is not gated.

Kind policy:

| kind | datasets | constraints |
|---|---|---|
| business | businesses (+ discovery-seen) | inserts or updates, ≤ 25 records |
| blog, blog-live, news | posts | **exactly 1 insert**, no updates (same as `assertAppendOnlyPostsChange`) |
| topic-discovery | topic-queue | inserts only; existing keys byte-identical |
| seo | services, topics, neighborhoods, buildings, guide-hub, businesses, posts | ≤ 15 records, ≤ 2 inserts (the current rails in `seo-improve-system.md` and `weekly-seo-improvements.yml:132-150`) |
| manual | any site dataset | exactly 1 record |

Validation before anything is written:
- Each payload passes `scripts/content/validate.mjs`.
  - The strict per-dataset field allowlist is the `lib/types.ts` fields plus the extra keys observed at seed time (`_discoveredAt`, `_needsEnrichment`).
  - Required fields and types are checked, and `key === record.slug`.
  - Posts additionally go through `validateSubmittedPost`-equivalent checks.
- An unknown field is rejected, so content can never depend on code that has not shipped.

Images:
- An `image` value that points at a workspace file under `public/images/**` that is **not tracked in the trusted `main` checkout** (`git ls-files`) is read and size-checked (≤ 2MB, jpeg/png/webp). It becomes an asset, and the record's `image` is rewritten to its `/media/...` path.
- Images already tracked on main are left alone. A missing file fails validation.

### 4.7 `gate` semantics (Package C): port of `news-preflight.runPreflight` to rows

1. **Deterministic checks, round 0:**
   - validators (§4.6);
   - posts only: `blog-lint` via the new flag `--baseline <file>`, with the baseline from `exportAll` of live posts instead of `git show HEAD:`.

   A failure rejects the submission with `decision:'lint'|'validation'`. No model is called.
2. **Build the review document.** For each item, a unified diff:
   - of pretty JSON of the base live payload (empty for inserts) against the candidate;
   - with headers `--- a/data/<dataset>.json#<key>` and `+++ b/data/<dataset>.json#<key>`.

   Findings must use the path `data/<dataset>.json`; the gate strips any `#key` before calling `classifyFindings`. So `RECORD_REPAIR_RULES` (keyed by file), `classifyFindings` and the per-kind `LENSES` work unchanged.

   `content_sha` = `blobSha1(document)`. That keeps `VERDICT_SCHEMA.commit_sha` (40-hex) and `evaluateVerdict` unmodified.
3. **Review.** Uses the generalized `review-agent.mjs` `reviewContent`: any content kind, plus optional `references` and `inventory`.
   - Grounded kinds (blog, blog-live, news) get `selectReferenceRecords` over the DB live businesses, and `inventoryFromData` over the DB live services/topics/posts plus image listings (trusted checkout plus `content.assets`).
   - News passes `--evidence`.
   - Gate model, budget and pass bar are unchanged.
   - Each round is written with `recordGateRound`.
4. **Decision** comes from `preflightDecision({verdict, contentSha, attempts: repairs, maxRepairs: MAX_REPAIRS, kind, changedFiles})` plus `evaluateRepairProgress` over the `gate_rounds` history.
   - `go` → step 6.
   - `repair`, if the kind has a fixer (topic-discovery has none) → step 5.
   - Anything else → reject (`blocked` for unrepairable/exhausted/not-converging).
5. **Fixer.** `planRecordRepair({kind, gateVerdict, payload:[{file:'data/<dataset>.json', records}], validate: (f,o,r)=>validateRecordRepair(f,o,r) && validate.mjs, references, inventory, lintFindings})`.
   - Each repaired record goes through `addRepairRevision`, then back to step 2.
   - At most 3 repairs (`MAX_REPAIRS`), each with at most 4 fixer plans (`MAX_FIXER_ATTEMPTS`), exactly as today.
6. **Publish.** `publishSubmission`, then `POST /api/content/revalidate` for the touched site datasets.
   - A revalidate failure is retried once. If it still fails, the result reports `revalidated:false` and posts a Slack warning. The 1h backstop then applies. The content is still published.
7. **Smoke** (site datasets only). GET `CONTENT_SITE_URL + route` for each item, retried for up to 180s. It expects `200` and the HTML-escaped `titleField` value in the body.
   - On failure: `revertSubmission`, revalidate, `decision:'smoke-failed'`, Slack, exit 2.
   - This replaces the `npm run build` / e2e that content PRs got in `generator-ci`.
8. **Notify.** On any non-publish outcome, post one Slack message via `SLACK_WEBHOOK_URL`: kind, submission id, decision, score and the top 3 findings, plus `content show --submission N`. Rejected content stays visible via `content list --status rejected`.
9. **Mirror.** On a publish, send `repository_dispatch` `content-published` with `{target}` using `GITHUB_TOKEN`, which triggers the mirror (§4.8).

Changes to `review-agent.mjs` (Package C):
- Add a main guard: `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)`.
- Export `runStructured, VERDICT_SCHEMA, LENSES, GATE_BAR, planRecordRepair, reviewContent`.
- `review-content` accepts `--kind` in `{business, blog, blog-live, news, seo, topic-discovery}` plus optional `--references` and `--inventory`.
- `review()` and `fix()` (the PR paths) are **not modified**, because locked evals regex their source.

### 4.8 Content mirror (Package A)
`.github/workflows/content-mirror.yml`:
- Triggers: `repository_dispatch: content-published`, `workflow_dispatch`, and a daily cron.
- Job: in the environment named by the target (`content-production` / `content-staging`), run `content export --out data/`. Then commit to branch **`content-mirror/<target>`**, but only when something changed. The branch is never merged and has no PR or CI.

Purposes:
- (a) The secret-free exe.dev VM reads current content from it (§4.10).
- (b) It is the JSON source for rollback (§7.3).
- (c) Git history of published content keeps the "free history" property.

### 4.9 Manual surface
- The CLI can be run locally with env pulled from Vercel.
- `.github/workflows/content-admin.yml` (Package A) is a `workflow_dispatch` wrapper:
  - inputs: `action` in `list|show|history|unpublish|rollback|resubmit-gate|revalidate`, plus `target`, `dataset`, `key`, `to_rev`, `reason`;
  - it runs in the matching environment, so John can act from GitHub on a phone with no local secrets.

### 4.10 VM (exe.dev supervisor) write path: decision
**Decision:** the VM stays secret-free. It keeps using GitHub as its transport, and GHA performs the DB write and the gate.

Rejected alternatives:
- A direct DB credential would be the VM's first real secret. The VM is the zone that runs model-generated content, and a credential there breaks the no-token contract (`tests/supervisor/sentinel-ops.test.mjs:77,103,108`).
- An authenticated app API route also needs a bearer secret on the VM.
- In both cases the gate would still have to run in GHA, because the VM has no Anthropic key.

The ingest workflow already exists and already holds `ANTHROPIC_API_KEY`.

DB mode is selected by the non-secret `LV_CONTENT_STORE=db` in `/etc/lv-supervisor.env`. The legacy path stays the default until cutover.

1. Worktree from `origin/staging` (code), then `git checkout origin/content-mirror/production -- data/`, so generation context, duplicate-slug checks and topic selection use current DB content.
2. The weekly-objective check reads `data/posts.json` from the mirror instead of the git history of `origin/main` (`branchPublicationHistory`). It checks for a published post whose `publishedAt` falls in this ISO week.
3. Generate and lint with `blog-lint --baseline <mirror posts>` as today.
4. Commit only `candidate/post.json` (the single record) on `supervisor/blog-data-<ms>` and push through the exe.dev proxy. Then dispatch `supervisor-ingest-blog` with the existing payload plus `store:"db"`.
5. `supervisor-ingest.yml`, DB branch, environment `content-production`:
   - verify `DATA_SHA`, read `candidate/post.json`;
   - `content submit --kind blog-live --record-file … --idempotency-key vm:<data_sha>`;
   - `content gate`;
   - set commit status **`content/publish`** on `DATA_SHA`: `success` with `target_url` = the live URL, or `failure` with the decision in the description;
   - run `coordinator record-candidate-outcome` for rejections, as today.
6. The VM polls the `content/publish` status on `DATA_SHA` for up to 40 minutes. The status must be created by `github-actions[bot]`.
7. On success the VM **independently GETs the public live URL** (no secret) and checks for the post title. Terminal state is the new ledger state `PUBLISHED_LIVE`, followed by `consumeIntent`.
8. Failure maps to the existing `BLOCKED_*` states. The data branch is deleted as today.

---

## 5. Seeding / migration

`content seed` (Package A) is idempotent and dry-run by default:

1. **Read the source.** `--from-ref <ref>` uses `git show <ref>:data/<file>`; `--from <dir>` uses files.
2. **Per record,** using `position` = array index:
   - key absent in DB → insert entry plus revision 1 (`source:'seed'`, `state:'published'`, `published_at=now()`, actor `seed:<ref>@<sha>`, `submission_id` = one kind-`seed` submission per run, idempotency key `seed:<target>:<sha>`);
   - same `recordSha` as the live revision → no-op;
   - different → a new revision `source:'seed'`, published (sync mode). This is refused if the entry has any `source in ('writer','fixer','manual','rollback')` revision newer than its last seed, so a re-seed can never clobber gated DB edits. The refusal is reported and exits 2.
3. **Keys in DB but absent from the source** are reported only. `--prune` unpublishes them; it never deletes.
4. **Positions** are rewritten to match the source order for seed-owned entries. Entries created by writers after cutover keep their appended positions.
5. **State datasets:**
   - topic-queue: entries keyed by `key`, in the same order.
   - discovery-seen: inserted into `content.discovery_seen` with `outcome='added'` if the name maps to a business, else `'seen'`. `first_seen` is never overwritten.
6. **Verify.** `verify-parity --from-ref <ref>` compares, per dataset:
   - count;
   - ordered key list;
   - per-record `recordSha`;
   - `datasetDigest`.

   discovery-seen compares the map, and guide-hub compares the singleton. Exit 1 on any mismatch. The output table is pasted as evidence.

**Tonight (allowed, prod unread until cutover):** both DBs are currently empty (the 219-business probe was dropped).

```
# staging DB ← origin/staging content (219 businesses, 23 topic-queue)
CONTENT_DATABASE_URL_UNPOOLED=<lv_staging> content migrate --expect-db lv_staging
content seed --from-ref origin/staging --apply --expect-db lv_staging && content verify-parity --from-ref origin/staging

# prod DB ← origin/main content (215 businesses, 16 topic-queue) — matches what is live
CONTENT_DATABASE_URL_UNPOOLED=<neondb> content migrate --expect-db neondb
content seed --from-ref origin/main --apply --expect-db neondb && content verify-parity --from-ref origin/main
```

Blog-live keeps shipping posts into `main` JSON until cutover. The cutover runbook therefore re-runs seed in sync mode from `origin/main` immediately before the flip (§7.2 step 3).

---

## 6. Secrets / credentials matrix

Infra is live:
- One Vercel-Neon store `lib_village` (Neon project, PG 18, us-east-1), bound to Production and Preview.
- **The integration's `DATABASE_URL` / `POSTGRES_*` / `PG*` variables are shared across envs, so nothing may use them.** A test in Package B greps `app lib scripts components` for them.
- Isolation is by database inside the project.

| where | name | value | status |
|---|---|---|---|
| Vercel Production | `CONTENT_DATABASE_URL` / `CONTENT_DATABASE_URL_UNPOOLED` | `neondb` pooled / unpooled | **set** (per John) |
| Vercel Preview + Development | same two | `lv_staging` | **set** |
| Vercel Production | `CONTENT_SOURCE` | unset (= `json`) until cutover, then `db` | cutover step |
| Vercel Preview | `CONTENT_SOURCE` | `db` | Phase 1 |
| Vercel Production / Preview | `CONTENT_REVALIDATE_SECRET` | 32-byte random, **different per env** | new |
| GitHub Environment **`content-production`** (deployment branch policy: `main` only, so staging-branch runs cannot read it) | secrets `CONTENT_DATABASE_URL`, `CONTENT_DATABASE_URL_UNPOOLED`, `CONTENT_REVALIDATE_SECRET`; vars `CONTENT_DB_NAME=neondb`, `CONTENT_SITE_URL=https://libertyvillage.co` | | new (repo is public, so Environments are available) |
| GitHub Environment **`content-staging`** (any branch) | same names → `lv_staging`, the staging revalidate secret, `CONTENT_DB_NAME=lv_staging`, `CONTENT_SITE_URL=<staging branch alias>`; optional `CONTENT_SITE_BYPASS` if previews are protected | | new |
| GitHub repo | `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL`, `SERPAPI_API_KEY`, `PEXELS_API_KEY`, … | unchanged | exists |
| GitHub repo var | `LV_CONTENT_STORE` = `git` (legacy PR paths) \| `db` | `git` until cutover | new |
| exe.dev VM `/etc/lv-supervisor.env` | `LV_CONTENT_STORE=db`, `LV_SITE_URL=https://libertyvillage.co` (**non-secret**) | **no DB or revalidate secret** (§4.10) | cutover step |
| Local dev / tests | `.env.local` via `vercel env pull --environment=development` → `lv_staging`. Tests use `CONTENT_TEST_DATABASE_URL` = local docker `postgres:18`; the harness refuses non-localhost hosts | | — |

Rules:
- Prod creds reach a laptop only through an explicit `vercel env pull --environment=production`.
- Any prod-mutating command needs John's go for that action. This includes `content seed/migrate --expect-db neondb`, `unpublish` or `rollback` on prod, and Vercel env changes.
- GitHub Environments named `Production` and `Preview` already exist, created by Vercel deployments. Do not reuse them.

---

## 7. Phases, cutover runbook, rollback

### 7.1 Phases
- **P0 (tonight):** migrate and seed both DBs (§5). No reader uses them.
- **P1 (build):** Packages A–E land on a feature branch, then go by PR into `staging` (the code flow).
  - Preview gets `CONTENT_SOURCE=db`, so the staging preview reads `lv_staging`.
  - UAT (§9) runs on staging.
  - The prod writers stay on the legacy path (`LV_CONTENT_STORE=git`).
- **P2 (cutover):** only on John's explicit go (§7.2).
- **P3 (retire):** at least 14 days after cutover, once the §7.4 criteria are met.

### 7.2 Cutover runbook (every step needs John's go; prod-mutating steps are marked ⚠)
0. **Pre:**
   - UAT is all green on staging with evidence.
   - ⚠ Merge staging→main with Production `CONTENT_SOURCE` still unset. Prod keeps reading JSON, and the new code must be a no-op there.
   - Capture baseline A: `scripts/content/parity-crawl.mjs --base https://libertyvillage.co --out /tmp/cutover-A.json`.
1. **Freeze writers.**
   - On the VM: `sudo systemctl disable --now lv-supervisor.timer`.
   - `gh workflow disable` for discover-businesses, weekly-topic-discovery, news-autopublish, weekly-seo-improvements and weekly-blog.
   - Confirm no open `blog/auto-*` PR into main.
2. `git fetch origin` and record the `origin/main` SHA.
3. ⚠ `content seed --from-ref origin/main --apply --expect-db neondb`, then `content verify-parity --from-ref origin/main`. It must PASS, with the output pasted.
4. ⚠ Set Vercel Production `CONTENT_SOURCE=db`. Confirm the other vars with `vercel env ls production | grep CONTENT_`. Then redeploy production from the same main SHA. The build now reads `neondb`.
5. Capture B with the parity crawl, then compare A against B. Titles, meta, canonical, JSON-LD, `<main>` text and link hrefs must be identical, and the sitemap URL set must be identical.
6. ⚠ `content revalidate --datasets services --expect-db neondb`. Expect `200`.
7. **Switch writers.**
   - ⚠ Set repo var `LV_CONTENT_STORE=db`.
   - Run `content-mirror.yml` for production.
   - On the VM, set `LV_CONTENT_STORE=db` in `/etc/lv-supervisor.env`.
   - Re-enable the workflows and the VM timer.
8. ⚠ **Stranded staging content** (open question Q1): `content submit --kind business --from-ref origin/staging --only-new …` plus `gate`, and the same with `--kind topic-discovery`. The 4 businesses' images are not tracked on main, so `submit` turns them into assets automatically.
9. **Observe the first live automated publish**, e.g. `gh workflow run discover-businesses.yml -f max=1`. The page must be live without a deploy.

### 7.3 Rollback

| level | trigger | action | time |
|---|---|---|---|
| L1: bad record | wrong or embarrassing content | `content unpublish` or `content rollback --to-rev n` (CLI or `content-admin.yml`); auto-revalidates | minutes |
| L2: DB read path broken or long outage | site errors, blocked deploys | (a) if anything was published since cutover, `git checkout origin/content-mirror/production -- data/` and `content export --with-assets` output onto a branch, then a PR to main (`/media/*` URLs are served statically from `public/media`; UAT verifies static files win over the dynamic route); (b) ⚠ Production `CONTENT_SOURCE=json` plus redeploy; (c) ⚠ `LV_CONTENT_STORE=git` and VM `LV_CONTENT_STORE` unset, so the legacy PR paths resume | < 1h |
| L3: code regression in the JSON path | L2 fails | revert the reader PR on main | code flow |

**When the JSON files are removed:** in P3 only. §7.4 lists the criteria.

### 7.4 Retirement (P3; separate PRs, allowed only when every criterion holds)

**Criteria (all must hold):**
- at least 14 days in prod on `db`;
- at least one successful DB publish from each active writer kind (business, blog-live, topic-discovery; news if it ran);
- one L1 and one L2 drill executed on staging;
- no L2 in prod.

**Retire:**
- `data/*.json` and the `json` branch of `lib/content/source.ts` / `CONTENT_SOURCE`. Tests that read live data (`blog-lint.test.mjs:288`, `discovery-dedupe.test.mjs:149,162`) move to `tests/fixtures/content/`.
- `heal-base.mjs`, the `heal-generator-base` job, the heal labels and `MAX_HEALS`.
- `content-sync.mjs`, `observe-and-sync-staging`, `wait-for-blog-live-head`, the `content-main` concurrency group, `contentShipEnabled` / `LV_CONTENT_SHIP_ENABLED`, and `blogLiveParityPaths` / `validateContentTreeParity` / `validateSyncDelta`.
- The content kinds in `KIND_POLICIES` (blog, blog-live, news, business, topic-discovery), `data/` in `seo`/`promotion` allowed paths, and their PR-diff `LENSES` wording.
- The git-splice parts of `record-repair.mjs` (`diffRecordsBySlug`, `applyRecordRepairPlan`, `readRecordFile`, `serializeRecords`), `coordinator applyRecordFix` and `review-agent fixRecords`. Keep `RECORD_REPAIR_RULES` and `validateRecordRepair`.
- `policy.validateDestructiveDiff` / `ALLOW_RECORD_DELETION_LABEL` and `validateTopicQueueAppendOnly`.
- `news-preflight.mjs` (ported into `gate.mjs`), the news PR steps, and the `supervisor-ingest` PR branch.
- The supervisor PR monitoring for blog (`sha-monitor`/`terminal-pr` PR logic, `PUBLISHED_MAIN`).
- Promotion-sweep's content role; it stays only if code promotion is re-enabled. Blocked-sentinel's content reach.
- The legacy one-off writers in §2.3: delete them, or convert to `export` → edit → `submit --kind manual`.
- **Locked evals** asserting the retired mechanics (`full-autonomous-loop`, `weekly-grounded-publication-loop`, `local-supervisor-acceptance`) are re-frozen or retired **by the eval owner, never by a builder**. `docs/autonomous-promotion-acceptance-spec.md` B1 is superseded.

---

## 8. Build packages

**Shared contract (frozen before build):** §3.2 DDL, §3.4 `datasets.json`, §4.4 store API, §4.5 CLI contract, §4.2 revalidate route contract, `canonical.mjs`.
- Package A ships the DDL, `datasets.json`, `canonical.mjs` and **stubbed** `store.mjs` signatures in its first commit (hour 0). Other packages branch from that commit.
- B, C, D and E code against the contract and use a local docker Postgres seeded by A's `seed`.
- `package.json` is owned by A: deps `pg`, `server-only`, dev `@types/pg`; scripts `test:content`, `content`. Others request additions through A.

Every package must also pass:
- `npm run lint`, `npm run build` (`CONTENT_SOURCE=json`)
- `npm run test:automation`, `npm run test:supervisor`, `npm run test:news-pilot`
- `shasum -a 256 -c evals/*.sha256` (all OK; no locked file touched)

### Package A: Schema, store, seed/parity/export, mirror, admin
- **Owns:**
  - `scripts/content/{migrations/0001_content.sql, db.mjs, canonical.mjs, store.mjs, cli.mjs, seed.mjs, parity.mjs, export.mjs, revalidate-client.mjs}`
  - `lib/content/datasets.json`
  - `.github/workflows/{content-mirror.yml, content-admin.yml}`
  - `tests/content/{store,seed-parity,export}.test.mjs`
  - `tests/content/helpers/db.mjs`: creates a throwaway database per run on local docker, runs migrations, drops it; refuses non-localhost
  - `package.json`
- `cli.mjs` dispatches `submit` → `scripts/content/submit.mjs#main` and `gate` → `scripts/content/gate.mjs#main`. Those files are owned by C; A stubs them.
- **Acceptance:**
  - Status-model transitions tested, including CAS conflict, rollback-target rule, topic-queue insert-only and no-delete.
  - `seed` is idempotent: a second run is all no-op.
  - `verify-parity` PASSes against `origin/staging` and `origin/main` on local docker and fails on a 1-byte mutation.
  - `export` round-trips: export → `verify-parity --from <export dir>` PASS; posts, businesses, topics and topic-queue exports byte-equal the canonical source files.
  - Paste the parity output from the real `lv_staging` seed.

### Package B: Site read path
- **Owns:**
  - `lib/content/{db.ts,source.ts}`, `lib/data.ts`, `lib/links.ts`
  - the 20 importers in §2.1, including `components/Header.tsx` and `app/sitemap.ts`
  - `app/api/content/revalidate/route.ts`, `app/media/[...path]/route.ts`
  - `scripts/content/parity-crawl.mjs`
  - `tests/content/{dal,routes,env-guard}.test.mjs`
  - `tests/news-pilot/publish.test.mjs` (lines 531-532 only)
  - `playwright.config.ts` (`baseURL` from `E2E_BASE_URL`, and skip `webServer` when it is set)
- **Acceptance:**
  1. `next build` with `CONTENT_SOURCE=db` against local docker seeded from `origin/staging` succeeds. The route table shows the dynamic routes as ●, not ƒ.
  2. `parity-crawl` of `next start` in json mode against db mode over every sitemap URL shows zero diffs (normalized: build IDs, chunk hashes and the sitemap `now` stripped).
  3. With the DB stopped, `next build` fails after retries with `ContentUnavailableError`. It does not emit empty pages.
  4. Against a running `next start` in db mode:
     - revalidate route: `401`/`400`/`200`;
     - after a direct `publishSubmission` plus revalidate, the new slug page is `200` and appears in `/sitemap.xml` with no rebuild;
     - after `unpublish` plus revalidate, it is `404`.
  5. The `/media/...` route serves bytes with immutable headers, and `next/image` renders it.
  6. The env-guard test fails if code references `DATABASE_URL` / `POSTGRES_`.

### Package C: Submit + gate on rows
- **Owns:**
  - `scripts/content/{submit.mjs, gate.mjs, validate.mjs, review-document.mjs, notify.mjs}`
  - `scripts/automation/review-agent.mjs` (main guard, exports, generalized `review-content`/`fix-content`; `review()`/`fix()` untouched)
  - `scripts/blog-lint.mjs` (`--baseline`)
  - `tests/content/{submit,gate,validate,review-document}.test.mjs`
- Model calls are injected (`reviewFn`, `fixFn`) as in `news-preflight`, so tests are offline.
- **Acceptance:**
  1. Submit, for each kind:
     - happy path;
     - a deletion is refused (exit 2);
     - posts kinds with 2 inserts are refused;
     - a topic-queue mutation is refused;
     - an unknown field is refused;
     - an untracked image becomes an asset and its path is rewritten;
     - idempotency-key replay returns the same submission.
  2. Gate, with fake review/fix:
     - pass → published + revalidate called + smoke;
     - fail→repair→pass (revisions show `fixer` rows);
     - unrepairable → blocked + Slack payload;
     - non-converging → blocked;
     - 3 repairs exhausted → blocked;
     - smoke failure → auto-revert to the prior live revision;
     - a CAS conflict leaves nothing published.
  3. `review-agent.mjs` can be imported with no side effects, and its existing CLI behaviour is unchanged (existing `trusted-tooling.test.mjs` stays green).
  4. **One real-model gate run** on `lv_staging` for a business submission. Paste the `gate_rounds` row.

### Package D: GHA writers → DB mode
- **Owns:**
  - `.github/workflows/{discover-businesses,weekly-blog,weekly-seo-improvements,weekly-topic-discovery,news-autopublish,autonomous-coordinator}.yml`
  - `scripts/automation/constants.mjs` (`seo` policy: drop `data/` only when `LV_CONTENT_STORE=db`, via a separate `seo` DB-mode path check in the workflow; the `KIND_POLICIES` object is otherwise unchanged in v1)
  - `tests/automation/{workflow-contract,news-autopublish-workflow}.test.mjs` (unlocked; add DB-branch assertions, keep the legacy ones)
- **Pattern** for every writer, when `vars.LV_CONTENT_STORE == 'db'` or the dispatch input `store=db`:
  1. `environment: content-${{ inputs.content_target || 'production' }}`
  2. Trusted checkout of `main`, `npm ci`
  3. `content export --out data/ --datasets <needed>`
  4. Run the **unchanged** generator script
  5. `content submit --kind <k> --dir . --actor gha:<wf>#${{github.run_id}} --idempotency-key gha:<wf>:${{github.run_id}}:${{github.run_attempt}} --expect-db ${{vars.CONTENT_DB_NAME}}`
  6. If there is a submission id, `content gate --submission $ID --expect-db …`

  Exit 2 marks the job as a failure with a summary (Slack is already sent by the gate). The legacy PR steps stay under the `git` branch of the `if`.
- **Per writer:**
  - discover-businesses: exports businesses + discovery-seen. After the gate, `markDiscoverySeen` sets the outcome to `added` or `rejected` for the submitted names, which is the rejected-candidate registry.
  - weekly-blog: runs only when owner=`gha`. Exports posts, services, topics, businesses and topic-queue. The agent's own `npm run build` runs with `CONTENT_SOURCE=json` on the workspace.
  - weekly-seo-improvements: exports all site datasets. The data changes go to `submit --kind seo`. Code changes (`app components lib`, and `public/images` referenced by code) still go through a PR to staging with `data/` excluded from `git add`.
  - weekly-topic-discovery: exports topic-queue, then `submit --kind topic-discovery`; the gate has no fixer.
  - news-autopublish: exports posts; `publish.mjs` stays unchanged; `submit --kind news`; `gate --evidence <file>`. `news-preflight` is skipped in DB mode. The "open `news/auto-*` PR" guard becomes "no `news` submission `in_review`" (via `content list`). Resolve-topic steps run after the export, so `data/topic-queue.json` is current.
  - autonomous-coordinator.yml: add a `postgres:18` service plus `npm run test:content` to `generator-ci` and `promotion-ci`.
- **Acceptance:**
  - `workflow_dispatch` with `content_target=staging store=db` for discover-businesses (`max=2`) and topic-discovery succeeds on `lv_staging` end to end. Paste run URLs, submission rows and the live staging page URL.
  - The workflow-contract tests are green.
  - A legacy-mode dry dispatch still takes the PR path.

### Package E: exe.dev supervisor DB mode
- **Owns:**
  - `scripts/supervisor/{host-run.mjs, weekly-publication-loop.mjs, pi-session.mjs, ledger.mjs}`
  - new `scripts/supervisor/content-monitor.mjs` (status poll plus public GET)
  - `.github/workflows/supervisor-ingest.yml`
  - `ops/exedev-supervisor/{lv-supervisor.env.example, README.md}`
  - new `tests/supervisor/content-store-mode.test.mjs`
- The legacy path is byte-for-byte unchanged when `LV_CONTENT_STORE` is unset.
- **Dependency:** the frozen `local-supervisor-acceptance` evals cover only the legacy path. An **eval-owner-authored** DB-mode acceptance eval (new files, new manifest) is required before E can claim done. A builder never edits the existing eval files.
- **Acceptance:**
  - Unit tests cover:
    - mirror checkout;
    - the weekly-objective check from the mirror;
    - `candidate/post.json` commit;
    - the payload with `store:"db"`;
    - the status poll, accepting only `github-actions[bot]`;
    - `PUBLISHED_LIVE` requiring a public GET 200 plus the title;
    - no secret env added (`sentinel-ops.test.mjs` stays green).
  - `test:supervisor` is green, the legacy acceptance eval is unchanged and green, and the new DB-mode eval is green.
  - One staging run: VM (or a local host-run with the proxy env) targets `content_target=staging` and ends `PUBLISHED_LIVE` on the staging URL.

---

## 9. Integrated acceptance / UAT (once, combined app, staging: preview on `lv_staging`)

Evidence for every scenario:
- the exact command or URL;
- the observed output (HTTP status, JSON line, or DB row via `content show`/`history`);
- `vercel env ls preview | grep CONTENT_` showing the vars are present.

1. **Render parity.** `parity-crawl` of the staging preview (db) against a local `next start` in json mode on the `origin/staging` JSON. Zero diffs over every sitemap URL, and the sitemap URL sets are equal.
2. **Business discovery, end to end.**
   - `gh workflow run discover-businesses.yml -f max=2 -f content_target=staging -f store=db`.
   - Expect submission → gate round(s) → `published`.
   - `/directory/<new-slug>` on the staging URL returns `200` with the business name, and appears in `/sitemap.xml`, **with no new deployment**. Check that the Vercel deployments list is unchanged.
   - The image is served from `/media/...`.
   - discovery_seen rows show `added`.
3. **Blog publish.** A supervisor-ingest DB-mode dispatch (or a local host-run) targets staging. The post publishes, `/blog/<slug>` is live, and the `content/publish` status is `success` on `DATA_SHA`. The ledger shows `PUBLISHED_LIVE`.
4. **Failed gate.**
   - `content resubmit` of a business record with a fabricated claim (e.g. "Michelin-starred", unsupported) on `lv_staging`.
   - Expect: gate `rejected`/`blocked`; the page is unchanged (live revision unchanged); a Slack message is received; it appears in `content list --status rejected`.
   - For an insert, the new slug returns `404`.
5. **Unpublish / rollback.**
   - `content unpublish` of the scenario-2 business: the page returns `404` and the slug is gone from the sitemap within about 1 minute.
   - `content rollback --to-rev 1`: the page returns `200` again.
   - `content history` shows every revision and event.
6. **DB outage.** Point a preview env at a wrong `CONTENT_DATABASE_URL` (a throwaway preview branch deploy).
   - Expect: the build fails with `ContentUnavailableError` and the existing staging deployment keeps serving.
   - Then, on a running deployment with the DB unreachable, a revalidate followed by a request serves the stale page with no 5xx and no empty lists.
7. **Isolation.** A `content-production` environment job dispatched from the `staging` branch is refused by the environment branch policy. `--expect-db neondb` against the staging URL aborts.

---

## 10. Open questions (user-owned only)

1. **Stranded staging content.** At cutover, should the 4 businesses and 7 topic-queue entries that exist only on `staging` be re-gated and published to prod (§7.2 step 8)? Default: yes.
2. **Publish visibility.** Without PRs, John loses the passive "merged PR" signal. Should every successful automated publish post a one-line Slack message (title + URL), or only failures, as today? Default: one line per publish.

Implementation choices resolved in this doc, not questions:
- `json` payload type
- `content` schema
- `pg` driver
- DB-served assets
- VM via GitHub transport plus a mirror branch
- unstable_cache + `revalidateTag(..., {expire:0})`
- fail-closed build
- the 1h backstop
- retiring the machinery in P3
