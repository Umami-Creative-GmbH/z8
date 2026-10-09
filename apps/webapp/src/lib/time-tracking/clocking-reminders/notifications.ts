import type { Instant } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { ClockingReminderType, DueClockingReminder } from "./occasion";

interface ReminderCopy {
	titleKey: string;
	titleDefault: string;
	messageKey: string;
	messageDefault: string;
}

// Each key sits next to its English default so the Tolgee extractor reads both.
const reminderCopy = {
	missed_clock_in_reminder: {
		titleKey: "common:notifications.content.missedClockInReminder.title",
		titleDefault: "You have not clocked in yet",
		messageKey: "common:notifications.content.missedClockInReminder.message",
		messageDefault: "Your shift started at {startTime} ({timezone}). Clock in if you are working.",
	},
	forgotten_clock_out_reminder: {
		titleKey: "common:notifications.content.forgottenClockOutReminder.title",
		titleDefault: "You are still clocked in",
		messageKey: "common:notifications.content.forgottenClockOutReminder.message",
		messageDefault:
			"Your shift ended at {endTime} ({timezone}). Clock out if you have finished working.",
	},
} as const satisfies Record<ClockingReminderType, Record<string, string>>;

/** Days without a shift are judged by the work policy (#830): the message names the policy times. */
const policyReminderCopy = {
	missed_clock_in_reminder: {
		titleKey: "common:notifications.content.missedClockInReminder.title",
		titleDefault: "You have not clocked in yet",
		messageKey: "common:notifications.content.policyMissedClockInReminder.message",
		messageDefault:
			"Your latest clock-in today was {startTime} ({timezone}). Clock in if you are working.",
	},
	forgotten_clock_out_reminder: {
		titleKey: "common:notifications.content.forgottenClockOutReminder.title",
		titleDefault: "You are still clocked in",
		messageKey: "common:notifications.content.policyForgottenClockOutReminder.message",
		messageDefault:
			"You reached today's required hours at {endTime} ({timezone}). Clock out if you have finished working.",
	},
} as const satisfies Partial<Record<ClockingReminderType, Record<string, string>>>;

function formatTime(instant: Instant, locale: string, timezone: string): string {
	return instant.toLocaleString(locale, { timeStyle: "short", timeZone: timezone });
}

/**
 * The reminder as the employee receives it: English text plus the i18n keys and parameters, with
 * shift times shown in the employee's own timezone and locale.
 */
export function buildClockingReminderNotification(input: {
	reminder: DueClockingReminder;
	organizationId: string;
	userId: string;
	timezone: string;
	locale: string;
}): CreateNotificationParams {
	const { reminder, timezone, locale } = input;
	const params: Record<string, string> = { timezone };
	let copy: ReminderCopy = reminderCopy[reminder.type];
	if (reminder.shift) {
		params.startTime = formatTime(reminder.shift.start, locale, timezone);
		params.endTime = formatTime(reminder.shift.end, locale, timezone);
	} else if (reminder.type in policyReminderCopy) {
		copy = policyReminderCopy[reminder.type as keyof typeof policyReminderCopy];
		const expected = formatTime(reminder.expectedAt, locale, timezone);
		params[reminder.type === "missed_clock_in_reminder" ? "startTime" : "endTime"] = expected;
	}
	const render = (template: string) =>
		template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
	return {
		userId: input.userId,
		organizationId: input.organizationId,
		type: reminder.type,
		title: copy.titleDefault,
		message: render(copy.messageDefault),
		...(reminder.shift ? { entityType: "shift", entityId: reminder.shift.id } : {}),
		actionUrl: "/time-tracking",
		idempotencyKey: `clocking-reminder:${reminder.occasionKey}`,
		metadata: {
			occasionKey: reminder.occasionKey,
			day: reminder.day,
			expectedAt: reminder.expectedAt.toString(),
			i18n: { ...copy, params },
		},
	};
}
