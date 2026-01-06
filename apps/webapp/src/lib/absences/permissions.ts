import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";

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

	// Managers can approve their subordinates' absences
	if (approver.role === "manager" && target.managerId === employeeId) {
		return true;
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

	// Managers can edit their subordinates' allowances
	if (editor.role === "manager" && target.managerId === employeeId) {
		return true;
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
 * - Can cancel own pending requests
 * - Cannot cancel approved/rejected requests
 * - Admins can cancel any pending request
 *
 * @param employeeId - ID of the employee trying to cancel
 * @param absenceOwnerId - ID of the employee who owns the absence
 * @param absenceStatus - Current status of the absence
 * @returns True if can cancel
 */
export async function canCancelAbsence(
	employeeId: string,
	absenceOwnerId: string,
	absenceStatus: "pending" | "approved" | "rejected",
): Promise<boolean> {
	// Cannot cancel approved or rejected requests
	if (absenceStatus !== "pending") {
		return false;
	}

	// Can cancel own pending requests
	if (employeeId === absenceOwnerId) {
		return true;
	}

	// Admins can cancel any pending request
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	return emp?.role === "admin";
}
