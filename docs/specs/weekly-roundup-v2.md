# Weekly roundup v2: "Liberty Village + Exhibition Place this week"

Status: **draft spec for independent review.** No implementation until it is accepted. Date: 2026-09-29. Base: PR #192 branch `overnight/content-quality` @ `9681c36`.

This spec replaces the free-text roundup writer, which PR #192 held in `ROUNDUP_PUBLICATION.mode='census-only'`, with a structured-source pipeline. It depends on `docs/specs/content-cadence-2026.md` (the cadence count, slot and receipt contract) and changes only the parts named in §11. Nothing here authorizes a production timer, a production mode flip, a migration against production, a protected merge or a production publication. Those remain John's actions.

Evidence: the four-week backtest at `lib_village/.state/archive/2026-09-29-roundup-backtest/` (`report.md` and 65 structured forms in `items.jsonl`), and research §8 in `docs/research/content-quality-2026-09.md`, which covers why keyword locality failed.

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
| All four weeks (37–40) reach ≥3 qualified items, even under the stricter lens. Core items: 1, 1, 1, 3. | Publish rule ≥3 counted AND ≥1 core (§7). The replay test asserts all four weeks publish (§12, A4). |
| Venue calendars (BMO Field, Coliseum, Exhibition Place, RBC Amphitheatre) supplied 11 of 29 qualified items, with clean dates and venue identity. | Venue listings are identity sources: the trusted venue ID comes from the source registry, never from page text (§4, §6.2). |
| Keyword locality failed: site-nav mentions, NY Liberty, publisher labels, name-only events, Parkdale results, a lat/lon bbox. | Locality comes from **identity**: venue ID, road-segment ID, project ID, route and stop, or an address-point match. The agent's verdict can only lower locality, never raise it (§6). All traps are mandatory negative tests (§12, A1/A4). |
| Serper's `cdr` filter leaks old items; syndication re-dates stories; Star JSON-LD dates are malformed. | Dates come from the page's own dateline. Search metadata is never date evidence. Syndicated copies follow the canonical link to the original (§6.4). |
| Road restrictions and TTC alerts keep no history. Past weeks were undercounted. | Volatile feeds are snapshotted every run and kept as evidence (§8). |
| An ongoing road work (Strachan hydro, Sep 10–Nov 27) qualifies for 11 weeks. | An item already published in an earlier edition, with no new development, may appear under "Still in effect" but **does not count** (§7). |
| RBC Amphitheatre adds concerts every week. | Concert listings are aggregated per venue per week and count at most once (§7). |
| Reddit, the directory, SerpApi date-filtered news and the Ontario Place calendar added nothing. | These are dropped from the roundup source set (§4). |
| TorontoToday, Toronto Life and NOW return 403; the Globe is paywalled. | These are classified `blocked` → `unverifiable`, with no retry and no circumvention (§4.3). |
| Most LV-specific September news was crime or election coverage. | Those items are refused as `risky` and never published, even as a link (§6.5). |

## 3. Pipeline overview

```
collect ─► signals.jsonl + snapshots/     (deterministic; network; no model)
   │
reason  ─► forms.jsonl                    (model; tool-less; output is untrusted data)
   │
verify  ─► verified.jsonl + verify-report (deterministic; re-fetch; identity locality; windows; risk; dedupe)
   │
plan    ─► plan.json (publish | hold)     (deterministic publish rule, §7)
   │  hold ─► result.json {decision:'hold'} ─► runner hold notice (§10.3)
   │
write   ─► draft.json                     (model: copywriter)
review1 ─► findings-1.json ─► revise      (model: fact reviewer; deterministic post-check)
review2 ─► findings-2.json ─► revise      (model: locality/tone reviewer; deterministic post-check)
   │
assemble─► pack.json + result.json + data/posts.json append   (deterministic; §9.3)
   │
runner  ─► cadence reserve/attempt ─► content submit --kind roundup ─► gate ─► deploy ─► smoke
```

Every stage runs through the runner's existing `source()` path. That means trusted code from the pinned SHA, `sourceEnv('weekly-roundup')` (source and model keys only), and no DB URL, deploy hook, Slack webhook or bypass. The model calls are **tool-less** Messages API calls that return JSON validated against a schema. Model output is data. Trusted code parses it, never executes it, and decides admission deterministically. If a later design gives any agent tools such as web fetch or shell, those stages must move into the `lv-generator` scratch sandbox under the existing transfer allowlist. That is out of scope here.

## 4. Source set

### 4.1 Registry

Roundup sources live in a new `ROUNDUP_SOURCES` export in `scripts/news-pilot/sources.mjs`, separate from the daily-news `SOURCES`. Each entry has these fields:

- `id`
- `identityKind`: `venue`, `road-feed`, `project`, `org`, `transit-feed` or `news-discovery`
- `identityId` (for example `venue:bmo-field`), where one applies
- `url`
- `parse`: `jsonld-event`, `html-listing`, `json-feed`, `html-page` or `serper-news`
- `locality`: `core` or `adjacent`, for identity sources
- `officialDomains`
- `minIntervalMs`: per-host politeness
- `enabled`

A source is enabled only after the builder re-probes it (HTTP 200, robots allowed, item-level dates parseable) and records the probe date in `note`.

