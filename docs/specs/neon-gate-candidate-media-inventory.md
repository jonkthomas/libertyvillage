# Focused spec: grounded gate inventory for a submission's media (r1)

Status: draft for independent exact-byte review. This is a narrow correction to `docs/specs/neon-content-store.md` §4.6 g3, approved in the runner migration handoff on 2026-09-28. It supersedes only g3's `images: liveMediaPaths` input and inventory ordering; §4.4 submit/image conversion and all other gate, repair, publication and smoke rules remain authoritative and unchanged.

## Defect and outcome

`content submit` verifies a new local blog JPG and rewrites its candidate `image` to a stored `/media/<sha16>/<filename>` asset. Before publication the path is not in `liveMediaPaths`, so the grounded Opus gate repeatedly reports a valid new hero as missing. A genuine staging weekly-blog submission exhausted three repair rounds on this persistent high finding. The same defect affects production blog publishing. The reviewer must see a new image only when it is backed by verified stored bytes referenced by the submission under review, without treating candidate text as proof or suppressing unrelated content findings.

## g3 contract amendment

For grounded kinds `blog`, `blog-live` and `news`, after the unchanged g1 `recheckImages` succeeds, derive `currentSubmissionMediaPaths` from the **current round vector's** registry-defined image fields. Consider only exact `/media/…` paths that match a row in `content.assets`; verify that the row's stored bytes hash to its full `sha256`, that `byte_size` matches, and that the path's `<sha16>` matches the first 16 hex digits of that digest. A deduplicated asset row originally created by an earlier submission qualifies when this submission's current vector references that exact, still-valid stored path. Never accept arbitrary candidate strings, absent assets, hash-mismatched bytes, or unreferenced rows into the inventory.

Build the bounded inventory with these distinct verified current-submission paths **first**, then live media paths, then existing checkout image listings. Preserve the existing total image inventory limit, deterministic order within each source and slug limits; a new hero must not disappear behind the listing cap. Existing link inventory, grounded lenses, threshold (`overall >= 8` and no high/critical findings), repair budget, g1 image validation, submit policy, deploy and smoke remain unchanged. This is reviewer context only, not publication authorization.

## Acceptance and negative controls

- On current main, a newly submitted blog JPG is converted to `/media/…`, but the gate's review/fixer inventory excludes it (RED). After the fix, the DB-verified path appears before live/listed paths and a grounded review can evaluate the actual image (GREEN). The image path must remain present even when checkout listings already fill the normal inventory bound.
- A stored asset referenced by the current vector but created under an earlier submission is accepted only after the same digest/size/path checks. A missing, unreferenced, malformed or byte/hash-mismatched `/media` path is **not** listed; a review that flags it high still blocks (negative RED), and no publication occurs.
- The same review can still block an unsupported walking-route claim, broken internal link or poor content independently of asset validity. Neither a scripted verdict nor a direct DB promotion counts as staging UAT. Rerun a genuinely grounded blog through the ordinary staging submit→Opus gate→publish→deploy→smoke after the code reaches staging.
