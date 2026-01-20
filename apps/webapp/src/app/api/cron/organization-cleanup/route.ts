/**
 * Organization Cleanup Cron Endpoint
 *
 * API route for permanently deleting organizations that have been
 * soft-deleted for more than 5 days.
 *
 * Recommended schedule: Daily at midnight
 * Vercel cron syntax: 0 0 * * *
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { runOrganizationCleanup } from "@/lib/jobs/organization-cleanup";
import { createLogger } from "@/lib/logger";

const logger = createLogger("cron-organization-cleanup");

// Secret for cron job authentication
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Verify the request is from a valid cron source
 */
async function verifyCronAuth(request: NextRequest): Promise<boolean> {
	// Check for Vercel Cron header
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

	// In development, allow without auth
	if (process.env.NODE_ENV === "development") {
		logger.warn("Allowing cron request without auth in development");
		return true;
	}

	return false;
}

/**
 * GET /api/cron/organization-cleanup
 *
 * Permanently deletes organizations that have been soft-deleted for 5+ days
 */
export async function GET(request: NextRequest) {
	await connection();
	const isAuthorized = await verifyCronAuth(request);

	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	logger.info("Starting organization cleanup cron job");

	try {
		const result = await runOrganizationCleanup();

		logger.info(
			{
				deleted: result.organizationsDeleted,
				errors: result.errors.length,
			},
			"Organization cleanup cron job completed"
		);

		return NextResponse.json({
			success: result.success,
			timestamp: new Date().toISOString(),
			result: {
				organizationsDeleted: result.organizationsDeleted,
				errors: result.errors.length > 0 ? result.errors : undefined,
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Organization cleanup cron job failed");

		return NextResponse.json(
			{
				success: false,
				error: errorMessage,
				timestamp: new Date().toISOString(),
			},
			{ status: 500 }
		);
	}
}