| id | identity | locality | parse | notes |
|---|---|---|---|---|
| `rv2-serper-news` | news-discovery | per page (§6.3) | serper-news | Google News via Serper `/news`. At most 12 queries per run, drawn from the fixed query set in §4.2. It surfaces leads only: a result or snippet is never evidence. |
| `rv2-bmo-field` | `venue:bmo-field` | adjacent | html-listing (JSON-LD if present) | `https://www.bmofield.com/events`. Evidence comes from the dated listing rows, not the detail pages. Research §8 found the detail pages weak. |
| `rv2-coliseum` | `venue:coca-cola-coliseum` | adjacent | html-listing | `https://www.coca-colacoliseum.com/events` |
| `rv2-explace` | `venue:exhibition-place` (sub-venues: Enercare Centre, Beanfield Centre, Queen Elizabeth Building, Hotel X grounds excluded) | adjacent | html-listing | `https://www.explace.on.ca/events/` |
| `rv2-rbc-amphitheatre` | `venue:rbc-amphitheatre` | adjacent | jsonld-event | `https://www.rbcamphitheatre.com/shows`. JSON-LD `MusicEvent`. `location.name` must match the venue alias list, which guards against Live Nation cross-venue rows. |
| `rv2-road-restrictions` | road-feed | per segment (§6.2) | json-feed | `https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json`. Only currently active records are available, so it is snapshotted every run. |
| `rv2-lv-bia-events` | `org:lv-bia` | per listed address (§6.2) | html-page | `https://www.libertyvillagebia.com/events`. A BIA event is core only when its own listing gives an LV-core address or venue. "Events in & around LV" entries without one are leads. |
| `rv2-city-projects` | `project:<id>` | core | html-page | Watched City LV project pages. The initial list is 34 Hanna Ave park, Liberty St, and Liberty For All; it is checked in and changed only by PR. Only a dated statement on the page is an item. A content-hash change is a trigger to re-read the page, not evidence. |
| `rv2-ttc-alerts` | transit-feed | per route + stop (§6.2) | json-feed | `https://alerts.ttc.ca/api/alerts/live-alerts`, which the backtest found reachable. The daily-news `ttc-alerts-live` entry (`/live`, 404) stays disabled. Routes: 504, 29, 509, 511, 63. |

**Dropped from the roundup:** Reddit/Apify, directory-as-news (`data/businesses.json`), SerpApi (including date-filtered `tbm=nws`), the Ontario Place calendar, and City news releases. City releases may stay in daily news; they are not a roundup source. `SERPAPI_API_KEY` is removed from `SOURCE_ENV['weekly-roundup']`. The daily `news` job is unchanged.

**Optional source: Instagram.** See §4.4. It is disabled until the parent or John decides.

### 4.2 Fixed Serper query set

Queries are fixed, checked in and bounded. The query text only affects recall; admission is decided in §6.3.

- `"Liberty Village" Toronto`
- `"Exhibition Place" Toronto`
- `"BMO Field"`
- `"Coca-Cola Coliseum"`
- `"Enercare Centre"`
- `"Lamport Stadium"`
- `"Ontario Line" Exhibition`
- `"Hanna Avenue" OR "Atlantic Avenue" OR "Jefferson Avenue" OR "East Liberty Street" Toronto`

Results are filtered to the week window using the **page's** dateline after fetch (§6.4), never Serper's date or the `tbs` filter.

### 4.3 Access rules (all sources)

- **robots.txt:** fetch it once per host per run, and cache it in the run dir. If a path is disallowed, skip that source or URL and record `robots-disallowed`.
- **Politeness:** at most 1 request per host per `minIntervalMs` (default 2 s). Each run has a budget of 80 fetches (the existing `MAX_REQUESTS`) plus 12 Serper calls. Requests use the existing public-HTTP guard and User-Agent from `fetch.mjs`.
- **Blocked responses:** 401, 402, 403, 406, 429, or a known challenge body ("Just a moment", "Security Verification", `cf-chl`) are classified `blocked`. There is no retry with another UA, no cookies, no headless browser and no archive substitution in the live run. The item becomes `unverifiable`.
- **Paywalls and metering:** paywalled text is never used. A metered page counts only for the text actually served to an anonymous fetch.
- **Wayback:** the live pipeline never uses it. It appears only in backtest fixtures (§12).
- **Untrusted content:** external content is data. It never changes gate thresholds, source tiers, cadence receipts or protected controls.

### 4.4 Optional pluggable source: Instagram (disabled; parent decides inclusion)

A parallel read-only trial is running (`/private/tmp/lv-ig-trial/report.md`). It has not reported yet. If the parent includes Instagram, the source plugs in behind the same interface with no pipeline change:

- `rv2-instagram` has `identityKind: 'org'`. It uses a checked-in watch list of `{handle, businessKey, address, verification}`. A handle is admitted only when the business's own website links to it and the business record has an LV-core address point (§6.2).
- A post can become a **signal** only if it is first-party (the account announces its own dated event, opening or closure at its own LV address) and falls in the window. Promos, daily specials and generic "come visit" posts are not signals.
- **Collection:** preferably Meta's official Business Discovery API. A public-data scraper actor is acceptable only if it is used without our login or cookies, stays within the trial's documented cost, and respects rate limits. The choice is the trial's recommendation plus John's decision.
- **Verification:** the post URL must be re-fetchable anonymously and contain the quote. If it is not, the item needs a non-Instagram corroboration URL that verifies under §6. A login wall means `unverifiable`.
- **Enablement:** a compiled `ROUNDUP_OPTIONAL_SOURCES.instagram = false` in `scripts/content/roundup-mode.mjs` (§10.1), flipped only by a reviewed PR. The acceptance criteria in §12 do not depend on it.

## 5. Structured form (reasoning agent output)

The reasoning agent receives signals in batches of up to 10. For each signal it gets the collected fields, the bounded main-text excerpt (≤2,000 chars) and any JSON-LD. It returns exactly one form per signal. `scripts/news-pilot/roundup-reason.mjs` validates each form against a JSON schema; an invalid form is `form-invalid` and is dropped.

```jsonc
{
  "signalId": "sha256 of sourceId+url+recordId",   // copied from the signal; must match
  "what": "string ≤200",                            // plain description
  "where_it_happens": "string ≤200",                // as stated by the source (address, venue, segment)
  "when": { "kind": "news-update|event|restriction|alert",
            "date": "YYYY-MM-DD",                     // Toronto-local; the dateline for news, the start for events
            "endDate": "YYYY-MM-DD|null",
            "startTime": "HH:MM|null" },              // only if the source states a time
  "who_is_affected": "string ≤200",
  "relevance_reason": "string ≤300",
  "verdict": "core|adjacent|not-LV",
  "evidence_url": "https URL (must equal a URL fetched for this signal)",
  "evidence_quote": "verbatim string ≤400",
  "date_quote": "verbatim string ≤200|null",        // when the date is not inside evidence_quote
  "item_type": "event|concert|sports|expo|community|opening|closure|road|transit|project|news",
  "risk": { "crime": bool, "election": bool, "private_individual": bool,
            "development_application": bool, "civic_controversy": bool },
  "exclude_reason": "string|null"                   // the agent may exclude; it may never admit on its own
}
```

