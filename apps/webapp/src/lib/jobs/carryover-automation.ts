/**
 * Carryover Automation Job
 *
 * Scheduled job for processing vacation carryover and expiry.
 * Designed to run via cron (Vercel Cron, external scheduler, etc.)
 */

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
 * Should be scheduled to run on January 1st or the organization's fiscal year start
 */
export async function runAnnualCarryover(targetYear?: number): Promise<CarryoverJobResult> {
	const startedAt = new Date();
	const fromYear = targetYear ?? new Date().getFullYear() - 1;

	logger.info({ fromYear }, "Starting annual carryover job");

	const results: CarryoverJobResult["results"] = [];
	const errors: string[] = [];

	try {
		// Get all organizations
		const organizations = await db.query.organization.findMany();

		for (const org of organizations) {
			try {
				logger.info(
					{ organizationId: org.id, organizationName: org.name },
					"Processing organization",
				);

				// Check if organization has a vacation policy
				const policy = await getVacationAllowance(org.id, fromYear);

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
				const carryoverResult = await calculateAnnualCarryover(org.id, fromYear, SYSTEM_USER_ID);

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
				fromYear,
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
				const expiryResult = await expireCarryoverDays(org.id, SYSTEM_USER_ID, currentDate);

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
	const targetMonth = month ?? new Date().getMonth() + 1;
	const targetYear = year ?? new Date().getFullYear();

	logger.info({ month: targetMonth, year: targetYear }, "Starting monthly accrual job");

	const errors: string[] = [];
	let totalEmployeesProcessed = 0;
	let totalDaysAccrued = 0;
	let organizationsProcessed = 0;

	try {
		const organizations = await db.query.organization.findMany();

		for (const org of organizations) {
			try {
				// Check if organization uses monthly/biweekly accrual
				const policy = await getVacationAllowance(org.id, targetYear);

				if (!policy || policy.accrualType === "annual") {
					continue;
				}

				const result = await accrueVacationDays(org.id, targetMonth, targetYear, SYSTEM_USER_ID);

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
			month: targetMonth,
			year: targetYear,
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
			month: targetMonth,
			year: targetYear,
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
	const currentDate = new Date();
	const currentMonth = currentDate.getMonth() + 1;
	const currentDay = currentDate.getDate();
	const currentYear = currentDate.getFullYear();

	const results: {
		carryover?: CarryoverJobResult;
		expiry?: CarryoverJobResult;
		accrual?: AccrualJobResult;
	} = {};

	// Run annual carryover on January 1st
	if (currentMonth === 1 && currentDay === 1) {
		logger.info("Running annual carryover (January 1st)");
		results.carryover = await runAnnualCarryover(currentYear - 1);
	}

	// Run expiry check daily
	results.expiry = await runCarryoverExpiry();

	// Run monthly accrual on the 1st of each month
	if (currentDay === 1) {
		logger.info({ month: currentMonth }, "Running monthly accrual");
		results.accrual = await runMonthlyAccrual(currentMonth, currentYear);
	}

	return results;
}
