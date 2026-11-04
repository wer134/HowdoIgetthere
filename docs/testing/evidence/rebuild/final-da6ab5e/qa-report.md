# Final QA execution — PASS with stated limits

Source: da6ab5eac497b278f73d9e728282cbf99d37337c
Artifact: c59f564a0c63efe6

Fresh npm test:124/124; build and check:release exit0,45 public assets validated. npm ci completed successfully earlier on unchanged package manifest, zero vulnerabilities. Node24.18.0, Playwright1.62.1, Chromium1248, Windows. No product/test changes by QA executor.

## Scenarios and observed assertions
- Board 1: stale board undo rejects whole-snapshot replacement after a later candidate memo save
- Board 2: earlier and existing undo restore order; open editor blocks undo until closed
- Board 3: stale drag after another edit is rejected
- Board 4: open editor blocks reorder, Escape retains draft, reopened draft saves to original record
- Board 5: explicit date/position move preserves time memo custom column and focus
- Board 6: real pointer drag inserts candidate and retains library original
- Board 7: search matches memo
- Board 8: keyboard Escape closes move dialog
- Board 9: board/map mode preserves selected day
- Board 10: downloaded Excel preserves moved order, all days, time, memo, custom value
- Board 11: guest changes survive reload
- Board 12: new-travel toolbar creates empty board and retains prior guest trip
- Account 1: Google OIDC provider-boundary mock login does not upload guest travel
- Account 2: explicit account copy retains device original with distinct server id
- Account 3: account edits save to HTTP SQLite without leaking into guest store
- Account 4: new guest travel after account editing remains durable after reload
- Account 5: read-only fragment sharing and authenticated suggestion owner acceptance
- Account 6: offline draft retained, logout blocked, retry succeeds
- Account 7: version conflict survives refresh, explicit latest and logout clear account draft; logout freezes edits and blocks Escape until response
- Account 8: duplicate new-travel submit creates exactly one device travel
- Account 9: BYOK day revision apply and undo retain account-only storage during delayed PUT plus beforeunload (Gemini mocked)
- Account 10: unsaved nonmodal editor blocks logout; saving retains memo and subsequent logout clears user-scoped editor drafts
- Account 11: unconfigured account service keeps guest homepage and explains optional login at 390/768/1440
- EXTRA: JSON backup includes unsent account edit while SQLite still lacks it
- EXTRA: BYOK opening is blocked by dirty nonmodal editor and retains draft
- EXTRA: latest while editor dirty keeps local draft and server original
- Legal: privacy and terms HTTP200, h1 present, zero horizontal overflow at390/768/1440, no page errors. Six screenshots.

## Critical runtime audit
1. Storage isolation/durability regression: guest changes survived actual reload; explicit account copy preserved separate original ID; account mutations read back from actual SQLite and did not enter guest localStorage. Refuted for exercised paths.
2. Async overwrite/editor race: offline edit retained tab journal and retry wrote SQLite; conflict survived reload and explicit latest removed candidate; delayed PUT plus beforeunload preserved account-only ownership for AI apply/undo. Extra guards retained editor draft on latest/BYOK and JSON backup contained unsent account edit absent in SQLite. Stale board undo now rejected and exact before/after snapshot stayed equal, including later candidate memo; open editor blocks undo. Refuted for exercised paths.
3. Artifact/config mismatch: immutable revision matched release metadata/check:release; unconfigured account hides login and preserves guest operation; viewport/layout assertions passed. Refuted for exercised paths.

## Cost and security boundary evidence
Actual npm test124 includes: SMS pre-reservation and bounded phone checks; idempotent AI per number/account/travel; failed provider remains charged and retry does not duplicate; default service budgets/account API fail closed; zero budget disables reservations; eight SQLite connections racing last global budget reserve exactly once; trusted login network budgets and IPv6 canonicalization; atomic storage/travel/suggestion quotas. These use mocks at external provider boundary; they verify local budget enforcement, not real provider fulfillment. Browser account test uses real HTTP+SQLite, mocked Google OIDC and Gemini only. No real SMS/AI paid calls.

## Evidence and cleanup
release/{npm-test,npm-build,check-release}.txt raw UTF8; release/exits.json all0. board/results.json12checks+14PNGs; account/results.json11checks+10PNGs; legal/results.json6checks+6PNGs; extra/results.json14checks(original11+3delta)+13PNGs. Three additional delta states: unsaved-account-backup, byok-editor-guard, latest-editor-guard. All captures current source/artifact, no stale prior evidence used. Each helper exited0; browser/server finally completed, account temp SQLite directories removed. No user secrets accessed; synthetic fixtures only.

## Final independent regression
Initial legacy run passed five suites; travel-safety and negative8 were blocked by inactive browser tabs. The isolated test adapter adds actual bringToFront calls only (see clean-tab-activation/test-adapter.patch). Clean safety5 plus complete negative78 then exited0. Validator confirms69 passed,0 defects,9 unavailable:5,40,50,59,67,69,71,72,75. All other legacy suites passed on identical immutable dist. Evidence: regressions/run-summary.json plus clean-tab-activation/run-summary.json and cleanup.json. No app source change or rebuild between these runs.

## Lighthouse measured results
| Profile | Performance | Accessibility | Best practices | SEO | LCP | TBT | CLS |
|---|---:|---:|---:|---:|---:|---:|---:|
| Mobile412x823,CPU4x |54|100|96|100|4.96s|1253ms|0.0675|
| Desktop1350x940,CPU1x |89|100|96|100|1.81s|140ms|0.0233|

Lighthouse13.5.0 Node API attached isolated real Chromium. This is local loopback on a shared Windows host with simulated throttling, not production field data. No runtime errors or run warnings. Best-practices penalty is static-only server /api/session404. Source-map/unminified/unused-code diagnostics are retained in raw reports. Performance100 is NOT achieved or claimed; mobile performance remains an observed limitation.

An initial desktop-intended run used an ignored CLI-style preset and was discovered to be mobile by auditing configSettings. It is preserved as mobile-repeat48; excluded from desktop score. Correct desktop uses official installed desktop-config as the third API argument and asserts formFactor. Canonical lighthouse/results.json holds only valid mobile54 and desktop89. Full JSON/HTML and actual config settings retained.

## Final cleanup and scope
All owned browsers/servers exited0 and closed; SQLite temporary directories removed. Lighthouse Chrome/server closed. Capture manifest records hashes/dimensions for43 freshly generated PNGs (30 main+13extra, including repeated account states); independent visual review covers30 main+3delta unique states. QA makes no production OAuth/SMS/AI fulfillment claim and no deployment claim. Product source tested is exactly da6ab5eac497b278f73d9e728282cbf99d37337c, artifactc59f564a0c63efe6; final test-only tab adapter is documented separately. No commits by QA executor.
