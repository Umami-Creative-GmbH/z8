import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db as rootDatabase } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee, employeeManagers } from "@/db/schema";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { memberIsAccessibleOwnerOrAdmin } from "@/lib/employee-lifecycle/authority-sql";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";

type Reader = Pick<typeof rootDatabase, "select">;

/**
 * What a manager notice asks of its recipient. An actionable notice asks
 * someone to decide or do something; an informational one only tells them.
 */
export type ManagerNoticeKind = "actionable" | "informational";

export type ManagerNoticeRecipients = {
	userIds: string[];
	/** Who they are: the managers, the admins standing in for them, or nobody. */
	reason: "managers" | "organization_admins" | "none";
};

export type ManagerNoticeRecipientsInput = {
	organizationId: string;
	employeeIds: readonly string[];
	notice: ManagerNoticeKind;
	/** Only the employees' primary managers. */
	primaryOnly?: boolean;
	excludeUserIds?: readonly string[];
	now?: Instant;
};

/**
 * Who receives a notice addressed to employees' managers (#1438, Organization
 * ADR 0006): their managers on the organization's current roster, so a former
 * manager no longer hears from the organization. When every manager is a
 * former employee, an actionable notice goes to the organization's current
 * owners and admins instead, so that no decision is silently lost; an
 * informational one is dropped. Employees with no manager at all keep today's
 * behaviour: nobody. Kiosk-only accounts (reserved addresses) and
 * `excludeUserIds` never receive it. Distinct and sorted; every read is
 * organization-scoped.
 */
export async function currentRosterManagerRecipients(
	client: Reader,
	input: ManagerNoticeRecipientsInput,
): Promise<ManagerNoticeRecipients> {
	if (input.employeeIds.length === 0) return { userIds: [], reason: "none" };
	const excluded = new Set(input.excludeUserIds ?? []);
	const keep = (rows: Array<{ userId: string; email: string }>) =>
		[
			...new Set(
				rows
					.filter((row) => !excluded.has(row.userId) && !isReservedEmail(row.email))
					.map((row) => row.userId),
			),
		].toSorted();

	const managed = alias(employee, "managed_employee");
	// `employee` is the manager here, read in the same organization.
	const links = await client
		.select({
			userId: employee.userId,
			email: user.email,
			current: onCurrentRoster(input.organizationId, employee, input.now),
		})
		.from(employeeManagers)
		.innerJoin(
			managed,
			and(
				eq(managed.id, employeeManagers.employeeId),
				eq(managed.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeManagers.managerId),
				eq(employee.organizationId, input.organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				inArray(employeeManagers.employeeId, [...input.employeeIds]),
				input.primaryOnly ? eq(employeeManagers.isPrimary, true) : undefined,
			),
		);
	const managers = keep(links.filter((link) => link.current));
	if (managers.length > 0) return { userIds: managers, reason: "managers" };
	// Admins stand in only where every manager is a former employee.
	const everyManagerIsFormer = links.length > 0 && links.every((link) => !link.current);
	if (input.notice === "informational" || !everyManagerIsFormer) {
		return { userIds: [], reason: "none" };
	}

	// The alias `m` is what `memberIsAccessibleOwnerOrAdmin` reads.
	const m = alias(member, "m");
	const at = input.now ? sql`${dateFromInstant(input.now)}::timestamptz` : sql`now()`;
	const admins = keep(
		await client
			.select({ userId: m.userId, email: user.email })
			.from(m)
			.innerJoin(user, eq(user.id, m.userId))
			.where(and(eq(m.organizationId, input.organizationId), memberIsAccessibleOwnerOrAdmin(at))),
	);
	return admins.length > 0
		? { userIds: admins, reason: "organization_admins" }
		: { userIds: [], reason: "none" };
}
