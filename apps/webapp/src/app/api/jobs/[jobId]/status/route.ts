/**
 * Job Status API Route
 *
 * Returns the current status of a background job.
 * Used by the useJobStatus SWR hook for polling with deduplication.
 *
 * Rule: client-swr-dedup
 */

import { type NextRequest, NextResponse } from "next/server";
import { getJobStatus } from "@/lib/queue";

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ jobId: string }> },
) {
	const { jobId } = await params;

	if (!jobId) {
		return NextResponse.json({ error: "Job ID required" }, { status: 400 });
	}

	try {
		const status = await getJobStatus(jobId);

		if (!status) {
			return NextResponse.json({ state: "unknown", progress: 0 }, { status: 404 });
		}

		return NextResponse.json(status);
	} catch (error) {
		console.error("Failed to get job status:", error);
		return NextResponse.json({ error: "Failed to fetch job status" }, { status: 500 });
	}
}
