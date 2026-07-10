# Time Correction, Queue Failure, and Import Claim Safety

## Status

Approved design for three independent correctness fixes in `apps/webapp`:

1. Self-service time corrections must remain pending until approval.
2. BullMQ processor failures must reject so retries and failed states work.
3. Import staging rows must be atomically claimed before domain writes.

## Goals

- Prevent employees from changing canonical time-entry state before managerial approval.
- Make BullMQ's terminal state, retries, queue metrics, and client callbacks reflect processor exceptions.
- Guarantee that overlapping import workers cannot commit the same staged row twice.
- Preserve organization scoping and existing permission checks.
- Preserve UTC canonical instants and per-entry timezone capture.
- Keep the changes surgical and compatible with intentional application-level job results.

## Non-Goals

- Rebuild the existing whole-work-period correction UI flow.
- Change webhook or calendar-sync application-level retry semantics.
- Introduce a generalized distributed lock or import-worker lease system.
- Refactor unrelated approval, queue, or import-review code.

## 1. Self-Service Correction Approval

### Current Failure

`POST /api/time-entries/corrections` distinguishes self-service requests only in its response message. It always calls `TimeEntryService.createCorrectionEntry` without `isSuperseded`, so the service creates an active correction and immediately supersedes the original entry. No approval request is created.

### Request Contract

The route continues to accept a single `replacesEntryId`, `timestamp`, and `notes`. It supports corrections to either a work period's clock-in or clock-out entry.

`timestamp` must be an RFC 3339 instant containing `Z` or an explicit numeric offset. Offset-less values and invalid timestamps return `400`. Parsing and conversion use Luxon. The canonical `time_entry.timestamp` remains UTC.

The request may provide a valid IANA `timezone` as event context. When it does not, the server uses the target employee's configured timezone. The server derives `utcOffsetMinutes` for the correction instant from the effective IANA timezone and records the appropriate self-service or manager-on-behalf source. It does not accept a numeric offset as a separate trusted field.

### Tenant and Authorization Boundaries

The route scopes all employee, target entry, and work-period lookups to the active `organizationId`. A foreign entry is treated as not found. The route retains the current distinction:

- An employee may request a correction to their own entry.
- A manager or administrator with `canApproveFor` may apply a correction directly.
- Other cross-employee requests remain forbidden.

The containing work period must be non-deleted, belong to the same employee and organization, and reference the target as either `clockInId` or `clockOutId`.

### Pending Submission Flow

For a self-correction where the requester cannot directly approve:

1. Resolve an eligible correction approver in the same organization.
2. Validate the proposed endpoint against the unchanged other endpoint. Clock-out must remain after clock-in; a changed clock-in must remain before an existing clock-out.
3. Start one database transaction.
4. Create a correction entry with `isSuperseded: true` so it is inactive while pending.
5. Create a pending time-correction approval for the containing work period.
6. Store the exact correction ID in metadata as either `clockInCorrectionId` or `clockOutCorrectionId`.
7. Commit both records together and return the approval ID.

If approval creation fails, the correction insert rolls back. The original entry and work period remain unchanged until approval.

### Endpoint-Agnostic Approval

Time-correction approval metadata changes from requiring a clock-in correction ID to requiring at least one of the two endpoint IDs. Existing metadata containing both IDs remains valid, and legacy approvals without metadata retain their current fallback behavior.

For an edit approval, the handler constructs an effective period from:

- corrected clock-in or the original period clock-in;
- corrected clock-out or the original period clock-out.

It validates the effective range, activates only linked correction entries, and supersedes only originals with a linked replacement. It then updates work-period endpoint IDs, UTC timestamps, duration, canonical work record, dirty-balance marker, and notification context from the effective period.

Deletion approvals continue to require both correction entries. Rejection leaves originals active and linked pending corrections inactive.

### Direct Manager Corrections

Authorized manager/admin corrections retain immediate activation. The service's superseding update remains organization- and employee-scoped as defense in depth.

## 2. BullMQ Failure Semantics

### Current Failure

Both one-off and cron worker catches return `{ success: false }`. BullMQ treats any resolved processor promise as completed, so attempts/backoff never run and `failedReason` is empty. The client then calls success for every completed job with a result.

### One-Off Jobs

The one-off worker keeps contextual logging but rethrows processor exceptions. Non-`Error` throws are normalized to `Error`. BullMQ then owns retries, backoff, failed state, failed reason, and failed events.

The worker does not generically throw for every returned `success: false`. Webhook and calendar processors intentionally use application-level result semantics, which are outside this fix.

### Cron Jobs

