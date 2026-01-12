/**
 * Vacation Service
 *
 * Comprehensive vacation management including balance calculations,
 * carryover logic, expiry enforcement, and accrual.
 */

import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, employeeVacationAllowance } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import {
	createVacationAdjustment,
	getAdjustmentTotal,
	getCarryoverBalance,
	getEmployeesWithVacationData,
	getEmployeeVacationAllowance,
	getVacationAllowance,
	getVacationTakenInYear,
	upsertEmployeeVacationAllowance,
} from "@/lib/query/vacation.queries";
import { calculateCarryoverExpiryDate } from "./date-utils";
import type { AbsenceWithCategory, VacationBalance } from "./types";
import { calculateVacationBalance } from "./vacation-calculator";

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
 * Get enhanced vacation balance for an employee
 */
export async function getEnhancedVacationBalance(input: {
	employeeId: string;
	year: number;
	currentDate?: Date;
}): Promise<EnhancedVacationBalance | null> {
	const { employeeId, year, currentDate = new Date() } = input;

	// Get employee and organization
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return null;
	}

	// Get organization policy
	const policy = await getVacationAllowance(emp.organizationId, year);

	if (!policy) {
		logger.warn({ organizationId: emp.organizationId, year }, "No vacation policy found");
		return null;
	}

	// Get employee-specific allowance
	const empAllowance = await getEmployeeVacationAllowance(employeeId, year);

	// Get sum of adjustment events
	const adjustmentTotal = await getAdjustmentTotal(employeeId, year);

	// Get absences
	const absencesResult = await getVacationTakenInYear(employeeId, year);

	// Build absences array for calculator (simplified)
	const absences: AbsenceWithCategory[] = absencesResult.entries.map((e) => ({
		id: e.id,
		employeeId,
		startDate: e.startDate,
		startPeriod: e.startPeriod,
		endDate: e.endDate,
		endPeriod: e.endPeriod,
		status: e.status as "approved" | "pending" | "rejected",
		notes: null,
		category: {
			id: "vacation",
			name: "Vacation",
			type: "vacation",
			color: null,
			countsAgainstVacation: true,
		},
		approvedBy: null,
		approvedAt: null,
		rejectionReason: null,
		createdAt: new Date(),
	}));

	// Calculate base balance
	const baseBalance = calculateVacationBalance({
		organizationAllowance: {
			defaultAnnualDays: policy.defaultAnnualDays,
			allowCarryover: policy.allowCarryover,
			maxCarryoverDays: policy.maxCarryoverDays,
			carryoverExpiryMonths: policy.carryoverExpiryMonths,
		},
		employeeAllowance: empAllowance
			? {
					customAnnualDays: empAllowance.customAnnualDays,
					customCarryoverDays: empAllowance.customCarryoverDays,
				}
			: null,
		absences,
		currentDate,
		year,
		adjustmentTotal,
	});

	// Calculate carryover expiry details
	let carryoverExpiring = 0;
	let carryoverExpiryDaysRemaining: number | null = null;

	if (baseBalance.carryoverDays && baseBalance.carryoverDays > 0 && policy.carryoverExpiryMonths) {
		const expiryDate = calculateCarryoverExpiryDate(year, policy.carryoverExpiryMonths);
		const currentDT = DateTime.fromJSDate(currentDate);

		if (currentDT < expiryDate) {
			carryoverExpiring = baseBalance.carryoverDays;
			carryoverExpiryDaysRemaining = Math.ceil(expiryDate.diff(currentDT, "days").days);
		}
	}

	// Calculate base allowance and adjustments
	const baseAllowance = empAllowance?.customAnnualDays
		? parseFloat(empAllowance.customAnnualDays)
		: parseFloat(policy.defaultAnnualDays);

	const adjustments = adjustmentTotal;

	return {
		...baseBalance,
		baseAllowance,
		adjustments,
		carryoverExpiring,
		carryoverExpiryDaysRemaining,
		available: baseBalance.remainingDays,
	};
}

/**
 * Calculate and apply annual carryover for an organization
 */
