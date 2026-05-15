/**
 * Carryover Automation Job
 *
 * Scheduled job for processing vacation carryover and expiry.
 * Designed to run via cron (Vercel Cron, external scheduler, etc.)
 */

import { DateTime } from "luxon";
import { db } from "@/db";
import {
	accrueVacationDays,
	type CarryoverSummary,
	calculateAnnualCarryover,
	type ExpiryResult,
	expireCarryoverDays,
} from "@/lib/absences/vacation.service";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import { getVacationAllowance } from "@/lib/query/vacation.queries";

const logger = createLogger("carryover-automation");

// System user ID for automated operations
const SYSTEM_USER_ID = "system-automation";

export interface CarryoverJobResult {
	success: boolean;
	startedAt: Date;
	completedAt: Date;
	organizationsProcessed: number;
	results: {
		organizationId: string;
		organizationName: string;
		carryover?: CarryoverSummary;
		expiry?: ExpiryResult;
		error?: string;
	}[];
	errors: string[];
}

export interface AccrualJobResult {
	success: boolean;
	startedAt: Date;
	completedAt: Date;
	month: number;
	year: number;
	organizationsProcessed: number;
	totalEmployeesProcessed: number;
	totalDaysAccrued: number;
	errors: string[];
}

/**
 * Run annual carryover for all organizations
	 * Should be scheduled to run on January 1st
 */
