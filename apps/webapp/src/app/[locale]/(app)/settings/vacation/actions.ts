"use server";

import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, employeeVacationAllowance, member, vacationAllowance } from "@/db/schema";
import { auth } from "@/lib/auth";

/**
 * Get current employee from session
 */
async function getCurrentEmployee() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
		with: {
			user: {
				with: {
					members: true,
				},
			},
		},
	});

	return emp;
}

/**
 * Check if user is org admin or owner
 */
async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
	const membership = await db.query.member.findFirst({
		where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
	});

	return membership?.role === "admin" || membership?.role === "owner";
}

/**
 * Get vacation policy for an organization and year
 */
export async function getVacationPolicy(organizationId: string, year: number) {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Not authenticated", data: null };
	}

	// Verify user is org admin
	if (!(await isOrgAdmin(currentEmployee.userId, organizationId))) {
		return { success: false, error: "Insufficient permissions", data: null };
	}

	const policy = await db.query.vacationAllowance.findFirst({
		where: and(
			eq(vacationAllowance.organizationId, organizationId),
			eq(vacationAllowance.year, year),
		),
		with: {
			creator: true,
		},
	});

	return { success: true, data: policy };
}

/**
 * Create vacation policy for an organization
 */
export async function createVacationPolicy(data: {
	organizationId: string;
	year: number;
	defaultAnnualDays: string;
	accrualType: "annual" | "monthly" | "biweekly";
	accrualStartMonth?: number;
	allowCarryover: boolean;
	maxCarryoverDays?: string;
	carryoverExpiryMonths?: number;
}) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	// Verify user is org admin
	if (!(await isOrgAdmin(session.user.id, data.organizationId))) {
		return { success: false, error: "Insufficient permissions" };
	}

	// Check if policy already exists
	const existing = await db.query.vacationAllowance.findFirst({
		where: and(
			eq(vacationAllowance.organizationId, data.organizationId),
			eq(vacationAllowance.year, data.year),
		),
	});

	if (existing) {
		return { success: false, error: "Policy already exists for this year" };
	}

	try {
		const [policy] = await db
			.insert(vacationAllowance)
			.values({
				organizationId: data.organizationId,
				year: data.year,
				defaultAnnualDays: data.defaultAnnualDays,
				accrualType: data.accrualType,
				accrualStartMonth: data.accrualStartMonth,
				allowCarryover: data.allowCarryover,
				maxCarryoverDays: data.maxCarryoverDays,
				carryoverExpiryMonths: data.carryoverExpiryMonths,
				createdBy: session.user.id,
			})
			.returning();

		return { success: true, data: policy };
	} catch (error) {
		console.error("Create vacation policy error:", error);
		return { success: false, error: "Failed to create vacation policy" };
	}
}

/**
 * Update vacation policy
 */
export async function updateVacationPolicy(
	policyId: string,
	data: {
		defaultAnnualDays: string;
		accrualType: "annual" | "monthly" | "biweekly";
		accrualStartMonth?: number;
		allowCarryover: boolean;
		maxCarryoverDays?: string;
		carryoverExpiryMonths?: number;
	},
) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	// Get the policy to check permissions
	const policy = await db.query.vacationAllowance.findFirst({
		where: eq(vacationAllowance.id, policyId),
	});

	if (!policy) {
		return { success: false, error: "Policy not found" };
	}

	// Verify user is org admin
	if (!(await isOrgAdmin(session.user.id, policy.organizationId))) {
		return { success: false, error: "Insufficient permissions" };
	}

	try {
		const [updated] = await db
			.update(vacationAllowance)
			.set({
				defaultAnnualDays: data.defaultAnnualDays,
				accrualType: data.accrualType,
				accrualStartMonth: data.accrualStartMonth,
				allowCarryover: data.allowCarryover,
				maxCarryoverDays: data.maxCarryoverDays,
				carryoverExpiryMonths: data.carryoverExpiryMonths,
			})
			.where(eq(vacationAllowance.id, policyId))
			.returning();

		return { success: true, data: updated };
	} catch (error) {
		console.error("Update vacation policy error:", error);
		return { success: false, error: "Failed to update vacation policy" };
	}
}

/**
 * Get all employees with their vacation allowances
 */
