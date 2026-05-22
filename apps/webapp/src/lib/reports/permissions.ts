/**
 * Permission checks for reports feature
 * Following pattern from lib/absences/permissions.ts
 *
 * Uses the employeeManagers junction table for manager relationships.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { asAppSubject, defineAbilityFor } from "@/lib/authorization";
import type { AccessibleEmployee } from "./types";

type ReportEmployeeAuthorizationSource = {
	id: string;
	organizationId: string;
	role: "admin" | "manager" | "employee";
	teamId?: string | null;
};

type ReportEmployeeSource = {
	id: string;
	organizationId: string;
	user: {
		firstName: string | null;
		lastName: string | null;
		name: string | null;
		email: string;
		image: string | null;
	};
	pronouns: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
};

export function getReportAccessibleEmployeeIds(input: {
	currentEmployeeId: string;
	role: "admin" | "manager" | "employee";
	managedEmployeeIds: string[];
}): string[] | null {
	if (input.role === "admin") return null;
	if (input.role === "manager") return [input.currentEmployeeId, ...input.managedEmployeeIds];
	return [input.currentEmployeeId];
}

function createReportAbility(input: {
	currentEmployee: ReportEmployeeAuthorizationSource;
	managedEmployeeIds: string[];
}) {
	return defineAbilityFor({
		activeOrganizationId: input.currentEmployee.organizationId,
		customRoles: [],
		employee: {
			id: input.currentEmployee.id,
			organizationId: input.currentEmployee.organizationId,
			role: input.currentEmployee.role,
			teamId: input.currentEmployee.teamId ?? null,
		},
		isPlatformAdmin: false,
		managedEmployeeIds: input.managedEmployeeIds,
		orgMembership: {
			organizationId: input.currentEmployee.organizationId,
			role: "member",
			status: "active",
		},
		permissions: {
			byTeamId: new Map(),
			orgWide: null,
		},
		userId: input.currentEmployee.id,
	});
}

export function canReadReportEmployee(input: {
	currentEmployee: ReportEmployeeAuthorizationSource;
	managedEmployeeIds: string[];
	targetEmployee: ReportEmployeeAuthorizationSource;
}): boolean {
	const ability = createReportAbility({
		currentEmployee: input.currentEmployee,
		managedEmployeeIds: input.managedEmployeeIds,
	});

	return ability.can(
		"read",
		asAppSubject("Employee", {
			id: input.targetEmployee.id,
			employeeId: input.targetEmployee.id,
			organizationId: input.targetEmployee.organizationId,
			teamId: input.targetEmployee.teamId ?? null,
		}),
	);
}

function toAccessibleEmployee(emp: ReportEmployeeSource): AccessibleEmployee {
	return {
		id: emp.id,
		firstName: emp.user.firstName,
		lastName: emp.user.lastName,
		name: emp.user.name || emp.user.email,
		email: emp.user.email,
		image: emp.user.image,
		pronouns: emp.pronouns,
		position: emp.position,
		role: emp.role,
	};
}

export function getManagerReportAccessibleEmployees(input: {
	currentEmployee: ReportEmployeeSource;
	directReports: ReportEmployeeSource[];
}): AccessibleEmployee[] {
	const managedEmployeeIds = input.directReports.map((directReport) => directReport.id);
	const seenEmployeeIds = new Set<string>([input.currentEmployee.id]);
	const accessibleEmployees = [toAccessibleEmployee(input.currentEmployee)];

	for (const directReport of input.directReports) {
		if (directReport.organizationId !== input.currentEmployee.organizationId) continue;
		if (seenEmployeeIds.has(directReport.id)) continue;
		if (
			!canReadReportEmployee({
				currentEmployee: input.currentEmployee,
				managedEmployeeIds,
				targetEmployee: directReport,
			})
		) {
			continue;
		}

		seenEmployeeIds.add(directReport.id);
		accessibleEmployees.push(toAccessibleEmployee(directReport));
	}

	return accessibleEmployees;
}

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

	let managedEmployeeIds: string[] = [];
	if (currentEmp.role === "manager") {
		const managerRelations = await db.query.employeeManagers.findMany({
			where: eq(employeeManagers.managerId, currentEmployeeId),
		});
		managedEmployeeIds = managerRelations.map((rel) => rel.employeeId);
	}

	return canReadReportEmployee({
		currentEmployee: currentEmp,
		managedEmployeeIds,
		targetEmployee: targetEmp,
	});
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

	const managerRelations =
		currentEmp.role === "manager"
			? await db.query.employeeManagers.findMany({
					where: eq(employeeManagers.managerId, currentEmployeeId),
					with: {
						employee: {
							with: {
								user: true,
							},
						},
					},
				})
			: [];

	const accessibleEmployeeIds = getReportAccessibleEmployeeIds({
		currentEmployeeId,
		role: currentEmp.role,
		managedEmployeeIds: managerRelations.map((rel) => rel.employeeId),
	});

	// For admins: get all employees in organization (current employee first)
	if (accessibleEmployeeIds === null) {
		const allEmployees = await db.query.employee.findMany({
			where: eq(employee.organizationId, currentEmp.organizationId),
			with: {
				user: true,
			},
		});

		// Ensure current employee is first in the list
		const currentEmployeeData = {
			id: currentEmp.id,
			firstName: currentEmp.user.firstName,
			lastName: currentEmp.user.lastName,
			name: currentEmp.user.name || currentEmp.user.email,
			email: currentEmp.user.email,
			image: currentEmp.user.image,
			pronouns: currentEmp.pronouns,
			position: currentEmp.position,
			role: currentEmp.role,
		};

		const otherEmployees = allEmployees
			.filter((emp) => emp.id !== currentEmployeeId)
			.filter((emp) =>
				canReadReportEmployee({
					currentEmployee: currentEmp,
					managedEmployeeIds: [],
					targetEmployee: emp,
				}),
			)
			.map((emp) => ({
				id: emp.id,
				firstName: emp.user.firstName,
				lastName: emp.user.lastName,
				name: emp.user.name || emp.user.email,
				email: emp.user.email,
				image: emp.user.image,
				pronouns: emp.pronouns,
				position: emp.position,
				role: emp.role,
			}));

		return [currentEmployeeData, ...otherEmployees];
	}

	// For managers: get self and direct reports (via employeeManagers junction table)
	if (currentEmp.role === "manager") {
		return getManagerReportAccessibleEmployees({
			currentEmployee: currentEmp,
			directReports: managerRelations.map((rel) => rel.employee),
		});
	}

	// For employees: only self
	return [
		{
			id: currentEmp.id,
			firstName: currentEmp.user.firstName,
			lastName: currentEmp.user.lastName,
			name: currentEmp.user.name || currentEmp.user.email,
			email: currentEmp.user.email,
			image: currentEmp.user.image,
			pronouns: currentEmp.pronouns,
			position: currentEmp.position,
			role: currentEmp.role,
		},
	];
}
