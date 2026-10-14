import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { clockingReminderOccasion } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import {
	buildClockingReminderNotification,
	buildDrivingDetailsReminderNotification,
} from "./notifications";
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
	/**
	 * Delivers on every channel the employee's preferences allow. Throws only while no channel has
	 * delivered anything; once any channel has delivered, a failure on another channel must be
	 * swallowed, never thrown, or the released claim would deliver the reminder a second time.
	 */
	notify(params: CreateNotificationParams, locale: string): Promise<void>;
}

/**
 * Sends one reminder occasion at most once across all channels. The occasion is claimed before
 * any delivery. If `locale` or `notify` throws, nothing was delivered, so the claim is released
 * and a later run retries the occasion. A channel failure that `notify` swallows keeps the claim:
 * that channel's reminder is lost, which is accepted, because a missed nudge costs less than a
 * repeated one.
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

/**
 * Sends one driving details reminder (#1127, #807 decision 8) about every given occasion the run
 * can still claim: each work period is reminded at most once, and an employee's newly due work
 * periods of a morning arrive in one notification. Claims and release follow
 * `sendClockingReminder`: all claims are released together when nothing was delivered.
 * Returns how many occasions this run claimed and how many were claimed already.
 */
export async function sendDrivingDetailsReminder(
	input: {
		reminders: readonly DueClockingReminder[];
		recipient: ClockingReminderRecipient;
		now: Instant;
	},
	deps: { database: Database; transport: ClockingReminderTransport },
): Promise<{ sent: number; alreadySent: number }> {
	const { reminders, recipient } = input;
	if (reminders.length === 0) return { sent: 0, alreadySent: 0 };
	const claimed = await deps.database
		.insert(clockingReminderOccasion)
		.values(
			reminders.map((reminder) => ({
				organizationId: recipient.organizationId,
				employeeId: recipient.employeeId,
				type: reminder.type,
				occasionKey: reminder.occasionKey,
				expectedAt: dateFromInstant(reminder.expectedAt),
				sentAt: dateFromInstant(input.now),
			})),
		)
		.onConflictDoNothing({
			target: [clockingReminderOccasion.organizationId, clockingReminderOccasion.occasionKey],
		})
		.returning({
			id: clockingReminderOccasion.id,
			occasionKey: clockingReminderOccasion.occasionKey,
		});
	const alreadySent = reminders.length - claimed.length;
	if (claimed.length === 0) return { sent: 0, alreadySent };
	const claimedKeys = new Set(claimed.map((claim) => claim.occasionKey));
	try {
		const locale = await deps.transport.locale(recipient);
		await deps.transport.notify(
			buildDrivingDetailsReminderNotification({
				reminders: reminders.filter((reminder) => claimedKeys.has(reminder.occasionKey)),
				organizationId: recipient.organizationId,
				userId: recipient.userId,
				timezone: recipient.timezone,
			}),
			locale,
		);
		return { sent: claimed.length, alreadySent };
	} catch (error) {
		await deps.database.delete(clockingReminderOccasion).where(
			and(
				eq(clockingReminderOccasion.organizationId, recipient.organizationId),
				inArray(
					clockingReminderOccasion.id,
					claimed.map((claim) => claim.id),
				),
			),
		);
		throw error;
	}
}
