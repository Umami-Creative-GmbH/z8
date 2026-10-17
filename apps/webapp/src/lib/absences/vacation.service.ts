/**
 * Vacation Service
 *
 * Comprehensive vacation management including balance calculations,
 * carryover logic, expiry enforcement, and accrual.
 */

import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee } from "@/db/schema";
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
import type { VacationBalance, VacationBalanceConfiguration } from "./types";
import {
	loadVacationAdjustmentSums,
	type VacationAdjustmentSums,
	vacationAdjustmentTotal,
} from "./vacation-adjustments";
import { loadVacationBalances } from "./vacation-balance-store";
import {
	calculateCarryoverDays,
	startingAllowanceDays,
} from "./vacation-calculator";
import {
	commitAnnualVacationCarryover,
	expireCommittedVacationCarryover,
} from "./vacation-carryover";
import { vacationPolicyCalculationsEnabled } from "./vacation-policy-rollout";

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
	errors: Array<{
		employeeId: string;
		error: string;
		configuration?: VacationBalanceConfiguration;
	}>;
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
 * the same balance as every other reader (`loadVacationBalances`). Null for unavailable policy
 * coverage or an unknown employee; the companion result exposes configuration details.
 */
export async function getEnhancedVacationBalance(input: {
	employeeId: string;
	year: number;
	currentDate?: Date;
	timezone?: string;
	organizationId?: string;
}): Promise<EnhancedVacationBalance | null> {
	return (await getEnhancedVacationBalanceResult(input)).balance;
}

/** A visible configuration result accompanies unavailable balances; callers retain actor scope. */
export async function getEnhancedVacationBalanceResult(input: {
	employeeId: string;
	year: number;
	currentDate?: Date;
	timezone?: string;
	organizationId?: string;
}): Promise<{
	balance: EnhancedVacationBalance | null;
	configuration: VacationBalanceConfiguration | null;
}> {
	const {
		employeeId,
		year,
		currentDate = new Date(),
		timezone = "UTC",
	} = input;
	const emp = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, employeeId),
			input.organizationId
				? eq(employee.organizationId, input.organizationId)
				: undefined,
		),
		columns: { organizationId: true },
	});
	if (!emp) return { balance: null, configuration: null };
	const result = await loadVacationBalances(db, {
		organizationId: emp.organizationId,
		employeeIds: [employeeId],
		year,
		timezone,
		currentDate,
	});
	const balance = result.balances.get(employeeId);
	return {
		balance: balance
			? enhanceVacationBalance({
					balance,
					adjustments: result.adjustments.get(employeeId),
					currentDate,
					timezone,
				})
			: null,
		configuration: result.configurations.get(employeeId) ?? null,
	};
}

function enhanceVacationBalance(input: {
	balance: VacationBalance;
	adjustments: VacationAdjustmentSums | undefined;
	currentDate: Date;
	timezone: string;
}): EnhancedVacationBalance {
	const { balance } = input;
	let carryoverExpiring = 0;
	let carryoverExpiryDaysRemaining: number | null = null;
	if (
		balance.carryoverDays &&
		balance.carryoverDays > 0 &&
		balance.carryoverExpiryDate
	) {
		const expiry = Temporal.Instant.from(
			balance.carryoverExpiryDate.toISOString(),
		);
		const current = Temporal.Instant.from(input.currentDate.toISOString());
		if (Temporal.Instant.compare(current, expiry) <= 0) {
			carryoverExpiring = balance.carryoverDays;
			const expiryTimezone = balance.carryoverExpiryTimezone ?? input.timezone;
			const from = current.toZonedDateTimeISO(expiryTimezone);
			carryoverExpiryDaysRemaining = Math.ceil(
				from
					.until(expiry.toZonedDateTimeISO(expiryTimezone))
					.total({ unit: "days", relativeTo: from }),
			);
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
	if (await vacationPolicyCalculationsEnabled(db, organizationId, fromYear))
		return commitAnnualVacationCarryover(
			organizationId,
			fromYear,
			performedBy,
			timezone,
		);
	const toYear = fromYear + 1;
	const results: CarryoverResult[] = [];
	const errors: Array<{ employeeId: string; error: string }> = [];

	logger.info(
		{ organizationId, fromYear, toYear },
		"Starting annual carryover calculation",
	);

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
	const employees = await getEmployeesWithVacationData(
		organizationId,
		fromYear,
	);
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
		loadVacationAdjustmentSums(db, {
			organizationId,
			employeeIds,
			year: fromYear,
		}),
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
				const carryoverBalance = await getCarryoverBalance(
					emp.id,
					fromYear,
					undefined,
					timezone,
				);
				previousCarryover = carryoverBalance.balance;
			}

			const adjustments = vacationAdjustmentTotal(adjustmentSums.get(emp.id));

			const totalAllowance = baseAllowance + previousCarryover + adjustments;
			const {
				remaining,
				applied: carryoverApplied,
				capped: carryoverCapped,
			} = calculateCarryoverDays({
				totalAllowance,
				usedDays: vacationTaken.totalDays,
				previouslyTakenDays: adjustmentSums.get(emp.id)?.previouslyTaken ?? 0,
				maxCarryoverDays: fromYearPolicy.maxCarryoverDays,
			});

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
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			logger.error(
				{ employeeId: emp.id, error: errorMessage },
				"Failed to process carryover",
			);
			errors.push({ employeeId: emp.id, error: errorMessage });
		}
	}

	const summary: CarryoverSummary = {
		organizationId,
		fromYear,
		toYear,
		processedAt: new Date(),
		employeesProcessed: results.length,
		totalDaysCarriedOver: results.reduce(
			(sum, r) => sum + r.carryoverApplied,
			0,
		),
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
	return expireCommittedVacationCarryover(
		organizationId,
		performedBy,
		currentDate,
		timezone,
	);
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

	const existing = await getEmployeeVacationAllowance(
		input.employeeId,
		input.year,
	);

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
		configuration: VacationBalanceConfiguration | null;
		totalAllowance: number | null;
		carryover: number | null;
		adjustments: number | null;
		used: number | null;
		pending: number | null;
		remaining: number | null;
		carryoverExpiryDate: Date | null;
		timezone: string;
	}>
> {
	const [org, employees] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: { timezone: true },
		}),
		getEmployeesWithVacationData(organizationId, year),
	]);
	const result = await loadVacationBalances(db, {
		organizationId,
		employeeIds: employees.map((emp) => emp.id),
		year,
		timezone: org?.timezone || "UTC",
	});
	return employees.map((emp) => {
		const balance = result.balances.get(emp.id);
		return {
			employeeId: emp.id,
			employeeName: emp.name,
			configuration: result.configurations.get(emp.id) ?? null,
			totalAllowance: balance?.totalDays ?? null,
			carryover: balance ? (balance.carryoverDays ?? 0) : null,
			adjustments: balance
				? vacationAdjustmentTotal(result.adjustments.get(emp.id))
				: null,
			used: balance?.usedDays ?? null,
			pending: balance?.pendingDays ?? null,
			remaining: balance?.remainingDays ?? null,
			carryoverExpiryDate: balance?.carryoverExpiryDate ?? null,
			timezone: balance?.carryoverExpiryTimezone ?? org?.timezone ?? "UTC",
		};
	});
}
