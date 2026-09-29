# Weekly roundup v2: "Liberty Village + Exhibition Place this week"

Status: **draft spec, revision 2, for independent re-review.** No implementation until it is accepted. Date: 2026-09-29. Base: `origin/staging` @ `26cb824` (PR #192 merged).

This spec replaces the free-text roundup writer, which PR #192 held in `ROUNDUP_PUBLICATION.mode='census-only'`, with a structured-source pipeline. It depends on `docs/specs/content-cadence-2026.md` (the cadence count, slot and receipt contract) and changes only the parts named in §11. Nothing here authorizes a production timer, a production mode flip, a migration against production, a protected merge or a production publication. Those remain John's actions.

Evidence: the four-week backtest at `lib_village/.state/archive/2026-09-29-roundup-backtest/` (`report.md` and 65 structured forms in `items.jsonl`), and research §8 in `docs/research/content-quality-2026-09.md`, which covers why keyword locality failed.

### Revision 2 log

The independent review of revision 1 (commit `035e216`) returned NOT-READY with 3 BLOCKER and 7 MAJOR findings. The product decisions in §1 are unchanged. Every finding is resolved here:

| # | Finding | Resolution | Sections |
|---|---|---|---|
| 1 | Page-level token matching permits false locality and cross-item evidence | Item-bound evidence. Every item names one trusted record, and its subject, place and date must all come from that record. Prose must state the place as where the item happens. Ambiguous or multi-item prose is `unverifiable`. Project identity never makes an off-site meeting core. | §5, §6.1–6.3, A1, A2 |
| 2 | Source-quality rule silently deleted | The inherited predicate is carried forward: an official or primary source, or two independent substantive publishers. Tiers come from the checked-in registry only. | §4.1, §6.7, §11, A2 |
| 3 | Replay input cannot satisfy the verifier; the table used future reports | `items.jsonl` (and the Instagram trial's `ig-items.jsonl`) become immutable reference data. A separate, reviewed conversion produces schema-valid, item-level fixtures with exact spans. Synthetic fixtures are kept separate. The table is recomputed at the cadence clocks. Without Instagram, weeks 37 and 39 hold. With it, W37 and W40 publish outright, and W38 and W39 publish only if named spans verify (§7). | §7, A4 |
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
| All four weeks (37–40) reached ≥3 qualified items under the backtest's lens, with 1, 1, 1 and 3 core items. | That lens did not apply the inherited source-quality rule or the replay clocks. Recomputed without Instagram, the only core items in weeks 37 and 39 are single-publisher blogTO listings (`weak-source`), so those weeks would hold (§7). |
| The Instagram trial found first-party core items the other sources missed. By the trial's own count, core items went from 1/1/1/3 to 4/5/3/7. | Instagram is an enabled first-party source with a committed watch list (§4.4). Recomputed honestly at the cadence clocks (§7): W37 and W40 publish. W38 and W39 publish only if named spans verify: the OHA carousel image-text date and the Canada Soccer dateline. Otherwise they hold. |
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
- `address`: the verified LV-core address, or a named core venue such as Liberty Village Park, 70 East Liberty St;
- `verificationUrl` and `verificationMethod`: the business's or organisation's own site linking the handle and giving the address;
- `ownDomain` (the `primary` domain in §4.1);
- `multiLocation: bool`;
- `provider: 'apify' | 'meta'`.

The address must classify core under §6.2: an address point in the table, or a core venue in the geo module. Stale directory addresses are corrected from the business's own site, as the trial did (for example Burger Drops at 116 Atlantic Ave, Impact Kitchen at 99 Atlantic Ave). An account without a verified core address is not listed. The initial list is the trial's `accounts.csv`, re-verified by the builder.

**What qualifies.** A post is a signal only if all of these hold:

- **Owned.** It is owned by the watch account: the provider's `ownerUsername` equals the handle. Tagged, collaborator, pinned-old and reposted content is dropped.
- **Dated event.** It announces a dated event, opening or closure (`item_type` event, opening, closure or class). Routine promos, daily specials, menus, holiday hours, "come visit" posts and generic recurring classes with no specific dated session are `not-news`.
- **Forward-looking.** The post's timestamp is before the event's start instant. Retrospective posts ("last Saturday", "what a night", recaps) **never** qualify, even when the date is recoverable.
- **Class cap.** Recurring classes and workshops (`item_type: 'class'`) count at most one per venue per edition week, and they cannot be the edition's only core item (§7).

**Locality** (§6.2). It comes from the verified account address when the post's event is at the account's own venue: the post names the venue, its handle or its address as the location, or it is a single-location account and states no other place. It can also come from an **explicitly named core venue or core address in the post**.

- It **never** comes from the caption alone: "#LibertyVillage", "in Liberty Village" or the account's membership in the list confer nothing.
- A `multiLocation` brand's post must state the LV address or venue.
- A post that states any other location is classified by that location. For example, Burger Drops' Oct 2 event at The Barn, Downsview Park is `not-LV`.

**Dates** (§6.4). An explicit calendar date (month and day, with an optional weekday and year) must appear in the caption or in the post's image text. Relative-only wording such as "tomorrow", "this Saturday" or "next weekend" is `undated`.

**Source quality** (§6.7). A first-party account announcing **its own** event at its own verified address, or at a core venue it names, is `primary` for **that event**. Anything else from Instagram is a `lead` that needs corroboration.

**Decision recorded (John, 2026-09-29).** The Apify `apify/instagram-scraper` is approved as the Instagram provider for **both staging and production**. The Meta Business Discovery adapter remains an optional later swap behind the same interface. `APIFY_API_TOKEN` is provisioned on the runner for the **source process only**: it is in `SOURCE_ENV['weekly-roundup']` and in the root-only target env files. It is never in the `lv-generator` sandbox env, any other job's env, the writer or review model calls, logs or Slack.

**Provider (pluggable).** `scripts/news-pilot/ig-provider.mjs` defines:

- `listRecentPosts({handles, newerThan, limit})`, returning rows of `{handle, ownerUsername, shortcode, url, timestamp, caption, images:[{url, altText}], type}`;
- `getPost(url)`, for re-verification.

Two adapters implement the same watch-list contract:

- **`apify` (approved for staging and production).** It uses `apify/instagram-scraper` with only public profile URLs, `resultsType=posts`, `resultsLimit=20` and `onlyPostsNewerThan` of the window start minus 21 days. There are no session credentials, login or cookies. `APIFY_API_TOKEN` is added to `SOURCE_ENV['weekly-roundup']`. A per-run cap of US$1 and 34×20 results is enforced before the call; the trial measured about US$0.11 per run.
- **`meta` (optional later swap).** It uses the Meta Business Discovery Graph API if John later provides a professional Instagram account linked to a Facebook Page, a Facebook app and a token. That API covers only Business and Creator accounts, so each watch entry names its `provider`, and accounts that the API cannot reach stay on `apify`. Switching is a reviewed PR.

**Timestamp check.** The provider timestamp is cross-checked against the creation time encoded in the shortcode's media ID. A disagreement of more than 5 minutes means `unverifiable`.

**Failure.** Any provider error, timeout, budget stop or empty response makes the source `unavailable` in the census. Other sources proceed, and Instagram never blocks a run. An Instagram unit that cannot be re-verified at submit fails re-verification like any other unit (§9.4). The runner then rebuilds, and that may hold.

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
| `ig-post` | One **caption block** (the caption split at blank lines and `[ … ]` bracket groups; a single-block caption is one record), or one carousel image's text. | shortcode + block or image ordinal | owner handle; post timestamp (checked against the shortcode, §4.4); subject, place and date must be quoted from the block, or place from the watch entry (§6.2) |

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
- **Named core venues.** The geo module lists a small set of named core venues with their address points: Liberty Village Park (70 East Liberty St) and Lamport Stadium (75 Fraser Ave), plus any added by PR. In prose or a caption, a named core venue counts like a core address when the §6.3 relation rules hold.
- **Instagram locality.** An `ig:<handle>` post takes the watch entry's verified core address only when the post's event is at the account's own venue (§4.4). An explicitly named core venue or core address in the same caption block also counts. The caption alone never supplies locality: hashtags, "in Liberty Village" and list membership confer nothing. A `multiLocation` account needs the LV address or venue in the post. A post stating another location takes that location's classification.
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

  - an **explicit** date in an Instagram caption block or carousel image text of a watch-list post (§4.4). A yearless month and day resolves to the unique occurrence in `[post date, post date + 60 days]`. Relative-only wording ("tomorrow", "this Saturday", "next weekend") is `undated`. **Image text** is admissible only as either:
    - provider-returned alt text containing the quote verbatim; or
    - a model transcription stored with the image's sha256 that an **independent second transcription** agrees with exactly on the date expression. The second transcription is round 1's fact reviewer, given the image without the first transcription. This is a model assessment and fails closed: disagreement or a missing image means `undated`. The gate sees both transcriptions.

  A yearless date in org or project prose is `undated`. So is a date from another section, or an unrelated page date such as "Last updated". Free-text news prose is never event-date evidence: a news item is dated by its dateline and admitted as a news-update.
- **Time.** Keep the existing rule: a time is stated only if the cited span proves it (`sourceSpanProvesTime`). Otherwise the post uses the local date only.

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

- **Item identity key:**
  - venue items: `venue:<id>:<local date>:<normalized event name>`
  - road items: `road:<record id>`
  - transit items: `ttc:<alert id>`
  - project and org items: `<project|org>:<id>:<record id>:<statement or event date>`
  - news items: `news:<canonical url of the original>`
- **Cross-source duplicates.** When a news article covers an event that is also in a listing, the verifier merges them into one item. The official or identity source becomes the primary citation, and the news URL may be a second citation on the same item.
- **Shared feed URLs.** Items from the same listing or feed may share one citation URL when their `recordId`s differ. This changes the current "roundup URL shared across items" rule for sources flagged `feed:true` or `listing:true` only (§11).
- **Prior coverage comes from the live export.**
  - Every roundup post published by this pipeline carries a structured field:

    ```jsonc
    "roundupCoverage": { "version": 1, "isoWeek": "2026-W40", "planningCutoff": "<T_plan ISO>",
                         "keys": ["road:Tor-RD042026-1044-5", "venue:bmo-field:2026-10-03:toronto argonauts vs bc lions", "..."] }
    ```

    `keys` holds every constituent identity key of the counted units, including each concert inside an aggregate, plus the "Still in effect" items. It is capped at 64 keys of ≤200 chars each.
  - The assembler derives the field from the pack. Submit re-derives it and refuses a mismatch, on every revision including fixer revisions (§9.4).
  - The runner's normal `exportSnapshot()` writes live posts to `data/posts.json` from the trusted DB, and the pipeline reads coverage from there. The source process needs no DB access, and a VM rebuild loses nothing.
  - **Previously covered** means the key is in any live roundup post's `roundupCoverage.keys`. Such an item appears only under "Still in effect" if it is still active, and it does not count. A new occurrence date or a different record on the same venue calendar URL is a new key and counts.
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

Consequence, stated plainly: a lone blogTO, CityNews, Star, CBC or TFC Republic page does not qualify on its own, however local and well dated it is. This is the main reason weeks 37 and 39 hold in §7.

## 7. Publish rule (`planRoundupV2` in `scripts/news-pilot/roundup.mjs`)

1. **Counted units.**
   - All `concert` items (music or performance listings) at the same `venue:*` in the window collapse into **one** aggregate unit per venue, rendered as one line. Example: "RBC Amphitheatre: Red Clay Strays (Sep 30), …".
   - Every other qualified item is its own unit, after identity dedupe.
   - `previously-covered` items are not units.
   - `class` items count at most one unit per venue per edition week. A venue is a watch account or venue ID. Further classes at that venue are dropped from the edition.
2. **Decision.** `publish` iff `units ≥ 3` **and** `coreAnchorUnits ≥ 1`, where `coreAnchorUnits` counts core units that are **not** `class`. A class at a core venue is a counted core unit for wording, but it cannot be the edition's only core item. Otherwise `hold`, with reasons (`below-minimum`, `no-core`, or both) and the census. The census reports `units`, `coreUnits` and `coreAnchorUnits`.
3. **Cap and order.** At most 12 units per edition. Order: core first, then roads and transit, then venues, then news and announcements. Ties break by first date, then identity key. "Still in effect" is not numbered and not counted. The copy never claims coverage it does not have.
4. **Two clocks.** The plan and the writer use `T_plan`. Submit re-verification re-applies this rule at `T_submit`, and a pack that falls below 3/1 is refused (§9.4). An idempotent replay keeps the original context, including both instants.

### Expected replay result (A4)

This was recomputed under this revision's rules from the backtest rows (`R<line>` in `items.jsonl`) and the Instagram trial rows (`IG<line>` in `ig-items.jsonl`). It supersedes revision 1's table, which assumed every week published, and the trial's own 4/5/3/7 core tally, which did not apply clocks, prior coverage, the explicit-date rule or the class rule.

**Replay clocks.**

- Weeks 37–39 are evaluated at the three cadence slot instants, Wednesday, Friday and Sunday at 16:00 UTC, in order. The week's result is the first slot that publishes, or HOLD if none does.
- Week 40 is evaluated once, at `2026-09-29T15:00:00Z`, just after its evidence was captured live (14:26 UTC).

**One pool, replayed in sequence.** Every converted unit is available at every clock it is available for:

- A news report is available only if its dateline is at or before the clock.
- An Instagram post is available only if its timestamp is at or before the clock. Timestamps are decoded from the shortcode and cross-checked in conversion.
- A listing, feed, org or project record is available at clocks at or after its capture. A record captured after the clock is used only in the week the backtest assigned it, and only for events after the clock. It is labelled `capturedAfterClock`.
- Only records that correspond to a reference row are converted. Other records in the same frozen bodies are out of scope, which can only undercount.
- Replay is sequential. A published edition's `roundupCoverage` removes its keys from later weeks, and a held week rolls its news forward.

**Two unresolved facts** decide weeks 38 and 39. The conversion must establish each one, or it is unavailable:

- **(i)** The OHA Wellness carousel image text (post `DdHSweujA9B`). It dates IG099 (sound bath, Sep 17) and IG100 (stretch class, Sep 30). The image text also dates IG034 (Liberate Your Locker, Sep 19). It must pass the image-text rule in §6.4.
- **(ii)** The visible dateline on the Canada Soccer page for R37 (the Nations League announcement, Sep 24).

"Ceiling" means both verify; "floor" means neither does.

| ISO week | Deciding clock | Ceiling: units (core / anchor) | Floor: units (core / anchor) | Decision |
|---|---|---|---|---|
| 37 | Wed 2026-09-09T16:00Z | 9 (4 / 2) | 8 (3 / 1) | **publish** in both |
| 38 | Wed 2026-09-16T16:00Z | 3 (2 / 1) | 2 (1 / 1) | **publish** only if (i) verifies; otherwise **HOLD `below-minimum`** at all three slots |
| 39 | Fri 2026-09-25T16:00Z | 4 (2 / 1) | 2 (1 / 1) at Fri and Sun | **publish** at Fri if (i) or (ii) verifies; otherwise **HOLD `below-minimum`** |
| 40 | 2026-09-29T15:00Z | 15 (3 / 3) → cap **12** | 14 (4 / 4) → cap **12** | **publish** in both |

**Pinned eligible units.**

- **W37 (Wed).**
  - Core: IG084 Green Liberty Village Eco-Fair, Sep 12 4–7 p.m. at Liberty Village Park (anchor; first-party organiser; explicit "Saturday, Sept 12"); IG069 NRG Haus Alchemy special edition, Sep 10 7 p.m. (class); IG065 Oxygen Yoga "Sculpt It to Latin Musica", Sep 15 (class; a different venue); IG034 Liberate Your Locker, Sep 19 at Liberty Village Park (anchor; ceiling only, via (i)).
  - Adjacent: R07 + R22b Coliseum concert aggregate (Sonu Nigam, Yeat, Suki Waterhouse); R22a Tempo vs Fever, Sep 18; R22c Tempo vs NY Liberty, Sep 20; R08 + R24 RBC concert aggregate, Sep 9–20; R09 Strachan/Fleet hydro.
  - Merged or excluded: R02 blogTO Eco-Fair merges into IG084 as a second citation. R01 Board Game Night is `weak-source`: a single `lead` publisher, and Left Field's Instagram was restricted.
- **W38 (Wed).**
  - Units: R20 Give Me Liberty at the Lamport lot (anchor; BIA official section; `capturedAfterClock`); IG099 OHA sound bath, Sep 17 (class; ceiling only); R38 Coliseum concert aggregate (Tove Lo, Sep 23).
  - Already covered by W37, so not counted: R22a, R22c, R24 and IG034. R09 is listed under "Still in effect".
  - Not available at the Wednesday clock: IG157 and IG158 (posted Sep 18; they are also relative-date `undated`). IG117, Burger Drops at Give Me Liberty, merges into R20.
  - At the Friday and Sunday slots R20 has concluded, so the floor holds at every slot.
- **W39 (Fri).**
  - Ceiling units: R39 RBC concert aggregate (Sep 25–27; captured Sep 24); IG100 OHA stretch class, Sep 30 (class); IG193 NRG Haus "Station 9: The Recovery", Oct 3 (anchor; posted Sep 24 23:49Z); R37 Nations League announcement (news-update).
  - The floor has only R39 and IG193.
  - Excluded: R32 Liberty Laughs (`weak-source`); R33, R36 (`weak-source`); R34, R35 (`undated`: event dates only in news prose); IG200 DeltaTrain simulation (posted Sep 25 20:21Z, after the Friday clock; concluded by Sunday); IG227 (retrospective).
  - If W38 held, R38 Tove Lo would be new here, but it concludes Sep 23 before the Friday clock. So the floor stays at 2 units.
- **W40.**
  - Core anchors: R50 34 Hanna park open house at 171 East Liberty St (City project section); R52 Hanna Ave Bell repair; IG214 Burger Drops' George Motz Oct 3 burger event at 116 Atlantic Ave (the Oct 3 caption block only; the Oct 2 Downsview block is `not-LV`); IG193 (floor only, since it is covered by W39 in the ceiling).
  - Roads: R53 King St W at Strachan; R54 Lake Shore at Newfoundland.
  - Venues: R58 RBC aggregate (from Sep 30); R59a HYROX; R59b Fall Home Show; R59c Fall Baby Show (ceiling only); R55 Argos Oct 3; R57a Marlies Oct 3; R57b Coliseum concert aggregate (Steve Lacy, Brand New); R56a TFC Oct 10; R56b Canada WNT Oct 12.
  - News: R61 Sceptres opener (ceiling only; its dateline must verify like (ii)). R37 is covered by W39 in the ceiling, and its dateline is unavailable in the floor.
  - **Cut by the cap in §7 order:** R56a and R56b in both cases, plus R61 in the ceiling.
  - Excluded: R51 and R60 (`weak-source`); IG223 and IG215 (relative-date `undated`); IG221 merges into IG214; IG100 is covered by W39 in the ceiling and unavailable in the floor.

**Other conditional spans.** Some units need an exact span in the frozen body: R22b (Suki Waterhouse row), R57b's Brand New row, R59c, R61's dateline, and the per-record RBC JSON-LD objects. They change only the counts shown, never a decision. If a span is absent, that unit is excluded, and the expected table is updated by review. Nothing is relaxed to keep a unit.

**What this means.** Without Instagram, weeks 37 and 39 hold under the inherited source rule. With the Instagram rules in §4.4, W37 and W40 publish outright. W38 and W39 depend on one image-text verification and one dateline. The trial's larger gain (13 items) shrinks here because:

- IG124 and IG227 are retrospective;
- IG157, IG158 and IG223 have relative dates only;
- classes cannot anchor an edition;
- W37's edition previews and covers some W38 items.

A hold in either week is the correct result of the settled rules, not a defect to engineer around.

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
  - The check is per record and per quote. A missing record, a missing quote, a changed date, a changed locality, a lost source-quality pass, a changed risk result, or a unit no longer eligible at `T_submit` (§6.5) all raise `ValidationError('roundup source evidence changed or unreachable; rebuild before submit')`.
  - It re-applies the §7 rule at `T_submit`. A pack that falls below 3/1 is refused.
  - It reconstructs prior coverage from the current live roundup posts in the DB, using the same function the pipeline uses on the export. It refuses if the pack counts a key that is now covered.
  - It re-derives `roundupCoverage` from the re-verified pack and refuses any mismatch with the post record.
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
5. The v2 pipeline, then the rest of the existing flow.

**Changes to the pipeline steps:**

- **Pipeline.** Discovery is `roundup-v2-run.mjs --collect`, replacing `run.mjs`. The writer is `roundup-v2-run.mjs`, replacing `roundup-run.mjs`. The contract is the same (`--run --out --root --now [--dry-run]`), plus `result.pipeline`. `--now` is `T_plan`.
- **Hold under the publish rule.** The result is a non-terminal `roundup-hold` with the reasons and a bounded census. The slot is released and no attempt is recorded.
  - When a staging Slack webhook is configured, the runner sends a bounded hold notice: week, units, core units, top reasons, no URLs or evidence text. This reuses the census-hold alert path.
  - Later slots in the week re-collect fresh signals.
  - After the week ends, the unchanged `cadence deadline` emits `WEEKLY_NEWS_MISSED` once.
- **Schedule.** The runner stays on-demand in staging. The cadence schedule (Wednesday primary, Friday recovery, Sunday final) applies when John later authorizes timers. No timer is added by this spec.
- **Environment.** `SOURCE_ENV['weekly-roundup']` becomes `SERPER_API_KEY`, `APIFY_API_TOKEN` and model keys. `SERPAPI_API_KEY` is dropped. If `APIFY_API_TOKEN` is missing, Instagram is `unavailable` for that run (§4.4); the run does not fail.
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
env -i PATH="$PATH" HOME="$HOME" SERPER_API_KEY="$SERPER_API_KEY" APIFY_API_TOKEN="$APIFY_API_TOKEN" ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  node scripts/news-pilot/roundup-v2-run.mjs --collect --out "$DRY/run" --now "$NOW"
env -i PATH="$PATH" HOME="$HOME" SERPER_API_KEY="$SERPER_API_KEY" APIFY_API_TOKEN="$APIFY_API_TOKEN" ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
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
| `scripts/news-pilot/roundup-evidence.mjs` | Keep `provenPublicationMs`, `sourceSpanProvesTime`, `fullDatesInSpan`, the risk constants and `roundupPackDigest`. **Extract and export the inherited source-quality predicate as `roundupSourceQuality(entries)`** (§6.7) with its existing semantics. Remove the v1 `validateRoundupItem`/`validateRoundupPack`/`revalidateRoundupItems` text-locality path (`scoreLocalRelevance`) together with its tests, once v2 tests replace them. The source-quality tests move to the new predicate and are not deleted. |
| `scripts/news-pilot/roundup-run.mjs` | **Deleted.** It was the v1 free-text cluster writer; its reusable helpers move to `roundup-verify.mjs`. The `legacy-fixture` tests are removed. |
| `scripts/content/roundup-mode.mjs` (**new**) | Per-target mode and the Instagram source constant: enabled, provider `apify` (§10.1). |
| `scripts/content/cli.mjs` | Conditional roundup submit boundary (§10.2). `cadence unresolved --lane`. |
| `scripts/content/validate.mjs` | Add `roundupCoverage` to the allowed (not required) `posts` fields. It is valid only on a `category:'news'` post whose slug matches the roundup slug pattern: `version:1`, a matching `isoWeek`, an ISO `planningCutoff`, and ≤64 string keys of ≤200 chars. Any other post with the field fails validation. |
| `scripts/content/submit.mjs` | `checkRoundupRecord` becomes `checkRoundupRecordV2`: the §7 counts; label `Liberty Village + Exhibition Place this week` (replacing "news roundup"/"weekly update"); near/in wording per verdict; the impact-wording refusal; feed/listing shared-URL exception with distinct record IDs; per-unit citation and date checks (kept); `roundupCoverage` equality on every revision. `buildContext`/`submitContent` use the v2 verifier at `T_submit` (`temporalValidationNow`) with DB-reconstructed prior coverage (§9.4). `ROUNDUP_REVALIDATE_MAX_AGE_MS` (6 h) is unchanged. |
| `scripts/content/cadence.mjs` | `unresolvedAttempts` with `lane` (replacing `unresolvedContentAttempts`); roundup `late-smoked` proof; new `currentLiveSubmission` (§10.3.1). |
| `scripts/content/gate.mjs` | Roundup evidence projection: per-unit verdict, identity, record ID, quotes, typed fields and tier (§9.4). |
| `scripts/automation/review-agent.mjs` | `LENSES.roundup`: add the three checks from §9.4. The threshold and severity rules are unchanged. |
| `ops/exedev-runner/runner.mjs` | Mode from `roundup-mode.mjs`; v2 pipeline invocation; hold notice; `validateRoundupOutput` additions; `SOURCE_ENV` change; `legacy-fixture` removed; `settleAttempt` roundup late-smoke; new `recoverPriorRoundup` called from `runWeeklyRoundup` before `count`; `recoverPriorContent` passes `--lane content` (§10). |
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
  - Relative-only dates ("tomorrow", "this Saturday") → `undated`. An explicit "Saturday, Sept 12" posted Sep 8 resolves to 2026-09-12.
  - Image-text dates: provider alt text containing the quote passes. Two agreeing transcriptions pass. Disagreeing transcriptions, or a missing image, → `undated`.
  - A provider timestamp more than 5 minutes from the shortcode-encoded time → `unverifiable`.
  - Tagged or collaborator rows (owner ≠ handle) are dropped.
  - Source quality: an own event at the own verified address passes as `primary`. The same account posting another business's event, or a collaboration hosted elsewhere, is `lead` → `weak-source` unless independently corroborated.
  - Routine promo, daily special and holiday-hours posts → `not-news`.
  - Env scoping: `APIFY_API_TOKEN` is present in `sourceEnv('weekly-roundup')` and absent from the `lv-generator` env and every other job's `sourceEnv` (runner env test).
  - Provider failure: the adapter throws or times out → Instagram `unavailable` in the census, every other source's signals are unchanged, and the run completes. A missing `APIFY_API_TOKEN` behaves the same.
  - An Instagram unit whose post was deleted or made private between plan and submit → `record-missing` at submit.
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
  - A fixer revision that changes `roundupCoverage` is refused.
  - A pack counting a key that the DB now shows as covered is refused at submit.
  - `validate.mjs` rejects `roundupCoverage` on a non-roundup post.

### A4: Backtest replay (`tests/news-pilot/roundup-v2-backtest.eval.mjs`, run in `test:news-pilot`)

**Reference data (immutable).** `items.jsonl` is copied byte-for-byte to `tests/fixtures/roundup-v2/backtest/reference/items.jsonl`, and the Instagram trial's `ig-items.jsonl` and `accounts.csv` to `tests/fixtures/roundup-v2/backtest/reference/ig/`. Their sha256 values are pinned in the eval. They are never edited, and they are not reasoner input: their rows use a different, non-schema shape.

**Reviewed conversion (captured-evidence replay).** Converted units live in `tests/fixtures/roundup-v2/backtest/replay/conversion.jsonl`, one line per replay unit:

```jsonc
{ "unitId": "R22b", "sourceRow": 22, "form": { /* schema-valid §5 form */ },
  "bodies": [ { "url": "...", "file": "bodies/<sha256>.html", "capturedAt": "...", "capture": "live|wayback",
                "capturedAfterClock": false } ],
  "spans": [ { "recordId": "...", "field": "subject|place|date|dateline", "start": 0, "end": 0, "text": "..." } ],
  "unavailable": [ "dateline" ],
  "expected": { "week": 38, "clock": "2026-09-16T16:00:00Z", "class": "eligible|weak-source|undated|...", "unitKind": "sports" } }
```

- **Building the conversion.** The builder re-captures each source: live where it still exists, or the Wayback capture the backtest used for venue listings. The builder records exact spans (offsets into the normalized record text), record IDs and datelines.
  - Bundled rows are split, one unit per event (for example R22 → R22a Tempo vs Fever, R22b Suki Waterhouse, R22c Tempo vs NY Liberty).
  - A fact that is not in the frozen body is listed in `unavailable`, and the unit is expected to fail on it. It is never reconstructed.
  - Ellipsis-joined backtest quotes are never used as quotes. Each part becomes its own span in its own record, or is unavailable.
- **Review.** The conversion file and its expected classes are reviewed by someone other than the builder before the replay expectations are frozen.
- **Instagram units.** Each converted Instagram unit's frozen body is the provider row for the post: owner, shortcode, timestamp, caption and image alt text. The trial did not archive its raw provider datasets (`apify-items*.json`), so the builder re-collects the named posts through the provider, read-only and within the trial's cost bounds. If a post can no longer be collected, its `ig-items.jsonl` caption is used as the body with `capture: 'trial-excerpt'`. Image-text dates need the image re-captured and both transcriptions recorded in the conversion; otherwise the date is `unavailable`. That is unresolved fact (i) in §7. Timestamps are recorded from the provider and the shortcode.
- **Rows that cannot be re-captured** stay in the replay with the expected class `unverifiable`: bot-walled pages, R12 and R13 (truncated `article_` URLs, empty quotes, no canonical metadata), and the Globe. They are **not** asserted as detected syndication; stale detection is proven only by the A2 synthetic fixtures.
- **No model calls.** The replay runs `verify → plan` with the converted forms as the reasoner's output.

**Clocks and availability** are exactly as in §7: one pool, replayed in sequence, with Wed, Fri and Sun 16:00 UTC for weeks 37–39 and `2026-09-29T15:00:00Z` for week 40. News is available only if its dateline is at or before the clock, and Instagram posts only if their timestamp is. Records captured after the clock are labelled `capturedAfterClock` and used only in their backtest week, for events after the clock.

**Assertions:**

- The per-week decisions, eligible unit IDs, unit and core counts, and cap cuts equal the §7 table, as updated by conversion review:
  - W37 publish at the Wednesday slot, with IG084 as its anchor;
  - W38 publish at the Wednesday slot if (i) verifies, otherwise HOLD `below-minimum` at all three slots;
  - W39 publish at the Friday slot if (i) or (ii) verifies, otherwise HOLD `below-minimum`;
  - W40 publish 12 with R56a and R56b cut by the cap (plus R61 in the ceiling).
- The eval runs both the ceiling and the floor scenario by toggling facts (i) and (ii) in the conversion, and asserts both columns of §7. The real conversion then selects one.
- **No expectation may override a verifier rule.** A deviation is reported for review, never forced.
- Removing R20 turns week 38 into `hold` in both scenarios.
- Removing IG084 turns week 37 into `hold` (`no-core`) in the floor, because the classes IG069 and IG065 cannot anchor.
- Every Instagram row in `ig-items.jsonl` that the trial did not qualify stays excluded: `undated`, `outside-window`, `promo-only`, `recurring-generic`, `routine-holiday-hours`, `off-site event` and `no-caption` map to `undated`, `concluded` or `stale`, `not-news`, `not-news`, `not-news`, `not-LV` and `record-missing`. Trial duplicates merge into their event. Of the trial's 13 qualified rows, IG124 and IG227 are `retrospective`, and IG157, IG158 and IG223 are `undated` (relative date).
- Every trap row is excluded with the expected reason class: R44 TorontoToday stabbing (`not-LV`); R03 Toro Toro (`not-LV`); R02 Eco-Fair and R65 Don't Tell Comedy (`unverifiable`); R43 CBC Parkdale and R41 Parkdale Barbers (`not-LV`); R62 Joe Shuster Way, R63 Temple Ave and R64 Douro St (`not-LV`). R23 CBC Tempo/NY Liberty is a venue-qualified row: it is future at the W38 Wednesday clock, and at later clocks it is a merged `duplicate` of R22c.
- Every crime, election and weak-source row is excluded: R04, R42, R17, R18, R19, R26, R28, R49, plus R01, R05, R06, R21, R32, R33, R36, R51 and R60 as `weak-source`. So is every blocked row: R10 TorontoToday, R25 Toronto Life, R11 NOW and R30 Globe.
- No Reddit, directory or Ontario Place row is admitted (R16, R17, R18, R19, R31, R40, R41, R48, R49).
- The loss from relative-only dates is reported, not tuned: the eval prints which units a post-time-anchored relative-date rule would add (IG157, IG158, IG223, IG215). Changing that rule is a separate reviewed decision.
- The eval prints a per-week, per-slot census table, including the `capturedAfterClock` labels, which is kept as evidence.

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

1. **Holds under the inherited source rule.** With Instagram, the replay publishes W37 and W40. W38 and W39 depend on one image-text verification and one dateline, and hold otherwise (§7). Holds emit `WEEKLY_NEWS_MISSED`. Relaxing §6.7 would be a substantive cadence change needing its own review. This spec does not propose it.
2. **Relative dates on Instagram.** The parent's rule requires an explicit date, so "tomorrow" and "this Saturday" posts are `undated` (IG157, IG158, IG223, IG215). Anchoring relative words to the verified post timestamp would recover some of them. Should that be allowed? It needs a separate reviewed decision.
3. **Brand fit.** In published weeks, most counted units are stadium and expo items. The ≥1 core rule enforces a local anchor but not a local majority. Is that the intended brand balance? (The title's "+ Exhibition Place" is intended to make this honest.)
4. **Meta Business Discovery (optional).** Apify is approved for production (2026-09-29). Should the Meta adapter be added later? It needs John to provide a professional Instagram account, a Facebook Page and a Facebook app (§4.4).
5. **Bot-walled local coverage.** Should TorontoToday or Toronto Life access be licensed? Their tower stories would be human-only under current policy anyway.
6. **Production activation.** The criterion and timing are John's call (A6.5).
