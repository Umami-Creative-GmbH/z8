import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import {
	absenceEntry,
	auditLog,
	employee,
	employeeManagers,
	employeeVacationAllowance,
} from "@/db/schema";
import { deleteEmployeeApprovalLifecycles } from "@/lib/approvals/maintenance";
import { deleteDemoEmployeeHistories } from "./demo-work";

export interface DeleteNonAdminResult {
	employeesDeleted: number;
	usersDeleted: number;
	membersDeleted: number;
	timeEntriesDeleted: number;
	workPeriodsDeleted: number;
	absencesDeleted: number;
	approvalRequestsDeleted: number;
	/** Approval lifecycles of any kind that named a deleted employee (#306). */
	approvalLifecyclesDeleted: number;
	/** Audit entries kept, with their reference to a deleted employee cleared. */
	auditEntriesDetached: number;
	managerAssignmentsDeleted: number;
	vacationAllowancesDeleted: number;
}

/**
 * Delete all non-admin employees and their associated data
 * Preserves admin users and their data
 */
export async function deleteNonAdminEmployeesData(
	organizationId: string,
	currentUserId: string,
): Promise<DeleteNonAdminResult> {
	const result: DeleteNonAdminResult = {
		employeesDeleted: 0,
		usersDeleted: 0,
		membersDeleted: 0,
		timeEntriesDeleted: 0,
		workPeriodsDeleted: 0,
		absencesDeleted: 0,
		approvalRequestsDeleted: 0,
		approvalLifecyclesDeleted: 0,
		auditEntriesDetached: 0,
		managerAssignmentsDeleted: 0,
		vacationAllowancesDeleted: 0,
	};

	// Step 1: Find all non-admin employees in this organization
	// Exclude the current user to ensure they don't delete themselves
	const nonAdminEmployees = await db.query.employee.findMany({
		where: and(
			eq(employee.organizationId, organizationId),
			ne(employee.role, "admin"),
			ne(employee.userId, currentUserId),
		),
	});

	if (nonAdminEmployees.length === 0) {
		return result;
	}

	const employeeIds = nonAdminEmployees.map((e) => e.id);
	const userIds = nonAdminEmployees.map((e) => e.userId);

	// Step 2: Remove every approval lifecycle naming these employees in any role
	// (requester, approver, decider, card recipient, ...) through the privileged
	// owner's verified links, in one transaction. Sources keep their outcomes; the
	// remaining employees' work history and receipts are not touched (#306).
	const approvals = await db.transaction((transaction) =>
		deleteEmployeeApprovalLifecycles(transaction, { organizationId, employeeIds }),
	);
	result.approvalLifecyclesDeleted = approvals.lifecycles.length;
	result.approvalRequestsDeleted = approvals.lifecycles.reduce(
		(total, lifecycle) => total + lifecycle.legacyRequests.length,
		0,
	);

	// Step 3: Delete absence entries
	const absencesToDelete = await db.query.absenceEntry.findMany({
		where: inArray(absenceEntry.employeeId, employeeIds),
	});
	if (absencesToDelete.length > 0) {
		await db.delete(absenceEntry).where(inArray(absenceEntry.employeeId, employeeIds));
		result.absencesDeleted = absencesToDelete.length;
	}

	// Steps 4-5: Delete each employee's time history atomically under its employee
	// key (position, receipts, periods, canonical work records, entries). Admin
	// employees' histories are never touched.
	const deleted = await deleteDemoEmployeeHistories({
		organizationId,
		triggeringUserId: currentUserId,
		employeeIds,
	});
	result.workPeriodsDeleted = deleted.workPeriodsDeleted;
	result.timeEntriesDeleted = deleted.timeEntriesDeleted;

	// Step 6: Delete employee vacation allowances
	const allowancesToDelete = await db.query.employeeVacationAllowance.findMany({
		where: inArray(employeeVacationAllowance.employeeId, employeeIds),
	});
	if (allowancesToDelete.length > 0) {
		await db
			.delete(employeeVacationAllowance)
			.where(inArray(employeeVacationAllowance.employeeId, employeeIds));
		result.vacationAllowancesDeleted = allowancesToDelete.length;
	}

	// Step 7: Delete manager assignments (both as employee and manager)
	const managerAssignmentsToDelete = await db
		.select()
		.from(employeeManagers)
		.where(inArray(employeeManagers.employeeId, employeeIds));
	const managerAssignmentsAsManager = await db
		.select()
		.from(employeeManagers)
		.where(inArray(employeeManagers.managerId, employeeIds));

	if (managerAssignmentsToDelete.length > 0) {
		await db.delete(employeeManagers).where(inArray(employeeManagers.employeeId, employeeIds));
	}
	if (managerAssignmentsAsManager.length > 0) {
		await db.delete(employeeManagers).where(inArray(employeeManagers.managerId, employeeIds));
	}
	result.managerAssignmentsDeleted =
		managerAssignmentsToDelete.length + managerAssignmentsAsManager.length;

	// Step 8: Keep the audit trail, detached from the employees being deleted.
	const detached = await db
		.update(auditLog)
		.set({ employeeId: null })
		.where(
			and(eq(auditLog.organizationId, organizationId), inArray(auditLog.employeeId, employeeIds)),
		)
		.returning({ id: auditLog.id });
	result.auditEntriesDetached = detached.length;

	// Step 9: Delete employee records
	await db.delete(employee).where(inArray(employee.id, employeeIds));
	result.employeesDeleted = employeeIds.length;

	// Step 10: Delete organization memberships
	const membersToDelete = await db.query.member.findMany({
		where: and(eq(member.organizationId, organizationId), inArray(member.userId, userIds)),
	});
	if (membersToDelete.length > 0) {
		await db
			.delete(member)
			.where(and(eq(member.organizationId, organizationId), inArray(member.userId, userIds)));
		result.membersDeleted = membersToDelete.length;
	}

	// Step 11: Delete user accounts (only demo users with @demo.invalid email)
	// This prevents accidentally deleting real user accounts
	const demoUsers = await db.query.user.findMany({
		where: and(
			inArray(user.id, userIds),
			// Only delete users with demo email addresses
		),
	});

	// Filter to only delete demo users (email ends with @demo.invalid)
	const demoUserIds = demoUsers.filter((u) => u.email?.endsWith("@demo.invalid")).map((u) => u.id);

	if (demoUserIds.length > 0) {
		await db.delete(user).where(inArray(user.id, demoUserIds));
		result.usersDeleted = demoUserIds.length;
	}

	return result;
}