The agent's job is **judgement**. It decides whether this is a genuine dated development or event, who it affects, and whether it has resident impact (the Hotel X spa award, for example, is `not-LV`: an adjacent place with no resident impact). It also sets the risk flags and picks the verbatim evidence.

The agent **cannot establish locality, dates or admission**. The verifier recomputes all three from the source (§6). The agent's verdict is a ceiling: the final verdict is `min(agentVerdict, identityVerdict)`, ordered `not-LV < adjacent < core`. A form whose `risk` has any true flag is refused. If the agent missed a flag, deterministic risk detection still applies (§6.5).

## 6. Deterministic verifier (`scripts/news-pilot/roundup-verify.mjs`)

The verifier runs twice: once in the pipeline, and again inside `content submit` before the DB write (§9.4). The two runs share one implementation. There are no model calls.

### 6.1 Quote verification

1. Re-fetch `evidence_url` live under the access rules in §4.3. Search caches and snapshots are never used for text sources. For feed sources, see (4).
2. Build the **match region**:
   - **HTML:** the main content from the existing `extractMainHtml`, with `<nav>`, `<header>`, `<footer>`, `<aside>`, menus and elements whose role or class matches navigation or breadcrumbs removed. Then add each `application/ld+json` block as its own region.
   - Normalization: decode entities, collapse whitespace, map curly quotes to straight quotes and en/em dashes to `-`, and apply NFC. Matching is case-sensitive.

   Stripping navigation is what defeats the **site-nav keyword** trap: the TorontoToday stabbing page mentions "Liberty Village" only in its menu.
3. Every provided quote (`evidence_quote`, and `date_quote` if present) must appear verbatim in the match region **of the same URL**. A quote from another URL, or another item's source, is `source-swapped`.
4. **Feed sources** (`json-feed`): road restrictions and TTC alerts.
   - The verifier locates the record by its trusted ID in both the run snapshot and a fresh re-fetch. The typed fields must be equal in both: road restrictions compare `id, road, fromRoad, toRoad, startTime, endTime, description`; TTC alerts compare `id, route, stops/segment text, effect, active period`.
   - The quote must be a raw substring of the fresh record's serialization.
   - The date and place come from the typed fields. Road-restriction epoch milliseconds are converted to Toronto local time.
   - A record that is missing from the fresh fetch is excluded: the restriction or alert has ended.
5. **The date must be in the quotes.** The quote set must contain a date expression that resolves to `when.date`, using the existing `fullDatesInSpan` plus the rules in §6.4.
6. **The place must be in the quotes, or come from source identity.**
   - For text sources, the quote set must contain the place token that §6.2 or §6.3 classifies.
   - For venue, project and feed identity sources, the place comes from the registry identity. The quote must still name the event, record or statement.

### 6.2 Locality from identity (`scripts/news-pilot/roundup-geo.mjs`)

Locality uses one checked-in, reviewed geography module plus two generated data files. It has **no lat/lon bounding box and no free-text keyword match.**

- **Core polygon** (`scripts/news-pilot/data/lv-core.geojson`).
  - Boundary: King St W (north), the rail corridor / Gardiner (south), Strachan Ave (east), Dufferin St (west). These are the backtest's boundary.
  - It is derived from the City's Toronto Centreline and checked in with its derivation script and source dataset version.
  - It needs review sign-off before any test depends on it.
- **LV address points** (`scripts/news-pilot/data/lv-address-points.json`).
  - These are `{number, street}` pairs from the City's Address Points dataset whose point lies inside the core polygon, generated by the same script.
  - A **core address** is a house number plus a street pair present in this table.
  - A street name alone never makes something core. For example, a Mowat Ave address north of King is not in the table.
- **Segment table** (`scripts/news-pilot/data/lv-segments.json`). This holds Centreline segments keyed by `(linear_name, from_intersection, to_intersection)`:
  - **Core:** segments wholly inside the polygon, such as Hanna Ave, Atlantic Ave, Liberty St, East Liberty St, Jefferson Ave, Mowat Ave (south of King), Fraser Ave, Pirandello St, Snooker St, Lynn Williams St and Western Battery Rd. The generated table is authoritative over this prose list.
  - **Adjacent frontage:** King St W from Strachan to Dufferin, including a segment with one endpoint at a boundary intersection. Strachan Ave from King St W to Lake Shore Blvd W. Dufferin St from King St W to Exhibition Place. Lake Shore Blvd W from Strachan to Dufferin. Exhibition Place internal roads.
- **Road restriction locality.** A record qualifies only when its `road` matches a segment's `linear_name` and its `fromRoad`/`toRoad` resolve to an intersection on that segment. Then:
  - a core segment makes it core;
  - an adjacent segment makes it adjacent;
  - anything else makes it `not-LV`.

  Record coordinates are used only as a consistency check: a point more than 150 m from the matched segment means `not-LV`. They are never the admission test. Joe Shuster Way, Douro St, and Temple Ave / Elm Grove / Tyndall west of Dufferin are not in the table, so they are `not-LV`.
- **Venue locality.** The source registry supplies `venue:*` IDs. Page text never does.
  - For a news page (§6.3), a venue counts only as its full allowlisted name: "BMO Field", "Coca-Cola Coliseum", "Exhibition Place", "Enercare Centre", "Beanfield Centre", "Queen Elizabeth Building", "RBC Amphitheatre", or "Lamport Stadium" (Lamport is **core**).
  - A bare "Coliseum", "Liberty" or "Exhibition", or a same-named venue elsewhere, does not count.
- **Project locality.** A `project:*` ID from the registry is core.
- **Transit locality.** A TTC alert qualifies only if its route is in {504, 29, 509, 511, 63} **and** its affected stop or segment text matches the per-route stop allowlist in `roundup-geo.mjs`. Examples: 504 on King St W between Strachan and Dufferin; 509/511 at Exhibition Loop; 29 at Dufferin Gate or Exhibition; 63 at Liberty Village. A whole-route or city-wide alert with no allowlisted stop is `not-LV`. The CP24 "weekend TTC/GO closures" pattern is `not-LV`.
- **Final verdict** = `min(agentVerdict, identityVerdict)`. If `identityVerdict` cannot be computed, the item is `unverifiable`, whatever the agent said.