export async function getEmployeesWithAllowances(organizationId: string, year: number) {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Not authenticated", data: [] };
	}

	// Verify user is org admin
	if (!(await isOrgAdmin(currentEmployee.userId, organizationId))) {
		return { success: false, error: "Insufficient permissions", data: [] };
	}

	const employees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
		with: {
			user: true,
			team: true,
			vacationAllowances: {
				where: eq(employeeVacationAllowance.year, year),
			},
		},
	});

	return { success: true, data: employees };
}

/**
 * Get employee vacation allowance for a specific year
 */
export async function getEmployeeAllowance(employeeId: string, year: number) {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Not authenticated", data: null };
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
		with: {
			user: true,
			team: true,
			vacationAllowances: {
				where: eq(employeeVacationAllowance.year, year),
			},
		},
	});

	if (!emp) {
		return { success: false, error: "Employee not found", data: null };
	}

	// Verify user is org admin or manager of this employee
	const isAdmin = await isOrgAdmin(currentEmployee.userId, emp.organizationId);
	const isManager = currentEmployee.id === emp.managerId;

	if (!isAdmin && !isManager && currentEmployee.role !== "admin") {
		return { success: false, error: "Insufficient permissions", data: null };
	}

	return { success: true, data: emp };
}

/**
 * Update employee vacation allowance
 */
export async function updateEmployeeAllowance(
	employeeId: string,
	year: number,
	data: {
		customAnnualDays?: string;
		customCarryoverDays?: string;
		adjustmentDays?: string;
		adjustmentReason?: string;
	},
) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return { success: false, error: "Employee not found" };
	}

	// Verify user is org admin or manager of this employee
	const isAdmin = await isOrgAdmin(currentEmployee.userId, emp.organizationId);
	const isManager = currentEmployee.id === emp.managerId;

	if (!isAdmin && !isManager && currentEmployee.role !== "admin") {
		return { success: false, error: "Insufficient permissions" };
	}

	try {
		// Check if allowance exists
		const existing = await db.query.employeeVacationAllowance.findFirst({
			where: and(
				eq(employeeVacationAllowance.employeeId, employeeId),
				eq(employeeVacationAllowance.year, year),
			),
		});

		let allowance: typeof employeeVacationAllowance.$inferSelect;

		if (existing) {
			// Update existing
			[allowance] = await db
				.update(employeeVacationAllowance)
				.set({
					customAnnualDays: data.customAnnualDays,
					customCarryoverDays: data.customCarryoverDays,
					adjustmentDays: data.adjustmentDays,
					adjustmentReason: data.adjustmentReason,
					adjustedAt: data.adjustmentReason ? new Date() : existing.adjustedAt,
					adjustedBy: data.adjustmentReason ? currentEmployee.id : existing.adjustedBy,
				})
				.where(eq(employeeVacationAllowance.id, existing.id))
				.returning();
		} else {
			// Create new
			[allowance] = await db
				.insert(employeeVacationAllowance)
				.values({
					employeeId,
					year,
					customAnnualDays: data.customAnnualDays,
					customCarryoverDays: data.customCarryoverDays,
					adjustmentDays: data.adjustmentDays || "0",
					adjustmentReason: data.adjustmentReason,
					adjustedAt: data.adjustmentReason ? new Date() : null,
					adjustedBy: data.adjustmentReason ? currentEmployee.id : null,
				})
				.returning();
		}

		return { success: true, data: allowance };
	} catch (error) {
		console.error("Update employee allowance error:", error);
		return { success: false, error: "Failed to update employee allowance" };
	}
}

/**
 * Get adjustment history for an organization
 */
export async function getAdjustmentHistory(organizationId: string, year: number) {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Not authenticated", data: [] };
	}

	// Verify user is org admin
	if (!(await isOrgAdmin(currentEmployee.userId, organizationId))) {
		return { success: false, error: "Insufficient permissions", data: [] };
	}

	const adjustments = await db.query.employeeVacationAllowance.findMany({
		where: and(
			eq(employeeVacationAllowance.year, year),
			// Only get records with adjustments
		),
		with: {
			employee: {
				with: {
					user: true,
					team: true,
				},
			},
			adjuster: {
				with: {
					user: true,
				},
			},
		},
		orderBy: desc(employeeVacationAllowance.adjustedAt),
	});

	// Filter to only this organization and only records with adjustments
	const filtered = adjustments.filter(
		(adj) =>
			adj.employee.organizationId === organizationId && adj.adjustmentReason && adj.adjustedAt,
	);

	return { success: true, data: filtered };
}
