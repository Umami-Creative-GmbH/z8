import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { clockingReminderOccasion } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { buildClockingReminderNotification } from "./notifications";
import type { DueClockingReminder } from "./occasion";

type Database = Pick<typeof db, "insert" | "delete">;

export interface ClockingReminderRecipient {
	organizationId: string;
	employeeId: string;
	userId: string;
	timezone: string;
}

export interface ClockingReminderTransport {
	locale(input: { userId: string; organizationId: string }): Promise<string>;
	/** Delivers on every channel the employee's preferences allow; throws if nothing was stored. */
	notify(params: CreateNotificationParams, locale: string): Promise<void>;
}

/**
 * Sends one reminder occasion at most once across all channels. The occasion is claimed before
 * any delivery; a claim whose delivery failed before anything was stored is released so a later
 * run can retry it.
 */
export async function sendClockingReminder(
	input: { reminder: DueClockingReminder; recipient: ClockingReminderRecipient; now: Instant },
	deps: { database: Database; transport: ClockingReminderTransport },
): Promise<"sent" | "already_sent"> {
	const { reminder, recipient } = input;
	const [claimed] = await deps.database
		.insert(clockingReminderOccasion)
		.values({
			organizationId: recipient.organizationId,
			employeeId: recipient.employeeId,
			type: reminder.type,
			occasionKey: reminder.occasionKey,
			expectedAt: dateFromInstant(reminder.expectedAt),
			sentAt: dateFromInstant(input.now),
		})
		.onConflictDoNothing({
			target: [clockingReminderOccasion.organizationId, clockingReminderOccasion.occasionKey],
		})
		.returning({ id: clockingReminderOccasion.id });
	if (!claimed) return "already_sent";
	try {
		const locale = await deps.transport.locale(recipient);
		await deps.transport.notify(
			buildClockingReminderNotification({
				reminder,
				organizationId: recipient.organizationId,
				userId: recipient.userId,
				timezone: recipient.timezone,
				locale,
			}),
			locale,
		);
		return "sent";
	} catch (error) {
		await deps.database
			.delete(clockingReminderOccasion)
			.where(
				and(
					eq(clockingReminderOccasion.organizationId, recipient.organizationId),
					eq(clockingReminderOccasion.id, claimed.id),
				),
			);
		throw error;
	}
}
