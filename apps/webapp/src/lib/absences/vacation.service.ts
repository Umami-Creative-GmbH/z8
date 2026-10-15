/**
 * Vacation Service
 *
 * Comprehensive vacation management including balance calculations,
 * carryover logic, expiry enforcement, and accrual.
 */

import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, employeeVacationAllowance } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import {
	createVacationAdjustment,
	getCarryoverBalance,
	getEmployeesWithVacationData,
	getEmployeeVacationAllowance,
	getVacationAllowance,
	getVacationTakenInYear,
	upsertEmployeeVacationAllowance,
} from "@/lib/query/vacation.queries";
import { calculateCarryoverExpiryDate } from "./date-utils";
import { loadProratedVacationAllowances } from "./prorated-allowance-store";
import type { VacationBalance } from "./types";
import {
	loadVacationAdjustmentSums,
	type VacationAdjustmentSums,
	vacationAdjustmentTotal,
} from "./vacation-adjustments";
import { loadVacationBalances } from "./vacation-balance-store";
import { startingAllowanceDays } from "./vacation-calculator";
import type { VacationPolicy } from "./vacation-policy-store";

const logger = createLogger("vacation-service");

export interface EnhancedVacationBalance extends VacationBalance {
	baseAllowance: number;
	adjustments: number;
	carryoverExpiring: number;
	carryoverExpiryDaysRemaining: number | null;
	available: number;
}

export interface CarryoverResult {
	employeeId: string;
	employeeName: string;
	previousYearRemaining: number;
	carryoverApplied: number;
	carryoverCapped: boolean;
	expiryDate: Date | null;
}

export interface CarryoverSummary {
	organizationId: string;
	fromYear: number;
	toYear: number;
	processedAt: Date;
	employeesProcessed: number;
	totalDaysCarriedOver: number;
	results: CarryoverResult[];
	errors: Array<{ employeeId: string; error: string }>;
}

export interface ExpiryResult {
	employeesAffected: number;
	daysExpired: number;
	details: Array<{
		employeeId: string;
		employeeName: string;
		daysExpired: number;
	}>;
}

/**
 * An employee's vacation balance for a year with its parts, for the dashboard and the reports:
 * the same balance as every other reader (`loadVacationBalances`). Null without a company default
 * policy for the year or for an unknown employee.
 */
export async function getEnhancedVacationBalance(input: {
	employeeId: string;
	year: number;
	currentDate?: Date;
	timezone?: string;
}): Promise<EnhancedVacationBalance | null> {
	const { employeeId, year, currentDate = new Date(), timezone = "UTC" } = input;

	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
		columns: { organizationId: true },
	});
	if (!emp) {
		return null;
	}

	const { policy, balances, adjustments } = await loadVacationBalances(db, {
		organizationId: emp.organizationId,
		employeeIds: [employeeId],
		year,
		timezone,
		currentDate,
	});
	if (!policy) {
		logger.warn({ organizationId: emp.organizationId, year }, "No vacation policy found");
		return null;
	}
	const balance = balances.get(employeeId);
	if (!balance) return null;

	return enhanceVacationBalance({
		balance,
		policy,
		adjustments: adjustments.get(employeeId),
		currentDate,
		timezone,
	});
}

function enhanceVacationBalance(input: {
	balance: VacationBalance;
	policy: VacationPolicy;
	adjustments: VacationAdjustmentSums | undefined;
	currentDate: Date;
	timezone: string;
}): EnhancedVacationBalance {
	const { balance, policy, timezone } = input;

	// Calculate carryover expiry details
	let carryoverExpiring = 0;
	let carryoverExpiryDaysRemaining: number | null = null;

	if (balance.carryoverDays && balance.carryoverDays > 0 && policy.carryoverExpiryMonths) {
		const expiryDate = calculateCarryoverExpiryDate(
			balance.year,
			policy.carryoverExpiryMonths,
			timezone,
		);
		const currentDT = DateTime.fromJSDate(input.currentDate).setZone(timezone);

		if (currentDT < expiryDate) {
			carryoverExpiring = balance.carryoverDays;
			carryoverExpiryDaysRemaining = Math.ceil(expiryDate.diff(currentDT, "days").days);
		}
	}

	return {
		...balance,
		baseAllowance: balance.allowanceDays,
		adjustments: vacationAdjustmentTotal(input.adjustments),
		carryoverExpiring,
		carryoverExpiryDaysRemaining,
		available: balance.remainingDays,
	};
}