### 6.3 Free-text news admission (Serper discovery)

A news page qualifies only if its **match region** (main content plus JSON-LD, never nav or publisher labels) contains one of these:

- an LV **core address** (house number plus street pair in the address-point table), which makes it core; or
- an allowlisted **adjacent venue full name** or an allowlisted transit location (for example "Exhibition Station" together with "Ontario Line"), which makes it adjacent.

The quote set must include that token.

- A headline or publisher label such as "…opening in Liberty Village" is **not** locality. The **publisher-label-vs-address** trap: Toro Toro Sushi's page gives "east side of Strachan south of Wellington". That is not an address point in the table, so the page is `not-LV`.
- A **name-only event** is `unverifiable`. Examples: the "Liberty Village Eco-Fair" with no venue, and the "Fort York – Liberty Village" show at a secret venue.
- Keyword collisions confer nothing. The word "Liberty" alone (the NY Liberty) and US namesakes (Hurricane, UT; libertyvillage.org) fail the address/venue test.
- Parkdale pages fail because they contain no core address point. Examples: CBC "issues facing Parkdale", and 1205 Queen St W.

### 6.4 Dates from the page's own dateline

- **News-update dates** come from the page. The source is either:
  - the visible dateline in the match region, or
  - `article:published_time` / NewsArticle JSON-LD `datePublished`, only when the same local date also appears in the visible text.

  Serper `date`, `tbs` results, `dateModified` and HTTP `Last-Modified` are never date evidence. A malformed JSON-LD date (the Star's `'+ com['` pattern) is ignored in favour of the visible dateline.
- **Syndication.** When a page's `<link rel="canonical">` points to a different registrable domain, or the page says "originally published", the verifier follows the canonical once and dates the item from the original. If the original is unreachable or blocked, the item is `unverifiable`. The Toronto.com and DurhamRegion re-surfacing of March/April Star pieces with September dates is `stale`.
- **Event dates.**
  - These come from JSON-LD `startDate`/`endDate` (year-bearing), or from a dated listing row in an identity venue source.
  - A listing row with no year (for example "Sat Oct 3") resolves deterministically to the **unique** occurrence of that month and day in `[weekStart − 7d, weekStart + 28d]`. If there is none, or more than one, the item is `undated`.
  - This is allowed only for identity venue sources. It is never allowed for free-text news or model inference.
- **Time.** Keep the existing rule: a time is stated only if the cited span proves it (`sourceSpanProvesTime`). Otherwise the post uses the local date only.

### 6.5 Windows, risk and exclusions

Let `W` be the Toronto-local calendar dates Monday–Sunday of the publication ISO week, and `now` the verification instant.

- **Window rules by `when.kind`:**
  - **news-update:** the dateline date is in `W` and ≤ `now`. Or it is in the previous ISO week and later than the `now` of the last published roundup edition. If no edition was published that week, the whole previous week counts. This is **roll-forward**: a held week's news remains eligible the following week. Copy always states the actual date.
  - **event:** it occurs on a date in `W` and has not concluded at `now`, **or** it starts in `[now, now + 14d)`. A concluded event is not an event item. A dated report of it may still qualify as a news-update.
  - **restriction:** the active interval intersects `[now, now + 14d)`.
  - **alert:** the alert is present in the fresh feed at `now`.
- **Too-far announcements.** A dated announcement published in-window about an event more than 14 days out qualifies only as `news-update`. Examples: the Nations League on Nov 16, the Royal Winter Fair, the Sceptres opener.
- **Refused (`risky`):**
  - any form risk flag;
  - the existing `detectRiskFlags`, `ELECTION_TEXT` and `isDevelopmentApplication`;
  - crime, sentencing, courts;
  - elections, candidates, vox pops;
  - named private individuals, other than a public official in an official capacity or a business or organization;
  - development or permit applications and tower proposals. These stay human-only, so the backtest's two bot-walled tower stories would be refused even if reachable.
- **Other exclusions:** `not-news` (directory entries, promotional copy, landing pages, listicles such as Narcity's "neighbourhoods I would never live in", advertorial such as the Toronto Sun BILD piece); `weak-source`; `unverifiable`; `undated`; `stale`; `duplicate`.
- **Impact wording** (carried over from the rejected adjacent-sources addendum, the one rule kept from it):
  - A venue listing proves only the event, venue and date.
  - Claims of road closures, detours, crowds, congestion, parking restrictions or transit disruption need a separate verified road or transit item for the same date and place, or a verbatim quote that states it.
  - The deterministic post-check refuses unsupported impact wording (§9.2).

### 6.6 Identity, duplicates and cancellations

- **Item identity key:**
  - venue items: `venue:<id>:<local date>:<normalized event name>`
  - road items: `road:<record id>`
  - transit items: `ttc:<alert id>`
  - project items: `project:<id>:<statement date>`
  - news items: `news:<canonical url>`
- **Cross-source duplicates.** When a news article covers an event that is also in a listing, the verifier merges them into one item. The official or identity source becomes the primary citation, and the news URL may be a second citation on the same item.
- **Shared feed URLs.** Items from the same listing or feed may share one citation URL when their `recordId`s differ. This changes the current "roundup URL shared across items" rule for sources flagged `feed:true` or `listing:true` only (§11).
- **Prior coverage.** An identity key published in an earlier roundup edition is `previously-covered`. It appears only under "Still in effect" if still active, and does not count. A new occurrence date of a recurring event is a new key. Existing daily-news duplicate rules (`matchExistingPost`, `relatedFingerprint`) still apply.
- **Cancellations and reschedules.** Re-fetching at submit revalidates the date and existence. A changed date, "cancelled", "postponed" or a missing record excludes the item, and the pack must be rebuilt.

## 7. Publish rule (`planRoundupV2` in `scripts/news-pilot/roundup.mjs`)

1. **Counted units.**
   - All `concert` items (music or performance listings) at the same `venue:*` in the window collapse into **one** aggregate unit per venue, rendered as one line. Example: "RBC Amphitheatre: Jonas Brothers (Sep 28), Red Clay Strays (Sep 30), …".
   - Every other qualified item is its own unit, after identity dedupe.
   - `previously-covered` items are not units.
2. **Decision.** `publish` iff `units ≥ 3` **and** `coreUnits ≥ 1`. Otherwise `hold`, with reason `below-minimum` or `no-core` and the census.
3. **Cap.** At most 12 units per edition. Order: core first, then roads and transit, then venues, then news and announcements, then "Still in effect" (not numbered and not counted). The copy never claims coverage it does not have.
4. **Same `now` everywhere.** The plan, the writer, submit revalidation and the gate context all use the same `now`. An idempotent replay keeps the original context, as today.

**Expected replay result** (computed from `items.jsonl` under these rules; this is the assertion in A4):

| ISO week | Counted units (core) | Decision | Units |
|---|---|---|---|
| 37 | 6 (1) | publish | Board game night at 40 Hanna (core); TFC and Argos news at BMO Field (2); Coliseum concerts (1 aggregate: Sonu Nigam, Yeat); RBC concerts (1 aggregate); Strachan/Fleet hydro (adjacent road) |
| 38 | 6 (1) | publish | Give Me Liberty at 75 Fraser / Lamport lot (core); Argos vs Elks; Tempo vs Fever and Tempo vs NY Liberty at the Coliseum (2 sports units); Coliseum concerts (1 aggregate: Suki Waterhouse); RBC aggregate |
| 39 | 7 (1) | publish | Liberty Laughs at 65 Jefferson (core); Ontario Line / Exhibition Station; Vintage Show at the QEB; Canada vs Chile; Nations League announcement (news-update); Coliseum concerts (Tove Lo); RBC aggregate |
| 40 | 12 (3), capped from 16 | publish | Core: 34 Hanna open house, the ex-Starbucks at 39 East Liberty, Hanna Ave Bell repair. Roads: King at Strachan, Lake Shore at Newfoundland. Venues: Argos Oct 3, TFC Oct 10, Canada WNT Oct 12 at BMO; Marlies opener plus a concert aggregate at the Coliseum; RBC aggregate; HYROX, Fall Home Show, Fall Baby Show at Enercare. The Winter Fair and Sceptres announcements (news) fall below the cap in §7 order. |

**Fixture split rule.** Backtest rows that bundle several events (for example "Coliseum: Tempo vs Fever, Suki Waterhouse, Tempo vs NY Liberty") are split into one fixture unit per event, typed `sports`, `concert` or `expo`. Concerts are then re-aggregated per venue under rule 1. Every other row is one unit.

The builder recomputes this table from the fixtures and flags any deviation for review; it must not paper over one. The minimum assertion is: **all four weeks `publish`, with units ≥ 3 and core ≥ 1.** Every one of weeks 37–39 has exactly one core unit, so a test pins that removing week 38's Give Me Liberty turns week 38 into a HOLD (`no-core`).

## 8. Evidence snapshots

- Each run writes `snapshots/<sourceId>/<sha256>.{json,html}` under the runner state root: `stateRoot/roundup/<slot>/`. The retained attempt dir `roundup-attempts/<target>-<week>-<digest>` also gets a copy of every snapshot the pack cites.
- **Captured each run:**
  - the full road-restrictions v3 feed
  - the TTC live-alerts JSON
  - every venue listing page
  - the BIA events page
  - watched project pages
- Snapshots are content-addressed, mode 0600, and each run is capped at 25 MB. Retention is 90 days on the VM. They are not published and not sent to Slack.
- **Durable evidence.** The submission `context` stored in Neon records, for each item: `snapshotSha256`, the located record's bounded typed fields (≤4 KB), the quotes, the fetch and verify HTTP codes, and `verifiedAt`. A VM rebuild loses the snapshot files but not the evidence. No migration is needed: `content.submissions.context` already holds the roundup pack.
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
- It may not add facts, numbers, quotes, businesses or links beyond the unit's own evidence.
- It returns JSON: `{intro, units:[{unitId, heading, body}]}`. The deterministic assembler (§9.3) builds the Markdown and citations, so the model never writes URLs.

### 9.2 Two internal review rounds

- **Round 1: fact reviewer**, a separate model call with a separate role prompt. It receives the draft plus the verified units. It returns findings `{unitId, sentence, problem: unsupported|wrong-date|wrong-place|overclaim|missing-attribution, fix}`. The writer revises only the flagged sentences.
- **Round 2: locality and tone reviewer**, a separate call. It checks:
  - "in" vs "near" against the final verdict;
  - impact wording;
  - aggregated concert lines;
  - date wording (actual dates; never "this week" for a roll-forward item);
  - no crime, election or private-individual content;
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
- **Body:** one `## N. <heading>` per counted unit, keeping the existing section and citation machinery, in §7 order.
  - Each section ends with `Source: [<publisher>](<url>)`, with a record label for feeds, e.g. `City of Toronto road restrictions, record Tor-RD042026-1044-5`.
  - "Still in effect" is a trailing unnumbered `### Still in effect` list that is not counted.
- **Feed citation URLs:**
  - Road items cite the City's public road-restrictions page. The v3 feed URL and record ID go in the evidence context, and the ID also goes in the visible label.
  - TTC items cite `https://www.ttc.ca/service-advisories/Service-Changes`, or the alert's own URL if the feed provides one, with the alert ID and retrieval time in the label.
  - The gate reviewer sees the typed record evidence (§9.4), so it can check the visible claim against the record.
- **Output artifacts:** `result.json` gets `{pipeline:'structured-v2', isoWeek, slug, now, packDigest, verifyDigest, decision, units, coreUnits, published, census}`. `pack.json` holds the verified units. The post is appended to `data/posts.json` exactly as today (one new post; the runner validates the identity).

### 9.4 Submit and gate

- **Submit.** `content submit --kind roundup --roundup-out <dir>` runs the §6 verifier **again**. This replaces the v1 whole-excerpt digest comparison in `revalidateRoundupItems`, because feed and listing excerpts change every fetch.
  - The check is per quote and per record: any quote missing, record gone, date changed or locality changed means `ValidationError('roundup source evidence changed or unreachable; rebuild before submit')`.
  - It then re-applies the §7 rule to the revalidated units. A pack that falls below 3/1 is refused.
- **Gate context.** For `kind='roundup'`, `gate.mjs` passes per-unit evidence: verdict, identity label, quotes, typed record fields, actual dates and citation URL.
- **Lenses.** The roundup lenses in `scripts/automation/review-agent.mjs` `LENSES.roundup` add two checks: "near vs in matches each unit's verdict", and "no unsupported impact claims".
- **Unchanged:** threshold ≥8, zero HIGH/CRITICAL, the bounded fixer, deploy and smoke. The fixer sees the same bounded evidence and may not add units or sources.

## 10. Mode, enablement and runner integration

### 10.1 Mode constant (single source of truth)

A new module `scripts/content/roundup-mode.mjs` exports the mode per target:

```js
export const ROUNDUP_PUBLICATION = Object.freeze({ staging: 'structured-v2', production: 'census-only' });
export const ROUNDUP_OPTIONAL_SOURCES = Object.freeze({ instagram: false });
```

- These are compiled code at the pinned SHA. They are **not** environment, request or CLI toggles. Changing either value requires a reviewed PR, and the production value is John's protected action.
- `runner.mjs` loads the constant from the pinned tree through its existing `load()` helper. It removes its own `ROUNDUP_PUBLICATION` and the `legacy-fixture` mode.
- **Allowed modes:** `census-only` (today's behaviour: the v2 pipeline runs with `--dry-run` to produce a census, with no reservation, attempt or submit) and `structured-v2`. Anything else fails closed with `roundup publication disabled`.
- **Staging first.** This PR sets staging to `structured-v2` and leaves production on `census-only`. The `stagingOnly` guards in `JOBS['weekly-roundup']`, `main()` and `launcher.sh` stay until production activation.

### 10.2 CLI boundary

`scripts/content/cli.mjs` replaces the unconditional `submit --kind roundup` refusal with this check. It is applied before the DB is opened, for both the `--kind=roundup` and `--kind roundup` spellings. Submit is allowed only when all three hold:

- `ROUNDUP_PUBLICATION[CONTENT_TARGET] === 'structured-v2'`;
- `result.json.pipeline === 'structured-v2'`;
- `verifyDigest` is present.

Otherwise it refuses with the existing message. The production target therefore keeps refusing roundup submits regardless of which runner or operator invokes it.

### 10.3 Runner flow (`runWeeklyRoundup`)

The flow keeps the existing reservation, attempt, resume, retry, gate settle, finish and release code, which was the "legacy positive path" and now becomes the live path. Changes:

- **Pipeline.** Discovery is `roundup-v2-run.mjs --collect`, replacing `run.mjs`. The writer is `roundup-v2-run.mjs`, replacing `roundup-run.mjs`. The contract is the same (`--run --out --root --now [--dry-run]`), plus `result.pipeline`.
- **Hold under the publish rule.** The result is a non-terminal `roundup-hold` with the reason and a bounded census. The slot is released and no attempt is recorded.
  - When a staging Slack webhook is configured, the runner sends a bounded hold notice: week, units, core units, top reasons, no URLs or evidence text. This reuses the census-hold alert path.
  - Later slots in the week re-collect fresh signals.
  - After the week ends, the unchanged `cadence deadline` emits `WEEKLY_NEWS_MISSED` once.
- **Schedule.** The runner stays on-demand in staging. The cadence schedule (Wednesday primary, Friday recovery, Sunday final) applies when John later authorizes timers. No timer is added by this spec.
- **Environment.** `SOURCE_ENV['weekly-roundup']` becomes `SERPER_API_KEY` plus model keys. `SERPAPI_API_KEY` is dropped.
- **Unchanged:** `validateRoundupOutput` keeps all identity checks (week, slug, one new post, pack digest) and adds `pipeline === 'structured-v2'`, `units ≥ 3`, `coreUnits ≥ 1` and `HEX64 verifyDigest`.

## 11. Module change list (precise)

| Module | Change |
|---|---|
| `scripts/news-pilot/roundup-geo.mjs` (**new**) | Venue registry (IDs, aliases, official domains). Transit route and stop allowlist. Loaders and classifiers for core polygon, address points and segments: `classifyAddress`, `classifySegment`, `classifyVenueName`, `classifyTransitAlert`. |
| `scripts/news-pilot/data/lv-core.geojson`, `lv-address-points.json`, `lv-segments.json` (**new, generated**) | These come from City Centreline and Address Points via `scripts/news-pilot/build-lv-geography.mjs` (**new**, offline, run by hand). The source dataset versions are recorded in the files. |
| `scripts/news-pilot/sources.mjs` | Add `ROUNDUP_SOURCES` (§4.1) and the fixed Serper query set (§4.2). Daily-news `SOURCES` are unchanged. |
| `scripts/news-pilot/fetch.mjs` | Add a robots.txt check with a per-run cache, and a per-host minimum interval. Both are opt-in via options and used by roundup collectors. |
| `scripts/news-pilot/url-guard.mjs` | Add `classifyBlockedResponse(status, body)`, which returns `blocked` for 401/402/403/406/429 and challenge markers. |
| `scripts/news-pilot/roundup-collect.mjs` (**new**) | Per-source collectors that produce `signals.jsonl` and snapshots (§8). |
| `scripts/news-pilot/roundup-reason.mjs` (**new**) | Batched tool-less model call, form schema and validation (§5). |
| `scripts/news-pilot/roundup-verify.mjs` (**new**) | The §6 verifier: quote matching, identity locality, dates, windows, risk, identity dedupe, and `verifyDigest`. It absorbs `verifiedInstant`, `torontoInstant` and `matchingSpan` from `roundup-run.mjs`. |
| `scripts/news-pilot/roundup-write.mjs` (**new**) | Writer, the two review rounds and the deterministic assembly (§9). |
| `scripts/news-pilot/roundup-v2-run.mjs` (**new**) | CLI entry point: `--collect`, and the full run with `--dry-run`. It writes `result.json`, `pack.json`, `verify-report.json` and the posts append. |
| `scripts/news-pilot/roundup.mjs` | Add `planRoundupV2` (§7) and `buildRoundupPostV2` (title, tags, unit sections, still-in-effect). `isoWeekOf` and `roundupSlug` are unchanged. v1 `planRoundup` and `buildRoundupPost` are removed with their callers. |
| `scripts/news-pilot/roundup-evidence.mjs` | Keep `provenPublicationMs`, `sourceSpanProvesTime`, the risk constants and `roundupPackDigest`. Remove the v1 `validateRoundupItem`/`validateRoundupPack`/`revalidateRoundupItems` text-locality path (`scoreLocalRelevance`) together with its tests, once v2 tests replace them. |
| `scripts/news-pilot/roundup-run.mjs` | **Deleted.** It was the v1 free-text cluster writer; its reusable helpers move to `roundup-verify.mjs`. The `legacy-fixture` tests are removed. |
| `scripts/content/roundup-mode.mjs` (**new**) | Per-target mode and optional-source constants (§10.1). |
| `scripts/content/cli.mjs` | Conditional roundup submit boundary (§10.2). |
| `scripts/content/submit.mjs` | `checkRoundupRecord` becomes `checkRoundupRecordV2`: the §7 counts; label `Liberty Village + Exhibition Place this week` (replacing "news roundup"/"weekly update"); near/in wording per verdict; the impact-wording refusal; feed/listing shared-URL exception with distinct record IDs; per-unit citation and date checks (kept). `buildContext`/`submitContent` use the v2 verifier for revalidation (§9.4). `ROUNDUP_REVALIDATE_MAX_AGE_MS` (6 h) is unchanged. |
| `scripts/content/gate.mjs` | Roundup evidence projection: per-unit verdict, identity, quotes and typed fields (§9.4). |
| `scripts/automation/review-agent.mjs` | `LENSES.roundup`: add the two checks from §9.4. The threshold and severity rules are unchanged. |
| `ops/exedev-runner/runner.mjs` | Mode from `roundup-mode.mjs`; v2 pipeline invocation; hold notice; `validateRoundupOutput` additions; `SOURCE_ENV` change; `legacy-fixture` removed (§10). |
| `ops/exedev-runner/README.md` | Rewrite the weekly-roundup bullet for `structured-v2` (staging) and `census-only` (production). |
| `ops/exedev-runner/launcher.sh` | Unchanged (staging-only guard stays). |
| Migrations | **None.** Existing `kind='roundup'`, the cadence tables (0003/0004) and `submissions.context` are sufficient. |
| `docs/specs/content-cadence-adjacent-sources-addendum.md` | Marked **superseded (rejected)** by this spec. Only its impact-wording rule is carried forward (§6.5). |
| `docs/specs/content-cadence-temporal-addendum.md` | For roundups only, superseded by §6.5 windows. The 14-day upcoming rule is kept; the 7-day rolling news window is replaced by the ISO week plus roll-forward. |
| `docs/specs/content-cadence-2026.md` | For roundups only: the one-item "weekly update" and the ≥1-item rule are replaced by §7. Evidence re-fetch is replaced by §6/§9.4. Count, slot, slug, receipts, deadline and alerts are unchanged. |

## 12. Acceptance (observable checks)

Each check produces evidence: a command, its output, and IDs. "Tests green" is necessary but is not sufficient to call this done.

### A1: Locality unit tests (`tests/news-pilot/roundup-geo.test.mjs`)

**Must be core:** 40 Hanna Ave; 65 Jefferson Ave; 171 East Liberty St; 75 Fraser Ave (Lamport); 39 East Liberty St; a Hanna Ave segment Snooker–Liberty road record.

**Must be adjacent:** "BMO Field"; "Coca-Cola Coliseum"; "Enercare Centre"; "Queen Elizabeth Building, Exhibition Place"; "RBC Amphitheatre"; a Strachan Ave at Fleet St record; a King St W at Strachan record; Lake Shore Blvd W at Newfoundland Rd; a 509 alert at Exhibition Loop.

**Must be `not-LV` or `unverifiable` (the mandatory trap tests):**

- **site-nav keyword:** a page whose only "Liberty Village" is in `<nav>`
- **NY Liberty:** "Tempo fall to Liberty"
- **US namesakes:** Hurricane, UT; libertyvillage.org
- **publisher label vs address:** "opening in Liberty Village" with "east side of Strachan south of Wellington"
- **name-only events:** Eco-Fair with no venue; "Fort York – Liberty Village" secret venue
- **Parkdale:** 1205 Queen St W; a "Parkdale issues" page; Temple Ave, Elm Grove, Tyndall
- **bbox:** Joe Shuster Way; Douro St
- **other failures:** bare "Coliseum"; a same-named venue in another city; a whole-route 504 alert with no allowlisted stop; the CP24 city-wide closures page; the Hotel X spa award (agent `not-LV` caps the verdict)
- **agent over-claim:** agent verdict `core` on an item whose identity verdict is adjacent must end adjacent; agent `core` with no identity must end `unverifiable`

### A2: Verifier unit tests (`tests/news-pilot/roundup-verify.test.mjs`)

- A quote present only in nav fails. A quote present only in JSON-LD passes (the blogTO event address pattern).
- A quote from another item's URL is `source-swapped`.
- A date only in Serper metadata is `undated`. A malformed JSON-LD date with a visible dateline uses the dateline.
- A syndicated copy with a foreign canonical is dated from the original. With the original unreachable, it is `unverifiable`.
- A yearless listing row resolves only to a unique date in the window.
- A road record that changed fields between snapshot and re-fetch is excluded. A record absent on re-fetch is excluded.
- 403 with a Cloudflare challenge body is `blocked` → `unverifiable`, with exactly one request made (no retry).
- A robots-disallowed path is never fetched.
- Crime, election, private-individual and development-application forms are refused even when the agent sets no flag.
- Unsupported crowd or closure wording in the draft is refused. With a same-date verified road item, it is accepted.

### A3: Publish-rule tests (`tests/news-pilot/roundup-plan.test.mjs`)

- 3 units, 0 core → hold `no-core`.
- 2 units, 1 core → hold `below-minimum`.
- 6 RBC concerts + 1 core → 2 units → hold.
- 5 concerts at one venue + 1 core + 1 road → 3 units → publish.
- A previously-covered road item appears in "Still in effect" and is not counted.
- A roll-forward news item from the prior held week counts and is labelled with its actual date.
- An idempotent replay keeps the original `now` and slug.

### A4: Backtest replay (`tests/news-pilot/roundup-v2-backtest.eval.mjs`, run in `test:news-pilot`)

**Fixture inputs.** Fixtures live in `tests/fixtures/roundup-v2/backtest/`:

- The 65 forms from `items.jsonl`, used verbatim as the reasoner's replayed output. **No model calls.**
- Per-URL frozen bodies captured by the builder, with fetch time and sha256. Wayback captures are used where the backtest used them.
- Where the original is no longer retrievable (past road-restriction rows, bot-walled pages), a minimal reconstructed body. It contains exactly the backtest's live-verified `evidence_quote` and is marked `reconstructed: true`.
- Bot-walled URLs are represented as 403 challenge responses.

Fixtures prove code paths, not live evidence. The replay runs `verify → plan` with a fixed `now` per week: Wednesday 12:00 UTC of weeks 37–39, and 2026-09-29 for week 40.

**Assertions:**

- Weeks 37, 38, 39 and 40 all decide `publish`, with units and core counts matching the recomputed §7 table.
- Every trap row in `items.jsonl` is excluded with the expected reason class. The trap rows are: TorontoToday stabbing, Tempo/NY Liberty, Toro Toro, Eco-Fair, Don't Tell Comedy, CBC Parkdale, Parkdale Barbers, Joe Shuster Way, Temple Ave, Douro St.
- Every crime, election and weak-source row, every syndicated `stale` row, and every blocked row (TorontoToday, Toronto Life, NOW, Globe) is excluded.
- No Reddit, directory or Ontario Place row is admitted.
- Removing the week-38 Give Me Liberty fixture turns week 38 into `hold`.
- The eval prints a per-week census table, which is kept as evidence.

### A5: Mode and boundary tests

- `roundup-mode.mjs`: staging is `structured-v2` and production is `census-only`.
- The runner in production still refuses as staging-only.
- The runner in `census-only` performs no reservation, attempt or submit, and `data/posts.json` stays byte-identical.
- The CLI refuses `submit --kind roundup` when:
  - the production target is bound;
  - `pipeline` is missing;
  - `verifyDigest` is missing;
  - either spelling of `--kind` is used.
- Submit re-verification refuses a pack whose evidence changed, or that fell below 3/1.
- A hold sends one bounded notice and records no attempt.
- `validateRoundupOutput` rejects `units < 3`, `coreUnits < 1`, and a missing or invalid `verifyDigest`.
- All existing cadence, count, deadline and alert tests stay green: `npm run test:content` against local PG, plus `test:news-pilot` and `test:automation`.

### A6: Live staging publication (required before claiming done)

1. **Env check.** Confirm `SERPER_API_KEY` and a model key are present in `/etc/lv-runner-staging.env` (names only). Confirm `CONTENT_TARGET=staging` and `CONTENT_DB_NAME=lv_staging`.
2. **Dry run.** Run an on-demand staging `weekly-roundup` with the pinned PR SHA and `--dry-run` at the writer. Record `signals.jsonl` counts per source, snapshot digests, `verify-report.json` (admitted/excluded by reason) and the plan decision. **No model output is used without verification.**
3. **Real run.** Run a real on-demand staging `weekly-roundup`. If the plan is `publish`, the evidence is:
   - the submission ID;
   - gate rounds with the real model (not `--script`): overall ≥8, `blocking_count=0`;
   - deploy and smoke passed;
   - `cadence count` shows `roundupCount=1` for the week;
   - the hosted staging alias serves `/blog/liberty-village-news-week-YYYY-wWW` at the published revision, with every citation link resolving.

   Record the URL, the IDs and a safe round summary.
4. **If the live week holds.** That is a correct outcome but **not** acceptance. Re-run on a later slot or week. Never add units, relax the rule or use fixtures to force a publication.
5. **Protected actions.** Production remains `census-only`. Flipping it, lifting `stagingOnly` or adding timers is John's protected action, recommended after two consecutive staging weeks that each publish or honestly hold, with gate PASS on every publication.

### A7: Review

- The spec: an independent exact-hash review of this document before implementation.
- The code: a staging PR from an isolated builder branch; an independent code review by a reviewer whose model differs from the builder's; the canonical exact-head PR gate; then the A6 evidence.

## 13. Right-sizing notes and non-goals

- **No new infrastructure.** There are no new services, queues, DB tables or migrations, and no browser automation. Snapshots are files plus bounded DB context.
- **No paid access or licensing** for bot-walled or paywalled publishers. Whether to license TorontoToday or Toronto Life is an open owner question.
- **No geocoding API.** Locality uses a checked-in, reviewed geography derived once from City open data.
- **No change** to the daily `news` job, the blog cadence, the gate threshold, severity, fixer bounds, deploy or smoke.
- **Hardening only where the backtest failed:** nav stripping, identity locality, page datelines, syndication canonicals, blocked classification, feed snapshots, concert aggregation, and previously-covered road works. Nothing else is added "just in case".

## 14. Open questions for the owner (do not block staging)

1. **Brand fit.** In weeks 37–39 most counted units are stadium and expo items, with one core item each. The ≥1 core rule enforces a local anchor but not a local majority. Is that the intended brand balance? (The title's "+ Exhibition Place" is intended to make this honest.)
2. **Instagram (§4.4).** Include it after the trial reports? If so, via the Business Discovery API or a public scraper?
3. **Bot-walled local coverage.** Should TorontoToday or Toronto Life access be licensed? Their tower stories would be human-only under current policy anyway.
4. **Production activation.** The criterion and timing are John's call (A6.5).
