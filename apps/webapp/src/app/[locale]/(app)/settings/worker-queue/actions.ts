"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { getAllJobMetrics, getRecentExecutions } from "@/lib/cron/tracking";
import { AuthorizationError, DatabaseError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
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
	// Connection status
	isConnected: boolean;

	// Queue counts
	counts: QueueCounts;

	// Repeatable jobs (cron schedules)
	repeatableJobs: RepeatableJob[];

	// Recent executions from database
	recentExecutions: RecentExecution[];

	// Job metrics (last 30 days)
	jobMetrics: JobMetric[];

	// Timestamps
	fetchedAt: string;
}

/**
 * Get comprehensive worker queue statistics
 * Only accessible by admins
 */
export async function getWorkerQueueStats(): Promise<ServerActionResult<WorkerQueueStats>> {
	const effect = Effect.gen(function* () {
		// Get session and verify admin
		const authService = yield* AuthService;
		const authSession = yield* authService.getSession();

		// Get current employee to check role
		const currentEmployee = yield* Effect.tryPromise({
			try: () =>
				db.query.employee.findFirst({
					where: eq(employee.userId, authSession.user.id),
				}),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch employee",
					operation: "query",
					table: "employee",
				}),
		});

		if (!currentEmployee || currentEmployee.role !== "admin") {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Only admins can view worker queue status",
					resource: "worker-queue",
					action: "read",
				}),
			);
		}

		// Check queue health - catch errors silently and treat as disconnected
		const isConnected = yield* Effect.promise(() => isQueueHealthy()).pipe(
			Effect.orElseSucceed(() => false),
		);

		// Get queue counts
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

			// Get job counts
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

			// Get repeatable jobs - catch errors silently and return empty array
			const repeatables = yield* Effect.promise(() => queue.getRepeatableJobs()).pipe(
				Effect.orElseSucceed(() => [] as Awaited<ReturnType<typeof queue.getRepeatableJobs>>),
			);

			repeatableJobs = repeatables.map((job) => ({
				name: job.name,
				pattern: job.pattern || "",
				next: job.next ? new Date(job.next).toISOString() : null,
			}));
		}

		// Get recent executions from database
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

		// Get job metrics
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
