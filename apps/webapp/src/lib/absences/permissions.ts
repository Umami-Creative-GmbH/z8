import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";

/**
 * Check if an employee can approve an absence request
 *
 * Rules:
 * - Admins can approve all absences
 * - Managers can approve their subordinates' absences
 * - Employees cannot approve absences
 *
 * @param employeeId - ID of the employee trying to approve
 * @param targetEmployeeId - ID of the employee whose absence is being approved
 * @returns True if can approve
 */
export async function canApproveAbsence(
	employeeId: string,
	targetEmployeeId: string,
): Promise<boolean> {
	const [approver, target] = await Promise.all([
		db.query.employee.findFirst({
			where: eq(employee.id, employeeId),
		}),
		db.query.employee.findFirst({
			where: eq(employee.id, targetEmployeeId),
		}),
	]);

	if (!approver || !target) {
		return false;
	}

	// Admins can approve all absences
	if (approver.role === "admin") {
		return true;
	}

	// Managers can approve their linked employees' absences
	if (approver.role === "manager") {
		const managerLink = await db.query.employeeManagers.findFirst({
			where: and(
				eq(employeeManagers.employeeId, targetEmployeeId),
				eq(employeeManagers.managerId, employeeId),
			),
		});

		return Boolean(managerLink);
	}

	return false;
}

/**
 * Check if an employee can edit another employee's vacation allowance
 *
 * Rules:
 * - Admins can edit any employee's allowance
 * - Managers can edit their subordinates' allowances
 * - Employees cannot edit allowances
 *
 * @param employeeId - ID of the employee trying to edit
 * @param targetEmployeeId - ID of the employee whose allowance is being edited
 * @returns True if can edit
 */
export async function canEditEmployeeAllowance(
	employeeId: string,
	targetEmployeeId: string,
): Promise<boolean> {
	const [editor, target] = await Promise.all([
		db.query.employee.findFirst({
			where: eq(employee.id, employeeId),
		}),
		db.query.employee.findFirst({
			where: eq(employee.id, targetEmployeeId),
		}),
	]);

	if (!editor || !target) {
		return false;
	}

	// Admins can edit any employee's allowance
	if (editor.role === "admin") {
		return true;
	}

	// Managers can edit their linked employees' allowances
	if (editor.role === "manager") {
		const managerLink = await db.query.employeeManagers.findFirst({
			where: and(
				eq(employeeManagers.employeeId, targetEmployeeId),
				eq(employeeManagers.managerId, employeeId),
			),
		});

		return Boolean(managerLink);
	}

	return false;
}

/**
 * Check if an employee can edit organization-wide vacation settings
 *
 * Rules:
 * - Only admins can edit org-wide settings
 *
 * @param employeeId - ID of the employee trying to edit
 * @returns True if can edit
 */
export async function canEditOrgSettings(employeeId: string): Promise<boolean> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return false;
	}

	return emp.role === "admin";
}

/**
 * Check if an employee can cancel an absence request
 *
 * Rules:
 * - Owners can cancel pending requests
 * - Owners can cancel approved requests before the start date
 * - Rejected requests cannot be cancelled
 * - Admins can cancel other employees' pending requests
 *
 * @param employeeId - ID of the employee trying to cancel
 * @param absenceOwnerId - ID of the employee who owns the absence
 * @param absenceStatus - Current status of the absence
 * @returns True if can cancel
 */
type AbsenceApprovalStatus = "pending" | "approved" | "rejected";

export function canSelfCancelAbsenceStatus(input: {
	status: AbsenceApprovalStatus;
	startDate: string;
	today: string;
}): boolean {
	if (input.status === "pending") {
		return true;
	}

	if (input.status === "approved") {
		return input.startDate > input.today;
	}

	return false;
}

export async function canCancelAbsence(
	employeeId: string,
	absenceOwnerId: string,
	absenceStatus: AbsenceApprovalStatus,
	context?: { startDate?: string; today?: string },
): Promise<boolean> {
	if (employeeId === absenceOwnerId) {
		return canSelfCancelAbsenceStatus({
			status: absenceStatus,
			startDate: context?.startDate ?? "",
			today: context?.today ?? "9999-12-31",
		});
	}

	if (absenceStatus !== "pending") {
		return false;
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	return emp?.role === "admin";
}