export async function calculateAnnualCarryover(
	organizationId: string,
	fromYear: number,
	performedBy: string,
): Promise<CarryoverSummary> {
	const toYear = fromYear + 1;
	const results: CarryoverResult[] = [];
	const errors: Array<{ employeeId: string; error: string }> = [];

	logger.info({ organizationId, fromYear, toYear }, "Starting annual carryover calculation");

	// Get vacation policy for fromYear (to calculate remaining)
	const fromYearPolicy = await getVacationAllowance(organizationId, fromYear);
	const toYearPolicy = await getVacationAllowance(organizationId, toYear);

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

	for (const emp of employees) {
		try {
			// Get vacation taken in fromYear
			const vacationTaken = await getVacationTakenInYear(emp.id, fromYear);

			// Calculate total allowance for fromYear
			const baseAllowance = emp.allowance?.customAnnualDays
				? parseFloat(emp.allowance.customAnnualDays)
				: parseFloat(fromYearPolicy.defaultAnnualDays);

			// Include previous carryover if still valid
			let previousCarryover = 0;
			if (emp.allowance?.customCarryoverDays) {
				const carryoverBalance = await getCarryoverBalance(emp.id, fromYear);
				previousCarryover = carryoverBalance.balance;
			}

			const adjustments = await getAdjustmentTotal(emp.id, fromYear);

			const totalAllowance = baseAllowance + previousCarryover + adjustments;
			const remaining = Math.max(0, totalAllowance - vacationTaken.totalDays);

			// Apply carryover cap
			const maxCarryover = fromYearPolicy.maxCarryoverDays
				? parseFloat(fromYearPolicy.maxCarryoverDays)
				: remaining;

			const carryoverApplied = Math.min(remaining, maxCarryover);
			const carryoverCapped = remaining > maxCarryover;

			// Calculate expiry date
			let expiryDate: Date | null = null;
			if (toYearPolicy?.carryoverExpiryMonths) {
				const expiryDT = calculateCarryoverExpiryDate(toYear, toYearPolicy.carryoverExpiryMonths);
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
): Promise<ExpiryResult> {
	const currentYear = currentDate.getFullYear();

	logger.info({ organizationId, currentYear }, "Checking for expired carryover");

	// Get vacation policy
	const policy = await getVacationAllowance(organizationId, currentYear);

	if (!policy?.allowCarryover || !policy.carryoverExpiryMonths) {
		return { employeesAffected: 0, daysExpired: 0, details: [] };
	}

	// Calculate expiry date
	const expiryDate = calculateCarryoverExpiryDate(currentYear, policy.carryoverExpiryMonths);
	const currentDT = DateTime.fromJSDate(currentDate);

	// If expiry date hasn't passed, nothing to do
	if (currentDT < expiryDate) {
		logger.info({ expiryDate: expiryDate.toISO() }, "Carryover not yet expired");
		return { employeesAffected: 0, daysExpired: 0, details: [] };
	}

	// Get all employees with carryover
	const employees = await getEmployeesWithVacationData(organizationId, currentYear);
	const details: Array<{ employeeId: string; employeeName: string; daysExpired: number }> = [];

	for (const emp of employees) {
		if (!emp.allowance?.customCarryoverDays) continue;

		const carryoverDays = parseFloat(emp.allowance.customCarryoverDays);
		if (carryoverDays <= 0) continue;

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

		details.push({
			employeeId: emp.id,
			employeeName: emp.name,
			daysExpired: carryoverDays,
		});
	}

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
 * Accrue vacation days based on policy (monthly/biweekly)
 */
export async function accrueVacationDays(
	organizationId: string,
	month: number,
	year: number,
	performedBy: string,
): Promise<{
	employeesProcessed: number;
	totalDaysAccrued: number;
}> {
	const policy = await getVacationAllowance(organizationId, year);

	if (!policy) {
		throw new Error(`No vacation policy found for year ${year}`);
	}

	// Only process if accrual type is monthly or biweekly
	if (policy.accrualType === "annual") {
		logger.info({ organizationId }, "Accrual type is annual, skipping monthly accrual");
		return { employeesProcessed: 0, totalDaysAccrued: 0 };
	}

	const employees = await getEmployeesWithVacationData(organizationId, year);
	let totalDaysAccrued = 0;

	for (const emp of employees) {
		// Calculate monthly accrual
		const baseAllowance = emp.allowance?.customAnnualDays
			? parseFloat(emp.allowance.customAnnualDays)
			: parseFloat(policy.defaultAnnualDays);

		let monthlyAccrual: number;
		if (policy.accrualType === "monthly") {
			monthlyAccrual = baseAllowance / 12;
		} else {
			// biweekly - 26 pay periods per year
			monthlyAccrual = (baseAllowance / 26) * 2; // ~2 pay periods per month
		}

		// Handle proration for new employees
		if (emp.hireDate) {
			const hireDate = DateTime.fromJSDate(emp.hireDate);
			const accrualMonth = DateTime.utc(year, month, 1);

			// If hired after this month, no accrual
			if (hireDate > accrualMonth.endOf("month")) {
				continue;
			}

			// If hired during this month, prorate
			if (hireDate.year === year && hireDate.month === month) {
				const daysInMonth = accrualMonth.daysInMonth ?? 30;
				const daysWorked = daysInMonth - hireDate.day + 1;
				monthlyAccrual = (monthlyAccrual / daysInMonth) * daysWorked;
			}
		}

		// Create adjustment event for monthly accrual
		await createVacationAdjustment({
			employeeId: emp.id,
			year,
			days: monthlyAccrual.toFixed(2),
			reason: `Monthly accrual for ${DateTime.utc(year, month, 1).toFormat("MMMM yyyy")}: +${monthlyAccrual.toFixed(2)} days`,
			adjustedBy: performedBy,
		});

		totalDaysAccrued += monthlyAccrual;
	}

	logger.info(
		{
			organizationId,
			month,
			year,
			employeesProcessed: employees.length,
			totalDaysAccrued,
		},
		"Monthly accrual complete",
	);

	return {
		employeesProcessed: employees.length,
		totalDaysAccrued,
	};
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
	const employees = await getEmployeesWithVacationData(organizationId, year);
	const results = [];

	for (const emp of employees) {
		const balance = await getEnhancedVacationBalance({
			employeeId: emp.id,
			year,
		});

		if (balance) {
			results.push({
				employeeId: emp.id,
				employeeName: emp.name,
				totalAllowance: balance.totalDays,
				carryover: balance.carryoverDays || 0,
				adjustments: balance.adjustments,
				used: balance.usedDays,
				pending: balance.pendingDays,
				remaining: balance.remainingDays,
				carryoverExpiryDate: balance.carryoverExpiryDate || null,
			});
		}
	}

	return results;
}
