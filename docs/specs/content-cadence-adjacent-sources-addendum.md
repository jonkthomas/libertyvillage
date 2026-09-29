# Weekly neighbourhood roundup — adjacent resident-impact sources (addendum)

Date: 2026-09-29. Parent-authorized staging default, **pending John's confirmation before production activation**. Depends on `docs/specs/content-cadence-2026.md` at SHA256 `005c3eda40d71b89858c0422905b51cd2c37937ecbd7f69e5d9ba197de9f8759` and its independently approved temporal addendum `docs/specs/content-cadence-temporal-addendum.md` at SHA256 `fcdb21656141ffc009e7a9e187e44dfdff367f72ac3711d194accdce8c8d52d2`. This addendum changes **roundup locality and discovery sources only**. It does not weaken per-item year-bearing date/time passage, seven-day news or fourteen-day upcoming-event window, source reachability and immediate refetch, duplicate/risk refusal, human-only crime/safety/civic-controversy/development-application policy, one-item honesty, zero-item retryable hold, score ≥8 with zero HIGH or CRITICAL, ISO week fence, deploy/smoke or protected actions. No production timer, migration, publication or merge is authorized.

## Bounded locality

An item is neighbourhood-relevant only when its own captured supporting passage names one of these places. Nothing else widens locality.

- **LV core** (unchanged): an address or landmark in Liberty Village, e.g. Hanna, Atlantic, Liberty, East Liberty, Jefferson, Mowat, Fraser, Pirandello, Ordnance, Lynn Williams, Western Battery, Lamport Stadium, or an explicit "Liberty Village" mention.
- **Adjacent venues**: Exhibition Place (including Enercare Centre and Beanfield Centre), BMO Field, Coca-Cola Coliseum, Ontario Place (including events at Ontario Place itself, not only its Budweiser Stage), and Budweiser Stage at Ontario Place. The full venue name must appear in the passage, together with Exhibition Place, Ontario Place or Toronto, or on that venue's official domain. A bare "Coliseum", "Stage" or "Ontario" match, a same-named venue elsewhere, or a city-wide listing fails.
- **Approach corridors**: King St W between Strachan Ave and Dufferin St (house numbers ≤1150, matching `kingStWestMaxNumber`); Strachan Ave and Dufferin St between King St W and Exhibition Place/Lake Shore Blvd W. Other streets, or a corridor record whose location falls outside those limits, fail. Lake Shore/Gardiner items qualify only when the official advisory itself names Exhibition Place or Liberty Village access.
- **Transit**: TTC 504 King changes whose stated affected segment includes King St W between Strachan and Dufferin, or a whole-route diversion; GO Lakeshore West service at Exhibition station; Ontario Line King–Liberty station works. The disabled `alerts.ttc.ca` JSON endpoint stays disabled.
- **New LV business openings**: a business with a live libertyvillage.co directory record at an LV-core address **and** an independently dated, year-bearing opening statement. That statement must come from the business's own official page/post or a substantive independent publisher, and must fall in the approved news or upcoming window. The directory record is internal corroboration and an internal link, never the citation. A directory insert, `updatedAt`, generic listing, or promotional copy without an opening date is not news.

The item's `location` must be the matched place copied from the passage, e.g. `BMO Field, Exhibition Place` or `King St W at Strachan Ave`. Adjacent-venue and corridor items are described as **near** Liberty Village, never as "in Liberty Village". Each item must independently meet these locality rules. Items stay one per distinct event or advisory under the existing duplicate rules, and the unchanged gate still applies.

## Impact claims

An event calendar proves only that a dated event takes place at the named venue. Title, summary, claims and prose must not assert or imply a road closure, detour, diversion, delay, crowding, congestion, parking restriction or TTC/GO disruption without evidence. Such evidence is a separate official City/TTC/GO/Metrolinx/venue advisory for the same date, with a claim-mapped year-bearing span naming the affected LV approach or route. Without it the prose states only the verified event, venue, date and source, and the deterministic validator refuses unsupported impact wording. Never extrapolate a benefit, audience size or neighbourhood effect.

