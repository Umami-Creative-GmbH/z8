/**
 * Vacation Queries
 *
 * Database query functions for vacation allowance, balance, and carryover management.
 */

import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeVacationAllowance,
	vacationAdjustment,
	vacationAllowance,
} from "@/db/schema";
import { calculateBusinessDaysWithHalfDays } from "@/lib/absences/date-utils";
import type { DayPeriod } from "@/lib/absences/types";

export interface VacationAllowanceRecord {
	id: string;
	organizationId: string;
	name: string;
	startDate: string; // YYYY-MM-DD
	validUntil: string | null; // YYYY-MM-DD or null if active
	isCompanyDefault: boolean;
	isActive: boolean;
	defaultAnnualDays: string;
	allowCarryover: boolean;
	maxCarryoverDays: string | null;
	carryoverExpiryMonths: number | null;
	accrualType: "annual" | "monthly" | "biweekly";
	accrualStartMonth: number;
	createdAt: Date;
	updatedAt: Date;
	createdBy: string;
}

export interface EmployeeVacationAllowanceRecord {
	id: string;
	employeeId: string;
	year: number;
	customAnnualDays: string | null;
	customCarryoverDays: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface VacationTakenResult {
	totalDays: number;
	entries: Array<{
		id: string;
		startDate: string; // YYYY-MM-DD
		startPeriod: DayPeriod;
		endDate: string; // YYYY-MM-DD
		endPeriod: DayPeriod;
		status: string;
		days: number;
	}>;
}

export interface CarryoverBalanceResult {
	balance: number;
	expiresAt: Date | null;
	isExpired: boolean;
}

export interface PendingVacationRequest {
	id: string;
	employeeId: string;
	employeeName: string;
	startDate: string; // YYYY-MM-DD
	startPeriod: DayPeriod;
	endDate: string; // YYYY-MM-DD
	endPeriod: DayPeriod;
	days: number;
	notes: string | null;
	createdAt: Date;
}

// ============================================
// Date-Based Policy Queries
// ============================================

/**
 * Get all vacation policies for an organization, ordered by startDate descending
 */
export async function getAllVacationPolicies(
	organizationId: string,
): Promise<VacationAllowanceRecord[]> {
	const results = await db.query.vacationAllowance.findMany({
		where: and(
			eq(vacationAllowance.organizationId, organizationId),
			eq(vacationAllowance.isActive, true),
		),
		orderBy: desc(vacationAllowance.startDate),
	});

	return results as VacationAllowanceRecord[];
}

/**
 * Get the current company default policy for an organization
 * Returns the active policy where isCompanyDefault=true and validUntil is null or in the future
 */
export async function getCompanyDefaultPolicy(
	organizationId: string,
	asOfDate: string = new Date().toISOString().split("T")[0],
): Promise<VacationAllowanceRecord | null> {
	const result = await db.query.vacationAllowance.findFirst({
		where: and(
			eq(vacationAllowance.organizationId, organizationId),
			eq(vacationAllowance.isCompanyDefault, true),
			eq(vacationAllowance.isActive, true),
			lte(vacationAllowance.startDate, asOfDate),
			or(
				isNull(vacationAllowance.validUntil),
				gte(vacationAllowance.validUntil, asOfDate),
			),
		),
		orderBy: desc(vacationAllowance.startDate),
	});

	return result as VacationAllowanceRecord | null;
}

/**
 * Get the next scheduled company default policy (starts in the future)
 */
export async function getNextCompanyDefaultPolicy(
	organizationId: string,
	asOfDate: string = new Date().toISOString().split("T")[0],
): Promise<VacationAllowanceRecord | null> {
	const result = await db.query.vacationAllowance.findFirst({
		where: and(
			eq(vacationAllowance.organizationId, organizationId),
			eq(vacationAllowance.isCompanyDefault, true),
			eq(vacationAllowance.isActive, true),
			// Starts after today
			sql`${vacationAllowance.startDate} > ${asOfDate}`,
		),
		orderBy: asc(vacationAllowance.startDate),
	});

	return result as VacationAllowanceRecord | null;
}

/**
 * Get a policy that is active at a specific date
 */
export async function getActivePolicyForDate(
	organizationId: string,
	date: string, // YYYY-MM-DD
): Promise<VacationAllowanceRecord | null> {
	const result = await db.query.vacationAllowance.findFirst({
		where: and(
			eq(vacationAllowance.organizationId, organizationId),
			eq(vacationAllowance.isActive, true),
			lte(vacationAllowance.startDate, date),
			or(isNull(vacationAllowance.validUntil), gte(vacationAllowance.validUntil, date)),
		),
		orderBy: desc(vacationAllowance.startDate),
	});

	return result as VacationAllowanceRecord | null;
}

/**
 * Get all policies that were active at any point in a date range
 * Used for calculating balance across policy changes
 */
export async function getPoliciesInDateRange(
	organizationId: string,
	startDate: string, // YYYY-MM-DD
	endDate: string, // YYYY-MM-DD
): Promise<VacationAllowanceRecord[]> {
	const results = await db.query.vacationAllowance.findMany({
		where: and(
			eq(vacationAllowance.organizationId, organizationId),
			eq(vacationAllowance.isActive, true),
			// Policy started before range ended
			lte(vacationAllowance.startDate, endDate),
			// Policy ended after range started (or hasn't ended)
			or(isNull(vacationAllowance.validUntil), gte(vacationAllowance.validUntil, startDate)),
		),
		orderBy: asc(vacationAllowance.startDate),
	});

	return results as VacationAllowanceRecord[];
}

/**
 * Get a policy by ID
 */
export async function getVacationPolicyById(
	policyId: string,
): Promise<VacationAllowanceRecord | null> {
	const result = await db.query.vacationAllowance.findFirst({
		where: eq(vacationAllowance.id, policyId),
	});

	return result as VacationAllowanceRecord | null;
}

/**
 * @deprecated Use getCompanyDefaultPolicy or getActivePolicyForDate instead
 * Get vacation allowance policy for an organization and year (legacy)
 */
export async function getVacationAllowance(
	organizationId: string,
	year: number,
): Promise<VacationAllowanceRecord | null> {
	// Legacy compatibility: find policy active on Jan 1 of the given year
	const startOfYear = `${year}-01-01`;
	return getActivePolicyForDate(organizationId, startOfYear);
}

/**
 * @deprecated Use getPoliciesInDateRange instead
 * Get vacation allowance for multiple years (for carryover calculations)
 */
export async function getVacationAllowanceRange(
	organizationId: string,
	startYear: number,
	endYear: number,
): Promise<VacationAllowanceRecord[]> {
	const startDate = `${startYear}-01-01`;
	const endDate = `${endYear}-12-31`;
	return getPoliciesInDateRange(organizationId, startDate, endDate);
}

/**
 * Get employee-specific vacation allowance override
 */
export async function getEmployeeVacationAllowance(
	employeeId: string,
	year: number,
): Promise<EmployeeVacationAllowanceRecord | null> {
	const result = await db.query.employeeVacationAllowance.findFirst({
		where: and(
			eq(employeeVacationAllowance.employeeId, employeeId),
			eq(employeeVacationAllowance.year, year),
		),
	});

	return result as EmployeeVacationAllowanceRecord | null;
}

/**
 * Get all employee vacation allowances for an organization and year
 */
export async function getAllEmployeeVacationAllowances(
	organizationId: string,
	year: number,
): Promise<(EmployeeVacationAllowanceRecord & { employeeName: string | null; employeeFirstName: string | null; employeeLastName: string | null })[]> {
	const results = await db
		.select({
			id: employeeVacationAllowance.id,
			employeeId: employeeVacationAllowance.employeeId,
			year: employeeVacationAllowance.year,
			customAnnualDays: employeeVacationAllowance.customAnnualDays,
			customCarryoverDays: employeeVacationAllowance.customCarryoverDays,
			createdAt: employeeVacationAllowance.createdAt,
			updatedAt: employeeVacationAllowance.updatedAt,
			employeeName: sql<string | null>`COALESCE(${employee.firstName} || ' ' || ${employee.lastName}, ${employee.firstName}, ${employee.lastName})`,
			employeeFirstName: employee.firstName,
			employeeLastName: employee.lastName,
		})
		.from(employeeVacationAllowance)
		.innerJoin(employee, eq(employeeVacationAllowance.employeeId, employee.id))
		.where(
			and(eq(employee.organizationId, organizationId), eq(employeeVacationAllowance.year, year)),
		);

	return results as (EmployeeVacationAllowanceRecord & {
		employeeName: string | null;
		employeeFirstName: string | null;
		employeeLastName: string | null;
	})[];
}

/**
 * Create or update employee vacation allowance record
 */
export async function upsertEmployeeVacationAllowance(input: {
	employeeId: string;
	year: number;
	customAnnualDays?: number | null;
	customCarryoverDays?: number | null;
}): Promise<EmployeeVacationAllowanceRecord> {
	const existing = await getEmployeeVacationAllowance(input.employeeId, input.year);

	if (existing) {
		// Update existing record
		const [updated] = await db
			.update(employeeVacationAllowance)
			.set({
				customAnnualDays: input.customAnnualDays?.toString() ?? existing.customAnnualDays,
				customCarryoverDays: input.customCarryoverDays?.toString() ?? existing.customCarryoverDays,
			})
			.where(eq(employeeVacationAllowance.id, existing.id))
			.returning();

		return updated as EmployeeVacationAllowanceRecord;
	}

	// Create new record
	const [created] = await db
		.insert(employeeVacationAllowance)
		.values({
			employeeId: input.employeeId,
			year: input.year,
			customAnnualDays: input.customAnnualDays?.toString() ?? null,
			customCarryoverDays: input.customCarryoverDays?.toString() ?? null,
		})
		.returning();

	return created as EmployeeVacationAllowanceRecord;
}

/**
 * Get vacation days taken by an employee in a specific year
 */
export async function getVacationTakenInYear(
	employeeId: string,
	year: number,
): Promise<VacationTakenResult> {
	// Date range as YYYY-MM-DD strings for comparison
	const startOfYear = `${year}-01-01`;
	const endOfYear = `${year}-12-31`;

	const entries = await db
		.select({
			id: absenceEntry.id,
			startDate: absenceEntry.startDate,
			startPeriod: absenceEntry.startPeriod,
			endDate: absenceEntry.endDate,
			endPeriod: absenceEntry.endPeriod,
			status: absenceEntry.status,
			countsAgainstVacation: absenceCategory.countsAgainstVacation,
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
		.where(
			and(
				eq(absenceEntry.employeeId, employeeId),
				eq(absenceEntry.status, "approved"),
				eq(absenceCategory.countsAgainstVacation, true),
				gte(absenceEntry.startDate, startOfYear),
				lte(absenceEntry.startDate, endOfYear),
			),
		);

	const result = entries.map((entry) => {
		// Use half-day aware calculation
		const days = calculateBusinessDaysWithHalfDays(
			entry.startDate,
			entry.startPeriod,
			entry.endDate,
			entry.endPeriod,
			[], // holidays handled upstream
		);
		return {
			id: entry.id,
			startDate: entry.startDate,
			startPeriod: entry.startPeriod,
			endDate: entry.endDate,
			endPeriod: entry.endPeriod,
			status: entry.status,
			days,
		};
	});

	return {
		totalDays: result.reduce((sum, e) => sum + e.days, 0),
		entries: result,
	};
}

/**
 * Get carryover balance for an employee
 */
export async function getCarryoverBalance(
	employeeId: string,
	year: number,
	currentDate: Date = new Date(),
): Promise<CarryoverBalanceResult> {
	const allowance = await getEmployeeVacationAllowance(employeeId, year);

	if (!allowance?.customCarryoverDays) {
		return { balance: 0, expiresAt: null, isExpired: false };
	}

	// Get organization policy for expiry
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return { balance: 0, expiresAt: null, isExpired: false };
	}

	const policy = await getVacationAllowance(emp.organizationId, year);
	const carryoverDays = parseFloat(allowance.customCarryoverDays);

	if (!policy?.carryoverExpiryMonths) {
		// No expiry
		return { balance: carryoverDays, expiresAt: null, isExpired: false };
	}

	// Calculate expiry date (carryoverExpiryMonths months after Jan 1)
	const expiresAt = new Date(year, policy.carryoverExpiryMonths - 1, 1);
	expiresAt.setMonth(expiresAt.getMonth() + 1);
	expiresAt.setDate(0); // Last day of the expiry month
	expiresAt.setHours(23, 59, 59, 999);

	const isExpired = currentDate > expiresAt;

	return {
		balance: isExpired ? 0 : carryoverDays,
		expiresAt,
		isExpired,
	};
}

/**
 * Get pending vacation requests for an organization
 */
export async function getPendingVacationRequests(
	organizationId: string,
): Promise<PendingVacationRequest[]> {
	const results = await db
		.select({
			id: absenceEntry.id,
			employeeId: absenceEntry.employeeId,
			employeeFirstName: employee.firstName,
			employeeLastName: employee.lastName,
			startDate: absenceEntry.startDate,
			startPeriod: absenceEntry.startPeriod,
			endDate: absenceEntry.endDate,
			endPeriod: absenceEntry.endPeriod,
			notes: absenceEntry.notes,
			createdAt: absenceEntry.createdAt,
		})
		.from(absenceEntry)
		.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
		.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
		.where(
			and(
				eq(employee.organizationId, organizationId),
				eq(absenceEntry.status, "pending"),
				eq(absenceCategory.countsAgainstVacation, true),
			),
		)
		.orderBy(absenceEntry.startDate);

	return results.map((r) => ({
		id: r.id,
		employeeId: r.employeeId,
		employeeName: [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(" ") || "Unknown",
		startDate: r.startDate,
		startPeriod: r.startPeriod,
		endDate: r.endDate,
		endPeriod: r.endPeriod,
		days: calculateBusinessDaysWithHalfDays(
			r.startDate,
			r.startPeriod,
			r.endDate,
			r.endPeriod,
			[], // holidays handled upstream
		),
		notes: r.notes,
		createdAt: r.createdAt,
	}));
}

/**
 * Get all employees in an organization with their vacation data
 */
export async function getEmployeesWithVacationData(
	organizationId: string,
	year: number,
): Promise<
	Array<{
		id: string;
		name: string;
		startDate: Date | null;
		isActive: boolean;
		allowance: EmployeeVacationAllowanceRecord | null;
	}>
> {
	const employees = await db.query.employee.findMany({
		where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
	});

	const allowances = await getAllEmployeeVacationAllowances(organizationId, year);
	const allowanceMap = new Map(allowances.map((a) => [a.employeeId, a]));

	return employees.map((emp) => ({
		id: emp.id,
		name: [emp.firstName, emp.lastName].filter(Boolean).join(" ") || "Unknown",
		startDate: emp.startDate,
		isActive: emp.isActive,
		allowance: allowanceMap.get(emp.id) || null,
	}));
}

/**
 * Get employees with expiring carryover
 */
export async function getEmployeesWithExpiringCarryover(
	organizationId: string,
	year: number,
	daysUntilExpiry: number = 30,
): Promise<
	Array<{
		employeeId: string;
		employeeName: string;
		carryoverDays: number;
		expiresAt: Date;
		daysUntilExpiry: number;
	}>
> {
	const policy = await getVacationAllowance(organizationId, year);

	if (!policy?.allowCarryover || !policy.carryoverExpiryMonths) {
		return [];
	}

	// Calculate expiry date
	const expiresAt = new Date(year, policy.carryoverExpiryMonths - 1, 1);
	expiresAt.setMonth(expiresAt.getMonth() + 1);
	expiresAt.setDate(0);
	expiresAt.setHours(23, 59, 59, 999);

	const now = new Date();
	const maxDate = new Date(now);
	maxDate.setDate(maxDate.getDate() + daysUntilExpiry);

	// If expiry is not within the window, return empty
	if (expiresAt > maxDate || expiresAt < now) {
		return [];
	}

	const allowances = await getAllEmployeeVacationAllowances(organizationId, year);

	return allowances
		.filter((a) => a.customCarryoverDays && parseFloat(a.customCarryoverDays) > 0)
		.map((a) => ({
			employeeId: a.employeeId,
			employeeName: a.employeeName || "Unknown",
			carryoverDays: parseFloat(a.customCarryoverDays || "0"),
			expiresAt,
			daysUntilExpiry: Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
		}));
}

/**
 * Get vacation audit trail for an employee
 */
export async function getVacationAuditTrail(
	employeeId: string,
	limit: number = 50,
): Promise<
	Array<{
		type: "request" | "approval" | "rejection" | "cancellation" | "adjustment";
		date: Date;
		details: string;
		performedBy: string | null;
	}>
> {
	// Get absence entries
	const absences = await db
		.select({
			id: absenceEntry.id,
			status: absenceEntry.status,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
			createdAt: absenceEntry.createdAt,
			approvedAt: absenceEntry.approvedAt,
			approvedBy: absenceEntry.approvedBy,
			rejectionReason: absenceEntry.rejectionReason,
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
		.where(
			and(eq(absenceEntry.employeeId, employeeId), eq(absenceCategory.countsAgainstVacation, true)),
		)
		.orderBy(desc(absenceEntry.createdAt))
		.limit(limit);

	const trail: Array<{
		type: "request" | "approval" | "rejection" | "cancellation" | "adjustment";
		date: Date;
		details: string;
		performedBy: string | null;
	}> = [];

	for (const absence of absences) {
		// startDate and endDate are now YYYY-MM-DD strings
		// Request event
		trail.push({
			type: "request",
			date: absence.createdAt,
			details: `Vacation requested: ${absence.startDate} to ${absence.endDate}`,
			performedBy: null,
		});

		// Approval/rejection event
		if (absence.status === "approved" && absence.approvedAt) {
			trail.push({
				type: "approval",
				date: absence.approvedAt,
				details: `Vacation approved: ${absence.startDate} to ${absence.endDate}`,
				performedBy: absence.approvedBy,
			});
		} else if (absence.status === "rejected") {
			trail.push({
				type: "rejection",
				date: absence.approvedAt || absence.createdAt,
				details: `Vacation rejected: ${absence.rejectionReason || "No reason provided"}`,
				performedBy: absence.approvedBy,
			});
		}
	}

	// Sort by date descending
	return trail.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);
}

// ============================================
// Vacation Adjustment Functions
// ============================================

export interface VacationAdjustmentRecord {
	id: string;
	employeeId: string;
	year: number;
	days: string; // decimal from DB
	reason: string;
	adjustedBy: string;
	createdAt: Date;
}

export interface VacationAdjustmentWithAdjuster extends VacationAdjustmentRecord {
	adjusterName: string;
}

/**
 * Get sum of all vacation adjustments for an employee in a specific year
 */
export async function getAdjustmentTotal(
	employeeId: string,
	year: number,
): Promise<number> {
	const result = await db
		.select({
			total: sql<string>`COALESCE(SUM(${vacationAdjustment.days}), '0')`,
		})
		.from(vacationAdjustment)
		.where(
			and(
				eq(vacationAdjustment.employeeId, employeeId),
				eq(vacationAdjustment.year, year),
			),
		);

	return parseFloat(result[0]?.total || "0");
}

/**
 * Get all vacation adjustment events for an employee in a specific year
 */
export async function getEmployeeAdjustments(
	employeeId: string,
	year: number,
): Promise<VacationAdjustmentWithAdjuster[]> {
	const results = await db
		.select({
			id: vacationAdjustment.id,
			employeeId: vacationAdjustment.employeeId,
			year: vacationAdjustment.year,
			days: vacationAdjustment.days,
			reason: vacationAdjustment.reason,
			adjustedBy: vacationAdjustment.adjustedBy,
			createdAt: vacationAdjustment.createdAt,
			adjusterFirstName: employee.firstName,
			adjusterLastName: employee.lastName,
		})
		.from(vacationAdjustment)
		.innerJoin(employee, eq(vacationAdjustment.adjustedBy, employee.id))
		.where(
			and(
				eq(vacationAdjustment.employeeId, employeeId),
				eq(vacationAdjustment.year, year),
			),
		)
		.orderBy(desc(vacationAdjustment.createdAt));

	return results.map((r) => ({
		id: r.id,
		employeeId: r.employeeId,
		year: r.year,
		days: r.days,
		reason: r.reason,
		adjustedBy: r.adjustedBy,
		createdAt: r.createdAt,
		adjusterName: [r.adjusterFirstName, r.adjusterLastName].filter(Boolean).join(" ") || "Unknown",
	}));
}

/**
 * Create a new vacation adjustment event
 */
export async function createVacationAdjustment(input: {
	employeeId: string;
	year: number;
	days: string;
	reason: string;
	adjustedBy: string;
}): Promise<VacationAdjustmentRecord> {
	const [created] = await db
		.insert(vacationAdjustment)
		.values({
			employeeId: input.employeeId,
			year: input.year,
			days: input.days,
			reason: input.reason,
			adjustedBy: input.adjustedBy,
		})
		.returning();

	return created as VacationAdjustmentRecord;
}

/**
 * Get all vacation adjustments for an organization in a specific year
 * (for audit/reporting purposes)
 */
export async function getOrganizationAdjustments(
	organizationId: string,
	year: number,
): Promise<
	Array<
		VacationAdjustmentWithAdjuster & {
			employeeName: string;
		}
	>
> {
	// Get all employees in org, then their adjustments
	const employeesInOrg = db
		.select({ id: employee.id })
		.from(employee)
		.where(eq(employee.organizationId, organizationId));

	const adjusterAlias = db
		.select({
			id: employee.id,
			firstName: employee.firstName,
			lastName: employee.lastName,
		})
		.from(employee)
		.as("adjuster");

	const results = await db
		.select({
			id: vacationAdjustment.id,
			employeeId: vacationAdjustment.employeeId,
			year: vacationAdjustment.year,
			days: vacationAdjustment.days,
			reason: vacationAdjustment.reason,
			adjustedBy: vacationAdjustment.adjustedBy,
			createdAt: vacationAdjustment.createdAt,
			employeeFirstName: employee.firstName,
			employeeLastName: employee.lastName,
			adjusterFirstName: adjusterAlias.firstName,
			adjusterLastName: adjusterAlias.lastName,
		})
		.from(vacationAdjustment)
		.innerJoin(employee, eq(vacationAdjustment.employeeId, employee.id))
		.innerJoin(adjusterAlias, eq(vacationAdjustment.adjustedBy, adjusterAlias.id))
		.where(
			and(
				eq(vacationAdjustment.year, year),
				sql`${vacationAdjustment.employeeId} IN (${employeesInOrg})`,
			),
		)
		.orderBy(desc(vacationAdjustment.createdAt));

	return results.map((r) => ({
		id: r.id,
		employeeId: r.employeeId,
		year: r.year,
		days: r.days,
		reason: r.reason,
		adjustedBy: r.adjustedBy,
		createdAt: r.createdAt,
		employeeName: [r.employeeFirstName, r.employeeLastName].filter(Boolean).join(" ") || "Unknown",
		adjusterName: [r.adjusterFirstName, r.adjusterLastName].filter(Boolean).join(" ") || "Unknown",
	}));
}
