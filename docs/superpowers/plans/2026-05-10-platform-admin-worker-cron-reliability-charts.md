# Platform Admin Worker Cron Reliability Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliability summaries and charts to `/platform-admin/worker-queue` so platform admins can spot worker and cron failures, stale schedules, and runtime degradation.

**Architecture:** Keep `/platform-admin/worker-queue` as the single operational surface. Extend the existing server action with serializable reliability data from `cron_job_execution` and BullMQ repeatable jobs, put calculations in pure route-local helpers, and render charts in a small client component using the shared `ChartContainer` Recharts wrapper.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, BullMQ, Recharts, shadcn-style UI primitives, Vitest, Tolgee translation helpers.

---

## File Structure

- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.ts`
  - Pure reliability types and helper functions.
  - No database, BullMQ, React, or Next.js imports.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts`
  - Unit tests for daily buckets, success rate, stale thresholds, health-state priority, and empty-state handling.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability-charts.tsx`
  - Client component for run outcome and duration charts.
  - Uses dynamic Recharts imports and `ChartContainer`.
- Modify: `apps/webapp/src/lib/cron/tracking.ts`
  - Add a bounded query helper for execution history since a cutoff date.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`
  - Extend `WorkerQueueStats` with `reliability` and build it from recent executions plus repeatable jobs.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx`
  - Add the Reliability section between Queue Status and Scheduled Cron Jobs.
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`
  - Document that worker queue operations include reliability trends.

## Task 1: Add Failing Reliability Helper Tests

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.ts`

- [ ] **Step 1: Create the failing helper test file**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	buildReliabilityData,
	calculateSuccessRate,
	classifyJobHealth,
	inferStaleAfterMs,
	type ReliabilityExecution,
	type ReliabilityRepeatableJob,
} from "./reliability";

const now = new Date("2026-05-10T12:00:00.000Z");

function execution(
	overrides: Partial<ReliabilityExecution> & Pick<ReliabilityExecution, "id" | "status" | "startedAt">,
): ReliabilityExecution {
	return {
		jobName: "cron:export",
		completedAt: null,
		durationMs: null,
		...overrides,
	};
}

function repeatable(
	overrides: Partial<ReliabilityRepeatableJob> & Pick<ReliabilityRepeatableJob, "name" | "pattern">,
): ReliabilityRepeatableJob {
	return {
		next: null,
		...overrides,
	};
}

describe("worker queue reliability helpers", () => {
	it("calculates success rate from terminal executions only", () => {
		expect(calculateSuccessRate(3, 1)).toBe(75);
		expect(calculateSuccessRate(0, 0)).toBeNull();
	});

	it("infers stale thresholds for common cron patterns", () => {
		expect(inferStaleAfterMs("* * * * *")).toBe(10 * 60 * 1000);
		expect(inferStaleAfterMs("*/5 * * * *")).toBe(30 * 60 * 1000);
		expect(inferStaleAfterMs("0 * * * *")).toBe(3 * 60 * 60 * 1000);
		expect(inferStaleAfterMs("0 0 * * *")).toBe(36 * 60 * 60 * 1000);
		expect(inferStaleAfterMs("15 8 1 * *")).toBeNull();
	});

	it("prioritizes stale over failing and warning states", () => {
		expect(
			classifyJobHealth({
				successRate: 25,
				failedRuns: 3,
				terminalRuns: 4,
				isStale: true,
				hasExecutions: true,
				hasKnownSchedule: true,
			}),
		).toBe("stale");

		expect(
			classifyJobHealth({
				successRate: 79,
				failedRuns: 1,
				terminalRuns: 5,
				isStale: false,
				hasExecutions: true,
				hasKnownSchedule: true,
			}),
		).toBe("failing");

		expect(
			classifyJobHealth({
				successRate: 90,
				failedRuns: 1,
				terminalRuns: 10,
				isStale: false,
				hasExecutions: true,
				hasKnownSchedule: true,
			}),
		).toBe("warning");

		expect(
			classifyJobHealth({
				successRate: 100,
				failedRuns: 0,
				terminalRuns: 10,
				isStale: false,
				hasExecutions: true,
				hasKnownSchedule: true,
			}),
		).toBe("healthy");
	});

	it("builds daily outcome and duration buckets", () => {
		const reliability = buildReliabilityData({
			now,
			windowDays: 30,
			executions: [
				execution({
					id: "run-1",
					status: "completed",
					startedAt: "2026-05-09T08:00:00.000Z",
					completedAt: "2026-05-09T08:00:03.000Z",
					durationMs: 3000,
				}),
				execution({
					id: "run-2",
					status: "failed",
					startedAt: "2026-05-09T09:00:00.000Z",
					completedAt: "2026-05-09T09:00:01.000Z",
					durationMs: 1000,
				}),
				execution({
					id: "run-3",
					status: "running",
					startedAt: "2026-05-09T10:00:00.000Z",
				}),
			],
			repeatableJobs: [repeatable({ name: "cron:export", pattern: "*/5 * * * *" })],
		});

		const may9 = reliability.outcomeSeries.find((point) => point.date === "2026-05-09");
		expect(may9).toMatchObject({ completed: 1, failed: 1, running: 1, successRate: 50 });

		const duration = reliability.durationSeries.find((point) => point.date === "2026-05-09");
		expect(duration).toMatchObject({ averageDurationMs: 2000, runCount: 2 });

		expect(reliability.summary.totalRuns).toBe(3);
		expect(reliability.summary.failedRuns).toBe(1);
		expect(reliability.summary.successRate).toBe(50);
	});

	it("marks stale jobs from repeatable schedule and latest execution", () => {
		const reliability = buildReliabilityData({
			now,
			windowDays: 30,
			executions: [
				execution({
					id: "run-1",
					status: "completed",
					startedAt: "2026-05-10T11:00:00.000Z",
					completedAt: "2026-05-10T11:00:01.000Z",
					durationMs: 1000,
				}),
			],
			repeatableJobs: [repeatable({ name: "cron:export", pattern: "*/5 * * * *" })],
		});

		expect(reliability.summary.staleJobs).toBe(1);
		expect(reliability.jobs[0]).toMatchObject({ jobName: "cron:export", health: "stale" });
	});

	it("returns empty reliability data without throwing", () => {
		const reliability = buildReliabilityData({
			now,
			windowDays: 30,
			executions: [],
			repeatableJobs: [],
		});

		expect(reliability.summary).toMatchObject({
			totalRuns: 0,
			failedRuns: 0,
			staleJobs: 0,
			successRate: null,
			averageDurationMs: null,
		});
		expect(reliability.outcomeSeries).toEqual([]);
		expect(reliability.durationSeries).toEqual([]);
		expect(reliability.jobs).toEqual([]);
	});
});
```

