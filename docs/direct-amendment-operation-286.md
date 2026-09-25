# Direct corrections and attribution changes through the completed-work operation (#286 / T22)

## Delivery and activation status

Four direct writers of completed work now have an adopted path. It runs through
one completed-work operation, `lib/time-tracking/amend-completed-work.ts`:

| Writer | Caller | Receipt `writer` | Authority checked in the transaction |
| --- | --- | --- | --- |
| Admin time edit | `updateWorkPeriodTimes` → `applyAdminWorkPeriodTimeEdit` | `admin_time_edit` | approved owner/admin membership |
| Same-day self edit | `editSameDayTimeEntry` (dialog and `updateWorkPeriodTimes`) | `self_service_time_edit` | the actor's own active employee owns the work |
| HTTP direct correction | `POST /api/time-entries/corrections`, direct branch | `http_direct_correction` | owner, admin employee, or direct manager link |
| Project change | `updateWorkPeriodProject` (calendar); the duplicate in `actions/mutations.ts` delegates to it | `work_period_attribution_edit` | owner |

Only organizations whose `time_entry_append_control` row is `active` use it. That
is the same control that gates the #273 clock-in and the #274 clock-out, so all
adopted writers of one employee graph switch together. Every other organization
keeps its existing writes. They now run inside the same coordinated transaction,
so a mode change can never interleave with a write that has already started.

Nothing activates in this slice. There is no application setter. The PostgreSQL
suite enables the scope by inserting the control row directly.

**Business deletion is not moved here.** Its only real writer is the approved
deletion inside the correction finalizer
(`finalizeTimeCorrectionTerminalDetailedInTransaction`), which runs in the approval
transaction. #301 moves correction submission, finalization and cancellation into
the shared outer transaction. The user decided on 2026-09-25 that this belongs to
#301 (which #286 blocks). The handoff is recorded on #301.

