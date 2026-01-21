/**
 * Cron Job Status API Route
 *
 * Query the status of a cron job execution by its execution ID.
 * Returns both database tracking info and BullMQ job state.
 */

import { connection, type NextRequest, NextResponse } from "next/server";
import { getJobExecution } from "@/lib/cron/tracking";
import { getJobStatus } from "@/lib/queue";

/**
 * GET /api/cron/status/[executionId]
 *
 * Get the current status of a cron job execution
 */
export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ executionId: string }> },
) {
	await connection();

	const { executionId } = await params;

	try {
		const execution = await getJobExecution(executionId);

		if (!execution) {
			return NextResponse.json({ error: "Execution not found" }, { status: 404 });
		}

		// Get BullMQ job status if available
		let bullmqStatus = null;
		if (execution.bullmqJobId) {
			bullmqStatus = await getJobStatus(execution.bullmqJobId);
		}

		return NextResponse.json({
			executionId: execution.id,
			jobName: execution.jobName,
			status: execution.status,
			startedAt: execution.startedAt,
			completedAt: execution.completedAt,
			durationMs: execution.durationMs,
			result: execution.result,
			error: execution.error,
			metadata: execution.metadata,
			bullmq: bullmqStatus
				? {
						state: bullmqStatus.state,
						progress: bullmqStatus.progress,
					}
				: null,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		return NextResponse.json({ error: errorMessage }, { status: 500 });
	}
}
