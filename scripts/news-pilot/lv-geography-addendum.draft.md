# Weekly roundup v2 — geography derivation addendum (DRAFT)

Status: **DRAFT — not accepted.** Intended home: `docs/specs/weekly-roundup-v2-geography-addendum.md`.
The spec-authority runtime refused authorship of `docs/specs/**` for this
builder identity (`MODEL_NOT_ALLOWED: author identity or effort not allowed`),
so the draft lives next to the generator it documents; an enrolled spec author
(the parent session or a planner dispatch) must relocate and enroll it before
it carries any weight. This addendum documents the deterministic derivation
behind `scripts/news-pilot/data/lv-core.geojson`, `lv-address-points.json` and
`lv-segments.json` (committed in the reviewed geography commit f95b625) and the
exact City boundary conflicts the derivation resolves. It requires independent
review and sign-off before any PR depends on it. It does not modify
`docs/specs/weekly-roundup-v2.md` §6.2; where prose and data disagree, both are
recorded below rather than silently reconciled.

## 1. Scope

| File                     | Produced by `build-lv-geography.mjs`   | Reviewed registry (not City-derived)                                |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------- |
| `lv-core.geojson`        | yes — ring from Centreline legs        | —                                                                   |
| `lv-address-points.json` | yes — Address Points inside ring       | —                                                                   |
| `lv-segments.json`       | yes — core rows + 5 adjacent corridors | adjacent corridor Centreline IDs are an explicit reviewed allowlist |
| `lv-venues.json`         | no                                     | yes — official business pages                                       |
| `ig-watch.json`          | no                                     | yes — 2026-09-29 trial-accounts review                              |

## 2. Inputs and reproduction

- City of Toronto **Centreline v2** WGS84 CSV (Open Government Licence –
  Toronto), package `toronto-centreline-tcl`
  (`1d079757-377b-4564-82df-eb5638583bfb`), resource `centreline-version-2-4326.csv`
  (`4dec5884-a5cf-49e7-b562-f835150dc0b1`), downloaded 2026-09-29.
- City of Toronto **Address Points (One Address Repository)** WGS84 CSV,
  package `address-points-municipal-toronto-one-address-repository`
  (`abedd8bc-e3dd-4d45-8e69-79165a76e4fa`), resource `64d4e54b-738f-4cd9-a9e7-8050fac8a52f`,
  downloaded 2026-09-29.

```sh
node scripts/news-pilot/build-lv-geography.mjs \
  --centreline /tmp/lv-geo/centreline-4326.csv \
  --addresses /tmp/lv-geo/address-4326.csv \
  --out DIR          # default writes scripts/news-pilot/data
```

Output (2026-09-29 extract): `ring=43 addresses=381 segments core=55 adjacent=5
douroExcluded=4`, byte-identical (SHA-256) to the committed files:

| File                     | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `lv-core.geojson`        | `85fd57a7d78718cd513c6589d4dc952237befd03520f763c5c03170de165c37c` |
| `lv-address-points.json` | `43f9ad73398e308ac8751cce07d1d61f69dcd64af15f3f0171eff31cf6e3564b` |
| `lv-segments.json`       | `b84261d218016e925e529b48ee9eef517eaf683b44c6d9d9bba1b6347ef37058` |

The generator never reads the committed `data/*.json` files. The independent
read-only checker `scripts/news-pilot/verify-lv-geography.mjs` re-derives the
address set and ring-edge membership from the same CSVs
(`verified ring=43 addressPairs=381 centrelineIds=95 segments=60`).

## 3. Ring derivation

The ring is the closed cycle of four named Centreline legs between
name-derived corner intersections (southernmost node naming both streets):

- **King St W** from King/Dufferin to King/Strachan (north leg, 17 points);
- **Strachan Ave** from King/Strachan to Strachan/C N R (east leg);
- **C N R** rail corridor from Strachan to Dufferin (south leg, single City row
  `60016850`);
- **Dufferin St** from Dufferin/C N R back to King (west leg).

Each leg is a BFS shortest chain over same-name Centreline segments joined by
City intersection IDs. Shared endpoints are de-duplicated by dropping the
incoming row's first point; City rows can differ by sub-centimetre noise at
shared nodes (e.g. Strachan `60006730` ends `…9932792/8829466` while `60006713`
starts `…9932659/891948`), and deterministically keeping the previous row's
endpoint reproduces the committed ring. A leg that does not connect, or a ring
that is not closed and counter-clockwise, fails the run.

