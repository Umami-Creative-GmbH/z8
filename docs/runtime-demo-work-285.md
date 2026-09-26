# Runtime demo work through the work/append contract (#285 / T21)

## Delivery and activation status

The runtime demo tools in **Settings → Demo data** write real employee work graphs:
generated time entries, pending time corrections, work category assignment, "Clear
time data" and "Delete non-admin data". All of them now take the shared work
coordination. In an organization whose `time_entry_append_control` row is `active`,
they also go through the #273 append collaborator and write complete work with a
`completed_work_operation` receipt. The adapter lives in `lib/demo/demo-work.ts`.

Nothing activates in this slice. The same append control already gates web
clock-in (#273) and web clock-out (#274). There is no application setter; the
PostgreSQL suite enables a scope by inserting the control row directly. Organizations
without an active row keep the established demo writes. The only changes there are
coordination, atomicity per employee-day and distinct creation times (see
[Legacy mode](#legacy-mode)). The activation blockers are listed at the end and are
tracked in #327, #329 and #331.

Implementation references: [#285](https://github.com/Umami-Creative-GmbH/z8/issues/285),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538),
[#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Acquisition protocol

Every demo write runs in a transaction that acquires, in order:

1. Shared `["completed-work-adoption", organizationId]`, then reads the append
   control under it (`readAppendAdmission`).
2. For corrections only: the `time_correction` approval write gate (shared). The
   correction submission re-acquires the same gate later in the transaction.
3. Shared `["work-organization-configuration", organizationId]`.
4. Shared `["work-user-configuration-access", userId]`, sorted, for the admin who
   triggered the operation (none for system callers of the cleanup). Corrections
   add the requester's and approver's users, because routing depends on their
   access.
5. The exclusive employee key `hashtextextended(employeeId, 0)`, which every clocking
   writer shares.
6. Existing row locks. Corrections keep their employee, manager, team, period,
   endpoint and canonical-record locks. Adopted appends lock the
   `time_entry_append_position` row.

The key builders are the shared ones in `lib/time-tracking/work-transaction.ts`.
`withDemoWorkTransaction` opens one transaction per employee. The correction path
runs inside the approval workflow transaction and gets its scope from
`acquireDemoWorkScope`.

## Generation

`generateDemoTimeEntries` plans each weekday in UTC (the pattern and randomness are
unchanged, now computed with Temporal) and persists one employee-day per coordinated
transaction through `recordDemoWorkDay`.

### Adopted mode

1. **Occupancy.** If any session of the day overlaps existing undeleted work of the
   employee, in any approval state, the whole day is skipped. Intervals are
   half-open, active work occupies its start onward, and adjacent work is valid.
   Demo work never trims or overlaps real work. A retried generation request
   therefore skips days that were already generated.
2. **Admission.** `admitTimeEntryAppend(…, "demo_generation")` classifies the
   complete history. If the history needs review, the employee is held: nothing is
   written, the remaining days of that employee are skipped, the requirement is
   logged for operators, and the step reports `employeesHeldForReview`. Other
   employees continue.
3. **Per session**, in the same transaction:
   - a clock-in and a clock-out entry, each linked to the admitted predecessor by ID
     and hash, with the position advanced after each;
   - the canonical `time_record` (work, `approved`, origin `clock`) and its
     `time_record_work` detail;
   - the closed period, pointing at the record, with one derived half-up duration
     (`deriveWorkDurationMinutes`) in both representations;
   - a `completed_work_operation` receipt.
4. The day commits the work-balance refresh intent (`markEmployeeWorkBalanceDirty`)
   from its earliest UTC date.

### Receipts and actors

A receipt has kind `create_completed_work`, writer `runtime_demo` (version 1) and
`append_admission = 'append'`. The employee owns the work. The executing actor is
the demo generator: `actor_kind = 'system'`, with `actor_user_id` null. That
column names human actors only. The result names the process and, separately, the
admin who triggered it:
`actors: { executing: { kind: "system", process: "runtime_demo" }, triggeredBy: { kind: "human", userId } }`.
Entries and canonical records keep the admin as `created_by`, because those columns
require a user reference.

Demo generation has no request identity. The command records the run ID (one per
request), the session index and the UTC endpoints. It is evidence, not a replay
key, and nothing replays demo generation. The result records the identities, the
exact segment and captures (UTC backfill), attribution, the revision the period was
created at, both append links, `approval: none` and the follow-up.

### Legacy mode

Legacy mode keeps the established head selection: the employee's latest-created
entry, scoped to the organization. It writes both links from that head, creates no
canonical record and no receipt, and advances no revision. Three things change:

- The day is atomic. A failure leaves no orphan entries.
- The day runs under the shared coordination, so it serializes with live clocking
  of the same employee.
- Each entry takes `clock_timestamp()` as its creation time. Rows written in one
  transaction would otherwise share `now()`, and a later latest-created reader, such
  as the next legacy clock-in, would pick among tied rows.

The legacy output stays one verified lineage, so it can be admitted after
activation.

## Corrections

`generateDemoPendingTimeCorrectionApprovals` keeps its established selection, source
locks and checks. It adds the acquisition protocol above to its transaction.

- **Exact replay first.** When the deterministic correction identity already
  exists, the established demo checks run unchanged: ID, organization, employee,
  type, replaced entry, timestamp, the locked predecessor's ID and hash, the
  recomputed hash, superseded state, captures, notes and source fields. Replay
  performs no admission and never advances the position. A committed correction that
  no longer matches is refused. The completed-work receipt concept adds nothing to
  this path, so it cannot weaken it.
- **Fresh, adopted.** `admitTimeEntryAppend(…, "demo_correction")` supplies the
  predecessor instead of the latest-created row. The correction entry is recorded on
  the position. A history that needs review holds that requester (logged) and skips
  the candidate.
- **Fresh, legacy.** Unchanged: the locked latest-created row.
- **Speculative cleanup.** If the submission turns out to be a replay after a fresh
  correction row was inserted, legacy mode keeps deleting that row. In adopted mode
  the row has already advanced the position, so the whole transaction rolls back.
  A positioned tip is never deleted.

## Attribution

`assignWorkCategoriesToPeriods` now runs one coordinated transaction per employee,
and the period query is scoped to the organization. Legacy mode keeps the
period-only update. Adopted mode changes only settled work (inactive, undeleted,
approved, nothing pending, with a canonical record). It updates the canonical work
detail's category in the same transaction and advances the period's
`graph_revision`, guarded by the revision it read.

## Cleanup

"Clear time data" and "Delete non-admin data" remove each employee's whole time
history in one transaction under that employee's key (`deleteDemoEmployeeHistory`):
the manual/policy clock-out approval evidence describing it (#302), append
position, receipts, periods, their canonical work records (in every mode, as #284
decided; left behind they would read as unlinked canonical-native work) and entries.
In an adopted scope the same transaction also commits the work-balance refresh intent
from the earliest removed period.

- A concurrent writer of the same employee waits, or finishes first. It never sees
  a partial graph, a position without its tip, or periods without entries.
- Canonical records that a retained approval request still references are kept,
  because that reference would otherwise block the delete. "Clear time data" does
  not remove approval requests (unchanged), so records referenced by demo
  correction approvals can remain.
- "Clear time data" now removes history before the demo work categories, so the old
  organization-wide `work_category_id = null` update is gone. The deleted periods
  that had a category are still counted as removed assignments.
- "Delete non-admin data" never touches admin employees' history, position or
  receipts. Neither path touches another organization.
- The "Clear time data" action passes the admin as the triggering user.
  `clearOrganizationTimeData(organizationId)` without a user still works for system
  callers.

## Schema (migration 0087)

- `time_entry_append_position` operations add `demo_generation` and
  `demo_correction`.
- `completed_work_operation` kinds add `create_completed_work`, and writers add
  `runtime_demo`.

The migration only widens check constraints. It is additive and inactive.

## User-facing

The demo wizard's time-entries step shows `N employees held for history review`
when adopted admission held anyone. Nothing else changes for users. Held employees
get no demo work, and the reasons are logged, never shown.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/lib/demo/demo-work.integration.test.ts`, registered in
`scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real demo server actions (`generateTimeEntriesStepAction`,
`generatePendingTimeCorrectionApprovalsStepAction`,
`assignWorkCategoriesToPeriodsStepAction`, `clearTimeDataAction`,
`deleteNonAdminDataAction`) and the real web `clockIn` action run on the gated,
label-owned disposable PostgreSQL 16 database. Only the session, billing and the
Next cache are replaced. `Math.random` is pinned, so every weekday gets
08:30–13:00 and 13:45–17:30. Only `Date` is faked, so "last 30 days" is
2026-06-24..07-24 (23 weekdays).

Verified (14 tests):

- **Legacy generation:** 92 entries and 46 periods. No canonical record, receipt,
  position or revision. 92 distinct creation times. Every entry links the
  latest-created entry before it. After activation, the real clock-in is admitted
  as `verified_lineage` at the demo tip, with anchor count 92.
- **Adopted generation over tied and backdated history.** The existing lineage
  e1→e2→e3→e4 has e1 and e2 tied on creation time and e3 created after e4. The first
  demo entry is dated 2026-06-24, earlier than the history, and still follows e4
  exactly, by ID and hash. It does not follow e3, the latest-created row.
  2026-07-23 already holds work and is skipped.
  - The position is at version 88, count 92, `verified_lineage`, anchored at e4
    with `admitted_operation = demo_generation`.
  - All 44 periods agree with their canonical base and detail. There are 44
    receipts with the system actor and the triggering admin, no overlaps, and
    durations 270 and 225.
  - The first receipt's exact command and result are checked.
  - The balance is dirty from 2026-06-24.
  - The next real clock-in follows the demo tip, not the entry with the latest
    event time.
- **Concurrent generations:** two simultaneous runs for the same employee write
  each day once (46 periods in total), with no overlap, one root, no forks, and a
  position at the explicit tip.
- **Held for review:** a forked history holds only its employee
  (`employeesHeldForReview: 1`), with that employee's rows unchanged and no
  position. The peer gets `empty_history` and 92 entries.
- **Rollback, adopted:** a failure injected at the receipt of the first 2026-07-01
  session rolls back that whole day. That day's entries, position advances,
  canonical rows and period are gone. The five committed days (06-24..06-30) keep a
  consistent position at the explicit tip.
- **Rollback, legacy:** a period-insert failure on 2026-07-01 leaves no orphan
  entries. Five days remain.
- **Adopted corrections:** five corrections continue linearly from the generated
  tip, each by exact ID and hash. The position advances +5 with
  `last_operation = demo_correction`. There are five pending approval requests to
  the manager.
  - A second run replays those five, which write nothing, and seeds five other
    periods on the same lineage: 10 corrections for 10 distinct sources,
    position +10.
  - After a committed correction is tampered with, the next run is refused by the
    established demo replay check, and no row changes.
- **Correction rollback:** an approval-request insert failure after the admitted
  correction entry and position advance leaves the organization's rows unchanged.
- **Held corrections:** an unexpected write after the recorded tip means no
  correction is created and no row changes.
- **Rollback to inactive:** legacy corrections link the latest-created row, which is
  the demo tip, and leave the adopted position unchanged.
- **Attribution:** 12 of 46 periods get the category. All 46 canonical details
  agree with their period. Exactly the 12 assigned periods are at revision 1, and the
  rest stay at revision 0.
- **Clear time data:** while another transaction holds the requester's employee
  key, the cleanup waits and none of that employee's rows or position is removed.
  After release, every entry, period, canonical record, position and receipt of the
  organization is gone, and the other organization is byte-identical. The next real
  clock-in is admitted from `empty_history`.
- **Clear after corrections:** entries, periods, position and receipts are gone.
  Only canonical records that a retained approval request references remain. The
  balance is dirty again from 2026-06-24.
- **Delete non-admin data:** three employees are removed. The admin's entries,
  records, receipts and position are unchanged, and the other organization is
  unchanged. The admin's next real clock-in advances the admin's position by one.

Mutation: forcing adopted generation onto the legacy writer and skipping the
employee key failed 7 of the then 11 tests: every adopted generation, correction and
attribution test, plus the coordinated cleanup test.

Full runner (`bash apps/webapp/scripts/run-approval-workflow-repository-integration.sh`,
fresh container, migration recovery check and full chain through 0087): **42 files /
686 tests passed** after merging `dev` (#275, #302, #284, #291), including the #272/#273/#274 clocking suites. The label-owned
container was verified and removed.

### Database-free

- `demo-data.service.test.ts`: the correction path acquires the adoption gate, the
  `time_correction` approval gate, organization configuration, admin access and the
  requester key before any routing or source row lock. In an adopted scope, the
  correction links the admitted predecessor. A submission that turns out to be a
  replay rolls back instead of deleting the positioned row; removing that guard
  fails the test. A held history writes nothing and submits nothing. The
  established correction, replay and rollback cases still pass against the extended
  mock.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates, tracked
in #327 (all-writer adoption), #329 (pilot) and #331 (rollback).

- Old deployed builds run the pre-#285 demo writers, which bypass coordination and
  append admission. They must be drained before any organization is activated
  (#327).
- **Cancelled or rejected corrections.** In an adopted scope, a pending demo
  correction can be the append tip. Physical deletion of a cancelled or rejected
  correction (`deleteCancelledTimeCorrectionsInTransaction`) then fails against the
  position's tip reference, and deleting a non-tip correction holds the next
  append. Retention of cancelled evidence instead of deletion belongs to
  #301/#286, as for real corrections.
- **Unkeyed generation.** Demo generation has no request identity, so its receipts
  are not replay keys. Adopted occupancy makes a retried request skip days that
  already hold work. It does not deduplicate a request whose outcome is unknown.
  That is acceptable for a demo tool and should not be copied by production
  writers.
- **Capture evidence.** Demo sessions carry no zone evidence and are captured as UTC
  `backfill`, as before.
- **Configuration writers.** Project, category, membership and settings writers do
  not yet take the configuration guards (#308/#327). The demo's configuration
  steps (teams, projects, locations, categories, policies, shifts, managers) are
  among those writers and are not adopted here.
- **Occupancy scope.** Adopted occupancy reads `work_period`. Canonical-only
  `time_record` work without a period is not seen. No production creator of such
  work was found (#259 lists the retained canonical creation action as inventory).
- **Employee removal.** "Delete non-admin data" removes each history under the
  employee key, then deletes the employee rows afterwards, outside that
  coordination. Coordinated employee removal belongs to the lifecycle/offboarding
  owners.
- **Canonical-mode correction side effects.** Correction submission is covered in
  the approval-legacy rollout mode. Canonical-mode outbox writes on the demo path
  were not failure-injected here; the approval suites cover that collaborator.
- Deployment and in-flight inventory, the scoped pilot and compatible rollback
  (#327/#329/#331). A rollback to inactive keeps legacy correction chaining and
  leaves adopted positions untouched (verified above). After such legacy writes, the
  next adopted write holds on `unexpected_history_change` until authorized
  continuation (#323); the #273 suite demonstrates that hold.
