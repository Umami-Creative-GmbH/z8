# BullMQ v6 Hard Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Z8 natively compatible with BullMQ 6, replace legacy repeatable jobs with Job Schedulers, and provide a guarded command for resetting only the `z8-jobs` queue during rollout.

**Architecture:** Cron reconciliation will idempotently upsert one scheduler per cron job using a deterministic scheduler ID. Queue diagnostics will read scheduler records and expose queue pause state separately from job counts. A small destructive-operation helper and CLI script will obliterate only the configured BullMQ queue after explicit confirmation and before v6 workers start.

**Tech Stack:** TypeScript, BullMQ 6, ioredis 6, Vitest, Next.js server actions, pnpm, Redis/Valkey

---

## File Map

- Modify `apps/webapp/src/lib/cron/reconciliation.ts`: replace removed repeatable-job APIs with `upsertJobScheduler`.
- Modify `apps/webapp/src/lib/cron/reconciliation.test.ts`: specify deterministic scheduler and template behavior.
- Modify `apps/webapp/src/lib/cron/schedules.ts`: accept BullMQ scheduler-shaped records while preserving the existing scheduled-row domain contract.
- Modify `apps/webapp/src/lib/cron/schedules.test.ts`: update fixtures and mismatch expectations for scheduler records.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`: call `getJobSchedulers` and `isPaused`; remove the invalid paused count.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts`: cover scheduler mapping and independent queue pause state.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx`: render running/paused queue state instead of a paused job count.
- Modify `apps/webapp/src/worker.ts`: update scheduler terminology and startup inspection.
- Create `apps/webapp/src/lib/queue/obliterate.ts`: validate confirmation and obliterate the queue.
- Create `apps/webapp/src/lib/queue/obliterate.test.ts`: prove the destructive operation is confirmation-gated and closes the queue.
- Create `apps/webapp/scripts/obliterate-job-queue.ts`: deployment CLI entrypoint.
- Modify `apps/webapp/package.json`: add the queue reset script and move BullMQ to at least 6.0.7.
- Modify `docker/targets/worker/package.json`: keep the worker runtime BullMQ version aligned.
- Modify `pnpm-lock.yaml`: resolve the root workspace dependency update.
- Modify `docker/targets/worker/pnpm-lock.yaml`: resolve the standalone worker target dependency update.
- Create `apps/webapp/scripts/smoke-bullmq-v6.ts`: exercise BullMQ 6 schedulers against disposable Valkey.
- Create `docs/refs/bullmq-v6-rollout.md`: document stop, reset, deploy, scheduler verification, and reconnect checks.

Do not commit during execution unless the user explicitly asks for commits.

### Task 1: Replace Cron Reconciliation With Job Schedulers

**Files:**
- Modify: `apps/webapp/src/lib/cron/reconciliation.test.ts`
- Modify: `apps/webapp/src/lib/cron/reconciliation.ts`

- [ ] **Step 1: Replace the fake repeatable queue with a scheduler queue**

In `reconciliation.test.ts`, replace the current `queue()` helper with:

```ts
function queue(overrides?: { upsertRejects?: boolean }) {
	return {
		upsertJobScheduler: vi.fn(() => {
			if (overrides?.upsertRejects) {
				return Promise.reject(new Error("upsert failed"));
			}
			return Promise.resolve({ id: "scheduled-job-1" });
		}),
	};
}
```

Replace the first reconciliation test with a test that expects the BullMQ 6 API:

```ts
it("upserts the effective schedule with a stable scheduler id and job template", async () => {
	const fakeQueue = queue();

	const result = await reconcileCronJobSchedule({
		queue: fakeQueue as never,
		jobName: "cron:export",
		pattern: "0 * * * *",
	});

	expect(fakeQueue.upsertJobScheduler).toHaveBeenCalledWith(
		"cron-cron:export",
		{ pattern: "0 * * * *" },
		{
			name: "cron:export",
			data: { type: "cron:export", triggeredAt: expect.any(String) },
			opts: expect.objectContaining({
				attempts: 2,
				priority: 5,
				removeOnComplete: { count: 50, age: 24 * 60 * 60 },
				removeOnFail: { count: 100, age: 7 * 24 * 60 * 60 },
			}),
		},
	);
	expect(result).toEqual({ success: true });
});
```

Change the rejection test to use `queue({ upsertRejects: true })`, expect `result.success` to be false, and expect the error to contain `upsert failed`. Remove the legacy stale-repeatable tests because a stable scheduler ID makes schedule changes an upsert instead of add-then-remove.

Keep the all-schedules test, but assert `upsertJobScheduler` was called twice and that `result.reconciled` contains both job names without `removedCount`.

- [ ] **Step 2: Run the cron reconciliation test and verify RED**

Run:

```bash
pnpm --dir apps/webapp test src/lib/cron/reconciliation.test.ts
```

Expected: FAIL because `reconcileCronJobSchedule` still calls `getRepeatableJobs`, `add`, and `removeRepeatableByKey` instead of `upsertJobScheduler`.

- [ ] **Step 3: Implement scheduler upsert reconciliation**

Replace the queue types and implementation in `reconciliation.ts` with the BullMQ 6 shape:

```ts
type CronQueue = Queue<JobData | SchedulerCronJobData, JobResult>;
type CronSchedulerQueue = Pick<CronQueue, "upsertJobScheduler">;