export async function runAnnualCarryover(targetYear?: number): Promise<CarryoverJobResult> {
	const startedAt = new Date();
	const currentDate = DateTime.fromJSDate(startedAt);
	const fromYear = targetYear;

	logger.info({ fromYear }, "Starting annual carryover job");

	const results: CarryoverJobResult["results"] = [];
	const errors: string[] = [];

	try {
		// Get all organizations
		const organizations = await db.query.organization.findMany();

		for (const org of organizations) {
			try {
				const timezone = org.timezone || "UTC";
				const zonedCurrentDate = currentDate.setZone(timezone);
				const isCalendarYearStart = zonedCurrentDate.month === 1 && zonedCurrentDate.day === 1;
				const organizationFromYear = fromYear ?? zonedCurrentDate.year - 1;
				logger.info(
					{ organizationId: org.id, organizationName: org.name },
					"Processing organization",
				);

				if (!fromYear && !isCalendarYearStart) {
					logger.info(
						{ organizationId: org.id },
						"Carryover not due for organization",
					);
					continue;
				}

				// Check if organization has a vacation policy
				const policy = await getVacationAllowance(org.id, organizationFromYear);

				if (!policy) {
					logger.info({ organizationId: org.id }, "No vacation policy found, skipping");
					results.push({
						organizationId: org.id,
						organizationName: org.name,
						error: "No vacation policy found",
					});
					continue;
				}

				if (!policy.allowCarryover) {
					logger.info({ organizationId: org.id }, "Carryover not allowed by policy, skipping");
					results.push({
						organizationId: org.id,
						organizationName: org.name,
						error: "Carryover not allowed by policy",
					});
					continue;
				}

				// Run carryover calculation
				const carryoverResult = await calculateAnnualCarryover(
					org.id,
					organizationFromYear,
					SYSTEM_USER_ID,
					timezone,
				);

				results.push({
					organizationId: org.id,
					organizationName: org.name,
					carryover: carryoverResult,
				});
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				logger.error(
					{ organizationId: org.id, error: errorMessage },
					"Failed to process organization",
				);
				errors.push(`${org.name}: ${errorMessage}`);
				results.push({
					organizationId: org.id,
					organizationName: org.name,
					error: errorMessage,
				});
			}
		}

		const completedAt = new Date();

		// Log job completion to audit
		await logAudit({
			action: AuditAction.TIME_ENTRY_CHAIN_VERIFIED, // Using existing action for system jobs
			actorId: SYSTEM_USER_ID,
			organizationId: "system",
			timestamp: completedAt,
			metadata: {
				jobType: "annual_carryover",
				fromYear: fromYear ?? null,
				organizationsProcessed: organizations.length,
				successCount: results.filter((r) => !r.error).length,
				errorCount: errors.length,
				duration: completedAt.getTime() - startedAt.getTime(),
			},
		});

		return {
			success: errors.length === 0,
			startedAt,
			completedAt,
			organizationsProcessed: organizations.length,
			results,
			errors,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Annual carryover job failed");

		return {
			success: false,
			startedAt,
			completedAt: new Date(),
			organizationsProcessed: 0,
			results,
			errors: [errorMessage],
		};
	}
}

/**
 * Run carryover expiry check for all organizations
 * Should be scheduled to run daily or weekly
 */
export async function runCarryoverExpiry(): Promise<CarryoverJobResult> {
	const startedAt = new Date();
	const currentDate = new Date();

	logger.info("Starting carryover expiry job");

	const results: CarryoverJobResult["results"] = [];
	const errors: string[] = [];

	try {
		const organizations = await db.query.organization.findMany();

		for (const org of organizations) {
			try {
				const timezone = org.timezone || "UTC";
				const orgCurrentDate = DateTime.fromJSDate(currentDate).setZone(timezone).toJSDate();
				const expiryResult = await expireCarryoverDays(
					org.id,
					SYSTEM_USER_ID,
					orgCurrentDate,
					timezone,
				);

				if (expiryResult.employeesAffected > 0) {
					results.push({
						organizationId: org.id,
						organizationName: org.name,
						expiry: expiryResult,
					});
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				logger.error({ organizationId: org.id, error: errorMessage }, "Failed to process expiry");
				errors.push(`${org.name}: ${errorMessage}`);
			}
		}

		const completedAt = new Date();

		return {
			success: errors.length === 0,
			startedAt,
			completedAt,
			organizationsProcessed: organizations.length,
			results,
			errors,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Carryover expiry job failed");

		return {
			success: false,
			startedAt,
			completedAt: new Date(),
			organizationsProcessed: 0,
			results,
			errors: [errorMessage],
		};
	}
}

/**
 * Run monthly vacation accrual for all organizations
 * Should be scheduled to run on the 1st of each month
 */
export async function runMonthlyAccrual(month?: number, year?: number): Promise<AccrualJobResult> {
	const startedAt = new Date();
	const fallbackDate = DateTime.fromJSDate(startedAt).setZone("UTC");
	let resultMonth = month ?? fallbackDate.month;
	let resultYear = year ?? fallbackDate.year;

	logger.info({ month: month ?? null, year: year ?? null }, "Starting monthly accrual job");

	const errors: string[] = [];
	let totalEmployeesProcessed = 0;
	let totalDaysAccrued = 0;
	let organizationsProcessed = 0;

	try {
		const organizations = await db.query.organization.findMany();

		for (const org of organizations) {
			try {
				const timezone = org.timezone || "UTC";
				const zonedDate = DateTime.fromJSDate(startedAt).setZone(timezone);
				const targetMonth = month ?? zonedDate.month;
				const targetYear = year ?? zonedDate.year;
				const isImplicitScheduledRun = month === undefined && year === undefined;

				if (isImplicitScheduledRun && zonedDate.day !== 1) {
					continue;
				}

				// For implicit per-organization dates, report the first organization as the job summary.
				if (organizationsProcessed === 0 && errors.length === 0) {
					resultMonth = targetMonth;
					resultYear = targetYear;
				}

				// Check if organization uses monthly/biweekly accrual
				const policy = await getVacationAllowance(org.id, targetYear);

				if (!policy || policy.accrualType === "annual") {
					continue;
				}

				const result = await accrueVacationDays(
					org.id,
					targetMonth,
					targetYear,
					SYSTEM_USER_ID,
					timezone,
				);

				totalEmployeesProcessed += result.employeesProcessed;
				totalDaysAccrued += result.totalDaysAccrued;
				organizationsProcessed++;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				logger.error({ organizationId: org.id, error: errorMessage }, "Failed to process accrual");
				errors.push(`${org.name}: ${errorMessage}`);
			}
		}

		const completedAt = new Date();

		return {
			success: errors.length === 0,
			startedAt,
			completedAt,
			month: resultMonth,
			year: resultYear,
			organizationsProcessed,
			totalEmployeesProcessed,
			totalDaysAccrued,
			errors,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Monthly accrual job failed");

		return {
			success: false,
			startedAt,
			completedAt: new Date(),
			month: resultMonth,
			year: resultYear,
			organizationsProcessed: 0,
			totalEmployeesProcessed: 0,
			totalDaysAccrued: 0,
			errors: [errorMessage],
		};
	}
}

/**
 * Combined job that runs all vacation-related automations
 * Can be called from a single cron endpoint
 */
export async function runVacationAutomation(): Promise<{
	carryover?: CarryoverJobResult;
	expiry?: CarryoverJobResult;
	accrual?: AccrualJobResult;
}> {
	const results: {
		carryover?: CarryoverJobResult;
		expiry?: CarryoverJobResult;
		accrual?: AccrualJobResult;
	} = {};

	// Run annual carryover daily; January 1 gating decides due orgs.
	results.carryover = await runAnnualCarryover();

	// Run expiry check daily
	results.expiry = await runCarryoverExpiry();

	// Run daily; runMonthlyAccrual gates implicit scheduled work per organization timezone.
	results.accrual = await runMonthlyAccrual();

	return results;
}