- [ ] **Step 2: Create an empty implementation file so imports resolve incorrectly by missing exports**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.ts`:

```ts
export {};
```

- [ ] **Step 3: Run the failing helper tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts'
```

Expected: FAIL with missing exports such as `buildReliabilityData`, `calculateSuccessRate`, `classifyJobHealth`, and `inferStaleAfterMs`.

## Task 2: Implement Reliability Helper Functions

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.ts`
- Test: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts`

- [ ] **Step 1: Replace the empty helper file with typed reliability logic**

Replace `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.ts` with:

```ts
export type ReliabilityExecutionStatus = "pending" | "running" | "completed" | "failed";

export interface ReliabilityExecution {
	id: string;
	jobName: string;
	status: ReliabilityExecutionStatus;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
}

export interface ReliabilityRepeatableJob {
	name: string;
	pattern: string;
	next: string | null;
}

export type ReliabilityHealth = "healthy" | "warning" | "failing" | "stale" | "unknown";

export interface ReliabilitySummary {
	windowDays: number;
	totalRuns: number;
	terminalRuns: number;
	completedRuns: number;
	failedRuns: number;
	runningRuns: number;
	pendingRuns: number;
	successRate: number | null;
	averageDurationMs: number | null;
	staleJobs: number;
}

export interface ReliabilityOutcomePoint {
	date: string;
	completed: number;
	failed: number;
	running: number;
	pending: number;
	successRate: number | null;
}

export interface ReliabilityDurationPoint {
	date: string;
	averageDurationMs: number;
	runCount: number;
}

export interface ReliabilityJobRow {
	jobName: string;
	pattern: string | null;
	nextRunAt: string | null;
	lastRunAt: string | null;
	lastCompletedAt: string | null;
	totalRuns: number;
	terminalRuns: number;
	completedRuns: number;
	failedRuns: number;
	successRate: number | null;
	averageDurationMs: number | null;
	health: ReliabilityHealth;
}

export interface WorkerReliabilityData {
	summary: ReliabilitySummary;
	outcomeSeries: ReliabilityOutcomePoint[];
	durationSeries: ReliabilityDurationPoint[];
	jobs: ReliabilityJobRow[];
}

interface BuildReliabilityDataInput {
	now: Date;
	windowDays: number;
	executions: ReliabilityExecution[];
	repeatableJobs: ReliabilityRepeatableJob[];
}

interface ClassifyJobHealthInput {
	successRate: number | null;
	failedRuns: number;
	terminalRuns: number;
	isStale: boolean;
	hasExecutions: boolean;
	hasKnownSchedule: boolean;
}

interface MutableOutcomeBucket {
	date: string;
	completed: number;
	failed: number;
	running: number;
	pending: number;
}

interface MutableDurationBucket {
	date: string;
	totalDurationMs: number;
	runCount: number;
}

function toDateKey(value: string): string {
	return value.slice(0, 10);
}

function roundPercent(value: number): number {
	return Math.round(value * 100) / 100;
}

function average(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}

	return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sortIsoDesc(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return b.localeCompare(a);
}

export function calculateSuccessRate(completedRuns: number, failedRuns: number): number | null {
	const terminalRuns = completedRuns + failedRuns;

	if (terminalRuns === 0) {
		return null;
	}

	return roundPercent((completedRuns / terminalRuns) * 100);
}

export function inferStaleAfterMs(pattern: string): number | null {
	const normalized = pattern.trim().replace(/\s+/g, " ");

	if (normalized === "* * * * *") {
		return 10 * 60 * 1000;
	}

	if (normalized === "*/5 * * * *") {
		return 30 * 60 * 1000;
	}

	if (/^\d+ \* \* \* \*$/.test(normalized)) {
		return 3 * 60 * 60 * 1000;
	}

	if (/^\d+ \d+ \* \* \*$/.test(normalized)) {
		return 36 * 60 * 60 * 1000;
	}

	return null;
}

export function classifyJobHealth(input: ClassifyJobHealthInput): ReliabilityHealth {
	if (input.isStale) {
		return "stale";
	}

	if (!input.hasExecutions || !input.hasKnownSchedule || input.successRate === null) {
		return "unknown";
	}

	if (input.successRate < 80 || input.failedRuns > input.terminalRuns / 2) {
		return "failing";
	}

	if (input.successRate < 95) {
		return "warning";
	}

	return "healthy";
}

function buildOutcomeSeries(executions: ReliabilityExecution[]): ReliabilityOutcomePoint[] {
	const buckets = new Map<string, MutableOutcomeBucket>();

	for (const execution of executions) {
		const date = toDateKey(execution.startedAt);
		const bucket = buckets.get(date) ?? {
			date,
			completed: 0,
			failed: 0,
			running: 0,
			pending: 0,
		};

		bucket[execution.status] += 1;
		buckets.set(date, bucket);
	}

	return Array.from(buckets.values())
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((bucket) => ({
			...bucket,
			successRate: calculateSuccessRate(bucket.completed, bucket.failed),
		}));
}

function buildDurationSeries(executions: ReliabilityExecution[]): ReliabilityDurationPoint[] {
	const buckets = new Map<string, MutableDurationBucket>();

	for (const execution of executions) {
		if (execution.durationMs === null) {
			continue;
		}

		const date = toDateKey(execution.startedAt);
		const bucket = buckets.get(date) ?? {
			date,
			totalDurationMs: 0,
			runCount: 0,
		};

		bucket.totalDurationMs += execution.durationMs;
		bucket.runCount += 1;
		buckets.set(date, bucket);
	}

	return Array.from(buckets.values())
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((bucket) => ({
			date: bucket.date,
			averageDurationMs: Math.round(bucket.totalDurationMs / bucket.runCount),
			runCount: bucket.runCount,
		}));
}

function buildJobRows(input: BuildReliabilityDataInput): ReliabilityJobRow[] {
	const executionsByJob = new Map<string, ReliabilityExecution[]>();
	const repeatableByName = new Map(input.repeatableJobs.map((job) => [job.name, job]));
	const jobNames = new Set<string>(input.repeatableJobs.map((job) => job.name));

	for (const execution of input.executions) {
		jobNames.add(execution.jobName);
		const jobExecutions = executionsByJob.get(execution.jobName) ?? [];
		jobExecutions.push(execution);
		executionsByJob.set(execution.jobName, jobExecutions);
	}

	return Array.from(jobNames)
		.sort()
		.map((jobName) => {
			const jobExecutions = executionsByJob.get(jobName) ?? [];
			const repeatableJob = repeatableByName.get(jobName);
			const completedRuns = jobExecutions.filter((execution) => execution.status === "completed").length;
			const failedRuns = jobExecutions.filter((execution) => execution.status === "failed").length;
			const terminalRuns = completedRuns + failedRuns;
			const successRate = calculateSuccessRate(completedRuns, failedRuns);
			const durations = jobExecutions
				.map((execution) => execution.durationMs)
				.filter((duration): duration is number => duration !== null);
			const sortedExecutions = [...jobExecutions].sort((a, b) =>
				sortIsoDesc(a.startedAt, b.startedAt),
			);
			const latestExecution = sortedExecutions[0];
			const latestTerminalExecution = sortedExecutions.find(
				(execution) => execution.status === "completed" || execution.status === "failed",
			);
			const staleAfterMs = repeatableJob?.pattern ? inferStaleAfterMs(repeatableJob.pattern) : null;
			const isStale = Boolean(
				latestExecution?.startedAt &&
					staleAfterMs !== null &&
					input.now.getTime() - new Date(latestExecution.startedAt).getTime() > staleAfterMs,
			);

			return {
				jobName,
				pattern: repeatableJob?.pattern ?? null,
				nextRunAt: repeatableJob?.next ?? null,
				lastRunAt: latestExecution?.startedAt ?? null,
				lastCompletedAt: latestTerminalExecution?.completedAt ?? null,
				totalRuns: jobExecutions.length,
				terminalRuns,
				completedRuns,
				failedRuns,
				successRate,
				averageDurationMs: average(durations),
				health: classifyJobHealth({
					successRate,
					failedRuns,
					terminalRuns,
					isStale,
					hasExecutions: jobExecutions.length > 0,
					hasKnownSchedule: staleAfterMs !== null,
				}),
			};
		});
}

export function buildReliabilityData(input: BuildReliabilityDataInput): WorkerReliabilityData {
	const completedRuns = input.executions.filter((execution) => execution.status === "completed").length;
	const failedRuns = input.executions.filter((execution) => execution.status === "failed").length;
	const runningRuns = input.executions.filter((execution) => execution.status === "running").length;
	const pendingRuns = input.executions.filter((execution) => execution.status === "pending").length;
	const durationValues = input.executions
		.map((execution) => execution.durationMs)
		.filter((duration): duration is number => duration !== null);
	const jobs = buildJobRows(input);

	return {
		summary: {
			windowDays: input.windowDays,
			totalRuns: input.executions.length,
			terminalRuns: completedRuns + failedRuns,
			completedRuns,
			failedRuns,
			runningRuns,
			pendingRuns,
			successRate: calculateSuccessRate(completedRuns, failedRuns),
			averageDurationMs: average(durationValues),
			staleJobs: jobs.filter((job) => job.health === "stale").length,
		},
		outcomeSeries: buildOutcomeSeries(input.executions),
		durationSeries: buildDurationSeries(input.executions),
		jobs,
	};
}
```

