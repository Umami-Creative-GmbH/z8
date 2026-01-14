/**
 * Export Processing Cron Endpoint
 *
 * API route for triggering data export processing jobs.
 * Can be called by:
 * - Vercel Cron Jobs (recommended: every 1-5 minutes)
 * - External schedulers (with API key)
 * - Manual admin triggers
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { runExportProcessor } from "@/lib/jobs/export-processor";
import { createLogger } from "@/lib/logger";

const logger = createLogger("cron-export");

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
 * GET /api/cron/export
 *
 * Processes all pending exports
 */
export async function GET(request: NextRequest) {
	await connection();
	const isAuthorized = await verifyCronAuth(request);

	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	logger.info("Starting export processing cron job");

	try {
		const result = await runExportProcessor();

		logger.info(
			{
				processed: result.exportsProcessed,
				succeeded: result.exportsSucceeded,
				failed: result.exportsFailed,
			},
			"Export processing cron job completed",
		);

		return NextResponse.json({
			success: result.success,
			timestamp: new Date().toISOString(),
			result: {
				exportsProcessed: result.exportsProcessed,
				exportsSucceeded: result.exportsSucceeded,
				exportsFailed: result.exportsFailed,
				expiredExportsCleaned: result.expiredExportsCleaned,
				errors: result.errors.length > 0 ? result.errors : undefined,
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Export processing cron job failed");

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
 * POST /api/cron/export
 *
 * Manual trigger with options
 * Body: { cleanupOnly?: boolean }
 */
export async function POST(request: NextRequest) {
	await connection();
	const isAuthorized = await verifyCronAuth(request);

	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const body = await request.json().catch(() => ({}));
		const { cleanupOnly } = body as { cleanupOnly?: boolean };

		logger.info({ cleanupOnly }, "Running manual export job");

		if (cleanupOnly) {
			// Only run cleanup
			const { cleanupExpiredExports } = await import("@/lib/export/export-service");
			const cleaned = await cleanupExpiredExports();

			return NextResponse.json({
				success: true,
				timestamp: new Date().toISOString(),
				result: {
					expiredExportsCleaned: cleaned,
				},
			});
		}

		// Run full processor
		const result = await runExportProcessor();

		return NextResponse.json({
			success: result.success,
			timestamp: new Date().toISOString(),
			result: {
				exportsProcessed: result.exportsProcessed,
				exportsSucceeded: result.exportsSucceeded,
				exportsFailed: result.exportsFailed,
				expiredExportsCleaned: result.expiredExportsCleaned,
				errors: result.errors.length > 0 ? result.errors : undefined,
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Manual export job failed");

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
