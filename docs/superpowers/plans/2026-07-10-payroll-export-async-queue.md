# Payroll Export Async Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dispatch large interactive payroll exports to a dedicated tenant-scoped worker so they transition out of `pending`.

**Architecture:** Require `{ jobId, organizationId }` throughout payroll processing, add a dedicated deterministic BullMQ payload/helper and worker route, then await dispatch from both interactive actions while leaving scheduled exports inline. Queue insertion failures mark the persisted organization-owned job failed before surfacing the action error.

**Tech Stack:** TypeScript, BullMQ, Drizzle ORM, Effect, Luxon, Vitest.

**Design:** `docs/superpowers/specs/2026-07-10-payroll-export-async-queue-design.md`

---

### Task 1: Tenant-Scope Payroll Export Processing

**Files:**
- Modify: `apps/webapp/src/lib/payroll-export/export-service.ts:6,181-362`
- Modify: `apps/webapp/src/lib/payroll-export/index.ts:21-33`
- Modify: `apps/webapp/src/lib/scheduled-exports/application/executors/payroll-export-executor.ts:70-90`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.ts:1854-1857`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts:97-109`
- Create: `apps/webapp/src/lib/payroll-export/export-service.test.ts`

- [ ] **Step 1: Write failing service-scope tests**

Mock the database query/update chains and call:

```ts
await expect(
	processExportJob({ jobId: "job-1", organizationId: "org-1" }),
).rejects.toThrow("Job not found: job-1");
```

Spy on Drizzle `eq`/`and` and assert both the initial processing update and lookup include:

```ts
expect(eq).toHaveBeenCalledWith(payrollExportJob.id, "job-1");
expect(eq).toHaveBeenCalledWith(payrollExportJob.organizationId, "org-1");
```

Add a test for a new failure helper:

```ts
await markPayrollExportJobFailed({
	jobId: "job-1",
	organizationId: "org-1",
	errorMessage: "Failed to queue payroll export",
});

expect(updateWhere).toHaveBeenCalledWith(
	expect.objectContaining({ and: expect.any(Array) }),
);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run src/lib/payroll-export/export-service.test.ts`

Expected: FAIL because `processExportJob` accepts only a bare job ID and the failure helper does not exist.

- [ ] **Step 3: Require organization scope in the service**

Import `and` and define:

```ts
export interface ProcessPayrollExportJobInput {
	jobId: string;
	organizationId: string;
}

export async function processExportJob({
	jobId,
	organizationId,
}: ProcessPayrollExportJobInput): Promise<{
	result?: ExportResult;
	apiResult?: ApiExportResult;
	downloadUrl?: string;
}> {
```

Use one scope expression at every job mutation/read:

```ts
and(
	eq(payrollExportJob.id, jobId),
	eq(payrollExportJob.organizationId, organizationId),
)
```

Apply it to processing, lookup, API completion, async file completion, sync completion, and catch-path failure updates. Keep downstream reads/storage based on the scoped persisted job.

Add the reusable queue-failure transition:

```ts
export async function markPayrollExportJobFailed(input: {
	jobId: string;
	organizationId: string;
	errorMessage: string;
}): Promise<void> {
	await db
		.update(payrollExportJob)
		.set({
			status: "failed",
			errorMessage: input.errorMessage,
			completedAt: new Date(),
		})
		.where(
			and(
				eq(payrollExportJob.id, input.jobId),
				eq(payrollExportJob.organizationId, input.organizationId),
			),
		);
}
```

Export the helper/type through the payroll module.

- [ ] **Step 4: Update existing inline callers**

Settings and payroll workspace synchronous paths call:

```ts
processExportJob({ jobId, organizationId: input.organizationId })
```

and:

```ts
processExportJob({
	jobId,
	organizationId: authContext.employee.organizationId,
})
```

Scheduled payroll execution calls:

```ts
processExportJob({ jobId, organizationId })
```

- [ ] **Step 5: Verify GREEN and callers**

Run:

```bash
pnpm exec vitest run src/lib/payroll-export/export-service.test.ts
pnpm exec biome check src/lib/payroll-export/export-service.ts src/lib/payroll-export/export-service.test.ts src/lib/payroll-export/index.ts src/lib/scheduled-exports/application/executors/payroll-export-executor.ts 'src/app/[locale]/(app)/settings/payroll-export/actions.ts' 'src/app/[locale]/(app)/payroll/actions.ts'
```

Expected: tests and Biome PASS; `git diff --check` is clean.

### Task 2: Dedicated Payroll Queue And Worker Route

**Files:**
- Modify: `apps/webapp/src/lib/queue/index.ts:31-41,53-57,112-124`
- Create: `apps/webapp/src/lib/payroll-export/queue.ts`
- Create: `apps/webapp/src/lib/payroll-export/queue.test.ts`
- Modify: `apps/webapp/src/lib/payroll-export/index.ts`
- Modify: `apps/webapp/src/worker.ts:123-202`

- [ ] **Step 1: Write failing queue and worker tests**

Mock `addJob`, `markPayrollExportJobFailed`, and `processExportJob`. Assert enqueueing calls:

```ts
expect(addJob).toHaveBeenCalledWith(
	"process-payroll-export",
	{
		type: "payroll-export",
		jobId: "job-1",
		organizationId: "org-1",
	},
	{
		priority: 4,
		jobId: "payroll-export-job-1",
	},
);
```