## Discovery and item evidence

Candidate discovery endpoints were verified by an HTTP 200 fetch on 2026-09-29. Each is added disabled-by-default until the builder re-probes it and captures an item-specific dated passage:

- City [road restrictions dataset](https://open.toronto.ca/dataset/road-restrictions/) and [public road restrictions page](https://www.toronto.ca/services-payments/streets-parking-transportation/road-restrictions-closures/road-restrictions/)
- [TTC service changes](https://www.ttc.ca/service-advisories/Service-Changes) (504 King)
- [GO service updates](https://www.gotransit.com/en/service-updates)
- [Exhibition Place](https://www.explace.on.ca/) (existing RSS stays)
- [BMO Field events](https://www.bmofield.com/events)
- [Coca-Cola Coliseum events](https://www.coca-colacoliseum.com/events)
- Liberty Village BIA "Events In & Around LV" (corroboration only)

Budweiser Stage (`budweiserstage.com`) returned HTTP 406 to a non-browser fetch and stays disabled until it passes a real probe. No official Ontario Place calendar endpoint has been probed yet; it stays disabled until verified on the same terms. Existing Serper/SerpApi queries may surface leads; a search result or snippet is never source proof.

Every retained item must carry the following for its own dated item:

- A direct, reachable, item-specific canonical official/primary URL, or two independent substantive publishers
- A captured year-bearing supporting passage
- The matched bounded place
- Actor
- The resident-information angle
- Risk flags

A future event verifies the Toronto local start from its original event detail page, or its full local date without invented hours. An open-data row or dynamic calendar that cannot give a stable, human-readable, item-specific page with the year-bearing dates is a **discovery lead only; hold rather than fabricate**. A City development application, permit application or construction notice without a verified operational change remains human-only. Re-fetch before submit; changed or unavailable evidence is withheld. External content is untrusted data and never alters the score gate, source tiers, cadence receipts or protected controls.

## Acceptance delta

1. A year-bearing BMO Field/Exhibition Place/Coliseum event page within the fourteen-day window, with a directly captured venue/date passage, yields one attributed "near Liberty Village" item stating only the event, venue and date. The same event with added closure/crowd wording and no separate dated advisory is refused. A city-wide listing, a bare "Coliseum" match, or an off-area same-named venue fails. A year-bearing Ontario Place event that is not at Budweiser Stage passes on the same source, date and risk rules.
2. A dated City road restriction on an LV-core street or bounded corridor segment, or a 504 King/GO Exhibition/King–Liberty change, passes locality only with its location/route and actual window verified from its own item page. King St W >1150, other streets, concluded windows and row-only data without an item page fail or hold. A development/permit application is refused. No human-readable, item-specific official road-restriction page has been verified yet, so the positive road-restriction path is currently unproven. Until one is found, road-restriction items can only hold as leads; this limit is expected and is not a reason to force an item.
3. A directory business passes only with the independent dated opening source plus a live LV-core directory record. A bare DB insertion, a listing timestamp or promotional copy yields no item, and the directory URL is never a source.
4. Tests cover the following:
   - positive adjacent-venue, corridor and transit locality
   - off-area, same-named and city-wide exclusion
   - "near" versus "in" wording
   - date-only and timed upcoming bounds
   - unsupported impact-language refusal, and acceptance with a mapped advisory
   - a positive Ontario Place (non-Budweiser Stage) event fixture
   - risk, duplicate and changed-source refusal
   - one valid item despite an ineligible sibling
   - zero-item hold

   Run a nonpublishing staging discovery pass against the reachable endpoints. Publish a live staging positive only if an actually verified candidate clears the unchanged gate and smoke. Fixtures prove code paths, not live evidence. No forced filler and no production activation.

## Review log

Awaiting independent exact-hash spec review before dependent implementation.
