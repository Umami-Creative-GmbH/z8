# Atomic desktop break close/resume (#281 / T17)

Contract: [#281](https://github.com/Umami-Creative-GmbH/z8/issues/281),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#263 §8](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538),
[#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
Builds on the server transport of [#275](direct-clock-commands-275.md) and the desktop
frozen commands of [#280](desktop-clock-commands-280.md).

## Delivery and activation status

When a desktop user answers "I was on break", the app now sends one version 2 `break`
command. The server closes the intended work at the idle start and resumes work at the
detected return in one transaction: both happen, or neither does.

This is gated like every #275 command. The server accepts fresh `break` commands only
for organizations whose `time_entry_append_control` is active, and no code sets that.
The desktop freezes a break only when the server's capabilities list the `break` kind.
Everywhere else, including all of production today, the #268 two-request break keeps
running unchanged.

```text
apps/webapp/src/lib/time-tracking/clock-command.ts      # `break` shape, endpoint/observation rules, clock continuity
apps/webapp/src/lib/time-tracking/close-resume-work.ts  # the operation: close graph + start graph + one receipt
apps/webapp/src/lib/time-tracking/work-period-review.ts # unresolved-review guard, shared with #286 amendments
apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clock-command.ts  # submit/replay/lookup of breaks
apps/webapp/drizzle/0097_close_resume_work.sql          # widens the receipt kind check
apps/desktop/src-tauri/src/break_evidence.rs            # observations, idle tracker, continuity rule
apps/desktop/src-tauri/src/frozen_command.rs            # freeze_break
apps/desktop/src-tauri/src/clock_command.rs             # route, target binding, legacy fallback
apps/desktop/src-tauri/src/idle.rs, commands.rs, state.rs  # native wiring; the webview only names the span
apps/desktop/src/components/IdleDialog.tsx              # proposes idle start to detected return
```

## The frozen break command

```jsonc
{
  "version": 2, "operationId": "…", "kind": "break", "admission": "delayed",
  "occurredAt": "…Z",             // the detected return: where work resumes
  "timezone": "Europe/Berlin",    // zone read at the return
  "context": { … },               // as in #275
  "target": { "workPeriodId": "…" } | { "clockInOperationId": "…" },
  "workLocationType": "office",   // location of the resumed work
  "breakStart": { "at": "…Z", "timezone": "Europe/Lisbon" },  // the close endpoint
  "observations": {
    "lastActivity":   { "utc": "…Z", "monotonicMs": 7200000 },
    "idleDetected":   { "utc": "…Z", "monotonicMs": 7503000, "timezone": "Europe/Lisbon" },
    "returnDetected": { "utc": "…Z", "monotonicMs": 8995333, "timezone": "Europe/Berlin" },
    "confirmed":      { "utc": "…Z", "monotonicMs": 9295333 }
  }
}
```

The exact bytes the desktop sends are pinned in
`apps/desktop/src-tauri/tests/clock-core/fixtures/desktop-v2-break.json`. The Rust
fixture test produces them, and the webapp parses the same file.

- **Endpoints.** The break starts at the last input before idleness. That is an estimate,
  and the observations name it `lastActivity`. The break ends at the first input after
  idleness (`returnDetected`), never at the later dialog answer (`confirmed`). A return at
  10:15 that is confirmed at 10:20 resumes at 10:15.
- **Zones.** Each endpoint has its own zone. The start zone is the one read when idleness
  was detected; the return zone is read at the return. The return zone is never used as the
  start zone. The server derives each endpoint's offset from its own zone.
- **Consistency.** The endpoints must equal the observations they claim to be:
  `breakStart.at = lastActivity.utc`, `breakStart.timezone = idleDetected.timezone`,
  `occurredAt = returnDetected.utc` and `timezone = returnDetected.timezone`.
  Monotonic readings never decrease. Anything else is `invalid_command` (400).
- **Clock continuity.** Between consecutive observations, elapsed wall time and elapsed
  monotonic time may differ by at most 2 s plus 1 ms per monotonic second. A larger
  difference means the wall clock changed while the device was idle, so the interval is
  uncertain. The desktop then records nothing and asks for a time correction in Z8. The
  server refuses such a command with `clock_discontinuity` (422), which names the first
  observation after which the clocks disagree. Both sides apply the same rule, pinned by the
  same boundary numbers in `clock-command.test.ts` and `break_evidence_tests.rs`.
- **Missing capture.** If the device zone could not be read at idle detection or at the
  return, the desktop does not freeze a break. The dialog offers only "Continue" and asks
  for a time correction instead.

## The operation

`closeAndResumeWork` runs inside the existing clock-out owner (`withWebClockOutTransaction`).
That owner takes the adoption gate, the append control, the policy clock-out write gate,
the configuration and access guards, the employee key and the routed row locks. Within
one transaction, the operation:

1. Refuses the target while it has unresolved review: a pending ordinary approval, or a
   pending legacy or canonical time correction (`review_pending`, 409). The guard is the
   one #286 amendments use, now in `work-period-review.ts`.
2. Closes the target through `closeActiveWorkGraph` at the break start, with the start
   zone. This covers the canonical record, the append progression, the closed period,
   the policy clock-out approval participation and the work-balance intent. Attribution
   is preserved. The clock-out entry gets a fresh server identity.
3. Starts the resumed work through `startLiveWorkGraph` at the return, with the return
   zone. Symmetric half-open occupancy runs after the close, so the closed target no
   longer occupies the interval and any other work still does (`occupancy_conflict`).
   The resumed clock-in entry takes the operation ID, so a later command binds the
   resumed work as `{ "clockInOperationId": <break operation> }`.
4. Writes one `completed_work_operation` receipt with `kind = close_resume_work` and
   `writer = direct_http`. Its `work_period_id` names the closed source period; the
   result holds the full close result and the full start result.

`closeActiveWork` and `startLiveWork` are now thin wrappers: each runs its graph function
and writes its own receipt. Their behavior and receipts are unchanged.

A failure at any step rolls back every write. Before the transaction, the server checks
the target (`target_unknown` / `target_not_active`, never a different active period),
delayed admission for the idle start, the return and the confirmation, holidays in each
endpoint's own zone, and the approval decision. Replay, lookup and the race recheck work
as in #275: an exact committed receipt replays without writes and returns no post-commit
advice; a changed command under the same identity is a `collision`. Lookup reports
`standing` only while both the closure and the resumed start still stand.

After the commit, the closure gets the same follow-ups as a clock-out:
compliance, break enforcement, surcharges and approval notification.

## Desktop

- **Observation.** `IdleTracker` pairs every observation with a monotonic reading. It
  detects idleness after five minutes while the user is clocked in, reading the zone at
  that moment. The first input after idleness is the return, with the zone read then.
  Clocking out while idle drops the span. Native state keeps the span. The webview gets
  an `IdleEvent` (`id`, start, return, duration, `review`) and confirms by `id` only, so it
  cannot change the interval. The confirmation instant is observed first in the native
  command. "I was still working" discards the span.
- **Route.** A break is frozen only when the context accepts frozen commands and the
  capabilities list `break`. It is then saved before its first send and sent in capture
  order like every #280 command, with lookup before any resend.
- **Target.** An unsent clock-in or break is the target (`clockInOperationId`), else the
  period last seen for this employee. A clock-out or clock-in after an unsent break treats
  the break as resumed work: the clock-out targets the break's operation, and a clock-in is
  refused ("already clocked in").
- **Journal.** An unsent break projects as clocked in since the return. `breaksEnabled`
  tells the UI that a break can be saved even with unsent actions or while offline. Saved
  breaks are listed as "Break, work resumed" at their return time and zone.
- **Legacy fallback.** A server that takes frozen clock-in/out but not `break`, or that does
  not take frozen commands at all, gets the unchanged two-request break. That break still
  resumes at request time, which is the #268 behavior. It is still refused while commands
  of the current context are unsent, and it is never sent for evidence with a clock
  discontinuity.
- **Legacy partial breaks.** Retained two-request break rows still block every clock action,
  including the atomic break. They are never replayed as close then resume, and never
  assumed uncommitted. The recovery summary now counts them
  (`possiblePartialBreaks`), and the recovery notice shows that count.

## Verification (2026-09-25)

**PostgreSQL** (disposable PostgreSQL 16 via the label-owned runner, fresh migration chain
through `0097`): `commands/route.integration.test.ts` **24/24**, including 6 new break
scenarios through the real route handlers:

- One committed close/resume: the close ends at the idle start
  (12:00:05.123, Lisbon, +60) and the resume starts at the detected return
  (12:30:00.456, Berlin, +120), not at the confirmation. The resumed entry follows the close
  entry, which follows the clock-in, and the append position reaches version 3. The receipt,
  work-balance intent and graph revisions are as described above. Replay nine days later
  writes nothing. Lookup reports `standing`. A changed confirmation under the same
  identity is a `collision`. A later clock-out binds the resumed work through the break's
  operation ID. Soft-deleting the resumed work turns lookup `changed`. Organization cleanup
  removes the receipt.
- Failure injected (PostgreSQL trigger) at each of ten writes: canonical record, work
  detail, close entry, close append position, closed period, work-balance intent, resume
  entry, resume append position, resumed period and receipt. Every attempt returns
  `unknown` (500), leaves every row unchanged and looks up as `not_committed`. The exact
  resend then executes, and a further resend replays without writes.
- Required approval: an injected `approval_request` failure rolls back both endpoints, and
  no notification is sent. The resend commits the close as `pending` with its approval
  participation, and the resumed work is active.
- Refusals without writes: completed work occupying the resumed interval gives
  `occupancy_conflict`, and the close is rolled back with it. A break starting before its
  target gives `invalid_interval`. A pending approval on the target gives `review_pending`.
  A stale target gives `target_not_active`, and newer active work is not touched. An unknown
  target gives `target_unknown`.
- A wall-clock jump gives `clock_discontinuity`, and an endpoint that does not match its
  observation gives `invalid_command`. The idle start 7 days + 1 ms back is `too_old`, and a
  confirmation 5 minutes + 1 ms ahead is `in_future`.
- Three concurrent identical breaks: one 201 and two 200 with the same receipt, and one
  closed plus one active period.
- The desktop fixture, shifted two days back as if captured offline, commits against the
  desktop clock-in fixture.

Mutations, each run against the break scenarios on PostgreSQL:

| Mutation | Result |
| --- | --- |
| Dropping the unresolved-review guard | failed its test (`review_pending`) |
| Closing at the return instead of the idle start | failed 3 tests |
| Swallowing a refused resume, so the close commits alone | failed its test (`occupancy_conflict`) |
| Skipping the clock-continuity check | failed its test |

An injected PostgreSQL error aborts the whole transaction even if the code swallowed it,
so the trigger scenarios cannot detect a swallowed resume. The occupancy refusal, a
typed business error, can.

**Unit.** `clock-command.test.ts` **43/43**: break shape, endpoint/observation consistency,
the continuity boundary, and the fixture parse.

**Desktop core** (`pnpm --filter desktop test:clock`, Windows): **61 passed**. It compiles
the real `break_evidence.rs` and `frozen_command.rs` as well as the #280 modules.

- The idle tracker records the last input, the detection zone, and the first input after
  idleness with its own zone.
- Clocked-out spans are dropped. Unreadable zones and wall-clock changes require review.
  The continuity boundary matches the server's.
- The break freezes the pinned fixture bytes, and uncertain evidence is not frozen.
- An online break is one `POST /commands` whose bytes were durable before sending. It is
  never two legacy requests. It targets the period last seen and resumes at the return.
- Offline, a break binds the queued clock-in, the next clock-out binds the break, and a
  clock-in after it is refused. After a restart all three go out in order.
- The journal projects a saved break as clocked in since the return.
- Uncertain evidence is refused before anything is saved or sent.
- A retained legacy partial break blocks the atomic break without touching the row, and the
  summary counts it.
- A server without `break` keeps the two-request break, closing at the idle start.
- The #268 legacy break tests pass through the new command shape.

Desktop mutations, each against the whole suite:

| Mutation | Result |
| --- | --- |
| The latest input, not the first, becomes the return | failed 1 test |
| Resuming at the confirmation | failed 3 tests |
| A break after a queued break targets the last seen period | failed 1 test |
| Clocks always agree | failed 4 tests |

**Desktop app.** `cargo check` of the full Tauri crate passes on Windows with the 5
existing warnings and no new ones. `tsc --noEmit`, `vite build` and
`node --test scripts/*.test.mjs` pass.

## Remaining activation blockers

This slice closes on implementation (see the #264 decision). These items move to #327,
#329 and #331:

- **Native runtime and installed client (#329).** The rdev input listener, the Tauri
  IPC and the dialog in a running, installed app were not exercised. Neither were sleep
  and hibernate, which platforms count differently in monotonic time, so a suspended
  device may be judged discontinuous and routed to review. The idle tracker, the caller,
  the device store and HTTP are verified in the core harness, and the server on
  PostgreSQL.
- **Legacy two-request break (#327).** The legacy transport still resumes at request time,
  not at the detected return, because the identity-less legacy route would accept a
  backdated clock-in without an age limit. Where the server does not offer `break`, that
  break stays a non-participating writer, and its partial failures still produce
  identity-less rows. Gating it server-side remains #327's.
- **Legacy partial-break resolution (#329).** Retained rows are counted and block
  clocking. Their evidence-based reconciliation (which of close and resume committed, from
  server history) needs the authorized recovery protocol; ownership cannot be established
  from a current login.
- **Zone provenance (#329).** Like every v2 command, break endpoints are stored with the
  `browser` timezone source. The command records which observation each zone came from,
  but the entries cannot say "desktop, read at idle detection" without a versioned server
  change.
- **Deployed desktop inventory (#327).** #280 binaries do not know the `break` kind. When
  a store holding a break row is downgraded to such a binary, it fails to read the saved
  commands and pauses clock actions. It does not lose them. Committed break rows are
  pruned after 30 days.
- **Rollback (#331).** Returning an organization to inactive keeps break lookup and replay,
  and refuses fresh breaks without writing. A server rollback to a release without
  `close_resume_work` must keep its receipts readable, or lookups for committed breaks
  fail. The receipt kind check in `0097` must stay.
