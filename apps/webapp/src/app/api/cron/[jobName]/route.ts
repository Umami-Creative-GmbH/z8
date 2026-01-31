/**
 * Dynamic Cron Job API Route
 *
 * Unified endpoint for all cron job types. Supports:
 * - GET: Enqueue a scheduled job (called by external schedulers)
 * - POST: Enqueue a manual trigger with custom parameters
 *
 * Query parameters:
 * - secret: CRON_SECRET for authentication (alternative to Bearer token)
 * - waitForResult: If "true", waits for job completion before responding
 *
 * All jobs are enqueued to BullMQ and processed by the worker.
 * Job execution is tracked in the database for history and metrics.
 */

import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { CRON_JOBS, type CronJobName, isCronJobName } from "@/lib/cron/registry";
import { createJobExecution, getJobExecution, updateJobExecution } from "@/lib/cron/tracking";
import { createLogger } from "@/lib/logger";
import { addCronJob } from "@/lib/queue";

const logger = createLogger("cron-api");
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Verify the request is from a valid cron source
 */
async function verifyCronAuth(request: NextRequest): Promise<boolean> {
	// Check for Bearer token in Authorization header
	const headersList = await headers();
	const authHeader = headersList.get("authorization");

	if (authHeader === `Bearer ${CRON_SECRET}`) {
		return true;
	}

	// Check for cron secret in query params (for external schedulers)
	const { searchParams } = new URL(request.url);
	const secret = searchParams.get("secret");

	if (secret === CRON_SECRET) {
		return true;
	}

	return false;
}

/**
 * Convert URL job name to registry job name
 * e.g., "vacation" -> "cron:vacation"
 */
function toRegistryJobName(urlJobName: string): string {
	// If it already has the cron: prefix, return as-is
	if (urlJobName.startsWith("cron:")) {
		return urlJobName;
	}
	return `cron:${urlJobName}`;
}

/**
 * GET /api/cron/[jobName]
 *
 * Enqueue a cron job for processing (typically called by schedulers)
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ jobName: string }> },
) {
	await connection();

	const isAuthorized = await verifyCronAuth(request);
	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { jobName: urlJobName } = await params;
	const jobName = toRegistryJobName(urlJobName);

	// Validate job name
	if (!isCronJobName(jobName)) {
		return NextResponse.json({ error: `Unknown cron job: ${jobName}` }, { status: 404 });
	}

	const typedJobName = jobName as CronJobName;
	const { searchParams } = new URL(request.url);
	const waitForResult = searchParams.get("waitForResult") === "true";

	// Track executionId outside try block to handle cleanup on enqueue failure
	let executionId: string | undefined;

	try {
		logger.info({ jobName: typedJobName }, "Enqueueing cron job via API");

		// Create execution tracking record
		executionId = await createJobExecution({
			jobName: typedJobName,
			metadata: {
				source: "api",
				waitForResult,
			},
		});

		// Enqueue job to BullMQ
		const job = await addCronJob(
			{
				type: typedJobName,
				triggeredAt: new Date().toISOString(),
				executionId,
			},
			CRON_JOBS[typedJobName].defaultJobOptions,
		);

		// Update execution record with BullMQ job ID
		await updateJobExecution(executionId, { bullmqJobId: job.id });

		// If waitForResult is requested, poll until job completes
		if (waitForResult) {
			const result = await waitForJobCompletion(executionId, 60000); // 60s timeout
			return NextResponse.json({
				success: result.status === "completed",
				executionId,
				jobId: job.id,
				status: result.status,
				result: result.result,
				error: result.error,
				durationMs: result.durationMs,
				timestamp: new Date().toISOString(),
			});
		}

		// Return immediately with job ID for async tracking
		return NextResponse.json({
			success: true,
			executionId,
			jobId: job.id,
			status: "enqueued",
			statusUrl: `/api/cron/status/${executionId}`,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage, jobName: typedJobName }, "Failed to enqueue cron job");

		// If we created an execution record but enqueue failed, mark it as failed
		// to avoid orphaned "pending" records
		if (executionId) {
			try {
				await updateJobExecution(executionId, {
					status: "failed",
					error: `Enqueue failed: ${errorMessage}`,
					completedAt: new Date(),
					durationMs: 0,
				});
			} catch (cleanupError) {
				logger.error(
					{ error: cleanupError, executionId },
					"Failed to mark orphaned execution as failed",
				);
			}
		}

		return NextResponse.json(
			{
				success: false,
				error: errorMessage,
				timestamp: new Date().toISOString(),
			},
			{ status: 500 },
		);
	}
}

/**
 * POST /api/cron/[jobName]
 *
 * Enqueue a cron job with custom parameters (manual trigger)
 */
