# R166 / #1748 provisional review — STOP on P1

Review checkout: `X:/t3-code/worktrees/z8/t3-ef083329-83fb3c23a4ea5691`.
Branch: `chore/review-travel-claim-detail`.
`verifiedCommit: null`; issue remains **OPEN**. No readiness advancement, tracker writes, push, PR, watch, source fix, or review of #1747/#1749/#1750 occurred. All checkout/index/Git/package/process ownership is released for root's next action. Physical dependencies remain in this candidate only.

## Blocking finding

**P1 — A transient refresh revives claim evidence already withdrawn by a canonical refusal.**

Location: `apps/webapp/src/components/travel-expenses/travel-expense-claim-detail.tsx:198–199`.
The component derives `refused` only from the latest query error. React Query retains the previous successful `data`. With the actual `TravelExpenseClaimDetail`, actual `OrganizationContextProvider`, actual `QueryClient`, and synthetic HTTP/session adapters, the sequence is:

1. GET succeeds (200): original notes and Download link are visible.
2. Invalidate the public `['travel-expenses']` query family; GET returns 404: notes and Download link disappear, with the canonical refusal disclosure.
3. Invalidate the same family again; GET returns only 503: the cached original notes and Download link reappear alongside the transient error.

No new authorized success occurs in step 3. Both independently expected visible predicates fail: `notesVisible` and `downloadVisible` are **true**, expected **false**. This violates the requested refusal non-revival contract and the incoming spec's promise that a canonical refusal withdraws sensitive retained records. No private helper or source-text assertion is used as product proof.

The positive control 200 → 503 → 200 retains authorized evidence and recovers. The denial control starting at 404 exposes no notes or receipt action. Both pass in the final confirmation. No production server, real session, live authorization change, or actual receipt byte access was tested; the finding is a synthetic public-seam presentation/cache failure, not a live authorization bypass. Backend ownership/receipt authorization remains authoritative.

**Pinned-baseline distinction:** a test-only public-source bridge loaded the exact detail blob from `85d6a75b4522e84fc701d0bf98f9dda5a9f8aaf4` with the same provider/transport/client. The baseline never withdraws its retained notes or Download link at 404, and retains them at 503. Thus retained-cache exposure is inherited; #1748 adds an incomplete withdrawal guarantee whose refusal state is lost on the next transient error. This is not described as a new backend vulnerability or as evidence that baseline had a durable refusal gate.

Root owns any correction. No correction was made here. On confirming this first blocker and its minimum controls, all further acceptance stopped.

## Exact merge and preservation

| Pin | Value |
| --- | --- |
| Published root / first parent | `85d6a75b4522e84fc701d0bf98f9dda5a9f8aaf4` |
| Root app tree | `0ada8178304098b103daa1284f9158cdf59384d8` |
| Root full tree | `a3cfb71a7724b40c3c7dd7fbf360b4e580399f85` |
| Incoming / second parent | `6144dbb54f4398436ec6b95ad37ef32fd6ab0ca8` |
| Normal merge base | `cab40dcbb6ea69cefb7aa919228298a881a66060` |
| Provisional merge commit | `df0fafc4d827969d37482df69cfe2abb92fee599` |
| Predicted AND actual full tree | `9482b7c7b76665c1c303c4cb9a73cd52d745cf00` |
| Predicted AND actual app tree | `860abb81d474927d8b49ddc521dc33d008a1d8ef` |

The checkout started clean at the requested pins. Before the merge, `predict.cjs` independently reconstructed the entire resolved Git tree in memory from root/base/incoming blob/mode maps. Its pure tree-hash algorithm first reproduced the root's full tree as a control. `prediction.json` records the exact incoming 83-path map and expected composition; it was written before `git merge`.

Exactly one normal `git -c core.hooksPath=NUL merge --no-ff --no-commit 6144dbb54f4398436ec6b95ad37ef32fd6ab0ca8` was run. It conflicted in only the two predicted route-metadata paths. The explicit resolutions were copied from the precomputed text files and staged only at those two paths. `git write-tree` matched the prediction before commit. The local merge commit used `git -c core.hooksPath=NUL commit -m "merge: provisional R166 legacy claim detail review candidate"`.

Manual recipe, for read-only inspection:

- `route-metadata.ts` = exact root content + incoming `z` import + exact legacy UUID extraction/predicate. Every existing root opt-in, alias, and deeper-descendant exclusion remains. No `/travel-expenses` listing opt-in was invented; its future independent adoption remains possible.
- `route-metadata.test.ts` = exact root content + the exact additive incoming suffix after the base content. No root assertion was removed.
- All other 81 incoming paths are exact incoming blobs/modes. All 75 incoming artifacts arrived solely through the native merge; no artifact or seal was edited.

Final map verification: **18,499 root non-overlap paths** preserve exact Git blob AND mode, **81 incoming non-overlap paths** match incoming exactly, two composed paths match their independently predicted blobs, and there are zero unpredicted paths or mismatches. Root has 18,506 paths; candidate has 18,582. Therefore all unrelated current source/proof/archive/config/lock blobs survive, including R148 loader/proxy/layout, R096, R155, Today, the root graph/anchors/routes/aliases, and the 1738/1739/1740/1742 archives. This is exact preservation, not renewed functional acceptance of those areas. No other ticket was merged or cherry-picked.

