/**
 * Cron Job Tracking Service
 *
 * Provides persistent tracking of cron job executions in the database.
 * This is independent of BullMQ's internal job storage, allowing for:
 * - Permanent execution history (beyond BullMQ retention)
 * - Job metrics and analytics
 * - Debugging and auditing
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { type CronJobExecution, type CronJobStatus, cronJobExecution } from "@/db/schema/cron-job";
import { createLogger } from "@/lib/logger";
import type { CronJobName } from "./registry";

const logger = createLogger("cron-tracking");

// ============================================
// CORE TRACKING FUNCTIONS
// ============================================

/**
 * Create a new job execution record
 *
 * Called before enqueueing a job to BullMQ. Returns the execution ID
 * which is included in the job data for correlation.
 */
export async function createJobExecution(params: {
	jobName: CronJobName;
	bullmqJobId?: string;
	metadata?: {
		source?: "scheduler" | "api" | "manual";
		triggeredBy?: string;
		manualParams?: Record<string, unknown>;
		waitForResult?: boolean;
	};
}): Promise<string> {
	const [record] = await db
		.insert(cronJobExecution)
		.values({
			jobName: params.jobName,
			bullmqJobId: params.bullmqJobId,
			status: "pending",
			startedAt: new Date(),
			metadata: params.metadata,
		})
		.returning({ id: cronJobExecution.id });

	logger.debug({ executionId: record.id, jobName: params.jobName }, "Created job execution record");

	return record.id;
}

/**
 * Update job execution status and optionally the BullMQ job ID
 */
export async function updateJobExecution(
	id: string,
	update: {
		status?: CronJobStatus;
		bullmqJobId?: string;
		result?: unknown;
		error?: string;
		completedAt?: Date;
		durationMs?: number;
	},
): Promise<void> {
	await db
		.update(cronJobExecution)
		.set({
			...update,
			// Only set completedAt if status is terminal
			...(update.status && ["completed", "failed"].includes(update.status)
				? { completedAt: update.completedAt ?? new Date() }
				: {}),
		})
		.where(eq(cronJobExecution.id, id));

	logger.debug({ executionId: id, update }, "Updated job execution record");
}

/**
 * Mark a job as running (called when worker starts processing)
 */
export async function markJobRunning(id: string): Promise<void> {
	await updateJobExecution(id, { status: "running" });
}

/**
 * Mark a job as completed with result
 */
export async function markJobCompleted(
	id: string,
	result: unknown,
	durationMs: number,
): Promise<void> {
	await updateJobExecution(id, {
		status: "completed",
		result,
		completedAt: new Date(),
		durationMs,
	});
}

/**
 * Mark a job as failed with error
 */