export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ jobName: string }> },
) {
	await connection();

	const isAuthorized = await verifyCronAuth(request);
	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { jobName: urlJobName } = await params;
	const jobName = toRegistryJobName(urlJobName);

	// Validate job name
	if (!isCronJobName(jobName)) {
		return NextResponse.json({ error: `Unknown cron job: ${jobName}` }, { status: 404 });
	}

	const typedJobName = jobName as CronJobName;

	// Track executionId outside try block to handle cleanup on enqueue failure
	let executionId: string | undefined;

	try {
		const body = await request.json().catch(() => ({}));
		const { manualParams, waitForResult, triggeredBy } = body as {
			manualParams?: Record<string, unknown>;
			waitForResult?: boolean;
			triggeredBy?: string;
		};

		logger.info(
			{ jobName: typedJobName, manualParams, triggeredBy },
			"Enqueueing manual cron job via API",
		);

		// Create execution tracking record
		executionId = await createJobExecution({
			jobName: typedJobName,
			metadata: {
				source: "manual",
				triggeredBy,
				manualParams,
				waitForResult,
			},
		});

		// Enqueue job with manual params
		const job = await addCronJob(
			{
				type: typedJobName,
				triggeredAt: new Date().toISOString(),
				executionId,
				manualParams,
			},
			CRON_JOBS[typedJobName].defaultJobOptions,
		);

		// Update execution record with BullMQ job ID
		await updateJobExecution(executionId, { bullmqJobId: job.id });

		// If waitForResult is requested, poll until job completes
		if (waitForResult) {
			const result = await waitForJobCompletion(executionId, 60000); // 60s timeout
			return NextResponse.json({
				success: result.status === "completed",
				executionId,
				jobId: job.id,
				status: result.status,
				result: result.result,
				error: result.error,
				durationMs: result.durationMs,
				timestamp: new Date().toISOString(),
			});
		}

		// Return immediately with job ID for async tracking
		return NextResponse.json({
			success: true,
			executionId,
			jobId: job.id,
			status: "enqueued",
			statusUrl: `/api/cron/status/${executionId}`,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error(
			{ error: errorMessage, jobName: typedJobName },
			"Failed to enqueue manual cron job",
		);

		// If we created an execution record but enqueue failed, mark it as failed
		// to avoid orphaned "pending" records
		if (executionId) {
			try {
				await updateJobExecution(executionId, {
					status: "failed",
					error: `Enqueue failed: ${errorMessage}`,
					completedAt: new Date(),
					durationMs: 0,
				});
			} catch (cleanupError) {
				logger.error(
					{ error: cleanupError, executionId },
					"Failed to mark orphaned execution as failed",
				);
			}
		}

		return NextResponse.json(
			{
				success: false,
				error: errorMessage,
				timestamp: new Date().toISOString(),
			},
			{ status: 500 },
		);
	}
}

/**
 * Poll for job completion with timeout
 */
async function waitForJobCompletion(
	executionId: string,
	timeoutMs: number,
): Promise<{
	status: string;
	result?: unknown;
	error?: string;
	durationMs?: number;
}> {
	const startTime = Date.now();
	const pollInterval = 500; // Poll every 500ms

	while (Date.now() - startTime < timeoutMs) {
		const execution = await getJobExecution(executionId);

		if (!execution) {
			return { status: "not_found", error: "Execution record not found" };
		}

		if (execution.status === "completed" || execution.status === "failed") {
			return {
				status: execution.status,
				result: execution.result,
				error: execution.error ?? undefined,
				durationMs: execution.durationMs ?? undefined,
			};
		}

		// Wait before next poll
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}

	return { status: "timeout", error: `Job did not complete within ${timeoutMs}ms` };
}
