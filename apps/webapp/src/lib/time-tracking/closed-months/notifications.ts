import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db as appDb } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, employeeManagers } from "@/db/schema";
import { customRole, customRolePermission, employeeCustomRole } from "@/db/schema/custom-role";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { defineAbilityFor } from "@/lib/authorization/ability";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import { createLogger } from "@/lib/logger";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { canCloseMonths } from "./permissions";
import { englishMonthLabel } from "./refusal";
import type { ClosedMonthKey } from "./rules";
import type { CloseMonthBlocker } from "./store";

/**
 * In-app notifications of closed months (#762): an automatic close and a
 * blocked automatic close tell everyone allowed to close; a reopening tells
 * the affected employees' managers. A manual close tells no one.
 */

const logger = createLogger("ClosedMonthNotifications");

type Database = typeof appDb;
type Reader = Pick<Database, "select">;

export const CLOSED_MONTHS_PATH = "/settings/closed-months";

/** Users of the organization allowed to close months right now, sorted. */
export async function listMonthCloseRecipients(
	database: Reader,
	organizationId: string,
): Promise<string[]> {
	const [members, grants] = await Promise.all([
		database
			.select({ userId: member.userId, role: member.role })
			.from(member)
			.where(and(eq(member.organizationId, organizationId), eq(member.status, "approved"))),
		database
			.select({ userId: employee.userId })
			.from(employeeCustomRole)
			.innerJoin(employee, eq(employee.id, employeeCustomRole.employeeId))
			.innerJoin(customRole, eq(customRole.id, employeeCustomRole.customRoleId))
			.innerJoin(customRolePermission, eq(customRolePermission.customRoleId, customRole.id))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					eq(customRole.organizationId, organizationId),
					eq(customRole.isActive, true),
					eq(customRolePermission.action, "close"),
					eq(customRolePermission.subject, "PayrollPeriod"),
				),
			),
	]);
	const candidates = new Set([
		...members
			.filter(
				(row) => hasOrganizationRole(row.role, "owner") || hasOrganizationRole(row.role, "admin"),
			)
			.map((row) => row.userId),
		...grants.flatMap((row) => (row.userId ? [row.userId] : [])),
	]);
	// Every candidate is confirmed against the same ability the close action checks.
	const allowed = await Promise.all(
		[...candidates].map(async (userId) => {
			const principal = await loadOrganizationPrincipalContext(database, {
				userId,
				organizationId,
			});
			return canCloseMonths(defineAbilityFor(principal), organizationId, organizationId);
		}),
	);
	return [...candidates].filter((_, index) => allowed[index]).toSorted();
}

/** The users managing any of the employees, sorted. */
export async function listManagerUserIds(
	database: Reader,
	input: { organizationId: string; employeeIds: readonly string[] },
): Promise<string[]> {
	if (input.employeeIds.length === 0) return [];
	const managed = alias(employee, "managed");
	const manager = alias(employee, "manager");
	const rows = await database
		.select({ userId: manager.userId })
		.from(employeeManagers)
		.innerJoin(managed, eq(managed.id, employeeManagers.employeeId))
		.innerJoin(manager, eq(manager.id, employeeManagers.managerId))
		.where(
			and(
				inArray(employeeManagers.employeeId, [...input.employeeIds]),
				eq(managed.organizationId, input.organizationId),
				eq(manager.organizationId, input.organizationId),
			),
		);
	return [...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))].toSorted();
}

const closedCopy = {
	titleKey: "common:notifications.content.monthClosedAutomatically.title",
	titleDefault: "Month closed",
	messageKey: "common:notifications.content.monthClosedAutomatically.message",
	messageDefault:
		"{month} was closed automatically for {count, plural, one {# employee} other {# employees}}. Its work and absences can no longer change unless it is reopened.",
} as const;

const blockedCopy = {
	titleKey: "common:notifications.content.monthCloseBlocked.title",
	titleDefault: "Month could not be closed",
	messageKey: "common:notifications.content.monthCloseBlocked.message",
	messageDefault:
		"{month} was not closed automatically: {count, plural, one {# open item blocks} other {# open items block}} it, such as undecided requests or work still running. It will be tried again tomorrow.",
} as const;

const reopenedCopy = {
	titleKey: "common:notifications.content.monthReopened.title",
	titleDefault: "Month reopened",
	messageKey: "common:notifications.content.monthReopened.message",
	messageDefault:
		"{month} was reopened for {count, plural, one {# of your employees} other {# of your employees}}: {reason}",
} as const;

