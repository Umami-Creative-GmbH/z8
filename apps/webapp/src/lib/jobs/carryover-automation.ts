/**
 * Carryover Automation Job
 *
 * Scheduled job for processing vacation carryover and expiry.
 * Designed to run via cron (Vercel Cron, external scheduler, etc.)
 */

import { db } from "@/db";
import type { VacationBalanceConfiguration } from "@/lib/absences/types";
import {
	type CarryoverSummary,
	calculateAnnualCarryover,
	type ExpiryResult,
	expireCarryoverDays,
} from "@/lib/absences/vacation.service";
import {
	accrueDueVacationPeriods,
	accrueVacationPeriods,
} from "@/lib/absences/vacation-accrual";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";

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
	skippedEmployees: Array<{
		organizationId: string;
		employeeId: string;
		configuration: VacationBalanceConfiguration;
	}>;
	errors: string[];
}

/**
 * Run annual carryover for all organizations
 * Should be scheduled to run on January 1st
 */
export async function runAnnualCarryover(
	targetYear?: number,
): Promise<CarryoverJobResult> {
	const startedAt = new Date();
	const currentDate = instantFromDate(startedAt);
	const fromYear = targetYear;

	logger.info({ fromYear }, "Starting annual carryover job");

	const results: CarryoverJobResult["results"] = [];
	const errors: string[] = [];

	try {
		// Get all organizations
		const organizations = await db.query.organization.findMany();

		const organizationResults = await Promise.all(
			organizations.map(async (org) => {
				try {
					const timezone = org.timezone || "UTC";
					const zonedCurrentDate = currentDate.toZonedDateTimeISO(timezone);
					const isCalendarYearStart =
						zonedCurrentDate.month === 1 && zonedCurrentDate.day === 1;
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
						return null;
					}

					// Resolve carryover terms independently for each employee in the service.
					// Run carryover calculation
					const carryoverResult = await calculateAnnualCarryover(
						org.id,
						organizationFromYear,
						SYSTEM_USER_ID,
						timezone,
					);

					return {
						result: {
							organizationId: org.id,
							organizationName: org.name,
							carryover: carryoverResult,
						},
					};
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : "Unknown error";
					logger.error(
						{ organizationId: org.id, error: errorMessage },
						"Failed to process organization",
					);
					return {
						error: `${org.name}: ${errorMessage}`,
						result: {
							organizationId: org.id,
							organizationName: org.name,
							error: errorMessage,
						},
					};
				}
			}),
		);

		for (const organizationResult of organizationResults) {
			if (!organizationResult) continue;
			if (organizationResult.error) {
				errors.push(organizationResult.error);
			}
			results.push(organizationResult.result);
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
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
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

		const organizationResults = await Promise.all(
			organizations.map(async (org) => {
				try {
					const timezone = org.timezone || "UTC";
					const orgCurrentDate = currentDate;
					const expiryResult = await expireCarryoverDays(
						org.id,
						SYSTEM_USER_ID,
						orgCurrentDate,
						timezone,
					);

					if (expiryResult.employeesAffected > 0) {
						return {
							result: {
								organizationId: org.id,
								organizationName: org.name,
								expiry: expiryResult,
							},
						};
					}

					return null;
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : "Unknown error";
					logger.error(
						{ organizationId: org.id, error: errorMessage },
						"Failed to process expiry",
					);
					return { error: `${org.name}: ${errorMessage}` };
				}
			}),
		);

		for (const organizationResult of organizationResults) {
			if (!organizationResult) continue;
			if (organizationResult.error) {
				errors.push(organizationResult.error);
			}
			if (organizationResult.result) {
				results.push(organizationResult.result);
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
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
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
 * Run monthly or biweekly accrual using each employee's effective vacation policy.
 *
 * The scheduled run (no arguments) runs daily and accrues every month of each organization's
 * current year up to and including the current month in its timezone. Months already accrued are
 * skipped, so it accrues a new month on its first day and catches up any month an earlier run
 * missed, from 2026 on (#1106). An explicit month and year accrue just that month, also only once.
 */
export async function runMonthlyAccrual(
	month?: number,
	year?: number,
): Promise<AccrualJobResult> {
	const startedAt = new Date();
	const fallbackDate = instantFromDate(startedAt).toZonedDateTimeISO("UTC");
	let resultMonth = month ?? fallbackDate.month;
	let resultYear = year ?? fallbackDate.year;

	logger.info(
		{ month: month ?? null, year: year ?? null },
		"Starting monthly accrual job",
	);

	const errors: string[] = [];
	const skippedEmployees: AccrualJobResult["skippedEmployees"] = [];
	let totalEmployeesProcessed = 0;
	let totalDaysAccrued = 0;
	let organizationsProcessed = 0;

	try {
		const organizations = await db.query.organization.findMany();

		for (const org of organizations) {
			try {
				const timezone = org.timezone || "UTC";
				const zonedDate =
					instantFromDate(startedAt).toZonedDateTimeISO(timezone);
				const targetMonth = month ?? zonedDate.month;
				const targetYear = year ?? zonedDate.year;
				const isImplicitScheduledRun =
					month === undefined && year === undefined;

				// For implicit per-organization dates, report the first organization as the job summary.
				if (organizationsProcessed === 0 && errors.length === 0) {
					resultMonth = targetMonth;
					resultYear = targetYear;
				}

				// Employee-effective policies determine posting eligibility inside the accrual service.
				// Accrual rows are system rows without an adjusting employee, one per month (#1106).
				const result = isImplicitScheduledRun
					? await accrueDueVacationPeriods(org.id, {
							timezone,
							now: instantFromDate(startedAt),
						})
					: await accrueVacationPeriods(org.id, {
							year: targetYear,
							months: [targetMonth],
						});

				skippedEmployees.push(
					...result.skippedEmployees.map((employee) => ({
						organizationId: org.id,
						...employee,
					})),
				);
				totalEmployeesProcessed += result.employeesProcessed;
				totalDaysAccrued += result.totalDaysAccrued;
				organizationsProcessed++;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				logger.error(
					{ organizationId: org.id, error: errorMessage },
					"Failed to process accrual",
				);
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
			skippedEmployees,
			errors,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
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
			skippedEmployees,
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
