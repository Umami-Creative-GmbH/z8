/**
 * Break Enforcement Cron Endpoint
 *
 * Safety net job that processes work periods that haven't been checked
 * for break enforcement. Runs periodically (recommended: hourly or end-of-day)
 * to catch:
 * - Forgotten clock-outs (auto-closed by system)
 * - System failures during clock-out
 * - Manual time entry imports
 */

import { Effect } from "effect";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	BreakEnforcementService,
	BreakEnforcementServiceLive,
} from "@/lib/effect/services/break-enforcement.service";
import { TimeRegulationServiceLive } from "@/lib/effect/services/time-regulation.service";
import { createLogger } from "@/lib/logger";

const logger = createLogger("cron-break-enforcement");

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
 * GET /api/cron/break-enforcement
 *
 * Processes all unprocessed work periods and enforces breaks where needed.
 * Query params:
 * - date: ISO date string (optional, defaults to today)
 * - organizationId: Filter to specific organization (optional)
 */
export async function GET(request: NextRequest) {
	await connection();
	const isAuthorized = await verifyCronAuth(request);

	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { searchParams } = new URL(request.url);
	const dateParam = searchParams.get("date");
	const organizationId = searchParams.get("organizationId") || undefined;

	const targetDate = dateParam ? new Date(dateParam) : new Date();

	logger.info(
		{ targetDate: targetDate.toISOString(), organizationId },
		"Starting break enforcement cron job",
	);

	try {
		const enforcementEffect = Effect.gen(function* (_) {
			const breakService = yield* _(BreakEnforcementService);

			return yield* _(
				breakService.processUnprocessedPeriods({
					organizationId,
					date: targetDate,
				}),
			);
		}).pipe(
			Effect.provide(BreakEnforcementServiceLive),
			Effect.provide(TimeRegulationServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

		const result = await Effect.runPromise(enforcementEffect);

		logger.info(
			{
				processedCount: result.processedCount,
				adjustedCount: result.adjustedCount,
				errorCount: result.errors.length,
			},
			"Break enforcement cron job completed",
		);

		return NextResponse.json({
			success: true,
			timestamp: new Date().toISOString(),
			results: {
				processedCount: result.processedCount,
				adjustedCount: result.adjustedCount,
				errors: result.errors,
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Break enforcement cron job failed");

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
