import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { member, user } from "@/db/auth-schema";
import { employee, employeeManagers } from "@/db/schema";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import type { WorkTransactionClient } from "@/lib/time-tracking/web-clock-out-transaction";

/**
 * Who receives a notification addressed to a user (#860, spec #761). A
 * kiosk-only employee (ADR 0006: a reserved, undeliverable address and no
 * sign-in) can see none of the channels, so their notifications go to their
 * managers in the organization instead; with no manager, to its owners and
 * admins. Everyone else receives their own.
 */
export type NotificationRecipients =
	| { kind: "self" }
	| {
			kind: "forwarded";
			/** The kiosk-only employee the notification was for. */
			employee: { userId: string; employeeId: string; name: string };
			userIds: string[];
	  };

type Reader = Pick<WorkTransactionClient, "select">;

export async function resolveNotificationRecipients(
	client: Reader,
	input: { userId: string; organizationId: string },
): Promise<NotificationRecipients> {
	const [recipient] = await client
		.select({ email: user.email, name: user.name, employeeId: employee.id })
		.from(user)
		.leftJoin(
			employee,
			and(eq(employee.userId, user.id), eq(employee.organizationId, input.organizationId)),
		)
		.where(eq(user.id, input.userId))
		.limit(1);
	if (!recipient || !isReservedEmail(recipient.email) || !recipient.employeeId) {
		return { kind: "self" };
	}

	const manager = alias(employee, "manager");
	const managers = await client
		.select({ userId: manager.userId, email: user.email })
		.from(employeeManagers)
		.innerJoin(
			manager,
			and(
				eq(manager.id, employeeManagers.managerId),
				eq(manager.organizationId, input.organizationId),
				eq(manager.isActive, true),
			),
		)
		.innerJoin(user, eq(user.id, manager.userId))
		.where(eq(employeeManagers.employeeId, recipient.employeeId));
	let userIds = managers.filter((row) => !isReservedEmail(row.email)).map((row) => row.userId);
	if (userIds.length === 0) {
		const admins = await client
			.select({ userId: member.userId, email: user.email })
			.from(member)
			.innerJoin(user, eq(user.id, member.userId))
			.where(
				and(
					eq(member.organizationId, input.organizationId),
					inArray(member.role, ["owner", "admin"]),
					eq(member.status, "approved"),
				),
			);
		userIds = admins.filter((row) => !isReservedEmail(row.email)).map((row) => row.userId);
	}
	return {
		kind: "forwarded",
		employee: { userId: input.userId, employeeId: recipient.employeeId, name: recipient.name },
		userIds: [...new Set(userIds)],
	};
}
