# Repeated itinerary visits

The browser regression runs against a fresh local static server and isolated browser contexts. It seeds synthetic station/stop records, replaces the Google SDK and MapView with existing repository mocks, and blocks every nonlocal request. No real provider responses or user storage are involved.

## Red and green

Before changing the selector, the test failed with `Existing station is disabled: a new same-day visit must be selectable` (`false !== true`). See `red-results.json` and `red-1440-initial-repeat.png`.

After removing the disabled state and comparing nonempty provider IDs before proximity fallback, the same browser scenario passes at 1440 and 390 pixels. See `green-results.json`. Source asset root is recorded in that result; this source run has no production release identifier.

Commands (PowerShell, workspace root):

```powershell
$env:REPEATED_PHASE = 'red'
node tests/browser/repeated-places.cjs
Remove-Item Env:REPEATED_PHASE
node --check js/app.js
node --check tests/browser/repeated-places.cjs
node tests/browser/repeated-places.cjs
node --test tests/workspace-model.test.js tests/travel-portability.test.js
```

The red command is historical and fails only against the original guarded selector. The final runner uses the explicit all-day selector and waits for the edited memo in storage rather than relying on a stale saved-status label.

For a previously built production asset tree, use a separate output directory:

```powershell
$env:BOARD_ASSET_ROOT = 'dist'
$env:REPEATED_OUT = 'docs/testing/evidence/repeated-places-layout/repeated/production'
node tests/browser/repeated-places.cjs
```

## Observed behavior

- Same-day A → B → A keeps three itinerary visits. Marker keys are `0`, `1`, `2`; route-leg keys are `0>1`, `1>2`.
- A station can be selected on another day as a separate visit.
- A different provider ID about 4.4 metres from A is selectable and has no existing-visit hint.
- Editing one returning visit's time/memo leaves the original visit unchanged. Moving a third visit to another date leaves the first two dates intact. Deleting the first A preserves the other two A records and their separate notes.
- Reload preserves the resulting records. Backup import in a new browser context preserves both repeated provider IDs with separate record indices.
- No browser page errors occurred. The targeted workspace/backup unit tests passed 9/9.

## Scope and limits

The root cause hypotheses were a selector eligibility gate, proximity-based place conflation, and record merging during mutation or persistence. Runtime red/green evidence confirms the selector gate; nearby-ID and save/reload/backup assertions cover the other boundaries. Existing records, markers and legs already use visit identity, so no storage schema or route model changed.

Screenshots show a real browser using the mock map implementation. They do not validate live Google rendering, routing quality, marker overlap interaction, provider availability, screen readers or physical devices. Adjacent visits within 50 metres continue to omit a route leg, while their separate itinerary records remain. Production testing and independent visual review belong to the parent task's release verification.

The changed explanatory comment was removed after comment-checker feedback. LSP was unavailable and installation had previously been declined; Node syntax checks passed instead. No build, commit, external service write or debug instrumentation was performed by this worker. All retained artifacts are the requested synthetic regression evidence.
