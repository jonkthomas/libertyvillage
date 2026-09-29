# A4 backtest replay: real-body, one-pool review notes

**Status: A4 is NOT complete.** The replay now runs end to end on production
record extraction and the §7 one-pool availability rule. The observed table
**diverges** from the approved §7 table in every week (below). This change
does not tune counts to close that gap. Closing it needs owner rulings and
product/registry gaps fixed outside this fixture scope.

Eval: `tests/news-pilot/roundup-v2-backtest.eval.mjs`. Builder:
`tools/rebuild-conversion.mjs` (deterministic and idempotent; it reads the
product extractor from `scripts/news-pilot`).

## What changed from the provisional 14/14

| Provisional seam (Astra A4 recheck) | Now |
|---|---|
| `recordExtractor` injected; records assembled from fixture spans | Removed. `verifyRoundupForms` imports its own `roundup-records.mjs`. The harness asserts that no `recordExtractor` or `recordTools` is passed. |
| `URL_TEXT` concatenated per-unit fragments and snapshots | The fetcher is read-only. For each unit it serves **one** body: the full raw capture that the §7 rule selects for that clock, or the unit's own frozen fragment (negative controls only). It never concatenates. |
| Single-week `gatePass` (week === assigned week) | §7 one pool. IG is available from its provider timestamp and news from its dateline. A listing, feed, org or project record comes from the **latest capture at or before the clock**. An after-clock capture is used only in the unit's assigned week, only for events starting after the clock, and is labelled `capturedAfterClock`. Held weeks roll everything forward, and published `roundupCoverage` keys drop out of later weeks. |
| Fixture record ids and hand-parsed typed fields | The production `extractRoundupRecords` derives record ids, typed snapshots and spans on the unit's bound body. The spans are offsets into `normalizeRecordText(record.text)`. |
| Feed `createdTime` | Informational only. It is never used for availability. |

## Committed evidence

- `captures/` + `captures.json`: 12 full raw captures, copied byte for byte
  and content-addressed by sha256. The manifest records the canonical URL,
  registry source, bytes, capture instant and its basis, and the origin path
  and mtime.
  - Wayback (instant embedded in the response and asserted by the eval):
    Coliseum 2026-08-28T23:47:34Z; RBC 2026-08-31T20:43:27Z; RBC
    2026-09-24T17:35:55Z.
  - Live (instant **declared** by the prior conversion; there is no capture
    log): road-restrictions v3, BIA events, 34 Hanna park, BMO Field,
    Coliseum, RBC, ExPlace, PWHL R61 and Canada Soccer R37. These are
    declared 2026-09-29T18:30Z (ExPlace 19:39:59Z); file mtimes are
    18:14–18:16Z. Every live instant is after every replay clock. None is
    upgraded to a pre-clock snapshot.
- `ig-posts.jsonl`: 32 minimal provider rows (`shortCode`,
  `ownerUsername`, `timestamp`, `type`, raw `caption` with line breaks,
  `captionSha256`, `archiveFile`). No raw dump and no images. They were
  cross-checked against the archive at
  `lib_village/.state/archive/2026-09-29-ig-trial` (all 8 archive pins
  match; run with `RV_IG_ARCHIVE=<path>`).
- `bodies/`: only the 43 frozen fragments for rows that were **never** fully
  captured remain (news/trap rows). Each is labelled
  `bodyKind: fragment` / `unavailable: record-text-fragment`. The eval
  asserts that no eligible unit rests on a fragment.

## F1–F4 disposition

- **F1 (quotes).** Every eligible unit's record is the production record
  on its bound full body. A quote is kept verbatim when it is contiguous
  in the normalized record. It is re-derived only when the same word tokens
  are contiguous with different punctuation or zero-padding. The prior
  fragment-derived quote is preserved in `recordBinding.quoteNotes`.
  Otherwise it is left as is and listed in `unavailable`.
  - Re-derived: R22a/b/c, R07a/b and R38 (`Friday / Sep 18 , 2026` →
    `Friday | Sep 18, 2026`); R57a/b-i/b-ii (`Saturday / Oct 03 , 2026` →
    `Saturday | Oct 3, 2026`, the row's own rendering, not the hero block's
    `03`); R20 and R50 place quotes.
  - Five IG trap rows (IG042x, IG102x, IG119x, IG133x, IG157x) carry reviewer
    subject paraphrases that are not in their caption. They bind to the
    caption's sole record with `subject` unavailable and fail
    `source-swapped`.
  - Captions that yield no production record (no resolvable date, or two
    dates in one block) are `recordBinding.recordId: null` with `record`
    unavailable. No fixture id is passed off as a record.
