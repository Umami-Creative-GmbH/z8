/**
 * Job Status API Route
 *
 * Returns the current status of a background job.
 * Used by the useJobStatus SWR hook for polling with deduplication.
 *
 * Rule: client-swr-dedup
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getJobStatus } from "@/lib/queue";

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ jobId: string }> },
) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { jobId } = await params;

	if (!jobId) {
		return NextResponse.json({ error: "Job ID required" }, { status: 400 });
	}

	try {
		const status = await getJobStatus(jobId);

		if (!status) {
			return NextResponse.json({ state: "unknown", progress: 0 }, { status: 404 });
		}

		// Authorization: verify the job belongs to the caller's organization.
		// Jobs with an organizationId must match the session's active org.
		// Jobs without one (system jobs like email/cleanup) require admin role.
		if (status.organizationId) {
			if (status.organizationId !== session.session.activeOrganizationId) {
				return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
			}
		} else if (session.user.role !== "admin") {
			return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
		}

		// Strip organizationId from the response -- the client doesn't need it
		const { organizationId: _, ...clientStatus } = status;
		return NextResponse.json(clientStatus);
	} catch (error) {
		console.error("Failed to get job status:", error);
		return NextResponse.json({ error: "Failed to fetch job status" }, { status: 500 });
	}
}
