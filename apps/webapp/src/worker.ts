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
 * - Health checks via Valkey connection
 *
 * Environment variables:
 * - VALKEY_HOST: Redis/Valkey host (default: localhost)
 * - VALKEY_PORT: Redis/Valkey port (default: 6379)
 * - VALKEY_PASSWORD: Redis/Valkey password (optional)
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
	getCronSchedules,
	isCronJobName,
} from "@/lib/cron/registry";
import {
	createJobExecution,
	markJobCompleted,
	markJobFailed,
	markJobRunning,
} from "@/lib/cron/tracking";
import { createLogger } from "@/lib/logger";
import {
	createWorker,
	getJobQueue,
	type JobData,
	type JobResult,
} from "@/lib/queue";

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

		logger.error(
			{ error: errorMessage, jobId: job.id, type, executionId },
			"Cron job failed",
		);

		return {
			success: false,
			error: errorMessage,
		};
	}
}

/**
 * Process one-off jobs (reports, exports, emails, cleanup)
 */
async function processOneOffJob(job: Job<JobData>): Promise<JobResult> {
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
				const { processWebhookJob } = await import(
					"@/lib/webhooks/webhook-worker"
				);
				// Type assertion needed: job.data is WebhookJobData (queue type)
				// processWebhookJob expects the specific webhook type, which is structurally compatible
				return processWebhookJob(
					job as unknown as Parameters<typeof processWebhookJob>[0],
				);
			}

			case "calendar-sync": {
				const { processCalendarSyncJob } = await import(
					"@/lib/calendar-sync/jobs"
				);
				return processCalendarSyncJob(job.data);
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
async function processJob(job: Job<AllJobData>): Promise<JobResult> {
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

	logger.info("Setting up repeatable cron jobs from registry...");

	const schedules = getCronSchedules();

	for (const [type, schedule] of Object.entries(schedules)) {
		try {
			// BullMQ automatically deduplicates repeatable jobs with the same options
			await queue.add(
				type,
				{
					type: type as CronJobName,
					triggeredAt: new Date().toISOString(),
					// Note: executionId is NOT included here - it will be created by the worker
				},
				{
					repeat: {
						pattern: schedule.pattern,
					},
					// Use a consistent jobId to ensure deduplication
					jobId: `cron-${type}`,
					removeOnComplete: {
						count: 50, // Keep last 50 completed cron runs
						age: 24 * 60 * 60, // Keep for 24 hours
					},
					removeOnFail: {
						count: 100, // Keep more failed jobs for debugging
						age: 7 * 24 * 60 * 60, // Keep for 7 days
					},
				},
			);

			logger.debug(
				{
					type,
					pattern: schedule.pattern,
					description: schedule.description,
				},
				"Registered repeatable cron job",
			);
		} catch (error) {
			logger.error({ error, type }, "Failed to setup cron job");
		}
	}

	logger.info(`Setup ${Object.keys(schedules).length} cron jobs from registry`);
}

/**
 * Main worker startup
 */
async function main(): Promise<void> {
	const concurrency = Number.parseInt(env.WORKER_CONCURRENCY || "5", 10);

	logger.info(
		{
			concurrency,
			valkeyHost: env.VALKEY_HOST || "localhost",
			valkeyPort: env.VALKEY_PORT || 6379,
			nodeEnv: env.NODE_ENV,
		},
		"Starting worker process",
	);

	// Get the job queue
	const queue = getJobQueue();

	// Setup repeatable cron jobs from registry
	await setupCronJobs(queue);

	// Create the worker
	const worker = createWorker(
		processJob as (job: Job<JobData, JobResult>) => Promise<JobResult>,
	);

	// Graceful shutdown handlers
	const shutdown = async (signal: string) => {
		logger.info(
			{ signal },
			"Received shutdown signal, closing worker gracefully...",
		);

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

// Start the worker
main().catch((error) => {
	logger.error({ error }, "Worker failed to start");
	process.exit(1);
});
