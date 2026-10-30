# PR #1476 review and release assessment

Assessment date: 2026-10-30. Application review head:
`8a42165e50c93878a7a652ee08489d4c57bacc88`, base `dev`.

## Decision

Ready for application review with unresolved merge and deployment gates. This is
not full acceptance of #1448 or permission to merge or deploy. No overall latency
or resource improvement is claimed. The finishing pass does not change the
application, benchmark tooling, comparison conditions or acceptance gates.

The PR's automatic closing references are replaced with related-issue references.
All 27 issues remain open until their actual acceptance is established. In
particular, #1450 and #1475 retain controlled measurement, #1472 retains production
cache/topology verification, and #1473 retains production ingress/CDN verification.
The parent #1448 continues to track the missing phase-by-phase evidence; a final
measurement cannot recreate budgets registered before historical implementation.
Review readiness does not waive any of these requirements for merge.

## Reused application evidence

| Check | Result and boundary |
| --- | --- |
| Whole-feature unit replay | 19,541 passed, zero failed, 38 existing skips. This historical run is not a new full run of the final head. Later application changes have focused evidence. |
| Final application build | CI-mode production build and all three TypeScript configurations passed at `86934776e734e3e28c4a78ca5a55c8c064d3f8ed`. Comparing that commit to the review head shows unchanged compiled server source, dependencies and patches. |
| Later public service worker | The only later application change is `public/sw.js` and its tests: 13 unit and 20 real Chromium recovery/clock-command checks passed. Identical qualified worker bytes were used in both fixtures. |
| Selector ownership fix | Fresh authorization/revision work ends before the independent cache read; 15 focused checks passed, including a regression that fails against its parent. |
| Functional production journeys | 114 primary visits, 54 companion visits and 20 mixed pairs / 40 clock commands passed their existing functional gates, with clean logs and verified restoration. These are not complete performance cohorts. |
| React Doctor | Zero errors, 14 reviewed warnings; not warning-free. |
| Full Biome | Failed: 6,806 errors, 941 warnings and nine informational diagnostics in the merged run. Original also fails; aggregate attribution is not established. Focused fixes/checks do not make the full command green. |
| Full disposable PostgreSQL | Failed: 5,707 passed, 135 failed, eight skipped, in two failed files. No clean full-suite result is available. |
| Finishing-pass deployment manifest check | `pnpm docker:sync:non-web-targets` passed; root frozen dependency setup and all three target lockfile checks passed. Regeneration produces no tracked content changes to root or target package files. |

The [whole-feature quality ledger](1448-whole-feature-quality.md) retains earlier
failed unit/integration attempts as well as successful replays. Counts from
overlapping runs must not be added. The final build qualification and focused
checks supplement, rather than relabel, the earlier whole-feature run.

## Unresolved PostgreSQL failures and CI

The retained failed files are
`src/lib/approvals/server/work-period-approvals.integration.test.ts` and
`src/lib/telegram/legacy-time-bound-approval.integration.test.ts`. Their source
and inspected reader/fixture/timeout inputs were unchanged from Original/staging.
The retained diagnosis establishes that explicit UTC pool options shadow the
environment's intended 15-second statement timeout. It does not establish the
cause of the slow pagination query, a deadlock, or a safe product fix. One query
was canceled after more than 29 minutes so the owned run could clean up.

Do not dismiss these failures as harmless or fix them by increasing timeouts,
changing pool sizes, skipping tests or weakening assertions. Merge requires an
affected-suite pass or an explicit maintainer disposition with the unresolved
risk recorded. The work-records CI includes the failed work-period suite; it does
not include the legacy Telegram suite, so a green job alone cannot resolve both.

At the review head, package-lock sync, work-records PostgreSQL, Windows debounce
and Windows checks were all `SKIPPED` because the PR was draft. Their workflows
subscribe to `ready_for_review`. Marking ready starts applicable CI; inspect the
PR's current Checks for its results rather than treating those old skips as
passes. The full Tests workflow targets PRs into `main`, not this PR into `dev`.
No workflow or required check is disabled by this finishing pass.

## Deferred measurement, retaining both failures

There is no accepted complete clean Original baseline, no nine registered
numerical budgets and no matched optimized timing. The existing strict matrices
remain 1,380 primary and 1,080 companion visits. The smaller functional and
diagnostic runs cannot substitute for them.

- Original primary attempt 1 failed after 207 recorded visits with a mandatory
  JavaScript connection error containing IPv6 refusal and IPv4 `EADDRINUSE`.
  Bounded API and 64-visit diagnostics did not reproduce or fix it. It remains
  unresolved, not a proven protocol-control cancellation.
- Original primary attempt 2 failed after 636 visits with `Invalid string length`.
  The readable artifact is 536,230,549 bytes; the whole-artifact JSON encoder and
  Node's 536,870,888-character string limit support a capacity hypothesis. No
  retained stack positively locates the throw. No encoder repair, diagnostic,
  new benchmark framework or new full attempt is part of this finishing pass.

Both failed artifacts, hashes, controller/operator outputs and cleanup receipts
remain preserved outside the checkout as described in the handoff. The successful
outside-sandbox v2 cleanup receipt is authoritative; its denied v1 is invalid.
No companion, new mixed capture, budget freeze or optimized timing followed the
second failure. Resuming a full attempt requires new authorization and new output
paths. [Release-budget rules](1448-release-budgets.md) remain unchanged.

## Deployment prerequisites and rollback

- Preserve fresh command authorization, organization/visibility-scoped reads and
  UTC/event-local-offset timekeeping. The final targeted inspection retains the
  employee/Dashboard admission boundaries and private, no-store GET responses;
  display headers grant no authority. The worker skips remote authorization only
  when both stores successfully establish global emptiness; invalid, unreadable
  or nonempty stores retain authorized recovery.
- Ship the maintained Next 16.4 patch through the committed pnpm registration and
  lockfile, in both CJS and ESM forms. It preserves final-work waiting and resolves
  response completion on close. Do not deploy an unpatched reinstall or treat
  native observer closure as a manually manufactured success. See
  [patch regression and qualification](1448-next-stream-completion.md).
- Preserve migrations 0284-0287. Migration 0288's journal timestamp follows every
  predecessor. On a busy database, prebuild its exact index concurrently outside
  a transaction, with bounded lock wait, and verify validity/readiness, nonunique
  unfiltered B-tree definition and exact ordered keys before normal migration.
  `IF NOT EXISTS` does not repair an invalid or wrong-definition same-name index.
  The ordinary migration can block writes; fixture build duration is not a
  production lock estimate. Follow [rollout and rollback](1448-absence-indexes.md#rollout-and-rollback).
- Verify cache expiry, permission reduction, invalidation across real deployed
  replicas, outage behavior, private-response handling and streaming through the
  actual ingress/CDN. Existing local two-instance/proxy evidence is source-pinned
  and does not establish production topology or mixed-version rollout behavior.

Application rollback is reversible. The new index can be dropped concurrently
after coordinating builders; keep applied migration history intact. Deployment
credentials and production access were not used in this finishing pass.
