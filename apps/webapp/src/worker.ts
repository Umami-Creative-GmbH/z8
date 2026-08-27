/**
 * BullMQ Worker Process with Scheduled Cron Jobs
 *
 * Dedicated worker for background job processing and scheduled cron tasks.
 * Runs separately from the webapp for independent scaling.
 *
 * Features:
 * - Processes one-off jobs (exports, emails, reports, cleanup)
 * - Runs scheduled cron jobs (vacation, telemetry, etc.)
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
 * - ENABLE_CRON_JOBS: Enable scheduled cron jobs (default: true)
 */

import "dotenv/config";
import type { Job, Queue } from "bullmq";
import { env } from "@/env";
import {
	CRON_JOBS,
	type CronJobData,
	type CronJobName,
	type CronScheduleOverrideLike,
	getJobExecutionByBullmqJobId,
	getOrCreateSchedulerJobExecution,
	isCronJobName,
	listCronScheduleOverrides,
	markJobCompleted,
	markJobFailed,
	markJobRunning,
	reconcileCronSchedules,
	resolveEffectiveCronSchedules,
} from "@/lib/cron";
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
 * - Scheduled jobs (need to create executionId on the fly)
 */
async function processCronJob(job: Job<CronJobData>): Promise<JobResult> {
	const { type, executionId: providedExecutionId, manualParams } = job.data;
	const startTime = Date.now();

	// Ensure executionId exists (create one for scheduled jobs)
	let executionId: string | undefined = providedExecutionId;
	if (!executionId) {
		if (!job.id) {
			throw new Error("Cron scheduler job is missing its BullMQ job ID");
		}
		executionId = await getOrCreateSchedulerJobExecution({
			jobName: type,
			bullmqJobId: job.id,
		});
		await job.updateData({ ...job.data, executionId });
	}

	logger.info({ jobId: job.id, type, executionId }, "Processing cron job");

	// Mark job as running before executing business logic.
	await markJobRunning(executionId);

	let result: unknown;
	try {
		const jobDef = CRON_JOBS[type];
		result = await jobDef.processor({
			triggeredAt: job.data.triggeredAt,
			manualParams,
		});
	} catch (error) {
		const jobError = error instanceof Error ? error : new Error(String(error));
		const duration = Date.now() - startTime;
		const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

		if (isFinalAttempt) {
			try {
				const failureResult = getFailureResult(jobError);
				if (failureResult === undefined) {
					await markJobFailed(executionId, jobError.message, duration);
				} else {
					await markJobFailed(
						executionId,
						jobError.message,
						duration,
						failureResult,
					);
				}
			} catch (trackingError) {
				logger.error(
					{ error: trackingError, jobId: job.id, type, executionId },
					"Failed to mark cron job failed",
				);
			}
		}

		logger.error(
			{
				error: jobError.message,
				jobId: job.id,
				type,
				executionId,
				isFinalAttempt,
			},
			"Cron job failed",
		);

		throw jobError;
	}

	const duration = Date.now() - startTime;
	try {
		await markJobCompleted(executionId, result, duration);
	} catch (trackingError) {
		logger.error(
			{ error: trackingError, jobId: job.id, type, executionId },
			"Failed to mark cron job completed",
		);
	}

	logger.info(
		{ jobId: job.id, type, executionId, durationMs: duration },
		"Cron job completed successfully",
	);

	return {
		success: true,
		message: `${type} completed`,
		data: result,
	};
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
				const { processWebhookJob } = await import(
					"@/lib/webhooks/webhook-worker"
				);
				// Type assertion needed: job.data is WebhookJobData (queue type)
				// processWebhookJob expects the specific webhook type, which is structurally compatible
				return await processWebhookJob(
					job as unknown as Parameters<typeof processWebhookJob>[0],
				);
			}

			case "calendar-sync": {
				const { processCalendarSyncJob } = await import(
					"@/lib/calendar-sync/jobs"
				);
				return await processCalendarSyncJob(job.data);
			}

			case "organization-deletion-notification": {
				const { sendOrganizationDeletionNotifications } = await import(
					"@/lib/jobs/organization-deletion-notification"
				);
				await sendOrganizationDeletionNotifications(job.data);
				return {
					success: true,
					message: "Organization deletion notifications sent",
				};
			}

			case "audit-pack": {
				const { processAuditPack } = await import(
					"@/lib/audit-pack/application/audit-pack-processor"
				);
				await processAuditPack(job.data);
				return { success: true, message: "Audit pack processed" };
			}

			case "import-review-scan": {
				const { processImportReviewJob } = await import(
					"@/lib/import-review/worker"
				);
				return await processImportReviewJob(job as Job<typeof job.data>);
			}

			case "import-review-commit": {
				const { processImportReviewJob } = await import(
					"@/lib/import-review/worker"
				);
				return await processImportReviewJob(job as Job<typeof job.data>);
			}

			case "payroll-export": {
				const { processExportJob } = await import("@/lib/payroll-export");
				await processExportJob({
					jobId: job.data.jobId,
					organizationId: job.data.organizationId,
				});
				return { success: true, message: "Payroll export processed" };
			}

			default:
				throw new Error(`Unknown job type: ${(job.data as JobData).type}`);
		}
	} catch (error) {
		const jobError = error instanceof Error ? error : new Error(String(error));
		logger.error({ error: jobError.message, jobId: job.id }, "Job failed");
		throw jobError;
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

async function resolveCronExecutionId(
	job: Job<JobData, JobResult>,
): Promise<string | undefined> {
	const executionId = (job.data as CronJobData).executionId;
	if (executionId) {
		return executionId;
	}
	if (!job.id) {
		return undefined;
	}
	return (await getJobExecutionByBullmqJobId(job.id))?.id;
}

function isCronJob(job: Job<JobData, JobResult>): boolean {
	const type = job.data.type;
	return (
		typeof type === "string" &&
		(type.startsWith("cron:") || isCronJobName(type))
	);
}

function getJobDuration(job: Job<JobData, JobResult>): number {
	if (job.processedOn === undefined || job.finishedOn === undefined) {
		return 0;
	}
	return Math.max(0, job.finishedOn - job.processedOn);
}

function getFailureResult(error: Error): unknown {
	if (!("result" in error)) return undefined;
	return error.result;
}

export async function reconcileCronJobCompletion(
	job: Job<JobData, JobResult>,
	result: JobResult,
): Promise<void> {
	if (!isCronJob(job)) {
		return;
	}

	try {
		const executionId = await resolveCronExecutionId(job);
		if (!executionId) {
			logger.warn(
				{ jobId: job.id, type: job.data.type },
				"Cron execution not found for completion",
			);
			return;
		}
		await markJobCompleted(executionId, result.data, getJobDuration(job));
	} catch (error) {
		logger.error(
			{ error, jobId: job.id, type: job.data.type },
			"Failed to reconcile completed cron job",
		);
	}
}

export async function reconcileCronJobFailure(
	job: Job<JobData, JobResult>,
	error: Error,
): Promise<void> {
	if (!isCronJob(job)) {
		return;
	}

	try {
		if ((await job.getState()) !== "failed") {
			return;
		}
		const executionId = await resolveCronExecutionId(job);
		if (!executionId) {
			logger.warn(
				{ jobId: job.id, type: job.data.type },
				"Cron execution not found for failure",
			);
			return;
		}
		await markJobFailed(executionId, error.message, getJobDuration(job));
	} catch (trackingError) {
		logger.error(
			{ error: trackingError, jobId: job.id, type: job.data.type },
			"Failed to reconcile failed cron job",
		);
	}
}

export function registerCronTrackingListeners(
	worker: ReturnType<typeof createWorker>,
): void {
	worker.on("completed", (job, result) => {
		void reconcileCronJobCompletion(job, result);
	});
	worker.on("failed", (job, error) => {
		if (job) {
			void reconcileCronJobFailure(job, error);
		}
	});
}

/**
 * Setup scheduled cron jobs from the registry
 *
 * Deterministic Job Scheduler IDs make reconciliation idempotent when
 * setupCronJobs runs concurrently across worker instances.
 */
async function setupCronJobs(queue: Queue): Promise<void> {
	const enableCron = env.ENABLE_CRON_JOBS !== "false";

	if (!enableCron) {
		logger.info("Cron jobs disabled via ENABLE_CRON_JOBS=false");
		return;
	}

	logger.info("Reconciling cron job schedulers from effective schedules...");

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
				logger.warn(
					{ jobName: override.jobName },
					"Ignoring unknown cron schedule override",
				);
			}
		}

		const effectiveSchedules = resolveEffectiveCronSchedules({
			overrides: scheduleOverrides,
		});
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
				},
				"Reconciled cron job scheduler",
			);
		}

		for (const job of result.failed) {
			logger.error(
				{ error: job.error, type: job.jobName },
				"Failed to reconcile cron job scheduler",
			);
		}

		logger.info(
			{
				reconciled: result.reconciled.length,
				failed: result.failed.length,
			},
			"Cron job scheduler reconciliation completed",
		);
	} catch (error) {
		logger.error(
			{ error },
			"Cron job scheduler reconciliation failed; worker startup will continue",
		);
	}
}

export async function logRegisteredJobSchedulers(
	queue: Pick<Queue, "getJobSchedulers">,
): Promise<void> {
	try {
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
	} catch (error) {
		logger.warn(
			{ error },
			"Failed to list registered job schedulers; worker startup will continue",
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

	// Setup scheduled cron jobs from registry
	await setupCronJobs(queue);

	// Create the worker
	const worker = createWorker(
		processJob as (job: Job<JobData, JobResult>) => Promise<JobResult>,
	);
	registerCronTrackingListeners(worker);

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

	await logRegisteredJobSchedulers(queue);
}

// Start the worker when this file is executed as the worker entrypoint.
if (!env.VITEST) {
	main().catch((error) => {
		logger.error({ error }, "Worker failed to start");
		process.exit(1);
	});
}