- [ ] **Step 2: Run the helper tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Commit helper tests and implementation**

Run only if the user has explicitly permitted commits in the execution session:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.ts' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts'
git commit -m "feat: add worker reliability helpers"
```

Expected: commit succeeds.

## Task 3: Add Bounded Cron Execution History Query

**Files:**
- Modify: `apps/webapp/src/lib/cron/tracking.ts`

- [ ] **Step 1: Add the execution-history query helper**

In `apps/webapp/src/lib/cron/tracking.ts`, add this function after `getRecentExecutions`:

```ts
/**
 * Get executions since a cutoff date across all job types.
 */
export async function getExecutionsSince(cutoffDate: Date): Promise<CronJobExecution[]> {
	return db.query.cronJobExecution.findMany({
		where: gte(cronJobExecution.startedAt, cutoffDate),
		orderBy: [desc(cronJobExecution.startedAt)],
	});
}
```

- [ ] **Step 2: Run the TypeScript-adjacent helper test suite**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts'
```

Expected: PASS. This verifies the new export did not break module compilation for the touched worker queue tests.

- [ ] **Step 3: Commit tracking query helper**

Run only if the user has explicitly permitted commits in the execution session:

```bash
git add apps/webapp/src/lib/cron/tracking.ts
git commit -m "feat: expose cron execution history query"
```

