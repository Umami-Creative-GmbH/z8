/**
 * Vacation Queries
 *
 * Database query functions for vacation allowance, balance, and carryover management.
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeVacationAllowance,
	vacationAllowance,
} from "@/db/schema";

export interface VacationAllowanceRecord {
	id: string;
	organizationId: string;
	year: number;
	defaultAnnualDays: string;
	allowCarryover: boolean;
	maxCarryoverDays: string | null;
	carryoverExpiryMonths: number | null;
	accrualType: "annual" | "monthly" | "biweekly";
	accrualStartMonth: number;
	createdAt: Date;
	createdBy: string;
}

export interface EmployeeVacationAllowanceRecord {
	id: string;
	employeeId: string;
	year: number;
	customAnnualDays: string | null;
	customCarryoverDays: string | null;
	adjustmentDays: string;
	adjustmentReason: string | null;
	adjustedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface VacationTakenResult {
	totalDays: number;
	entries: Array<{
		id: string;
		startDate: Date;
		endDate: Date;
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
	startDate: Date;
	endDate: Date;
	days: number;
	notes: string | null;
	createdAt: Date;
}

/**
 * Get vacation allowance policy for an organization and year
 */
export async function getVacationAllowance(
	organizationId: string,
	year: number,
): Promise<VacationAllowanceRecord | null> {
	const result = await db.query.vacationAllowance.findFirst({
		where: and(
			eq(vacationAllowance.organizationId, organizationId),
			eq(vacationAllowance.year, year),
		),
	});

	return result as VacationAllowanceRecord | null;
}

/**
 * Get vacation allowance for multiple years (for carryover calculations)
 */
export async function getVacationAllowanceRange(
	organizationId: string,
	startYear: number,
	endYear: number,
): Promise<VacationAllowanceRecord[]> {
	const results = await db.query.vacationAllowance.findMany({
		where: and(
			eq(vacationAllowance.organizationId, organizationId),
			gte(vacationAllowance.year, startYear),
			lte(vacationAllowance.year, endYear),
		),
		orderBy: desc(vacationAllowance.year),
	});

	return results as VacationAllowanceRecord[];
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
): Promise<(EmployeeVacationAllowanceRecord & { employeeName: string; employeeEmail: string })[]> {
	const results = await db
		.select({
			id: employeeVacationAllowance.id,
			employeeId: employeeVacationAllowance.employeeId,
			year: employeeVacationAllowance.year,
			customAnnualDays: employeeVacationAllowance.customAnnualDays,
			customCarryoverDays: employeeVacationAllowance.customCarryoverDays,
			adjustmentDays: employeeVacationAllowance.adjustmentDays,
			adjustmentReason: employeeVacationAllowance.adjustmentReason,
			adjustedBy: employeeVacationAllowance.adjustedBy,
			createdAt: employeeVacationAllowance.createdAt,
			updatedAt: employeeVacationAllowance.updatedAt,
			employeeName: employee.name,
			employeeEmail: employee.workEmail,
		})
		.from(employeeVacationAllowance)
		.innerJoin(employee, eq(employeeVacationAllowance.employeeId, employee.id))
		.where(
			and(eq(employee.organizationId, organizationId), eq(employeeVacationAllowance.year, year)),
		);

	return results as (EmployeeVacationAllowanceRecord & {
		employeeName: string;
		employeeEmail: string;
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
	adjustmentDays?: number;
	adjustmentReason?: string | null;
	adjustedBy?: string | null;
}): Promise<EmployeeVacationAllowanceRecord> {
	const existing = await getEmployeeVacationAllowance(input.employeeId, input.year);

	if (existing) {
		// Update existing record
		const [updated] = await db
			.update(employeeVacationAllowance)
			.set({
				customAnnualDays: input.customAnnualDays?.toString() ?? existing.customAnnualDays,
				customCarryoverDays: input.customCarryoverDays?.toString() ?? existing.customCarryoverDays,
				adjustmentDays: input.adjustmentDays?.toString() ?? existing.adjustmentDays,
				adjustmentReason: input.adjustmentReason ?? existing.adjustmentReason,
				adjustedBy: input.adjustedBy ?? existing.adjustedBy,
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
			adjustmentDays: (input.adjustmentDays ?? 0).toString(),
			adjustmentReason: input.adjustmentReason ?? null,
			adjustedBy: input.adjustedBy ?? null,
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
	const startOfYear = new Date(year, 0, 1);
	const endOfYear = new Date(year, 11, 31, 23, 59, 59);

	const entries = await db
		.select({
			id: absenceEntry.id,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
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
		const start = new Date(entry.startDate);
		const end = new Date(entry.endDate);
		const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
		return {
			id: entry.id,
			startDate: start,
			endDate: end,
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
			employeeName: employee.name,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
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
		employeeName: r.employeeName,
		startDate: r.startDate,
		endDate: r.endDate,
		days: Math.ceil((r.endDate.getTime() - r.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
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
		email: string;
		hireDate: Date | null;
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
		name: emp.name,
		email: emp.workEmail || "",
		hireDate: emp.hireDate,
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
			employeeName: a.employeeName,
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
		// Request event
		trail.push({
			type: "request",
			date: absence.createdAt,
			details: `Vacation requested: ${absence.startDate.toISOString().split("T")[0]} to ${absence.endDate.toISOString().split("T")[0]}`,
			performedBy: null,
		});

		// Approval/rejection event
		if (absence.status === "approved" && absence.approvedAt) {
			trail.push({
				type: "approval",
				date: absence.approvedAt,
				details: `Vacation approved: ${absence.startDate.toISOString().split("T")[0]} to ${absence.endDate.toISOString().split("T")[0]}`,
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
