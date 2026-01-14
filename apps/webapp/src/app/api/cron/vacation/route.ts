/**
 * Vacation Automation Cron Endpoint
 *
 * API route for triggering vacation-related automation jobs.
 * Can be called by:
 * - Vercel Cron Jobs
 * - External schedulers (with API key)
 * - Manual admin triggers
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import {
	runAnnualCarryover,
	runCarryoverExpiry,
	runMonthlyAccrual,
	runVacationAutomation,
} from "@/lib/jobs/carryover-automation";
import { createLogger } from "@/lib/logger";

const logger = createLogger("cron-vacation");

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
 * GET /api/cron/vacation
 *
 * Runs all vacation automation jobs based on the current date
 */
export async function GET(request: NextRequest) {
	await connection();
	const isAuthorized = await verifyCronAuth(request);

	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	logger.info("Starting vacation automation cron job");

	try {
		const results = await runVacationAutomation();

		logger.info(
			{
				hasCarryover: !!results.carryover,
				hasExpiry: !!results.expiry,
				hasAccrual: !!results.accrual,
			},
			"Vacation automation cron job completed",
		);

		return NextResponse.json({
			success: true,
			timestamp: new Date().toISOString(),
			results: {
				carryover: results.carryover
					? {
							success: results.carryover.success,
							organizationsProcessed: results.carryover.organizationsProcessed,
							errors: results.carryover.errors.length,
						}
					: null,
				expiry: results.expiry
					? {
							success: results.expiry.success,
							organizationsProcessed: results.expiry.organizationsProcessed,
							employeesAffected: results.expiry.results.reduce(
								(sum, r) => sum + (r.expiry?.employeesAffected || 0),
								0,
							),
						}
					: null,
				accrual: results.accrual
					? {
							success: results.accrual.success,
							organizationsProcessed: results.accrual.organizationsProcessed,
							totalEmployeesProcessed: results.accrual.totalEmployeesProcessed,
							totalDaysAccrued: results.accrual.totalDaysAccrued,
						}
					: null,
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Vacation automation cron job failed");

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
 * POST /api/cron/vacation
 *
 * Run a specific vacation job manually
 * Body: { job: "carryover" | "expiry" | "accrual", year?: number, month?: number }
 */
export async function POST(request: NextRequest) {
	await connection();
	const isAuthorized = await verifyCronAuth(request);

	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { job, year, month } = body as {
			job: "carryover" | "expiry" | "accrual" | "all";
			year?: number;
			month?: number;
		};

		logger.info({ job, year, month }, "Running manual vacation job");

		let result;

		switch (job) {
			case "carryover":
				result = await runAnnualCarryover(year);
				break;
			case "expiry":
				result = await runCarryoverExpiry();
				break;
			case "accrual":
				result = await runMonthlyAccrual(month, year);
				break;
			case "all":
				result = await runVacationAutomation();
				break;
			default:
				return NextResponse.json(
					{ error: "Invalid job type. Use: carryover, expiry, accrual, or all" },
					{ status: 400 },
				);
		}

		return NextResponse.json({
			success: true,
			job,
			timestamp: new Date().toISOString(),
			result,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Manual vacation job failed");

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