## 4. Core segment rule

A Centreline row becomes a **core** segment when its feature is a road feature
(`Local`, `Collector`, `Major/Minor Arterial`, `Laneway`, `Access Road`), its
name does not match `trail|gardiner|ramp`, it is wholly inside the ring
(midpoint strictly inside; first/middle/last samples no further than 12 m
outside), and it is not a boundary road or an A1-excluded street. Endpoint
`fromIntersection`/`toIntersection` lists every other street name at the City
intersection node, sorted.

## 5. Boundary conflicts (the review questions)

1. **Douro St is not-LV although 11 of its address points and 4 of its
   Centreline rows fall inside the ring.** §6.2 prose lists Douro St among
   streets that are "not in the table", yet the committed address table is the
   complete geometric extract (381 pairs, Douro included). The resolution
   shipped here: the table records City geometry as-is; classification applies
   the A1 policy (`roundup-geo.mjs` returns `not-LV`/`a1-douro-policy-exclusion`
   for Douro St before consulting the table, and Douro never appears as a core
   segment). This is a deliberate spec-vs-data conflict that requires the
   independent review this addendum requests.
2. **King St W / Strachan Ave / Dufferin St frontage is adjacent, not core.**
   38 King St W, 6 Strachan Ave and 15 Dufferin St address points lie
   geometrically inside the ring (the ring follows the street centrelines), but
   boundary-frontage addresses classify as `adjacent` and the boundary roads
   never appear as core segments. A single segment with one endpoint at a
   boundary intersection (e.g. King St W at Strachan) is included in the
   adjacent corridors.
3. **Lake Shore Blvd W coverage ends at Newfoundland Rd** because **named
   Dufferin St never meets Lake Shore Blvd W in Centreline** — Dufferin's
   southern chain terminates at Saskatchewan Rd inside Exhibition Place, so the
   corridor's west anchor is the Newfoundland Rd intersection instead.
4. **Exhibition Place internal roads are not yet safe to admit.** South-of-rail
   geometry between the C N R corridor and Lake Shore Blvd W (Princes'
   Boulevard, Manitoba Dr etc.) is deliberately excluded pending a reviewed
   selection; unlisted segments fail closed.
5. **Instagram watch registry: 29 verified handles with 5 explicit exclusions**
   (registry provenance, not City-derived): `kitchenhub` (1108 King St W point
   outside the ring), `louiecoffeeshop` (1187 King St W inside the ring but
   adjacent frontage), `tonton.matcha.coffee` (no verifiable site→handle link),
   `brodflour` (official 8 Pardee Ave has no City address point),
   `DeltaTrainLV` (official 37A Mowat Ave exists only as 37 Mowat Ave in the
   City extract; merging distinct house numbers is not approved).

Related recorded inconsistencies (kept as committed, flagged for review):
Lamport Stadium's spec address 75 Fraser Ave has no City address point (its
City point is 1155 King St W, Allan A. Lamport Stadium Park); Solidarity Way
address points exist inside the ring while the Centreline core segments still
carry Canniff St for that corridor.

## 6. Deterministic fail-closed policy

- Adjacent frontage comes only from the five explicit reviewed corridors
  (Strachan Fleet→King; King Strachan→Dufferin; Lake Shore Strachan→Newfoundland;
  Dufferin King→Saskatchewan; Strachan King→Lake Shore). Geometry is read from
  the City CSV by Centreline ID; a missing ID, a renamed road, a broken chain
  (consecutive rows must share an endpoint) or a corridor end further than
  150 m from the named intersection throws.
- Exact-count guards: exactly four interior Douro St Centreline rows and
  exactly eleven Douro St address points are expected; any other count fails
  the run instead of silently reclassifying.
- Semantic A1 traps: 1205 Queen St W, Temple Ave, Elm Grove Ave, Tyndall Ave
  and Joe Shuster Way must never appear in the address table; boundary roads
  and Douro must never appear as core segments; required core addresses
  (40 Hanna, 65 Jefferson, 171/39 East Liberty) and the Hanna Ave
  Snooker–Liberty core segment must exist.
- Anything else — every unlisted street, venue or account — fails closed to
  `not-LV`/`unverifiable` in `roundup-geo.mjs`; it is never admitted by
  proximity or name similarity.
- Regeneration against a future City extract must be byte-compared with the
  committed files; any delta is a reviewed change, not a silent refresh.
