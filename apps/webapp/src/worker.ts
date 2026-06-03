/**
 * BullMQ Worker Process with Repeatable Cron Jobs
 *
 * Dedicated worker for background job processing and scheduled cron tasks.
 * Runs separately from the webapp for independent scaling.
 *
 * Features:
 * - Processes one-off jobs (exports, emails, reports, cleanup)
 * - Runs repeatable cron jobs on schedule (vacation, telemetry, etc.)
 * - Full job execution tracking in database
 * - Graceful shutdown with signal handling
 * - Health checks via Redis connection
 *
 * Environment variables:
 * - REDIS_HOST: Redis-compatible host (default: localhost)
 * - REDIS_PORT: Redis-compatible port (default: 6379)
 * - REDIS_PASSWORD: Redis-compatible password (optional)
 * - REDIS_TLS: Enable TLS for managed Redis providers (default: false)
 * - WORKER_CONCURRENCY: Number of concurrent jobs (default: 5)
 * - ENABLE_CRON_JOBS: Enable repeatable cron jobs (default: true)
 */

import "dotenv/config";
import type { Job, Queue } from "bullmq";
import { env } from "@/env";
import {
	CRON_JOBS,
	type CronJobData,
	type CronJobName,
	type CronScheduleOverrideLike,
	createJobExecution,
	isCronJobName,
	listCronScheduleOverrides,
	markJobCompleted,
	markJobFailed,
	markJobRunning,
	reconcileCronSchedules,
	resolveEffectiveCronSchedules,
} from "@/lib/cron";
import { createLogger } from "@/lib/logger";
import { createWorker, getJobQueue, type JobData, type JobResult } from "@/lib/queue";

const logger = createLogger("Worker");

// Combined job data type (one-off jobs + cron jobs)
type AllJobData = JobData | CronJobData;

/**
 * Process cron jobs using the registry's processors
 *
 * Handles both:
 * - API-triggered jobs (have executionId in job data)
 * - Repeatable jobs (need to create executionId on the fly)
 */
