import { and, eq, isNull, or } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee, employeeManagers } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";

/**
 * Who besides the employee is reminded about an expiring employee skill
 * (#1143): their managers who may still use the organization; when they have
 * none, the organization's approved owners and admins (except former
 * employees). Kiosk-only accounts (reserved addresses) are never recipients,
 * and the employee is left out (they get their own copy). Distinct, sorted.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

export async function listSkillReminderManagers(
	database: Reader,
	input: { organizationId: string; employeeId: string; employeeUserId: string; now: Instant },
): Promise<string[]> {
	const { organizationId, now } = input;
	const keep = (rows: Array<{ userId: string; email: string }>) =>
		[
			...new Set(
				rows
					.filter((row) => row.userId !== input.employeeUserId && !isReservedEmail(row.email))
					.map((row) => row.userId),
			),
		].toSorted();

	// `employee` here is the manager: the access check reads the un-aliased table.
	const managers = keep(
		await database
			.select({ userId: employee.userId, email: user.email })
			.from(employeeManagers)
			.innerJoin(
				employee,
				and(
					eq(employee.id, employeeManagers.managerId),
					eq(employee.organizationId, organizationId),
					employeeHasOrganizationAccess(now),
				),
			)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(eq(employeeManagers.employeeId, input.employeeId)),
	);
	if (managers.length > 0) return managers;

	const members = await database
		.select({ userId: member.userId, email: user.email, role: member.role })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.leftJoin(
			employee,
			and(eq(employee.userId, member.userId), eq(employee.organizationId, organizationId)),
		)
		.where(
			and(
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
				or(isNull(employee.id), employeeHasOrganizationAccess(now)),
			),
		);
	return keep(
		members.filter(
			(row) => hasOrganizationRole(row.role, "owner") || hasOrganizationRole(row.role, "admin"),
		),
	);
}
