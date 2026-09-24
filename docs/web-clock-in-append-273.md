# Live clock-in append admission (#273 / T09)

## Delivery and activation status

The web `clockIn` action now runs inside its own outer transaction owner,
`lib/time-tracking/web-clock-in-transaction.ts`, and fresh clock-ins in an adopted
organization go through one internal append collaborator,
`lib/time-tracking/time-entry-append.ts`. Callers never choose the head.

Admission stays **inactive**. The per-organization `time_entry_append_control` row
decides the mode; no row, or `mode = 'inactive'`, keeps the legacy latest-created
head selection unchanged. There is no application setter. The PostgreSQL suite
enables the scope by inserting the row directly. Activation still needs the parent
gates listed at the end.

Implementation references: [#273](https://github.com/Umami-Creative-GmbH/z8/issues/273),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Acquisition protocol

Clock-in has no approval participation. One transaction acquires, in order:

1. Shared `JSON.stringify(["completed-work-adoption", organizationId])`, then reads
   the organization's append control under it. An exclusive adoption holder
   therefore drains in-flight clock-ins before a mode change becomes visible.
2. Shared `JSON.stringify(["work-organization-configuration", organizationId])`.
3. Shared `JSON.stringify(["work-user-configuration-access", userId])` for the requester.
4. The existing exclusive employee key `hashtextextended(employeeId, 0)`.
5. In append mode, the employee's `time_entry_append_position` row `FOR UPDATE`.

The key builders now live in `lib/time-tracking/work-transaction.ts` and are shared
with the web clock-out coordinator (#272). Their SQL and order are unchanged there.
Both coordinators hand the clocking core a sealed `WorkTransactionScope`.

## Admission contract

`lib/time-tracking/append-lineage.ts` classifies the complete organization/employee
history read-only. That includes retained superseded, cancelled and rejected rows.

- An explicit predecessor ID must resolve in scope, and that row's stored hash must
  equal `previousHash`. A dangling or contradictory ID is never swapped for a
  hash match.
- A missing ID is derived only when exactly one other same-scope row carries the
  hash. Several candidates remain ambiguous.
- Every hash must reproduce under the standard serialization. Unknown provider
  formats, such as retained Clockodo bytes, are unverified.
- `""` and literal `"genesis"` predecessor hashes are not roots.
- Forks, multiple roots (islands), holes, cycles, self-reference and foreign rows are
  reported with the relevant IDs.
- Event time, creation time, UUID order, period pairing and supersession are never
  used. The result does not depend on input order.

Admission (`admitTimeEntryAppend`):

| Evidence | Outcome |
| --- | --- |
| No position, no entries, no work in scope | Admit a root: both predecessor fields null, admission `empty_history` |
| No position, no scoped entries, but scoped work exists | Review: `history_without_entries` |
| No position, one verified lineage | Append to its exact tip, admission `verified_lineage` |
| No position, anything else | Review with the classifier's issues |
| Position whose tip exists in scope with the recorded, reproducible hash, and whose entry count matches | Append to the recorded tip |
| Position whose tip is missing or changed, or whose entry count differs | Review: `position_tip_missing`, `position_tip_changed`, `unexpected_history_change` |

Duplicate hashes are not a failure by themselves. The standard hash commits
`previousHash`, so equal hashes always sit on separate branches or components. That
structure, not the duplicate, is what blocks admission.

With a position, the tip and the exact entry count serve as evidence instead of
re-reading the whole history on every clock-in. Any insert or physical removal by a
writer outside the collaborator changes the count and holds fresh appends. Mutation
of hashed fields on non-tip rows is left to participating writers (#262 §6). It is
not re-verified on each append.

A review requirement is scoped to one employee in one organization. Other employees
remain writable. The action logs the requirement (`appendReviewRequirement`, with
reasons and IDs) for operators. The user only gets
`{ code: "append_review_required" }` and a localized toast without employee detail.

## Atomic advancement and replay

The fresh entry stores both `previousEntryId` and `previousHash`. The position then
advances in the same transaction: an insert with `version = 1`, or an update guarded
by `version = expected`. It records the tip ID/hash, `entry_count`,
admission provenance (`admission`, `admitted_entry_count`, `admitted_operation`,
`admitted_at`) and `last_operation`. A failed CAS aborts the operation. Any later
failure, such as the period insert, rolls back the entry and the position together.
`TimeEntryAppend.record` advances from each entry to the next for multi-entry
operations.

Committed replay (`getEntryByActionId`) still runs before admission. It returns the
existing entry, with no write and no tip change. Hash serialization and capture
fields are unchanged.

## Linked lifecycle and cleanup

- Organization delete cascades both new tables. The position's composite employee
  FK cascades on employee deletion.
- `tip_entry_id` references `time_entry` with `NO ACTION`, so committed tip evidence
  cannot be removed under its position.
- Paths that delete an employee's whole history delete positions first:
  `clearOrganizationTimeData`, `deleteNonAdminEmployeesData` and organization
  permanent deletion.
- Partial physical deletes are not adopted here: pending-correction cancellation,
  demo correction replay cleanup, and the retained Clockodo/Clockin writers. In an
  adopted scope, deleting a tip fails and deleting a non-tip holds the next append.
  Retention belongs to #301/#285/#284.

## Verification

### PostgreSQL (2026-09-24)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.web-clock-in.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. It runs only on the gated, label-owned disposable PostgreSQL 16
database. It drives the real `clockIn` action and, as the competing legacy writer, the
real `clockOut` action. Only the session, request headers, billing provisioning,
notifications and Next cache are replaced.

Verified (22 tests):

- Legacy with no control row or an inactive one: latest-created hash, null predecessor
  ID, no position.
- Lock order from a second session through `pg_locks`: adoption, configuration and
  access are held shared while the employee key waits exclusive. An exclusive adoption
  holder that activates the scope makes the waiting clock-in read `active`.
- Empty history admits a root and a version-1 `empty_history` position. Two concurrent
  first clock-ins give exactly one root, one position and "already clocked in".
- Verified lineage with a hash-only link, a retained superseded row, tied creation
  times and a backdated pair created earliest appends to the true tip, not the
  latest-created row. Admission is `verified_lineage` with `admitted_entry_count = 6`.
- Review with no writes for forks, islands, a hole, an ID/hash contradiction, an
  unestablished provider hash format, and work without scoped entries. Each returns
  the employee-scoped reasons.
- The peer employee is admitted while the requester is held, and while the requester's
  employee key is held.
- After adoption, a legacy clock-out makes the next clock-in hold with
  `unexpected_history_change` (1→2). A changed tip hash holds with
  `position_tip_changed`. Deleting the tip entry fails (`23503`).
- Two admitted clock-ins advance explicitly: explicit links, version 2, count 2.
- Replaying a committed action ID through the real coordinator and service writes
  nothing and leaves the position unchanged.
- An injected `work_period` insert failure (trigger) rolls back both entry and
  position, with and without an existing position.
- Organization time-data cleanup and employee deletion remove positions.

A mutation run that forced legacy admission failed 15 of these tests, so the suite
detects the admitted behavior.

### Database-free

- `append-lineage.test.ts`: the #262 graph matrix (14 tests).
- `clocking-core.append.test.ts`: coordinated core admission, review, replay-before-
  admission, and legacy parity.
- `actions/clocking.test.ts`: the action composes the coordinator and maps the review
  outcome. Widget and popover tests cover the localized review toast.

## Remaining activation blockers

This slice does not activate anything. Before any organization's control row is set
active:

- Every competing appender must participate or be drained. Web clock-out (#274),
  direct HTTP (#275), on-behalf (#276), bot (#277), mobile (#278), manual (#308),
  active breaks and splits (#304), corrections (#301/#286), imports (#284), demo (#285)
  and ordinary/cron/terminal breaks (#303/#305). Until then, one legacy write holds the
  employee's next clock-in, which the suite demonstrates for clock-out.
- Authorized continuation for held histories (#323). Graph-aware verifier and audit
  consumers that distinguish stored from derived links (#324). Historical diagnostics
  (#319).
- Operator-facing surfacing of review requirements beyond the structured log
  (#319/#324). Offline/queued preservation when admission requires review (#263 via
  #267/#279).
- Retention of committed cancellation evidence instead of physical deletion (#301),
  plus participation of the remaining partial-delete cleanup paths (#306).
- Deployment/in-flight inventory, old-writer drain and the scoped pilot (#327/#329).