On `addJob` rejection, assert:

```ts
expect(markPayrollExportJobFailed).toHaveBeenCalledWith({
	jobId: "job-1",
	organizationId: "org-1",
	errorMessage: "Failed to queue payroll export",
});
```

and the original queue error is rethrown.

Pass a BullMQ-like job to `processOneOffJob` and assert payroll processing receives exactly `{ jobId, organizationId }`, returns success, and the generic export processor is untouched.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run src/lib/payroll-export/queue.test.ts`

Expected: FAIL because the payload, helper, and worker case do not exist.

- [ ] **Step 3: Add queue contract and helper**

In the shared queue types:

```ts
export interface PayrollExportJobData {
	type: "payroll-export";
	jobId: string;
	organizationId: string;
}
```

Add `"payroll-export"` to `JobType` and `PayrollExportJobData` to `JobData`.

Implement `queue.ts`:

```ts
export async function enqueuePayrollExportJob(input: {
	jobId: string;
	organizationId: string;
}) {
	try {
		return await addJob(
			"process-payroll-export",
			{ ...input, type: "payroll-export" },
			{ priority: 4, jobId: `payroll-export-${input.jobId}` },
		);
	} catch (error) {
		logger.error({ error, ...input }, "Failed to queue payroll export");
		try {
			await markPayrollExportJobFailed({
				...input,
				errorMessage: "Failed to queue payroll export",
			});
		} catch (statusError) {
			logger.error({ error: statusError, ...input }, "Failed to mark payroll export as failed");
		}
		throw error;
	}
}
```

Export the helper through `payroll-export/index.ts`.

- [ ] **Step 4: Add worker routing**

Add a distinct switch case:

```ts
case "payroll-export": {
	const { processExportJob } = await import("@/lib/payroll-export");
	await processExportJob({
		jobId: job.data.jobId,
		organizationId: job.data.organizationId,
	});
	return { success: true, message: "Payroll export processed" };
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm exec vitest run src/lib/payroll-export/queue.test.ts
pnpm exec biome check src/lib/queue/index.ts src/lib/payroll-export/queue.ts src/lib/payroll-export/queue.test.ts src/lib/payroll-export/index.ts src/worker.ts
```

Expected: tests and Biome PASS; `git diff --check` is clean.

### Task 3: Dispatch Both Interactive Async Actions

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.ts:1842-1875`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.start-export.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts:65-116`
- Create: `apps/webapp/src/app/[locale]/(app)/payroll/actions.start-export.test.ts`

- [ ] **Step 1: Write settings action RED tests**

Mock `enqueuePayrollExportJob`. For the existing async result assert:

```ts
expect(enqueuePayrollExportJob).toHaveBeenCalledWith({
	jobId: "job-1",
	organizationId: "org-1",
});
expect(processExportJob).not.toHaveBeenCalled();
```

Add a synchronous result test asserting inline processing receives the scoped input and queueing is untouched.

- [ ] **Step 2: Write payroll workspace action RED tests**

Mock the action's auth/context dependencies so the resolved employee is `{ id: "employee-1", organizationId: "org-1" }`. For async creation assert the queue helper receives `job-1/org-1` and inline processing is untouched. Add the synchronous inverse.

- [ ] **Step 3: Run action tests and verify RED**

Run:

```bash
pnpm exec vitest run 'src/app/[locale]/(app)/settings/payroll-export/actions.start-export.test.ts' 'src/app/[locale]/(app)/payroll/actions.start-export.test.ts'
```

Expected: async assertions FAIL because both actions currently return without dispatch.

- [ ] **Step 4: Await queueing in both async branches**

Settings:

```ts
yield* _(
	Effect.promise(() =>
		enqueuePayrollExportJob({
			jobId,
			organizationId: input.organizationId,
		}),
	),
);
```

Payroll workspace:

```ts
if (isAsync) {
	await enqueuePayrollExportJob({
		jobId,
		organizationId: authContext.employee.organizationId,
	});
	return { jobId, isAsync };
}
```

- [ ] **Step 5: Verify GREEN**

Run both action tests, their existing neighboring payroll tests, Biome on changed files, and `git diff --check`.

### Task 4: Final Payroll Verification

- [ ] **Step 1: Run all focused payroll queue tests**

```bash
pnpm exec vitest run src/lib/payroll-export/export-service.test.ts src/lib/payroll-export/queue.test.ts 'src/app/[locale]/(app)/settings/payroll-export/actions.start-export.test.ts' 'src/app/[locale]/(app)/settings/payroll-export/actions.workday.test.ts' 'src/app/[locale]/(app)/payroll/actions.start-export.test.ts'
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run changed-file Biome and diff checks**

Run Biome on every changed TypeScript file and `git diff --check ce812931...HEAD`.

- [ ] **Step 3: Run the complete webapp suite**

Run: `pnpm test`

Expected: 0 failures. Record unrelated baseline warnings without changing unrelated files.

- [ ] **Step 4: Final security and scope review**

Confirm every queue payload contains organization ID, every payroll job lookup/update filters organization ID, both async actions await enqueueing, sync/scheduled paths remain inline, queue failures cannot leave an ordinary rejected dispatch pending, and the general export processor is never used for payroll IDs.