function notification(
	input: {
		organizationId: string;
		userId: string;
		month: ClosedMonthKey;
		idempotencyKey: string;
		params: Record<string, string | number>;
	},
	type: CreateNotificationParams["type"],
	copy: { titleKey: string; titleDefault: string; messageKey: string; messageDefault: string },
	englishMessage: string,
): CreateNotificationParams {
	return {
		userId: input.userId,
		organizationId: input.organizationId,
		type,
		title: copy.titleDefault,
		message: englishMessage,
		actionUrl: CLOSED_MONTHS_PATH,
		idempotencyKey: input.idempotencyKey,
		metadata: {
			closedMonth: input.month,
			i18n: { ...copy, params: { ...input.params, month: englishMonthLabel(input.month) } },
		},
	};
}

async function deliver(notifications: CreateNotificationParams[]): Promise<number> {
	let delivered = 0;
	for (const params of notifications) {
		try {
			const result = await insertInAppNotification(params);
			if (result.kind === "created") delivered += 1;
		} catch (error) {
			logger.error(
				{ error, organizationId: params.organizationId, type: params.type },
				"Closed month notification failed",
			);
		}
	}
	return delivered;
}

export async function notifyAutomaticClose(
	database: Reader,
	input: { organizationId: string; month: ClosedMonthKey; employeeCount: number },
): Promise<number> {
	const recipients = await listMonthCloseRecipients(database, input.organizationId);
	const label = englishMonthLabel(input.month);
	return deliver(
		recipients.map((userId) =>
			notification(
				{
					organizationId: input.organizationId,
					userId,
					month: input.month,
					idempotencyKey: `closed-month:auto:${input.organizationId}:${input.month}:${userId}`,
					params: { count: input.employeeCount },
				},
				"month_closed_automatically",
				closedCopy,
				`${label} was closed automatically for ${input.employeeCount} employees.`,
			),
		),
	);
}

export async function notifyBlockedAutomaticClose(
	database: Reader,
	input: {
		organizationId: string;
		month: ClosedMonthKey;
		/** The organization's day of this attempt, so each retry notifies once. */
		runDate: string;
		blockers: readonly CloseMonthBlocker[];
	},
): Promise<number> {
	const recipients = await listMonthCloseRecipients(database, input.organizationId);
	const label = englishMonthLabel(input.month);
	const count = input.blockers.length;
	return deliver(
		recipients.map((userId) =>
			notification(
				{
					organizationId: input.organizationId,
					userId,
					month: input.month,
					idempotencyKey: `closed-month:blocked:${input.organizationId}:${input.month}:${input.runDate}:${userId}`,
					params: { count },
				},
				"month_close_blocked",
				blockedCopy,
				`${label} was not closed automatically: ${count} open items block it.`,
			),
		),
	);
}

export async function notifyReopening(
	database: Reader,
	input: {
		organizationId: string;
		month: ClosedMonthKey;
		reopeningId: string;
		employeeIds: readonly string[];
		reason: string;
		actorUserId: string;
	},
): Promise<number> {
	const managers = (await listManagerUserIds(database, input)).filter(
		(userId) => userId !== input.actorUserId,
	);
	const label = englishMonthLabel(input.month);
	// Each manager hears how many of their own employees were reopened.
	const counts = await Promise.all(
		managers.map(async (userId) => {
			const managed = await listManagedEmployeeIds(database, {
				organizationId: input.organizationId,
				managerUserId: userId,
			});
			return input.employeeIds.filter((id) => managed.has(id)).length;
		}),
	);
	return deliver(
		managers.map((userId, index) =>
			notification(
				{
					organizationId: input.organizationId,
					userId,
					month: input.month,
					idempotencyKey: `closed-month:reopened:${input.reopeningId}:${userId}`,
					params: { count: counts[index], reason: input.reason },
				},
				"month_reopened",
				reopenedCopy,
				`${label} was reopened for ${counts[index]} of your employees: ${input.reason}`,
			),
		),
	);
}

async function listManagedEmployeeIds(
	database: Reader,
	input: { organizationId: string; managerUserId: string },
): Promise<Set<string>> {
	const manager = alias(employee, "manager");
	const rows = await database
		.select({ employeeId: employeeManagers.employeeId })
		.from(employeeManagers)
		.innerJoin(manager, eq(manager.id, employeeManagers.managerId))
		.where(
			and(
				eq(manager.userId, input.managerUserId),
				eq(manager.organizationId, input.organizationId),
			),
		);
	return new Set(rows.map((row) => row.employeeId));
}