- **F2 (URLs).** Evidence URLs are canonical https source URLs. Wayback URLs
  appear only in `captures.json`. R40x and R41x keep `repo:` URLs (directory
  controls; they fail `source-swapped`).
- **F3 (R59).** The production extractor on the committed ExPlace capture
  emits `row:7c5442…`, `row:40f104…` and `row:3fdaa0…`. The eval asserts
  them. R59a's stale "JS shell" relevance reason is corrected. The identity
  key is still `grounds:exhibition-place` (product geography; not
  reviewed here). R59c is held `duplicate-ambiguous` against R59b by the
  planner.
- **F4 (R37).** The header now says `unresolvedFact.status: "unavailable"`.
  The only capture is the 2026-09-29 revision (`dateModified`
  2026-09-28T13:38:52Z).
  - Its visible `<time>24/09/2026</time>` is in the subject's own section
    record (`sec:88d349…`), and the eval now cites that instead of
    serialized JSON-LD.
  - It stays unavailable for two reasons: no capture at or before the W39
    clocks exists, and the product date grammar does not resolve
    DD/MM/YYYY.
  - Result: the verifier says `undated` in the ceiling and `unverifiable`
    in the floor, where the date is nulled.

## Measured table (integration-free, offline; identical on fc05041 and 54ad222)

Real `verifyRoundupForms` → `planRoundupV2`, production extractor, one pool
in sequence. Census digests are identical with product trees at `fc05041`
(this branch base) and `54ad222` (the geo "bare offsite mention" fix, run
through `RV_PRODUCT_DIR` against an exported read-only tree).

| Week | Slot | Ceiling | Floor | Approved §7 (ceiling / floor) |
|---|---|---|---|---|
| 37 | Wed 09-09 | HOLD 4 (0/0) no-core | HOLD 4 (0/0) no-core | **publish 8 (3/1)** / same |
| 37 | Fri 09-11 | HOLD 3 (0/0) no-core | HOLD 3 (0/0) no-core | — |
| 37 | Sun 09-13 | HOLD 3 (0/0) no-core | HOLD 3 (0/0) no-core | — |
| 38 | Wed 09-16 | **PUBLISH 4 (1/1)** | **PUBLISH 4 (1/1)** | HOLD below-minimum 2 (1/1) / same |
| 39 | Wed 09-23 | HOLD 2 (0/0) below-min+no-core | HOLD 2 (0/0) | — |
| 39 | Fri 09-25 | HOLD 2 (0/0) | HOLD 2 (0/0) | **publish 3 (1/1)** / HOLD 2 (1/1) |
| 39 | Sun 09-27 | HOLD 2 (0/0) | HOLD 2 (0/0) | — / HOLD 2 (1/1) |
| 40 | Tue 09-29 15:00Z | PUBLISH 8 (1/1), no cap cut | PUBLISH 8 (1/1), no cap cut | publish 16 (4/3) → cap 12 / 15 (5/4) → cap 12 |

Counted units (ceiling):

- **W37 Wed:** R09 (`capturedAfterClock`: starts 09-10 11:00Z, after the
  clock); the Coliseum aggregate R07a+R07b+R22b; R22a; R22c.
- **W38 Wed:** R20 (core anchor, `capturedAfterClock`); R22a, R22c and the
  R22b+R38 Coliseum aggregate. The Aug 28 captures roll forward because
  W37 held.
- **W39:** R57a and R57b-i (plus R57b-ii aggregated at Sun). These rows
  were already in the **2026-08-28 Wayback** Coliseum capture, so the
  record rule makes them available before the clock. R38 is
  `previously-covered` at Wed.
- **W40:** R50 (core anchor); R59a; R59b; R55; R57a; the R57b-i+R57b-ii
  aggregate; R56a; R56b. R59c is held `duplicate-ambiguous`.

The floor matches except that R22b, R57b-ii, R59c and R61 are removed and
R37's date is nulled.

## Divergences from the approved §7 table (reported, not tuned)

