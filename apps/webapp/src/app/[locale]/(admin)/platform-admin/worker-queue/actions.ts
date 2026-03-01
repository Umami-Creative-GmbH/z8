"use server";

import { Effect } from "effect";
import { getAllJobMetrics, getRecentExecutions } from "@/lib/cron/tracking";
import { DatabaseError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";
import { getJobQueue, isQueueHealthy } from "@/lib/queue";

export interface QueueCounts {
	waiting: number;
	active: number;
	completed: number;
	failed: number;
	delayed: number;
	paused: number;
}

export interface RepeatableJob {
	name: string;
	pattern: string;
	next: string | null;
}

export interface RecentExecution {
	id: string;
	jobName: string;
	status: string;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	error: string | null;
}

export interface JobMetric {
	jobName: string;
	totalRuns: number;
	successfulRuns: number;
	failedRuns: number;
	successRate: number;
	avgDurationMs: number | null;
}

export interface WorkerQueueStats {
	isConnected: boolean;
	counts: QueueCounts;
	repeatableJobs: RepeatableJob[];
	recentExecutions: RecentExecution[];
	jobMetrics: JobMetric[];
	fetchedAt: string;
}

export async function getWorkerQueueStats(): Promise<ServerActionResult<WorkerQueueStats>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		const isConnected = yield* Effect.promise(() => isQueueHealthy()).pipe(
			Effect.orElseSucceed(() => false),
		);

		let counts: QueueCounts = {
			waiting: 0,
			active: 0,
			completed: 0,
			failed: 0,
			delayed: 0,
			paused: 0,
		};

		let repeatableJobs: RepeatableJob[] = [];

		if (isConnected) {
			const queue = getJobQueue();

			const jobCounts = yield* Effect.tryPromise({
				try: () => queue.getJobCounts(),
				catch: () =>
					new DatabaseError({
						message: "Failed to fetch job counts",
						operation: "query",
					}),
			});

			counts = {
				waiting: jobCounts.waiting ?? 0,
				active: jobCounts.active ?? 0,
				completed: jobCounts.completed ?? 0,
				failed: jobCounts.failed ?? 0,
				delayed: jobCounts.delayed ?? 0,
				paused: jobCounts.paused ?? 0,
			};

			const repeatables = yield* Effect.promise(() => queue.getRepeatableJobs()).pipe(
				Effect.orElseSucceed(() => [] as Awaited<ReturnType<typeof queue.getRepeatableJobs>>),
			);

			repeatableJobs = repeatables.map((job) => ({
				name: job.name,
				pattern: job.pattern || "",
				next: job.next ? new Date(job.next).toISOString() : null,
			}));
		}

		const executions = yield* Effect.tryPromise({
			try: () => getRecentExecutions(50),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch recent executions",
					operation: "query",
					table: "cron_job_execution",
				}),
		});

		const recentExecutions: RecentExecution[] = executions.map((exec) => ({
			id: exec.id,
			jobName: exec.jobName,
			status: exec.status,
			startedAt: exec.startedAt.toISOString(),
			completedAt: exec.completedAt?.toISOString() ?? null,
			durationMs: exec.durationMs,
			error: exec.error,
		}));

		const metrics = yield* Effect.tryPromise({
			try: () => getAllJobMetrics(30),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch job metrics",
					operation: "query",
					table: "cron_job_execution",
				}),
		});

		const jobMetrics: JobMetric[] = metrics.map((m) => ({
			jobName: m.jobName,
			totalRuns: m.totalRuns,
			successfulRuns: m.successfulRuns,
			failedRuns: m.failedRuns,
			successRate: m.successRate,
			avgDurationMs: m.avgDurationMs,
		}));

		return {
			isConnected,
			counts,
			repeatableJobs,
			recentExecutions,
			jobMetrics,
			fetchedAt: new Date().toISOString(),
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