Expected: commit succeeds.

## Task 4: Extend Worker Queue Server Action With Reliability Data

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.ts`

- [ ] **Step 1: Update imports in the server action**

In `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`, replace the cron tracking import with:

```ts
import { getAllJobMetrics, getExecutionsSince, getRecentExecutions } from "@/lib/cron/tracking";
```

Then add this route-local import below the queue import:

```ts
import { buildReliabilityData, type WorkerReliabilityData } from "./reliability";
```

- [ ] **Step 2: Add reliability to the stats interface**

In `WorkerQueueStats`, add this field after `jobMetrics`:

```ts
	reliability: WorkerReliabilityData;
```

- [ ] **Step 3: Add a shared window constant**

Add this near `HIDDEN_WORKER_NAMES`:

```ts
const RELIABILITY_WINDOW_DAYS = 30;
```

- [ ] **Step 4: Load bounded executions and build reliability data**

Inside `getWorkerQueueStats()`, after `jobMetrics` is built and before the final `return`, add:

```ts
		const reliabilityCutoff = new Date();
		reliabilityCutoff.setDate(reliabilityCutoff.getDate() - RELIABILITY_WINDOW_DAYS);

		const reliabilityExecutions = yield* Effect.tryPromise({
			try: () => getExecutionsSince(reliabilityCutoff),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch reliability execution history",
					operation: "query",
					table: "cron_job_execution",
				}),
		});

		const reliability = buildReliabilityData({
			now: new Date(),
			windowDays: RELIABILITY_WINDOW_DAYS,
			executions: reliabilityExecutions
				.filter((exec) => !HIDDEN_WORKER_NAMES.has(exec.jobName))
				.map((exec) => ({
					id: exec.id,
					jobName: exec.jobName,
					status: exec.status,
					startedAt: exec.startedAt.toISOString(),
					completedAt: exec.completedAt?.toISOString() ?? null,
					durationMs: exec.durationMs,
				})),
			repeatableJobs,
		});
