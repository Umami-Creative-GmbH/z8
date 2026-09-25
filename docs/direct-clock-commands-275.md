# Frozen direct-HTTP clock commands (#275 / T11)

## Delivery and activation status

Direct-HTTP clients get a versioned transport next to the legacy
`POST /api/time-entries`:

| Route | Purpose |
| --- | --- |
| `GET /api/time-entries/commands` | Capabilities and the server-derived context a client captures into each command |
| `POST /api/time-entries/commands` | Submit one frozen version 2 command |
| `GET /api/time-entries/commands/{operationId}` | Lookup-only recovery of that command's outcome |

Fresh submission is gated with the same per-organization `time_entry_append_control`
row as #273 and #274. No code sets it, so production accepts no fresh command yet:
capabilities report `submit: "unavailable"` and a fresh command returns
`not_adopted` without writing. Lookup and committed replay work in every mode.

Implementation references: [#275](https://github.com/Umami-Creative-GmbH/z8/issues/275),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#263](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538),
[#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

```text
lib/time-tracking/clock-command.ts             # v2 shape, age windows, context check (pure)
lib/time-tracking/start-live-work.ts           # start operation + start_live_work receipt
lib/time-tracking/close-active-work.ts         # now writer-parameterized (web_clock_out, direct_http)
app/[locale]/(app)/time-tracking/actions/clock-command.ts  # submit + lookup orchestration
app/api/time-entries/commands/...              # HTTP adapter
drizzle/0084_direct_clock_commands.sql         # widens receipt kind/writer checks
```

## The frozen command (version 2)

The client freezes the command before its first attempt and resends exactly the same
JSON value under the same identity until it knows the outcome. The server stores it
verbatim in the receipt; replay compares it field by field, so any difference is a
collision, never new work.

```jsonc
{
  "version": 2,
  "operationId": "…",            // lowercase canonical UUID; also the entry ID
  "kind": "clock_in" | "clock_out",
  "admission": "immediate" | "delayed",
  "occurredAt": "2026-09-20T10:00:00Z", // UTC, at most millisecond precision
  "timezone": "Europe/Berlin",   // event-time IANA zone; the server derives the offset
  "context": { "userId", "organizationId", "employeeId", "server" },
  // clock_in
  "workLocationType": "office" | "remote" | "home" | "other",
  // clock_out
  "target": { "workPeriodId": "…" } | { "clockInOperationId": "…" },
  "project":      { "kind": "preserve" } | { "kind": "clear" } | { "kind": "replace", "id": "…" },
  "workCategory": { "kind": "preserve" } | { "kind": "clear" } | { "kind": "replace", "id": "…" }
}
```

- The schema is strict. Unknown fields, client offsets, aliases, offset instants,
  uppercase UUIDs and omitted intents are rejected (`invalid_command`, 400). Any other
  `version` is `unsupported_version` (422), so a client pauses instead of downgrading.
- `context` holds consistency assertions only. The server derives the user, the active
  organization, the employee and the public origin (`resolvePublicRequestOrigin`), and
  every disagreeing field is named in `context_mismatch` (409). A client never
  resubmits into a different organization by dropping the field.
- A clock-out binds to a known period or to the clock-in operation that created it.
  The target is resolved in the authenticated organization and employee. A missing
  target is `target_unknown`; a closed or deleted target is `target_not_active`. The
  server never falls back to whichever period is active now.
- Attribution intent keeps omission (`preserve`), clearing and replacement distinct.
  Replacement keeps the existing employee eligibility validators.
- The event zone is recorded with the existing `browser` source (captured by the
  client at event time). The command has no finer provenance field yet. Distinguishing
  device, extension and desktop capture is a client-adoption follow-up (#329).

## Order of checks

1. Session (401), current membership and active employee (`access_denied`, 403),
   context assertions (409), billing (402).
2. Committed replay by receipt, in every adoption mode. It runs before any fresh check,
   so it is independent of the server clock, holidays, occupancy and append admission.
   An existing `time_entry` with the operation ID but no matching receipt is a
   collision, because each v2 operation writes its receipt with its entry.
3. Fresh admission, measured from the authoritative server instant:

   | Mode | Past | Future |
   | --- | --- | --- |
   | `immediate` | 5 minutes | 5 minutes |
   | `delayed` | 7 elapsed days | 5 minutes |

   Outside the window: `admission_window` with `too_old` or `in_future` (422).
   Older uncommitted work stays with the client for review.
4. Holiday validity in the event zone, target resolution, attribution eligibility and
   the policy clock-out approval decision (as in #274).
5. The fresh transaction, through the existing owners: replay again, then refuse with
   `not_adopted` unless the append control is active, then the operation.

If a fresh attempt is refused after step 2, the server repeats the replay check before
it answers. An identical request may have committed in between, which makes a preflight
read such as the close target stale. In that case the committed receipt is returned
(`replayed`), not the late refusal (`target_not_active`).

Committed evidence the operation cannot interpret, such as an unsupported receipt version
or an active period without its clock-in entry, is `integrity_review_required` (409). It
is held for review, not resent.

A thrown error returns `{ "outcome": "unknown" }` (500). The client looks the command up
and, if it is not committed, resends the same command. It never mints a new identity
for the same action.

## Operations and receipts

Both kinds commit a `completed_work_operation` receipt with `writer = direct_http`
(writer version 1) and command version 2. There is no second receipt store.

- **Start (`start_live_work`, new).** `startLiveWork` runs in the #273 clock-in owner
  (`withWebClockInTransaction`). It re-checks membership and the departure gate, and
  refuses an existing entry with the ID. It enforces half-open occupancy: other
  undeleted active work gives `already_clocked_in`, and completed work ending after the
  start gives `occupancy_conflict`, while adjacency is allowed. It then appends the
  entry through `appendClockEntry`, opens the period and writes the receipt.
- **Close (`close_active_work`).** `closeActiveWork` from #274, unchanged apart from
  taking its writer from the caller, runs in the #272 clock-out owner with the resolved
  target period. The post-commit follow-ups now live in
  `completeClockOutAfterCommit`, which the web action and this adapter share. The
  receipt result version stays 1.

Replay returns the original receipt only while its evidence stands. A superseded
entry, or a period that was deleted or no longer points at the entry, is a collision.

## Lookup-only recovery

`GET /api/time-entries/commands/{operationId}` runs under the same coordination as a
clock-in: the shared adoption gate, configuration and access guards, then the exclusive
employee key. A lookup therefore waits for any in-flight operation of that employee. It
reads and never writes.

| Outcome | Meaning |
| --- | --- |
| `committed` | Receipt of this employee's direct-HTTP command, with the stored command and `evidence: standing \| changed` |
| `not_committed` | No commit is serialized before this lookup. Resend the same command; a request still before its transaction may commit later and then replays |
| `conflict` | The identity belongs to other work or another scope. No details are disclosed |

`not_committed` is established only for version 2 identities, which always commit a
receipt with their entry. It says nothing about identity-less legacy requests.

Lookup answers for the session's active context, and takes no context assertion. A
client whose captured context differs from the current session (another organization,
account or server) pauses and does not look up; in the wrong context its own receipt
reads as `conflict`. The `conflict` versus `not_committed` distinction reveals only
whether a random operation UUID is in use somewhere.

## Legacy `POST /api/time-entries`

Unchanged, except that historical committed recovery now precedes fresh age admission.
An action ID that already committed as an entry in the caller's organization and
employee skips the 5-minute/7-day capture window and its offset check. The request then
reaches the clocking service, whose legacy matcher is unchanged (clock-in returns the
committed entry; clock-out compares project and category). Session, membership,
departure preservation, billing, evidence completeness and project/category checks
still run first. Identity-less requests keep their current rules. There is no strict
admission for them, because no client control exists yet.

Project and category eligibility also still run before the legacy replay, as before
this change. A committed legacy clock-out retry can therefore still be refused if the
employee's assignment changed after the commit. Moving those checks behind replay would
change the legacy matcher's inputs, so this slice leaves it alone. It is listed with the
activation blockers.

## Linked cleanup

Start receipts share the #274 table, so the existing lifecycle applies. Organization
and employee deletion cascade. `clearOrganizationTimeData`, `deleteNonAdminEmployeesData`
and permanent organization deletion delete receipts with the history (verified for start
receipts below).

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/api/time-entries/commands/route.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real route handlers, coordinators, operations and append
collaborator run on the gated, label-owned disposable PostgreSQL 16 database (fresh
migration chain including `0084`). Replaced: session, billing provisioning,
notification delivery, the public-origin resolver, the server clock and the Next cache.

Verified (16 tests):

- Capabilities report the server-derived context. `submit` follows the append control.
- Clock-in: entry ID = operation ID, server-derived offset (+120 for Berlin), `api`
  device, position v1 `live_clock_in`, receipt with the verbatim command. The same
  command replays with every row unchanged.
- The same identity with a changed instant, location, admission or kind is a collision
  with no writes.
- Clock-out bound to the clock-in operation: 8h0m40s gives 481 minutes, the entry is
  linked to the exact predecessor, the project is replaced, and the receipt is written.
  Replay nine days later returns the identical receipt with no writes.
- A clock-out that targets an already closed period (by operation or period ID) is
  `target_not_active`, and an unknown operation is `target_unknown`. The newer active
  period stays open.
- Age boundaries ±5 minutes + 1 ms (immediate) and 7 days + 1 ms / 5 minutes + 1 ms
  (delayed) are rejected with no writes. A delayed start and close exactly 7 days back
  are admitted. The same instant sent as immediate is rejected.
- Occupancy: a delayed start one minute inside completed work is refused, an adjacent
  start is admitted, and a start while active is `already_clocked_in`.
- Context: organization, employee, user and server mismatches are refused with the
  field names. An organization switch without an employee is `access_denied`. Nothing
  is written.
- Without adoption (inactive or missing control row), fresh commands are `not_adopted`
  with no writes, and a committed receipt still replays.
- Lookup: committed with command and `standing`; `not_committed` for unknown and for
  rejected identities; `conflict` for another employee; `changed` after the period is
  soft-deleted (a resend is then a collision); 401 without a session.
- Two concurrent identical clock-ins: one 201, one 200, one receipt. Three concurrent
  identical clock-outs: one 201, two 200 with the same receipt, one closure.
- Race: an identical clock-out commits between a retry's replay check and its target
  read (forced through a validation hook). The retry returns the committed receipt as
  `replayed`. Without the recheck it returned `target_not_active` (verified red).
- Organization time-data cleanup removes start receipts.
- Legacy route: a committed extension action ID resent eight days later replays the
  original entry with no writes.

Mutations: moving the age check before replay, dropping completed-work occupancy and
closing "the active period" instead of the target each failed exactly their test.

The #272, #273 and #274 suites, offline-context and this suite passed together
**95/95**. The full runner (`bash apps/webapp/scripts/run-approval-workflow-repository-integration.sh`,
fresh container, migration recovery check and full chain through `0084`) passed
**38 files / 617 tests**. The label-owned container was verified and removed.

The full unit suite has 143 failures, all environmental and matching clean `dev`: CRLF
source checks, `pnpm` missing from subprocess `PATH`, Windows path separators and
date-dependent tests. One source-string test was updated to follow the extracted
`completeClockOutAfterCommit`. `pnpm run typecheck` passes.

### Database-free

- `clock-command.test.ts`: strict shape, unsupported versions, inclusive window
  boundaries and context comparison (22 tests).
- `route.test.ts` (legacy): committed action-ID recovery beyond the window, the window
  kept without a committed entry, and billing still ahead of recovery.

## Finding fixed on the way

The adopted web clock-out (#274) computed its committed surcharge snapshot, but the
post-commit reconciler only read the legacy path's variable, so adopted clock-outs never
calculated immediate surcharges. The shared `completeClockOutAfterCommit` uses the
outcome's snapshot for both paths. This path is inactive in production.

## Remaining activation blockers

This slice closes on implementation. Activation items move to #327, #329 and #331.

- **Legacy direct writer (#327).** Identity-less and action-ID requests to
  `POST /api/time-entries` still write through the shared legacy closer and legacy head
  selection. In an adopted organization they are a non-participating writer. They must
  be drained or gated before activation, and the #266 fence must keep old queue readers
  from deleting rows when that happens.
- **Client adoption (#329).** No client sends version 2 yet. Browser (#279), mobile
  (#278), desktop and extension adapters must freeze commands before the first attempt,
  persist the receipt before leaving the active queue, and pause on `context_mismatch`,
  `not_adopted`, `unsupported_version` and `unknown`. Deployed-client inventory and
  effective update or disable control for old destructive consumers are required before
  strict admission.
- **Lookup fencing.** `not_committed` is not a tombstone. A request that is still
  before its transaction can commit after a lookup. That is safe for clients that only
  resend the same identity, and client adapters must keep that rule.
- **Legacy committed-retry ordering (#327).** On `POST /api/time-entries`, project and
  category eligibility still precede the legacy replay (see above).
- **Desktop atomic break close/resume (#263 §8)** is a separate operation and not part
  of this transport.
- **Shared follow-ups (#305/#327).** Break enforcement and surcharges stay post-commit
  best effort.
- **Rollback (#331).** Returning an organization to inactive keeps lookup and committed
  replay (verified) and refuses fresh commands without writing.
