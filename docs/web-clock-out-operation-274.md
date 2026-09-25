# Web clock-out through the completed-work operation (#274 / T10)

## Delivery and activation status

The web `clockOut` action (also used by the mobile time-clock route) now has an
adopted path. Organizations whose `time_entry_append_control` row is `active`
close live work through one completed-work operation,
`lib/time-tracking/close-active-work.ts`. Every other organization keeps the #272
legacy closure unchanged. The same control already gates web clock-in append
admission (#273). Both live clocking writers therefore switch together, and a
mixed state cannot fork the adopted lineage.

Nothing activates in this slice. There is no application setter. The PostgreSQL
suite enables the scope by inserting the control row directly. No receipt is
written and no work revision advances until an organization is activated. The
activation blockers are listed at the end and are tracked in #327, #329 and #331.

Implementation references: [#274](https://github.com/Umami-Creative-GmbH/z8/issues/274),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the
canonical resolutions of [#252](https://github.com/Umami-Creative-GmbH/z8/issues/252#issuecomment-5653113300),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## What the operation owns

`closeActiveWork(context, input)` runs inside the #272 outer transaction
(`withWebClockOutTransaction`). The caller supplies intent and evidence only:

- operation identity: the clock-out submission ID, which is also the clock-out entry ID;
- attribution intent;
- the event instant and its timezone capture.

The caller does not supply a duration, links, a canonical record or a period patch.
In one transaction, the operation:

1. Re-checks membership and the departure clocking gate. An existing entry with the
   operation ID is a collision, because replay was already ruled out.
2. Reads the routed period (locked by the coordinator) and its clock-in entry.
   Anything other than one active, undeleted period is "not clocked in".
3. Derives the duration with `deriveWorkDurationMinutes` (`work-duration.ts`). It
   takes the exact UTC elapsed time, rounds it to the nearest minute half up, keeps
   positive zero-minute work, and rejects equal or reversed endpoints. The period
   and the canonical record store the same value.
4. Resolves attribution. Omission (`undefined`) preserves the period's project or
   category. `null` clears it; the `/api/time-clock` contract and the client now
   accept an explicit `null`, while the current UI only omits or replaces. A value
   replaces it and must exist in the organization (a category must also be
   active). Employee eligibility stays with the action's existing assignment
   validators, which run before the transaction (see blockers).
5. Resolves the surcharge snapshot, plus the break snapshot when approval is
   routed. Then it writes the canonical base, work detail and project allocation,
   with the completing human as `created_by`.
6. Appends the clock-out entry through the shared `appendClockEntry` helper. In
   append mode that is the #273 collaborator (operation `live_clock_out`): exact
   predecessor ID and hash, and a CAS-advanced position. The helper replaces the
   inline clock-in logic, so both writers use one path.
7. Closes the period, guarded by `is_active` and by the source `graph_revision`,
   and advances `graph_revision` by one. The pending-change evidence for the policy
   clock-out is built here, not by the caller.
8. Runs the policy clock-out approval submission when approval was routed, using
   the existing collaborator and context. It then re-reads the committed approval
   state. Routing failure rolls back the whole graph.
9. Commits the work-balance refresh intent (the existing `employee_work_balance`
   dirty marker, now transaction-bound) with the work.
10. Inserts the `completed_work_operation` receipt.

### Actors

The employee owns the work (`owner.employeeId`). The clock-in entry keeps its own
actor, which may be a manager who clocked in on the employee's behalf. The
completing human is the clock-out entry's and the canonical record's creator and
the receipt's `actor_user_id`. The receipt records both actors separately. Actor
kinds are constrained to `human`, `system` and `unknown_historical`. Web clock-out
only ever writes `human`.

## Receipt and replay

`completed_work_operation` is scoped by organization and employee (composite FK to
`employee`). It stores:

- the operation `kind`, the `writer` and `writer_version`;
- the versioned command and the admission mode the operation ran under;
- the actor and the work-period ID;
- the versioned result: identities, the exact segment (UTC endpoints, stored
  minutes, both captured offsets, end zone and source), attribution, work-period
  revisions (source and result), append linkage, the committed approval state and
  participation, and follow-ups.

Work identities are stored by value. The receipt is committed evidence and does not
follow later business changes to the work.

The command (version 1) holds the operation ID, both attribution intents, the
client-supplied instant (null when the server sampled it), the browser timezone and
the device. A retry must carry exactly the same command. Any difference in scope,
kind, writer or command is a collision and never new work. Replay also requires
the committed evidence to stand: a deleted period, a superseded clock-out entry or
a period that no longer points at it is a collision too, matching the legacy
matcher's conflict behavior. Collisions return a distinct message; integrity and
infrastructure failures keep the generic one and are logged.

The receipt key is the bare operation ID. That ID is also the clock-out entry's
global primary key, so it cannot be reused across organizations; the lookup still
verifies organization and employee scope before anything else.

Replay order, in both the replay-only transaction and the fresh transaction:

1. The receipt, in **every** mode. A committed operation still replays exactly after
   an organization returns to legacy.
2. Otherwise, the existing receipt-less legacy matcher
   (`findPolicyClockOutSubmissionEvidence`) with its original rules. It creates no
   receipt and repairs nothing.
3. Otherwise, the fresh closure: the operation in append mode, the #272 closer in
   legacy mode.

A receipt replay returns the original committed outcome, including
`pendingApproval` from the original participation. It is not the current approval
status. It writes nothing and repeats no effects.

## Follow-ups

| Follow-up | Delivery |
| --- | --- |
| Work-balance refresh | Committed intent in the closure transaction; recovered by the existing balance refresh owner |
| Approval notification (pending/approved) | Existing approval owner: legacy post-commit dispatch or the canonical outbox |
| Break enforcement, surcharge calculation, compliance check | Post-commit best effort, unchanged. Durable recovery belongs to #305 and the remaining #327 follow-up adoption |
| Project budget warning, cache revalidation | Best effort; losing them loses no business work |

The receipt lists which follow-ups were required and how each is delivered.

## Coordination additions

The #272 acquisition order is unchanged. The coordinator now reads the append
control under the shared adoption gate (`readAppendAdmission`, shared with clock-in).
It exposes the admission mode and its routed approval decision on the context. After
the routed rows, the operation also writes:

- the employee's `time_entry_append_position` row (`FOR UPDATE`, append mode only);
- the new canonical rows and the clock-out entry;
- the `employee_work_balance` row (the same upsert as before, now in the transaction);
- the receipt.

Every other writer of the position and the balance row takes the exclusive employee
key first, or touches only the balance row. So no writer acquires these rows in the
opposite order.

## Linked cleanup

- Organization and employee deletion cascade receipts.
- `clearOrganizationTimeData`, `deleteNonAdminEmployeesData` and permanent
  organization deletion delete receipts with the history, next to the append
  positions.
- Receipts have no FK to periods or entries. A partial physical delete
  (pending-correction cancellation, demo correction replay, Clockodo/Clockin)
  leaves the receipt as evidence. Retention of cancelled work belongs to #301,
  #306, #285 and #284.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.web-clock-out-operation.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real `clockIn` and `clockOut` actions run on the gated,
label-owned disposable PostgreSQL 16 database. Only the session, headers, billing
provisioning, notification delivery and Next cache are replaced.

Verified (25 tests):

- The complete graph from one closure at 60m40s: the period and canonical record
  both store 61 minutes and the same endpoints. The work detail keeps the location.
  The clock-out entry has an explicit predecessor ID and hash. The position is at
  version 2 with `last_operation = live_clock_out`. The balance is dirty from the
  work date. The receipt has exactly the expected command and result.
- The next clock-in is admitted after the adopted clock-out (version 3, explicit link).
- 29 s stores 0 minutes and 30 s stores 1 minute, in both representations. Equal
  endpoints are rejected with no row changes.
- Attribution:
  - An omitted project set on the active period is preserved in the period and the
    allocation. `null` clears it, and a replacement is written.
  - With a manager-created clock-in, the entry keeps the manager actor, while the
    canonical record and the receipt name the completing requester.
- Exact receipt replay returns the identical result with every row unchanged. A
  changed attribution intent or instant under the same ID is a collision, also
  with no changes. Two concurrent identical submissions give one receipt, one entry
  and one record.
- A receipt-less legacy clock-out retried after activation replays through the
  legacy matcher. It writes no receipt and leaves `graph_revision` at 0. A receipt
  still replays after the organization returns to inactive.
- Injected failures roll back everything (whole-organization snapshot equality).
  Covered writes: canonical record, work detail, allocation, clock-out entry,
  position update, period update, balance intent, receipt, and the approval request
  inserted by forced approval participation (no notification is sent).
- A receipt whose work was later soft-deleted no longer replays; it returns the
  collision message with no changes.
- Forced approval with a manager commits a pending period and record and a receipt
  with `policy_clock_out` participation, and sends one pending notification. Replay
  returns `pendingApproval: true` with no new rows or notifications. Forced approval
  without a manager returns the routing error with no changes.
- A changed tip hash holds the clock-out with `position_tip_changed` and a
  clock-out-specific message, with no changes.
- Receipts are removed by organization time-data cleanup and by employee deletion.

The existing #273 test "holds fresh appends after a non-participating writer" used
web clock-out as its legacy writer. Web clock-out now participates, so that test
now uses the shared legacy closer (`clockingService.clockOut`, the path of direct
HTTP, on-behalf and bots). Run together, the operation, #273 and #272 suites passed
**70/70**. The full runner (`bash apps/webapp/scripts/run-approval-workflow-repository-integration.sh`,
fresh container, migration recovery check and full chain) passed **35 files / 575
tests**. That run predates the `dev` merges that renumbered this migration from
`0081` to `0083`; after each merge the fresh chain and the three clocking suites
passed again. The label-owned containers were verified and removed.

Mutation: flooring the duration and making omission clear attribution failed 5
tests (graph, rounding, attribution, allocation rollback and approval).

### Database-free

- `work-duration.test.ts`: half-up rounding, zero-minute work, per-segment
  rounding, long-interval precision, and equal/reversed rejection.
- `actions/clocking.test.ts`: adopted dispatch (the operation receives preserve
  intents and routed context, the legacy closer is not called, and no best-effort
  balance duplicate is written), explicit clear versus omission with a
  client-supplied instant, and receipt replay before any fresh check. The 5
  date-dependent failures in this file also fail on clean `dev`.
- Full webapp suite: 142 failures, all also failing on clean `dev` (143 there);
  no new failures. `pnpm run typecheck` passed.

## Runtime finding

The legacy #272 closure writes the canonical duration with
`calculateDurationMinutes` (floor) and the period duration with `Math.round`. At 30
or more seconds past the minute they disagree. The legacy replay matcher then
rejects its own committed clock-out as "Submission collision". A retried legacy web
clock-out after about half of all commits therefore returns "Failed to clock out"
even though the work was saved. This is pre-existing on `dev`. The adopted path
derives one duration, so it is not affected. The legacy replay test uses 60m20s.

## Review follow-ups deferred to activation

- Employee project/category eligibility and the policy clock-out approval decision
  are still evaluated before the transaction (inherited from #272). The operation
  re-validates organization scope in the transaction, but the configuration and
  assignment writers do not yet take the configuration guards, so an in-transaction
  re-check would not add protection yet. Participation of those writers is #308
  and #327.
- Canonical-mode approval outbox and workflow writes were not failure-injected here;
  the #272 suite covers canonical submission rollback on the same collaborator.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates, tracked
in #327 (all-writer adoption), #329 (pilot) and #331 (rollback).

- Every competing writer of the same employee graph must participate or be
  drained: direct HTTP (#275), on-behalf (#276), bots (#277), manual (#308), active
  breaks and splits (#304), corrections (#301/#286), imports (#284), demo (#285),
  and ordinary, cron and terminal breaks (#303/#305). Until then, `graph_revision` is
  only advanced by this operation.
- Terminal break-split results: the receipt records the approval outcome and the
  committed approval state, but not split segments. That belongs to #303.
- Durable break-adjustment and surcharge follow-ups (#305 and #327). They are still
  post-commit best effort.
- Web command identity is still generated per click. Durable pre-send capture
  belongs to #279. Mobile uses the same action and command, including its client
  instant (#278).
- Deployment and in-flight inventory, old-writer drain, the scoped pilot and
  compatible rollback (#327/#329/#331). A rollback to inactive keeps replaying
  committed receipts (verified above).
