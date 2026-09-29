# A4 backtest replay — review notes (independent Fable recheck F1–F4)

Eval: `tests/news-pilot/roundup-v2-backtest.eval.mjs`. Reference pins and the
schema test live in the eval file itself. This note records fixture
provenance, honest divergences, and open product gaps. Nothing here is
tuned to a table: pins assert observed product behavior on the integrated
stack (integration HEAD `36781bb` at time of writing).

## Product stack under test

`verifyRoundupForms` + `planRoundupV2` + `roundup-geo.mjs` classifiers +
`ROUNDUP_SOURCES` + `ROUNDUP_PUBLISHER_TIERS`, resolved from the product
directory itself (`RV_PRODUCT_DIR` override for validation checkouts).
Remaining test seams: `fetcher` serves frozen bodies by URL (no network);
`recordExtractor` returns the reviewed record for a recordId (TEMPORARY —
most frozen bodies are tag-stripped fragments the real extractor cannot
segment; a body-refreeze round is needed before wiring the real
`roundup-records.mjs`); `signal.post` carries pinned trial provider rows.

## Honest table (integration HEAD 36781bb)

- W37: HOLD 5 (1 core / 0 anchor), no-core. Counted: IG065 (class), R09,
  Coliseum aggregate, 2× Tempo.
- W38: HOLD below-minimum every slot (Wed 2/1/1 R20+Tove Lo; Fri/Sun
  1/0/0 Tove Lo). An earlier eval revision PUBLISHED W38 by rolling
  W37's Tempo games forward; that held-roll was a harness invention with
  no basis in the trial (each row has exactly one evidence week) and is
  removed. Single-week pools reproduce the approved HOLD shape.
- W39: HOLD 0/0/0 all slots, below-minimum.
- W40: PUBLISH 12 (3/3). Anchors: IG214, R50, +1. R59c held
  duplicate-ambiguous vs R59b. No cap cut.
- Ceiling and floor scenarios agree exactly (R37 undated-by-construction).

## A4 blocker: production record extraction (measured, not complete)

The 14/14 green runs with the `recordExtractor` seam: frozen bodies are
mostly tag-stripped fragments the real `extractRoundupRecords` cannot
segment, so record identity still comes from reviewed span bindings
(pinned, machine-checked). A spike running the production extractor over
all 118 frozen bodies (integration HEAD, `post: null`) produced:

- `ig-post`: 0/31 (needs the provider row; passing `post` through is
  feasible without refreeze — not yet wired).
- `html-page` (R20/R50): 1 section each, but `sec:` ids differ from
  fixture ids (adoptable without refreeze — not yet wired).
- `json-feed` 0/7, `html-listing` 0/15, `jsonld-event` 0/16,
  `serper-news` fragment-sections with non-matching ids: these need
  refrozen full bodies (live feeds/pages now, or wayback HTML) plus
  re-derived quotes/spans before the production extractor can be wired.
  Until that round lands, item-bound record verification is NOT fully
  real — the green run must not be read as complete A4 acceptance.

## F1 — quotes

