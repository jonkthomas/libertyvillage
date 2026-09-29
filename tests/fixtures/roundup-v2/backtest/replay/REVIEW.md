# A4 conversion review note (independent reviewer: start here)

This note lets someone other than the builder check provenance of every
fixture without re-running the builder. Spec: `docs/specs/weekly-roundup-v2.md`
sections 7 and A4. Nothing below invents classes: every exclusion reason is
either pinned by A4/section 7 or the backtest row's own label.

## What is committed

- `../reference/items.jsonl` — byte copy of the archived backtest
  `2026-09-29-roundup-backtest/items.jsonl` (65 rows).
- `../reference/ig/ig-items.jsonl`, `../reference/ig/accounts.csv` — byte copies
  of the archived trial files (231 rows, 34 accounts).
- `conversion.jsonl` — line 1 is a header with sha256 of all source archives;
  one line per replay unit: `unitId`, `sourceRow` (1-based `items.jsonl` line,
  or `ig:<line>` into `ig-items.jsonl`), schema-valid `form`, `bodies`,
  verbatim `spans` (UTF-16 offsets into the body file), `unavailable` facts,
  `occurrenceKey`, `expected` class, and `clockFacts`.
- `bodies/<sha>.<ext>` — one file per captured record; the filename is the
  sha256 of its content. 118 units / 118 bodies.

## How to re-verify (no network, no model)

1. `node --test tests/news-pilot/roundup-v2-backtest.eval.mjs` — 10 tests:
   reference hashes, header archive hashes, form schema + body hash + verbatim
   spans for all 118 units, ceiling/floor replay vs the reviewed section 7
   table, IG084 sensitivity, trap-row classes, full-reference exclusion sweep,
   census table.
2. Recompute any hash: `sha256sum tests/fixtures/roundup-v2/backtest/...`
   against the pins in the eval file and the conversion header.
3. Byte-compare references against the archives:
   `cmp tests/fixtures/roundup-v2/backtest/reference/items.jsonl
   <archive>/2026-09-29-roundup-backtest/items.jsonl` (same for the ig files).

## Provenance by group (spot-check one per group, then trust the hashes)

| Units | Body source | Check |
|---|---|---|
| R07a/b, R22a/b/c, R38 | Wayback Coliseum capture 2026-08-28 (row visible text, tag-stripped) | pick a row, `curl` the wayback URL, find `Sep 12, 2026` etc. |
| R08/R24/R39 parts | Wayback RBC captures 08-31 / 09-24, per-event JSON-LD objects | `startDate` + `location.name` in the capture |
| R58 parts | Live RBC page JSON-LD, captured 2026-09-29 | Red Clay Sep 30, Dan+Shay Oct 1, Foster Oct 3 |
| R55/R56a/b, R57a/R57b | Live BMO / Coliseum listing rows, captured 2026-09-29 | `Oct 03` + `at 3:00 PM` etc.; BMO rows are yearless and resolve per 6.4 venue-row rule (recorded in `clockFacts`) |
| R09/R52/R53/R54 | Live City road-restrictions v3 feed, one record JSON each, captured 2026-09-29 | record ids Tor-RD042026-1044-5, Tor-RD1S2026-975, Tor-RD52026-5103, Tor-RD022026-193-1 |
| R37 | Live Canada Soccer page, captured 2026-09-29 (two records: header + article) | visible `<time>24/09/2026</time>` + `article:published_time` 2026-09-24 (fact (ii) VERIFIES) |
| R50 | Live City park page: `Date: October 3, 2026 / Time: Noon to 4 p.m.` + 171 East Liberty St | same section of the page |
| R20 | Live BIA events page: `Thursday, September 17th, 2026` + Lamport lot 75 Fraser Ave | `capturedAfterClock`, backtest week, future event |
| R59a/b/c | Archive fallback: backtest `evidence_quote` (live page is a JS shell) | `unavailable: ['record-text']` |
| IG084/069/065/193/214/215 | Raw captions from `owned-posts.json` (byte-identical), IG214 Oct-3 block split at blank lines | compare against archive by shortcode |
| IG excluded (28 lines) | Raw caption, or provider `alt` when the caption is empty (IG034, IG132) | `unavailable` lists the missing fact |
| News excluded (46 lines) | Backtest `evidence_quote` + `verified_at`/`verify_http` provenance | `R05/R06/R36` datelines re-verified live (Sep 10 / Sep 12 / Sep 27) and recorded |

Raw Apify dumps and images were never committed (only shortcode, timestamp,
owner, caption text/alt, and spans).

## Captured vs missing evidence

- Captured: everything in the table above, including the deciding R37
  dateline (fact (ii) verifies: ceiling holds) and all four road records.
- Missing (listed in `unavailable`, units excluded, table updated — nothing
  relaxed): R61 dateline (see below); R59 record text (JS shell); R12/R13
  quotes (truncated `article_` URLs); image-only IG dates (IG034/099/100);
  IG132 record (empty caption).

## Honest differences from the printed spec table / backtest labels

1. **R61 is `undated`, not ceiling-eligible.** The served PWHL HTML has no
   visible dateline (empty `<time dateTime>`, no JSON-LD/meta date). Per 6.4
   that is not dateline evidence. W40 ceiling is therefore **15 (4/3)**,
   not 16 — decision unchanged (publish, cap 12, cuts R57b/R56a/R56b).
2. **R64 `stale` (backtest) → `not-LV`** (segment table; A4 trap list).
3. **R35 `duplicate` (backtest) → `undated`** (A4).
4. **R11 `unverifiable` (backtest) → `blocked`** (A4; NOW 403 like TorontoToday/Life).
5. **R52 verdict is `core`** (Hanna Ave Snooker→Liberty is a core segment),
   making it W40's third anchor alongside R50 and IG214.
6. **IG entry weeks follow first-available-clock**, not the trial's `week`
   field: IG065 38→37 (posted Sep 4), IG193 40→39 (posted Sep 24; the trial
   labeled the event week). Recorded in `clockFacts.entryRule`.
7. **Watch-list address notes:** Burger Drops converts at 116 Atlantic Ave
   (official site; the audit still shows the stale 171 E Liberty #129 —
   the spec's own correction). F45 audit shows `17 East Liberty St`
   (likely typo for 171); its only unit (IG124) is retrospective-excluded.
8. **A4 pins Star/CBC game recaps (R06/R21/R36) as `weak-source`** although
   4.1 tiers list thestar.com/cbc.ca as `reputable`. Converted per A4;
   flagging the tension for the code reviewer (single-publisher reports
   under the inherited 6.7 rule is the likely reading).

## Known limits of this replay

- The eval's verify→plan is a deterministic local implementation of the
  section 6/7 rules operating on the reviewed conversion. The real
  `roundup-verify.mjs` / `planRoundupV2` do not exist yet (spec is draft);
  the eval probes for them and reports `pending-integration` until they
  land (A7), at which point it must invoke them instead.
- Only records corresponding to a reference row are converted; anything
  else in the frozen bodies is out of scope, which can only undercount.
- No model calls anywhere: forms are the builder's transcription of the
  captured records into the section 5 shape, every span machine-checked.