/**
 * Calculate and apply annual carryover for an organization
 */
export async function calculateAnnualCarryover(
	organizationId: string,
	fromYear: number,
	performedBy: string,
	timezone = "UTC",
): Promise<CarryoverSummary> {
	const toYear = fromYear + 1;
	const results: CarryoverResult[] = [];
	const errors: Array<{ employeeId: string; error: string }> = [];

	logger.info({ organizationId, fromYear, toYear }, "Starting annual carryover calculation");

	// Get vacation policies for both years independently.
	const [fromYearPolicy, toYearPolicy] = await Promise.all([
		getVacationAllowance(organizationId, fromYear),
		getVacationAllowance(organizationId, toYear),
	]);

	if (!fromYearPolicy) {
		throw new Error(`No vacation policy found for year ${fromYear}`);
	}

	if (!fromYearPolicy.allowCarryover) {
		logger.info({ organizationId }, "Carryover not allowed by policy");
		return {
			organizationId,
			fromYear,
			toYear,
			processedAt: new Date(),
			employeesProcessed: 0,
			totalDaysCarriedOver: 0,
			results: [],
			errors: [],
		};
	}

	// Get all employees with vacation data
	const employees = await getEmployeesWithVacationData(organizationId, fromYear);
	// The fromYear allowance of each employee, prorated in a start or exit year (#1110), and
	// their adjustments, manual and accrual (#1105, #1106)
	const employeeIds = employees.map((emp) => emp.id);
	const [allowances, adjustmentSums] = await Promise.all([
		loadProratedVacationAllowances(db, {
			organizationId,
			employeeIds,
			year: fromYear,
			policy: fromYearPolicy,
		}),
		loadVacationAdjustmentSums(db, { organizationId, employeeIds, year: fromYear }),
	]);

	for (const emp of employees) {
		try {
			// Get vacation taken in fromYear
			const vacationTaken = await getVacationTakenInYear(emp.id, fromYear);

			// The (prorated) allowance for fromYear, or 0 on an accrual policy, whose accrual
			// adjustments below carry it (#1106)
			const baseAllowance = startingAllowanceDays({
				policy: fromYearPolicy,
				allowance: allowances.get(emp.id),
				employeeAllowance: emp.allowance,
			});

			// Include previous carryover if still valid
			let previousCarryover = 0;
			if (emp.allowance?.customCarryoverDays) {
				const carryoverBalance = await getCarryoverBalance(emp.id, fromYear, undefined, timezone);
				previousCarryover = carryoverBalance.balance;
			}

			const adjustments = vacationAdjustmentTotal(adjustmentSums.get(emp.id));

			const totalAllowance = baseAllowance + previousCarryover + adjustments;
			const remaining = Math.max(
				0,
				totalAllowance -
					vacationTaken.totalDays -
					(adjustmentSums.get(emp.id)?.previouslyTaken ?? 0),
			);

			// Apply carryover cap
			const maxCarryover = fromYearPolicy.maxCarryoverDays
				? parseFloat(fromYearPolicy.maxCarryoverDays)
				: remaining;

			const carryoverApplied = Math.min(remaining, maxCarryover);
			const carryoverCapped = remaining > maxCarryover;

			// Calculate expiry date
			let expiryDate: Date | null = null;
			if (toYearPolicy?.carryoverExpiryMonths) {
				const expiryDT = calculateCarryoverExpiryDate(
					toYear,
					toYearPolicy.carryoverExpiryMonths,
					timezone,
				);
				expiryDate = expiryDT.toJSDate();
			}

			// Store carryover in new year's allowance
			if (carryoverApplied > 0) {
				await upsertEmployeeVacationAllowance({
					employeeId: emp.id,
					year: toYear,
					customCarryoverDays: carryoverApplied,
				});

				// Log to audit
				await logAudit({
					action: AuditAction.VACATION_CARRYOVER_APPLIED,
					actorId: performedBy,
					targetId: emp.id,
					targetType: "employee",
					organizationId,
					employeeId: emp.id,
					timestamp: new Date(),
					metadata: {
						fromYear,
						toYear,
						remaining,
						carryoverApplied,
						carryoverCapped,
						expiryDate: expiryDate?.toISOString(),
					},
				});
			}

			results.push({
				employeeId: emp.id,
				employeeName: emp.name,
				previousYearRemaining: remaining,
				carryoverApplied,
				carryoverCapped,
				expiryDate,
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			logger.error({ employeeId: emp.id, error: errorMessage }, "Failed to process carryover");
			errors.push({ employeeId: emp.id, error: errorMessage });
		}
	}

	const summary: CarryoverSummary = {
		organizationId,
		fromYear,
		toYear,
		processedAt: new Date(),
		employeesProcessed: results.length,
		totalDaysCarriedOver: results.reduce((sum, r) => sum + r.carryoverApplied, 0),
		results,
		errors,
	};

	logger.info(
		{
			organizationId,
			employeesProcessed: summary.employeesProcessed,
			totalDaysCarriedOver: summary.totalDaysCarriedOver,
			errors: errors.length,
		},
		"Annual carryover calculation complete",
	);

	return summary;
}

/**
 * Expire carryover days that have passed their expiry date
 */
export async function expireCarryoverDays(
	organizationId: string,
	performedBy: string,
	currentDate: Date = new Date(),
	timezone = "UTC",
): Promise<ExpiryResult> {
	const currentYear = DateTime.fromJSDate(currentDate).setZone(timezone).year;

	logger.info({ organizationId, currentYear }, "Checking for expired carryover");

	// Get vacation policy
	const policy = await getVacationAllowance(organizationId, currentYear);

	if (!policy?.allowCarryover || !policy.carryoverExpiryMonths) {
		return { employeesAffected: 0, daysExpired: 0, details: [] };
	}

	// Calculate expiry date
	const expiryDate = calculateCarryoverExpiryDate(
		currentYear,
		policy.carryoverExpiryMonths,
		timezone,
	);
	const currentDT = DateTime.fromJSDate(currentDate).setZone(timezone);

	// If expiry date hasn't passed, nothing to do
	if (currentDT < expiryDate) {
		logger.info({ expiryDate: expiryDate.toISO() }, "Carryover not yet expired");
		return { employeesAffected: 0, daysExpired: 0, details: [] };
	}

	// Get all employees with carryover
	const employees = await getEmployeesWithVacationData(organizationId, currentYear);
	const details = (
		await Promise.all(
			employees.map(async (emp) => {
				if (!emp.allowance?.customCarryoverDays) return null;

				const carryoverDays = parseFloat(emp.allowance.customCarryoverDays);
				if (carryoverDays <= 0) return null;

				// Set carryover to 0 (expired)
				await db
					.update(employeeVacationAllowance)
					.set({
						customCarryoverDays: "0",
					})
					.where(eq(employeeVacationAllowance.id, emp.allowance.id));

				// Log to audit
				await logAudit({
					action: AuditAction.VACATION_CARRYOVER_EXPIRED,
					actorId: performedBy,
					targetId: emp.id,
					targetType: "employee",
					organizationId,
					employeeId: emp.id,
					timestamp: new Date(),
					metadata: {
						year: currentYear,
						daysExpired: carryoverDays,
						expiryDate: expiryDate.toISO(),
					},
				});

				return {
					employeeId: emp.id,
					employeeName: emp.name,
					daysExpired: carryoverDays,
				};
			}),
		)
	).filter(
		(
			detail,
		): detail is {
			employeeId: string;
			employeeName: string;
			daysExpired: number;
		} => detail !== null,
	);

	const result: ExpiryResult = {
		employeesAffected: details.length,
		daysExpired: details.reduce((sum, d) => sum + d.daysExpired, 0),
		details,
	};

	logger.info(
		{
			organizationId,
			employeesAffected: result.employeesAffected,
			daysExpired: result.daysExpired,
		},
		"Carryover expiry complete",
	);

	return result;
}

/**
 * Update vacation allowance manually (admin adjustment)
 */
export async function updateVacationAllowance(input: {
	employeeId: string;
	year: number;
	customAnnualDays?: number;
	adjustmentDays?: number;
	adjustmentReason?: string;
	performedBy: string;
	organizationId: string;
}): Promise<void> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, input.employeeId),
	});

	if (!emp) {
		throw new Error("Employee not found");
	}

	const existing = await getEmployeeVacationAllowance(input.employeeId, input.year);

	// Update base allowance if customAnnualDays provided
	if (input.customAnnualDays !== undefined) {
		await upsertEmployeeVacationAllowance({
			employeeId: input.employeeId,
			year: input.year,
			customAnnualDays: input.customAnnualDays,
		});
	}

	// Create adjustment event if adjustment provided
	if (input.adjustmentDays !== undefined && input.adjustmentReason) {
		await createVacationAdjustment({
			employeeId: input.employeeId,
			year: input.year,
			days: input.adjustmentDays.toString(),
			reason: input.adjustmentReason,
			kind: "manual",
			adjustedBy: input.performedBy,
		});
	}

	// Log to audit
	await logAudit({
		action: AuditAction.VACATION_ALLOWANCE_UPDATED,
		actorId: input.performedBy,
		targetId: input.employeeId,
		targetType: "vacation",
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		timestamp: new Date(),
		changes: {
			before: existing
				? {
						customAnnualDays: existing.customAnnualDays,
					}
				: null,
			after: {
				customAnnualDays: input.customAnnualDays?.toString(),
				adjustmentDays: input.adjustmentDays?.toString(),
			},
		},
		metadata: {
			reason: input.adjustmentReason,
			year: input.year,
		},
	});

	logger.info(
		{
			employeeId: input.employeeId,
			year: input.year,
			performedBy: input.performedBy,
		},
		"Vacation allowance updated",
	);
}

/**
 * Get vacation summary for multiple employees (for reports)
 */
export async function getVacationSummary(
	organizationId: string,
	year: number,
): Promise<
	Array<{
		employeeId: string;
		employeeName: string;
		totalAllowance: number;
		carryover: number;
		adjustments: number;
		used: number;
		pending: number;
		remaining: number;
		carryoverExpiryDate: Date | null;
	}>
> {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});
	const timezone = org?.timezone || "UTC";
	const employees = await getEmployeesWithVacationData(organizationId, year);
	const { balances, adjustments } = await loadVacationBalances(db, {
		organizationId,
		employeeIds: employees.map((emp) => emp.id),
		year,
		timezone,
	});

	return employees.flatMap((emp) => {
		const balance = balances.get(emp.id);
		if (!balance) return [];
		return [
			{
				employeeId: emp.id,
				employeeName: emp.name,
				totalAllowance: balance.totalDays,
				carryover: balance.carryoverDays || 0,
				adjustments: vacationAdjustmentTotal(adjustments.get(emp.id)),
				used: balance.usedDays,
				pending: balance.pendingDays,
				remaining: balance.remainingDays,
				carryoverExpiryDate: balance.carryoverExpiryDate || null,
			},
		];
	});
}