All eligible-unit quotes are contiguous-verbatim spans of the frozen bodies
(machine-checked with the verifier's norm, case-sensitive). Place quotes
were extended to bindable spans carrying the subject or date (product
`classifySectionPlace` rule): IG084/IG074x/IG214/IG215/R20/R50. Excluded
rows keep reviewer-substance labels; where the real reason differs by
rule-ordering the eval asserts the real reason.

## F2 — evidence URLs

`form.evidence[].url` values are canonical https source URLs (no Wayback
hosts). Wayback URLs appear only inside `bodies[]` for provenance.
R59 bodies use the registry final URL `https://www.explace.on.ca/event/`.

## F3 — R59 Enercare rows (re-captured 2026-09-29)

R59a/b/c now freeze genuine per-event `card-events` rows from the live
listing page (tag-stripped per the R56a convention): HYROX (Oct 1–4),
Fall Home Show (Oct 2–4), Baby Show (Oct 2–4), all Enercare Centre.
RecordIds are product `rid('row', 'rv2-explace', …)` values verified
byte-identical against the real extractor run on the live page
(`row:7c54…`, `row:40f1…`, `row:3fda…`). R59b/c share a venue-day key, so
the planner holds R59c duplicate-ambiguous — the Fable "hold" outcome via
mechanism, asserted in the eval.

## F4 — R37 dateline UNPROVEN

The DD/MM/YYYY dateline visible in the canonical URL slug has NOT been
proven: no same-record capture shows it, the JSON-LD `datePublished`
violates the §6.1 same-record rule, and the frozen revision post-dates the
backtest clock. R37 is `undated` in both scenarios. Owner ruling or a
≤2026-09-25 capture is still needed. (Fable's cite for the printed table's
predated fact cannot be admitted as evidence.)

## F5 — R61

Excluded by review (no full head/main freeze; unfalsifiable either way).
Decision-neutral. Note: under the real stack the recorded reason is
`unverifiable` (identity precedes temporal; with no place evidence
`undated` is unreachable), asserted as such.

## F6 — availability guard and record timestamps

The replay uses the owner-approved A4 capture-time availability guard
(live/archive after-clock bodies pin to their backtest week). The
alternative record-metadata signal is recorded here and NOT used:
`feedCreatedTime`/`feedUpdatedTime` in each feed unit's clockFacts —
R09 2026-09-09T19:18:16Z, R52 2026-09-23T14:35:40Z, R53
2026-09-18T19:02:56Z, R54 2026-09-25T15:29:06Z (created == updated in all
four). Under a createdTime rule W38/W39 would publish early; the guard
holds them. R39 wayback bodies are flagged `capturedAfterClock` (captured
2026-09-24, after the W39 Wed clock; decision-neutral, label-only).

## F7 — identity keys

Fixture `occurrenceKey` values are the product-emitted `identityKey`s
observed in solo verification runs (road `road:<feed-id>`,
`news:<canonical-url>`, venue-day `occ:<addr|grounds>:<date>:<time>`).
Units that never verify keep their reviewed intended keys. Coverage and
dedupe run on product keys end-to-end (see W37 coverage keys in test
output); fixture keys are metadata.

## F8 — trap rows

R44x/R03x/R23x/R65x carry live re-captured bodies (2026-09-29) with real
records. Remaining provenance stubs are explicit (`unavailable` lists) and
fail closed.

## F9 — reason classes

`expected.class` uses A4 vocabulary only: crime/election rows are `risky`
(R04x, R42x); walled/Globe rows are `unverifiable`; no `blocked`/`late`
labels remain. Real verifier reasons are asserted separately and may
differ by rule-ordering (documented per row in the eval).

## F10 — recordIds

R59 rows carry reproducible product `rid()` ids (above). Older span ids
are opaque but pinned (body-hash filenames, machine-checked resolution);
they retire with the recordExtractor seam when bodies are refrozen as
full pages.

## F11/F12 — labels

R39 `capturedAfterClock` corrected. IG215 fails honestly (QUEST
`registryVenueId` gap, below) — no locality claim is made for it.

## Open product gaps (geo/registry worker, NOT fixture-fixable)

1. `NRG Haus` alias missing → IG069 + IG193 `unverifiable` (U3 also
   refuses the null-fallback). Mirrors the QUEST alias fix pattern.
2. Street grammar lacks one-word `Lakeshore` (RBC's own JSON-LD spelling)
   → all RBC jsonld rows `unverifiable` (`stated-address-unverified`).
3. QUEST XO lacks `registryVenueId` → IG215 filtered before
   classification (`place-not-classifiable`).
4. Watch list lacks `deltatrainlv` → IG200x/IG132x `unverifiable`
   (source-missing). Louie was added and resolves.
5. Deliberate product rules, recorded not contested: U1 (prose venues
   need Toronto context — IG084/IG074x/IG117 captions lack it), U3
   (null-place fallback refuses other-place captions), venueToronto
   context for quote-only venue matches, case-sensitive quote norm.

## Unavailable rows (fail-closed)

R59c was un-held after genuine capture and is now mechanism-held
(ambiguous). R61 excluded-by-review. No fabricated bodies or quotes
anywhere in this round; every new span is asserted contiguous-verbatim
at write time.
