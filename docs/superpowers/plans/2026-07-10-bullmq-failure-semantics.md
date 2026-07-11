# BullMQ Failure Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make processor exceptions reject so BullMQ retries jobs, records failures, and reports failure to clients.

**Architecture:** Preserve application-level result objects, but stop converting thrown exceptions into resolved results. Track one cron database execution across attempts, mark it terminal only on the final attempt, and add client compatibility for legacy completed jobs containing `success:false`.

**Tech Stack:** BullMQ 5, Next.js, SWR, React 19, Vitest, Testing Library.

---

## File Map

- Create `apps/webapp/src/worker.test.ts`: focused one-off and cron processor tests.
- Modify `apps/webapp/src/worker.ts`: rethrow exceptions and align cron tracking with attempts.
- Modify `apps/webapp/src/lib/queue/use-job-status.test.tsx`: test real and legacy failures.
- Modify `apps/webapp/src/lib/queue/use-job-status.ts`: normalize terminal failure behavior.
- Preserve `apps/webapp/src/lib/import-review/queue.test.ts`: existing propagation regression.

Do not change webhook or calendar-sync semantic result handling. Do not commit unless explicitly requested.

### Task 1: Make One-Off Exceptions Reject

**Files:**
- Create: `apps/webapp/src/worker.test.ts`
- Modify: `apps/webapp/src/worker.ts:123-203`

- [ ] **Step 1: Add failing processor tests**

Mock `processAuditPack` to reject and assert:

```ts
await expect(
	processOneOffJob({
		id: "job-1",
		name: "process-audit-pack",
		data: { type: "audit-pack", requestId: "request-1", organizationId: "org-1" },
	} as Parameters<typeof processOneOffJob>[0]),
).rejects.toThrow("hardening blew up");
```

Add a type-cast unknown job test expecting `Unknown job type`. Retain the existing import-review propagation test as a second integration signal.

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm vitest run src/worker.test.ts
```

Expected: both tests resolve to `{ success: false }` instead of rejecting.

- [ ] **Step 3: Rethrow from the one-off catch**

Keep structured logging, then use:

```ts
throw error instanceof Error ? error : new Error(String(error));
```

Do not add `if (!result.success) throw`; returned semantic failures remain valid results.

- [ ] **Step 4: Confirm GREEN and protect import routing**

```bash
pnpm vitest run src/worker.test.ts src/lib/import-review/queue.test.ts
```

Expected: all tests PASS.

### Task 2: Make Cron Retries and Tracking Agree

**Files:**
- Modify: `apps/webapp/src/worker.test.ts`
- Modify: `apps/webapp/src/worker.ts:55-118`

- [ ] **Step 1: Add a failing non-final attempt test**

Mock a cron processor rejection and call `processJob` with `attemptsMade: 0`, `opts.attempts: 3`, and a supplied execution ID. Assert the promise rejects and `markJobFailed` is not called.

- [ ] **Step 2: Add a failing final-attempt test**

Use `attemptsMade: 2`, `opts.attempts: 3`. Assert `markJobFailed(executionId, "cron failed", expect.any(Number))` is called and the promise still rejects.

- [ ] **Step 3: Add a scheduler execution reuse test**

Use job data without `executionId`, mock `createJobExecution` to return `execution-scheduled`, and provide `updateData`. Assert:

```ts
expect(job.updateData).toHaveBeenCalledWith({
	...job.data,
	executionId: "execution-scheduled",
});
```

Then simulate a retry whose data contains that ID and assert `createJobExecution` is not called again.

- [ ] **Step 4: Run cron tests and confirm RED**

```bash
pnpm vitest run src/worker.test.ts -t "cron"
```

Expected: current code marks every exception failed and resolves `{ success:false }`; scheduler retries do not retain an execution ID.

- [ ] **Step 5: Implement final-attempt detection**

Add a small helper:

```ts
function isFinalAttempt(job: Job<unknown>) {
	const attempts = job.opts.attempts ?? 1;
	return job.attemptsMade + 1 >= attempts;
}
```

For scheduler jobs, create the execution once and persist it with `job.updateData({ ...job.data, executionId })` before marking it running.

- [ ] **Step 6: Reject cron exceptions**

In the catch, call `markJobFailed` only when `isFinalAttempt(job)` is true, log the failure with attempt context, and rethrow the normalized error. Intermediate failures leave the record non-terminal so status polling cannot return before BullMQ retries.

- [ ] **Step 7: Run all worker tests and confirm GREEN**

```bash
pnpm vitest run src/worker.test.ts src/lib/import-review/queue.test.ts src/lib/import-review/worker.test.ts
```

Expected: all tests PASS.

### Task 3: Treat Legacy Completed-Failure Results as Failed

**Files:**
- Modify: `apps/webapp/src/lib/queue/use-job-status.test.tsx`
- Modify: `apps/webapp/src/lib/queue/use-job-status.ts:101-127,143-220`

- [ ] **Step 1: Add a failing single-job hook test**

Import `useJobStatus`, return:

```json
{
  "state": "completed",
  "progress": 100,
  "result": { "success": false, "error": "hardening blew up" }
}
```

Assert `onError("hardening blew up")` is called and `onSuccess` is not called.

Add the normal BullMQ failure shape `{ state: "failed", progress: 0, error: "hardening blew up" }` and assert the same callback behavior. This characterizes the status shape produced after the worker fix.

- [ ] **Step 2: Add a failing batch-count test**

Return one normal completed result and one completed result with `success:false`. Assert `completedCount === 1`, `failedCount === 1`, and `pendingCount === 0`.

- [ ] **Step 3: Run hook tests and confirm RED**

```bash
pnpm vitest run src/lib/queue/use-job-status.test.tsx
```

Expected: legacy failure invokes success and increments completed count.

- [ ] **Step 4: Add one shared classifier**

```ts
function isFailedStatus(status: JobStatus) {
	return status.state === "failed" ||
		(status.state === "completed" && status.result?.success === false);
}
```

For a legacy completed failure, use `result.error ?? "Job failed"`. Check failure before successful completion in callbacks and counts. Keep terminal polling based on BullMQ state.

- [ ] **Step 5: Confirm GREEN**

```bash
pnpm vitest run src/lib/queue/use-job-status.test.tsx
```

Expected: all tests PASS.

### Task 4: Verify Queue Semantics

- [ ] Run focused suites:

```bash
pnpm vitest run src/worker.test.ts src/lib/queue/use-job-status.test.tsx src/lib/import-review/queue.test.ts src/lib/import-review/worker.test.ts src/lib/audit-pack/application/__tests__/audit-pack-orchestrator.test.ts
```

- [ ] Run touched-file checks:

```bash
pnpm exec biome check src/worker.ts src/worker.test.ts src/lib/queue/use-job-status.ts src/lib/queue/use-job-status.test.tsx
```

- [ ] Run typecheck:

```bash
pnpm typecheck
```

Expected: all commands pass. Record unrelated concurrent failures without changing their files.
