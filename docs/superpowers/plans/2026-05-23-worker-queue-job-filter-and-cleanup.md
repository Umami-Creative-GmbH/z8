# Worker Queue Job Filter And Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-page per-job filter for `/platform-admin/worker-queue` recent executions and register a daily cleanup cron for old execution records.

**Architecture:** Keep the platform admin page as the single operational surface. Move the Recent Executions table into a small client component that starts with server-rendered global data and fetches per-job history through a focused server action. Register cleanup through the existing cron registry so cleanup runs in the worker and is tracked in `cron_job_execution`.

**Tech Stack:** Next.js App Router, React client/server components, server actions, Vitest, BullMQ cron registry, Drizzle/Postgres cron tracking.

---

## File Structure

- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`
  - Export reusable execution mapping helpers.
  - Add `getWorkerQueueJobExecutions(jobName: string)` server action.
  - Include `availableJobNames` in `WorkerQueueStats`.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/recent-executions.tsx`
  - Client component that owns the in-page selected job state, fetch state, and table rendering.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx`
  - Remove inline Recent Executions table body and render the client component.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts`
  - Tests hidden/invalid job rejection and per-job last-50 fetch mapping.
- Create: `apps/webapp/src/lib/jobs/execution-cleanup.ts`
  - Small cron processor that calls `cleanupOldExecutions(90)`.
- Create: `apps/webapp/src/lib/jobs/execution-cleanup.test.ts`
  - Tests cleanup calls the tracking helper with 90 days and returns metadata.
- Modify: `apps/webapp/src/lib/cron/registry.ts`
  - Add result type and daily `cron:execution-cleanup` entry.
- Create: `apps/webapp/src/lib/cron/registry.test.ts`
  - Tests cleanup cron schedule and description are registered.

## Task 1: Server Action For Per-Job Execution History

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts`

- [ ] **Step 1: Write failing tests for filtered execution fetch**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getJobExecutionHistory: vi.fn(),
	requirePlatformAdmin: vi.fn(),
	runServerActionSafe: vi.fn(async (effect: unknown) => {
		if (effect && typeof (effect as { run?: unknown }).run === "function") {
			return { success: true, data: await (effect as { run: () => Promise<unknown> }).run() };
		}
		return { success: true, data: await effect };
	}),
}));

vi.mock("@/lib/cron/tracking", () => ({
	getAllJobMetrics: vi.fn(),
	getExecutionsSince: vi.fn(),
	getJobExecutionHistory: mockState.getJobExecutionHistory,
	getRecentExecutions: vi.fn(),
}));

vi.mock("@/lib/effect/result", () => ({
	runServerActionSafe: mockState.runServerActionSafe,
}));

vi.mock("@/lib/effect/runtime", () => ({
	AppLayer: {},
}));

vi.mock("@/lib/effect/services/platform-admin.service", () => ({
	PlatformAdminService: {
		requirePlatformAdmin: mockState.requirePlatformAdmin,
	},
}));

vi.mock("@/lib/queue", () => ({
	getJobQueue: vi.fn(),
	isQueueHealthy: vi.fn(),
}));

vi.mock("./reliability", () => ({
	buildReliabilityData: vi.fn(),
}));

const { getWorkerQueueJobExecutions } = await import("./actions");

describe("worker queue actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requirePlatformAdmin.mockResolvedValue(undefined);
		mockState.getJobExecutionHistory.mockResolvedValue([
			{
				id: "execution-1",
				jobName: "cron:work-balance",
				status: "failed",
				startedAt: new Date("2026-05-23T09:00:00.000Z"),
				completedAt: new Date("2026-05-23T09:00:10.000Z"),
				durationMs: 10_000,
				error: "Boom",
			},
		]);
	});

	it("returns the last 50 executions for a selected visible job", async () => {
		const result = await getWorkerQueueJobExecutions("cron:work-balance");

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error("Expected action to succeed");
		}
		expect(mockState.requirePlatformAdmin).toHaveBeenCalledOnce();
		expect(mockState.getJobExecutionHistory).toHaveBeenCalledWith("cron:work-balance", 50);
		expect(result.data).toEqual([
			{
				id: "execution-1",
				jobName: "cron:work-balance",
				status: "failed",
				startedAt: "2026-05-23T09:00:00.000Z",
				completedAt: "2026-05-23T09:00:10.000Z",
				durationMs: 10_000,
				error: "Boom",
			},
		]);
	});

	it("rejects the hidden telemetry job", async () => {
		const result = await getWorkerQueueJobExecutions("cron:telemetry");

		expect(result.success).toBe(false);
		expect(mockState.getJobExecutionHistory).not.toHaveBeenCalled();
	});

	it("rejects non-cron job names", async () => {
		const result = await getWorkerQueueJobExecutions("not-a-cron-job");

		expect(result.success).toBe(false);
		expect(mockState.getJobExecutionHistory).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @z8/webapp test src/app/[locale]/\(admin\)/platform-admin/worker-queue/actions.test.ts
```