The two manual resolutions were written as LF and Git warned about future CRLF materialization. The predicted and actual Git blobs match. Ordinary formatting, explicit width-100/CRLF formatting, and raw-artifact whitespace checks were not run after STOP; inherited qualifications remain. Incoming logs and seals were never normalized.

## Fresh results and exact commands

Every package invocation set `$env:pnpm_config_verify_deps_before_run='false'` and included `pnpm --config.verify-deps-before-run=false`. Normal escalation was used for the engine-store lock. The initial restricted version-only probe warned and printed fallback 12.21.0; it performed no install/test operation. The subsequent escalated version probe confirmed **12.16.1**, and install/test output used that pin. No dependency operation or test was run with the fallback version.

Frozen physical dependency install (exit 0, no lifecycle/postinstall):

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false install --frozen-lockfile --offline --ignore-scripts --package-import-method=copy
```

From this checkout's root, priority-existing (exit 0):

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec vitest run --project unit src/components/travel-expenses/legacy-draft-conversion-consumers.test.tsx src/components/travel-expenses/travel-expense-claim-detail.test.tsx --maxWorkers=1 --reporter=json --outputFile=../../.tmp/review1748/priority-existing.json
```

Result: **28 passed**, comprising 5 shared consumer cases and 23 detail cases. In particular, held history/list continuation is retired when the displayed session becomes pending; queued interruption, retired account refusal and A → B → A also pass. This run is a subset of the worker's 124 selection, not 28 added to 124.

Initial focused public reproduction (exit 1):

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec vitest run --project unit src/test/review1748-refusal.test.tsx --maxWorkers=1 --reporter=json --outputFile=../../.tmp/review1748/refusal-review.json
```

Result: 1 passed / 2 failed. One was the actual blocker; the positive recovery control also asserted synchronously before React Query's final notification. The control was corrected to await disappearance of the transient error, without a production change. This failed attempt is retained and is not presented as clean proof.

Final minimal confirmation with pinned-baseline control (exit 1):

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec vitest run --project unit src/test/review1748-refusal.test.tsx src/test/review1748-baseline-control.test.tsx --maxWorkers=1 --reporter=json --outputFile=../../.tmp/review1748/refusal-confirmed.json
```

Result: **3 passed / 1 failed**. Authorized recovery, initial refusal, and baseline classification pass; the 200 → 404 → 503 non-revival test fails. `review-results.json` records every exact file/fullname/occurrence/status, separately by run. There are **32 distinct cases total**, with 31 latest passes and one latest failure. Three cases overlap between the initial and final focused runs. No historical worker/root counts were added.

All stdout/stderr was redirected to same-named local `.log` files. Sanitized result files in SAFE retain the multiset and exact failed predicates, without relying on terminal-only counts. The retained focused test sources are review harnesses, not new product commits.

## Stop boundary and inherited limits

The remaining priority matrix, full deduplicated compatibility selection, affected shared navigation/SiteHeader/Today/R096 gates, disposable PostgreSQL, Next typegen/three TS projects, scoped lint/import, both formatting profiles, and bounded Doctor were **not run** after the blocker. No new PostgreSQL services or custom SQL seeding were used.

Curated artifact audit was also **not run** after STOP: no fresh decoded PNG/hash/dimension, JSON/stdout/link/timing/retained-attempt audit, or pixel acceptance is claimed. The committed public spec and manifest header were read; exact incoming artifact Git preservation was verified. Worker 124 units, 51 distinct PG with settlement timeout rerun qualification, types/Doctor100 and live conversion/receipt/settlement/capture evidence remain **inherited only**. Final shared pending-session refinement still has no repeated final live capture. Native React, live revocation/Activity combinations, full build/catalog/device/zoom and other stated live limits remain unpassed.

No private fixture files, credentials, authstate, failure images, old browser/auth/archive scripts or provider bypasses were read, recovered, copied or executed. No fresh live/browser/native/runtime acceptance occurred.

## Cleanup and reproduction resources

Three temporary bridges were removed only after their SHA256 matched their recorded hashes: the candidate test bridge, the pinned-baseline test bridge, and the exact pinned public baseline detail source bridge. `bridge-cleanup.json` records their paths/hashes/removal. Their test source templates remain under ignored `.tmp/review1748` for root's later use. The baseline module can be reconstructed read-only from `git show 85d6a75b4522e84fc701d0bf98f9dda5a9f8aaf4:apps/webapp/src/components/travel-expenses/travel-expense-claim-detail.tsx`; no branch reset or peer checkout is needed.

All foreground package/test/Git commands settled. Final tracked status is clean. Exact own runtime/process/listener/container ownership is **zero**: no server/listener/container was created, and the final OS process query found zero Node/pnpm processes whose command line names this checkout. The restricted OS process query was denied; the same count-only check succeeded with normal escalation. No peer/root process was stopped or modified. No package tree was borrowed, copied from a peer, junctioned or cleaned up. All local integration/checkout/index/Git/package/runtime ownership is released; root owns any later adoption/fix/publication and serial #1747 continuation.

`SAFE-index.json` is an explicit allowlist with full absolute path, byte length and SHA256. No private filesystem inventory or secret match values are included. It excludes raw test stdout/failure DOM and raw JSON failure messages; `review-results.json` preserves sanitized attempts and test identities instead.