Implementation references: [#286](https://github.com/Umami-Creative-GmbH/z8/issues/286),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the
canonical resolutions of [#252](https://github.com/Umami-Creative-GmbH/z8/issues/252#issuecomment-5653113300),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538),
[#260](https://github.com/Umami-Creative-GmbH/z8/issues/260#issuecomment-5654136671),
[#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## What the operation owns

`amendCompletedWork(scope, input)` runs inside the outer transaction owned by
`withCompletedWorkTransaction` (`lib/time-tracking/completed-work-transaction.ts`).
Callers supply two things:

- the **command**: the writer's request exactly as it was submitted, before any
  interpretation;
- the **intent**: absolute endpoint wishes and attribution intents.

Callers never supply a duration, a link, a canonical row or a period patch. In one
transaction the operation:

1. Locks the owner and the actor's employee rows (ascending ID), the membership and,
   where needed, the manager link. It verifies the authority listed above. An
   `isOrgAdminCasl`/`canApproveFor` preflight is not authority.
2. Locks the team membership when a project or category is replaced, then the
   period. A period that differs from the source the caller showed is a stale
   source (`Work period changed while editing`).
3. Refuses work under unresolved review: a pending period, a pending legacy
   correction request, or a pending canonical `time_correction` workflow.
4. Locks both endpoint entries and the canonical record, detail and project
   allocations. The period and the record must describe the same segment. A
   missing or diverging canonical record returns `This work needs review before it
   can be changed`; it is never rebuilt inline (historical repair is #320).
5. Plans the change with the pure `planCompletedWorkAmendment`
   (`amend-completed-work-plan.ts`):
   - Endpoints are absolute. A form value at `minute` precision that still contains
     the stored instant keeps the exact stored instant. The HTTP route sends an
     `exact` RFC 3339 instant.
   - When an endpoint moves, the duration comes from the exact UTC endpoints,
     rounded to the nearest minute half up (`deriveWorkDurationMinutes`). Positive
     zero-minute work is kept; equal or reversed endpoints and more than 24 hours are
     rejected.
   - Metadata-only changes keep the stored minutes of both the period and the
     record, which may be historical and may differ from each other.
   - Attribution: omission preserves, `clear` clears, `replace` replaces. A value
     equal to the current one, or to the normalized legacy location, changes nothing.
     A request that changes nothing is rejected.
6. Rejects moved endpoints in the future and re-checks replacement eligibility under
   the locks. A project must be in the organization, active, bookable, and assigned
   to the owner or the owner's locked team. A category goes through the existing
   `authorizeTimeCorrectionCategoryChange`.
7. Checks symmetric occupancy when an endpoint moves (`work-occupancy.ts`, below).
8. Appends one correction entry per moved endpoint through the #273 append
   collaborator (operation `completed_work_correction`). Each entry gets the exact
   predecessor ID and hash, and the position advances with a version check. The
   replaced entry is superseded, never removed, so its hash stays predecessor
   evidence.
9. Updates the period with a compare-and-set on its IDs and `graph_revision`, and
   advances `graph_revision` by one. It then updates the canonical record
   (endpoints and minutes only when an endpoint moved; `updated_by` always), the
   work detail when the category or location changed, and the project allocations
   when the project changed. Only `project` allocations follow the project; other
   allocation kinds are untouched.
10. Commits the work-balance refresh intent when an endpoint moved (the earliest UTC
    or captured-offset local date of every original and resulting endpoint), and
    inserts the `completed_work_operation` receipt (`kind = amend_completed_work`).

### Active work

The calendar can change the project of running work. For active work, the operation
accepts attribution-only intents (`planAttributionChange`). It changes the period
and advances its revision, and writes a receipt with null end fields and no
canonical record. The #274 clock-out then carries the attribution into the closed
graph, because it preserves omitted attribution. Endpoint intents on active work are
refused (`Cannot edit an active work period`).

## Receipt and replay

The receipt holds the versioned command, and a result holding:

- the intent;
- the actor and the authority;
- the source and resulting segments (entry IDs, UTC endpoints, stored minutes,
  captured offsets, attribution);
- the change mask;
- each correction entry with its exact predecessor;
- the source and result revisions;
- the approval state (unchanged by a direct amendment);
- the follow-ups.

Replay order:

1. **Lookup-only replay before any preflight** (`replayCommittedAmendment`). The
   adapter looks up the identity in the organization. If a receipt exists, it
   replays under the coordinated transaction of the receipt's employee. This
   matters because a committed edit changes the very state its preflight reads:
   - the HTTP route's named entry is now superseded;
   - the form now shows the submitted values;
   - a self-service window can close at midnight.
2. The same replay again inside the fresh transaction (`replayOrAmendCompletedWork`),
   which covers two identical requests racing.
3. Otherwise the fresh operation.

A replay writes nothing and repeats no effect. It requires all of the following, or
it is a collision:

- the same organization, employee, kind, writer, actor and exact command;
- **current** authority (a removed manager link denies the replay with 403);
- the work still standing exactly as committed: the same entry IDs and
  `graph_revision`, not deleted, and the correction entries not superseded.

So an old token can never recreate or re-apply changed or deleted work. A deleted
period is already refused by the action's own target read (`Work period not found`).

Identities:

- admin edits reuse the edit's `submissionId`;
- the same-day dialog now sends its submission ID, and a request without one gets a
  server-generated identity that never replays;
- the HTTP route uses the `Idempotency-Key`, or a fresh UUID without one;
- project changes get a server-generated identity. It names the committed operation
  but cannot prove that a later identical request is a retry.

User-facing outcomes:

| Outcome | Result |
| --- | --- |
| Collision | "This change conflicts with an earlier request or changed work. Please refresh and try again." (`completed_work_collision`, HTTP 409) |
| Interval conflict | "The time range overlaps other recorded work" (`work_interval_occupied`, 409) |
| Evidence needing review (canonical gap or append hold) | "This work needs review before it can be changed" (`completed_work_review_required`, 409) |
| Stale source, pending review, validation, authorization | Keep the established messages and codes |

## Symmetric occupancy

`loadWorkOccupants` reads, under the employee coordination lock, every
non-deleted period of the owner that intersects the resulting half-open interval.
Approved, pending and rejected periods all count. Active work occupies from its
start onward, including a start on an earlier day. It also reads canonical-native
work records, meaning records that no period links to; a deleted period's
canonical sentinel is not native. Adjacency is valid, and empty intervals occupy
nothing. The amended period itself is the only excluded source. Interactive
conflicts fail; nothing is trimmed.

## Coordination

`withCompletedWorkTransaction` routes, then acquires in order:

1. the shared adoption gate, with the append control read under it;
2. the organization configuration guard;
3. the sorted user access guards (the actor and the owner's user);
4. the sorted exclusive employee keys (the owner and every employee record of the
   actor).

It re-routes under those locks; a changed scope restarts the transaction instead of
acquiring an earlier-ranked lock late. Direct amendments route no approvals, so no
approval gate is taken. Row order inside the operation is:

employees (ID order) → membership → manager link → team memberships and teams →
work period → endpoint entries → canonical record → work detail → project
allocations → project or category rows → append position → balance row → receipt.

Legacy correction submission locks the same period row before it inserts its
pending request. Under that lock, a submission and a direct amendment therefore see
each other.

## Legacy behavior kept for inactive organizations

- The admin, same-day, HTTP and project writes are unchanged, except that they now
  run inside the coordinated transaction.
- An unchanged legacy same-day edit is now refused inside that transaction, before
  any lock or write; before, it was refused before the transaction.
- `updateWorkPeriodTimes` no longer rejects an unchanged direct edit before
  routing. The direct writers decide "no change" themselves after replay (legacy:
  the same message).
- The same-day edit now returns conflict messages instead of the generic failure.

## Linked cleanup

Amendment receipts use the existing `completed_work_operation` lifecycle:

- organization and employee deletion cascade them;
- `clearOrganizationTimeData`, `deleteNonAdminEmployeesData` and permanent
  organization deletion delete all receipts in scope, whatever their kind.

Correction entries are retained history like any other entry.

## Migration

`drizzle/0084_completed_work_amendment.sql` is additive. It widens:

- the receipt `kind` check with `amend_completed_work`;
- the `writer` check with the four writers;
- the append position operation check with `completed_work_correction`.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/work-period-amendment.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. It runs the real actions and the real HTTP route on the
gated, label-owned disposable PostgreSQL 16 database. The work is created by the
real adopted clock-in and clock-out. Only these are replaced: the session, headers,
billing provisioning, Next cache, the change-policy capability, and the CASL
preflights. The CASL preflights are forced **open**, so the operation's own locks
decide.

Verified (24 tests):

- **Full graph.** An admin edit at 60m40s → 09:31:
  - the period and the record both store 91 minutes;
  - the unchanged clock-in keeps its instant;
  - one correction entry links the exact tip by ID and hash, and the replaced entry
    is retained as superseded;
  - the position advances with `last_operation = completed_work_correction`;
  - the balance is dirty from the work date, and `graph_revision` goes 1 → 2;
  - the receipt holds the exact command and result.
- **Duration.** 29 s → 0 minutes and 30 s → 1 minute in both representations
  (HTTP); equal endpoints are rejected.
- **Replay.** An exact retry changes no row (whole-organization snapshot equality).
  A changed command under the same ID is a collision with no changes. An old token
  after a later edit is a collision, and after business deletion it is refused; both
  change nothing.
- **Occupancy.**
  - Overlap is refused with no changes; adjacency is allowed.
  - Moving within the period's own former interval is allowed.
  - Rejected work still occupies its interval; deleted work does not.
  - Active work (started later that day) occupies from its start.
- **Concurrency.** Two concurrent admin edits of one period: one commits and the
  other gets the stale-source conflict. The result is exactly one correction entry
  and revision 2.
- **Failure injection.** Each write rolls back the whole organization snapshot:
  - entry insert and supersede;
  - position update;
  - period update;
  - record update;
  - allocation delete and insert (via the project change);
  - balance intent;
  - receipt.
- **Metadata.** A same-day location change updates the period and the detail. It
  keeps endpoints, protected minutes and the project allocation, appends no entry
  and writes no balance intent. Its retry replays although the submitted values are
  now current.
- **Project.** Replace and clear keep the period and the canonical allocation
  together and advance the revision. An unassigned project is refused with no
  changes.
- **Active work.** A project set on running work (revision 0 → 1) is carried into
  the closed graph by the #274 clock-out (revision 2, allocation B).
- **Authority.** A peer is denied (403, no changes) although the CASL preflight
  allows. A manager with a link succeeds, and the retry with the same
  `Idempotency-Key` replays the same entry with no changes. After the manager link
  is removed, the replay is denied (403).
- **Review guards.** A pending correction request blocks a project change. A
  missing canonical record holds the edit for review; both change nothing.
- **Inactive organizations.** A committed receipt still replays after the
  organization returns to inactive. A new edit then takes the legacy writes: no
  receipt and no revision advance.
- **Cleanup.** `clearOrganizationTimeData` removes amendment receipts.

Run together with the #272, #273 and #274 clocking suites and the time-correction
approvals suite: **5 files / 135 tests passed**. The full runner result is recorded
in the pull request.

Mutation: disabling the occupancy check and the replay authority re-check failed 3
tests (both occupancy scenarios and the authority replay).

### Database-free

- `amend-completed-work-plan.test.ts` (12) covers: absolute and minute-precision
  endpoints, half-up minutes only when endpoints move, protected minutes for
  metadata, omit/clear/replace, normalized legacy location, no-change,
  equal/reversed and more than 24 hours, and attribution-only plans.
- `work-occupancy.test.ts` (5) covers: half-open overlap, adjacency, active and
  prior-day work, empty sentinels, and zero-minute work.
- The legacy unit harnesses mock the coordinator with the test's own transaction
  (legacy scope). Their static checks now name the coordinator and the single
  project mutation.

## Findings

- **The approval write-boundary scanner cannot see writes through the sealed work
  transaction scope.** The whole-program analysis finds no mutation in:
  - `close-active-work.ts` (#274);
  - `amend-completed-work.ts`;
  - `work-period-attribution.ts`;
  - the admin edit's legacy writes, which now use the coordinated client.

  The admin edit's four declared owners were therefore stale and are removed from
  `CANONICAL_SOURCE_WRITE_OWNERS` and its exact-set test. Teaching the scanner that
  provenance is a follow-up. Until then, new writers through the scope are not
  inventoried automatically.
- `updateWorkPeriodProject` used to change the period's project without the
  canonical allocation, so the two representations diverged. The adopted path
  changes both together. Legacy organizations keep the old behavior.
- The retained `createTimeEntry` server action in `time-tracking/actions.ts` can
  still write a correction entry through the legacy service, although no production
  caller uses that branch. In an adopted organization, the append collaborator would
  hold further fresh appends (an unexpected history change) rather than fork the
  lineage. It must be retired or gated before activation (#327).
- Note edits (`updateWorkPeriodNotes`, `updateTimeEntryNotes`) change entry notes
  only, not the work graph. They are not part of this operation.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates, tracked
in #327 (all-writer adoption), #329 (pilot) and #331 (rollback).

- **Business deletion and correction lifecycles (#301).** The approved correction
  and deletion finalizer, the submission's auto-completion and cancellation must
  move into the outer transaction and the operation context. Until then they write
  without the adoption gate, the employee key and a revision advance, and replay
  cannot detect their changes by revision. The operation still detects them through
  entry IDs and supersession.
- Holiday validation and the change-policy capability are still preflights. The
  configuration writers do not take the guards yet (#316/#327), inherited as in #274.
- The legacy `createTimeEntry` correction branch (above) must be retired or gated.
- Splits and active breaks (#304), break enforcement (#303/#305), imports (#284) and
  demo (#285) still write the same graph without participating.
- Teach the write-boundary scanner the work-transaction scope.
- Deployment and in-flight inventory, old-writer drain, the scoped pilot and
  compatible rollback (#327/#329/#331). A rollback to inactive keeps replaying
  committed receipts (verified above).
