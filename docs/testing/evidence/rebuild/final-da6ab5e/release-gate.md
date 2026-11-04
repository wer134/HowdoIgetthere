# Final release gate

Verdict: **APPROVE** for the requested workspace/account rebuild and its documented local verification scope. No remaining concrete product or evidence blocker was found. This is not an approval to merge to main or deploy to production.

Reviewed on 2026-11-04. Tested product source: `da6ab5eac497b278f73d9e728282cbf99d37337c`; production artifact: `c59f564a0c63efe6`. Current HEAD at review: `02bd98b08ca941dd113d3299606eb963dc7f2263`.

## Source and final delta

`git diff --name-status da6ab5eac497b278f73d9e728282cbf99d37337c HEAD` contains only `docs/testing/repro/negative-78.cjs` and `tests/browser/travel-safety.cjs`. Inspection confirms their changes only foreground existing browser tabs with `bringToFront()`; assertions and application behavior are unchanged. Product source has not changed since the tested SHA. The uncommitted changes at review are the final verification report, fresh evidence directory, and `.gitleaks.toml`. This gate makes no new build or runtime test claim and performed no commit.

## Evidence checked

Evidence root: `docs/testing/evidence/rebuild/final-da6ab5e/`.

- The final goal, code, security, and context review documents identify the exact tested SHA and report PASS within their stated scopes. Goal review's then-pending runtime work is covered by the fresh QA artifacts. Both independent visual reviews explicitly inspected the final 30 primary captures and three additional guard states.
- `release/npm-test.txt` records 124 tests passed, zero failures/skips. `release/exits.json` records test/build/release exit 0; raw build and release logs identify the exact SHA/artifact, with 45 public assets plus manifest.
- Actual board/account/extra/legal JSON agrees with the report: 12 board checks across six viewports; 11 account scenarios; 14 extra scenarios; six legal checks. Account and extra results contain no failed scenarios or page errors. Local HTTP/SQLite are real, while Google OIDC and Gemini provider boundaries are mocked; the report correctly explains the incomplete Google-only shorthand in raw account JSON.
- The first regression failures remain preserved. The unchanged artifact's corrected run records safety five passed and the complete negative suite exit 0. Independent inspection of the negative JSON confirms 78 distinct case IDs, 69 passed, nine unavailable, zero case harness errors, and 181 executable subchecks passed. Unavailable IDs are exactly `5, 40, 50, 59, 67, 69, 71, 72, 75`.
- All 43 capture manifest file SHA256 values match the actual PNGs. This integrity check does not substitute for the independent visual reviews. The report's local evidence links resolve.
- Fresh npm audit records zero vulnerabilities. Cleanup artifacts record owned browsers/servers closed and temporary databases removed.

## Gitleaks configuration and results

Reviewed `.gitleaks.toml`, SHA256 `a6c8bf3e4fe5feca70f48720dbe3fc0c8976fdc23d54c14e412d7cd10c592686`. It extends default rules and adds an allowlist specifically under inherited `generic-api-key`. `condition = "AND"` requires both an approved path and an anchored complete `api.js` JSON metadata line. Paths are limited to the three evidence `results.json` files, and the line permits only the two exact verified digests. There is no directory-wide skip, global allowlist, or arbitrary hash exemption.

The two permitted values were independently recomputed from actual files: root `backend/api.js` is `6a9bf751d08fb9b7311bdfb71ae09206242f983abe4823a2a579461f69062ce0`; review worktree `backend/api.js` is `842c074842a9d013f3ab35b093ba3330740b835a2adf653ff97da1fcf222d9e3`. Their byte difference is the documented checkout line-ending difference, not a product source edit.

`gitleaks-allowlist-probe-summary.json` and its raw report prove the final rule-level configuration permits the exact metadata at its approved path while still detecting both an unknown value within an approved path and an approved digest at another path: exactly two expected generic-api-key findings. The earlier static global-allowlist assessment is superseded by this tested rule-level configuration.

`gitleaks-configured-summary.json`, the two configured raw JSON arrays, and text logs agree: source scan of 1,714 files and full history scan (64 commits in the raw log) each have zero findings and exit 0. Original unsuppressed source/history findings remain preserved and honestly described as three/one digest false positives with exit 1, not relabeled as raw clean scans.

## Boundaries retained in final report

Lighthouse measured mobile scores `54/100/96/100` and desktop `89/100/96/100`; performance 100 was not achieved. These are local simulated-throttling measurements, not production field data. The nine unavailable negative cases remain unavailable. Live external OAuth/SMS/AI fulfillment and billing, real devices/assistive technology, deployment, and operational restore remain outside this evidence. The extra JSON scenario proves backup inclusion of unsent edits; the final report no longer overclaims backup restoration execution.

The final report distinguishes historical/intermediate results from the final-SHA evidence, missing historical commits from a recovered implementation, and local verification from production launch. The separate Codex hook repair is outside the repository and is not represented as a product change or independently retested by this gate.
