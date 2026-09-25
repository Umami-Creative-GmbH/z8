# Reviewed imports through the completed-work operation (#284 / T20)

## Delivery and activation status

The reviewed-import worker (`lib/import-review/worker.ts` → `committers.ts`) now
commits `work_period` rows inside its own outer transaction owner,
`lib/import-review/import-work-transaction.ts`. Organizations whose
`time_entry_append_control` row is `active` record imported work through one
completed-work operation, `lib/time-tracking/record-imported-work.ts`. Every other
organization keeps the legacy import writer, which now runs under the same outer
transaction and the shared employee key.

Nothing activates in this slice. There is no application setter; the PostgreSQL suite
enables the scope by inserting the control row directly. No import receipt, source key
or hold is written until an organization is activated. The activation blockers are
listed at the end and move to #327, #329 and #331.

Implementation references: [#284](https://github.com/Umami-Creative-GmbH/z8/issues/284),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#252](https://github.com/Umami-Creative-GmbH/z8/issues/252#issuecomment-5653113300),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538),
[#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073),
[#260](https://github.com/Umami-Creative-GmbH/z8/issues/260#issuecomment-5654136671) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Acquisition protocol

The worker reads accepted rows in deterministic staging order (`created_at`, `id`).
That order is also the order in which rows append to an employee's history. Routing
reads the employee from each staged row. One transaction per row then acquires, in
order:

1. Shared `["completed-work-adoption", organizationId]`, then the append control under it.
2. Shared `["work-organization-configuration", organizationId]`.
3. Shared `["work-user-configuration-access", importerUserId]`.
4. The existing exclusive employee key `hashtextextended(employeeId, 0)`. This replaces
   the import worker's former `organizationId:employeeId` key; there is no dual-key protocol.
5. Exclusive `["reviewed-import-source", organizationId, sourceKey]`, where the source key
   is `[provider, "work_period", providerSourceId]`. The same provider record imported
   through two batches serializes even when the rows map to different employees.
6. The staging claim (`accepted` → `committing`), then authoritative rows: the employee,
   receipts, occupying periods and canonical records, then the append position
   `FOR UPDATE` and the new rows.

Imports have no approval participation, so no approval gate is taken. Under protection
the claimed row must still route to the same employee and source. A reviewer who remaps
the row while the worker waits causes a rollback and a fresh routing attempt (up to
three); nothing acquires an earlier-ranked resource late.

## What the operation owns

`recordImportedWork(scope, input)` receives intent and evidence only: the versioned
import command (staged row ID, provider source, the reviewed endpoints, provider
duration evidence), the importing user and one authoritative instant for the attempt.
It never receives a duration, links or storage patches. In one call it either writes
the whole graph or returns a hold with nothing written.

- **Completed segment** (`endsAt` present): clock-in and clock-out entries from one
  append admission (the new `appendAdmittedClockEntries` progresses the position entry
  by entry), the closed approved period at `graph_revision = 1`, the canonical base
  (`origin = import`, approved) and work detail, the balance refresh intent, and a
  receipt of kind `import_completed_work`.
- **Open appender** (`endsAt` null): one clock-in entry and an active period, with a
  receipt of kind `import_open_work`. Live clock-out later closes it through #274.

Entries record the importing user as creator and the UTC capture the provider supplies
(`timezone = UTC`, `timezone_source = backfill`, offset 0), as the legacy writer did.
The balance refresh covers the UTC start date minus one day, because the employee's
local day may start on the previous UTC date.

### Duration and provider interpretation

`imported-work-interval.ts` derives fresh minutes from the exact UTC endpoints under
the shared half-up rule (`deriveWorkDurationMinutes`). The provider's own statements
are read from the retained raw payload (`imported-work-evidence.ts`: Clockodo `duration`
and `offset`, Clockin `break_seconds` and `work_seconds`) and stored separately in the
command and result. Absent fields are "not stated", never zero.

| Hold reason | When |
| --- | --- |
| `invalid_interval` | An endpoint without an explicit `Z`/offset, unparseable, equal or reversed, or after the authoritative instant |
| `unlocated_break` | The provider reports break time without placing it |
| `provider_duration_mismatch` | A stated duration or worked time differs from the exact elapsed endpoints, or a time correction is present |
| `occupancy_conflict` | The interval overlaps other recorded work (see below); the occupants are listed |
| `source_collision` | Another operation already committed this provider source |
| `operation_collision` | A receipt exists for this row under a different command, or its work no longer stands |
| `append_review_required` | The employee's history needs append review (#262), with the classifier's reasons |

A held row is set to `blocked` with `issue_severity = blocking`, `commit_error` and the
structured `commit_hold` evidence, in the same transaction as its claim. Holds are
durable on any attempt and are not retried; genuine failures keep the existing
retry-then-`commit_failed` behavior. The review table shows a localized reason under the
row status of blocked rows (all 12 locales). A later claim of the row clears the old
hold evidence before its own outcome. Resolving a held row is not part of this slice.

### Occupancy

Symmetric half-open occupancy under the employee key: nondeleted periods in any approval
state occupy their interval, an active period from its start onward (including prior-day
starts), adjacency is allowed and deleted periods are excluded. Canonical work records
occupy only when no period links them, so one segment is never counted twice.

## Receipt, replay and provenance

The receipt reuses `completed_work_operation`: writer `reviewed_import`, the staged row
ID as operation identity, `append_admission = append`, actor `human` (the importing
user) and the new `source_key` column. A partial unique index enforces one operation
per source and organization; a check ties `source_key` to the import writer.

Replay runs before any fresh check, in every mode, including after a return to legacy.
It requires the same organization, employee, writer, kind and exact command, and that
the period still stands with the committed entries. A matching replay marks the staging
row committed and writes no work. Anything else is an `operation_collision` hold. The
result records identities, the exact segment, provider evidence, revisions, the append
link and tip, the approval state and follow-ups. Old-dated imports are fresh,
post-adoption writes: their receipts say so, independent of the work date.

## Linked cleanup

- Organization and employee deletion cascade receipts; staged rows cascade with the batch.
- `clearOrganizationTimeData` already removed receipts and positions with the history.
  It now also removes the canonical work records linked from the periods it deletes,
  unless an approval request still references them. Left behind, they read as unlinked
  canonical work and held every re-import. This also covers the canonical records of
  #274 clock-outs.
- Deleting an imported period physically (legacy partial deletes) leaves its receipt as
  evidence, and a replay then reports a collision instead of recreating work.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/lib/import-review/reviewed-import-operation.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real worker (`processImportReviewJob`) and the real web
`clockIn`, `clockOut` and manual-entry actions run on the gated, label-owned
disposable PostgreSQL 16 database. Only the BullMQ enqueue, the session, request
headers, billing provisioning and Next cache are replaced.

Verified (28 tests):

- Legacy: while the employee key is held, the waiting worker holds adoption,
  configuration and importer access shared and waits exclusive on the shared employee
  key; the former import key is not taken. It then commits through the legacy writer
  with no receipt, position or revision.
- The complete adopted graph for an old-dated segment at 60m40s: both entries with
  explicit links, a version-2 `empty_history` position with `reviewed_import`, the
  period and canonical record at 61 minutes, the balance intent, the exact receipt
  command and result, the committed staging row and a completed batch.
- 29 s stores 0 minutes and 30 s stores 1 minute, in both representations.
- An open import, then a live clock-out that closes it through #274 (revision 2,
  explicit link to the imported clock-in, `close_active_work` receipt).
- Holds with no work written: duration mismatch, time correction, equal endpoints, a
  zone-less endpoint and an unlocated Clockin break. The batch ends `commit_failed`.
- Occupancy: a rejected period and a canonical-native record occupy, a one-second
  overlap holds, a deleted slot and adjacent intervals commit, and an active prior-day
  period occupies from its start.
- An island history holds with `append_review_required` (`multiple_roots`).
- Staging order, not work date, decides the chain order.
- Replay after a lost acknowledgement writes nothing, in active and inactive mode. A
  changed command under a committed identity is an `operation_collision`.
- A source committed by another batch is a `source_collision`.
- Injected failures on the clock-out entry, position, canonical record, work detail,
  period, balance intent, receipt and the committed staging update roll back the whole
  graph: the row returns to `accepted` on a non-final attempt and becomes
  `commit_failed` on the final one.
- Races: overlapping rows from two concurrent batches (one commits, one holds), the same
  source through two concurrent batches (one receipt), and an open import against live
  clock-in in both arrival orders (exactly one active period; import-first makes the
  clock-in fail with "already clocked in", clock-in-first holds the import).
- A peer employee's import commits while the employee's key is held. Remapping a waiting
  row restarts routing and commits it for the new employee only.
- Manual work committed first holds an overlapping import. With the import first, the
  legacy manual writer trims its own entry around it; that is pinned as current
  behavior (see blockers).
- After `clearOrganizationTimeData`, receipts, positions and canonical records are gone
  and the same source imports again.

A mutation that disabled the occupancy hold and floored the duration failed 6 tests.

### Database-free

- `imported-work-interval.test.ts`: rounding, zero minutes, offsets, open work, holds.
- `imported-work-evidence.test.ts`: provider evidence extraction.
- `committers.test.ts`: coordinator routing, adopted dispatch with the exact command,
  durable holds without retry, replay before any write, remapping restart; the legacy
  tests now use the shared employee key and take it before each staging claim.
- `import-review-page.test.tsx`: the localized hold reason.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates for #327
(all-writer adoption), #329 (pilot) and #331 (rollback).

- **Manual entry (#308)** does not take the shared employee key and trims around
  existing work. Concurrent manual and import writes are not serialized until it adopts.
- **Corrections (#301/#286)**, active breaks and splits (#304), direct HTTP (#275),
  on-behalf (#276), bots (#277), demo (#285) and break enforcement (#303/#305) must adopt
  occupancy and append participation before the shared guarantees hold against imports.
- **Retained direct Clockodo/Clockin orchestrators** (`lib/clockodo/import-orchestrator.ts`,
  `lib/clockin/import-orchestrator.ts`) are disabled entry points and were not migrated.
  They must be migrated or retired before any reactivation.
- **Held-row resolution:** there is no reviewer flow to resolve a hold (for example
  confirming a break placement). Held rows keep their evidence on the staged row and in
  the review table; the rejected-rows export covers only `rejected` rows.
- **Provider zones:** imported endpoints are captured as UTC because the providers send
  UTC instants; event-local offsets are not established.
- **Configuration writers** do not take the configuration guards yet (#308/#327), so the
  shared guards reserve the protocol without fencing them.
- **Write-boundary inventory:** the new `time_entry`/`work_period`/`time_record` writes
  in `record-imported-work.ts` and the `time_record` delete in `demo-data.service.ts` are
  not yet in `approval-write-boundary.ts`, like #274's `close-active-work.ts`. The
  scanner cannot read sources on Windows, so this could not be verified locally.
- Deployment and in-flight inventory, draining old workers (queued `import-review-commit`
  jobs from older binaries still use the legacy writer), the scoped pilot and compatible
  rollback (#327/#329/#331). A rollback to inactive keeps replaying committed receipts.
