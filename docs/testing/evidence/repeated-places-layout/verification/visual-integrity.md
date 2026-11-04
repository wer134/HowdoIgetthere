# Complete Visual QA A — PASS

- Product revision: `c4a2f2540fdea0b6fc76a999c3b699d1f33007b6`
- Release version: `6f8479cb352129e4`
- Review type: design-system and functional integrity, read-only
- Verdict: **PASS**
- Confidence: **HIGH**
- Blockers: none

## Intent reviewed

The user wanted the planning board to remain a full usable surface instead of being crushed into the map sidebar, and wanted the same station/place to be visitable repeatedly without conflating separate visits or distinct provider IDs. The final responsive UI also needed to preserve readable Korean wrapping, keep the toast action intact on mobile, reuse the existing RouteFlow design system and real DOM, and avoid claiming live provider verification where APIs were mocked or blocked.

## Coverage and artifact integrity

Directly opened and inspected all **18/18** fresh production PNGs:

### Board — 8/8

- `docs/testing/evidence/repeated-places-layout/board/production/390x844.png`
- `docs/testing/evidence/repeated-places-layout/board/production/768x1024.png`
- `docs/testing/evidence/repeated-places-layout/board/production/1280x900.png`
- `docs/testing/evidence/repeated-places-layout/board/production/1440x1000.png`
- `docs/testing/evidence/repeated-places-layout/board/production/1920x1020.png`
- `docs/testing/evidence/repeated-places-layout/board/production/1920x1020-saved-continue.png`
- `docs/testing/evidence/repeated-places-layout/board/production/1920x1020-import-board.png`
- `docs/testing/evidence/repeated-places-layout/board/production/1920x1020-import-map.png`

### Repeated places — 10/10

- `docs/testing/evidence/repeated-places-layout/repeated/production/1440-independent-visits-reloaded.png`
- `docs/testing/evidence/repeated-places-layout/repeated/production/390-independent-visits-reloaded.png`
- `docs/testing/evidence/repeated-places-layout/repeated/production/production-1440-initial-repeat.png`
- `docs/testing/evidence/repeated-places-layout/repeated/production/production-1440-mock-entrance-c-2026-11-07-search.png`
- `docs/testing/evidence/repeated-places-layout/repeated/production/production-1440-mock-station-a-2026-11-07-search.png`
- `docs/testing/evidence/repeated-places-layout/repeated/production/production-1440-mock-station-a-2026-11-08-search.png`
- `docs/testing/evidence/repeated-places-layout/repeated/production/production-390-initial-repeat.png`
- `docs/testing/evidence/repeated-places-layout/repeated/production/production-390-mock-entrance-c-2026-11-07-search.png`
- `docs/testing/evidence/repeated-places-layout/repeated/production/production-390-mock-station-a-2026-11-07-search.png`
- `docs/testing/evidence/repeated-places-layout/repeated/production/production-390-mock-station-a-2026-11-08-search.png`

Every file has the PNG signature `89504E470D0A1A0A`; every decoded dimension matches its filename/test viewport. No black frames, partial compositing, or malformed captures were observed.

## Findings

### Board layout and mode/state coherence — PASS

- The board is a page-level planning surface at 390, 768, 1280, 1440, and 1920 widths. It does not render inside the 430px map sidebar.
- Responsive structure is coherent: one day column and collapsed candidate section at 390, candidate plus two day columns at 768, and candidate plus three day columns at desktop widths. Cards remain contained and readable with no visible horizontal overflow.
- `1920x1020-saved-continue.png` restores directly into board mode with the board filling the workspace.
- `1920x1020-import-board.png` shows the imported itinerary in board mode with a successful import toast; `1920x1020-import-map.png` shows the corresponding map/list mode with the sidebar, map canvas, imported file summary, and the same 40-place import toast. The two states are visibly distinct and internally consistent.
- Source trace: `js/workspace.js` now synchronizes the initial/restored mode through `syncMode()` and guards callback re-entry with `appliedMode`; `js/app.js` sets map mode before `loadSheet()` during import. The source behavior agrees with the captures.

### Repeated visits and identity — PASS

- Both 1440 and 390 sequences show an already planned station remaining enabled with the explicit hint `일정에 있음 · 다시 선택`.
- The visible trip count progresses from 2 to 3 to 4 places as a distinct entrance and repeated station visits are added. The sequence is consistent at both widths.
- Reload captures show independent same-place visits surviving with separate day/time/memo state. `production-results.json` records independent edit, move/delete, reload persistence, and backup round-trip at both widths.
- `plannedItem()` compares provider IDs when both are available and only falls back to distance when an ID is unavailable, so distinct provider IDs are not collapsed by proximity.
- `1440-visit-keys.json` and `390-visit-keys.json` record visit-specific marker keys `0,1,2` and leg keys `0>1,1>2`, consistent with independent rendered visits rather than place-name identity.

### Responsive typography and toast — PASS

- The 390px picker stacks the result metadata under the result text, leaving the place name and Korean description readable.
- Caption and description wrapping is natural in the inspected desktop and mobile captures; no single Korean particle/syllable orphan, tofu glyph, clipped baseline, or detached label was observed.
- Mobile success toasts keep `되돌리기` on one line while the message wraps naturally within the remaining width. The 390px screenshots show neither action wrapping nor viewport overflow.
- Source trace: `word-break: keep-all` is applied to picker copy, the picker switches to a column layout below 500px, the toast message is shrinkable/wrappable, and the toast button uses `flex:none; white-space:nowrap`.

### Design-system and implementation integrity — PASS

- `DESIGN.md` remains the explicit contract and now documents repeat selection, the 500px picker layout, Korean wrapping, and toast behavior.
- Production styling continues to use the established RouteFlow tokens and existing workspace/schedule primitives. The changes are narrow extensions to those primitives, not a parallel ad-hoc visual system.
- The interface is rendered as live HTML controls, cards, dialogs, panels, and map placeholders. No screenshot, raster background, or static image is used to impersonate the board, picker, itinerary, or toast.
- The inspected diff is scoped to mode synchronization, repeat-selection identity/availability, responsive text layout, and toast layout. No unrelated visual redesign or decorative/slop animation was introduced.

## Supporting evidence checked

- `DESIGN.md`
- Production diff `0ed7788..c4a2f2540fdea0b6fc76a999c3b699d1f33007b6` for `DESIGN.md`, `css/style.css`, `js/app.js`, and `js/workspace.js`
- `docs/testing/evidence/repeated-places-layout/board/production/results.json` — PASS, revision/version match, five-width geometry and state checks, no external calls
- `docs/testing/evidence/repeated-places-layout/repeated/production/production-results.json` — PASS, revision/version match, two-width repeat/identity/persistence checks, nonlocal requests blocked and map/SDK mocked
- `docs/testing/evidence/repeated-places-layout/repeated/production/1440-visit-keys.json`
- `docs/testing/evidence/repeated-places-layout/repeated/production/390-visit-keys.json`

## Provider boundary

This review confirms only the mocked/blocked provider boundary represented by the artifacts. It makes **no claim** that live Google Maps, login, or other external providers were exercised.

## Final gate

**PASS** — no `[product]` or `[evidence]` blockers. The frozen product at `c4a2f2540fdea0b6fc76a999c3b699d1f33007b6` / `6f8479cb352129e4` satisfies the requested board layout, repeated-visit behavior, responsive text/toast behavior, design-system reuse, and evidence integrity for this Visual QA A charter.
