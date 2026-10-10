import { and, eq, inArray } from "drizzle-orm";
import { member, user } from "@/db/auth-schema";
import { employee, employeeManagers } from "@/db/schema";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type { WorkTransactionClient } from "@/lib/time-tracking/web-clock-out-transaction";
import type { CreateNotificationParams } from "./types";

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
			employee: ForwardedFor;
			userIds: string[];
	  };

export type ForwardedFor = { userId: string; employeeId: string; name: string };

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

	// Managers who may still use the organization, as for the who-is-in view.
	const managers = await client
		.select({ userId: employee.userId, email: user.email })
		.from(employeeManagers)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeManagers.managerId),
				eq(employee.organizationId, input.organizationId),
				employeeHasOrganizationAccess(),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
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

/**
 * A kiosk-only employee's notification as one of their managers receives it:
 * the title names the employee, the metadata records whom it was for, and the
 * employee's own link is dropped. Every channel that forwards uses this shape.
 */
export function forwardedNotification(
	params: CreateNotificationParams,
	forwardedFor: ForwardedFor,
	recipientUserId: string,
): CreateNotificationParams {
	return {
		...params,
		userId: recipientUserId,
		title: `${forwardedFor.name}: ${params.title}`,
		actionUrl: undefined,
		metadata: { ...params.metadata, forwardedFor },
		idempotencyKey: params.idempotencyKey
			? `${params.idempotencyKey}:kiosk-only:${recipientUserId}`
			: undefined,
	};
}
