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

function isTerminalExecution(execution: ReliabilityExecution): boolean {
	return execution.status === "completed" || execution.status === "failed";
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

	const intervalMinuteMatch = normalized.match(/^\*\/(\d+) \* \* \* \*$/);
	if (intervalMinuteMatch) {
		const intervalMinutes = Number(intervalMinuteMatch[1]);

		if (intervalMinutes <= 0) {
			return null;
		}

		return Math.max(intervalMinutes * 6, 30) * 60 * 1000;
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
		if (!isTerminalExecution(execution) || execution.durationMs === null) {
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
			const completedRuns = jobExecutions.filter(
				(execution) => execution.status === "completed",
			).length;
			const failedRuns = jobExecutions.filter((execution) => execution.status === "failed").length;
			const terminalRuns = completedRuns + failedRuns;
			const successRate = calculateSuccessRate(completedRuns, failedRuns);
			const durations = jobExecutions
				.filter(isTerminalExecution)
				.map((execution) => execution.durationMs)
				.filter((duration): duration is number => duration !== null);
			const sortedExecutions = jobExecutions.toSorted((a, b) =>
				sortIsoDesc(a.startedAt, b.startedAt),
			);
			const latestExecution = sortedExecutions[0];
			const latestCompletedExecution = sortedExecutions.find(
				(execution) => execution.status === "completed",
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
				lastCompletedAt: latestCompletedExecution?.completedAt ?? null,
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
	const completedRuns = input.executions.filter(
		(execution) => execution.status === "completed",
	).length;
	const failedRuns = input.executions.filter((execution) => execution.status === "failed").length;
	const runningRuns = input.executions.filter((execution) => execution.status === "running").length;
	const pendingRuns = input.executions.filter((execution) => execution.status === "pending").length;
	const durationValues = input.executions
		.filter(isTerminalExecution)
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