1. **W37 holds (no core).** No IG unit verifies:
   - **IG065 (Oxygen Yoga "Sculpt It"):** `unverifiable`. fc05041's
     locative fail-closed rule (`statedOtherPlace` → `other-place-stated`)
     fires on caption phrases such as "to a delicious post-workout snack"
     and "on the mat". This is the fixture the parent integration saw drop
     W37 from [5,1,0] to [4,0,0]. That drop already reproduces at fc05041
     with the old provisional eval (4 failures, the same ones as at
     54ad222). It is a product-rule outcome, not a fixture defect.
   - **IG069 (NRG Haus):** `unverifiable`. `📍 NRG Haus` does not resolve
     to the account's venue (the known alias gap). `statedOtherPlace` also
     returns `other-place-stated` on this caption. The exact branch was not
     isolated.
   - **IG084 (Eco-Fair):** `unverifiable`. The account is
     `requiresVenueInPost`, and "Liberty Village Park" does not classify
     (the U1 Toronto-context gap, already known).
   - The RBC JSON-LD rows (R08/R24/R39/R58) are all `unverifiable`
     (one-word `Lakeshore`, a known registry/geo gap). R38 is
     `outside-window` at Wed (09-23 20:00 is more than 14 days out).
2. **W38 publishes instead of holding.**
   - The approved table assumed W37 published and covered R22a/R22c.
   - Under the one-pool rule, the Aug 28 Coliseum rows remain available
     and uncovered. With R20 as anchor, W38 Wed reaches 4 (1/1).
   - This is the Astra-predicted consequence. It depends on divergence 1.
3. **W39 holds without any core.**
   - R39 is `unverifiable` (Lakeshore).
   - IG193 is `undated`: the verifier's `resolvedDates` has no day-first
     grammar for "Saturday 3 October", even though the record extractor
     does.
   - R37 is `undated` (F4).
   - The two W39 units are R57a/R57b-i, from the Aug 28 capture.
4. **W40 publishes 8 (1/1), not 12 after the cap.**
   - **R52, R53 and R54 are not admitted.** They exist only in the
     2026-09-29 18:30Z roads capture, which is after the clock, and their
     restrictions started before the 15:00Z clock: R52 09-28 13:00Z, R53
     09-28 12:00Z, R54 09-29 14:00Z. The after-clock exception is limited
     to "events after the clock", and an **owner ruling** is required
     before restrictions that started earlier can be treated as future
     events.
   - IG214 and IG215 are `unverifiable`. IG215 has the known QUEST
     registry gap, and `statedOtherPlace` also fires on it ("at the Creative
     Lab"). IG214's stated address classifies core
     (`addr:116-atlantic-ave`), so its exclusion branch is **not isolated**
     and needs a verifier-side trace. IG193 is `undated`.
   - R58 is `unverifiable` (Lakeshore). R56a/R56b count; there is no cap
     cut.
5. **Trap and lead rows.** None is ever counted in any slot or scenario
   (asserted). Their verifier reasons are mostly `unverifiable` or
   `source-swapped`, not the reviewed classes (for example R01x
   `unverifiable`, not `weak-source`). The eval prints the reasons but does
   not pin reason classes, because fragment bodies and record-less captions
   are not a faithful basis for them. See the ceiling gap below.

## Remaining blockers and the honest ceiling gap

- **Owner rulings needed:**
  - Whether an after-clock-captured **road restriction** that started
    before the clock (R52, R53, R54) may use the §7 after-clock exception.
  - Whether R37's (ii) can be accepted from the post-cutoff revision under
    §6.4.
  - Whether the §7 table should be re-reviewed now that the one-pool rule
    makes Aug 28 Coliseum rows available through W39.
- **Product/registry gaps (outside this scope; no product source edited):**
  - the `Lakeshore` street grammar (all RBC rows);
  - the `NRG Haus` alias;
  - QUEST `registryVenueId`;
  - the verifier's day-first date grammar (IG193);
  - the fail-closed locative rule catching non-place prepositional phrases
    (IG065 is confirmed; IG069 and IG215 also trip it). The owner should
    confirm this is the intended trade-off;
  - `deltatrainlv` missing from the watch list (IG200x/IG132x).
- **Historical proof unavailable:**
  - R37's page as it stood at or before 2026-09-25;
  - independent capture logs for the live captures, so their instants stay
    declared and after every clock;
  - full bodies for 43 news/trap rows (fragments only);
  - R61's visible dateline (the capture has an empty `<time dateTime>`).
- **Not asserted as A4 acceptance:**
  - the §7 per-week decisions and counts, which diverge as listed above;
  - the IG084-removal sensitivity, which is vacuous because W37 holds
    without IG084;
  - exact trap reason classes.

## Checks

- `node --test tests/news-pilot/roundup-v2-backtest.eval.mjs`: 13/13
  pass. These are invariants: pins, capture provenance, IG row minimality,
  production-record binding, §7 availability, the publish rule, cap and
  coverage, no trap admission, and verifier-injection integrity. The census
  is printed.
- The same eval with `RV_PRODUCT_DIR` set to a 54ad222 tree: 13/13, with
  identical census digests.
- `npm run test:news-pilot`: 223/223.
