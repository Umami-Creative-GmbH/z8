/**
 * Permission checks for reports feature
 * Following pattern from lib/absences/permissions.ts
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import type { AccessibleEmployee } from "./types";

/**
 * Check if an employee can generate a report for a target employee
 *
 * Rules:
 * - Employees can generate their own reports
 * - Admins can generate reports for all employees in their organization
 * - Managers can generate reports for their direct reports
 *
 * @param currentEmployeeId - ID of the employee trying to generate the report
 * @param targetEmployeeId - ID of the employee whose report is being generated
 * @returns True if can generate report
 */
export async function canGenerateReport(
	currentEmployeeId: string,
	targetEmployeeId: string,
): Promise<boolean> {
	// Employee can access own reports
	if (currentEmployeeId === targetEmployeeId) {
		return true;
	}

	const [currentEmp, targetEmp] = await Promise.all([
		db.query.employee.findFirst({
			where: eq(employee.id, currentEmployeeId),
		}),
		db.query.employee.findFirst({
			where: eq(employee.id, targetEmployeeId),
		}),
	]);

	if (!currentEmp || !targetEmp) {
		return false;
	}

	// Must be in same organization
	if (currentEmp.organizationId !== targetEmp.organizationId) {
		return false;
	}

	// Admins can generate reports for all employees in their organization
	if (currentEmp.role === "admin") {
		return true;
	}

	// Managers can generate reports for their direct reports
	if (currentEmp.role === "manager" && targetEmp.managerId === currentEmployeeId) {
		return true;
	}

	return false;
}

/**
 * Get list of employees that the current employee can generate reports for
 *
 * Rules:
 * - Employees can only see themselves
 * - Managers can see themselves and their direct reports
 * - Admins can see all employees in their organization
 *
 * @param currentEmployeeId - ID of the current employee
 * @returns List of accessible employees
 */
export async function getAccessibleEmployees(
	currentEmployeeId: string,
): Promise<AccessibleEmployee[]> {
	const currentEmp = await db.query.employee.findFirst({
		where: eq(employee.id, currentEmployeeId),
		with: {
			user: true,
		},
	});

	if (!currentEmp) {
		return [];
	}

	// For admins: get all employees in organization
	if (currentEmp.role === "admin") {
		const allEmployees = await db.query.employee.findMany({
			where: eq(employee.organizationId, currentEmp.organizationId),
			with: {
				user: true,
			},
		});

		return allEmployees.map((emp) => ({
			id: emp.id,
			name: emp.user.name || emp.user.email,
			email: emp.user.email,
			position: emp.position,
			role: emp.role,
		}));
	}

	// For managers: get self and direct reports
	if (currentEmp.role === "manager") {
		const directReports = await db.query.employee.findMany({
			where: eq(employee.managerId, currentEmployeeId),
			with: {
				user: true,
			},
		});

		// Include self and direct reports
		return [
			{
				id: currentEmp.id,
				name: currentEmp.user.name || currentEmp.user.email,
				email: currentEmp.user.email,
				position: currentEmp.position,
				role: currentEmp.role,
			},
			...directReports.map((emp) => ({
				id: emp.id,
				name: emp.user.name || emp.user.email,
				email: emp.user.email,
				position: emp.position,
				role: emp.role,
			})),
		];
	}

	// For employees: only self
	return [
		{
			id: currentEmp.id,
			name: currentEmp.user.name || currentEmp.user.email,
			email: currentEmp.user.email,
			position: currentEmp.position,
			role: currentEmp.role,
		},
	];
}
