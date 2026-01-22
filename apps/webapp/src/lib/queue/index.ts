/**
 * Job Queue Module
 *
 * Uses BullMQ for background job processing with Valkey/Redis backend.
 * This enables offloading heavy operations from API routes to background workers.
 *
 * Key benefits:
 * - Prevents HTTP 504 timeouts for long-running operations
 * - Provides job retry with exponential backoff
 * - Enables progress tracking and job status monitoring
 * - Supports job prioritization and rate limiting
 */

import { type ConnectionOptions, type Job, type JobsOptions, Queue, Worker } from "bullmq";
import type { CronJobData, CronJobName, CronJobResult } from "@/lib/cron/registry";
import { createLogger } from "@/lib/logger";
import { env } from "@/env";

const logger = createLogger("JobQueue");

// Connection configuration for Valkey/Redis
const connection: ConnectionOptions = {
	host: env.VALKEY_HOST || env.REDIS_HOST || "localhost",
	port: Number(env.VALKEY_PORT || env.REDIS_PORT || 6379),
	password: env.VALKEY_PASSWORD || env.REDIS_PASSWORD || undefined,
	maxRetriesPerRequest: null, // Required for BullMQ
};

// Job types
export type JobType = "report" | "export" | "email" | "cleanup";

// Job data interfaces
export interface ReportJobData {
	type: "report";
	employeeId: string;
	organizationId: string;
	startDate: string;
	endDate: string;
	requestedById: string;
}

export interface ExportJobData {
	type: "export";
	exportId: string;
	organizationId: string;
}

export interface EmailJobData {
	type: "email";
	to: string;
	subject: string;
	template: string;
	data: Record<string, unknown>;
}

export interface CleanupJobData {
	type: "cleanup";
	task: "expired_exports" | "old_notifications" | "old_audit_logs";
}

export type JobData = ReportJobData | ExportJobData | EmailJobData | CleanupJobData | CronJobData;

// Job result interfaces
export interface JobResult {
	success: boolean;
	message?: string;
	data?: unknown;
	error?: string;
}

// Default job options
const defaultJobOptions: JobsOptions = {
	attempts: 3,
	backoff: {
		type: "exponential",
		delay: 1000,
	},
	removeOnComplete: {
		count: 100, // Keep last 100 completed jobs
		age: 24 * 60 * 60, // Keep for 24 hours
	},
	removeOnFail: {
		count: 500, // Keep last 500 failed jobs for debugging
		age: 7 * 24 * 60 * 60, // Keep for 7 days
	},
};

// Singleton pattern for queue instance
const globalForQueue = globalThis as unknown as {
	jobQueue: Queue<JobData, JobResult> | undefined;
};

/**
 * Get or create the main job queue
 */
export function getJobQueue(): Queue<JobData, JobResult> {
	if (!globalForQueue.jobQueue) {
		globalForQueue.jobQueue = new Queue<JobData, JobResult>("z8-jobs", {
			connection,
			defaultJobOptions,
		});

		logger.info("Job queue initialized");
	}

	return globalForQueue.jobQueue;
}

/**
 * Add a job to the queue
 */
export async function addJob(
	name: string,
	data: JobData,
	options?: Partial<JobsOptions>,
): Promise<Job<JobData, JobResult>> {
	const queue = getJobQueue();
	const job = await queue.add(name, data, {
		...defaultJobOptions,
		...options,
	});

	logger.info({ jobId: job.id, name, type: data.type }, "Job added to queue");
	return job;
}

/**
 * Add a report generation job
 */
export async function addReportJob(
	data: Omit<ReportJobData, "type">,
): Promise<Job<JobData, JobResult>> {
	return addJob("generate-report", { ...data, type: "report" });
}

/**
 * Add an export processing job
 */
export async function addExportJob(
	data: Omit<ExportJobData, "type">,
): Promise<Job<JobData, JobResult>> {
	return addJob("process-export", { ...data, type: "export" });
}

/**
 * Add an email sending job
 */
export async function addEmailJob(
	data: Omit<EmailJobData, "type">,
): Promise<Job<JobData, JobResult>> {
	return addJob("send-email", { ...data, type: "email" }, { priority: 1 }); // High priority
}

/**
 * Add a cleanup job
 */
export async function addCleanupJob(
	data: Omit<CleanupJobData, "type">,
): Promise<Job<JobData, JobResult>> {
	return addJob("cleanup", { ...data, type: "cleanup" }, { priority: 10 }); // Low priority
}

/**
 * Add a cron job to the queue
 *
 * Used for manual triggers via API. The job will be processed by the worker
 * using the cron job registry's processor.
 */
export async function addCronJob<T extends CronJobName>(
	data: CronJobData<T>,
	options?: Partial<JobsOptions>,
): Promise<Job<CronJobData<T>, CronJobResult<T>>> {
	const queue = getJobQueue();
	const job = await queue.add(data.type, data as JobData, {
		...defaultJobOptions,
		...options,
	});

	logger.info(
		{ jobId: job.id, type: data.type, executionId: data.executionId },
		"Cron job added to queue",
	);

	return job as unknown as Job<CronJobData<T>, CronJobResult<T>>;
}

/**
 * Get job status by ID
 */
export async function getJobStatus(jobId: string): Promise<{
	state: string;
	progress: number;
	result?: JobResult;
	error?: string;
} | null> {
	const queue = getJobQueue();
	const job = await queue.getJob(jobId);

	if (!job) {
		return null;
	}

	const state = await job.getState();
	const progress = (job.progress as number) || 0;

	return {
		state,
		progress,
		result: job.returnvalue,
		error: job.failedReason,
	};
}

/**
 * Create a worker to process jobs
 * This should be run in a separate process (worker.ts)
 */
export function createWorker(
	processor: (job: Job<JobData, JobResult>) => Promise<JobResult>,
): Worker<JobData, JobResult> {
	const worker = new Worker<JobData, JobResult>("z8-jobs", processor, {
		connection,
		concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5", 10),
	});

	worker.on("completed", (job) => {
		logger.info({ jobId: job.id, name: job.name }, "Job completed");
	});

	worker.on("failed", (job, err) => {
		logger.error({ jobId: job?.id, name: job?.name, error: err.message }, "Job failed");
	});

	worker.on("progress", (job, progress) => {
		logger.debug({ jobId: job.id, progress }, "Job progress");
	});

	logger.info("Job worker started");
	return worker;
}

/**
 * Check if the queue is healthy (Valkey connection is working)
 */
export async function isQueueHealthy(): Promise<boolean> {
	try {
		const queue = getJobQueue();
		await queue.getJobCounts();
		return true;
	} catch {
		return false;
	}
}

// Export the queue for direct access if needed
export const jobQueue = getJobQueue();