Cron processor exceptions also reject. The database execution record represents the logical BullMQ job across all attempts:

- API-triggered jobs continue to use the supplied `executionId`.
- Scheduler-triggered jobs create one execution record and persist its ID into the BullMQ job data before processing, so later attempts reuse it.
- Every attempt marks the shared record running.
- Intermediate failures are logged and rethrown without setting a terminal database state.
- Only the final configured attempt marks the execution failed before rethrowing.
- A later successful attempt marks the same execution completed.

The final-attempt calculation uses BullMQ's `attemptsMade` and configured `opts.attempts`. Synchronous status polling therefore does not return failure while BullMQ still has retries available.

### Client Compatibility

New failures arrive as `state: "failed"` with `error`, which the existing status API already exposes. The client additionally treats retained or in-flight legacy responses shaped as `state: "completed"` with `result.success === false` as failures:

- `useJobStatus` invokes `onError`, not `onSuccess`.
- `useJobStatuses` counts the job as failed, not completed.
- Polling still stops because the BullMQ state is terminal.

## 3. Atomic Import Row Claims

### Current Failure

Workers preload accepted rows outside a transaction. Two workers can read the same accepted snapshot, perform duplicate domain writes in separate transactions, and only then overwrite the staged row's status. An unconditional final failure update can also overwrite another worker's successful commit.

### Claim Protocol

The initial accepted-row query remains a candidate scan. The first operation inside each existing per-row transaction is a conditional update:

`accepted -> committing`

The update predicate includes staged row ID, batch ID, organization ID, entity type, and expected `accepted` status, and uses `RETURNING` to obtain the claimed row. Domain processing uses the returned row rather than the stale candidate.

If no row is returned, another worker already claimed or completed it. The current worker skips it without a domain write and without incrementing committed or failed counts.

### State Transitions

- Successful domain write: `committing -> committed` in the same transaction.
- Final mapping blocker: `committing -> blocked` in the same transaction.
- Non-final mapping blocker: `committing -> accepted` in the same transaction so BullMQ may retry.
- Thrown domain error: transaction rollback restores `accepted` automatically.
- Final thrown error: outside the rolled-back transaction, compare-and-set `accepted -> commit_failed` with the full tenant/job/row scope.

Committed and blocked updates require the expected `committing` status. The final failure compare-and-set cannot overwrite a row another worker committed after the failed worker rolled back.

No schema migration is required because `committing` already exists in schema, shared types, and UI behavior.

## Error Handling

- Correction validation and missing-manager errors return bounded client errors; internal details stay in server logs.
- Approval and correction inserts are atomic and fail closed.
- Worker exceptions retain their original message in BullMQ's failed reason while preserving structured server logging.
- Import claim loss is an expected skip, not an error.
- Import domain failures preserve existing per-row error reporting and final-attempt behavior.

## Test Strategy

Tests are written and observed failing before production edits.

### Corrections

- Self clock-in correction creates an inactive correction and pending approval without superseding the original.
- Self clock-out correction follows the same pending flow.
- Approval of either endpoint updates only that endpoint and recalculates the effective period.
- Rejection leaves originals and canonical work data unchanged.
- Approval creation failure rolls back the correction.
- Foreign-organization target lookup returns not found and performs no mutation.
- Duplicate pending requests create no extra correction.
- Invalid or offset-less timestamps return `400`.
- UTC, summer-offset, and winter-offset cases preserve the canonical instant and derived capture.

### BullMQ

- Awaited one-off processor exceptions reject.
- Unknown job types reject.
- Intentional returned semantic failures remain resolved results.
- Non-final cron exceptions reject without terminally failing the database execution.
- Final cron exceptions mark the execution failed and reject.
- Scheduler retries reuse one execution ID.
- A successful retry marks the shared execution completed.
- Real `failed` status and legacy completed-failure status both invoke client error behavior.
- Batch status counts legacy completed-failure results as failed.

### Imports

- Two overlapping commits of one accepted team row persist exactly one target.
- The losing claim performs no domain writes and reports no false failure.
- A rolled-back non-final attempt leaves the row claimable by a retry.
- A non-final blocker releases `committing` back to `accepted`.
- A final failure cannot overwrite a concurrent successful commit.
- Claim and terminal predicates include organization, batch, entity, row ID, and expected status.

## Verification

Run focused Vitest files after each red-green cycle, then run the relevant correction approval, queue, cron, and import-review suites together. Run the webapp's type/build validation where the environment permits. No database push is needed because the design requires no schema change.

## Concurrent Work

Unrelated dirty files remain untouched. If a target file changes concurrently, edits must be based on its current contents and must preserve those changes rather than reverting them.
