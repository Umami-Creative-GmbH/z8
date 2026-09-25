# Manager on-behalf clock-out through the completed-work operation (#276 / T12)

## Delivery and activation status

`POST /api/time-entries/clock-out-on-behalf` (the calendar's "Clock out employee"
action) now closes another employee's running work through the completed-work
operation `closeActiveWork` in organizations whose `time_entry_append_control` row
is `active`. It shares the #272 web clock-out coordinator and the #274 receipt
store. Every other organization keeps the legacy closer, now inside the same
coordinator.

Nothing activates in this slice. There is no application setter. The PostgreSQL
suite enables the scope by inserting the control row directly. The activation
blockers at the end are tracked in #327, #329 and #331.

Implementation references: [#276](https://github.com/Umami-Creative-GmbH/z8/issues/276),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the
canonical resolutions of [#252](https://github.com/Umami-Creative-GmbH/z8/issues/252#issuecomment-5653113300),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538),
[#263](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

```text
lib/time-tracking/on-behalf-clock-out-request.ts            # request shape and strict parsing (pure)
app/[locale]/(app)/time-tracking/actions/clock-out-on-behalf.ts  # authorization, replay, closure, follow-ups
app/api/time-entries/clock-out-on-behalf/route.ts           # HTTP adapter only
lib/time-tracking/web-clock-out-{transaction,resources}.ts  # acting user separate from the work owner
components/calendar/calendar-view.tsx                       # mints and resends the identity
drizzle/0089_on_behalf_clock_out_writer.sql                 # adds the manager_on_behalf writer
```

## Request

```jsonc
{
  "workPeriodId": "…",      // required: the named running period, never "whatever is active"
  "operationId": "…",       // lowercase UUID, minted once per intended closure, resent on retry
  "projectId": "…" | null,  // omitted = preserve, null = clear, ID = replace
  "workCategoryId": "…" | null
}
```

The calendar mints the identity when the manager first confirms a closure for a
period and resends it on every retry until a 2xx arrives. It is dropped only after
success, so closing and reopening the dialog after a lost response still replays.
Old clients that send no identity keep working (see "Identity-less requests").

## Order of checks

1. Session (401) and active organization (400). The acting human's approved
   membership and active employee record (`access_denied`, 403).
2. The named period and its owner, resolved only in the active organization. Another
   organization's period, a deleted period or an inactive owner is `target_unknown`
   (404).
3. Target authorization through the existing manual-entry target module
   (`resolveManualEntryTarget`): explicit `create TimeEntry` for that employee.
   Owners and admins may close work for any active employee. Managers may close work
   for their direct reports only. Read access is not enough, and one's own work is
   refused here (403).
4. Billing (402).
5. Committed replay of a client identity, in every adoption mode, before any fresh
   check.
6. Fresh checks: the period is still running (`target_not_active`, 409). An explicit
   project or category replacement must be eligible for the **target**
   (`attribution_not_allowed`, 422).
7. The coordinated transaction: replay again, then the operation in `append` mode or
   the legacy closer otherwise.

The target is read before the first replay check. An identical request that commits
in between is therefore found by the replay inside the coordinated transaction. It is
never answered with a late `target_not_active`.

| Status | Body `code` | Meaning |
| --- | --- | --- |
| 201 | – | `{ outcome: "executed", operationId, entry, receipt }` (`receipt` is null in legacy mode) |
| 200 | – | `{ outcome: "replayed", … }`: the original committed outcome, nothing written |
| 403 | `access_denied` | Not authorized for this target, or one's own work |
| 404 | `target_unknown` | No such period in the active organization |
| 409 | `target_not_active` | Already closed (for example by a competing closure) |
| 409 | `collision` | The identity belongs to a different command, actor or work |
| 409 | `invalid_interval` | Server time is not after the clock-in |
| 409 | `append_review_required`, `integrity_review_required` | Held for review, not resent |
| 422 | `attribution_not_allowed` | Replacement not eligible for the target (`field`) |
| 500 | – | `{ outcome: "unknown", operationId }`: resend the same identity |

## What the operation records

The route is a new writer of the #274 operation: `writer = manager_on_behalf`,
writer version 1, command version 1, receipt result version 1.

- **Ownership and actors.** The target employee owns the work (`owner.employeeId`,
  receipt `employee_id`). The acting manager completes it: the clock-out entry, the
  canonical record and the receipt name them (`actors.completing`, `actor_user_id`).
  The clock-in entry keeps its own actor (`actors.clockIn`).
- **Event capture.** The event is captured at the server instant, in the target's
  saved zone, then the organization's zone, then UTC (`resolveManualEntryTargetZone`,
  the same rule as on-behalf manual entries). The source is
  `manager_target_user_setting`. The manager's zone and browser are never used.
- **Entry evidence.** The device stays `web-on-behalf`, as before.
- **Approval.** An on-behalf closure never routes the policy clock-out approval,
  as before adoption. The receipt records `approval: { participation: "none" }`.
- **Command.** The receipt stores
  `{ version: 1, operationId, identity, workPeriodId, project, workCategory }`. A
  retry must produce exactly the same value. Any difference in intent, writer, scope
  or acting user is a collision.

The operation writes the full graph atomically: canonical base, detail and allocation;
the clock-out entry through the append collaborator; the closed period with an
advanced `graph_revision`; the work-balance refresh intent; and the receipt.

### Coordinator change

`WebClockOutTransactionInput` gained `ownerUserId`. When one human acts for another,
the routed resources separate them. The employee row (and its `user_settings`) is
bound to the owner's user. The `member` row is the acting human's approved
membership. Both `user` rows take the configuration/access guards. Self clock-out
passes no `ownerUserId` and routes exactly as before.

## Identity-less requests

Requests without `operationId` come from calendar clients deployed before this change.
They still close the work. In an adopted organization they run the same operation
under a server-generated identity, and the command stores `identity: "server"`. Such
a receipt cannot prove that a later identity-less retry is the same request, so that
retry gets `target_not_active` as before.

## Legacy mode (not adopted)

The legacy closer (`clockingService.clockOut`) now runs inside the same coordinator,
so the admission read and the closure are atomic. It still writes no canonical record
and no receipt. Two bounded corrections apply:

- **Omission preserves attribution.** Before this change the closer cleared the
  period's project and category on every on-behalf clock-out. It now keeps the
  values of the locked period unless the request clears or replaces them.
- **Client identity replays.** A client identity becomes the clock-out entry's ID.
  A retry with the same identity, actor, period and compatible intent replays the
  receipt-less commit. That is also true after the organization is later adopted,
  and no receipt is added.

Post-commit follow-ups for both modes now go through the shared
`completeClockOutAfterCommit`: compliance, break enforcement, surcharges, the balance
refresh (the legacy closure only), the project budget warning and cache revalidation.
A follow-up failure after the commit no longer turns the saved closure into a 500.
Before this change, a failing compliance check returned "Internal server error" for
committed work.

## Linked cleanup

On-behalf receipts share the #274 table and lifecycle. Organization and employee
deletion cascade. `clearOrganizationTimeData`, `deleteNonAdminEmployeesData` and
permanent organization deletion delete them with the history (verified below for
`clearOrganizationTimeData`).

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real route handler, target authorization, coordinator,
operation, append collaborator and follow-ups run on a label-owned disposable
PostgreSQL 16 database with the fresh migration chain through `0089`. The target's
running work is started by the real web `clockIn` action. Replaced: session, billing
provisioning, the server clock, the compliance follow-up (to inject a post-commit
failure) and the Next cache.

Verified (19 tests):

- The complete graph from one closure at 8h0m40s gives 481 minutes in the period and
  the canonical record. The clock-in keeps the target as actor. The clock-out entry,
  canonical record and receipt name the manager. The receipt `employee_id` is the
  target. Capture is `America/New_York` (-240) with `manager_target_user_setting`,
  even though the manager's saved zone is Tokyo. The entry is linked to the exact
  predecessor, the position is at version 2 with `live_clock_out`, the balance is
  dirty, and `graph_revision` goes from 0 to 1.
- Attribution: an omitted project and category are preserved in the period, detail
  and allocation. A replacement not assigned to the target is refused for the project
  and for the category, with no writes. An explicit `null` clears.
- Authorization: an employee without authority, a manager closing a non-report's work
  and a manager closing their own work get 403. Another organization's period gets
  404. No session gets 401. None of them write. An organization owner with the
  employee role may close any active employee's work.
- Exact replay 30 hours later returns the identical body with status 200 and no
  writes. A changed intent under the same identity is a collision, and so is the same
  identity from another authorized actor. A receipt still replays after the
  organization returns to inactive.
- Post-commit failure: with the compliance follow-up throwing, the closure still
  returns 201. Resending the identity returns the original outcome with no writes.
- Competing closures with different identities give one 201 and one
  `target_not_active`, with one receipt and one clock-out entry. Three concurrent
  identical submissions give one 201 and two 200 with the same receipt.
- Injected failures on the canonical record, detail, allocation, clock-out entry,
  position update, period update, balance intent and receipt each roll back the whole
  graph (organization snapshot equality) and return 500 `unknown`. Resending the same
  identity afterwards commits once.
- Identity-less requests commit a receipt with `identity: "server"`. A second
  identity-less request gets `target_not_active`.
- Legacy mode: no receipt, `graph_revision` stays 0, the project is preserved, the
  capture uses the target zone, and the entry ID is the client identity. The same
  identity replays; a changed intent is a collision; after adoption the receipt-less
  commit still replays with no writes.
- `clearOrganizationTimeData` removes on-behalf receipts.

Mutations, each caught by the suite: using the actor's zone, dropping
the actor check on receipt replay, clearing attribution in legacy mode, skipping
target authorization, skipping the own-work refusal, dropping the legacy matcher, and
skipping target eligibility for project replacement. A recheck-after-refusal branch
copied from #275 was removed because no ordering reaches it: the replay inside the
coordinated transaction already covers the race.

Run together with the #272, #273, #274, #275, #277, offline-context, approval-evidence
and clocking-access suites: **9 files / 254 tests passed**.

### Database-free

- `route.test.ts`: HTTP adapter only. Strict body parsing (400 before the session is
  read), outcome and rejection mapping, the billing response and the `unknown` 500
  carrying the identity to resend.
- `calendar-view.test.tsx`: the calendar posts the period and its identity. It resends
  the same identity after a 500 and after a network failure, and mints a new one only
  after success. Removing the reuse fails the test.
- `clocking-writers.test.ts`: the on-behalf module reaches `closeActiveWork` and the
  shared legacy closer; the route holds no database access.

## Remaining activation blockers

This slice closes on implementation. Activation items move to #327, #329 and #331.

- **Authorization inside the transaction (#327/#308).** Target authorization (manager
  relationship, employee and organization roles) and target eligibility are evaluated
  before the transaction, as for #274. The coordinator guards both `user` rows and
  locks the acting member row. Manager-assignment, role and project/category writers
  do not take those guards yet, so re-checking inside the transaction would add no
  protection until they participate.
- **Other writers (#327).** The remaining non-participating writers of the same graph
  are still listed in [web-clock-out-operation-274.md](web-clock-out-operation-274.md).
  On-behalf closure is no longer one of them in adopted organizations.
- **Deployed calendar clients (#329).** Old bundles send no identity. They close work
  correctly but cannot recover a lost response. After deployment, their inventory and
  drain is part of the client-adoption gate.
- **Departed owners.** A receipt for work whose owner has since become inactive
  cannot be replayed through this route: the target resolves as `target_unknown`.
  The same holds for self clock-out replay, whose coordinator routing requires an
  active employee.
- **Shared follow-ups (#305/#327).** Break enforcement, surcharges and compliance stay
  post-commit best effort.
- **Rollback (#331).** Returning an organization to inactive keeps committed receipt
  replay (verified) and falls back to the coordinated legacy closer.
