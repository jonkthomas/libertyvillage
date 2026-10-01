# Weekly roundup v2: "Liberty Village + Exhibition Place this week"

Status: **draft spec, revision 3 (final repair round), for independent re-review.** No implementation until it is accepted. Date: 2026-09-29. Base: `origin/staging` @ `26cb824` (PR #192 merged).

This spec replaces the free-text roundup writer, which PR #192 held in `ROUNDUP_PUBLICATION.mode='census-only'`, with a structured-source pipeline. It depends on `docs/specs/content-cadence-2026.md` (the cadence count, slot and receipt contract) and changes only the parts named in §11. Nothing here authorizes a production timer, a production mode flip, a migration against production, a protected merge or a production publication. Those remain John's actions.

Evidence: the four-week backtest at `lib_village/.state/archive/2026-09-29-roundup-backtest/` (`report.md` and 65 structured forms in `items.jsonl`), and research §8 in `docs/research/content-quality-2026-09.md`, which covers why keyword locality failed.

### Revision 2 log

The independent review of revision 1 (commit `035e216`) returned NOT-READY with 3 BLOCKER and 7 MAJOR findings. The product decisions in §1 are unchanged. Every finding is resolved here:

| # | Finding | Resolution | Sections |
|---|---|---|---|
| 1 | Page-level token matching permits false locality and cross-item evidence | Item-bound evidence. Every item names one trusted record, and its subject, place and date must all come from that record. Prose must state the place as where the item happens. Ambiguous or multi-item prose is `unverifiable`. Project identity never makes an off-site meeting core. | §5, §6.1–6.3, A1, A2 |
| 2 | Source-quality rule silently deleted | The inherited predicate is carried forward: an official or primary source, or two independent substantive publishers. Tiers come from the checked-in registry only. | §4.1, §6.7, §11, A2 |
| 3 | Replay input cannot satisfy the verifier; the table used future reports | `items.jsonl` (and the Instagram trial's `ig-items.jsonl`) become immutable reference data. A separate, reviewed conversion produces schema-valid, item-level fixtures with exact spans. Synthetic fixtures are kept separate. A cadence-clock projection was proposed from partial trial data; §7/A4 now separates that original hypothesis from the independently checked, incomplete captured-evidence replay. No historical publication decision is inferred from missing full bodies. | §7, A4 |
| 4 | Event dates excluded the BIA and City open-house items | Year-bearing event dates from an item-bound official org or project section are allowed. | §6.4, A2 |
| 5 | A frozen planning `now` weakened submit freshness | Planning identity stays at `T_plan`. Temporal eligibility is rechecked at the trusted first-submit instant `T_submit` (`temporalValidationNow`). End-of-day, unknown-end and week-mapping rules are defined. | §6.5, §7, §9.4, A3 |
| 6 | Prior coverage and roll-forward needed history the pipeline lacks | Each published roundup post carries a structured `roundupCoverage` field. Later runs read it from the normal live export. | §6.6, §9.3, §11, A3 |
| 7 | Syndication handling incomplete | Attribution and original-link rules are specified. Unresolved, looping and self-canonical-with-attribution copies are `unverifiable`. The real Toronto.com/Durham rows are labelled `unverifiable`, not claimed as detected. | §6.4, A2, A4 |
| 8 | Private-individual exclusion claimed as deterministic | Person status is stated honestly as a model assessment: reasoner, then independent risk review, then gate. It fails closed. Public performer and organisation roles are allowed. | §5, §6.5, §9.2, A2 |
| 9 | Staging dry run had no supported contract | Pre-merge evidence is an isolated direct collector→reasoner→verifier→writer dry run with exact commands. Runner verification happens only on the deployed staging SHA after merge. | §10.4, A5, A6 |
| 10 | Legacy runner path leaves a prior-week roundup gap | The blog lane's cross-week reconciliation is generalized to the roundup lane. The exact cadence and runner functions are listed. | §10.3, §11, A5 |

**Parent addendum (same round): Instagram enabled.** The read-only trial (`lib_village/.state/archive/2026-09-29-ig-trial/`: `report.md`, `accounts.csv`, `ig-items.jsonl`) found 13 new first-party core items from 34 verified LV accounts. It used Apify `apify/instagram-scraper` on public profiles, with no login, at about US$0.11 per run. Instagram is now an **enabled first-party source**:

- a committed, reviewed watch list;
- locality from the verified account address or an explicitly named core venue, never from the caption alone;
- forward-looking dated announcements only;
- a recurring-class cap;
- first-party source quality for the account's own event only;
- a pluggable provider. John approved Apify for staging and production on 2026-09-29, and Meta Business Discovery is an optional later swap. `APIFY_API_TOKEN` is scoped to the source process only;
- failure means the source is unavailable and never blocks other sources;
- trial fixtures in the replay under the same honest recompute.

See §4.4, §6.1, §6.2, §6.4, §6.7, §7, §10 and §12.

**Parent decisions (final edit, same round).**

- **Relative dates.** Unambiguous relative day words (today, tonight, tomorrow, this/next <weekday>) resolve against the post's platform timestamp in America/Toronto. Ambiguous phrases stay `undated` (§4.4, §6.4). The original prediction that IG215 would count as a W40 core class was not confirmed by the captured replay; §7/A4 records the actual verifier outcome.
- **Raw trial data.** The full Instagram provider dumps/images remain in the archive. Only minimal provider rows with full raw captions, caption hashes and record-bound spans are committed; separate byte-pinned web captures support A4. The trial summary alone proves no earlier clock availability.

The raw data also corrected the timestamp cross-check band (§4.4).

### Revision 3 log (final repair round)

The focused recheck of `bf2d81f` found 8 of the 10 original findings resolved. It left R3 (BLOCKER) and R6 (MAJOR) partial, and raised N1–N3 (BLOCKER). Each is fixed with the simplest correct rule:

| # | Finding | Resolution | Sections |
|---|---|---|---|
| R3 | Caption-block records could not verify the pinned Instagram positives; time proof needed a year-bearing span | **Event records.** A caption with exactly one distinct date is **one** record: the whole caption, raw formatting preserved. A caption with several dates splits into blocks, with bracket headings attached to their body. Each block must be self-contained, or that event holds. **Time proof** is a verified date resolution plus a literal time span from the same record. A stated start with an unknown end is ineligible after the start. A4 is recomputed from those records. | §6.1, §6.4, §7, A2, A4 |
| R6 | `roundupCoverage` could be changed by non-roundup edits | Roundup-only trusted metadata on **all** write paths, in the shared `checkRecordPolicy`. Non-roundup inserts cannot create it. Non-roundup edits and fixers must preserve it byte-identically. Only the roundup policy sets it, bound to the pack. More than 64 keys refuses the roundup submission; it is never truncated. | §6.6, §9.4, §11, A3 |
| N1 | Submit could not reach the Instagram provider without leaking the token | A source-only helper, `ig-refetch.mjs`, run by the runner under `sourceEnv('weekly-roundup')` immediately before `content submit`. It writes provider responses for exactly the pack's shortcodes, with `fetchedAt`, to a runner-owned file. Submit validates the pack deterministically against that file. The token never enters `trustedEnv`, the generator or the gate. | §4.4, §9.4, §10.3, A5 |
| N2 | Image-only dates depended on a reviewer that runs after verification | **Image-only-dated Instagram units are excluded from v2.** They stay leads. Image transcription is a possible later addendum. | §4.4, §6.4, §7, A2 |
| N3 | Instagram had no canonical event or venue identity | One shared venue registry supplies `canonicalVenueId` (the normalized verified address) for watch entries, core addresses and venue sources. The occurrence key is `(canonicalVenueId, Toronto date, start time or 'all-day')`. Same-key reminders and corroborations merge; different start times stay separate; ambiguous matches keep one and hold the other. The class cap is per canonical venue, and coverage stores occurrence keys. | §4.4, §6.2, §6.6, §7, A3 |

Original projected replay (not historical A4 acceptance): **W37 publish, W38 HOLD, W39 publish only if the Canada Soccer dateline verifies (otherwise HOLD), W40 publish**. The captured-evidence correction and measured exercise are in §7/A4.

### Amendment — 2026-09-29 parent/feature-owner evidence decision

The feature owner directed that the original A4 criterion, "per-week decisions equal the projected §7 table" **as a historical backtest**, be **replaced**, not represented as passing: contemporaneous full-body captures do not establish W37–W40 availability at their earlier clocks. A4 now asserts the actual captured-evidence algorithm exercise and names its after-clock dependencies; current-week model-backed UAT, post-merge A6 staging verification and independent exact-head review remain required for feature acceptance. The original projection is retained for audit. No outcome was tuned, no unavailable fact was fabricated, and the 3-unit/1-core-anchor HOLD rule and all negative verifier gates remain unchanged. This decision does not authorize production activation, credential changes or a protected merge.

---

## 1. Product decisions (fixed; not reopened here)

- The post is a weekly roundup titled **"Liberty Village + Exhibition Place this week"**. It covers stadium, venue and expo traffic, road works, transit, and local events and openings.
- The pipeline has seven stages:
  1. Collate signals from many sources.
  2. A reasoning agent fills one **structured form** per item.
  3. A deterministic verifier re-fetches each evidence URL and requires the quote, with its date and place.
  4. A copywriting agent drafts.
  5. Two internal review rounds between agent team members.
  6. The existing content gate gives the final adversarial review: score ≥8, zero HIGH/CRITICAL, bounded fixer.
  7. Publish, then smoke.
- The gate bar stays as it is. Nothing is fabricated. Crime, elections and private individuals are excluded.
- **Publish rule:** publish only with **≥3 counted qualified items and ≥1 core item**. Otherwise HOLD and alert. Concerts are aggregated to one counted line per venue per week.
- The one-item "weekly update" allowed by `content-cadence-2026.md` **does not apply** to this pipeline. A week with fewer than 3 counted items, or 0 core items, holds. If no edition is published, the cadence deadline emits `WEEKLY_NEWS_MISSED`.

## 2. What the backtest showed (and what this spec does about it)

| Backtest finding | Design response (section) |
|---|---|
| All four weeks (37–40) reached ≥3 qualified items under the backtest's lens, with 1, 1, 1 and 3 core items. | That original lens did not apply the inherited source-quality rule or replay clocks. In the **original projection**, the only core items without Instagram in weeks 37 and 39 were single-publisher blogTO listings (`weak-source`), so those weeks were expected to hold. This was not a proved historical replay (§7/A4). |
| The Instagram trial found first-party core items the other sources missed. By the trial's own count, core items went from 1/1/1/3 to 4/5/3/7. | Instagram is an enabled first-party source with a committed watch list (§4.4). The **original projection** expected W37/W40 to publish and W38 to hold. The incomplete captured-evidence exercise (§7/A4) instead measures W37/W39 HOLD and W38/W40 PUBLISH; neither column establishes an actual historical publication decision. |
| Venue calendars (BMO Field, Coliseum, Exhibition Place, RBC Amphitheatre) supplied 11 of 29 qualified items, with clean dates and venue identity. | Venue listings are identity sources. The trusted venue ID comes from the source registry, never from page text (§4, §6.2). |
| Keyword locality failed: site-nav mentions, NY Liberty, publisher labels, name-only events, Parkdale results, a lat/lon bbox. | Locality comes from **one item-bound record**: a venue listing row, a JSON-LD Event, a feed record, or a page section that states where the item happens. The agent's verdict can only lower locality, never raise it (§6). All traps are mandatory negative tests (§12, A1/A4). |
| Serper's `cdr` filter leaks old items; syndication re-dates stories; Star JSON-LD dates are malformed. | Dates come from the page's own dateline. Search metadata is never date evidence. Syndicated copies are dated from a resolved original, or are `unverifiable` (§6.4). |
| Road restrictions and TTC alerts keep no history. Past weeks were undercounted. | Volatile feeds are snapshotted every run and kept as evidence (§8). |
| An ongoing road work (Strachan hydro, Sep 10–Nov 27) qualifies for 11 weeks. | An item listed in an earlier live edition's `roundupCoverage` may appear under "Still in effect" but **does not count** (§6.6). |
| RBC Amphitheatre adds concerts every week. | Concert listings are aggregated per venue per week and count at most once (§7). |
| Reddit, the directory, SerpApi date-filtered news and the Ontario Place calendar added nothing. | These are dropped from the roundup source set (§4). |
| TorontoToday, Toronto Life and NOW return 403; the Globe is paywalled. | These are classified `blocked` → `unverifiable`, with no retry and no circumvention (§4.3). |
| Most LV-specific September news was crime or election coverage. | Those items are refused as `risky` and never published, even as a link (§6.5). |

## 3. Pipeline overview

```
collect ─► signals.jsonl + snapshots/     (deterministic; network; no model; records extracted per §6.1)
   │
reason  ─► forms.jsonl                    (model; tool-less; output is untrusted data)
   │
verify  ─► verified.jsonl + verify-report (deterministic; re-fetch; item-bound records; source quality; windows; risk; dedupe)
   │
plan    ─► plan.json (publish | hold)     (deterministic publish rule, §7)
   │  hold ─► result.json {decision:'hold'} ─► runner hold notice (§10.3)
   │
write   ─► draft.json                     (model: copywriter)
review1 ─► findings-1.json ─► revise      (model: fact reviewer; deterministic post-check)
review2 ─► findings-2.json ─► revise      (model: locality, risk and tone reviewer; deterministic post-check)
   │
assemble─► pack.json + result.json + data/posts.json append   (deterministic; §9.3)
   │
runner  ─► prior-week reconcile ─► cadence reserve/attempt ─► content submit --kind roundup ─► gate ─► deploy ─► smoke
```

Every stage runs through the runner's existing `source()` path. That means trusted code from the pinned SHA, `sourceEnv('weekly-roundup')` (source and model keys only), and no DB URL, deploy hook, Slack webhook or bypass.

- **History input.** The only history the pipeline reads is the live `data/posts.json` in `--root`, which the runner's `exportSnapshot()` writes from the trusted DB before the source runs. Prior coverage and roll-forward come from the `roundupCoverage` field of live roundup posts in that export (§6.6).
- **Model calls.** They are **tool-less** Messages API calls that return JSON validated against a schema. Model output is data. Trusted code parses it, never executes it, and decides admission deterministically.
- **Tools out of scope.** If a later design gives any agent tools such as web fetch or shell, those stages must move into the `lv-generator` scratch sandbox under the existing transfer allowlist.

## 4. Source set

### 4.1 Registry

Roundup sources live in a new `ROUNDUP_SOURCES` export in `scripts/news-pilot/sources.mjs`, separate from the daily-news `SOURCES`. Each entry has these fields:

- `id`
- `identityKind`: `venue`, `road-feed`, `project`, `org`, `transit-feed` or `news-discovery`
- `identityId` (for example `venue:bmo-field`), where one applies
- `url`
- `parse`: `jsonld-event`, `html-listing`, `json-feed`, `html-page` or `serper-news`
- `recordSelector`: for `html-listing`, the checked-in row selector (§6.1)
- `tier`: `official` for every identity source (the organisation publishing its own events, records or statements). `news-discovery` has no fixed tier; see below.
- `locality`: `core` or `adjacent`, for venue identity sources
- `officialDomains`
- `minIntervalMs`: per-host politeness
- `enabled`

A source is enabled only after the builder re-probes it (HTTP 200, robots allowed, item-level dates parseable) and records the probe date in `note`.

**Publisher tiers for discovered pages.** A page reached through Serper gets its tier from a checked-in `ROUNDUP_PUBLISHER_TIERS` map keyed by registrable domain. The map is reviewed and changed only by PR.

- `official`: the organisation's own domain for its own events, services or statements. The initial list is toronto.ca, ttc.ca, metrolinx.com, explace.on.ca, libertyvillagebia.com, bmofield.com, coca-colacoliseum.com, rbcamphitheatre.com, canadasoccer.com, torontofc.ca, argonauts.ca and thepwhl.com.
- `primary`: a business's or organisation's own domain, taken from its entry in the committed Instagram watch list (§4.4), whose verified address is LV-core. It applies only to that organisation's own events at that address or at a core venue it names.
- `reputable`: carried from the daily-news `SOURCES` tiers (cbc.ca, globalnews.ca, thestar.com).
- Every other domain is `lead`, including blogto.com, citynews.ca, newswire.ca and syndication partners.

Neither Serper, the query that found a page, nor any model output can assign or raise a tier (§6.7).

| id | identity | locality | parse | notes |
|---|---|---|---|---|
| `rv2-serper-news` | news-discovery | per record (§6.3) | serper-news | Google News via Serper `/news`. At most 12 queries per run, drawn from the fixed query set in §4.2. It surfaces leads only: a result or snippet is never evidence. The fetched page's tier comes from `ROUNDUP_PUBLISHER_TIERS`. |
| `rv2-bmo-field` | `venue:bmo-field` | adjacent | html-listing (JSON-LD if present) | `https://www.bmofield.com/events`. Evidence comes from the dated listing rows, not the detail pages. Research §8 found the detail pages weak. |
| `rv2-coliseum` | `venue:coca-cola-coliseum` | adjacent | html-listing | `https://www.coca-colacoliseum.com/events` |
| `rv2-explace` | `venue:exhibition-place` (sub-venues: Enercare Centre, Beanfield Centre, Queen Elizabeth Building; Hotel X grounds excluded) | adjacent | html-listing | `https://www.explace.on.ca/events/` |
| `rv2-rbc-amphitheatre` | `venue:rbc-amphitheatre` | adjacent | jsonld-event | `https://www.rbcamphitheatre.com/shows`. JSON-LD `MusicEvent`. The selected Event's `location.name` must match the venue alias list, which guards against Live Nation cross-venue rows. |
| `rv2-road-restrictions` | road-feed | per segment (§6.2) | json-feed | `https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json`. Only currently active records are available, so it is snapshotted every run. |
| `rv2-lv-bia-events` | `org:lv-bia` | per section location (§6.2) | html-page | `https://www.libertyvillagebia.com/events`. Each event section is a record. It is core only when that section states an LV-core address or venue as where the event happens. "Events in & around LV" entries without one are leads. |
| `rv2-city-projects` | `project:<id>` | per section (§6.2) | html-page | Watched City LV project pages. The initial list is 34 Hanna Ave park, Liberty St, and Liberty For All; it is checked in and changed only by PR. Only a dated statement in one page section is an item. A content-hash change is a trigger to re-read the page, not evidence. |
| `rv2-ttc-alerts` | transit-feed | per route + stop (§6.2) | json-feed | `https://alerts.ttc.ca/api/alerts/live-alerts`, which the backtest found reachable. The daily-news `ttc-alerts-live` entry (`/live`, 404) stays disabled. Routes: 504, 29, 509, 511, 63. |
| `rv2-instagram` | `ig:<handle>` from the committed watch list | per post (§4.4, §6.2) | ig-post | First-party posts owned by watch-list accounts, collected through the pluggable provider in §4.4. Tier is `primary` only for the account's own event at its own verified address or a core venue it names; otherwise `lead`. |

**Dropped from the roundup:** Reddit/Apify, directory-as-news (`data/businesses.json`), SerpApi (including date-filtered `tbm=nws`), the Ontario Place calendar, and City news releases. City releases may stay in daily news; they are not a roundup source. `SERPAPI_API_KEY` is removed from `SOURCE_ENV['weekly-roundup']`. The daily `news` job is unchanged.

**Instagram** is an enabled first-party source. See §4.4.

### 4.2 Fixed Serper query set

Queries are fixed, checked in and bounded. The query text only affects recall; admission is decided in §6.

- `"Liberty Village" Toronto`
- `"Exhibition Place" Toronto`
- `"BMO Field"`
- `"Coca-Cola Coliseum"`
- `"Enercare Centre"`
- `"Lamport Stadium"`
- `"Ontario Line" Exhibition`
- `"Hanna Avenue" OR "Atlantic Avenue" OR "Jefferson Avenue" OR "East Liberty Street" Toronto`

Results are filtered to the window using the **page's** dateline after fetch (§6.4), never Serper's date or the `tbs` filter. When several results for one query cover the same story from different publishers, the collector passes them to the reasoner as one signal group so the form can cite corroborating evidence (§6.7).

### 4.3 Access rules (all sources)

- **robots.txt:** fetch it once per host per run, and cache it in the run dir. If a path is disallowed, skip that source or URL and record `robots-disallowed`.
- **Politeness:** at most 1 request per host per `minIntervalMs` (default 2 s). Each run has a budget of 80 fetches (the existing `MAX_REQUESTS`) plus 12 Serper calls. Requests use the existing public-HTTP guard and User-Agent from `fetch.mjs`.
- **Blocked responses:** 401, 402, 403, 406, 429, or a known challenge body ("Just a moment", "Security Verification", `cf-chl`) are classified `blocked`. There is no retry with another UA, no cookies, no headless browser and no archive substitution in the live run. The item becomes `unverifiable`.
- **Paywalls and metering:** paywalled text is never used. A metered page counts only for the text actually served to an anonymous fetch.
- **Wayback:** the live pipeline never uses it. It appears only in backtest replay fixtures (§12, A4).
- **Instagram** is read only through the provider adapter (§4.4). The pipeline never fetches instagram.com pages directly, and never uses a login or cookies.
- **Untrusted content:** external content is data. It never changes gate thresholds, source tiers, cadence receipts or protected controls.

### 4.4 First-party source: Instagram (enabled)

**Why.** The read-only trial (`lib_village/.state/archive/2026-09-29-ig-trial/report.md`) screened 230 owned posts from 34 verified LV accounts. It found 13 first-party core items that no other source had. It also found 94.8% of posts yield nothing, so every rule below is about refusing the noise.

**Watch list (trusted registry data).** `scripts/news-pilot/data/ig-watch.json` is committed, reviewed and changed only by PR. Each entry holds:

- `handle`, `business`;
- `canonicalVenueId`: the account's venue in the shared venue registry (§6.2), for example `addr:116-atlantic-ave` or `addr:171-east-liberty-st#113`. It resolves to a verified LV-core address, or a named core venue such as Liberty Village Park, 70 East Liberty St;
- `verificationUrl` and `verificationMethod`: the business's or organisation's own site linking the handle and giving the address;
- `ownDomain` (the `primary` domain in §4.1);
- `multiLocation: bool`;
- `requiresVenueInPost: bool`: true for organisations without their own premises (the LVRA, Green Liberty Village). Their posts must name the core venue or address; the watch address is never assumed;
- `provider: 'apify' | 'meta'`.

The address must classify core under §6.2: an address point in the table, or a core venue in the geo module. Stale directory addresses are corrected from the business's own site, as the trial did (for example Burger Drops at 116 Atlantic Ave, Impact Kitchen at 99 Atlantic Ave). An account without a verified core address is not listed. The initial list is the trial's `accounts.csv`, re-verified by the builder.

**What qualifies.** A post is a signal only if all of these hold:

- **Owned.** It is owned by the watch account: the provider's `ownerUsername` equals the handle. Tagged, collaborator, pinned-old and reposted content is dropped.
- **Dated event.** It announces a dated event, opening or closure (`item_type` event, opening, closure or class). Routine promos, daily specials, menus, holiday hours, "come visit" posts and generic recurring classes with no specific dated session are `not-news`.
- **Forward-looking.** The post's timestamp is before the event's start instant. Retrospective posts ("last Saturday", "what a night", recaps) **never** qualify, even when the date is recoverable.
- **Class cap.** Recurring classes and workshops (`item_type: 'class'`) count at most one per **canonical venue** per edition week, whichever account posts them. They cannot be the edition's only core item (§7).

**Locality** (§6.2). It comes from the verified account address when the post's event is at the account's own venue: the post names the venue, its handle or its address as the location, or it is a single-location account and states no other place. It can also come from an **explicitly named core venue or core address in the post**.

- It **never** comes from the caption alone: "#LibertyVillage", "in Liberty Village" or the account's membership in the list confer nothing.
- A `multiLocation` brand's post must state the LV address or venue.
- A post that states any other location is classified by that location. For example, Burger Drops' Oct 2 event at The Barn, Downsview Park is `not-LV`.

**Dates** (§6.4). The date must be explicit, from one of two sources:

- a calendar date (month and day, with an optional weekday and year) in the **caption**; or
- an **unambiguous relative day word**: `today`, `tonight`, `tomorrow`, `this <weekday>` or `next <weekday>`. It is resolved deterministically against the post's **platform timestamp** in America/Toronto. That timestamp is trusted provider metadata, not caption text.

Ambiguous phrases ("this weekend", "next week", "soon", "coming up") are `undated`. See §6.4 for the exact resolution rules (parent decision, 2026-09-29).

**Image-only dates are excluded from v2.** A post whose date, time or place appears only in image text is a `lead`. It never counts, and it can only point to a qualifying source. Provider alt text is generic in practice ("Photo by … on September 10, 2026."), and a sound transcription proof would need its own blinded, media-bound model stage. That is a possible later addendum, not part of v2.

**Source quality** (§6.7). A first-party account announcing **its own** event at its own verified address, or at a core venue it names, is `primary` for **that event**. Anything else from Instagram is a `lead` that needs corroboration.

**Decision recorded (John, 2026-09-29).** The Apify `apify/instagram-scraper` is approved as the Instagram provider for **both staging and production**. The Meta Business Discovery adapter remains an optional later swap behind the same interface. `APIFY_API_TOKEN` is provisioned on the runner for the **source process only**: it is in `SOURCE_ENV['weekly-roundup']` and in the root-only target env files. It is never in the `lv-generator` sandbox env, any other job's env, the writer or review model calls, logs or Slack.

**Provider (pluggable).** `scripts/news-pilot/ig-provider.mjs` defines:

- `listRecentPosts({handles, newerThan, limit})`, returning rows of `{handle, ownerUsername, shortcode, url, timestamp, caption, images:[{url, altText}], type}`;
- `getPosts(shortcodes)`, for re-verification by the submit helper.

Two adapters implement the same watch-list contract:

- **`apify` (approved for staging and production).** It uses `apify/instagram-scraper` with only public profile URLs, `resultsType=posts`, `resultsLimit=20` and `onlyPostsNewerThan` of the window start minus 21 days. There are no session credentials, login or cookies. `APIFY_API_TOKEN` is added to `SOURCE_ENV['weekly-roundup']`. A per-run cap of US$1 and 34×20 results is enforced before the call; the trial measured about US$0.11 per run.
- **`meta` (optional later swap).** It uses the Meta Business Discovery Graph API if John later provides a professional Instagram account linked to a Facebook Page, a Facebook app and a token. That API covers only Business and Creator accounts, so each watch entry names its `provider`, and accounts that the API cannot reach stay on `apify`. Switching is a reviewed PR.

**Timestamp check.** The provider `timestamp` is the post's platform time. It is used for availability, forward-looking checks and relative-date resolution. It is cross-checked against the creation time encoded in the shortcode's media ID. The encoded time is when the upload began, so publication can lag behind it.

- The check passes when `encoded − 2 min ≤ timestamp ≤ encoded + 72 h`. Otherwise the post is `unverifiable`.
- The trial's 253 owned posts support this band: a median lag of 0.4 min, 22 posts over 5 min, a maximum of 50 h, and none earlier than the encoded time by more than 1 min. IG214 lags by 20 min.
- Only the provider timestamp is used, never the encoded time. It is the later of the two, so the choice is conservative.

**Submit re-fetch (credential boundary).** `content submit` runs under `trustedEnv` and never holds `APIFY_API_TOKEN`. Instagram re-verification for submit therefore works like this:

1. Immediately before `content submit`, the runner calls `deps.source('scripts/news-pilot/ig-refetch.mjs', ['--pack', <attemptDir>/pack.json, '--out', <attemptDir>/ig-refetch.json])` under `sourceEnv('weekly-roundup')`. This is trusted code at the pinned SHA.
2. The helper calls `getPosts` for **exactly** the Instagram shortcodes cited in the pack. It writes `{fetchedAt, provider, rows:[{shortcode, ownerUsername, timestamp, caption, status: 'ok'|'missing'|'private'}]}` to the runner-owned attempt dir (mode 0600, not scratch).
3. The runner passes `--ig-refetch <file>` to `content submit`. Submit does not call the provider. It validates deterministically:
   - the file lists exactly the pack's shortcodes;
   - `0 ≤ T_submit − fetchedAt ≤ 30 min`;
   - each row has status `ok`, the same `ownerUsername` and `timestamp`, and a caption that contains the cited record text **verbatim**, with the event record re-extracted by the same code;
   - any deleted, private, missing or changed post **refuses that unit**. The §7 rule is then re-applied, and a pack below 3/1 is refused and rebuilt.
4. A missing or stale file is treated as every Instagram unit changed.

An idempotent replay returns the stored context and needs no file.

**Failure.** Any provider error, timeout, budget stop or empty response makes the source `unavailable` in the census. Other sources proceed, and Instagram never blocks a run. At submit, a helper failure refuses only the Instagram units, as above.

**Terms and continuity risk.** A third-party scraper of public data carries platform-terms and continuity risk. Public page behaviour, handles and privacy settings can change without notice. Mitigations:

- public profiles only;
- no login or cookies;
- low volume: at most 34 profiles × 20 posts per run and at most 3 runs a week;
- no republishing of Instagram images or captions: the post is paraphrased and linked;
- the Meta adapter path.

John accepted this risk for production on 2026-09-29, when he approved the Apify provider.

**Compiled switch.** `ROUNDUP_OPTIONAL_SOURCES.instagram = Object.freeze({ enabled: true, provider: 'apify' })` in `scripts/content/roundup-mode.mjs` (§10.1). It is changed only by a reviewed PR.

## 5. Structured form (reasoning agent output)

The reasoning agent receives signals in batches of up to 10. For each signal it gets:

- the collected fields;
- the signal's **records**, each with its trusted `recordId` and bounded record text (§6.1), with at most 2,000 chars per signal in total;
- for structured records, the collector's typed fields.

It returns exactly one form per signal. `scripts/news-pilot/roundup-reason.mjs` validates each form against a JSON schema; an invalid form is `form-invalid` and is dropped.

```jsonc
{
  "signalId": "sha256 of sourceId+url+recordId",   // copied from the signal; must match
  "recordId": "string",                             // the ONE record this item is about; must be a record of the signal
  "subject": "string ≤120",                         // the event or development name, as the record states it
  "what": "string ≤200",                            // plain description
  "where_it_happens": "string ≤200",                // where the item takes place, as the record states it
  "when": { "kind": "news-update|event|restriction|alert",
            "date": "YYYY-MM-DD",                     // Toronto-local; the dateline for news, the start for events
            "endDate": "YYYY-MM-DD|null",
            "startTime": "HH:MM|null",                // only if the record states it
            "endTime": "HH:MM|null" },                // only if the record states it
  "who_is_affected": "string ≤200",
  "relevance_reason": "string ≤300",
  "verdict": "core|adjacent|not-LV",
  "evidence": [                                     // 1–3 entries; entry 0 is the signal's own record
    { "url": "https URL fetched for this signal group",
      "recordId": "string",                         // the record on THAT url; must describe the same item
      "subject_quote": "verbatim ≤300",
      "place_quote": "verbatim ≤300|null",          // null only when place comes from registry or typed fields
      "date_quote": "verbatim ≤200|null" }          // null only when the date comes from typed fields
  ],
  "item_type": "event|class|concert|sports|expo|community|opening|closure|road|transit|project|news",   // class = recurring class/workshop session
  "people": [ { "name": "string", "role": "performer|athlete|team|organisation|business|public-official|private-person|unclear" } ],
  "risk": { "crime": bool, "election": bool, "private_individual": bool,
            "development_application": bool, "civic_controversy": bool },
  "exclude_reason": "string|null"                   // the agent may exclude; it may never admit on its own
}
```

The agent's job is **judgement**:

- whether this is a genuine dated development or event;
- who it affects, and whether it has resident impact (the Hotel X spa award, for example, is `not-LV`: an adjacent place with no resident impact);
- the risk flags;
- the role of every named person;
- the verbatim evidence.

The agent **cannot establish locality, dates, source quality or admission**. The verifier recomputes all four from the cited records (§6). The agent's verdict is a ceiling: the final verdict is `min(agentVerdict, identityVerdict)`, ordered `not-LV < adjacent < core`.

A form whose `risk` has any true flag is refused. So is a form with any `people[].role` of `private-person` or `unclear`. Whether a person is a private individual is a **model assessment**, checked again by an independent reviewer and the gate (§6.5, §9.2). It is not a deterministic guarantee.

## 6. Deterministic verifier (`scripts/news-pilot/roundup-verify.mjs`)

The verifier runs twice: once in the pipeline at `T_plan`, and again inside `content submit` at `T_submit` before the DB write (§6.5, §9.4). The two runs share one implementation. There are no model calls.

### 6.1 Item-bound evidence

An item is admitted only on evidence bound to **one trusted record** per evidence entry. Subject, place and date must all come from that record. Nothing may be combined from another record, another row, another JSON-LD object or another page section.

**Records.** The collector extracts records deterministically, and the verifier re-extracts them from the fresh fetch with the same code. `recordId` is a stable hash of the fields below, never a model value.

| Parse | Record | `recordId` from | Typed fields |
|---|---|---|---|
| `html-listing` | One listing row matched by the source's checked-in `recordSelector`. | sourceId + normalized row title + row date text | subject (row title), date text, time text; place = the registry venue |
| `jsonld-event` (and JSON-LD on any page) | One JSON-LD object whose `@type` is `Event` or an Event subtype. Organization, Person, WebPage, NewsArticle and publisher objects are **never** records. | url + `name` + `startDate` + `location.name` | subject = `name`; start/end = `startDate`/`endDate`; place = that Event's own `location` (name and `address`) |
| `json-feed` | One feed record, located by its trusted `id`. | the record `id` | typed fields per §6.1 step 4 |
| `html-page` (news, org, project) | One **section** of the main region: a heading element and its content up to the next heading of the same or higher level. A page with no headings is one section. | url + heading text + section ordinal | none; subject, place and date must be quoted from the section |
| `ig-post` | One **event record**. A caption with exactly one distinct resolved date (repeats of the same date count once) is **one** record: the whole caption, with raw line breaks and emoji preserved. A caption with more than one distinct date is split into blocks at blank lines. A `[ … ]` bracket heading stays attached to the lines under it up to the next blank line. Each block must itself hold the subject, date and place of its event, or that event is `unverifiable`. Image text is never a record (§4.4). | shortcode + record ordinal | owner handle; provider timestamp (checked against the shortcode, §4.4); subject, place, date and any time must be quoted from the same record, or place from the watch entry (§6.2) |

**Steps.**

1. **Re-fetch** every evidence `url` live under the access rules in §4.3. Search caches and snapshots are never used for text sources.
2. **Build the main region**:
   - **HTML:** the main content from the existing `extractMainHtml`, with `<nav>`, `<header>`, `<footer>`, `<aside>`, menus and elements whose role or class matches navigation or breadcrumbs removed. Each `application/ld+json` block is parsed separately into objects.
   - **Normalization:** decode entities, collapse whitespace, map curly quotes to straight quotes and en/em dashes to `-`, and apply NFC. Matching is case-sensitive.

   Stripping navigation is what defeats the **site-nav keyword** trap: the TorontoToday stabbing page mentions "Liberty Village" only in its menu.
3. **Locate the record.** Re-extract the record named by the entry's `recordId` from the fresh main region.
   - A missing record is `record-missing`.
   - Every quote in the entry must be a substring of **that record's** normalized text. For JSON-LD, that is the Event object's own serialized fields.
   - A quote found only elsewhere on the page is `cross-record`. A quote from another URL or another item's source is `source-swapped`.
4. **Feed sources** (`json-feed`): road restrictions and TTC alerts.
   - The verifier locates the record by its trusted ID in both the run snapshot and a fresh re-fetch. The typed fields must be equal in both: road restrictions compare `id, road, fromRoad, toRoad, startTime, endTime, description`; TTC alerts compare `id, route, stops/segment text, effect, active period`.
   - The quote must be a raw substring of the fresh record's serialization.
   - The date and place come from the typed fields. Road-restriction epoch milliseconds are converted to Toronto local time.
   - A record that is missing from the fresh fetch is excluded: the restriction or alert has ended.
5. **Subject.** For structured records, the record's typed subject must equal the form's `subject` after normalization. For sections, `subject_quote` must contain the form's `subject`.
6. **Date.** The date comes from the record's typed fields, or from a `date_quote` inside the same record that resolves to `when.date` under §6.4.
7. **Place.** The place comes from the record, per §6.2 (identity and structured records) or §6.3 (prose sections). A place that is only an organizer, publisher, sponsor or actor address is not the item's place.
8. **All entries agree.** Every evidence entry must independently support the same subject, place classification and date. An entry that cannot is dropped. The remaining entries then go to the source-quality check (§6.7).

### 6.2 Locality from identity and structured records (`scripts/news-pilot/roundup-geo.mjs`)

Locality uses one checked-in, reviewed geography module plus two generated data files. It has **no lat/lon bounding box and no free-text keyword match.**

- **Core polygon** (`scripts/news-pilot/data/lv-core.geojson`).
  - Boundary: King St W (north), the rail corridor / Gardiner (south), Strachan Ave (east), Dufferin St (west). These are the backtest's boundary.
  - It is derived from the City's Toronto Centreline and checked in with its derivation script and source dataset version.
  - It needs review sign-off before any test depends on it.
- **LV address points** (`scripts/news-pilot/data/lv-address-points.json`).
  - These are `{number, street}` pairs from the City's Address Points dataset whose point lies inside the core polygon, generated by the same script.
  - A **core address** is a house number plus a street pair present in this table, **in Toronto**. The record must establish Toronto: a JSON-LD `addressLocality` of Toronto or an `M6K` postal code, "Toronto" in the same record, or a registry source whose geography is Toronto (City, BIA or a venue).
  - One-word `Lakeshore` in the reviewed RBC JSON-LD address `909 Lakeshore Blvd. W.` is read as `Lake Shore` only within a parsed house-number + street + suffix address with Toronto context. A bare `Lakeshore` claim still fails closed; an `E` direction is **not** the reviewed west-side RBC venue. No broader place-name equivalence is inferred.
  - A street name alone never makes something core. For example, a Mowat Ave address north of King is not in the table.
- **Segment table** (`scripts/news-pilot/data/lv-segments.json`). This holds Centreline segments keyed by `(linear_name, from_intersection, to_intersection)`:
  - **Core:** segments wholly inside the polygon, such as Hanna Ave, Atlantic Ave, Liberty St, East Liberty St, Jefferson Ave, Mowat Ave (south of King), Fraser Ave, Pirandello St, Snooker St, Lynn Williams St and Western Battery Rd. The generated table is authoritative over this prose list.
  - **Adjacent frontage:** King St W from Strachan to Dufferin, including a segment with one endpoint at a boundary intersection. Strachan Ave from King St W to Lake Shore Blvd W. Dufferin St from King St W to Exhibition Place. Lake Shore Blvd W from Strachan to Dufferin. Exhibition Place internal roads.
- **Road restriction locality.** A record qualifies only when its `road` matches a segment's `linear_name` and its `fromRoad`/`toRoad` resolve to an intersection on that segment. Then:
  - a core segment makes it core;
  - an adjacent segment makes it adjacent;
  - anything else makes it `not-LV`.

  Record coordinates are used only as a consistency check: a point more than 150 m from the matched segment means `not-LV`. They are never the admission test. Joe Shuster Way, Douro St, and Temple Ave / Elm Grove / Tyndall west of Dufferin are not in the table, so they are `not-LV`.
- **Venue locality.** A venue listing row takes the registry's `venue:*` ID. A JSON-LD Event takes its own `location`, which must match the source's venue alias list or classify under this module. Page text never supplies a venue ID.
  - In a prose section (§6.3), a venue counts only as its full allowlisted name: "BMO Field", "Coca-Cola Coliseum", "Exhibition Place", "Enercare Centre", "Beanfield Centre", "Queen Elizabeth Building", "RBC Amphitheatre", or "Lamport Stadium" (Lamport is **core**). It also needs Toronto context in the same record: "Toronto", "Exhibition Place", or the page is on the venue's official domain.
  - A bare "Coliseum", "Liberty" or "Exhibition", or a same-named venue elsewhere, does not count.
- **Project locality.** A `project:*` ID makes a `project` item core only when the item is about the project site itself, such as a construction milestone or a park opening at that site.
  - An event on a project page (an open house, meeting or consultation) takes its locality from **its own stated location**, classified by this module. For example, the 34 Hanna Ave park open house at 171 East Liberty St is core by address.
  - An off-site, virtual or unlocated meeting is `not-LV` or `unverifiable`, never core by project identity.
- **Org locality.** An `org:*` ID (the BIA) never supplies locality by itself. Each event section is classified by its own stated location under §6.3.
- **Shared venue registry** (`scripts/news-pilot/data/lv-venues.json`, committed and changed by PR). One registry serves the watch list, core addresses and venue sources.
  - Each venue has a `canonicalVenueId`: the normalized verified address, `addr:<number>-<street>[#<unit>]`, lower-case with standard street suffixes. The unit is kept when the verified address has one, so separate businesses in one building (NRG Haus #113 and Oxygen Yoga #126 at 171 East Liberty St) are separate venues.
  - Each venue also has its name aliases, locality (from the address point), and any registry `venue:*` ID mapped onto it. For example `venue:bmo-field` maps to BMO Field's address point, and Enercare Centre and the Queen Elizabeth Building are their own entries.
  - It includes named core venues: Liberty Village Park (70 East Liberty St) and Lamport Stadium (75 Fraser Ave). In prose or a caption, a named core venue counts like a core address when the §6.3 relation rules hold.
  - A record whose stated venue name and stated address resolve to **different** canonical venues is `unverifiable`.
- **Instagram locality.** An `ig:<handle>` post takes the watch entry's verified core address only when the post's event is at the account's own venue (§4.4). An explicitly named core venue or core address in the same event record also counts. The caption alone never supplies locality: hashtags, "in Liberty Village" and list membership confer nothing. A `multiLocation` or `requiresVenueInPost` account needs the LV address or venue in the post's event record. Image text does not count. A post stating another location takes that location's classification.
- **Transit locality.** A TTC alert qualifies only if its route is in {504, 29, 509, 511, 63} **and** its affected stop or segment text matches the per-route stop allowlist in `roundup-geo.mjs`. Examples: 504 on King St W between Strachan and Dufferin; 509/511 at Exhibition Loop; 29 at Dufferin Gate or Exhibition; 63 at Liberty Village. A whole-route or city-wide alert with no allowlisted stop is `not-LV`. The CP24 "weekend TTC/GO closures" pattern is `not-LV`.
- **Final verdict** = `min(agentVerdict, identityVerdict)`. If `identityVerdict` cannot be computed, the item is `unverifiable`, whatever the agent said.

### 6.3 Prose sections: where the item happens

This applies to `html-page` records: news pages, BIA sections and City project sections. The place must be stated **as where the item happens**. These checks are deterministic necessary conditions. When they cannot decide, the item is `unverifiable`.

1. **A classifiable place token.** `place_quote` contains one of these:
   - an LV **core address** under §6.2, which makes it core; or
   - an allowlisted **adjacent venue full name** with Toronto context, or an allowlisted transit location (for example "Exhibition Station" together with "Ontario Line"), which makes it adjacent.
2. **An event-location relation.** The place token is introduced by a location relation from a fixed list: `at`, `in`, `on`, `to` after "returns", "coming", "moving" or "opening", `Location:`, `Venue:`, `Address:`, `Where:`, `📍`, "takes place at", "will be held at". It is **not** governed by an actor-address phrase from a fixed list: "based at", "based in", "headquartered", "head office", "offices at", "presented by … of", "organized by … at".
3. **Same item.** The place sentence also contains the subject or the date quote. Alternatively, the section describes exactly one item and states the place in a `Location:`/`Venue:`/`Address:` label.
4. **Ambiguity holds.** The item is `unverifiable` when:
   - the section names more than one event, meaning more than one subject or more than one distinct resolved date, and the place sentence does not also name the claimed subject; or
   - the section contains more than one classifiable place token with different classifications and rule 3 does not single one out.

Worked cases:

- **Actor address, not event place:** "Organizer based at 40 Hanna Ave presents an event at High Park". 40 Hanna is governed by "based at", and High Park does not classify. The item is `unverifiable`, even though the agent claims `core`.
- **Second event on the same page:** a local event section at 40 Hanna and a zoo event section. A form that names the zoo event but quotes the 40 Hanna place is `cross-record`. On a page with no headings, the zoo sentence does not state an LV place, so it is `unverifiable`.
- **Publisher label:** a headline such as "…opening in Liberty Village" is **not** locality. Toro Toro Sushi's page gives "east side of Strachan south of Wellington", which is not an address point in the table, so the page is `not-LV`.
- **Name-only events:** `unverifiable`. Examples: the "Liberty Village Eco-Fair" with no venue, and the "Fort York – Liberty Village" show at a secret venue.
- **Keyword collisions:** they confer nothing. A token-only "Tempo fall to Liberty" (the NY Liberty) and US namesakes (Hurricane, UT; libertyvillage.org) fail the address/venue test.
- **Parkdale:** pages fail because they contain no core address point. Examples: CBC "issues facing Parkdale", and 1205 Queen St W.

The deterministic rules are a floor, not a proof of meaning. Review round 1 also checks `wrong-place` against the quoted record (§9.2), and the agent's verdict can still only lower locality.

### 6.4 Dates

- **News-update dates** come from the page's own dateline. The source is either:
  - the visible dateline in the main region, or
  - `article:published_time` / NewsArticle JSON-LD `datePublished`, only when the same local date also appears in the visible text.

  Serper `date`, `tbs` results, `dateModified` and HTTP `Last-Modified` are never date evidence. A malformed JSON-LD date (the Star's `'+ com['` pattern) is ignored in favour of the visible dateline.
- **Syndication.** A page is a **syndicated copy** when any of these hold:
  - its `<link rel="canonical">` points to a different registrable domain;
  - its main region contains an attribution from the checked-in pattern list ("originally published", "first published", "appeared originally", "republished with permission", "This article is from", "© Toronto Star" and similar);
  - its domain is in the checked-in `SYNDICATION_PARTNERS` list (initially toronto.com, durhamregion.com and the other Metroland sites that carry Star content) and the page names another publication as the source.

  For a syndicated copy:
  1. Resolve the original: the foreign canonical URL, or else an explicit link in the attribution sentence. Nothing else is guessed.
  2. Fetch the original once under §4.3. If there is no resolvable original, the original is blocked or unreachable, the original is itself a copy, or the link loops back, the item is `unverifiable`.
  3. A **self-canonical** page with a syndication attribution and no linked original is `unverifiable`.
  4. The item is dated **only** from the original's dateline. The copy's dateline never refreshes the story, so an original outside the window is `stale`.
  5. The copy and its original count as **one** publisher for §6.7.
- **Event dates.** Admissible sources, in the item's own record only:
  - a year-bearing JSON-LD `startDate`/`endDate` of the selected Event object;
  - a dated listing row in an identity **venue** source. A row with no year (for example "Sat Oct 3") resolves deterministically to the **unique** occurrence of that month and day in `[weekStart − 7d, weekStart + 28d]`. If there is none, or more than one, the item is `undated`. Year inference is allowed **only** for identity venue rows;
  - an **explicitly year-bearing** date in an item-bound section of an official `org:*` or `project:*` source, in the same section as the subject and the event location. The two real layouts are the BIA's "On Thursday, September 17th, 2026, the iconic Lamport Stadium parking lot (75 Fraser Avenue) will transform…" and the City's "Open House Date: October 3, 2026 Time: Noon to 4 p.m. Location: Liberty Market Building, 171 East Liberty St." Ordinals and weekday names are accepted by the existing `fullDatesInSpan` grammar.

  - an **explicit** date in the event record of a watch-list post's caption (§4.4, §6.1). A yearless month and day resolves to the unique occurrence in `[post date, post date + 60 days]`.

    **Relative day words** resolve against the post's provider timestamp, converted to the America/Toronto date `P`:
    - `today` and `tonight` → `P`;
    - `tomorrow` → `P + 1`;
    - `this <weekday>` → the first date ≥ `P` with that weekday, so `P` itself if it is that weekday;
    - `next <weekday>` → that date + 7 days.

    Ambiguous phrases ("this weekend", "next week", "soon", "coming up", "later this month") are `undated`. If a block contains both a relative word and a calendar date that resolve to different dates ("tomorrow, Sept 20" posted Sep 18), the item is `undated`. Retrospective use ("last Saturday", "today was…", "tonight" in a post after the event) is caught by the forward-looking rule in §4.4.

    Image text is never date evidence in v2 (§4.4).

  A yearless date in org or project prose is `undated`. So is a date from another section, or an unrelated page date such as "Last updated". Free-text news prose is never event-date evidence: a news item is dated by its dateline and admitted as a news-update.
- **Time.** A time is used only when it is proven. There are two ways:
  - **Year-bearing spans:** the existing `sourceSpanProvesTime` rule, unchanged for news, listings and JSON-LD.
  - **Resolved dates:** for records whose date was resolved by an accepted rule (a yearless venue row, a yearless or relative Instagram date, or an org or project section), the time proof is the **verified date resolution plus a literal time span in the same record**. Accepted forms are `7pm`, `7 PM`, `6:30pm`, `11:30AM`, `Noon`, and ranges such as `4-7 pm` or `7-10PM`.
    - A new helper, `recordProvesTime(record, resolvedDate, instant)`, checks both. It never fabricates a year-bearing quote.
    - A range gives a stated end.
    - A start with "until sold out", or no end, is a **stated start with unknown end**. Under §6.5 it becomes ineligible at its start.
  - Without a proven time, an event is date-only and ends at end of day. A stated time is never dropped to extend eligibility: if a time span is present in the record but fails proof, the item is `undated`.

### 6.5 Clocks, windows, risk and exclusions

**Clocks.**

- `T_plan` is the planning instant: the runner's `now`, passed as `--now` and stored as `result.now`.
  - It fixes the edition identity (ISO week, slot, slug), the pack digest, and the `planningCutoff` written to `roundupCoverage` (§6.6).
  - It never changes, including on idempotent replay.
- `T_submit` is the trusted first-submit instant. `submit.mjs` already takes it from its own clock and stores it as `temporalValidationNow` in the submission context.
  - Submit re-verification (§9.4) evaluates every window below at `T_submit`.
  - The gate uses `temporalValidationNow`, as it does today.
  - An idempotent replay returns the stored context, so it reuses the original `T_submit`.
- A unit that is eligible at `T_plan` but not at `T_submit` is refused, and the pack must be rebuilt. The six-hour `ROUNDUP_REVALIDATE_MAX_AGE_MS` stays as an upper bound on pack age; it is not a freshness proof.

**Week mapping.**

- The edition's ISO week is the **UTC** ISO week of `T_plan`, from the unchanged `isoWeekOf`. It sets the cadence slot and slug.
- `W` is the seven **Toronto calendar dates** carrying the same labels as that UTC week's Monday–Sunday. For example, at `2026-10-05T01:00:00Z`, which is Sunday October 4 at 21:00 in Toronto, the edition is W41 and `W` is October 5–11. An item dated October 4 is not in `W`; it can count only through roll-forward.
- The existing submit check that `T_submit` falls in the edition's UTC ISO week is unchanged.

**Event instants** (all Toronto local, converted to UTC instants):

| Case | Start | End |
|---|---|---|
| `startTime` proven | start date + `startTime` | `endDate` + proven `endTime` if both are stated; otherwise see the next rows |
| `endDate` stated, no end time | — | midnight at the start of the day after `endDate`, meaning end of day |
| no `endDate`, date-only start | midnight at the start of `when.date` | end of `when.date` |
| no `endDate`, `startTime` proven, no end time | — | **the start instant.** Unknown end is conservative: once an event has started, it is not an eligible event item. |

**Window rules by `when.kind`** (evaluated at `T` = `T_plan` in the pipeline and `T_submit` at submit):

- **news-update:** the dateline date `d` is on or before Toronto's date at `T`, and either:
  - `d` ∈ `W`; or
  - **roll-forward:** `d` is in the previous edition week's `W`, and `d` is on or after the Toronto date of the roll-forward cutoff.
    - The cutoff is the `planningCutoff` of the previous week's live edition (§6.6).
    - If the previous week has no live edition, the cutoff is that week's Monday, so the whole previous week counts.
    - Only one week rolls forward. Items already in a live edition's coverage are removed by §6.6, not by the cutoff.
    - Copy always states the actual date.
- **event:** not concluded at `T` (end > `T`), **and** either one of its dates is in `W`, or it starts before `T + 14 days` (instant arithmetic, half-open). A concluded event is not an event item.
- **restriction:** the active interval `[start, end)` intersects `[T, T + 14 days)`.
- **alert:** the alert is present in the fresh feed at `T`.
- **Too-far announcements.** A dated announcement published in-window about an event more than 14 days out qualifies only as a `news-update`. Examples: the Nations League on Nov 16, the Royal Winter Fair, the Sceptres opener.

**Refused (`risky`):**

- any form risk flag;
- any `people[].role` of `private-person` or `unclear`;
- the existing `detectRiskFlags`, `ELECTION_TEXT` and `isDevelopmentApplication`. These are narrow backstops for the patterns they recognise. They **do not** establish whether a person is private;
- crime, sentencing, courts;
- elections, candidates, vox pops;
- development or permit applications and tower proposals. These stay human-only, so the backtest's two bot-walled tower stories would be refused even if reachable.

**Private individuals: the subject policy.** The exclusion itself is unchanged.

- A named person may appear only in one of these roles:
  - a performer, act, team or athlete named in a venue listing or an organisation's own event record;
  - a public official acting in an official capacity;
  - a business or organisation, or its spokesperson speaking in that role.
- Any other identifiable person is a private individual: their personal life, home, finances, relationships, health, victimhood or opinions as a resident. The item is refused.
- **How person status is assessed.** It is a model assessment, fail-closed at three layers:
  1. The reasoner labels each person's role. `unclear` refuses.
  2. Review round 2, an independent call with a risk role prompt, re-assesses the draft and every unit's quoted record. Any private-person finding removes the unit, then the §7 rule is re-applied.
  3. The gate's roundup lens checks it as a blocking concern.
- The regex detectors are backstops only. A story that every model layer misclassifies is a residual risk that this spec does not claim to eliminate.

**Other exclusions:** `not-news` (directory entries, promotional copy, landing pages, listicles such as Narcity's "neighbourhoods I would never live in", advertorial such as the Toronto Sun BILD piece), `weak-source` (§6.7), `unverifiable`, `cross-record`, `record-missing`, `undated`, `stale`, `concluded`, `retrospective` (a post published at or after the event's start), `duplicate` and `previously-covered`.

**Impact wording** (carried over from the rejected adjacent-sources addendum, the one rule kept from it):

- A venue listing proves only the event, venue and date.
- Claims of road closures, detours, crowds, congestion, parking restrictions or transit disruption need a separate verified road or transit item for the same date and place, or a verbatim quote that states it.
- The deterministic post-check refuses unsupported impact wording (§9.2).

### 6.6 Identity, duplicates, prior coverage and cancellations

- **Identity keys.** Event keys are independent of post URL, account and record ID.
  - **Events at a place** (venue listings, JSON-LD Events, BIA and project event sections, Instagram): the **occurrence key** is `occ:<canonicalVenueId>:<Toronto date>:<HH:MM start | all-day>`.
  - road items: `road:<record id>`
  - transit items: `ttc:<alert id>`
  - project developments that are not events: `project:<id>:<record id>:<statement date>`
  - news-updates: `news:<canonical url of the original>`
- **Merging events.**
  - Records with the **same occurrence key** are one item: reminders, repeat posts, an Instagram post plus the business's own-domain page, or a listing plus a news article. The highest-tier record is the primary citation, and the others are extra citations. Two accounts posting the same occurrence give one item.
  - The **same venue and date with different stated start times** are separate items.
  - **Ambiguous** means the same venue and date where one record is `all-day` and another has a start time, or two different subjects share one occurrence key (for example two Enercare shows both all-day on one date). Then one item is kept and the other is held (`duplicate-ambiguous`, not counted). The item kept is chosen by higher tier, then a stated start time, then the earliest publication.
  - A **next-date recurrence** of the same event is a new key and counts.
- **Shared feed URLs.** Items from the same listing or feed may share one citation URL when their `recordId`s differ. This changes the current "roundup URL shared across items" rule for sources flagged `feed:true` or `listing:true` only (§11).
- **Prior coverage comes from the live export.**
  - Every roundup post published by this pipeline carries a structured field:

    ```jsonc
    "roundupCoverage": { "version": 1, "isoWeek": "2026-W40", "planningCutoff": "<T_plan ISO>",
                         "keys": ["road:Tor-RD042026-1044-5", "occ:addr:170-princes-blvd:2026-10-03:15:00", "..."] }
    ```

    `keys` holds every constituent identity key (occurrence keys for events) of the counted units, including each concert inside an aggregate and each merged record's key, plus the "Still in effect" items. Keys are ≤200 chars. **More than 64 keys refuses the roundup submission**; keys are never truncated or dropped.
  - The assembler derives the field from the pack, and submit re-derives it (§9.4).
  - **Integrity on every write path.** `roundupCoverage` is roundup-only trusted metadata. It is enforced in the shared `checkRecordPolicy` (`submit.mjs`), which every kind's submit and the gate fixer (`repair-adapter.mjs`) already call:
    - **Non-roundup kinds** (`seo`, `manual`, `news`, `blog` and every other kind) may not create the field on an insert. On an update, the field must be **byte-identical** (canonical JSON) to the live record's value, including absence. Removing, clearing or changing it is refused. A harmless visible edit that preserves it passes.
    - **Only `kind='roundup'`** may set it, and only to the value re-derived from the verified pack.
    - A fixer revision runs under its submission's kind, so the same rules apply.
    - Deleting the whole post (an unpublish) is allowed. Its keys stop being covered, because nothing live covers them.
  - The runner's normal `exportSnapshot()` writes live posts to `data/posts.json` from the trusted DB, and the pipeline reads coverage from there. The source process needs no DB access, and a VM rebuild loses nothing.
  - **Previously covered** means the key is in any live roundup post's `roundupCoverage.keys`. Such an item appears only under "Still in effect" if it is still active, and it does not count. A new occurrence date or a different start at the same venue is a new key and counts.
  - An unpublished or superseded edition is not in the live export, so its keys are no longer covered. Nothing live covers them.
  - A held week has no post. It adds no coverage, and the next week's roll-forward uses the §6.5 fallback.
  - **Legacy roundup posts** without the field contribute `news:<url>` keys for their cited URLs. If they fall in the previous week, their `publishedAt` is the cutoff.
- Existing daily-news duplicate rules (`matchExistingPost`, `relatedFingerprint`) still apply.
- **Cancellations and reschedules.** Re-verification at submit revalidates each record's date and existence. A changed date, "cancelled", "postponed" or a missing record excludes the item, and the pack must be rebuilt.

### 6.7 Source quality (the inherited cadence predicate, carried forward)

This is the rule from `content-cadence-2026.md`, implemented today in `roundup-evidence.mjs` (`primary || independent`). It is kept, not replaced. For each item, after §6.1–6.6, the surviving evidence entries must satisfy one of these:

- **Official or primary:** at least one entry whose tier is `official` or `primary` is substantive (`extractionSubstantive`) and fully item-bound, supporting subject, place and date; **or**
- **Independent corroboration:** at least two entries from **different registrable publisher domains** are each substantive and each fully item-bound on their own. A syndicated copy and its original count as one publisher.

Otherwise the item is `weak-source` and refused.

- Tier comes only from the registry (§4.1): `ROUNDUP_SOURCES[].tier` for identity sources, `ROUNDUP_PUBLISHER_TIERS` for discovered pages, and the Instagram watch list. It is never set by Serper, the query or the model.
- **Instagram:** a watch account's post about its **own** event at its own verified address, or at a core venue it names, is `primary` for that event alone. The same holds for the organisation's own-domain page (`ownDomain`). Anything else on Instagram (another business's event, a collaboration hosted elsewhere, a repost) is `lead` and needs an independent second publisher. Several posts from one account count as one publisher.
- The verifier does not search for corroboration. It checks only the entries the form cites, all of which must come from URLs fetched for this signal group.
- The predicate is exported from `roundup-evidence.mjs` as `roundupSourceQuality(entries)` and shared by the pipeline and submit.

Consequence, stated plainly: a lone blogTO, CityNews, Star, CBC or TFC Republic page does not qualify on its own, however local and well dated it is. §7 distinguishes this refusal rule from what the incomplete historical capture can prove about any particular week's decision.

## 7. Publish rule (`planRoundupV2` in `scripts/news-pilot/roundup.mjs`)

1. **Counted units.**
   - All `concert` items (music or performance listings) at the same `venue:*` in the window collapse into **one** aggregate unit per venue, rendered as one line. Example: "RBC Amphitheatre: Red Clay Strays (Sep 30), …".
   - Every other qualified item is its own unit, after identity dedupe by occurrence key (§6.6).
   - `previously-covered` items are not units.
   - `class` items count at most one unit per **canonical venue** (§6.2) per edition week, whichever account posted them. The earliest by start is kept, and further classes at that venue are dropped. Class typing comes from the verified form before counting, and round 2 re-checks it.
2. **Decision.** `publish` iff `units ≥ 3` **and** `coreAnchorUnits ≥ 1`, where `coreAnchorUnits` counts core units that are **not** `class`. A class at a core venue is a counted core unit for wording, but it cannot be the edition's only core item. Otherwise `hold`, with reasons (`below-minimum`, `no-core`, or both) and the census. The census reports `units`, `coreUnits` and `coreAnchorUnits`.
3. **Cap and order.** At most 12 units per edition. Order: core first, then roads and transit, then venues, then news and announcements. Ties break by first date, then identity key. "Still in effect" is not numbered and not counted. The copy never claims coverage it does not have.
4. **Two clocks.** The plan and the writer use `T_plan`. Submit re-verification re-applies this rule at `T_submit`, and a pack that falls below 3/1 is refused (§9.4). An idempotent replay keeps the original context, including both instants.

### Captured-evidence limit on A4

The §7 threshold, cap, clocks and one-pool availability rules remain normative. **The historical decisions projected in the original table below are not A4 acceptance criteria or a claim that those editions actually would have published.** The original trial rows and its 14:26 UTC collection note do not establish that the same full source bodies committed for the replay were available at each earlier slot. Three Wayback bodies have embedded, checkable August 28, August 31 and September 24 capture instants; the archived Instagram provider rows have pinned timestamps and raw captions. The other full bodies were copied from a September 29 live capture with no independent acquisition log; their 18:14–18:16 UTC file mtimes are not proof of availability by the September 29 15:00 UTC clock. They remain conservatively declared as captured at 18:30 UTC, after **every** replay clock. In particular, feed `createdTime` cannot substitute for a captured response. The R37 Canada Soccer body is a September 29 revision modified September 28; it cannot prove the page's contents at the September 25 clock, and unresolved fact (ii) stays unavailable.

A4 instead evaluates the frozen available evidence through the production record extractor, verifier and planner at each slot, including the explicitly labelled after-clock future-event exception. Its printed HOLD/PUBLISH table is a **captured-evidence exercise** (an incomplete candidate pool), not a guaranteed lower bound on actual historical publication decisions: a missing earlier source could change W37's result and therefore which occurrence keys remain for W38. No source is silently backdated or outcome tuned to this original projection. Captured-record controls run separately after their capture; fully synthetic boundary/clock controls prove isolated rules, not real-source historical availability. The measured table, exclusions and provenance limitations are recorded in `tests/fixtures/roundup-v2/backtest/replay/REVIEW.md` and asserted under A4 after independent review. With the same-record IG214 location quote, unambiguous day-first date grammar and reviewed 909 Lakeshore address normalization, the **captured-evidence exercise** currently measures:

| Week and slot | Ceiling exercise | Floor exercise | Evidence limit |
|---|---|---|---|
| W37 Wed Sep 9 | HOLD 5 (0 core / 0 anchors) | same | All counted groups are adjacent; R09 is from a Sep 29 declared after-clock capture under the future-event exception. No core anchor verifies. |
| W37 Fri / Sun | HOLD 4 (0/0) at both | same | Held groups roll forward; some earlier events conclude. |
| W38 Wed Sep 16 | PUBLISH 5 (1/1) | same | R20 is the **only** core anchor, served from the Sep 29 declared BIA capture under the labelled after-clock future-event exception. This exercise cannot show the listing carried R20 on Sep 16. Uncovered Coliseum rows roll over. |
| W39 Wed / Fri / Sun | HOLD 3 (0/0) at every slot | same | Adjacent-only RBC and Coliseum groups; R37 fact (ii) has no pre-cutoff capture. |
| W40 Tue Sep 29 15:00Z | PUBLISH 10 (2/2), no cap cut | same | IG214 has a pre-clock provider timestamp; R50 is the other core anchor from a Sep 29 declared after-clock City capture. Counted R55, R56a/b and R59a/b also rely on the labelled after-clock exception. Roads R52–R54 started before the clock and cannot use it. |

The two scenarios have different constituent rows and digests (for example R22b and R57b-ii are removed in the floor), but these decisions/counts coincide. Neither column is a guarantee of historical publication or completeness. The 3-unit/1-core-anchor publish rule and all negative verifier gates are unchanged.

### Original projected replay result (not historical acceptance)

This table was projected from the backtest rows (`R<line>` in `items.jsonl`) and Instagram trial rows (`IG<line>` in `ig-items.jsonl`) before full captured bodies, production extraction and one-pool replay were exercised. It superseded earlier projections but is retained only as the original **hypothesis** for comparing evidence gaps; where the verified captured-evidence exercise diverges, its old decisions/counts are not assertions.

**Replay clocks.**

- Weeks 37–39 are evaluated at the three cadence slot instants, Wednesday, Friday and Sunday at 16:00 UTC, in order. The week's result is the first slot that publishes, or HOLD if none does.
- Week 40 is evaluated once, at `2026-09-29T15:00:00Z`. The trial reported a 14:26 UTC collection, but no byte-identical full-body capture with a verifiable pre-clock timestamp is available for the committed September 29 live bodies.

**One pool, replayed in sequence.** Every converted unit is available at every clock it is available for:

- A news report is available only if its dateline is at or before the clock.
- An Instagram post is available only if its provider timestamp (from the archived raw rows) is at or before the clock.
- A listing, feed, org or project record is available at clocks at or after its capture. A record captured after the clock is used only in the week the backtest assigned it, and only for events after the clock. It is labelled `capturedAfterClock`.
- Only records that correspond to a reference row are converted. Other records in the same frozen bodies are out of scope, which can only undercount.
- Replay is sequential. A published edition's `roundupCoverage` (occurrence keys) removes its keys from later weeks, and a held week rolls its news forward.
- Instagram records are extracted from the **raw** archived captions with line breaks intact (§6.1), never from the flattened `ig-items.jsonl` excerpts.

**One unresolved fact** decides week 39:

- **(ii)** The visible dateline on the Canada Soccer page for R37 (the Nations League announcement, Sep 24). The conversion must establish it, or it is unavailable.

Image-only-dated Instagram units are excluded (§4.4): IG034 Liberate Your Locker, IG099 OHA sound bath and IG100 OHA stretch class. So revision 2's fact (i) no longer exists. "Ceiling" means (ii) and the other conditional spans verify; "floor" means none do.

| ISO week | Deciding clock | Ceiling: units (core / anchor) | Floor: units (core / anchor) | Decision |
|---|---|---|---|---|
| 37 | Wed 2026-09-09T16:00Z | 8 (3 / 1) | 8 (3 / 1) | **publish** |
| 38 | Wed, Fri and Sun all hold | 2 (1 / 1) at Wed; 1 (0 / 0) at Fri and Sun | same | **HOLD `below-minimum`** |
| 39 | Fri 2026-09-25T16:00Z | 3 (1 / 1) | 2 (1 / 1) at Fri and Sun | **publish** at Fri only if (ii) verifies; otherwise **HOLD `below-minimum`** |
| 40 | 2026-09-29T15:00Z | 16 (4 / 3) → cap **12** | 15 (5 / 4) → cap **12** | **publish** |

**Original candidate-unit projections, not observed admissions.** The following rows document why the earlier table was expected; their individual historical availability and verifier outcome are determined by the actual captured bodies and may differ, as the A4 review notes.

- **W37 (Wed).**
  - Core:
    - IG084 Green Liberty Village Eco-Fair: `occ:addr:70-east-liberty-st:2026-09-12:16:00`. It is the anchor: the organiser's own event, the caption names Liberty Village Park, and the whole caption is one record. Its single date is "Saturday, Sept 12, 4-7 pm", so the time range is proven.
    - IG069 NRG Haus Alchemy special edition, Sep 10 7 p.m.: a class at `addr:171-east-liberty-st#113`. "September 10th at 7pm" and "September 10 · 7 PM" are one distinct date.
    - IG065 Oxygen Yoga "Sculpt It to Latin Musica", Sep 15 5:30 p.m.: a class at `addr:171-east-liberty-st#126`, a different canonical venue.
  - Adjacent: R07 + R22b Coliseum concert aggregate (Sonu Nigam, Yeat, Suki Waterhouse); R22a Tempo vs Fever, Sep 18; R22c Tempo vs NY Liberty, Sep 20; R08 + R24 RBC concert aggregate, Sep 9–20; R09 Strachan/Fleet hydro.
  - Merged or held:
    - IG074 ("📅 Sept 12 | Liberty Village Park", all-day) is ambiguous against IG084's 16:00 key, so IG084 is kept.
    - IG042 names no venue, so it is `unverifiable`.
    - R02 blogTO Eco-Fair has no venue, so it is `unverifiable`; with no key, it does not merge.
    - R01 Board Game Night is `weak-source`.
    - IG034 is image-only, so it is a lead.
- **W38 (all slots hold).**
  - Wed units: R20 Give Me Liberty at the Lamport lot (anchor; BIA official section; `capturedAfterClock`); R38 Coliseum concert aggregate (Tove Lo, Sep 23).
  - Not counted at Wed:
    - IG099 is image-only, so it is a lead.
    - R22a, R22c, R24 and R09 are covered by W37; R09 appears under "Still in effect".
    - IG117 (Burger Drops at "Lamport Stadium parking lot (73 Fraser Avenue)", Sep 17 4 p.m.) never adds a unit. Either its stated address conflicts with Lamport's canonical venue (`unverifiable`), or its 16:00 key matches or is ambiguous against R20 (merged or held).
  - Fri and Sun: R20 has concluded. IG157 and IG158 were posted after the Friday clock, and their Sep 19 events have concluded by Sunday. Only R38 remains.
- **W39 (Fri).**
  - Units: R39 RBC concert aggregate (Sep 25–27; captured Sep 24); IG193 NRG Haus "Station 9: The Recovery", `occ:addr:171-east-liberty-st#113:2026-10-03:19:00` (anchor; posted 2026-09-24T23:50:34Z; the single date "Saturday 3 October | 7-10PM" makes the whole caption one record); R37 Nations League announcement (news-update, only with (ii)).
  - At Wed there are only 2 units, R38 Tove Lo (new, since W38 held) and the RBC aggregate, with no core.
  - Excluded:
    - IG100 is image-only.
    - R32, R33 and R36 are `weak-source`.
    - R34 and R35 are `undated`.
    - IG200 was posted after the Friday clock and has concluded by Sunday.
    - IG227 is retrospective.
- **W40.**
  - Core anchors:
    - R50, the 34 Hanna park open house at 171 East Liberty St ("Time: Noon to 4 p.m." is a literal span with a year-bearing date);
    - R52 Hanna Ave Bell repair;
    - IG214 Burger Drops' George Motz event, `occ:addr:116-atlantic-ave:2026-10-03:11:30`. The caption has three dates, so it splits into blocks. The block "[ OCT. 3: $6 Fried Onion Burgers by George Motz ] ⏰ 11:30AM until sold out 📍 116 Atlantic Ave. Patio" is self-contained, with a stated start and unknown end. The Oct 2 block is `not-LV`, and the ticket-sale line is not an event;
    - IG193, floor only. In the ceiling it is covered by W39.
  - Core class: IG215 QUEST XO "Chocolate Painting: Open Studio", Sep 30 18:30. The whole caption is one record, since both "This Wednesday" mentions resolve to 2026-09-30. The date comes from the post timestamp and the time from the literal "6:30pm".
  - Roads: R53 King St W at Strachan; R54 Lake Shore at Newfoundland.
  - Venues: R58 RBC aggregate (from Sep 30); R59a HYROX; R59b Fall Home Show; R59c Fall Baby Show (ceiling only, and only if its occurrence key differs from R59b's; otherwise it is held as ambiguous); R55 Argos Oct 3; R57a Marlies Oct 3; R57b Coliseum concert aggregate (Steve Lacy, Brand New); R56a TFC Oct 10; R56b Canada WNT Oct 12.
  - News: R61 Sceptres opener (ceiling only; its dateline must verify like (ii)). R37 is covered by W39 in the ceiling.
  - **Cut by the cap in §7 order:** R57b, R56a and R56b in both cases, plus R61 in the ceiling. This assumes R59c starts by Oct 3.
  - Held or excluded:
    - IG221 is a single block with two dates, and "116 Altantic Ave." does not resolve, so it is `unverifiable` and never adds a unit to IG214.
    - IG223 (QUEST XO, Oct 3) loses to IG215 under the class cap for that canonical venue.
    - R51 and R60 are `weak-source`.

**Record-count sensitivity in the original projection, not a measured outcome.** IG069, IG215 and IG223 repeat one date twice. The rule counts distinct resolved dates, so each is one whole-caption record. The earlier projected 7-unit W37 and 12-unit W40 sensitivity did not use today's production verifier/captured-body availability and is not A4 acceptance.

**Other conditional spans.** Some units need an exact span in the frozen body: R22b (Suki Waterhouse row), R57b's Brand New row, R59c, R61's dateline, and the per-record RBC JSON-LD objects. They change only the counts shown, never a decision. If a span is absent, that unit is excluded, and the expected table is updated by review. Nothing is relaxed to keep a unit.

**What the original projection meant (not a historical decision).** Its incomplete rows suggested that without Instagram weeks 37 and 39 would hold, and with the expected Instagram positives W37/W40 would publish, W38 would hold, and W39 might publish after fact (ii). The later real-body, one-pool A4 exercise does **not** establish those results; see the captured-evidence correction above and the independently reviewed measured table in the replay notes.

The trial's 13 items shrink because:

- IG124 and IG227 are retrospective;
- IG034, IG099 and IG100 are image-only;
- IG157 and IG158 arrive after the deciding clocks;
- IG221 merges or holds;
- IG223 is capped;
- classes cannot anchor.

These holds are the correct result of the settled rules, not a defect to engineer around.

## 8. Evidence snapshots

- Each run writes `snapshots/<sourceId>/<sha256>.{json,html}` under the runner state root: `stateRoot/roundup/<slot>/`. The retained attempt dir `roundup-attempts/<target>-<week>-<digest>` also gets a copy of every snapshot the pack cites.
- **Captured each run:**
  - the full road-restrictions v3 feed
  - the TTC live-alerts JSON
  - every venue listing page
  - the BIA events page
  - watched project pages
- Snapshots are content-addressed, mode 0600, and each run is capped at 25 MB. Retention is 90 days on the VM. They are not published and not sent to Slack.
- **Durable evidence.** The submission `context` stored in Neon records, for each item and evidence entry:
  - `url`, `recordId` and `snapshotSha256`;
  - the located record's bounded typed fields (≤4 KB);
  - the quotes, the tier, and the fetch and verify HTTP codes;
  - `verifiedAt`.

  It also stores `now` (`T_plan`) and `temporalValidationNow` (`T_submit`), as today. A VM rebuild loses the snapshot files but not the evidence. No migration is needed: `content.submissions.context` already holds the roundup pack.
- **Durable coverage.** `roundupCoverage` lives in the published post itself (§6.6), so it survives VM loss.
- Snapshots are evidence of what was seen. They never replace the live re-fetch required at verification and submit.

## 9. Copywriting and internal review

### 9.1 Writer (`scripts/news-pilot/roundup-write.mjs`)

- The writer receives only the **verified** units: final verdicts, quotes, typed fields, actual dates and identity labels. It also gets a fixed style brief:
  - neutral and useful;
  - Liberty Village voice;
  - "near Liberty Village" for adjacent items, "in Liberty Village" only for core;
  - no hype;
  - no traffic or crowd predictions unless supported (§6.5).
- It writes, for each unit, a heading and 1–3 sentences, plus a 1–2 sentence intro.
- It may not add facts, numbers, quotes, businesses, people or links beyond the unit's own evidence.
- It returns JSON: `{intro, units:[{unitId, heading, body}]}`. The deterministic assembler (§9.3) builds the Markdown and citations, so the model never writes URLs.

### 9.2 Two internal review rounds

- **Round 1: fact reviewer**, a separate model call with a separate role prompt. It receives the draft plus the verified units and their quoted records. It returns findings `{unitId, sentence, problem: unsupported|wrong-date|wrong-place|overclaim|missing-attribution, fix}`. The writer revises only the flagged sentences.
- **Round 2: locality, risk and tone reviewer**, a separate call. It checks:
  - "in" vs "near" against the final verdict;
  - impact wording;
  - aggregated concert lines;
  - date wording (actual dates; never "this week" for a roll-forward item);
  - **people:** an independent re-assessment of every named person in the draft and in each unit's quoted record against the §6.5 subject policy. It returns `{unitId, person, problem:'private-individual'}`. Such a unit is **removed**, not reworded, and §7 is re-applied. If the edition falls below 3/1, the run holds;
  - no crime or election content;
  - brand tone.

  The writer revises.
- **Model choice:** the reviewers use a different provider or model than the writer when `draft-model.mjs` resolves more than one credential. Otherwise they use the same provider with a distinct role prompt. These rounds are internal quality passes. The independent adversarial review is the unchanged content gate.
- **Deterministic post-check after each revision:** `checkRoundupRecordV2` (§11) plus the existing `lintPost`. On failure, the writer gets one targeted retry. If it still fails, the run holds with `writer-failed`: no submit, and the slot is released.
- **Budget:** at most 1 draft + 2 reviews + 2 revisions + 1 retry = **6 model calls**. Reasoning takes at most 6 batched calls. The total is 12 or fewer model calls per run. Time is capped at 10 minutes of model wall-clock per run.

### 9.3 Deterministic assembly

- **Post fields:**
  - `slug`: unchanged from cadence, `liberty-village-news-week-YYYY-wWW`.
  - `title`: `Liberty Village + Exhibition Place this week: <Mon d>–<Mon d>, <yyyy>`.
  - `category`: `news`.
  - `tags`: `['liberty village', 'exhibition place', 'news']`.
  - `image`: an existing `/images/` path, as today.
  - `description`: `answerBlock` plus the intro.
  - `roundupCoverage`: derived from the pack (§6.6). It is not rendered on the page.
- **Body:** one `## N. <heading>` per counted unit, keeping the existing section and citation machinery, in §7 order.
  - Each section ends with `Source: [<publisher>](<url>)`, with a record label for feeds, e.g. `City of Toronto road restrictions, record Tor-RD042026-1044-5`. A corroborated item cites both publishers.
  - "Still in effect" is a trailing unnumbered `### Still in effect` list that is not counted.
- **Feed citation URLs:**
  - Road items cite the City's public road-restrictions page. The v3 feed URL and record ID go in the evidence context, and the ID also goes in the visible label.
  - TTC items cite `https://www.ttc.ca/service-advisories/Service-Changes`, or the alert's own URL if the feed provides one, with the alert ID and retrieval time in the label.
  - The gate reviewer sees the typed record evidence (§9.4), so it can check the visible claim against the record.
- **Output artifacts:**
  - `result.json` gets `{pipeline:'structured-v2', isoWeek, slug, now, packDigest, verifyDigest, decision, units, coreUnits, coreAnchorUnits, published, census}`.
  - `pack.json` holds the verified units.
  - The post is appended to `data/posts.json` exactly as today: one new post, and the runner validates the identity. With `--dry-run` nothing is appended and `published` is `false`.

### 9.4 Submit and gate

- **Submit.** `content submit --kind roundup --roundup-out <dir>` takes `T_submit` from its own clock as today, and on the first submit runs the §6 verifier **again** at `T_submit` against fresh fetches. This replaces the v1 whole-excerpt digest comparison in `revalidateRoundupItems`, because feed and listing excerpts change every fetch.
  - **Instagram units** are validated against the runner-provided `--ig-refetch` file (§4.4), never by a provider call from submit.
  - The check is per record and per quote. A missing record, a missing quote, a changed date, a changed locality, a lost source-quality pass, a changed risk result, or a unit no longer eligible at `T_submit` (§6.5) all raise `ValidationError('roundup source evidence changed or unreachable; rebuild before submit')`.
  - It re-applies the §7 rule at `T_submit`. A pack that falls below 3/1 is refused.
  - It reconstructs prior coverage from the current live roundup posts in the DB, using the same function the pipeline uses on the export. It refuses if the pack counts a key that is now covered.
  - It re-derives `roundupCoverage` from the re-verified pack and refuses any mismatch with the post record. More than 64 keys is refused (§6.6).
  - For every other kind, `checkRecordPolicy` enforces the coverage integrity rules in §6.6.
  - It stores `now` (`T_plan`) and `temporalValidationNow` (`T_submit`) in the context. An idempotent replay returns the stored context unchanged.
- **Gate context.** For `kind='roundup'`, `gate.mjs` passes per-unit evidence: verdict, identity label, record ID, quotes, typed record fields, tier, actual dates and citation URLs. Temporal checks use `temporalValidationNow`, as today.
- **Lenses.** The roundup lenses in `scripts/automation/review-agent.mjs` `LENSES.roundup` add three checks:
  - "near vs in matches each unit's verdict";
  - "no unsupported impact claims";
  - "no private individual outside the allowed roles" (blocking).
- **Fixer.** Every fixer revision passes `checkRoundupRecordV2`, including the `roundupCoverage` equality. The fixer sees the same bounded evidence and may not add units, sources or people.
- **Unchanged:** threshold ≥8, zero HIGH/CRITICAL, the bounded fixer, deploy and smoke.

## 10. Mode, enablement and runner integration

### 10.1 Mode constant (single source of truth)

A new module `scripts/content/roundup-mode.mjs` exports the mode per target:

```js
export const ROUNDUP_PUBLICATION = Object.freeze({ staging: 'structured-v2', production: 'census-only' });
export const ROUNDUP_OPTIONAL_SOURCES = Object.freeze({ instagram: Object.freeze({ enabled: true, provider: 'apify' }) });
```

- These are compiled code at the pinned SHA. They are **not** environment, request or CLI toggles. Changing either value requires a reviewed PR, and the production value is John's protected action.
- `runner.mjs` loads the constant from the pinned tree through its existing `load()` helper. It removes its own `ROUNDUP_PUBLICATION` and the `legacy-fixture` mode.
- **Allowed modes:**
  - `census-only`: today's behaviour. The v2 pipeline runs with `--dry-run` to produce a census, with no reservation, attempt or submit.
  - `structured-v2`.
  - Anything else fails closed with `roundup publication disabled`.
- **Staging first.** This PR sets staging to `structured-v2` and leaves production on `census-only`. The `stagingOnly` guards in `JOBS['weekly-roundup']`, `main()` and `launcher.sh` stay until production activation.

### 10.2 CLI boundary

`scripts/content/cli.mjs` replaces the unconditional `submit --kind roundup` refusal with this check. It is applied before the DB is opened, for both the `--kind=roundup` and `--kind roundup` spellings. Submit is allowed only when all three hold:

- `ROUNDUP_PUBLICATION[CONTENT_TARGET] === 'structured-v2'`;
- `result.json.pipeline === 'structured-v2'`;
- `verifyDigest` is present.

Otherwise it refuses with the existing message. The production target therefore keeps refusing roundup submits regardless of which runner or operator invokes it.

### 10.3 Runner flow (`runWeeklyRoundup`)

The flow keeps the existing reservation, attempt, resume, retry, gate settle, finish and release code, which was the "legacy positive path" and now becomes the live path. The new order of a run:

1. **`evaluatePriorWeek`**: unchanged. Deadline intents for ended weeks, including `WEEKLY_NEWS_MISSED`, which counts by smoke week and exact slug.
2. **`recoverPriorRoundup`** (new, §10.3.1). It runs **before** the current-week count and its early return, so a prior-week attempt is settled even when the current week is already met.
3. `cadence count` for the current week. The early return when `roundupCount ≥ 1` is unchanged.
4. Current-week resume or retry: unchanged.
5. The v2 pipeline, then the rest of the existing flow. `submitRoundup` first runs the source-only `ig-refetch.mjs` helper through `deps.source` (under `sourceEnv('weekly-roundup')`) when the pack cites Instagram. It then passes `--ig-refetch <attemptDir>/ig-refetch.json` to `content submit` (§4.4). The helper also runs before each resumed first submit. If the helper fails, submit still runs and refuses the Instagram units.

**Changes to the pipeline steps:**

- **Pipeline.** Discovery is `roundup-v2-run.mjs --collect`, replacing `run.mjs`. The writer is `roundup-v2-run.mjs`, replacing `roundup-run.mjs`. The contract is the same (`--run --out --root --now [--dry-run]`), plus `result.pipeline`. `--now` is `T_plan`.
- **Hold under the publish rule.** The result is a non-terminal `roundup-hold` with the reasons and a bounded census. The slot is released and no attempt is recorded.
  - When a staging Slack webhook is configured, the runner sends a bounded hold notice: week, units, core units, top reasons, no URLs or evidence text. This reuses the census-hold alert path.
  - Later slots in the week re-collect fresh signals.
  - After the week ends, the unchanged `cadence deadline` emits `WEEKLY_NEWS_MISSED` once.
- **Schedule.** The runner stays on-demand in staging. The cadence schedule (Wednesday primary, Friday recovery, Sunday final) applies when John later authorizes timers. No timer is added by this spec.
- **Environment.** `SOURCE_ENV['weekly-roundup']` becomes `SERPER_API_KEY`, `APIFY_API_TOKEN` and model keys. `SERPAPI_API_KEY` is dropped. If `APIFY_API_TOKEN` is missing, Instagram is `unavailable` for that run (§4.4); the run does not fail. The token is **not** added to `trustedEnv`, the generator environment, the gate, or any model request.
- **`validateRoundupOutput`** keeps all identity checks (week, slug, one new post, pack digest). It adds `pipeline === 'structured-v2'`, `units ≥ 3`, `coreAnchorUnits ≥ 1`, `HEX64 verifyDigest`, and a present, well-formed `roundupCoverage` on the new post.
- `request.dryRun` for `weekly-roundup` stays **rejected** by the runner, as today. The only dry run is the direct one in §10.4.

#### 10.3.1 Prior-week roundup reconciliation

This generalizes the blog lane's `recoverPriorContent` to the roundup lane.

- **`scripts/content/cadence.mjs`:**
  - `unresolvedContentAttempts(db, {target, limit})` becomes `unresolvedAttempts(db, {target, lane, limit})`, with `lane ∈ {'content','roundup'}`. It keeps the same filter (`outcome is null or in ('published','smoked')`), ordering and limit. The content callers pass `lane:'content'`. The CLI `cadence unresolved` gains `--lane`, defaulting to `content`.
  - `recordAttemptOutcome(... 'late-smoked')` accepts `lane='roundup'`. For roundup, the late proof is:
    - the submission is published with smoke passed;
    - its smoke week is later than the slot week;
    - its own old-week slug is current-live at `published_rev`, as observed at the alias by a new helper, `currentLiveSubmission(db, {target, submissionId, observe})`.

    `countCurrentWeek` is not used for this proof, because it deliberately never counts an old-week roundup slug in a later week. The content-lane proof is unchanged.
- **`ops/exedev-runner/runner.mjs`:**
  - `settleAttempt`: the late-smoke branch applies to both lanes. For roundup, the not-current-live fallback check uses `currentLiveSubmission` instead of `count.content`, and holds the original key with `stuckSubmissionId` exactly as the content lane does.
  - **New `recoverPriorRoundup(deps, target, slot, week)`.** It reads `cadence unresolved --lane roundup`, keeps attempts with `week_start_utc < week`, oldest first, and processes at most 2. More than 2 throws `prior roundup backlog exceeds recovery budget`. For each attempt, it reserves that old week's roundup slot 1 with owner `runner:weekly-roundup:<target>:<slot>`, then:
    - calls `resumeOpenAttempt` with the **original idempotency key**;
    - if the result is `no-submission`, records `failed-before-submit` and moves on. It never drafts or submits an old-week edition; `submit.mjs` would refuse one outside its ISO week anyway;
    - if the result is `pending`, throws `prior roundup publication pending`. No new edition starts while an older one is in flight;
    - if the result is `counted`, the smoke landed in the old week, so it is consumed;
    - if the result is `late-smoke`, the attempt becomes terminal `late-smoked`. The old week stays missed, and its `WEEKLY_NEWS_MISSED` intent is preserved. The old slug never counts for the new week, because `countCurrentWeek` requires `i.key = roundupSlug(weekStart)`;
    - if the result is `closed`, it moves on;
    - finally, it releases the slot.

    Resume reads the DB and the lookup by idempotency key, never VM artifacts, so it behaves the same after VM state loss.
  - `runWeeklyRoundup`: calls `recoverPriorRoundup` after `evaluatePriorWeek` and before `count`.

### 10.4 Pre-merge dry run and post-merge runner verification

**Trust boundary.** Pre-merge evidence comes from an **isolated direct pipeline dry run** at the reviewed PR head SHA. It makes no reservation, attempt or submit. It has no DB URL in the pipeline's environment, and `data/posts.json` must stay byte-identical. The runner itself is exercised **only after merge**, on the SHA it pins from `staging`.

Pre-merge (operator machine; reads live staging content once, read-only; writes nothing to staging):

```bash
SHA=<reviewed PR head SHA>                      # from: gh pr view <PR> --json headRefOid -q .headRefOid
DRY=$(mktemp -d)
git worktree add --detach "$DRY/tree" "$SHA" && cd "$DRY/tree"
test "$(git rev-parse HEAD)" = "$SHA"
npm ci --ignore-scripts
node scripts/content/cli.mjs export --root . --target staging      # read-only export of live staging content
shasum -a 256 data/posts.json > "$DRY/posts.sha256"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
env -i PATH="$PATH" HOME="$HOME" SERPER_API_KEY="$SERPER_API_KEY" APIFY_API_TOKEN="$APIFY_API_TOKEN" ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" ROUNDUP_REASON_PROVIDER=anthropic ROUNDUP_REVIEW_PROVIDER=deepseek \
  node scripts/news-pilot/roundup-v2-run.mjs --collect --out "$DRY/run" --now "$NOW"
env -i PATH="$PATH" HOME="$HOME" SERPER_API_KEY="$SERPER_API_KEY" APIFY_API_TOKEN="$APIFY_API_TOKEN" ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" ROUNDUP_REASON_PROVIDER=anthropic ROUNDUP_REVIEW_PROVIDER=deepseek \
  node scripts/news-pilot/roundup-v2-run.mjs --run "$DRY/run" --out "$DRY/out" --root . --now "$NOW" --dry-run
shasum -a 256 -c "$DRY/posts.sha256"           # must print OK
```

The evidence is:

- `signals.jsonl` counts per source;
- snapshot digests;
- `verify-report.json`, with admitted and excluded counts by reason;
- `plan.json`;
- `draft.json` and the review findings;
- `result.json` with `published:false`;
- the `OK` line.

Post-merge (runner VM, staging): the PR is merged to `staging` by the normal protected flow, then `sudo lv-runner run weekly-roundup --target staging`. The run's private JSONL log must show a `code-pinned` line whose `sha` equals the merge commit, from `gh pr view <PR> --json mergeCommit -q .mergeCommit.oid`, and whose `ref` is `staging`. If `staging` has moved past the merge commit, the recorded SHA must be a descendant of it (`git merge-base --is-ancestor`), and the operator records both.

## 11. Module change list (precise)

| Module | Change |
|---|---|
| `scripts/news-pilot/roundup-geo.mjs` (**new**) | Venue registry (IDs, aliases, official domains). Transit route and stop allowlist. Loaders and classifiers for core polygon, address points and segments: `classifyAddress` (with Toronto context), `classifySegment`, `classifyVenueName`, `classifyTransitAlert`. The prose place rules of §6.3: `classifySectionPlace`. |
| `scripts/news-pilot/data/lv-core.geojson`, `lv-address-points.json`, `lv-segments.json` (**new, generated**) | These come from City Centreline and Address Points via `scripts/news-pilot/build-lv-geography.mjs` (**new**, offline, run by hand). The source dataset versions are recorded in the files. |
| `scripts/news-pilot/sources.mjs` | Add `ROUNDUP_SOURCES` (§4.1, with `tier` and `recordSelector`), `ROUNDUP_PUBLISHER_TIERS`, `SYNDICATION_PARTNERS`, and the fixed Serper query set (§4.2). Daily-news `SOURCES` are unchanged. |
| `scripts/news-pilot/ig-provider.mjs` (**new**) | The provider interface (`listRecentPosts`, `getPost`), the `apify` adapter (public profile URLs only, no credentials beyond `APIFY_API_TOKEN`, pre-call result and cost cap), the shortcode-timestamp check, and `unavailable` classification. The `meta` adapter slot is defined but not implemented until John provides credentials (§4.4). |
| `scripts/news-pilot/ig-refetch.mjs` (**new**) | Source-only submit helper (§4.4). It reads the pack's Instagram shortcodes, calls `getPosts`, and writes `ig-refetch.json` with `fetchedAt`. It runs only through the runner's `deps.source`. |
| `scripts/news-pilot/data/lv-venues.json` (**new, committed**) | The shared venue registry: `canonicalVenueId`, aliases, locality and `venue:*` mappings (§6.2). The watch list, address classification and venue sources all resolve through it. |
| `scripts/news-pilot/data/ig-watch.json` (**new, committed**) | The Instagram watch list (§4.4), built from the trial's `accounts.csv` after the builder re-verifies each entry. It is changed only by PR. |
| `scripts/news-pilot/fetch.mjs` | Add a robots.txt check with a per-run cache, and a per-host minimum interval. Both are opt-in via options and used by roundup collectors. |
| `scripts/news-pilot/url-guard.mjs` | Add `classifyBlockedResponse(status, body)`, which returns `blocked` for 401/402/403/406/429 and challenge markers. |
| `scripts/news-pilot/roundup-records.mjs` (**new**) | Deterministic record extraction (§6.1): listing rows by selector, JSON-LD Event objects, feed records, and page sections. It is shared by the collector and the verifier. |
| `scripts/news-pilot/roundup-collect.mjs` (**new**) | Per-source collectors that produce `signals.jsonl` (with records and signal groups) and snapshots (§8). |
| `scripts/news-pilot/roundup-reason.mjs` (**new**) | Batched tool-less model call, form schema and validation (§5). |
| `scripts/news-pilot/roundup-verify.mjs` (**new**) | The §6 verifier: item-bound records, identity and prose locality, dates and syndication, windows at a given `T`, risk and people, source quality, identity dedupe, prior coverage from posts, and `verifyDigest`. It absorbs `verifiedInstant`, `torontoInstant` and `matchingSpan` from `roundup-run.mjs`. |
| `scripts/news-pilot/roundup-write.mjs` (**new**) | Writer, the two review rounds (round 2 includes the people re-assessment) and the deterministic assembly, including `roundupCoverage` (§9). |
| `scripts/news-pilot/roundup-v2-run.mjs` (**new**) | CLI entry point: `--collect`, and the full run with `--dry-run`. It writes `result.json`, `pack.json`, `verify-report.json` and the posts append (none under `--dry-run`). |
| `scripts/news-pilot/roundup.mjs` | Add `planRoundupV2` (§7) and `buildRoundupPostV2` (title, tags, unit sections, still-in-effect, `roundupCoverage`). `isoWeekOf` and `roundupSlug` are unchanged. v1 `planRoundup` and `buildRoundupPost` are removed with their callers. |
| `scripts/news-pilot/roundup-evidence.mjs` | Keep `provenPublicationMs`, `sourceSpanProvesTime`, `fullDatesInSpan`, and add `recordProvesTime` (§6.4), the risk constants and `roundupPackDigest`. **Extract and export the inherited source-quality predicate as `roundupSourceQuality(entries)`** (§6.7) with its existing semantics. Remove the v1 `validateRoundupItem`/`validateRoundupPack`/`revalidateRoundupItems` text-locality path (`scoreLocalRelevance`) together with its tests, once v2 tests replace them. The source-quality tests move to the new predicate and are not deleted. |
| `scripts/news-pilot/roundup-run.mjs` | **Deleted.** It was the v1 free-text cluster writer; its reusable helpers move to `roundup-verify.mjs`. The `legacy-fixture` tests are removed. |
| `scripts/content/roundup-mode.mjs` (**new**) | Per-target mode and the Instagram source constant: enabled, provider `apify` (§10.1). |
| `scripts/content/cli.mjs` | Conditional roundup submit boundary (§10.2). `cadence unresolved --lane`. `submit --ig-refetch <file>`. |
| `scripts/content/validate.mjs` | Add `roundupCoverage` to the allowed (not required) `posts` fields. It is valid only on a `category:'news'` post whose slug matches the roundup slug pattern: `version:1`, a matching `isoWeek`, an ISO `planningCutoff`, and ≤64 string keys of ≤200 chars. Any other post with the field fails validation. |
| `scripts/content/submit.mjs` | `checkRecordPolicy` gains the `roundupCoverage` integrity rules for every kind (§6.6), so they also cover the fixer through `repair-adapter.mjs`. Submit gains `--ig-refetch` validation (§4.4). `checkRoundupRecord` becomes `checkRoundupRecordV2`: the §7 counts; label `Liberty Village + Exhibition Place this week` (replacing "news roundup"/"weekly update"); near/in wording per verdict; the impact-wording refusal; feed/listing shared-URL exception with distinct record IDs; per-unit citation and date checks (kept); `roundupCoverage` equality on every revision. `buildContext`/`submitContent` use the v2 verifier at `T_submit` (`temporalValidationNow`) with DB-reconstructed prior coverage (§9.4). `ROUNDUP_REVALIDATE_MAX_AGE_MS` (6 h) is unchanged. |
| `scripts/content/cadence.mjs` | `unresolvedAttempts` with `lane` (replacing `unresolvedContentAttempts`); roundup `late-smoked` proof; new `currentLiveSubmission` (§10.3.1). |
| `scripts/content/gate.mjs` | Roundup evidence projection: per-unit verdict, identity, record ID, quotes, typed fields and tier (§9.4). |
| `scripts/automation/review-agent.mjs` | `LENSES.roundup`: add the three checks from §9.4. The threshold and severity rules are unchanged. |
| `ops/exedev-runner/runner.mjs` | Mode from `roundup-mode.mjs`; v2 pipeline invocation; hold notice; `validateRoundupOutput` additions; `SOURCE_ENV` change; `legacy-fixture` removed; `settleAttempt` roundup late-smoke; new `recoverPriorRoundup` called from `runWeeklyRoundup` before `count`; `submitRoundup` runs `ig-refetch.mjs` via `deps.source` and passes `--ig-refetch`; `APIFY_API_TOKEN` is only in `SOURCE_ENV['weekly-roundup']`; `recoverPriorContent` passes `--lane content` (§10). |
| `ops/exedev-runner/README.md` | Rewrite the weekly-roundup bullet for `structured-v2` (staging), `census-only` (production), prior-week reconciliation, and the §10.4 dry-run and verification commands. Document `APIFY_API_TOKEN` in the root-only target env files, scoped to `SOURCE_ENV['weekly-roundup']` and never passed to the generator. |
| `ops/exedev-runner/launcher.sh` | Unchanged (staging-only guard stays). |
| Migrations | **None.** Existing `kind='roundup'`, the cadence tables (0003/0004) and `submissions.context` are sufficient. `roundupCoverage` is a post record field, not a column. |
| `docs/specs/content-cadence-adjacent-sources-addendum.md` | Marked **superseded (rejected)** by this spec. Only its impact-wording rule is carried forward (§6.5). |
| `docs/specs/content-cadence-temporal-addendum.md` | For roundups only, superseded by §6.5 windows. The 14-day upcoming rule is kept; the 7-day rolling news window is replaced by the ISO week plus roll-forward. |
| `docs/specs/content-cadence-2026.md` | For roundups only: the one-item "weekly update" and the ≥1-item rule are replaced by §7. Evidence re-fetch is replaced by §6 and §9.4. **The per-item source-quality rule is kept (§6.7).** Count, slot, slug, receipts, deadline and alerts are unchanged. The durable-resume contract now covers prior-week roundup attempts (§10.3.1). |

## 12. Acceptance (observable checks)

Each check produces evidence: a command, its output, and IDs. "Tests green" is necessary but is not sufficient to call this done. In A1–A3, a fixture marked `synthetic: true` is a code-path test only. Synthetic fixtures live in `tests/fixtures/roundup-v2/synthetic/`, separate from the A4 replay fixtures, and never contribute to the A4 table.

### A1: Locality unit tests (`tests/news-pilot/roundup-geo.test.mjs`)

**Must be core:** 40 Hanna Ave, Toronto; 65 Jefferson Ave, Toronto; 171 East Liberty St, Toronto; 75 Fraser Ave (Lamport); 39 East Liberty St, Toronto; a Hanna Ave segment Snooker–Liberty road record; a City project-page open-house section located at 171 East Liberty St.

**Must be adjacent:** "BMO Field, Toronto"; "Coca-Cola Coliseum" on its official domain; "Enercare Centre, Exhibition Place"; "Queen Elizabeth Building, Exhibition Place"; "RBC Amphitheatre, Toronto"; a Strachan Ave at Fleet St record; a King St W at Strachan record; Lake Shore Blvd W at Newfoundland Rd; a 509 alert at Exhibition Loop.

**Must be `not-LV` or `unverifiable` (the mandatory trap tests).** In each of these the scripted reasoner **deliberately claims `core`**:

- **site-nav keyword:** a page whose only "Liberty Village" is in `<nav>`
- **NY Liberty (token-only):** "Tempo fall to Liberty" with no venue name. This is separate from the real R23 CBC row, which is venue-qualified and handled as a merged duplicate in A4.
- **US namesakes:** Hurricane, UT; libertyvillage.org; "40 Hanna Ave" with a non-Toronto `addressLocality`
- **publisher label vs address:** "opening in Liberty Village" with "east side of Strachan south of Wellington"
- **name-only events:** Eco-Fair with no venue; "Fort York – Liberty Village" secret venue
- **Parkdale:** 1205 Queen St W; a "Parkdale issues" page; Temple Ave, Elm Grove, Tyndall
- **bbox:** Joe Shuster Way; Douro St
- **actor address:** "Organizer based at 40 Hanna Ave presents an event at High Park"
- **second event on the same page:** a section for a 40 Hanna event and a section for a Toronto Zoo event. The form names the zoo event with the 40 Hanna place → `cross-record`. The same page without headings → `unverifiable`.
- **cross-row date:** a venue listing whose form takes the event name from one row and the date from another → `cross-record`
- **Organization address:** a JSON-LD page whose `Organization`/publisher address is 40 Hanna Ave and whose `Event.location` is elsewhere → the Event's location decides, so `not-LV`
- **off-site project meeting:** a `project:34-hanna` page section announcing a virtual meeting, and one at City Hall → `not-LV` or `unverifiable`, never core by project identity
- **other failures:** bare "Coliseum"; a same-named venue in another city; a whole-route 504 alert with no allowlisted stop; the CP24 city-wide closures page; the Hotel X spa award (agent `not-LV` caps the verdict)
- **agent over-claim:** agent verdict `core` on an item whose identity verdict is adjacent must end adjacent; agent `core` with no identity must end `unverifiable`
- **Instagram caption-only locality:** a watch-account post whose only locality is "#LibertyVillage" or "in Liberty Village", for an event it places nowhere, when the account is `multiLocation` → `unverifiable`. A non-watch account's caption naming an LV place gives no identity, so it is `lead`.
- **Instagram off-site:** Burger Drops' Oct 2 block ("📍 The Barn @ Downsview Park") → `not-LV`, while the Oct 3 block ("📍 116 Atlantic Ave. Patio") in the same post is core.
- **Instagram multi-location brand:** an Impact Kitchen or Balzac's post with no LV address or venue → `unverifiable`.

### A2: Verifier unit tests (`tests/news-pilot/roundup-verify.test.mjs`)

- **Records:**
  - A quote present only in nav fails.
  - A quote inside the selected JSON-LD Event passes (the blogTO event address pattern). The same quote found only in a different JSON-LD object is `cross-record`.
  - A quote from another item's URL is `source-swapped`.
  - A record absent from the fresh fetch is `record-missing`.
- **Dates:**
  - A date only in Serper metadata is `undated`.
  - A malformed JSON-LD date with a visible dateline uses the dateline.
  - A yearless listing row resolves only to a unique date in the window.
- **Org and project event dates (real layouts):**
  - The BIA "On Thursday, September 17th, 2026, the iconic Lamport Stadium parking lot (75 Fraser Avenue)…" section passes with a core place.
  - The City "Open House Date: October 3, 2026 … Location: Liberty Market Building, 171 East Liberty St." section passes with a core place.
  - Negatives: the same BIA section without the year → `undated`; a project page whose only date is "Last updated: September 20, 2026" → `undated`; a date in a different section from the location → `cross-record`.
- **Syndication:**
  - A foreign canonical is dated from the original.
  - A foreign canonical with the original unreachable, or blocked → `unverifiable`.
  - Self-canonical with "originally published" and no linked original → `unverifiable`.
  - An attribution-only page (partner domain naming the Star, no link) → `unverifiable`.
  - A canonical loop (A→B→A) → `unverifiable`.
  - An original dated outside the window with a September copy dateline → `stale`.
  - A copy plus its original never counts as two publishers.
- **Source quality (§6.7):**
  - An otherwise identical, item-bound, in-window lone `lead` page (blogTO) → `weak-source`.
  - The same item with an `official` identity record passes.
  - The same item with a second item-bound page from a different registrable domain passes.
  - Two pages from the same domain → `weak-source`.
  - A form or Serper result claiming `official` for a `lead` domain changes nothing.
- **Feeds:** a road record that changed fields between snapshot and re-fetch is excluded. A record absent on re-fetch is excluded.
- **Access:**
  - 403 with a Cloudflare challenge body is `blocked` → `unverifiable`, with exactly one request made (no retry).
  - A robots-disallowed path is never fetched.
- **Risk:** crime, election and development-application forms are refused even when the agent sets no flag, where the existing detectors match.
- **People:**
  - **Private-life false negative:** a synthetic story that "Jane Smith moves out of her apartment at 40 Hanna Ave", with prose about her finances and divorce. The scripted reasoner sets no flag and labels her `business`. The existing detectors return `[]`. The scripted round-2 reviewer flags `private-individual`, so the unit is removed and the edition re-planned. A second case has the round-2 reviewer also miss it, and the scripted gate lens blocks. The test asserts where each layer caught it, and asserts the detectors alone do not.
  - **Performer control:** a venue listing row "Dean Brody & The Reklaws" with role `performer` passes.
  - A person with role `unclear` is refused.
- **Instagram (A2-IG):**
  - A retrospective post ("A look back at … on Friday night", "Saturday morning" recap) → `retrospective`, even when the date is recoverable.
  - A post published after the event start → `retrospective`.
  - Explicit date: "Saturday, Sept 12" posted Sep 8 resolves to 2026-09-12.
  - Relative positives (real posts, provider timestamps):
    - IG158 "This SATURDAY (Tomorrow)", posted 2026-09-18T22:47:02Z (Fri 18:47 Toronto) → 2026-09-19 for both words, consistent;
    - IG157 "Join us tomorrow", posted 2026-09-18T21:54:04Z → 2026-09-19 for the date, but `unverifiable` for place (`requiresVenueInPost`);
    - IG223 "this Saturday at 1:30 PM", posted 2026-09-28T20:22:28Z (Mon) → 2026-10-03 13:30;
    - IG215 "This Wednesday at 6:30pm", posted 2026-09-27T23:07:57Z (Sun 19:07 Toronto) → 2026-09-30 18:30.
  - `next Friday` posted on a Monday resolves to that week's Friday + 7.
  - Toronto date boundary: "tomorrow" in a post at 2026-10-03T02:30Z (Oct 2, 22:30 Toronto) → 2026-10-03, not Oct 4.
  - Ambiguous negatives: "this weekend", "next week", "soon", "coming up" → `undated`.
  - Conflict negative: "tomorrow, Sept 20" posted Sep 18 → `undated`.
  - Timestamp band: provider timestamps 20 min and 50 h after the encoded time pass. 3 min before, or 4 days after, → `unverifiable`.
  - **Image-only exclusion (N2):**
    - IG099/IG100 (OHA carousel) and IG034 (LVRA poster), whose dates exist only in image text, are leads and never counted units.
    - End to end, a synthetic edition where an image-only unit would be the third unit needed for 3/1 **holds** `below-minimum`. Its census names the image-only lead.
  - **Event records (R3), raw captions with line breaks intact:**
    - IG084, IG193, IG215, IG065 and IG069 each have one distinct date, so each is **one** whole-caption record with a resolved date. This tests segmentation/date resolution only; none of these five archived rows currently verifies **place** under production rules (A4 and §14).
    - The same captions split at blank lines would fail. This is a regression test against paragraph splitting, not a claim that every captured form is admitted.
    - IG214 (three dates) splits into blocks. The bracketed Oct 3 heading stays with its ⏰ and 📍 lines and verifies with its own pinned-location quote; the Oct 2 block is `not-LV` because its own 📍 line states an offsite place (§6.3).
    - IG221 (two dates in one block) is `unverifiable`.
    - A multi-date caption whose Oct 3 block lacks a place → that event holds.
  - **Time proof (R3):**
    - `recordProvesTime` accepts "This Wednesday at 6:30pm" with the resolved date 2026-09-30 → 2026-09-30T22:30Z, and "Tuesday, September 15 @ 5:30PM" → 2026-09-15T21:30Z. The existing `sourceSpanProvesTime` returns false for both. That is why a resolved-date proof is needed.
    - "7-10PM" gives a stated end.
    - "11:30AM until sold out" is a stated start with unknown end: eligible at 11:29 Toronto, ineligible at 11:30.
    - A record with a time span that fails proof → `undated`, never silently date-only.
  - Tagged or collaborator rows (owner ≠ handle) are dropped.
  - Source quality: an own event at the own verified address passes as `primary`. The same account posting another business's event, or a collaboration hosted elsewhere, is `lead` → `weak-source` unless independently corroborated.
  - Routine promo, daily special and holiday-hours posts → `not-news`.
  - Env scoping: `APIFY_API_TOKEN` is present in `sourceEnv('weekly-roundup')` and absent from the `lv-generator` env and every other job's `sourceEnv` (runner env test).
  - Provider failure: the adapter throws or times out → Instagram `unavailable` in the census, every other source's signals are unchanged, and the run completes. A missing `APIFY_API_TOKEN` behaves the same.
  - **Submit re-fetch file (N1):**
    - Unchanged rows pass.
    - A row with status `missing` or `private` refuses that unit.
    - A changed caption (cited record text no longer verbatim), owner or timestamp refuses that unit.
    - A shortcode set that differs from the pack's, or `fetchedAt` older than 30 min or later than `T_submit`, refuses every Instagram unit.
    - A missing file refuses every Instagram unit.
    - In each refusal case, the §7 rule is re-applied and a pack below 3/1 is refused.
- **Impact wording:** unsupported crowd or closure wording in the draft is refused. With a same-date verified road item, it is accepted.

### A3: Publish-rule, clock and coverage tests (`tests/news-pilot/roundup-plan.test.mjs`)

- **Rule:**
  - 3 units, 0 core → hold `no-core`.
  - 2 units, 1 core → hold `below-minimum`.
  - 6 RBC concerts + 1 core → 2 units → hold.
  - 5 concerts at one venue + 1 core + 1 road → 3 units → publish.
  - Two classes at one venue in a week → 1 unit.
  - 3 units whose only core units are classes → hold `no-core`. Adding one core non-class item → publish.
- **Clocks (§6.5):**
  - An event ending between `T_plan` and `T_submit` passes the plan and is refused at submit.
  - A date-only event on day D is eligible at 23:59 Toronto on D and not at 00:00 on D+1.
  - An event with a start time and no stated end is eligible before its start and not after.
  - The +14-day boundary: a start at exactly `T + 14d` is excluded; `T + 14d − 1 min` is included.
  - Sunday Toronto / Monday UTC: at `2026-10-05T01:00:00Z` the edition is W41 with `W` = Oct 5–11. An Oct 4 news item counts only by roll-forward. Submit at that instant is inside W41 (UTC).
  - An idempotent replay returns the stored `now` and `temporalValidationNow`, and keeps the slug.
- **Coverage (§6.6):**
  - A road record in the previous live edition's `roundupCoverage` appears in "Still in effect" and is not counted.
  - A new occurrence on the same venue calendar URL (a different date or record) counts.
  - Roll-forward after a hold: a held W39 means W40 counts a W39-dated news item. After a published W39, only items dated on or after its cutoff date count, and covered keys are excluded.
  - Deleting the VM state root and snapshots between runs gives an identical plan, because coverage comes from the export.
  - A pack counting a key that the DB now shows as covered is refused at submit.
  - `validate.mjs` rejects `roundupCoverage` on a non-roundup post.
- **Identity (N3), `tests/news-pilot/roundup-identity.test.mjs`:**
  - IG214 + IG221 give exactly one unit. IG221 is `unverifiable`. A synthetic IG221 with the address spelled correctly and 11:30 stated has the same occurrence key and merges as a second citation.
  - An Instagram post plus the business's own-domain page for the same occurrence give one unit, with the higher tier as primary.
  - Two watch accounts announcing classes at one canonical venue in a week count 1 class unit.
  - NRG Haus #113 and Oxygen Yoga #126 at 171 East Liberty St are two canonical venues and count 2.
  - Same venue and date, starts at 18:00 and 20:00 → 2 units.
  - Same venue and date, one all-day and one 16:00 → 1 unit kept, 1 held `duplicate-ambiguous`.
  - A next-date recurrence (the same class a week later) is a new key and counts. After an edition publishes the first date, only the second counts next week.
  - A reminder post for a published occurrence is `previously-covered` in the next edition.
- **Coverage integrity (R6), `tests/content/roundup-coverage-integrity.test.mjs` against local PG, through `checkRecordPolicy` and the fixer adapter:**
  - An `seo` or `manual` **insert** of a post carrying `roundupCoverage` → refused.
  - An `seo` or `manual` **edit** of a live roundup post that changes, clears or **removes** the field → refused.
  - The same edit that changes only visible copy and preserves the field byte-identically → accepted, and coverage is unchanged in the next export.
  - A gate-fixer revision on an `seo` submission that touches the field → refused.
  - A fixer revision on a roundup submission that changes it → refused.
  - A `roundup` submission whose field differs from the pack-derived value → refused.
  - A roundup pack deriving 65 keys → the submission is refused. Nothing is truncated.
  - Deleting the whole roundup post is allowed, and its keys leave coverage.

### A4: Backtest replay (`tests/news-pilot/roundup-v2-backtest.eval.mjs`, run in `test:news-pilot`)

**Reference data (immutable).** `items.jsonl` is copied byte-for-byte to `tests/fixtures/roundup-v2/backtest/reference/items.jsonl`, and the Instagram trial's `ig-items.jsonl` and `accounts.csv` to `tests/fixtures/roundup-v2/backtest/reference/ig/`. Their sha256 values are pinned in the eval. They are never edited, and they are not reasoner input: their rows use a different, non-schema shape.

**Reviewed conversion (captured-evidence replay).** Converted units live in `tests/fixtures/roundup-v2/backtest/replay/conversion.jsonl`, one line per replay unit:

```jsonc
{ "unitId": "R22b", "sourceRow": 22, "form": { /* schema-valid §5 form */ },
  "bodies": [ { "url": "...", "file": "captures/<sha256>.html", "capturedAt": "...", "capture": "live|wayback",
                "capturedAfterClock": null } ],
  "spans": [ { "recordId": "...", "field": "subject|place|date|dateline", "start": 0, "end": 0, "text": "..." } ],
  "unavailable": [ "dateline" ],
  "expected": { "week": 38, "clock": "2026-09-16T16:00:00Z", "class": "eligible|weak-source|undated|...", "unitKind": "sports" } }
```

- **Building the conversion.** The builder pins each available full captured source body, including the Wayback captures used for venue listings, and records its actual or explicitly declared capture instant. `captures.json` binds the canonical URL, provenance basis, byte length and SHA-256. The production `extractRoundupRecords` derives record IDs, typed snapshots and exact spans (offsets into normalized record text); `verifyRoundupForms` re-extracts from the single served body. A historical clock never upgrades an undated live capture to pre-clock evidence.
  - Bundled rows are split, one unit per event (for example R22 → R22a Tempo vs Fever, R22b Suki Waterhouse, R22c Tempo vs NY Liberty).
  - A fact that is not in the frozen body is listed in `unavailable`, and the unit is expected to fail on it. It is never reconstructed.
  - Ellipsis-joined backtest quotes are never used as quotes. Each part becomes its own span in its own record, or is unavailable.
- **Review.** The conversion file and its expected classes are reviewed by someone other than the builder before the replay expectations are frozen.
- **Instagram units.** The conversion is built from the archived raw trial data, **not** by re-collecting. The archive is `lib_village/.state/archive/2026-09-29-ig-trial/`, and its sha256 values are pinned in the conversion header:
  - `apify-items1..5.json` and `owned-posts.json`: the raw provider rows, with **raw captions including line breaks**;
  - `website-audit.json` (watch-list verification) and `classify.py` (the trial's classification).

  The committed `ig-posts.jsonl` copies **only** `ownerUsername`, `shortCode`, `timestamp`, `type`, the full raw caption (line breaks intact), caption SHA-256 and archive filename. The production extractor selects its event records; conversion spans bind to those records. Full provider dumps and images stay in the archive and are never committed. Image-only units (IG034, IG099, IG100) are leads with `unavailable: ['text-date']`.
- **Rows that cannot be re-captured** stay in the replay with the expected class `unverifiable`: bot-walled pages, R12 and R13 (truncated `article_` URLs, empty quotes, no canonical metadata), and the Globe. They are **not** asserted as detected syndication; stale detection is proven only by the A2 synthetic fixtures.
- **No model calls.** The replay runs `verify → plan` with the converted forms as the reasoner's output.

**Clocks and availability** use §7's one pool, replayed in sequence: Wed, Fri and Sun 16:00 UTC for weeks 37–39; `2026-09-29T15:00:00Z` for week 40. A news item needs a supported same-record dateline at or before the clock to be counted; an unknown-dateline form may enter only as a diagnostic negative, never as proved historical availability. An Instagram post is available only after its archived provider timestamp. Records captured after the clock are labelled `capturedAfterClock` and used only in their assigned backtest week for events starting after the clock. That exception exercises the algorithm; it cannot prove those records were already visible at the clock.

**Assertions:**

- The eval asserts the **independently reviewed measured captured-evidence table**: each slot's decision, units/core/anchor counts, counted unit IDs, coverage rollover and any cap cuts. The retained original §7 projection is printed for comparison only, not silently used as an acceptance oracle. No expectation overrides a verifier rule or changes a captured timestamp. Any change to the measured table needs a cited same-record capture/product fix and refreshed independent review of the affected contract.
- Run the ceiling and floor conditional-span exercises on the same one-pool captured evidence. R37's historical fact (ii) remains unavailable in both; toggling a form without a pre-cutoff body cannot make it verified. Assert each measured scenario, not the unsupported original ceiling/floor counts.
- The original IG084-removal result is **not evidenced** by the captured replay while that archived caption is excluded; do not claim a vacuous removal check as sensitivity proof. `tests/news-pilot/roundup-plan.test.mjs` proves the 3/1 positive and no-core refusal with clearly synthetic controls. If a new source-bound IG084 admission is established, add its non-vacuous A4 sensitivity only after its provenance and product rule are independently reviewed.
- All unqualified Instagram leads, image-only rows, retrospective posts and expired/off-site items remain **uncounted** under actual timestamps, record text and verifier rules. The replay records their observed exclusion reasons; the original trial's expected reason classes are not promoted into facts when production extraction returns no record. IG124/IG227 are retrospective, IG034/IG099/IG100 are image-only leads, and IG221 cannot augment IG214 from another post. Whether an archived first-party positive (for example IG084, IG193 or IG215) is recognized is reported as a measured product gap, not repaired by fixture-enforced admission.
- No trap, blocked, crime, election, weak-source, Reddit, directory or Ontario Place row may be counted by the captured replay. For R62 Joe Shuster Way, R63 Temple Ave and R64 Douro St, a **separate, post-capture real-feed** check runs production extraction/verifier and asserts `not-LV`; they are never backdated into W40 just to test their geography. Rows represented only by labelled fragments (including R03 Toro Toro, R44 TorontoToday stabbing and R23 CBC Tempo) cannot prove the former exact reason or later duplicate claim from real source bodies; retain these as unresolved historical-evidence gaps. A2's clearly synthetic controls exercise the not-LV, blocked, weak-source and duplicate refusal boundaries independently; do not describe those tests as source-backed A4 replay.
- Print and retain a per-week, per-slot census of served capture IDs, `capturedAfterClock` labels, admitted and excluded units, reasons, counted occurrence keys and coverage. The independent reviewer checks provenance/negative controls and the resulting measured assertion table before A4 acceptance.

### A5: Mode, boundary and reconciliation tests

- `roundup-mode.mjs`: staging is `structured-v2` and production is `census-only`.
- The runner in production still refuses as staging-only.
- The runner in `census-only` performs no reservation, attempt or submit, and `data/posts.json` stays byte-identical.
- `roundup-v2-run.mjs --dry-run` (the §10.4 path), run on fixtures, writes `result.json` with `published:false` and leaves `data/posts.json` byte-identical. It is invoked with an environment containing no DB variables. The runner still rejects `request.dryRun` for `weekly-roundup`.
- The CLI refuses `submit --kind roundup` when:
  - the production target is bound;
  - `pipeline` is missing;
  - `verifyDigest` is missing;
  - either spelling of `--kind` is used.
- Submit re-verification refuses a pack whose evidence changed, that fell below 3/1 at `T_submit`, or whose `roundupCoverage` mismatches.
- A hold sends one bounded notice and records no attempt.
- `validateRoundupOutput` rejects `units < 3`, `coreAnchorUnits < 1`, a missing or invalid `verifyDigest`, and a missing `roundupCoverage`.
- **Prior-week roundup reconciliation** (runner tests with the cadence CLI against local PG):
  - **Sunday pending → Monday resume:** a W40 roundup attempt is published with smoke pending on Sunday. On Monday (W41), `recoverPriorRoundup` resumes the **same idempotency key**, and smoke passes. The attempt becomes `late-smoked`, and the W40 `WEEKLY_NEWS_MISSED` intent exists. W41's `cadence count` does not include the W40 slug. The run then drafts W41's own edition.
  - The same scenario after deleting the VM state root and retained attempt dirs gives the same outcome.
  - **Current week already met:** W41 already has a counted roundup, and a W40 attempt is still published/smoke-pending. The W40 attempt is still reconciled before the early return, and the result is `cadenceMet`.
  - If the old attempt is still pending after resume, the run throws `prior roundup publication pending` and drafts nothing for W41.
  - An old attempt with no submission is recorded `failed-before-submit`, and nothing is submitted for the old week.
  - A late roundup whose old slug is not current-live holds its original key with `stuckSubmissionId`.
  - More than 2 unresolved prior roundup attempts throws the backlog error.
  - The content lane's existing prior-week tests pass unchanged, using `unresolvedAttempts({lane:'content'})`.
- **Instagram credential boundary (N1), run through the real env builders in `runner.mjs`:**
  - `sourceEnv(env,'weekly-roundup')` contains `APIFY_API_TOKEN`.
  - `trustedEnv(env)`, the generator environment, every other job's `sourceEnv`, and the gate's environment do not contain it.
  - A runner test with a fake provider runs `submitRoundup` end to end: the helper under `sourceEnv` writes `ig-refetch.json`, and `content submit` under `trustedEnv` accepts the unchanged Instagram unit. The same test with the post marked deleted, or private, refuses the unit, and the pack is refused below 3/1.
  - A spy on the model request builder asserts that no request payload (reasoner, writer, reviewers, gate) contains the token value.
- All existing cadence, count, deadline and alert tests stay green: `npm run test:content` against local PG, plus `test:news-pilot` and `test:automation`.

### A6: Live staging evidence (required before claiming done)

1. **Env check.** Confirm `SERPER_API_KEY`, `APIFY_API_TOKEN` and a model key are present in `/etc/lv-runner-staging.env` (names only). Confirm `CONTENT_TARGET=staging` and `CONTENT_DB_NAME=lv_staging`.
2. **Pre-merge dry run.** Run the §10.4 pre-merge commands at the reviewed PR head SHA. Record the listed artifacts and the `OK` byte-identity line. **No model output is used without verification.**
3. **Post-merge real run.** After the PR merges to `staging`, run `sudo lv-runner run weekly-roundup --target staging`. Record the `code-pinned` SHA check from §10.4. If the plan is `publish`, the evidence is:
   - the submission ID;
   - gate rounds with the real model (not `--script`): overall ≥8, `blocking_count=0`;
   - deploy and smoke passed;
   - `cadence count` shows `roundupCount=1` for the week;
   - the hosted staging alias serves `/blog/liberty-village-news-week-YYYY-wWW` at the published revision, with every citation link resolving, and the exported post carries `roundupCoverage`.

   Record the URL, the IDs and a safe round summary.
4. **If the live week holds.** That is a correct outcome but **not** acceptance. Given §7, holds are expected in some weeks. Re-run on a later slot or week. Never add units, relax a rule or use fixtures to force a publication.
5. **Protected actions.** Production remains `census-only`. Flipping it, lifting `stagingOnly` or adding timers is John's protected action, recommended after two consecutive staging weeks that each publish or honestly hold, with gate PASS on every publication.

### A7: Review

- The spec: an independent exact-hash review of this document before implementation.
- The A4 conversion: reviewed by someone other than the builder before its expectations are frozen.
- The code: a staging PR from an isolated builder branch; an independent code review by a reviewer whose model differs from the builder's; the canonical exact-head PR gate; then the A6 evidence.

## 13. Right-sizing notes and non-goals

- **No new infrastructure.** There are no new services, queues, DB tables or migrations, and no browser automation. Snapshots are files plus bounded DB context. Coverage history is one optional field on the roundup post record.
- **No paid access or licensing** for bot-walled or paywalled publishers. Whether to license TorontoToday or Toronto Life is an open owner question.
- **No geocoding API.** Locality uses a checked-in, reviewed geography derived once from City open data.
- **Instagram through one pluggable provider**, bounded by volume and cost, with no login and no image republishing. It is the only source added beyond the backtest set, and it is added on the trial's evidence.
- **No corroboration search.** The verifier checks only what the collector fetched. It does not go looking for a second publisher.
- **No change** to the daily `news` job, the blog cadence, the gate threshold, severity, fixer bounds, deploy or smoke. The blog lane's reconciliation logic is shared, not changed.
- **Hardening only where the backtest or the review found a failure:** nav stripping, item-bound records, identity and prose locality, page datelines, syndication resolution, blocked classification, feed snapshots, concert aggregation, prior coverage, source quality, submit-time freshness, and prior-week roundup reconciliation. Nothing else is added "just in case".

## 14. Open questions for the owner (do not block staging)

1. **Holds under the inherited source rule.** The current captured-evidence replay has incomplete earlier source availability, so its W37–W40 decisions are algorithm exercises, not established historical outcomes (§7/A4). Real holds emit `WEEKLY_NEWS_MISSED`. Relaxing §6.7 would be a substantive cadence change needing its own review; this amendment does not propose it.
2. **Known first-party Instagram false negatives and historical evidence gaps (not fixed by this amendment).** Of these six archived first-party candidate positives, only IG214 currently verifies; **IG065** fails the fail-closed locative guard on ordinary “to LATIN MUSICA” / “on the mat” phrases; **IG069**'s `📍 NRG Haus` short venue alias is unregistered and its `@` collaborators remain blocked; **IG084** names Liberty Village Park but lacks same-record Toronto context (the `#EcoToronto` hashtag does not supply it); **IG193**'s day-first date now resolves but `Where: @nrghaus` still fails its venue/handle layer; **IG215** fails the QUEST XO prose-venue whitelist/“at the Creative Lab” layer even with a narrowed same-record place quote. NRG Haus own alias/handle and QUEST XO registry admission are conservative candidates for a separately reviewed fix; relaxing locative or collaborator handling, hashtag context, or Creative Lab nicknames requires an owner policy decision. No such admission is assumed here. **R37** lacks a pre-September-25 revision and numeric-date support; **R52–R54** began before the W40 clock and occur only in the later road capture. Acceptance does not claim these archived positives are recognized or these historical facts proved; current-week UAT on **new** posts is separate evidence, not retrospective validation of them (§7/A4).
3. **Brand fit.** In published weeks, most counted units are stadium and expo items. The ≥1 core rule enforces a local anchor but not a local majority. Is that the intended brand balance? (The title's "+ Exhibition Place" is intended to make this honest.)
4. **Image-text dates (possible later addendum).** Image-only Instagram dates are excluded from v2 (§4.4). In the **original projection**, this cost W38 its IG099 unit and W39 the IG100 class; these are not measured historical losses. A later addendum could add blinded, media-bound transcription before the verifier, with submit binding to the image hash.
5. **Meta Business Discovery (optional).** Apify is approved for production (2026-09-29). Should the Meta adapter be added later? It needs John to provide a professional Instagram account, a Facebook Page and a Facebook app (§4.4).
6. **Bot-walled local coverage.** Should TorontoToday or Toronto Life access be licensed? Their tower stories would be human-only under current policy anyway.
7. **Production activation.** The criterion and timing are John's call (A6.5).