export async function markJobFailed(id: string, error: string, durationMs: number): Promise<void> {
	await updateJobExecution(id, {
		status: "failed",
		error,
		completedAt: new Date(),
		durationMs,
	});
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get a job execution by ID
 */
export async function getJobExecution(id: string): Promise<CronJobExecution | undefined> {
	const result = await db.query.cronJobExecution.findFirst({
		where: eq(cronJobExecution.id, id),
	});
	return result ?? undefined;
}

/**
 * Get recent execution history for a specific job type
 */
export async function getJobExecutionHistory(
	jobName: CronJobName,
	limit = 50,
): Promise<CronJobExecution[]> {
	return db.query.cronJobExecution.findMany({
		where: eq(cronJobExecution.jobName, jobName),
		orderBy: [desc(cronJobExecution.startedAt)],
		limit,
	});
}

/**
 * Get the most recent execution for a job type
 */
export async function getLatestExecution(
	jobName: CronJobName,
): Promise<CronJobExecution | undefined> {
	const result = await db.query.cronJobExecution.findFirst({
		where: eq(cronJobExecution.jobName, jobName),
		orderBy: [desc(cronJobExecution.startedAt)],
	});
	return result ?? undefined;
}

/**
 * Get all recent executions across all job types
 */
export async function getRecentExecutions(limit = 100): Promise<CronJobExecution[]> {
	return db.query.cronJobExecution.findMany({
		orderBy: [desc(cronJobExecution.startedAt)],
		limit,
	});
}

// ============================================
// METRICS FUNCTIONS
// ============================================

/**
 * Get job metrics for a specific job type
 */
export async function getJobMetrics(
	jobName: CronJobName,
	daysBack = 30,
): Promise<{
	totalRuns: number;
	successfulRuns: number;
	failedRuns: number;
	successRate: number;
	avgDurationMs: number | null;
	lastRun: Date | null;
	lastSuccess: Date | null;
	lastFailure: Date | null;
}> {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - daysBack);

	const executions = await db.query.cronJobExecution.findMany({
		where: and(eq(cronJobExecution.jobName, jobName), gte(cronJobExecution.startedAt, cutoffDate)),
		columns: {
			status: true,
			durationMs: true,
			startedAt: true,
			completedAt: true,
		},
		orderBy: [desc(cronJobExecution.startedAt)],
	});

	const totalRuns = executions.length;
	const successfulRuns = executions.filter((e) => e.status === "completed").length;
	const failedRuns = executions.filter((e) => e.status === "failed").length;
	const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;

	const durations = executions.filter((e) => e.durationMs !== null).map((e) => e.durationMs!);
	const avgDurationMs =
		durations.length > 0
			? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
			: null;

	const lastRun = executions.length > 0 ? executions[0].startedAt : null;

	const lastSuccessExec = executions.find((e) => e.status === "completed");
	const lastSuccess = lastSuccessExec?.completedAt ?? null;

	const lastFailureExec = executions.find((e) => e.status === "failed");
	const lastFailure = lastFailureExec?.completedAt ?? null;

	return {
		totalRuns,
		successfulRuns,
		failedRuns,
		successRate: Math.round(successRate * 100) / 100,
		avgDurationMs,
		lastRun,
		lastSuccess,
		lastFailure,
	};
}

/**
 * Get aggregated metrics for all job types
 */
export async function getAllJobMetrics(daysBack = 30): Promise<
	Array<{
		jobName: string;
		totalRuns: number;
		successfulRuns: number;
		failedRuns: number;
		successRate: number;
		avgDurationMs: number | null;
	}>
> {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - daysBack);

	// Use raw SQL for aggregation
	const result = await db
		.select({
			jobName: cronJobExecution.jobName,
			totalRuns: sql<number>`count(*)::int`,
			successfulRuns: sql<number>`count(*) filter (where ${cronJobExecution.status} = 'completed')::int`,
			failedRuns: sql<number>`count(*) filter (where ${cronJobExecution.status} = 'failed')::int`,
			avgDurationMs: sql<number | null>`avg(${cronJobExecution.durationMs})::int`,
		})
		.from(cronJobExecution)
		.where(gte(cronJobExecution.startedAt, cutoffDate))
		.groupBy(cronJobExecution.jobName);

	return result.map((row) => ({
		...row,
		successRate:
			row.totalRuns > 0 ? Math.round((row.successfulRuns / row.totalRuns) * 10000) / 100 : 0,
	}));
}

// ============================================
// CLEANUP FUNCTIONS
// ============================================

/**
 * Delete old execution records (for maintenance)
 *
 * @param daysToKeep - Number of days of history to retain
 * @returns Number of records deleted
 */
export async function cleanupOldExecutions(daysToKeep = 90): Promise<number> {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

	const result = await db
		.delete(cronJobExecution)
		.where(sql`${cronJobExecution.startedAt} < ${cutoffDate}`)
		.returning({ id: cronJobExecution.id });

	if (result.length > 0) {
		logger.info(
			{ deletedCount: result.length, cutoffDate },
			"Cleaned up old job execution records",
		);
	}

	return result.length;
}
