/**
 * Cron Job Status API Route
 *
 * Query the status of a cron job execution by its execution ID.
 * Returns both database tracking info and BullMQ job state.
 */

import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { getJobExecution } from "@/lib/cron/tracking";
import { getJobStatus } from "@/lib/queue";

const CRON_SECRET = env.CRON_SECRET;

/**
 * Verify the request is from a valid cron source or an authenticated admin
 */
async function verifyAccess(request: NextRequest): Promise<boolean> {
	const headersList = await headers();

	// Check for Bearer token
	if (CRON_SECRET) {
		const authHeader = headersList.get("authorization");
		if (authHeader === `Bearer ${CRON_SECRET}`) {
			return true;
		}

		// Check for cron secret in query params
		const { searchParams } = new URL(request.url);
		const secret = searchParams.get("secret");
		if (secret === CRON_SECRET) {
			return true;
		}
	}

	// Fall back to session-based auth for admin users
	const session = await auth.api.getSession({ headers: headersList });
	if (session?.user?.role === "admin") {
		return true;
	}

	return false;
}

/**
 * GET /api/cron/status/[executionId]
 *
 * Get the current status of a cron job execution
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ executionId: string }> },
) {
	await connection();

	const isAuthorized = await verifyAccess(request);
	if (!isAuthorized) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

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