```

Then include `reliability` in the returned object:

```ts
		return {
			isConnected,
			counts,
			repeatableJobs,
			recentExecutions,
			jobMetrics,
			reliability,
			fetchedAt: new Date().toISOString(),
		};
```

- [ ] **Step 5: Run helper tests after server action type changes**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit server action data changes**

Run only if the user has explicitly permitted commits in the execution session:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts'
git commit -m "feat: add worker reliability data"
```

Expected: commit succeeds.

## Task 5: Create Reliability Charts Client Component

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability-charts.tsx`

- [ ] **Step 1: Create the charts component**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability-charts.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import type { WorkerReliabilityData } from "./reliability";

const Area = dynamic(() => import("recharts").then((mod) => mod.Area), { ssr: false });
const AreaChart = dynamic(() => import("recharts").then((mod) => mod.AreaChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), {
	ssr: false,
});
const ComposedChart = dynamic(() => import("recharts").then((mod) => mod.ComposedChart), {
	ssr: false,
});
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });

interface WorkerReliabilityChartsProps {
	reliability: WorkerReliabilityData;
}

const outcomeChartConfig = {
	completed: {
		label: "Completed",
		color: "hsl(var(--chart-1))",
	},
	failed: {
		label: "Failed",
		color: "hsl(var(--chart-5))",
	},
	successRate: {
		label: "Success rate",
		color: "hsl(var(--chart-2))",
	},
} satisfies ChartConfig;

const durationChartConfig = {
	averageDurationMs: {
		label: "Average duration",
		color: "hsl(var(--chart-3))",
	},
} satisfies ChartConfig;

function formatDateLabel(value: string): string {
	return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

function formatDuration(value: number): string {
	if (value >= 1000) {
		return `${(value / 1000).toFixed(1)}s`;
	}

	return `${value}ms`;
}

export function WorkerReliabilityCharts({ reliability }: WorkerReliabilityChartsProps) {
	const outcomeData = reliability.outcomeSeries.map((point) => ({
		...point,
		dateLabel: formatDateLabel(point.date),
		successRate: point.successRate ?? 0,
	}));
	const durationData = reliability.durationSeries.map((point) => ({
		...point,
		dateLabel: formatDateLabel(point.date),
	}));

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Run Outcomes</CardTitle>
					<CardDescription>
						Completed and failed cron executions over the last {reliability.summary.windowDays} days.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{outcomeData.length === 0 ? (
						<p className="py-12 text-center text-sm text-muted-foreground">
							No cron execution history is available for this period.
						</p>
					) : (
						<ChartContainer config={outcomeChartConfig} className="h-[280px] w-full">
							<ComposedChart accessibilityLayer data={outcomeData} margin={{ left: 12, right: 12 }}>
								<CartesianGrid vertical={false} />
								<XAxis dataKey="dateLabel" tickLine={false} axisLine={false} tickMargin={8} />
								<YAxis yAxisId="runs" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
								<YAxis
									yAxisId="rate"
									orientation="right"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									domain={[0, 100]}
									tickFormatter={(value) => `${value}%`}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											formatter={(value, name) => [
												name === "successRate" ? `${Number(value).toFixed(1)}%` : Number(value).toLocaleString(),
												name === "successRate" ? "Success rate" : String(name),
											]}
										/>
									}
								/>
								<Bar yAxisId="runs" dataKey="completed" stackId="runs" fill="var(--color-completed)" radius={4} />
								<Bar yAxisId="runs" dataKey="failed" stackId="runs" fill="var(--color-failed)" radius={4} />
								<Line
									yAxisId="rate"
									dataKey="successRate"
									type="monotone"
									stroke="var(--color-successRate)"
									strokeWidth={2}
									dot={false}
								/>
							</ComposedChart>
						</ChartContainer>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Duration Trend</CardTitle>
					<CardDescription>
						Average runtime for executions that reported duration data.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{durationData.length === 0 ? (
						<p className="py-12 text-center text-sm text-muted-foreground">
							No duration data is available for this period.
						</p>
					) : (
						<ChartContainer config={durationChartConfig} className="h-[280px] w-full">
							<AreaChart accessibilityLayer data={durationData} margin={{ left: 12, right: 12 }}>
								<CartesianGrid vertical={false} />
								<XAxis dataKey="dateLabel" tickLine={false} axisLine={false} tickMargin={8} />
								<YAxis
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									tickFormatter={(value) => formatDuration(Number(value))}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											formatter={(value) => [formatDuration(Number(value)), "Average duration"]}
										/>
									}
								/>
								<Area
									dataKey="averageDurationMs"
									type="monotone"
									fill="var(--color-averageDurationMs)"
									fillOpacity={0.25}
									stroke="var(--color-averageDurationMs)"
									strokeWidth={2}
								/>
							</AreaChart>
						</ChartContainer>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 2: Run helper tests to keep touched route compiling**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Commit chart component**

Run only if the user has explicitly permitted commits in the execution session:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/reliability-charts.tsx'
git commit -m "feat: add worker reliability charts component"
```

