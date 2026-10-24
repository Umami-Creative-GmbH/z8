# Header clock choices on interaction

Issue [#1469](https://github.com/Umami-Creative-GmbH/z8/issues/1469), part of
[#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

The compact header keeps its current clock and open-break query eager. An unknown
status now shows a disabled Loading clock status control rather than a Clock In
label. A failed status, including failure with a cached clocked-out value, shows
Clock status unavailable and Retry clock status. A bootstrap employee alone is
not treated as evidence that the employee is clocked out.

A closed, untouched popover no longer starts assigned-project, work-category or
full vehicle-choice reads. Opening the popover, focusing its trigger or pointing
at it requests relevant choices. The project/category conditions still follow
whether those booking controls apply. The hooks remain the same query owners used
by the full clock selectors. Their keys now include the signed-in account and
active organization; categories also retain the employee ID. Category choices
have a sixty-second freshness window so a second consumer can reuse a completed
read; project and vehicle choice freshness remain five minutes and sixty seconds.
Public readers and all commands authorize independently of these presentation
caches. New errors provide local retry instead of silently hiding failed choices.

## Operational vehicle use stays eager

The new getClockVehicleUseStatus reader returns only mode and live recorded
attribution. It calls the existing mode resolver and vehicle-column mapping,
selects only the live row's identifier and vehicle fields, and excludes ended or
deleted work in the active organization. It does not load the organization's
vehicle choices, assigned-driver suggestions or historical end readings.

The full context reader continues to load those choices on intent where needed.
A known off policy suppresses that optional read, except where an already recorded
organization vehicle needs its display name. Unknown policy does not become an
artificial dependency that queues a requested choice read. The hook accepts the
newer operational answer from the two shared readers while retaining local drafts.

Vehicle expectations remain visible while choices are loading or failed. An own
vehicle or an entered reading can still be recorded; missing/invalid vehicle
details keep their existing omission and warning behavior. Nothing waits for
vehicle choices before accepting a clock command. Open-break vehicle readings
continue to use the eagerly available live attribution.

Both vehicle READERS now use canonical fresh getAuthContext admission. A red
PostgreSQL case showed that the former basic session/employee path admitted a
synthetic MFA/SSO-required session; both readers now deny it before reading vehicle
data. Approved membership and current employee access are checked again. The
clocking, live-amendment and break command implementations remain unchanged.

The local draft reset no longer separately invalidates vehicle context after a
successful clock command: the clock hook already invalidates status and its
vehicle children. Explicit live-vehicle edits refresh the scoped operational and
choice queries. This gives the normal clock command one refresh owner and keeps
read-your-writes. Project/task/category selections and odometer drafts survive
choice retries. A chosen project's task requirement continues to disable the
online clock-out through list failure/retry; canonical command refusal remains
the server backstop. Driving authorization keeps its independent advisory reader.

Position consent, device capture, command identity, offline admission, request
transport and browser-timezone/event-offset capture were not rewritten. Existing
frozen/offline/position/break tests run with this change. No new date/time business
calculation or historical write path was introduced.

## Verification evidence

- RED: the actual closed TimeClockPopover with real useTimeClock and QueryClient
  started assigned-project reads. GREEN: current status and operational vehicle
  evidence load eagerly while all three choice families remain untouched.
- RED: pending status looked like a disabled Clock In. GREEN: it is explicitly
  unknown/loading, and failed current status has a retry without an active
  Clock In or Clock Out action. Cached clocked-out failure is covered separately.
- Eighteen public component/provider cases cover closed/open/focus/pointer intent,
  known in/out, an open break, current-status hold/error/retry, held and failed
  selectors, driving suspension advice, expected vehicle use during a held list,
  a real /api/time-clock command, shared full-clock selector requests, offline
  adopted capture and non-adopted refusal, required tasks through retry, retained
  odometer input, exactly one post-command vehicle refresh, account/organization
  choice-cache isolation and a known off vehicle policy. Tests mock external
  action/worker/network boundaries, not useTimeClock or the selection hooks.
- Forty-three unit files / 487 cases pass across the time-tracking components,
  clock hooks, operational driving advice, refresh provider, browser commands and
  vehicle-use helpers. Full-clock sharing in the new suite uses its actual public
  selector components and vehicle hook; the production full-page journey remains
  a browser gate below.
- Two PostgreSQL suites / 17 cases pass: nine new operational-reader cases and
  eight existing vehicle/clock/warning cases. New cases use unique lifecycle
  fixture tenants and prove exact live/expected output, narrow JSON round trips,
  no optional choice/history SQL, foreign-organization denial, immediate off-policy
  reads without losing recorded attribution, deleted-work exclusion, MFA/SSO
  admission and inactive/unapproved denial. No database reset or migration runs.
- Phase Development typecheck passes all configured projects. Biome checks pass
  for the fifteen changed source/test files. React Doctor delta from da773971f
  reports 100/100 and no issues; no rule suppression or configuration change.
  The query context and local draft state are separate to keep the hook readable.

## Parent production checks remain open

The parent owns the original and candidate production builds and collectors.
This commit does not claim a measured request, compressed-code or readiness
improvement. The static choice UI imports are retained; direct clock/key imports
replace two barrel imports, but actual transferred bytes must come from the built
candidate. No timing or byte estimate is inferred from source changes.

Stable observations for the mobile/closed-page comparison:

- `[data-clock-status="pending"]`: unknown clock status, disabled loading control.
- `[data-clock-status="unavailable"]`: status error, Retry clock status available.
- `[data-clock-status="ready"][data-clock-choices="deferred"]`: known current
  state and untouched, closed choices. The trigger remains Clock In, Clock Out or
  On break according to the authoritative current status.
- `data-clock-choices="intent"` or `"open"`: choice reads may start. Vehicle
  choices need not start when the eager policy is already off.

Expect getTimeClockStatus to stay eager. Once its employee is known,
getClockVehicleUseStatus stays eager; position-consent settings keep their
existing timing. Expect no getAssignedProjects, getAvailableCategoriesForEmployee
or getClockVehicleUseContext for an untouched closed header. Assigned projects and
categories were already absent while clocked out, so do not claim three removed
requests for every workload. The new operational vehicle request replaces the
former full-context request; its fresh admission work is mandatory. A full clock
may request choices eagerly and share them with the header.

Measure closed-page mobile requests, transferred chunks, main-thread work and
clock readiness on the controlled candidate. Then open/focus the clock, hold/fail
selectors, retry, retain chosen tasks/readings/drafts and exercise known in/out,
break and offline controls. Verify the actual full clock alongside the header and
the unchanged position/timezone/authorization behavior. The parent's live original
and cache-candidate services, collectors and generated inventories were untouched.
