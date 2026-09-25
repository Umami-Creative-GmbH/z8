# #267 — browser clock preservation evidence

Date: 2026-09-13. Baseline: `35fa37b438c99a473596dfac2a861a79fdfd538d`.
Ticket: [#267](https://github.com/Umami-Creative-GmbH/z8/issues/267), T03 of
[#264](https://github.com/Umami-Creative-GmbH/z8/issues/264).
Binding decisions: [#263](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636)
and [#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Delivery boundary

This is the bounded preservation correction. Existing browser records lack the
evidence needed for safe automatic fresh submission; the old adapter also sent an
organization assertion the direct route rejected. Processing now classifies and
retains records for review, without posting them, changing their organization,
normalizing aliases or treating their local ID as a business operation ID.
Stricter protocol/admission, target binding and business receipt recovery are not
activated. Existing server clock operation/replay matching is untouched.

- IndexedDB acknowledges writes only after transaction completion. Aborts reject
  both enqueue and lifecycle updates.
- No age/retry purge, destructive conflict/validation branch, or ordinary
  delete/clear API remains. Unsupported and malformed evidence remains stored.
- The version-1 `clock-events` store remains the sole browser persistence owner.
  Original legacy fields, IDs and available timestamp/timezone representations
  stay intact. In-place classification is atomic and restart-safe.
- Intercepted requests retain exact body bytes, incoming IDs and available fields.
  Missing event time, organization, actor or timezone is not synthesized from the
  failure-time session or device. Their possible server commitment stays unknown.
- Local acceptance survives subsequent notification failure. Worker manual
  processing replies immediately; completion/errors are separate, awaited events.
  Storage failures can retry; review holds never enter an automatic submit loop.
- Both clock UIs explicitly offer saving either endpoint for review, keeping
  metadata selectors visible. Offline mutations bypass TanStack's online pause.
  Local retention does not invent an active server period or close an existing one.
- The banner shares a context-scoped UI cache. Counts are unverified until an
  authenticated durable read; offline session captures are not presented as the
  complete saved-record total after a reload.
- Read-only `/api/time-entries/offline-context` reuses authenticated session,
  approved membership/active employee checks, and CASL. Account/organization/origin
  assertions scope inspection/export/archive. Unattributed legacy records require
  organization-wide time-entry management. Records lacking organization evidence
  require separately authorized device-level recovery; they are not disclosed or
  assigned to the current account.
- Archival retains original evidence and unknown commitment. Read and archive are
  distinct caller operations. Export reauthorizes and is fenced against dialog
  close/unmount/context changes. Scoped commitment notifications refresh current
  status separately and report status-read failure without queueing another save.
- New callers check the controlling worker's preservation capability before
  capture. This prevents those callers feeding a known old destructive worker;
  it does not establish control over already deployed old callers/workers.

## Cleanup participation

Original evidence and recovery/archive metadata are inline in the existing row,
not separately retained children or a new server store. Native browser origin
IndexedDB erasure removes the complete lifecycle. A real Chromium test clears
origin IndexedDB, stops the worker, reloads and processes again: retained and
archived records do not reappear. This verifies **origin-data erasure**, not remote
organization-deletion propagation or selective tenant erasure. Ordinary recovery
does not authorize destructive erasure of unresolved work.

## Executed verification

The implementation request explicitly authorized tests and typechecking, replacing
the ticket's earlier no-tests restriction. No production database, repairs,
deployment or activation were performed.

| Check | Evidence |
| --- | --- |
| Red/green IndexedDB transaction abort | Real Chromium: abort after successful `add` initially returned accepted with zero stored records; corrected implementation rejects. |
| Browser storage/worker suite | Six real Chromium tests: enqueue/update aborts; legacy exhausted/old record preservation and reload; real worker messages; actor/context rejection; archive and worker stop/restart; exact intercepted bytes; origin erasure without resurrection. |
| Caller/adapter checks | Hook, popover, worker, sync and context-route tests cover local acceptance failures, durable status reads, both offline endpoints, actual TanStack offline mode, controlling-worker compatibility, status failure after scoped commitment, CASL scope and worker retry/completion. |
| Typecheck | `pnpm --filter webapp typecheck` passed after the existing `generate-licenses` command generated the missing ignored license artifact. |
| Root test command | `pnpm test`: all 29 Docker/runtime tests passed; Turbo then failed to spawn webapp tests with `Exec format error`. |
| Full webapp suite, direct fallback | `pnpm --filter webapp test --maxWorkers=4`: **1004 files passed, 5 skipped; 11145 tests passed, 283 skipped**, including the opt-in Chromium suite. Final review-driven UI/count refinements receive targeted regression checks afterward. |
| Final targeted regression | **9 files / 50 tests passed**, including all six real Chromium cases, both clock callers, worker outcomes, scoped context and offline capture. Rerun after the final metadata/count review refinements. |
| React/UX checks | React Doctor changed-scope comparison against the fixed baseline, including untracked files: **100/100, no issues**. Static Web Interface Guidelines review: semantic controls, dialog focus management, scoped context unmount, overflow/long evidence, reduced motion, hidden-banner inertness and translated fallback copy. Authenticated live-app visual verification remains blocked below. |
| Two-axis review | Independent standards and spec reviewers. Fixed offline mutation pausing, both-endpoint capture, main-widget copy, shared status, explicit read/archive actions and export fencing. Cleanup API finding withdrawn after reviewing inline storage and origin-erasure evidence. Final follow-up addressed unverified offline totals and hidden metadata selectors. |

Browser tests use `Z8_TEST_CHROME_PATH` pointing to an installed Chrome executable.
On minimal Linux hosts, Chrome's shared libraries must also be installed or supplied
through `LD_LIBRARY_PATH`. The suite is explicitly skipped without the executable;
an ordinary skipped run is not client-storage evidence. No new package dependency
was added: the harness uses the existing `puppeteer-core` dependency.

## Authenticated application run (2026-09-24)

Local Next dev server from `feature/267-runtime-evidence` (Phase Development
environment, local PostgreSQL/Redis), driven in the owner's signed-in Edge session
as an organization owner. Offline state was simulated in the page by overriding
`navigator.onLine` and dispatching `offline`/`online` events; the service worker,
IndexedDB, clock UI and server were real. Only browser-local records were created;
no server time entries were written.

| Scenario | Observed |
| --- | --- |
| Context route, signed out | `401 {"error":"Unauthorized"}`, `Cache-Control: no-store`. |
| Context route, signed in | `200`, actor/organization from the real session, membership and employee lookups; `canReviewLegacy: true` for the owner; `no-store`. |
| Worker | Active and controlling at `/`; `GET_VERSION` reports `preservation-only-v1`; scoped `GET_QUEUE_COUNT` returned 0 before capture. |
| Offline clock-in capture (main widget) | Both endpoint buttons and location selectors shown; stored as `review_required`, `commitment: "unknown"`, original evidence with actor, organization, origin and browser timezone; no active period invented. |
| Offline clock-out capture (main widget) | **Defect found and fixed:** with a device/saved timezone mismatch the capture opened the timezone dialog, whose continuation could later run as a server clock-out once online. Offline clock-out now captures directly like clock-in. Re-verified: stored as `review_required` with no dialog. |
| Reload | Saved records survived a full page reload and remained `review_required`. |
| Return online | No time-entry request was sent; banner showed review required with the verified count. |
| Review dialog and archive | Evidence displayed; archiving set `archived` + `archivedAt`, kept original evidence and unknown commitment; banner count decreased. |
| Signed-out page with worker registration failure | **Defect found and fixed:** raw registration errors appeared in the global banner on the login page; they are now reported only with an account recovery context. |

Open findings from this run:

- **Fixed:** the global fixed offline banner (`z-50`, top) covered the app header,
  including the header clock popover trigger, while offline or while records
  awaited review. The banner now renders in flow inside the app shell below the
  header (like the trial and deletion banners) and renders nothing when hidden.
  Re-verified: offline, the header trigger receives the click and opens both
  capture actions. Signed-out routes no longer mount the banner or register the
  worker through it.
- Not exercised: a non-manager account (legacy-record scope), revoked
  membership/session/organization races, export download, worker stop/restart
  while records are pending, and real network loss (only `navigator.onLine` was
  simulated).

## Closure evidence (2026-09-25)

#267 closes on implementation. The scenarios the authenticated run left open were
run where they do not need the shared dev database or a second signed-in account.
The shared dev database lacks the #340+ migrations and was not migrated.

| Scenario | Evidence |
| --- | --- |
| Non-manager scope | `offline-context/route.integration.test.ts` on the disposable PostgreSQL 16 runner. The real route, membership and employee lookups, SSO admission, principal loader and CASL run against the database; only the session is replaced. Owner: `canReviewLegacy: true`. A manager with a direct report and a plain employee: `false`. |
| Revocation | The same suite. After a successful read, a membership set to `pending`, then deleted, returns 403 on the next read. So do a deactivated employee, an active organization the user does not belong to, and a deleted organization. Granted and then withdrawn admin rights flip `canReviewLegacy` on the next read. Every response is `no-store`. A mutation that let a self-scoped grant match unattributed records failed two tests. |
| Real network loss | `offline-queue.browser.test.ts` in real Chromium. `Network.emulateNetworkConditions` takes both the page and the worker target offline (`navigator.onLine` is `false`, and the test server receives no request). The intercepted clock-in is stored as `review_required` with unknown commitment. |
| Worker restart with a pending record | The same test reconnects, stops all workers, reloads and restarts the worker, then triggers sync. No request is sent, and the record is unchanged. |
| Export download | Not run in a browser. Export reauthorization and its dialog/unmount/context fencing are covered by caller tests only. It is part of the #329 pilot click-through. |

The offline queue suite passed 7/7, then both browser suites together passed 12/12 on
two further runs (Chrome, Windows). The PostgreSQL suite passed 7/7.

The remaining obligations below are activation work, not #267 implementation. Each now
lives in its owning ticket:

- 2 (deployed old-consumer control): #329, which carries #266's C266-B register.
- 3 (pilot and release authorization): #329, with rollback in #331.
- 4 (later clock adoption): #275 and #279.
- 5 (hosted Tolgee sync): a release prerequisite recorded on #329. It needs the
  `TOLGEE_*` credentials.

## Unresolved completion/activation evidence

These remain obligations; this implementation commit does not satisfy them:

1. **Actual application/PostgreSQL authorization and recovery context:** route tests
   use real CASL evaluation but substitute session/membership dependencies; the
   Chromium transport fixture substitutes the context endpoint. Actual revoked
   membership/session/organization races and authenticated Next.js UI navigation
   require available application environment, restored database access and login.
   The 2026-09-24 authenticated run above covers the owner path; non-manager
   scope and revocation races remain unverified.
2. **Deployed old-consumer control:** inventory affected browser versions, worker
   registrations/imported scripts and stored queues. Prove effective update/disable
   of destructive consumers, including interrupted upgrades and old-tab coexistence.
   A new registration, build/DB version, optional reload prompt or server error is
   not this proof. Coordinate with the parent activation dossier.
3. **Limited organization pilot and release authorization:** verify preservation
   rollout and actual source/build ownership before expansion. Deployment and
   activation are separate; this source change authorizes neither. If deployment
   precedes activation approval, hold the matching client/worker release at the
   release boundary. Rollback uses a preserving consumer or paused processing,
   never a destructive old queue reader.
4. **Later clock adoption:** negotiated server capabilities, exact submit/outcome
   recovery, intended-period/dependency binding, receipt persistence and safe
   automatic resubmission await their dependent implementation slices and real
   operation/database evidence. This release deliberately retains unknown outcomes
   rather than inventing safe replay or committed receipts.
5. **Translations:** statically extractable keys and English fallbacks are present;
   hosted Tolgee synchronization requires unavailable `TOLGEE_*` credentials.

Keep #267 open for its remaining applicable runtime/activation evidence. Source
review, mocked authorization tests and broad suite success do not close those gates.