Expected: FAIL because `getWorkerQueueJobExecutions` is not exported yet. If the package filter name differs, run from `apps/webapp` with `pnpm test src/app/[locale]/\(admin\)/platform-admin/worker-queue/actions.test.ts`.

- [ ] **Step 3: Implement the server action and available job names**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`:

```ts
import {
	getAllJobMetrics,
	getExecutionsSince,
	getJobExecutionHistory,
	getRecentExecutions,
} from "@/lib/cron/tracking";
```

Add `availableJobNames` to `WorkerQueueStats`:

```ts
export interface WorkerQueueStats {
	isConnected: boolean;
	counts: QueueCounts;
	repeatableJobs: RepeatableJob[];
	recentExecutions: RecentExecution[];
	availableJobNames: string[];
	jobMetrics: JobMetric[];
	reliability: WorkerReliabilityData;
	fetchedAt: string;
}
```

Add helpers near `isHiddenWorkerName`:

```ts
const RECENT_EXECUTION_LIMIT = 50;

function isValidVisibleCronJobName(name: string) {
	return name.startsWith("cron:") && !isHiddenWorkerName(name);
}

function mapRecentExecution(exec: {
	id: string;
	jobName: string;
	status: string;
	startedAt: Date;
	completedAt: Date | null;
	durationMs: number | null;
	error: string | null;
}): RecentExecution {
	return {
		id: exec.id,
		jobName: exec.jobName,
		status: exec.status,
		startedAt: exec.startedAt.toISOString(),
		completedAt: exec.completedAt?.toISOString() ?? null,
		durationMs: exec.durationMs,
		error: exec.error,
	};
}

function collectAvailableJobNames(input: {
	repeatableJobs: RepeatableJob[];
	recentExecutions: RecentExecution[];
	jobMetrics: JobMetric[];
	reliabilityJobs: WorkerReliabilityData["jobs"];
}) {
	return Array.from(
		new Set([
			...input.repeatableJobs.map((job) => job.name),
			...input.recentExecutions.map((execution) => execution.jobName),
			...input.jobMetrics.map((metric) => metric.jobName),
			...input.reliabilityJobs.map((job) => job.jobName),
		]),
	)
		.filter(isValidVisibleCronJobName)
		.sort((a, b) => a.localeCompare(b));
}
```

Replace the inline recent execution map with:

```ts
const executions = yield* Effect.tryPromise({
	try: () => getRecentExecutions(RECENT_EXECUTION_LIMIT),
	catch: () =>
		new DatabaseError({
			message: "Failed to fetch recent executions",
			operation: "query",
			table: "cron_job_execution",
		}),
});

const recentExecutions: RecentExecution[] = executions
	.filter((exec) => !isHiddenWorkerName(exec.jobName))
	.map(mapRecentExecution);
```

Before the final `return`, compute:

```ts
const availableJobNames = collectAvailableJobNames({
	repeatableJobs,
	recentExecutions,
	jobMetrics,
	reliabilityJobs: reliability.jobs,
});
```

Include `availableJobNames` in the returned object.

Add the new action at the end of the file:

```ts
export async function getWorkerQueueJobExecutions(
	jobName: string,
): Promise<ServerActionResult<RecentExecution[]>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		if (!isValidVisibleCronJobName(jobName)) {
			return yield* Effect.fail(
				new DatabaseError({
					message: "Invalid worker job filter",
					operation: "query",
					table: "cron_job_execution",
				}),
			);
		}

		const executions = yield* Effect.tryPromise({
			try: () => getJobExecutionHistory(jobName, RECENT_EXECUTION_LIMIT),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch job execution history",
					operation: "query",
					table: "cron_job_execution",
				}),
		});

		return executions.filter((exec) => !isHiddenWorkerName(exec.jobName)).map(mapRecentExecution);
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @z8/webapp test src/app/[locale]/\(admin\)/platform-admin/worker-queue/actions.test.ts
```

Expected: PASS. If the mocked Effect runtime shape in the test does not match the repository's Effect usage, replace this unit test with a pure helper test by exporting `mapRecentExecution` and `collectAvailableJobNames` only if that is less brittle.

- [ ] **Step 5: Commit Task 1 changes**

Only commit if the user explicitly requested commits for this session. Otherwise leave the changes unstaged.

```bash
git add apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/actions.ts apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/actions.test.ts
git commit -m "feat: add worker queue job execution action"
```

## Task 2: Client-Side Recent Executions Filter UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/recent-executions.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx`

