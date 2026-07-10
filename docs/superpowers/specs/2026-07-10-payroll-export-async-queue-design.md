# Payroll Export Async Queue Design

## Goal

Ensure large interactive payroll exports leave `pending` by being dispatched to a dedicated background worker, while preserving organization scope throughout queueing and processing.

## Root Cause

`createExportJob` persists every payroll export job as `pending` and marks jobs above the formatter or connector threshold as asynchronous. Both interactive actions return immediately for asynchronous jobs without enqueueing or otherwise scheduling them. The existing pending-job query has no caller, so those rows remain pending indefinitely.

The existing queue `export` type cannot be reused. Its worker routes to the general data-export processor and reads the `data_export` table, while payroll jobs live in `payroll_export_job`. A distinct queue contract and worker route are required.

## Scope

The fix covers both interactive entry points:

- payroll export settings;
- the scoped payroll workspace.

Scheduled payroll exports continue creating and processing their underlying payroll jobs inline. The fix does not add a polling cron, transactional outbox, atomic job claiming, or change global BullMQ failure/retry semantics.

## Queue Contract

Add a dedicated payload:

```ts
interface PayrollExportJobData {
	type: "payroll-export";
	jobId: string;
	organizationId: string;
}
```

Include `payroll-export` in `JobType` and the payload in `JobData`. Keeping `organizationId` in the payload allows worker processing and queue-status authorization to establish the tenant boundary without deriving ownership from an arbitrary job ID.

A focused payroll queue helper adds the job with name `process-payroll-export` and deterministic BullMQ ID `payroll-export-${jobId}`. Repeated dispatch of one persisted payroll job therefore resolves to one queue identity.

## Interactive Dispatch

After `createExportJob` returns:

- synchronous jobs call `processExportJob` inline and return generated content as before;
- asynchronous jobs await the payroll queue helper with the persisted job ID and the already-authorized organization ID, then return the persisted job ID.

Both the settings action and scoped payroll workspace follow this behavior. Neither action returns an asynchronous success response before queue insertion succeeds.

## Worker Routing

The one-off worker gains a `payroll-export` case. It invokes the payroll export service with the payload's `jobId` and `organizationId` and returns a payroll-specific success result. It never routes payroll IDs through the general export processor.

Global one-off worker exception handling remains unchanged. `processExportJob` already records a failed database state before rethrowing processing errors, so dispatched payroll jobs do not remain pending when ordinary processing fails.

## Tenant-Scoped Processing

`processExportJob` requires both `jobId` and `organizationId`. The initial processing transition, job/config lookup, completion updates, failure updates, and result metadata writes all filter by both identifiers.

All existing callers already possess trusted organization context:

- interactive actions use their authenticated/authorized organization;
- the queue worker uses the required organization payload;
- scheduled export execution uses the owning schedule's organization.

Downstream work-period, absence, storage, and connector operations continue using the persisted scoped job's organization.

## Enqueue Failures

If queue insertion rejects, the payroll queue helper updates the persisted job to `failed` by `(jobId, organizationId)` with a generic queueing error and logs the underlying server-side cause. It then rethrows so the action returns failure rather than telling the user processing started.

If marking the job failed also rejects, the helper logs that secondary failure while preserving the original queue error. No queue credentials or sensitive export data are exposed to users or logs.

## Testing

Tests are written before production changes and run in red-green-refactor cycles.

Queue tests verify:

- the dedicated name, type, organization payload, priority, and deterministic BullMQ ID;
- enqueue rejection marks the matching organization-owned payroll job failed and rethrows.

Action tests verify:

- both interactive actions enqueue asynchronous jobs and do not process them inline;
- synchronous jobs process inline and do not enqueue;
- returned job IDs remain payroll database IDs.

Worker and service tests verify:

- `payroll-export` routes to payroll processing and never the general export processor;
- job lookup and every status/result update use both job and organization IDs;
- a mismatched organization cannot process another tenant's payroll job;
- scheduled payroll execution still processes inline with its organization.

Focused tests, changed-file Biome checks, `git diff --check`, and the full webapp test suite run before integration.

## Residual Risks

Database insertion and Redis enqueue are not transactional. Queue rejection is handled, but a process crash after the database commit and before the enqueue call can still leave a pending row. Eliminating that window requires a durable outbox or polling reconciler and is outside this focused fix.

The general one-off worker currently resolves `{ success: false }` instead of rejecting processor errors, so BullMQ retries are not consumed. That repository-wide failure-semantics concern is being handled separately and is not changed here.
