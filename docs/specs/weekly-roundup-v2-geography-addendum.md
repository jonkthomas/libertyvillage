# Weekly roundup v2 — City geography derivation addendum (DRAFT)

**Not accepted until independent review of this exact content.** This addendum records the City data and policy conflicts discovered while implementing §6.2 of `weekly-roundup-v2.md`. It narrows uncertain coverage rather than claiming unreviewed streets are local. The approved spec's publisher, temporal and publication rules do not change.

## Inputs and reproducibility

The 2026-09-29 City of Toronto WGS84 CSV extracts are Toronto Centreline v2 (package `toronto-centreline-tcl`, resource `4dec5884-a5cf-49e7-b562-f835150dc0b1`) and One Address Repository (package `address-points-municipal-toronto-one-address-repository`, resource `64d4e54b-738f-4cd9-a9e7-8050fac8a52f`), under the Open Government Licence – Toronto.

```sh
node scripts/news-pilot/build-lv-geography.mjs \
  --centreline /tmp/lv-geo/centreline-4326.csv \
  --addresses /tmp/lv-geo/address-4326.csv --out DIR
```

The generator reads the City CSVs, **not** the committed JSON, and produces the same bytes as the committed files in `scripts/news-pilot/data/` (run twice). Output: 43 ring vertices, 381 address pairs, 55 core road segments, five reviewed adjacent corridors; four interior Douro segments excluded by policy. SHA-256: `lv-core.geojson` `85fd57a7d78718cd513c6589d4dc952237befd03520f763c5c03170de165c37c`; `lv-address-points.json` `43f9ad73398e308ac8751cce07d1d61f69dcd64af15f3f0171eff31cf6e3564b`; `lv-segments.json` `b84261d218016e925e529b48ee9eef517eaf683b44c6d9d9bba1b6347ef37058`. `verify-lv-geography.mjs` independently checks the generated ring, all 381 addresses and 60 segment rows against the same CSVs.

The ring follows shortest connected City Centreline chains by intersection ID: King St W from Dufferin to Strachan (north), Strachan to C N R (east), C N R to Dufferin (south), Dufferin to King (west). It is closed counter-clockwise. Joined rows can disagree at sub-centimetre precision, so the previous row's shared endpoint wins deterministically. Core roads have a qualifying road feature, lie wholly within the ring (no sampled point more than 12 m outside), and are neither boundary roads nor A1-excluded Douro. The five adjacent corridors use **explicit reviewed Centreline IDs**; geometry and intersection chains must match the named anchors, rather than a broad south-of-rail bounding box. A missing ID or broken chain fails regeneration. A future City extract changing output requires review, not silent regeneration.

## Boundary findings and resolved behavior

1. **Douro St is not-LV even though City geometry puts eleven address points and four Centreline rows inside the ring.** The approved §6.2 explicitly names Douro as not-LV; its statement that Douro is absent from the table conflicts with the complete geometric extract. Preserve the eleven City points for provenance but `classifyAddress` returns `not-LV` before table lookup and the four road rows never become core segments. The generator asserts those exact counts and fails if they change.
2. **King St W, Strachan Ave and Dufferin St boundary frontage is adjacent, never core.** The polygon follows street centrelines and therefore includes 38 King, six Strachan and 15 Dufferin address points. `classifyAddress` overrides those geometrically included points to adjacent; road segments on the boundary are listed only in reviewed adjacent corridors. The King/Strachan boundary endpoint is positive under the A1 test; King frontage must not qualify an Instagram handle as core.
3. **Lake Shore Blvd W reaches Newfoundland Rd, not Dufferin St.** Named Dufferin St does not meet Lake Shore Blvd W in this Centreline extract: its southern chain ends at Saskatchewan Rd. The reviewed positive frontage segments are Strachan Fleet→King, King Strachan→Dufferin, Lake Shore Strachan→Newfoundland, Dufferin King→Saskatchewan, and Strachan King→Lake Shore. Beyond those exact City paths, `classifySegment` fails closed, even where the original prose described a longer corridor.
4. **Exhibition Place internal roads are unresolved and excluded.** An unreviewed south-of-rail shape also catches Stadium Rd, Fort York Blvd, Queens Quay W and Fleet St outside the intended area. No internal road is admitted on proximity alone. A future PR must review exact City segment IDs and A1 positives before enabling those roads.
5. **Instagram watch is 29 verified core handles, five excluded.** `ig-watch.json` records each site-to-handle and address verification, cap 29 with an absolute maximum 34: `kitchenhub` (1108 King outside polygon); `louiecoffeeshop` (1187 King adjacent frontage); `tonton.matcha.coffee` (site does not verify the handle); `brodflour` (8 Pardee has no City point); `DeltaTrainLV` (site gives 37A Mowat but City has 37 only; do not equate distinct house numbers). Absence is not a claim that an account has moved.

Related known City-data limitations: 75 Fraser Ave (Lamport Stadium) has no Address Points row; the named stadium is a separately reviewed core venue, while City's Allan A. Lamport Stadium Park point is 1155 King St W. Solidarity Way address points lie within the ring while the corresponding Centreline segments still say Canniff St. Neither mismatch authorizes a fuzzy address match.

## Admission and review consequences

The complete address table remains an auditable City extract, **not** a standalone positive locality test. Trusted Toronto context, exact number+street, boundary override, explicit Douro exclusion, own-venue relation and same-item evidence still apply. Road restrictions require an exact reviewed segment and both matching intersections; coordinates only reject contradictions >150 m. Missing/ambiguous locations remain `unverifiable` or `not-LV`. No unreviewed Exhibition Place internal road or excluded watch handle can count toward the 3/1 publish minimum. Tests cover the named positive and negative A1 traps. This documented narrowing requires independent review of the actual geometry/data and contract impact before PR readiness.