- [ ] **Step 1: Create the client component**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/recent-executions.tsx`:

```tsx
"use client";

import { IconCheck, IconClock, IconLoader, IconX } from "@tabler/icons-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getWorkerQueueJobExecutions, type RecentExecution } from "./actions";

const ALL_JOBS_VALUE = "__all_jobs__";

interface RecentExecutionsLabels {
	description: string;
	filteredDescription: string;
	allJobs: string;
	filterLabel: string;
	retry: string;
	loadError: string;
	noExecutions: string;
	jobName: string;
	status: string;
	startedAt: string;
	duration: string;
	error: string;
	unknown: string;
	statusLabels: Record<string, string>;
}

interface RecentExecutionsProps {
	initialExecutions: RecentExecution[];
	availableJobNames: string[];
	locale: string;
	labels: RecentExecutionsLabels;
	formatDateTime: (value: string | null, locale: string) => string;
	formatDuration: (value: number | null, unknownLabel: string, locale: string) => string;
}

function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
	switch (status) {
		case "completed":
			return (
				<Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">
					<IconCheck className="size-3 mr-1" aria-hidden="true" />
					{labels.completed}
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="outline" className="border-red-500 text-red-700 dark:text-red-400">
					<IconX className="size-3 mr-1" aria-hidden="true" />
					{labels.failed}
				</Badge>
			);
		case "running":
			return (
				<Badge variant="outline" className="border-blue-500 text-blue-700 dark:text-blue-400">
					<IconLoader className="size-3 mr-1 animate-spin" aria-hidden="true" />
					{labels.running}
				</Badge>
			);
		case "pending":
			return (
				<Badge variant="outline" className="border-yellow-500 text-yellow-700 dark:text-yellow-400">
					<IconClock className="size-3 mr-1" aria-hidden="true" />
					{labels.pending}
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}

export function RecentExecutions({
	initialExecutions,
	availableJobNames,
	locale,
	labels,
	formatDateTime,
	formatDuration,
}: RecentExecutionsProps) {
	const [selectedJobName, setSelectedJobName] = useState(ALL_JOBS_VALUE);
	const [executions, setExecutions] = useState(initialExecutions);
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	function loadJobExecutions(jobName: string) {
		setSelectedJobName(jobName);
		setError(null);

		if (jobName === ALL_JOBS_VALUE) {
			setExecutions(initialExecutions);
			return;
		}

		startTransition(async () => {
			const result = await getWorkerQueueJobExecutions(jobName);
			if (result.success) {
				setExecutions(result.data);
				return;
			}

			setError(result.error ?? labels.loadError);
		});
	}

	const selectedLabel = selectedJobName === ALL_JOBS_VALUE ? labels.allJobs : selectedJobName;
	const description =
		selectedJobName === ALL_JOBS_VALUE
			? labels.description
			: labels.filteredDescription.replace("{jobName}", selectedJobName);

	return (
		<Card>
			<CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
				<CardDescription>{description}</CardDescription>
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
					<label className="text-sm font-medium text-muted-foreground" htmlFor="worker-job-filter">
						{labels.filterLabel}
					</label>
					<Select value={selectedJobName} onValueChange={loadJobExecutions} disabled={isPending}>
						<SelectTrigger id="worker-job-filter" className="w-full sm:w-72">
							<SelectValue aria-label={selectedLabel}>{selectedLabel}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL_JOBS_VALUE}>{labels.allJobs}</SelectItem>
							{availableJobNames.map((jobName) => (
								<SelectItem key={jobName} value={jobName}>
									{jobName}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</CardHeader>
			<CardContent>
				{error ? (
					<div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
						<span>{error}</span>
						<Button size="sm" variant="outline" onClick={() => loadJobExecutions(selectedJobName)}>
							{labels.retry}
						</Button>
					</div>
				) : null}
				{executions.length === 0 ? (
					<p className="text-muted-foreground text-sm">{labels.noExecutions}</p>
				) : (
					<div className="overflow-x-auto">
						<Table aria-busy={isPending}>
							<TableHeader>
								<TableRow>
									<TableHead>{labels.jobName}</TableHead>
									<TableHead>{labels.status}</TableHead>
									<TableHead>{labels.startedAt}</TableHead>
									<TableHead>{labels.duration}</TableHead>
									<TableHead>{labels.error}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{executions.map((exec) => (
									<TableRow key={exec.id}>
										<TableCell className="font-mono text-sm">{exec.jobName}</TableCell>
										<TableCell>
											<StatusBadge status={exec.status} labels={labels.statusLabels} />
										</TableCell>
										<TableCell>{formatDateTime(exec.startedAt, locale)}</TableCell>
										<TableCell>{formatDuration(exec.durationMs, labels.unknown, locale)}</TableCell>
										<TableCell className="max-w-xs truncate text-red-600" title={exec.error ?? undefined}>
											{exec.error ?? "-"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 2: Replace the inline table in the page**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx` imports:

```ts
import { RecentExecutions } from "./recent-executions";
```

Remove `IconLoader` from the page imports if only `StatusBadge` used it and `StatusBadge` is deleted. Delete the page-local `StatusBadge` function.

Replace the `<Card>...</Card>` inside the Recent Executions section with:

```tsx
<RecentExecutions
	initialExecutions={stats.recentExecutions}
	availableJobNames={stats.availableJobNames}
	locale={locale}
	labels={{
		description: t(
			"settings.workerQueue.recentExecutionsDescription",
			"Last 50 job executions tracked in the database.",
		),
		filteredDescription: t(
			"settings.workerQueue.recentExecutionsFilteredDescription",
			"Last 50 executions for {jobName}.",
		),
		allJobs: t("settings.workerQueue.filters.allJobs", "All jobs"),
		filterLabel: t("settings.workerQueue.filters.job", "Job"),
		retry: t("settings.workerQueue.retry", "Retry"),
		loadError: t("settings.workerQueue.filteredExecutionsLoadError", "Failed to load job executions"),
		noExecutions: t("settings.workerQueue.noExecutions", "No recent executions found"),
		jobName: t("settings.workerQueue.table.jobName", "Job Name"),
		status: t("settings.workerQueue.table.status", "Status"),
		startedAt: t("settings.workerQueue.table.startedAt", "Started At"),
		duration: t("settings.workerQueue.table.duration", "Duration"),
		error: t("settings.workerQueue.table.error", "Error"),
		unknown: unknownLabel,
		statusLabels,
	}}
	formatDateTime={formatDateTime}
	formatDuration={formatDuration}
/>
```

- [ ] **Step 3: Run typecheck or focused build feedback**

Run:

```bash
pnpm --filter @z8/webapp typecheck
```

Expected: PASS. If the repository does not define a `typecheck` script, run `CI=true pnpm build` from the repository root after Task 4 instead.

- [ ] **Step 4: Commit Task 2 changes**

Only commit if explicitly requested.

```bash
git add apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/page.tsx apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/recent-executions.tsx
git commit -m "feat: filter worker queue executions by job"
```

## Task 3: Daily Execution Cleanup Job

**Files:**
- Create: `apps/webapp/src/lib/jobs/execution-cleanup.ts`
- Create: `apps/webapp/src/lib/jobs/execution-cleanup.test.ts`
- Modify: `apps/webapp/src/lib/cron/registry.ts`
- Create: `apps/webapp/src/lib/cron/registry.test.ts`

- [ ] **Step 1: Write failing cleanup job test**

Create `apps/webapp/src/lib/jobs/execution-cleanup.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	cleanupOldExecutions: vi.fn(),
}));

vi.mock("@/lib/cron/tracking", () => ({
	cleanupOldExecutions: mockState.cleanupOldExecutions,
}));

const { runExecutionCleanup } = await import("./execution-cleanup");

describe("runExecutionCleanup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.cleanupOldExecutions.mockResolvedValue(12);
	});

	it("deletes cron executions older than 90 days", async () => {
		const result = await runExecutionCleanup();

		expect(mockState.cleanupOldExecutions).toHaveBeenCalledWith(90);
		expect(result).toEqual({ success: true, deletedCount: 12, daysToKeep: 90 });
	});
});
```

- [ ] **Step 2: Run cleanup job test and verify it fails**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/jobs/execution-cleanup.test.ts
```

Expected: FAIL because `execution-cleanup.ts` does not exist.

- [ ] **Step 3: Implement cleanup job module**

Create `apps/webapp/src/lib/jobs/execution-cleanup.ts`:

```ts
import { cleanupOldExecutions } from "@/lib/cron/tracking";

export interface ExecutionCleanupResult {
	success: true;
	deletedCount: number;
	daysToKeep: number;
}

const EXECUTION_HISTORY_RETENTION_DAYS = 90;

export async function runExecutionCleanup(): Promise<ExecutionCleanupResult> {
	const deletedCount = await cleanupOldExecutions(EXECUTION_HISTORY_RETENTION_DAYS);

	return {
		success: true,
		deletedCount,
		daysToKeep: EXECUTION_HISTORY_RETENTION_DAYS,
	};
}
```

- [ ] **Step 4: Run cleanup job test and verify it passes**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/jobs/execution-cleanup.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing cron registry test**

Create `apps/webapp/src/lib/cron/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CRON_JOBS } from "./registry";

describe("cron registry", () => {
	it("registers execution cleanup once per day", () => {
		expect(CRON_JOBS["cron:execution-cleanup"]).toMatchObject({
			schedule: "30 2 * * *",
			description: "Delete cron execution records older than 90 days",
			defaultJobOptions: { attempts: 2, priority: 9 },
		});
	});
});
```

- [ ] **Step 6: Run registry test and verify it fails**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/cron/registry.test.ts
```

Expected: FAIL because `cron:execution-cleanup` is not registered.

- [ ] **Step 7: Register the cleanup cron**

Modify `apps/webapp/src/lib/cron/registry.ts`.

Add result type near the other result interfaces:

```ts
export interface ExecutionCleanupResult {
	success: true;
	deletedCount: number;
	daysToKeep: number;
}
```

Add the registry entry after `cron:organization-cleanup`:

```ts
"cron:execution-cleanup": {
	schedule: "30 2 * * *", // Daily at 2:30 AM
	description: "Delete cron execution records older than 90 days",
	processor: async (): Promise<ExecutionCleanupResult> => {
		const { runExecutionCleanup } = await import("@/lib/jobs/execution-cleanup");
		return runExecutionCleanup();
	},
	defaultJobOptions: { attempts: 2, priority: 9 },
},
```

- [ ] **Step 8: Run cleanup registry tests and verify they pass**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/jobs/execution-cleanup.test.ts src/lib/cron/registry.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3 changes**

Only commit if explicitly requested.

```bash
git add apps/webapp/src/lib/jobs/execution-cleanup.ts apps/webapp/src/lib/jobs/execution-cleanup.test.ts apps/webapp/src/lib/cron/registry.ts apps/webapp/src/lib/cron/registry.test.ts
git commit -m "feat: schedule cron execution cleanup"
```

## Task 4: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused worker queue and cron tests**

Run:

```bash
pnpm --filter @z8/webapp test src/app/[locale]/\(admin\)/platform-admin/worker-queue/actions.test.ts src/lib/jobs/execution-cleanup.test.ts src/lib/cron/registry.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository checks required for webapp changes**

Run from repository root:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run from repository root:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git diff -- apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/actions.ts apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/page.tsx apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/recent-executions.tsx apps/webapp/src/lib/jobs/execution-cleanup.ts apps/webapp/src/lib/cron/registry.ts docs/superpowers/specs/2026-05-23-worker-queue-job-filter-and-cleanup-design.md docs/superpowers/plans/2026-05-23-worker-queue-job-filter-and-cleanup.md
```

Expected: Diff only includes the approved worker queue filter, cleanup cron, tests, and docs.

- [ ] **Step 5: Final commit if requested**

Only commit if explicitly requested.

```bash
git status --short
git add apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/actions.ts apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/actions.test.ts apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/page.tsx apps/webapp/src/app/[locale]/\(admin\)/platform-admin/worker-queue/recent-executions.tsx apps/webapp/src/lib/jobs/execution-cleanup.ts apps/webapp/src/lib/jobs/execution-cleanup.test.ts apps/webapp/src/lib/cron/registry.ts apps/webapp/src/lib/cron/registry.test.ts docs/superpowers/specs/2026-05-23-worker-queue-job-filter-and-cleanup-design.md docs/superpowers/plans/2026-05-23-worker-queue-job-filter-and-cleanup.md
git commit -m "feat: filter worker queue executions"
```

Expected: Commit succeeds without staging unrelated files.

## Self-Review

- Spec coverage: Task 1 implements per-job data fetch, Task 2 implements in-page filtering, Task 3 implements once-daily 90-day cleanup, Task 4 verifies the change.
- Placeholder scan: The plan contains no deferred-work markers. It includes concrete file paths, commands, and code snippets.
- Type consistency: `RecentExecution`, `availableJobNames`, `getWorkerQueueJobExecutions`, `ExecutionCleanupResult`, and `runExecutionCleanup` are consistently named across tasks.