async function processCronJob(job: Job<CronJobData>): Promise<JobResult> {
	const { type, executionId: providedExecutionId, manualParams } = job.data;
	const startTime = Date.now();

	// Ensure executionId exists (create one for repeatable jobs)
	let executionId = providedExecutionId;
	if (!executionId) {
		// This is a repeatable job triggered by BullMQ scheduler
		executionId = await createJobExecution({
			jobName: type,
			bullmqJobId: job.id,
			metadata: {
				source: "scheduler",
			},
		});
		logger.debug(
			{ jobId: job.id, type, executionId },
			"Created execution record for repeatable job",
		);
	}

	logger.info({ jobId: job.id, type, executionId }, "Processing cron job");

	try {
		// Mark job as running
		await markJobRunning(executionId);

		// Get processor from registry and execute
		const jobDef = CRON_JOBS[type];
		const result = await jobDef.processor({
			triggeredAt: job.data.triggeredAt,
			manualParams,
		});

		const duration = Date.now() - startTime;

		// Mark job as completed with result
		await markJobCompleted(executionId, result, duration);

		logger.info(
			{ jobId: job.id, type, executionId, durationMs: duration },
			"Cron job completed successfully",
		);

		return {
			success: true,
			message: `${type} completed`,
			data: result,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const duration = Date.now() - startTime;

		// Mark job as failed with error
		await markJobFailed(executionId, errorMessage, duration);

		logger.error({ error: errorMessage, jobId: job.id, type, executionId }, "Cron job failed");

		return {
			success: false,
			error: errorMessage,
		};
	}
}

/**
 * Process one-off jobs (reports, exports, emails, cleanup)
 */
export async function processOneOffJob(job: Job<JobData>): Promise<JobResult> {
	const { type } = job.data;
	logger.info({ jobId: job.id, type, name: job.name }, "Processing job");

	try {
		switch (type) {
			case "report": {
				// Import report generator lazily to reduce worker startup time
				const { generateReport } = await import("@/lib/reports/generator");
				await generateReport(job.data);
				return { success: true, message: "Report generated" };
			}

			case "export": {
				const { processExport } = await import("@/lib/exports/processor");
				await processExport(job.data);
				return { success: true, message: "Export processed" };
			}

			case "email": {
				const { sendEmail } = await import("@/lib/email/sender");
				await sendEmail(job.data);
				return { success: true, message: "Email sent" };
			}

			case "cleanup": {
				const { runCleanup } = await import("@/lib/cleanup");
				await runCleanup(job.data);
				return { success: true, message: "Cleanup completed" };
			}

			case "webhook": {
				const { processWebhookJob } = await import("@/lib/webhooks/webhook-worker");
				// Type assertion needed: job.data is WebhookJobData (queue type)
				// processWebhookJob expects the specific webhook type, which is structurally compatible
				return processWebhookJob(job as unknown as Parameters<typeof processWebhookJob>[0]);
			}

			case "calendar-sync": {
				const { processCalendarSyncJob } = await import("@/lib/calendar-sync/jobs");
				return processCalendarSyncJob(job.data);
			}

			case "organization-deletion-notification": {
				const { sendOrganizationDeletionNotifications } = await import(
					"@/lib/jobs/organization-deletion-notification"
				);
				await sendOrganizationDeletionNotifications(job.data);
				return { success: true, message: "Organization deletion notifications sent" };
			}

			case "audit-pack": {
				const { processAuditPack } = await import(
					"@/lib/audit-pack/application/audit-pack-processor"
				);
				await processAuditPack(job.data);
				return { success: true, message: "Audit pack processed" };
			}

			case "import-review-scan": {
				const { processImportReviewJob } = await import("@/lib/import-review/worker");
				return processImportReviewJob(job as Job<typeof job.data>);
			}

			case "import-review-commit": {
				const { processImportReviewJob } = await import("@/lib/import-review/worker");
				return processImportReviewJob(job as Job<typeof job.data>);
			}

			default:
				throw new Error(`Unknown job type: ${(job.data as JobData).type}`);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error({ error: errorMessage, jobId: job.id }, "Job failed");
		return {
			success: false,
			error: errorMessage,
		};
	}
}

/**
 * Main job processor that routes to cron or one-off handlers
 */
export async function processJob(job: Job<AllJobData>): Promise<JobResult> {
	// Check if this is a cron job (either by type prefix or by checking registry)
	if (
		typeof job.data.type === "string" &&
		(job.data.type.startsWith("cron:") || isCronJobName(job.data.type))
	) {
		return processCronJob(job as Job<CronJobData>);
	}
	return processOneOffJob(job as Job<JobData>);
}

/**
 * Setup repeatable cron jobs from the registry
 *
 * BullMQ handles deduplication automatically:
 * - Repeatable jobs with the same name + repeat options are deduplicated
 * - Multiple workers calling setupCronJobs will NOT create duplicate jobs
 * - This is safe to call from every worker instance
 *
 * The job key is computed from: name + repeat pattern + jobId (if any)
 * See: https://docs.bullmq.io/guide/jobs/repeatable
 */
async function setupCronJobs(queue: Queue): Promise<void> {
	const enableCron = env.ENABLE_CRON_JOBS !== "false";

	if (!enableCron) {
		logger.info("Cron jobs disabled via ENABLE_CRON_JOBS=false");
		return;
	}

	logger.info("Reconciling repeatable cron jobs from effective schedules...");

	try {
		let overrides: Awaited<ReturnType<typeof listCronScheduleOverrides>> = [];

		try {
			overrides = await listCronScheduleOverrides();
		} catch (error) {
			logger.error(
				{ error },
				"Failed to read cron schedule overrides; falling back to registry schedules",
			);
		}

		const scheduleOverrides: CronScheduleOverrideLike[] = [];

		for (const override of overrides) {
			if (isCronJobName(override.jobName)) {
				scheduleOverrides.push({ ...override, jobName: override.jobName });
			} else {
				logger.warn({ jobName: override.jobName }, "Ignoring unknown cron schedule override");
			}
		}

		const effectiveSchedules = resolveEffectiveCronSchedules({ overrides: scheduleOverrides });
		const schedules = Object.fromEntries(
			Object.entries(effectiveSchedules).map(([jobName, schedule]) => [
				jobName,
				{ pattern: schedule.effectivePattern },
			]),
		) as Record<CronJobName, { pattern: string }>;

		const result = await reconcileCronSchedules({ queue, schedules });

		for (const job of result.reconciled) {
			logger.debug(
				{
					type: job.jobName,
					pattern: schedules[job.jobName].pattern,
					removedCount: job.removedCount,
				},
				"Reconciled repeatable cron job",
			);
		}

		for (const job of result.failed) {
			logger.error({ error: job.error, type: job.jobName }, "Failed to reconcile cron job");
		}

		logger.info(
			{
				reconciled: result.reconciled.length,
				failed: result.failed.length,
			},
			"Cron job schedule reconciliation completed",
		);
	} catch (error) {
		logger.error(
			{ error },
			"Cron job schedule reconciliation failed; worker startup will continue",
		);
	}
}

/**
 * Main worker startup
 */
async function main(): Promise<void> {
	const concurrency = Number.parseInt(env.WORKER_CONCURRENCY || "5", 10);

	logger.info(
		{
			concurrency,
			redisHost: env.REDIS_HOST || "localhost",
			redisPort: env.REDIS_PORT || 6379,
			redisTls: env.REDIS_TLS === "true",
			nodeEnv: env.NODE_ENV,
		},
		"Starting worker process",
	);

	// Get the job queue
	const queue = getJobQueue();

	// Setup repeatable cron jobs from registry
	await setupCronJobs(queue);

	// Create the worker
	const worker = createWorker(processJob as (job: Job<JobData, JobResult>) => Promise<JobResult>);

	// Graceful shutdown handlers
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Received shutdown signal, closing worker gracefully...");

		try {
			// Close the worker (waits for current jobs to complete)
			await worker.close();
			logger.info("Worker closed successfully");

			// Close the queue connection
			await queue.close();
			logger.info("Queue connection closed");

			process.exit(0);
		} catch (error) {
			logger.error({ error }, "Error during shutdown");
			process.exit(1);
		}
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));

	// Log registered cron jobs on startup
	const repeatableJobs = await queue.getRepeatableJobs();
	logger.info(
		{
			repeatableJobs: repeatableJobs.map((j) => ({
				name: j.name,
				pattern: j.pattern,
				next: j.next ? new Date(j.next).toISOString() : null,
			})),
		},
		"Worker started with repeatable jobs",
	);
}

// Start the worker when this file is executed as the worker entrypoint.
if (!env.VITEST) {
	main().catch((error) => {
		logger.error({ error }, "Worker failed to start");
		process.exit(1);
	});
}