Expected: commit succeeds.

## Task 6: Render Reliability Section On Worker Queue Page

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx`

- [ ] **Step 1: Update page imports**

Add the alert icon import near existing Tabler imports:

```ts
	IconActivity,
```

Add the chart component import below the action import:

```ts
import { WorkerReliabilityCharts } from "./reliability-charts";
```

- [ ] **Step 2: Add reliability formatting helpers to the page**

Add these helpers below `StatusBadge`:

```tsx
function formatPercent(value: number | null): string {
	return value === null ? "Unknown" : `${value.toFixed(1)}%`;
}

function formatDuration(value: number | null): string {
	if (value === null) {
		return "Unknown";
	}

	if (value >= 1000) {
		return `${(value / 1000).toFixed(1)}s`;
	}

	return `${value}ms`;
}

function formatDateTime(value: string | null): string {
	return value ? new Date(value).toLocaleString() : "-";
}

function HealthBadge({ health }: { health: string }) {
	switch (health) {
		case "healthy":
			return <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">Healthy</Badge>;
		case "warning":
			return <Badge variant="outline" className="border-yellow-500 text-yellow-700 dark:text-yellow-400">Warning</Badge>;
		case "failing":
			return <Badge variant="outline" className="border-red-500 text-red-700 dark:text-red-400">Failing</Badge>;
		case "stale":
			return <Badge variant="outline" className="border-orange-500 text-orange-700 dark:text-orange-400">Stale</Badge>;
		default:
			return <Badge variant="outline">Unknown</Badge>;
	}
}
```

- [ ] **Step 3: Add the Reliability section after Queue Status**

In `WorkerQueueContent`, insert this section after the closing `</section>` for Queue Status and before Scheduled Cron Jobs:

```tsx
			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconActivity className="size-5" />
					{t("settings.workerQueue.sections.reliability", "Reliability")}
				</h2>
				<div className="space-y-4">
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						<StatCard
							title={t("settings.workerQueue.reliability.successRate", "Success Rate")}
							value={formatPercent(stats.reliability.summary.successRate)}
							description={t(
								"settings.workerQueue.reliability.successRateDescription",
								"Terminal cron executions",
							)}
							icon={<IconCheck className="size-4" />}
							variant={
								stats.reliability.summary.successRate === null
									? "default"
									: stats.reliability.summary.successRate >= 95
										? "success"
										: stats.reliability.summary.successRate >= 80
											? "warning"
											: "destructive"
							}
						/>
						<StatCard
							title={t("settings.workerQueue.reliability.failedRuns", "Failed Runs")}
							value={stats.reliability.summary.failedRuns}
							description={t(
								"settings.workerQueue.reliability.failedRunsDescription",
								"Last 30 days",
							)}
							icon={<IconX className="size-4" />}
							variant={stats.reliability.summary.failedRuns > 0 ? "destructive" : "success"}
						/>
						<StatCard
							title={t("settings.workerQueue.reliability.staleJobs", "Stale Jobs")}
							value={stats.reliability.summary.staleJobs}
							description={t(
								"settings.workerQueue.reliability.staleJobsDescription",
								"Past expected schedule",
							)}
							icon={<IconAlertCircle className="size-4" />}
							variant={stats.reliability.summary.staleJobs > 0 ? "warning" : "success"}
						/>
						<StatCard
							title={t("settings.workerQueue.reliability.avgDuration", "Avg Duration")}
							value={formatDuration(stats.reliability.summary.averageDurationMs)}
							description={t(
								"settings.workerQueue.reliability.avgDurationDescription",
								"Executions with duration data",
							)}
							icon={<IconClock className="size-4" />}
						/>
					</div>

					<WorkerReliabilityCharts reliability={stats.reliability} />

					<Card>
						<CardHeader>
							<CardTitle>{t("settings.workerQueue.reliability.jobHealth", "Job Health")}</CardTitle>
							<CardDescription>
								{t(
									"settings.workerQueue.reliability.jobHealthDescription",
									"Per-job reliability based on recent executions and repeatable schedules.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent>
							{stats.reliability.jobs.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									{t("settings.workerQueue.reliability.noJobs", "No reliability data found")}
								</p>
							) : (
								<div className="overflow-x-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>{t("settings.workerQueue.table.jobName", "Job Name")}</TableHead>
												<TableHead>{t("settings.workerQueue.table.status", "Status")}</TableHead>
												<TableHead>{t("settings.workerQueue.table.lastRun", "Last Run")}</TableHead>
												<TableHead>{t("settings.workerQueue.table.nextRun", "Next Run")}</TableHead>
												<TableHead className="text-right">{t("settings.workerQueue.table.successRate", "Success Rate")}</TableHead>
												<TableHead className="text-right">{t("settings.workerQueue.table.failed", "Failed")}</TableHead>
												<TableHead className="text-right">{t("settings.workerQueue.table.avgDuration", "Avg Duration")}</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{stats.reliability.jobs.map((job) => (
												<TableRow key={job.jobName}>
													<TableCell className="font-mono text-sm">{job.jobName}</TableCell>
													<TableCell><HealthBadge health={job.health} /></TableCell>
													<TableCell>{formatDateTime(job.lastRunAt)}</TableCell>
													<TableCell>{formatDateTime(job.nextRunAt)}</TableCell>
													<TableCell className="text-right">{formatPercent(job.successRate)}</TableCell>
													<TableCell className="text-right text-red-600">{job.failedRuns}</TableCell>
													<TableCell className="text-right">{formatDuration(job.averageDurationMs)}</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</section>
```

- [ ] **Step 4: Add reliability skeleton to loading state**

In `WorkerQueueLoading`, add another skeleton section after the Queue Status skeleton:

```tsx
			<section>
				<Skeleton className="h-6 w-32 mb-4" />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					{[...Array(4)].map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: Static loading skeleton
						<Card key={i}>
							<CardHeader className="pb-2">
								<Skeleton className="h-4 w-24" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-8 w-16" />
								<Skeleton className="h-3 w-32 mt-2" />
							</CardContent>
						</Card>
					))}
				</div>
			</section>
```

- [ ] **Step 5: Run helper tests after page wiring**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit page rendering changes**

Run only if the user has explicitly permitted commits in the execution session:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx'
git commit -m "feat: show worker reliability section"
```

Expected: commit succeeds.

## Task 7: Update Platform Admin Documentation

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`

- [ ] **Step 1: Update the platform-admin guide**

In `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`, replace line 27 text:

```mdx
Open `/platform-admin` to reach the platform-scoped admin area. The current route set includes an overview dashboard plus dedicated pages for users, organizations, worker queue operations, settings, and optional billing views.
```

with:

```mdx
Open `/platform-admin` to reach the platform-scoped admin area. The current route set includes an overview dashboard plus dedicated pages for users, organizations, worker queue operations, settings, and optional billing views. The worker queue view includes queue counts, scheduled cron jobs, recent executions, and reliability trends for failures, stale jobs, and runtime duration.
```

- [ ] **Step 2: Commit documentation update**

Run only if the user has explicitly permitted commits in the execution session:

```bash
git add apps/docs/content/docs/guide/admin-guide/platform-admin.mdx
git commit -m "docs: describe worker reliability trends"
```

Expected: commit succeeds.

## Task 8: Run Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused worker queue tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run platform admin route tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Run the full webapp test suite when time permits**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS. If unrelated existing tests fail, record the failing test names and errors before reporting completion.

- [ ] **Step 4: Run the production build only if required environment variables are available**

Run only when the execution environment has the required system-level variables through the normal developer setup:

```bash
CI=true pnpm --filter webapp build
```

Expected: PASS. If Phase-managed secrets are unavailable to the agent, skip this command and report that it was skipped because agents do not have Phase CLI variables.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intended worker queue, cron tracking, docs, and plan/spec files are modified or untracked. Do not revert unrelated files.

## Self-Review Notes

- Spec coverage: The plan covers reliability charts, all requested reliability signals, existing data sources, no schema migration, platform-admin-only access, hidden telemetry, UI placement, empty states, documentation, and tests.
- Placeholder scan: The plan contains no unresolved placeholders or unspecified implementation steps. Conditional commit and build steps are explicit because repository rules require explicit commit permission and environment variables may be unavailable to agents.
- Type consistency: The server action imports `WorkerReliabilityData` from the helper file; the chart component and page use the same `stats.reliability` shape returned by `buildReliabilityData()`.