export type CronReconciliationResult =
	| { success: true }
	| { success: false; error: string };

export async function reconcileCronJobSchedule({
	queue,
	jobName,
	pattern,
}: {
	queue: CronSchedulerQueue;
	jobName: CronJobName;
	pattern: string;
}): Promise<CronReconciliationResult> {
	try {
		await queue.upsertJobScheduler(
			`cron-${jobName}`,
			{ pattern },
			{
				name: jobName,
				data: { type: jobName, triggeredAt: new Date().toISOString() },
				opts: {
					...CRON_JOBS[jobName].defaultJobOptions,
					removeOnComplete: { count: 50, age: 24 * 60 * 60 },
					removeOnFail: { count: 100, age: 7 * 24 * 60 * 60 },
				},
			},
		);

		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
```

Change `reconcileCronSchedules` to accept `CronSchedulerQueue`, store successful results as `{ jobName }`, and leave failed results as `{ jobName, error }`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --dir apps/webapp test src/lib/cron/reconciliation.test.ts
```

Expected: PASS with no references to removed repeatable-job methods in the test or implementation.

- [ ] **Step 5: Review the task diff**

Run:

```bash
git diff -- apps/webapp/src/lib/cron/reconciliation.ts apps/webapp/src/lib/cron/reconciliation.test.ts
```

Expected: only the repeatable-job-to-scheduler migration and corresponding tests.

### Task 2: Adapt Scheduled-Row Mapping To Scheduler Records

**Files:**
- Modify: `apps/webapp/src/lib/cron/schedules.test.ts`
- Modify: `apps/webapp/src/lib/cron/schedules.ts`

- [ ] **Step 1: Change tests to use the scheduler-facing input name**

In `schedules.test.ts`, change each `buildScheduledJobRows` input from `repeatableJobs` to `jobSchedulers`. Rename test descriptions from “repeatables” to “job schedulers”. Keep the existing record fields (`name`, `pattern`, and `next`) because those fields are also present in BullMQ 6 `JobSchedulerJson`.

Remove the duplicate-repeatables test. Replace it with an update-oriented scheduler test:

```ts
it("uses the scheduler with the effective pattern", () => {
	const rows = buildScheduledJobRows({
		overrides: [
			{ jobName: "cron:export", presetId: "hourly", pattern: "0 * * * *" },
		],
		jobSchedulers: [
			{
				name: "cron:export",
				pattern: "0 * * * *",
				next: Date.parse("2026-06-03T13:00:00.000Z"),
			},
		],
	});

	expect(rows.find((row) => row.name === "cron:export")).toMatchObject({
		currentBullMqPattern: "0 * * * *",
		next: Date.parse("2026-06-03T13:00:00.000Z"),
		hasScheduleMismatch: false,
	});
});
```

- [ ] **Step 2: Run the schedules test and verify RED**

Run:

```bash
pnpm --dir apps/webapp test src/lib/cron/schedules.test.ts
```

Expected: FAIL or TypeScript transform error because `buildScheduledJobRows` still requires `repeatableJobs`.

- [ ] **Step 3: Rename only the scheduler input boundary**

In `schedules.ts`:

```ts
export interface CronJobSchedulerLike {
	name: string;
	pattern?: string | null;
	next?: string | number | null;
}
```

Change `buildScheduledJobRows` to accept `jobSchedulers: readonly CronJobSchedulerLike[]`. Internally use `schedulersByName`, `schedulers`, and `selectedScheduler`. Preserve the existing `ScheduledCronJobRow` output fields so reliability and UI consumers do not need unrelated renames.

Compute mismatch as:

```ts
hasScheduleMismatch:
	schedulers.length === 0 ||
	schedulers.some((scheduler) => scheduler.pattern !== schedule.effectivePattern),
```

- [ ] **Step 4: Run the schedules test and verify GREEN**

Run:

```bash
pnpm --dir apps/webapp test src/lib/cron/schedules.test.ts
```

Expected: PASS.

### Task 3: Read Job Schedulers And Queue Pause State In Diagnostics

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx`

- [ ] **Step 1: Write the failing queue diagnostics test**

Update the existing `getWorkerQueueStats` test queue mock:

```ts
const getJobSchedulers = vi.fn().mockResolvedValue([
	{
		key: "cron-cron:export",
		name: "cron:export",
		pattern: "*/5 * * * *",
		next: Date.parse("2026-06-03T12:05:00.000Z"),
	},
	{
		key: "cron-cron:telemetry",
		name: "cron:telemetry",
		pattern: "* * * * *",
		next: Date.parse("2026-06-03T12:01:00.000Z"),
	},
]);
const isPaused = vi.fn().mockResolvedValue(true);

mocks.getJobQueue.mockReturnValue({
	getJobCounts: vi.fn().mockResolvedValue({ waiting: 3 }),
	getJobSchedulers,
	isPaused,
});
```

Add assertions:

```ts
expect(result.data.counts.waiting).toBe(3);
expect(result.data.counts).not.toHaveProperty("paused");
expect(result.data.isPaused).toBe(true);
expect(getJobSchedulers).toHaveBeenCalledOnce();
expect(isPaused).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run the action test and verify RED**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts'
```

Expected: FAIL because the action calls `getRepeatableJobs`, returns `counts.paused`, and does not return `isPaused`.

- [ ] **Step 3: Implement the BullMQ 6 diagnostics contract**

In `actions.ts`, remove `paused` from `QueueCounts` and add `isPaused: boolean` to `WorkerQueueStats`.

Initialize `isPaused` to `false`. When connected, fetch counts, schedulers, and pause state with the queue APIs. The scheduler and pause calls should retain the existing dashboard resilience:

```ts
const jobSchedulers = yield* Effect.promise(() => queue.getJobSchedulers()).pipe(
	Effect.orElseSucceed(() => [] as Awaited<ReturnType<typeof queue.getJobSchedulers>>),
);

isPaused = yield* Effect.promise(() => queue.isPaused()).pipe(
	Effect.orElseSucceed(() => false),
);
```

Map `jobSchedulers` into the existing local `RepeatableJob[]` domain records so reliability inputs remain unchanged. Pass the mapped records to `buildScheduledJobRows` using `jobSchedulers: repeatableJobs`.

Return `isPaused` beside `isConnected` and `counts`. Do not derive a paused count from waiting jobs.

- [ ] **Step 4: Render queue state instead of a paused count**

In `page.tsx`, change the sixth `StatCard` to:

```tsx
<StatCard
	title={t("settings.workerQueue.cards.queueState", "Queue")}
	value={
		stats.isPaused
			? t("settings.workerQueue.cards.paused", "Paused")
			: t("settings.workerQueue.cards.running", "Running")
	}
	locale={locale}
	description={t(
		"settings.workerQueue.cards.queueStateDescription",
		"Whether workers can take waiting jobs",
	)}
	icon={<IconPlayerPause className="size-4" />}
	variant={stats.isPaused ? "warning" : "success"}
/>
```

This preserves the six-card layout while making the value semantically correct for BullMQ 6.

- [ ] **Step 5: Run diagnostics and schedule tests**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts' src/lib/cron/schedules.test.ts
```

Expected: PASS.

### Task 4: Update Worker Startup To Scheduler APIs

**Files:**
- Modify: `apps/webapp/src/worker.ts`
- Modify: `apps/webapp/src/lib/cron/reconciliation.test.ts`

- [ ] **Step 1: Add a scheduler-list assertion to the reconciliation contract test**

Confirm the reconciliation test suite already proves that all configured schedules call `upsertJobScheduler` exactly once each. If it does not, add:

```ts
expect(fakeQueue.upsertJobScheduler).toHaveBeenCalledTimes(2);
expect(result.reconciled).toEqual([
	{ jobName: "cron:export" },
	{ jobName: "cron:vacation" },
]);
```

- [ ] **Step 2: Run the worker typecheck and verify RED**

Run:

```bash
pnpm --filter webapp typecheck
```

Expected: FAIL at `worker.ts` because startup still calls `getRepeatableJobs` and expects `removedCount`.

- [ ] **Step 3: Update worker terminology and startup listing**

In `worker.ts`:

- Change module comments from “repeatable cron jobs” to “scheduled cron jobs”.
- Replace the legacy repeatable-job comment above `setupCronJobs` with a short explanation that deterministic scheduler IDs make reconciliation idempotent across workers.
- Remove `removedCount` from the reconciliation debug payload.
- Change log messages from “repeatable cron job” to “cron job scheduler”.
- Replace startup listing with:

```ts
const jobSchedulers = await queue.getJobSchedulers();
logger.info(
	{
		jobSchedulers: jobSchedulers.map((scheduler) => ({
			id: scheduler.key,
			name: scheduler.name,
			pattern: scheduler.pattern,
			next: scheduler.next ? new Date(scheduler.next).toISOString() : null,
		})),
	},
	"Worker started with job schedulers",
);
```

- [ ] **Step 4: Run worker and reconciliation tests**

Run:

```bash
pnpm --dir apps/webapp test src/lib/cron/reconciliation.test.ts src/worker.test.ts
```

Expected: PASS.

### Task 5: Add A Confirmation-Gated Queue Reset Command

**Files:**
- Create: `apps/webapp/src/lib/queue/obliterate.test.ts`
- Create: `apps/webapp/src/lib/queue/obliterate.ts`
- Create: `apps/webapp/scripts/obliterate-job-queue.ts`
- Modify: `apps/webapp/package.json`

- [ ] **Step 1: Write failing tests for the destructive helper**

Create `obliterate.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { obliterateJobQueue } from "./obliterate";

function queue() {
	return {
		obliterate: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

describe("obliterateJobQueue", () => {
	it("rejects without the exact queue confirmation", async () => {
		const fakeQueue = queue();

		await expect(obliterateJobQueue(fakeQueue, "wrong-queue")).rejects.toThrow(
			'Confirmation must equal "z8-jobs"',
		);
		expect(fakeQueue.obliterate).not.toHaveBeenCalled();
		expect(fakeQueue.close).toHaveBeenCalledOnce();
	});

	it("force-obliterates z8-jobs after exact confirmation", async () => {
		const fakeQueue = queue();

		await obliterateJobQueue(fakeQueue, "z8-jobs");

		expect(fakeQueue.obliterate).toHaveBeenCalledWith({ force: true });
		expect(fakeQueue.close).toHaveBeenCalledOnce();
	});

	it("closes the queue when obliteration fails", async () => {
		const fakeQueue = queue();
		fakeQueue.obliterate.mockRejectedValue(new Error("redis unavailable"));

		await expect(obliterateJobQueue(fakeQueue, "z8-jobs")).rejects.toThrow("redis unavailable");
		expect(fakeQueue.close).toHaveBeenCalledOnce();
	});
});
```

- [ ] **Step 2: Run the reset helper test and verify RED**

Run:

```bash
pnpm --dir apps/webapp test src/lib/queue/obliterate.test.ts
```

Expected: FAIL because `./obliterate` does not exist.

- [ ] **Step 3: Implement the minimal guarded helper**

Create `obliterate.ts`:

```ts
import type { Queue } from "bullmq";

type ObliteratableQueue = Pick<Queue, "obliterate" | "close">;

export async function obliterateJobQueue(
	queue: ObliteratableQueue,
	confirmation: string | undefined,
): Promise<void> {
	try {
		if (confirmation !== "z8-jobs") {
			throw new Error('Confirmation must equal "z8-jobs"');
		}

		await queue.obliterate({ force: true });
	} finally {
		await queue.close();
	}
}
```

- [ ] **Step 4: Add the deployment CLI**

Create `apps/webapp/scripts/obliterate-job-queue.ts`:

```ts
import { getJobQueue } from "../src/lib/queue";
import { obliterateJobQueue } from "../src/lib/queue/obliterate";

const confirmation = process.argv
	.find((argument) => argument.startsWith("--confirm="))
	?.slice("--confirm=".length);

await obliterateJobQueue(getJobQueue(), confirmation);
console.info('BullMQ queue "z8-jobs" obliterated.');
```

Add this script to `apps/webapp/package.json`:

```json
"queue:obliterate": "TZ=UTC tsx scripts/obliterate-job-queue.ts"
```

- [ ] **Step 5: Run helper tests and a safe negative CLI check**

Run:

```bash
pnpm --dir apps/webapp test src/lib/queue/obliterate.test.ts
```

Expected: PASS.

Do not run the positive obliteration command against the developer's configured Redis. The positive path is exercised with a fake queue in the test and will be used against production only after workers are stopped.

### Task 6: Align BullMQ Dependencies And Locks

**Files:**
- Modify: `apps/webapp/package.json`
- Modify: `docker/targets/worker/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docker/targets/worker/pnpm-lock.yaml`

- [ ] **Step 1: Raise the minimum BullMQ patch version**

Change BullMQ in both package manifests:

```json
"bullmq": "^6.0.7"
```

Keep `ioredis` at `^6.0.0`. Do not add `protocol: 2`; RESP3 remains the intended ioredis 6 behavior unless verification reveals a concrete incompatibility.

- [ ] **Step 2: Refresh the root lockfile**

Run:

```bash
pnpm install
```

Expected: root `pnpm-lock.yaml` resolves BullMQ 6.0.7 or a newer compatible 6.x version and retains explicit ioredis 6.

- [ ] **Step 3: Refresh the standalone worker lockfile**

Run:

```bash
pnpm install --dir docker/targets/worker
```

Expected: `docker/targets/worker/pnpm-lock.yaml` resolves the same BullMQ range and includes ioredis as the installed optional peer used by the Redis backend.

- [ ] **Step 4: Inspect only the intended dependency changes**

Run:

```bash
git diff -- apps/webapp/package.json docker/targets/worker/package.json pnpm-lock.yaml docker/targets/worker/pnpm-lock.yaml
```

Expected: the pre-existing broad dependency update remains intact; this task only changes BullMQ from the user's 6.0.6 range to at least 6.0.7 and adds the queue script.

### Task 7: Add The Hard-Rollout Runbook

**Files:**
- Create: `docs/refs/bullmq-v6-rollout.md`

- [ ] **Step 1: Document the exact rollout sequence**

Create the runbook with these commands and gates:

```md
# BullMQ v6 Rollout

This is a one-time destructive rollout for the `z8-jobs` queue. It does not flush Redis.

1. Stop every webapp and worker process that can produce or consume `z8-jobs`.
2. Confirm there are no running BullMQ workers.
3. Run the queue-scoped reset from the release image/environment:

   `pnpm --dir apps/webapp queue:obliterate --confirm=z8-jobs`

4. Deploy the BullMQ 6 webapp and worker images.
5. Start one worker.
6. Open the platform worker queue page and verify every configured visible cron job has one scheduler, the configured pattern, and a next execution time.
7. Check worker logs for `Cron job schedule reconciliation completed` with zero failures.
8. Start the remaining webapp and worker processes.
9. Trigger or await one low-risk cron execution and verify it completes.
10. Restart Valkey/Redis during the maintenance window, then enqueue a low-risk job and verify the worker resumes processing after reconnect.

Abort the rollout before step 4 if obliteration fails. Stop the rollout after step 6 if any scheduler is missing or duplicated.
```

- [ ] **Step 2: Verify the runbook does not suggest a database-wide flush**

Run:

```bash
git diff -- docs/refs/bullmq-v6-rollout.md
```

Expected: only queue-scoped `obliterate` instructions; no `FLUSHDB`, `FLUSHALL`, wildcard key deletion, or raw Redis deletion command.

### Task 8: Final Verification

**Files:**
- Verify all files listed above.
- Create: `apps/webapp/scripts/smoke-bullmq-v6.ts`

- [ ] **Step 1: Prove removed BullMQ APIs are gone**

Run:

```bash
rg "getRepeatableJobs|removeRepeatable(ByKey)?|repeat:\s*\{" apps/webapp/src
```

Expected: no matches in application or test source. Domain variable names such as `repeatableJobs` may remain in reliability code because they are not BullMQ API calls.

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp test \
  src/lib/cron/reconciliation.test.ts \
  src/lib/cron/schedules.test.ts \
  src/lib/queue/obliterate.test.ts \
  'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts' \
  src/lib/queue/health.test.ts \
  src/worker.test.ts
```

Expected: all tests pass with no unhandled errors.

- [ ] **Step 3: Run webapp typechecking**

Run:

```bash
pnpm --filter webapp typecheck
```

Expected: PASS; the BullMQ 6 type errors for repeatable-job APIs and `jobCounts.paused` are gone.

- [ ] **Step 4: Verify the worker target package test**

Run:

```bash
pnpm node --test docker/scripts/prepare-target-runtime.test.mjs
```

Expected: PASS and the worker target still includes BullMQ and ioredis.

- [ ] **Step 5: Run the production build**

Run:

```bash
CI=true pnpm --filter webapp build
```

Expected: PASS. If Phase-managed environment variables are unavailable, record the environment blocker instead of weakening validation.

- [ ] **Step 6: Smoke-test schedulers against disposable Valkey**

Create `apps/webapp/scripts/smoke-bullmq-v6.ts`:

```ts
import assert from "node:assert/strict";
import { Queue, Worker } from "bullmq";

const queueName = `z8-bullmq-v6-smoke-${process.pid}`;
const connection = {
	host: "127.0.0.1",
	port: Number.parseInt(process.env.BULLMQ_SMOKE_PORT ?? "6389", 10),
	maxRetriesPerRequest: null,
};
const schedulerId = "cron-smoke";
const queue = new Queue(queueName, { connection });
const worker = new Worker(queueName, async (job) => job.data, { connection });

try {
	await worker.waitUntilReady();

	const completed = new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Scheduled job did not complete")), 10_000);
		worker.once("completed", () => {
			clearTimeout(timeout);
			resolve();
		});
	});

	await queue.upsertJobScheduler(
		schedulerId,
		{ pattern: "*/2 * * * * *" },
		{ name: "cron:smoke", data: { type: "cron:smoke" } },
	);
	await completed;

	let schedulers = await queue.getJobSchedulers();
	assert.equal(schedulers.length, 1);
	assert.equal(schedulers[0]?.key, schedulerId);
	assert.equal(schedulers[0]?.pattern, "*/2 * * * * *");

	await queue.upsertJobScheduler(
		schedulerId,
		{ pattern: "*/5 * * * * *" },
		{ name: "cron:smoke", data: { type: "cron:smoke" } },
	);
	schedulers = await queue.getJobSchedulers();
	assert.equal(schedulers.length, 1);
	assert.equal(schedulers[0]?.pattern, "*/5 * * * * *");

	assert.equal(await queue.removeJobScheduler(schedulerId), true);
	assert.equal((await queue.getJobSchedulers()).length, 0);
} finally {
	await worker.close();
	await queue.obliterate({ force: true });
	await queue.close();
}

console.info("BullMQ v6 scheduler smoke test passed.");
```

Start a disposable local Valkey container on a port that does not overlap configured services:

```bash
docker run --rm -d --name z8-bullmq-v6-smoke -p 6389:6379 valkey/valkey:9-alpine
```

Run the standalone smoke test:

```bash
BULLMQ_SMOKE_PORT=6389 BULLMQ_SMOKE_CONTAINER=z8-bullmq-v6-smoke pnpm --dir apps/webapp exec tsx scripts/smoke-bullmq-v6.ts
```

Stop the disposable container after verification:

```bash
docker stop z8-bullmq-v6-smoke
```

Expected: `BullMQ v6 scheduler smoke test passed.` Scheduler upsert, listing, update, execution, removal, cleanup, and completion by the existing worker after the disposable Valkey container restarts work under Valkey 9 and ioredis 6 RESP3. If Docker is unavailable, defer this smoke test to the deployment runbook and report it explicitly.

- [ ] **Step 7: Review final scope**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: no whitespace errors, no unrelated files modified by this implementation, and no existing user changes reverted.
